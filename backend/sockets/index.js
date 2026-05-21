const jwt        = require("jsonwebtoken");
const config     = require("../config/env");
const pool       = require("../config/db");
const logger     = require("../utils/logger");
const { captureSocketError } = require("../config/sentry");
const { AUTH_COOKIE }        = require("../config/constants");
const { EVENTS, emitTypedEvent } = require("./socketEvents");
const rateLimiter = require("./socketRateLimiter");

// Parse a cookie string into a key→value map
function parseCookies(cookieHeader = "") {
  return Object.fromEntries(
    cookieHeader.split(";").map((c) => {
      const [k, ...v] = c.trim().split("=");
      return [k.trim(), decodeURIComponent(v.join("="))];
    }),
  );
}

function setupSockets(io) {
  // ── Auth middleware ──────────────────────────────────────────────────────────
  io.use((socket, next) => {
    try {
      const cookies    = parseCookies(socket.handshake.headers?.cookie || "");
      const cookieToken = cookies[AUTH_COOKIE];
      const headerToken = socket.handshake.auth?.token ||
        socket.handshake.headers?.authorization?.replace(/^Bearer\s+/i, "");

      const token = cookieToken || headerToken;
      if (!token) return next(new Error("Unauthorized"));

      const decoded = jwt.verify(token, config.jwt.secret);
      socket.user = {
        id:       Number(decoded.id),
        role:     decoded.role,
        username: decoded.username,
      };
      next();
    } catch (err) {
      next(new Error(err.name === "TokenExpiredError" ? "Token expired" : "Unauthorized"));
    }
  });

  io.on("connection", (socket) => {
    logger.debug("socket connected", { socketId: socket.id, userId: socket.user.id });

    // Always join personal room for targeted notifications
    socket.join(`user_${socket.user.id}`);

    // Track which project rooms this socket has joined (for disconnect cleanup)
    const joinedProjectRooms = new Set();

    // ── disconnect ─────────────────────────────────────────────────────────────
    socket.on("disconnect", (reason) => {
      logger.debug("socket disconnected", {
        socketId: socket.id,
        userId:   socket.user.id,
        reason,
      });

      // Emit typing:stopped on behalf of this socket for every project room
      // it was in — prevents stale typing indicators for other users
      for (const projectId of joinedProjectRooms) {
        const room = `project_${projectId}`;
        // Use socket.to() — but socket is already disconnected, use io.to()
        io.to(room).emit(EVENTS.TYPING_STOPPED, {
          v:         1,
          event:     EVENTS.TYPING_STOPPED,
          seqId:     Date.now(),
          projectId: Number(projectId),
          actorId:   socket.user.id,
          actorName: socket.user.username,
          actorRole: socket.user.role,
          ts:        new Date().toISOString(),
          data:      {},
        });
      }

      // Clean up rate limiter state for this socket
      rateLimiter.cleanup(socket.id);
    });

    socket.on("error", (err) => {
      logger.error("socket error", err);
      captureSocketError(err, { socketId: socket.id, userId: socket.user?.id });
    });

    // ── register (no-op if already in personal room) ──────────────────────────
    socket.on("register", (userId) => {
      if (Number(userId) === socket.user.id) {
        socket.join(`user_${socket.user.id}`);
      }
    });

    // ── join_project ───────────────────────────────────────────────────────────
    socket.on("join_project", async (payload) => {
      if (!rateLimiter.check(socket, "join_project")) return;

      // Accept both legacy numeric form and new object form { projectId, lastSeqId }
      const projectId  = typeof payload === "object" ? Number(payload.projectId) : Number(payload);
      const lastSeqId  = typeof payload === "object" ? (payload.lastSeqId || 0) : 0;

      if (!Number.isInteger(projectId) || projectId <= 0) return;

      try {
        const result = await pool.query(
          "SELECT client_id, assigned_developer_id FROM projects WHERE id = $1",
          [projectId],
        );
        const project = result.rows[0];
        if (
          project &&
          (Number(project.client_id) === socket.user.id ||
            Number(project.assigned_developer_id) === socket.user.id)
        ) {
          socket.join(`project_${projectId}`);
          joinedProjectRooms.add(projectId);

          // ── Missed-event replay ──────────────────────────────────────────────
          // If the client provides a lastSeqId, replay events they missed.
          if (lastSeqId > 0) {
            await replayMissedEvents(socket, projectId, lastSeqId);
          }
        }
      } catch (err) {
        logger.error("join_project error", err);
      }
    });

    // ── replay_next (pagination for large replay batches) ─────────────────────
    socket.on("replay_next", async ({ projectId, afterSeqId }) => {
      if (!rateLimiter.check(socket, "replay_next")) return;
      const id = Number(projectId);
      if (!Number.isInteger(id) || id <= 0 || !afterSeqId) return;
      // Only replay if socket is in the room
      if (!joinedProjectRooms.has(id)) return;
      await replayMissedEvents(socket, id, afterSeqId);
    });

    // ── typing ─────────────────────────────────────────────────────────────────
    // Rate limited: max 5 typing events per second per socket.
    socket.on("typing", ({ projectId, typing }) => {
      if (!rateLimiter.check(socket, "typing")) return;

      const id = Number(projectId);
      if (!Number.isInteger(id) || id <= 0) return;

      const eventName = typing ? EVENTS.TYPING_STARTED : EVENTS.TYPING_STOPPED;
      const envelope  = {
        v:         1,
        event:     eventName,
        seqId:     Date.now(),
        projectId: id,
        actorId:   socket.user.id,
        actorName: socket.user.username,
        actorRole: socket.user.role,
        ts:        new Date().toISOString(),
        data:      {},
      };

      socket.to(`project_${id}`).emit(eventName, envelope);
    });

    // ── leave_project ──────────────────────────────────────────────────────────
    socket.on("leave_project", (projectId) => {
      if (!rateLimiter.check(socket, "leave_project")) return;
      const id = Number(projectId);
      if (Number.isInteger(id) && id > 0) {
        socket.leave(`project_${id}`);
        joinedProjectRooms.delete(id);
      }
    });
  });
}

// ── Missed-event replay ────────────────────────────────────────────────────────
const REPLAY_WINDOW_MS   = 5 * 60 * 1000; // 5 minutes
const MAX_REPLAY_EVENTS  = 50;

async function replayMissedEvents(socket, projectId, lastSeqId) {
  try {
    const gapMs = Date.now() - lastSeqId;

    // Gap too large — tell client to do a targeted refetch instead
    if (gapMs > REPLAY_WINDOW_MS) {
      socket.emit(EVENTS.SYSTEM_REPLAY_BATCH, {
        v:         1,
        event:     EVENTS.SYSTEM_REPLAY_BATCH,
        seqId:     Date.now(),
        projectId,
        ts:        new Date().toISOString(),
        data:      { events: [], hasMore: false, fallback: true },
      });
      return;
    }

    const cutoff = new Date(lastSeqId);

    const result = await pool.query(
      `SELECT
         pe.id,
         pe.project_id,
         pe.actor_id,
         pe.event_type,
         pe.meta,
         pe.created_at,
         pe.actor_name,
         pe.actor_role,
         pe.approval_status,
         pe.approval_feedback,
         COALESCE(pe.actioned_at, pe.approved_at) AS actioned_at
       FROM project_events pe
       WHERE pe.project_id = $1
         AND pe.created_at > $2
       ORDER BY pe.created_at ASC
       LIMIT $3`,
      [projectId, cutoff, MAX_REPLAY_EVENTS + 1],
    );

    const rows    = result.rows;
    const hasMore = rows.length > MAX_REPLAY_EVENTS;
    const events  = rows.slice(0, MAX_REPLAY_EVENTS).map((row) => ({
      v:         1,
      event:     mapDbEventTypeToSocketEvent(row.event_type),
      seqId:     new Date(row.created_at).getTime(),
      projectId: row.project_id,
      actorId:   row.actor_id,
      actorName: row.actor_name,
      actorRole: row.actor_role,
      ts:        row.created_at,
      data: {
        eventId:          row.id,
        eventType:        row.event_type,
        meta:             row.meta,
        approvalStatus:   row.approval_status,
        approvalFeedback: row.approval_feedback,
        actionedAt:       row.actioned_at,
      },
    }));

    socket.emit(EVENTS.SYSTEM_REPLAY_BATCH, {
      v:         1,
      event:     EVENTS.SYSTEM_REPLAY_BATCH,
      seqId:     Date.now(),
      projectId,
      ts:        new Date().toISOString(),
      data:      { events, hasMore, fallback: false },
    });

    logger.debug("replay batch sent", {
      socketId:  socket.id,
      userId:    socket.user.id,
      projectId,
      count:     events.length,
      hasMore,
    });
  } catch (err) {
    logger.error("replayMissedEvents error", err);
    // Fail safe: tell client to refetch
    socket.emit(EVENTS.SYSTEM_REPLAY_BATCH, {
      v:         1,
      event:     EVENTS.SYSTEM_REPLAY_BATCH,
      seqId:     Date.now(),
      projectId,
      ts:        new Date().toISOString(),
      data:      { events: [], hasMore: false, fallback: true },
    });
  }
}

// Map DB event_type strings to typed socket event names
function mapDbEventTypeToSocketEvent(eventType) {
  const map = {
    submission_added:    "submission:created",
    note_added:          "submission:note_added",
    note_updated:        "submission:note_updated",
    note_deleted:        "submission:note_deleted",
    project_approved:    "approval:granted",
    revision_requested:  "revision:requested",
    bid_accepted:        "bid:accepted",
    project_urgent:      "project:urgent_set",
    project_unurgent:    "project:urgent_cleared",
    update_requested:    "project:status_changed",
    status_changed:      "project:status_changed",
    file_uploaded:       "project:status_changed",
    file_deleted:        "project:status_changed",
  };
  return map[eventType] || "activity:entry_updated";
}

module.exports = setupSockets;
