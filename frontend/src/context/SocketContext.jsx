/**
 * SocketContext.jsx — Phase 4: Realtime Reliability
 *
 * 1. CONNECTION STATE MACHINE
 *    Exposes connectionState: connected | reconnecting | degraded |
 *    disconnected | auth_expired | transport_fallback
 *
 * 2. TYPED EVENT HANDLERS WITH setQueryData
 *    Typed events carry full payloads and update the cache in-place.
 *    DB refetches only happen for aggregates (stats) that can't be
 *    derived from the payload alone.
 *
 * 3. seqId DEDUPLICATION
 *    Each event carries a seqId (Unix ms). A per-project LRU seen-set
 *    prevents double-applying events (e.g. from reconnect replay).
 *
 * 4. ACTOR SELF-SKIP
 *    Events where actorId === currentUser.id are skipped — the HTTP
 *    response already applied the canonical update for the actor.
 *
 * 5. MISSED-EVENT REPLAY
 *    On reconnect, join_project is emitted with lastSeqId so the server
 *    can replay missed events. system:replay_batch is processed here.
 */
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useCallback,
  useState,
} from "react";
import { socket, connectSocket, disconnectSocket } from "../socket";
import { queryClient } from "../lib/queryClient";
import { queryKeys } from "../lib/queryKeys";
import { useAuth } from "./AuthContext";

// ── Context ───────────────────────────────────────────────────────────────────
const SocketContext = createContext(null);

// ── LRU seen-set for seqId deduplication ─────────────────────────────────────
// Keeps the last MAX_SEEN seqIds per project to detect duplicates.
const MAX_SEEN = 60;

function createSeenSet() {
  const items = [];
  return {
    has(id) { return items.includes(id); },
    add(id) {
      if (items.includes(id)) return;
      items.push(id);
      if (items.length > MAX_SEEN) items.shift();
    },
  };
}

// ── All activity filter variants (for cache updates across filters) ───────────
const ACTIVITY_FILTERS = ["all", "submissions", "files", "reviews", "system"];

export function SocketProvider({ children }) {
  const { isAuthenticated, currentUser } = useAuth();

  // ── Connection state machine ──────────────────────────────────────────────
  const [connectionState,   setConnectionState]   = useState("disconnected");
  const [reconnectAttempt,  setReconnectAttempt]  = useState(0);
  const [lastConnectedAt,   setLastConnectedAt]   = useState(null);
  const [lastDisconnectedAt,setLastDisconnectedAt]= useState(null);

  // ── Per-project tracking ──────────────────────────────────────────────────
  // lastSeqId: Map<projectId, number> — cursor for replay
  // seenSets:  Map<projectId, SeenSet> — deduplication
  const lastSeqIdRef = useRef(new Map());
  const seenSetsRef  = useRef(new Map());

  // ── Helpers ───────────────────────────────────────────────────────────────
  const getSeenSet = useCallback((projectId) => {
    if (!seenSetsRef.current.has(projectId)) {
      seenSetsRef.current.set(projectId, createSeenSet());
    }
    return seenSetsRef.current.get(projectId);
  }, []);

  const updateLastSeqId = useCallback((projectId, seqId) => {
    const current = lastSeqIdRef.current.get(projectId) || 0;
    if (seqId > current) lastSeqIdRef.current.set(projectId, seqId);
  }, []);

  /**
   * Guard: returns true if the event should be processed.
   * Skips duplicates (seqId already seen) and self-emitted events.
   */
  const shouldProcess = useCallback((envelope, skipSelfEmit = true) => {
    if (!envelope || envelope.v !== 1) return false;
    const { seqId, projectId, actorId } = envelope;

    // Self-skip: actor's own HTTP response already applied the update
    if (skipSelfEmit && actorId && currentUser?.id && actorId === currentUser.id) {
      return false;
    }

    // Deduplication
    if (projectId && seqId) {
      const seen = getSeenSet(projectId);
      if (seen.has(seqId)) return false;
      seen.add(seqId);
      updateLastSeqId(projectId, seqId);
    }

    return true;
  }, [currentUser?.id, getSeenSet, updateLastSeqId]);

  // ── Connect / disconnect with auth state ──────────────────────────────────
  useEffect(() => {
    if (isAuthenticated) {
      connectSocket();
    } else {
      disconnectSocket();
      setConnectionState("disconnected");
    }
  }, [isAuthenticated]);

  // ── Connection state machine listeners ───────────────────────────────────
  useEffect(() => {
    const onConnect = () => {
      setConnectionState("connected");
      setReconnectAttempt(0);
      setLastConnectedAt(new Date());
    };

    const onDisconnect = (reason) => {
      setLastDisconnectedAt(new Date());
      // transport close = network drop → will auto-reconnect
      // io server disconnect = server kicked us (auth expired etc.)
      if (reason === "io server disconnect") {
        setConnectionState("auth_expired");
      } else {
        setConnectionState("reconnecting");
      }
    };

    const onReconnectAttempt = (attempt) => {
      setReconnectAttempt(attempt);
      setConnectionState(attempt > 3 ? "degraded" : "reconnecting");
    };

    const onReconnectFailed = () => {
      setConnectionState("disconnected");
    };

    const onReconnect = () => {
      setConnectionState("connected");
      setReconnectAttempt(0);
    };

    socket.on("connect",            onConnect);
    socket.on("disconnect",         onDisconnect);
    socket.on("reconnect_attempt",  onReconnectAttempt);
    socket.on("reconnect_failed",   onReconnectFailed);
    socket.on("reconnect",          onReconnect);

    // Set initial state if already connected
    if (socket.connected) setConnectionState("connected");

    return () => {
      socket.off("connect",           onConnect);
      socket.off("disconnect",        onDisconnect);
      socket.off("reconnect_attempt", onReconnectAttempt);
      socket.off("reconnect_failed",  onReconnectFailed);
      socket.off("reconnect",         onReconnect);
    };
  }, []);

  // ── Register user room when connected ────────────────────────────────────
  useEffect(() => {
    if (!currentUser?.id) return;

    const onConnect = () => {
      socket.emit("register", currentUser.id);
    };

    if (socket.connected) socket.emit("register", currentUser.id);
    socket.on("connect", onConnect);
    return () => socket.off("connect", onConnect);
  }, [currentUser?.id]);

  // ── System events ─────────────────────────────────────────────────────────
  useEffect(() => {
    const onAuthExpired = () => {
      setConnectionState("auth_expired");
    };

    // Replay batch: process missed events after reconnect
    const onReplayBatch = ({ data } = {}) => {
      if (!data) return;
      const { events = [], fallback = false } = data;

      if (fallback || events.length === 0) {
        // Server says gap is too large — do targeted invalidation
        // The workspace components handle their own project-level invalidation
        // on reconnect via their local join_project emit.
        return;
      }

      // Process each replayed event in order
      events.forEach((envelope) => {
        if (!envelope || envelope.v !== 1) return;
        // Mark as seen so live events don't double-apply
        if (envelope.projectId && envelope.seqId) {
          const seen = getSeenSet(envelope.projectId);
          if (seen.has(envelope.seqId)) return;
          seen.add(envelope.seqId);
          updateLastSeqId(envelope.projectId, envelope.seqId);
        }
        // Route to the appropriate handler based on event name
        dispatchReplayEvent(envelope);
      });
    };

    socket.on("system:auth_expired",  onAuthExpired);
    socket.on("system:replay_batch",  onReplayBatch);

    return () => {
      socket.off("system:auth_expired", onAuthExpired);
      socket.off("system:replay_batch", onReplayBatch);
    };
  }, [getSeenSet, updateLastSeqId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── TYPED EVENT HANDLERS ──────────────────────────────────────────────────
  useEffect(() => {
    if (!currentUser?.id) return;

    // ── submission:created ──────────────────────────────────────────────────
    // Wraps handler with ack callback for critical delivery confirmation
    const onSubmissionCreated = (envelope, ackFn) => {
      if (typeof ackFn === "function") ackFn({ received: true });
      if (!shouldProcess(envelope)) return;
      const { projectId, data } = envelope;

      // Update project detail: review_status → pending, increment submission_count
      queryClient.setQueryData(
        queryKeys.projects.detail(projectId),
        (old) => old ? {
          ...old,
          review_status:    "pending",
          review_feedback:  null,
          reviewed_at:      null,
          submitted_at:     data.submittedAt || old.submitted_at,
          deliverable_link: data.repoLink    || old.deliverable_link,
          demo_link:        data.demoLink    || old.demo_link,
          submission_note:  data.notes       || old.submission_note,
          submission_count: (old.submission_count || 0) + 1,
        } : old,
      );

      // Invalidate activity feed (new event row in project_events)
      ACTIVITY_FILTERS.forEach((f) => {
        queryClient.invalidateQueries({
          queryKey: queryKeys.projects.activity(projectId, f),
          exact: true,
        });
      });

      // Invalidate submissions list
      queryClient.invalidateQueries({
        queryKey: queryKeys.projects.submissions(projectId),
      });

      // Stats need a refetch (aggregate changed)
      queryClient.invalidateQueries({ queryKey: queryKeys.client.stats() });
      queryClient.invalidateQueries({ queryKey: queryKeys.developer.stats() });
    };

    // ── submission:note_added ───────────────────────────────────────────────
    const onSubmissionNoteAdded = (envelope) => {
      if (!shouldProcess(envelope)) return;
      const { projectId } = envelope;
      queryClient.invalidateQueries({ queryKey: queryKeys.projects.submissions(projectId) });
      ACTIVITY_FILTERS.forEach((f) => {
        queryClient.invalidateQueries({
          queryKey: queryKeys.projects.activity(projectId, f), exact: true,
        });
      });
    };

    // ── submission:note_updated ─────────────────────────────────────────────
    const onSubmissionNoteUpdated = (envelope) => {
      if (!shouldProcess(envelope)) return;
      const { projectId, data } = envelope;
      queryClient.setQueryData(
        queryKeys.projects.submissions(projectId),
        (old = []) => old.map((s) =>
          s.id === data.submissionId ? { ...s, notes: data.notes } : s,
        ),
      );
    };

    // ── submission:note_deleted ─────────────────────────────────────────────
    const onSubmissionNoteDeleted = (envelope) => {
      if (!shouldProcess(envelope)) return;
      const { projectId, data } = envelope;
      queryClient.setQueryData(
        queryKeys.projects.submissions(projectId),
        (old = []) => old.filter((s) => s.id !== data.submissionId),
      );
    };

    // ── approval:granted ───────────────────────────────────────────────────
    const onApprovalGranted = (envelope, ackFn) => {
      if (typeof ackFn === "function") ackFn({ received: true });
      if (!shouldProcess(envelope)) return;
      const { projectId, data } = envelope;

      // Update project detail
      queryClient.setQueryData(
        queryKeys.projects.detail(projectId),
        (old) => old ? {
          ...old,
          review_status:   "approved",
          review_feedback: data.feedback    || old.review_feedback,
          reviewed_at:     data.actionedAt  || old.reviewed_at,
          status:          data.status      || old.status,
        } : old,
      );

      // Update activity entry in all filter caches
      updateActivityEntry(projectId, data.eventId, {
        approval_status:   "approved",
        approval_feedback: data.approvalFeedback ?? data.feedback ?? null,
        actioned_at:       data.actionedAt || new Date().toISOString(),
      });

      queryClient.invalidateQueries({ queryKey: queryKeys.client.stats() });
      queryClient.invalidateQueries({ queryKey: queryKeys.developer.stats() });
    };

    // ── revision:requested ─────────────────────────────────────────────────
    const onRevisionRequested = (envelope, ackFn) => {
      if (typeof ackFn === "function") ackFn({ received: true });
      if (!shouldProcess(envelope)) return;
      const { projectId, data } = envelope;

      queryClient.setQueryData(
        queryKeys.projects.detail(projectId),
        (old) => old ? {
          ...old,
          review_status:   "revision_requested",
          review_feedback: data.feedback    || data.approvalFeedback || old.review_feedback,
          reviewed_at:     data.actionedAt  || old.reviewed_at,
        } : old,
      );

      updateActivityEntry(projectId, data.eventId, {
        approval_status:   "revision_requested",
        approval_feedback: data.approvalFeedback ?? data.feedback ?? null,
        actioned_at:       null,
      });
    };

    // ── revision:resolved ──────────────────────────────────────────────────
    const onRevisionResolved = (envelope) => {
      if (!shouldProcess(envelope)) return;
      const { projectId, data } = envelope;
      updateActivityEntry(projectId, data.eventId, {
        approval_status: "resolved",
        actioned_at:     data.actionedAt || new Date().toISOString(),
      });
    };

    // ── comment:added ──────────────────────────────────────────────────────
    const onCommentAdded = (envelope) => {
      if (!shouldProcess(envelope, false)) return; // don't skip self for comments
      const { projectId, data } = envelope;
      ACTIVITY_FILTERS.forEach((f) => {
        queryClient.setQueryData(
          queryKeys.projects.activity(projectId, f),
          (old = []) => old.map((e) =>
            e.id === data.eventId
              ? { ...e, comment_count: (e.comment_count || 0) + 1 }
              : e,
          ),
        );
      });
    };

    // ── message:sent ───────────────────────────────────────────────────────
    const onMessageSent = (envelope, ackFn) => {
      if (typeof ackFn === "function") ackFn({ received: true });
      if (!shouldProcess(envelope, false)) return; // don't skip self (sender sees own msg)
      const { projectId, data } = envelope;

      // Append to messages cache
      queryClient.setQueryData(
        queryKeys.projects.messages(projectId),
        (old = []) => {
          if (old.some((m) => m.id === data.messageId)) return old;
          return [...old, {
            id:              data.messageId,
            project_id:      projectId,
            sender_id:       data.senderId,
            receiver_id:     data.receiverId,
            body:            data.body,
            is_read:         false,
            created_at:      data.createdAt,
            sender_username: data.senderUsername,
          }];
        },
      );
    };

    // ── bid:accepted ───────────────────────────────────────────────────────
    const onBidAccepted = (envelope, ackFn) => {
      if (typeof ackFn === "function") ackFn({ received: true });
      if (!shouldProcess(envelope)) return;
      const { projectId, data } = envelope;

      // Update project detail: status → active, assigned_developer_id set
      queryClient.setQueryData(
        queryKeys.projects.detail(projectId),
        (old) => old ? {
          ...old,
          status:                 "active",
          assigned_developer_id:  data.developerId,
        } : old,
      );

      // Update bids list: mark accepted bid, reject others
      queryClient.setQueryData(
        queryKeys.projects.bids(projectId),
        (old = []) => old.map((b) => ({
          ...b,
          status: b.id === data.bidId ? "accepted" : "rejected",
        })),
      );

      queryClient.invalidateQueries({ queryKey: queryKeys.developer.stats() });
      queryClient.invalidateQueries({ queryKey: queryKeys.client.stats() });
      ACTIVITY_FILTERS.forEach((f) => {
        queryClient.invalidateQueries({
          queryKey: queryKeys.projects.activity(projectId, f), exact: true,
        });
      });
    };

    // ── project:urgent_set / project:urgent_cleared ────────────────────────
    const onUrgentChanged = (envelope, ackFn) => {
      if (typeof ackFn === "function") ackFn({ received: true });
      if (!shouldProcess(envelope)) return;
      const { projectId, data } = envelope;
      queryClient.setQueryData(
        queryKeys.projects.detail(projectId),
        (old) => old ? { ...old, is_urgent: data.isUrgent } : old,
      );
    };

    // ── project:status_changed (file events + update_requested) ───────────
    const onProjectStatusChanged = (envelope) => {
      if (!shouldProcess(envelope)) return;
      const { projectId, data } = envelope;
      if (!projectId) return;

      const fileEvents = ["file_uploaded", "file_deleted", "files_reordered"];
      if (fileEvents.includes(data?.eventType)) {
        // Invalidate files list so the file panel refreshes
        queryClient.invalidateQueries({ queryKey: queryKeys.projects.files(projectId) });
      }

      // Always invalidate activity feed — a new project_event row was inserted
      ACTIVITY_FILTERS.forEach((f) => {
        queryClient.invalidateQueries({
          queryKey: queryKeys.projects.activity(projectId, f), exact: true,
        });
      });
    };

    // ── notification:received ──────────────────────────────────────────────
    const onNotificationReceived = (notification) => {
      // Notifications come as raw objects (not typed envelope) from notificationService
      // Prepend to notifications list cache
      queryClient.setQueryData(
        queryKeys.notifications.list(),
        (old = []) => {
          if (old.some((n) => n.id === notification.id)) return old;
          return [notification, ...old];
        },
      );
    };

    // ── activity:entry_updated ─────────────────────────────────────────────
    const onActivityEntryUpdated = (payload) => {
      // Handles typed envelope { v, data: { eventId, approvalStatus, ... } }
      const isTyped = payload?.v === 1;
      const eventId          = isTyped ? payload.data?.eventId          : payload.eventId;
      const approvalStatus   = isTyped ? payload.data?.approvalStatus   : payload.approval_status;
      const approvalFeedback = isTyped ? payload.data?.approvalFeedback : payload.approval_feedback;
      const actionedAt       = isTyped ? payload.data?.actionedAt       : payload.actioned_at;
      const projectId        = isTyped ? payload.projectId              : null;

      if (!eventId) return;

      const update = {
        approval_status:   approvalStatus,
        approval_feedback: approvalFeedback,
        actioned_at:       actionedAt,
      };

      if (projectId) {
        updateActivityEntry(projectId, eventId, update);
      } else {
        queryClient.getQueryCache().getAll().forEach((query) => {
          const key = query.queryKey;
          if (Array.isArray(key) && key[0] === "projects" && key[1] === "activity") {
            queryClient.setQueryData(key, (old = []) =>
              old.map((e) => e.id === eventId ? { ...e, ...update } : e),
            );
          }
        });
      }
    };

    // ── Register all handlers ──────────────────────────────────────────────
    socket.on("submission:created",       onSubmissionCreated);
    socket.on("submission:note_added",    onSubmissionNoteAdded);
    socket.on("submission:note_updated",  onSubmissionNoteUpdated);
    socket.on("submission:note_deleted",  onSubmissionNoteDeleted);
    socket.on("approval:granted",         onApprovalGranted);
    socket.on("revision:requested",       onRevisionRequested);
    socket.on("revision:resolved",        onRevisionResolved);
    socket.on("comment:added",            onCommentAdded);
    socket.on("message:sent",             onMessageSent);
    socket.on("bid:accepted",             onBidAccepted);
    socket.on("project:urgent_set",       onUrgentChanged);
    socket.on("project:urgent_cleared",   onUrgentChanged);
    socket.on("project:status_changed",   onProjectStatusChanged);
    socket.on("notification",             onNotificationReceived);
    socket.on("notification:received",    onNotificationReceived);
    socket.on("activity:entry_updated",   onActivityEntryUpdated);

    return () => {
      socket.off("submission:created",       onSubmissionCreated);
      socket.off("submission:note_added",    onSubmissionNoteAdded);
      socket.off("submission:note_updated",  onSubmissionNoteUpdated);
      socket.off("submission:note_deleted",  onSubmissionNoteDeleted);
      socket.off("approval:granted",         onApprovalGranted);
      socket.off("revision:requested",       onRevisionRequested);
      socket.off("revision:resolved",        onRevisionResolved);
      socket.off("comment:added",            onCommentAdded);
      socket.off("message:sent",             onMessageSent);
      socket.off("bid:accepted",             onBidAccepted);
      socket.off("project:urgent_set",       onUrgentChanged);
      socket.off("project:urgent_cleared",   onUrgentChanged);
      socket.off("project:status_changed",   onProjectStatusChanged);
      socket.off("notification",             onNotificationReceived);
      socket.off("notification:received",    onNotificationReceived);
      socket.off("activity:entry_updated",   onActivityEntryUpdated);
    };
  }, [currentUser?.id, shouldProcess]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Expose join helper so workspace components can pass lastSeqId ─────────
  const joinProject = useCallback((projectId) => {
    const id = Number(projectId);
    if (!id) return;
    const lastSeqId = lastSeqIdRef.current.get(id) || 0;
    socket.emit("join_project", { projectId: id, lastSeqId });
  }, []);

  const contextValue = {
    socket,
    connectionState,
    reconnectAttempt,
    lastConnectedAt,
    lastDisconnectedAt,
    joinProject,
    onRetry: () => socket.connect(),
  };

  return (
    <SocketContext.Provider value={contextValue}>
      {children}
    </SocketContext.Provider>
  );
}

// ── Hooks ─────────────────────────────────────────────────────────────────────

/** Access the raw socket instance */
export function useSocket() {
  const ctx = useContext(SocketContext);
  if (!ctx) throw new Error("useSocket must be used inside <SocketProvider>");
  return ctx.socket;
}

/** Access connection state for UI indicators */
export function useConnectionState() {
  const ctx = useContext(SocketContext);
  if (!ctx) throw new Error("useConnectionState must be used inside <SocketProvider>");
  return {
    connectionState:    ctx.connectionState,
    reconnectAttempt:   ctx.reconnectAttempt,
    lastConnectedAt:    ctx.lastConnectedAt,
    lastDisconnectedAt: ctx.lastDisconnectedAt,
    onRetry:            ctx.onRetry,
  };
}

/** Access the joinProject helper (sends lastSeqId for replay) */
export function useJoinProject() {
  const ctx = useContext(SocketContext);
  if (!ctx) throw new Error("useJoinProject must be used inside <SocketProvider>");
  return ctx.joinProject;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/** Dispatch a replayed event envelope to the correct setQueryData handler */
function dispatchReplayEvent(envelope) {
  const { event, projectId, data } = envelope;
  if (!projectId || !data) return;

  switch (event) {
    case "approval:granted":
      updateActivityEntry(projectId, data.eventId, {
        approval_status:   "approved",
        approval_feedback: data.approvalFeedback || null,
        actioned_at:       data.actionedAt || null,
      });
      break;
    case "revision:requested":
      updateActivityEntry(projectId, data.eventId, {
        approval_status:   "revision_requested",
        approval_feedback: data.approvalFeedback || null,
        actioned_at:       null,
      });
      break;
    case "revision:resolved":
      updateActivityEntry(projectId, data.eventId, {
        approval_status: "resolved",
        actioned_at:     data.actionedAt || null,
      });
      break;
    default:
      // For other event types in replay, invalidate the activity feed
      ACTIVITY_FILTERS.forEach((f) => {
        queryClient.invalidateQueries({
          queryKey: queryKeys.projects.activity(projectId, f), exact: true,
        });
      });
  }
}

/** Apply a partial update to an activity entry across all filter caches */
function updateActivityEntry(projectId, eventId, update) {
  if (!eventId) return;
  ACTIVITY_FILTERS.forEach((f) => {
    queryClient.setQueryData(
      queryKeys.projects.activity(projectId, f),
      (old = []) => old.map((e) =>
        e.id === eventId ? { ...e, ...update } : e,
      ),
    );
  });
}
