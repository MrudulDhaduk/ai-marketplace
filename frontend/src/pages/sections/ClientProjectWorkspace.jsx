import { useEffect, useMemo, useState, useCallback } from "react";
import "./ProjectWorkspace.css";
import { socket } from "../../socket";
import SubmissionHistory from "./components/SubmissionHistory";
import { apiRequest, API_BASE_URL } from "../../lib/api";

/* ─── constants ─────────────────────────────────────────── */
const STATUS_META = {
  active:    { label: "Active",    cls: "active"    },
  review:    { label: "In Review", cls: "review"    },
  completed: { label: "Completed", cls: "completed" },
  draft:     { label: "Draft",     cls: "draft"     },
};

const PROGRESS_STAGES = [
  { key: "not_started", label: "Not Started", pct:  0  },
  { key: "in_progress", label: "In Progress",  pct: 35  },
  { key: "submitted",   label: "Submitted",    pct: 65  },
  { key: "in_review",   label: "In Review",    pct: 80  },
  { key: "completed",   label: "Completed",    pct: 100 },
];

const FILE_ICONS = {
  pdf:  "📄", zip: "🗜️", rar: "🗜️",
  png:  "🖼️", jpg: "🖼️", jpeg: "🖼️", gif: "🖼️", svg: "🖼️", webp: "🖼️",
  mp4:  "🎬", mov: "🎬", avi: "🎬",
  mp3:  "🎵", wav: "🎵",
  doc:  "📝", docx: "📝", txt: "📝",
  xls:  "📊", xlsx: "📊", csv: "📊",
  js:   "💻", ts: "💻", jsx: "💻", tsx: "💻", py: "💻", html: "💻", css: "💻",
  json: "🔧", xml: "🔧", yaml: "🔧", yml: "🔧",
};

/* ─── helpers ────────────────────────────────────────────── */
function safeUrl(url) {
  if (typeof url !== "string") return "";
  const trimmed = url.trim();
  if (!trimmed) return "";
  return trimmed.startsWith("http") ? trimmed : "https://" + trimmed;
}

function timeAgo(dateStr) {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function getFileExt(name = "") {
  return name.split(".").pop()?.toLowerCase() || "";
}

function getFileIcon(name) {
  return FILE_ICONS[getFileExt(name)] || "📁";
}

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function getStageFromStatus(reviewStatus, fileCount) {
  if (reviewStatus === "approved")            return "completed";
  if (reviewStatus === "pending" && fileCount > 0) return "in_review";
  if (reviewStatus === "revision_requested")  return "submitted";
  if (fileCount > 0)                           return "in_progress";
  return "not_started";
}

/* ─── sub-components ─────────────────────────────────────── */

/** Pulsing dot badge */
function PulseDot({ color = "var(--cyan)" }) {
  return (
    <span className="cpw-pulse-dot" style={{ "--dot-color": color }}>
      <span className="cpw-pulse-ring" />
    </span>
  );
}

/** Notification pill */
function NotifPill({ children, color }) {
  return (
    <span className="cpw-notif-pill" style={{ "--pill-color": color }}>
      {children}
    </span>
  );
}

/** Copy-to-clipboard button */
function CopyBtn({ text }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  };
  return (
    <button className="cpw-icon-btn cpw-copy-btn" onClick={copy} title="Copy link" type="button">
      {copied ? "✓" : "⎘"}
    </button>
  );
}

/** Confirm-modal overlay */
function ConfirmModal({ message, onConfirm, onCancel }) {
  return (
    <div className="cpw-modal-backdrop">
      <div className="cpw-modal">
        <p className="cpw-modal-msg">{message}</p>
        <div className="cpw-modal-actions">
          <button className="dd-bid-btn cpw-btn-confirm" type="button" onClick={onConfirm}>
            Yes, Approve
          </button>
          <button className="dd-bid-btn cpw-btn-cancel" type="button" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

/** Section header with optional badge */
function SectionTitle({ icon, title, badge, badgeColor }) {
  return (
    <div className="cpw-section-header">
      <span className="cpw-section-icon">{icon}</span>
      <h3 className="dd-card-title cpw-section-title">{title}</h3>
      {badge && <NotifPill color={badgeColor}>{badge}</NotifPill>}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   MAIN COMPONENT
══════════════════════════════════════════════════════════ */
export default function ClientProjectWorkspace({ project, onBack, onNavigateToMessages, onProjectUpdated }) {
  /* ── existing state (untouched) ─────────────────────────── */
  const [files,               setFiles]               = useState([]);
  const [deliverables,        setDeliverables]        = useState({ repoLink: "", demoLink: "", notes: "" });
  const [reviewFeedback,      setReviewFeedback]      = useState("");
  const [reviewStatus,        setReviewStatus]        = useState("pending");
  const [reviewLoading,       setReviewLoading]       = useState(false);
  const [reviewMessage,       setReviewMessage]       = useState("");
  const [loadingFiles,        setLoadingFiles]        = useState(false);
  const [loadingDeliverables, setLoadingDeliverables] = useState(false);
  const [error,               setError]               = useState("");
  const [submittedAt,         setSubmittedAt]         = useState(null);
  // ARCH-1 / BUG-M3 fix: track project status in local state so the status
  // badge reflects the live value (e.g. "Completed" after approval) rather
  // than the stale prop passed in from the parent dashboard.
  const [projectStatus,       setProjectStatus]       = useState(project?.status || "active");

  /* ── new state ──────────────────────────────────────────── */
  const [showApproveConfirm,  setShowApproveConfirm]  = useState(false);
  const [actionMessage,       setActionMessage]       = useState("");
  const [actionLoading,       setActionLoading]       = useState(null); // key of loading action
  const [isUrgent,            setIsUrgent]            = useState(false);
  const [hasNewUpdate,        setHasNewUpdate]        = useState(false);
  const [reviewHistory,       setReviewHistory]       = useState([]);
  const [totalSubmissions,    setTotalSubmissions]    = useState(0);
  const [developerStatus,     setDeveloperStatus]     = useState("offline"); // online/offline/away

  const statusMeta  = STATUS_META[projectStatus] || STATUS_META.draft;
  const token       = useMemo(() => localStorage.getItem("token"), []);
  const currentStage = getStageFromStatus(reviewStatus, files.length);

  const progressPct =
    reviewStatus === "approved"           ? 100 :
    reviewStatus === "pending"            ?  80 :
    files.length > 0                      ?  50 : 20;

  /* helper to flash an action message */
  const flashAction = useCallback((msg, ms = 3000) => {
    setActionMessage(msg);
    setTimeout(() => setActionMessage(""), ms);
  }, []);

  /* ── existing effects (untouched) ───────────────────────── */
  useEffect(() => {
    if (!project?.id) return;
    let cancelled = false;
    const fetchFiles = async () => {
      setLoadingFiles(true);
      setError("");
      try {
        const res = await apiRequest(`/projects/${project.id}/files`);
        if (!res.ok) throw new Error(`Failed to fetch files: ${res.status}`);
        const data = await res.json();
        if (!cancelled) setFiles(Array.isArray(data) ? data : []);
      } catch (e) {
        if (!cancelled) { console.error(e); setFiles([]); setError("Could not load project files."); }
      } finally {
        if (!cancelled) setLoadingFiles(false);
      }
    };
    fetchFiles();
    return () => { cancelled = true; };
  }, [project?.id, token]);

  useEffect(() => {
    if (!project?.id) return;
    let cancelled = false;
    const fetchDeliverables = async () => {
      setLoadingDeliverables(true);
      setError("");
      try {
        const res = await apiRequest(`/api/projects/${project.id}`);
        if (!res.ok) throw new Error(`Failed to fetch project deliverables: ${res.status}`);
        const found = await res.json();
        if (cancelled) return;
        setDeliverables({
          repoLink: safeUrl(found?.deliverable_link),
          demoLink: safeUrl(found?.demo_link),
          notes: typeof found?.submission_note === "string" ? found.submission_note : "",
        });
        setReviewStatus(found?.review_status || "pending");
        setSubmittedAt(found?.submitted_at ?? null);
        // ARCH-1 fix: sync local project status from the fresh fetch
        if (found?.status) setProjectStatus(found.status);
        // FIX #6 — is_urgent now persisted in DB; read it from the response
        setIsUrgent(found?.is_urgent ?? false);
        setTotalSubmissions(found?.submission_count ?? 0);
      } catch (e) {
        if (!cancelled) {
          console.error(e);
          setDeliverables({ repoLink: "", demoLink: "", notes: "" });
          setError("Could not load project deliverables.");
        }
      } finally {
        if (!cancelled) setLoadingDeliverables(false);
      }
    };
    fetchDeliverables();
    return () => { cancelled = true; };
  }, [project?.id, token]);

  useEffect(() => {
    if (!project?.id) return;

    const handleProjectSubmitted = async () => {
      try {
        const res = await apiRequest(`/api/projects/${project.id}`);
        if (!res.ok) return;
        const data = await res.json();
        setDeliverables({
          repoLink: safeUrl(data?.deliverable_link),
          demoLink: safeUrl(data?.demo_link),
          notes: typeof data?.submission_note === "string" ? data.submission_note : "",
        });
        setReviewStatus(data?.review_status || "pending");
        setSubmittedAt(data?.submitted_at ?? null);
        // new: flag new update
        setHasNewUpdate(true);
        // BUG-M8 fix: use the server-side count from the refetch instead of
        // blindly incrementing, which would double-count on reconnect replays
        // or when the developer has multiple tabs open.
        setTotalSubmissions(data?.submission_count ?? 0);
      } catch (err) {
        console.error("Failed to fetch updated deliverables", err);
      }
    };

    const handleProjectReviewed = async () => {
      const res = await apiRequest(`/api/projects/${project.id}`);
      if (!res.ok) return;
      const updated = await res.json();
      setDeliverables({
        repoLink: safeUrl(updated.deliverable_link),
        demoLink: safeUrl(updated.demo_link),
        notes: updated.submission_note || "",
      });
      setReviewStatus(updated.review_status);
      setSubmittedAt(updated?.submitted_at ?? null);
    };

    // ARCH-9/10 fix: refresh the file list when the developer deletes or
    // reorders files so the client sees the change in realtime.
    const handleWorkspaceActivityUpdated = async ({ eventType } = {}) => {
      if (eventType === "file_deleted" || eventType === "files_reordered" || eventType === "file_uploaded") {
        try {
          const res = await apiRequest(`/projects/${project.id}/files`);
          if (res.ok) setFiles(await res.json());
        } catch { /* non-critical */ }
      }
    };

    /* developer_status socket event removed — not emitted by server */

    // ARCH-8 fix: re-join the project room on socket reconnect so events are
    // not silently missed after a network blip.
    const handleReconnect = () => {
      socket.emit("join_project", project.id);
    };

    // BUG-C7 fix: register listeners BEFORE emitting join_project so no
    // events are missed during the async server-side room join.
    socket.on("project_submitted",          handleProjectSubmitted);
    socket.on("project_reviewed",           handleProjectReviewed);
    socket.on("workspace_activity_updated", handleWorkspaceActivityUpdated);
    socket.on("connect",                    handleReconnect);

    socket.emit("join_project", project.id);

    return () => {
      socket.off("project_submitted",          handleProjectSubmitted);
      socket.off("project_reviewed",           handleProjectReviewed);
      socket.off("workspace_activity_updated", handleWorkspaceActivityUpdated);
      socket.off("connect",                    handleReconnect);
    };
  }, [project?.id, token]);

  /* ── existing review submit (untouched) ─────────────────── */
  const handleSubmitReview = async (action) => {
    if (!project?.id) return;
    setReviewLoading(true);
    setError("");
    try {
      const res = await apiRequest(`/projects/${project.id}/review`, { method: "PUT", body: JSON.stringify({ action, feedback: reviewFeedback }) });
      if (!res.ok) throw new Error(`Failed to submit review: ${res.status}`);
      const data = await res.json();
      setReviewStatus(data.project.review_status);

      // BUG-M3 / ARCH-15 fix: refetch the full project so submittedAt,
      // deliverables, and totalSubmissions are all up-to-date. Also notify
      // the parent dashboard so its projects list reflects the new status
      // (e.g. "Active" → "Completed") without requiring a page refresh.
      try {
        const refreshRes = await apiRequest(`/api/projects/${project.id}`);
        if (refreshRes.ok) {
          const refreshed = await refreshRes.json();
          setDeliverables({
            repoLink: safeUrl(refreshed?.deliverable_link),
            demoLink: safeUrl(refreshed?.demo_link),
            notes: typeof refreshed?.submission_note === "string" ? refreshed.submission_note : "",
          });
          setSubmittedAt(refreshed?.submitted_at ?? null);
          setTotalSubmissions(refreshed?.submission_count ?? 0);
          // ARCH-1 fix: update local status so the badge flips immediately
          if (refreshed?.status) setProjectStatus(refreshed.status);
          if (onProjectUpdated) onProjectUpdated(refreshed);
        }
      } catch (refreshErr) {
        console.error("Failed to refresh project after review", refreshErr);
      }

      // push to local review history
      setReviewHistory(prev => [{
        action,
        feedback: reviewFeedback,
        at: new Date().toISOString(),
      }, ...prev]);
      setReviewFeedback("");
      setReviewMessage(action === "approve" ? "✓ Project approved" : "Revision request sent");
      setTimeout(() => setReviewMessage(""), 3000);
    } catch (e) {
      console.error(e);
      setError("Failed to submit review");
    } finally {
      setReviewLoading(false);
    }
  };

  /* ── quick-action handlers ──────────────────────────── */
  const handleQuickAction = async (actionKey) => {
    setActionLoading(actionKey);
    try {
      if (actionKey === "message") {
        // Navigate to messages section and open this project's conversation
        if (onNavigateToMessages) {
          onNavigateToMessages(project.id);
        } else {
          flashAction("💬 Go to the Messages section to chat with your developer.");
        }
      }

      if (actionKey === "request_update") {
        // FIX #3 — use the dedicated /request-update endpoint (no longer aliases to revision)
        const res = await apiRequest(`/projects/${project.id}/request-update`, {
          method: "POST",
          body: JSON.stringify({ feedback: "Client requested a status update." }),
        });
        if (res.ok) {
          flashAction("📣 Update requested — developer has been notified.");
        } else {
          flashAction("Failed to send update request.");
        }
      }

      if (actionKey === "urgent") {
        const next = !isUrgent;
        // FIX #6 — persist is_urgent to the database via a dedicated PATCH
        const res = await apiRequest(`/projects/${project.id}/urgent`, {
          method: "PATCH",
          body: JSON.stringify({ is_urgent: next }),
        });
        if (res.ok) {
          setIsUrgent(next);
          if (next) {
            flashAction("🚨 Marked as urgent — developer notified.");
          } else {
            flashAction("🔕 Urgency flag removed.");
          }
        } else {
          flashAction("Failed to update urgency flag.");
        }
      }

      if (actionKey === "reopen") {
        // FIX #15 — reopen uses the review endpoint with action:"revision" but
        // the backend now records it as a proper revision_requested event with
        // clear feedback so it's distinguishable in the timeline
        const res = await apiRequest(`/projects/${project.id}/review`, {
          method: "PUT",
          body: JSON.stringify({ action: "revision", feedback: "Client has requested additional work. Please resubmit when ready." }),
        });
        if (res.ok) {
          setReviewStatus("revision_requested");
          flashAction("🔄 Project reopened — developer has been notified.");
        } else {
          flashAction("Failed to reopen project.");
        }
      }
    } finally {
      setActionLoading(null);
    }
  };

  /* ── derived display values ─────────────────────────────── */
  const devName     = project?.developer_name || project?.assignedDeveloper || null;
  const devInitials = devName ? devName.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase() : "?";
  const devOnline   = developerStatus === "online";
  const awaitingReview = reviewStatus === "pending" && (deliverables.repoLink || deliverables.demoLink || deliverables.notes);

  if (!project) return null;

  /* ══════════════════════════════════════════════════════════
     RENDER
  ══════════════════════════════════════════════════════════ */
  return (
    <div className="dd-content dd-workspace cpw-root">

      {/* ── CONFIRM MODAL ─────────────────────────────────── */}
      {showApproveConfirm && (
        <ConfirmModal
          message="Are you sure you want to approve this project? This action marks the project as complete."
          onConfirm={() => { setShowApproveConfirm(false); handleSubmitReview("approve"); }}
          onCancel={() => setShowApproveConfirm(false)}
        />
      )}

      {/* ── HEADER ─────────────────────────────────────────── */}
      <div className="dd-card dd-workspace-header" style={{ "--ci": 0 }}>
        <div className="dd-workspace-top">
          <button className="dd-bid-btn dd-workspace-back" onClick={onBack}>
            ← Back to Projects
          </button>
        </div>

        <div className="dd-workspace-title-row">
          <div className="cpw-title-group">
            <h2 className="dd-card-title">
              {project.title}
              {isUrgent && <span className="cpw-urgent-badge">🚨 URGENT</span>}
            </h2>
            {hasNewUpdate && (
              <span className="cpw-new-update-banner" onClick={() => setHasNewUpdate(false)}>
                <PulseDot color="var(--cyan)" />
                New update from developer — click to dismiss
              </span>
            )}
          </div>

          <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
            <span className={`dd-status ${statusMeta.cls}`}>{statusMeta.label}</span>
            <span className={`dd-status ${reviewStatus}`}>
              {reviewStatus === "pending"             ? "Under Review"
               : reviewStatus === "revision_requested" ? "Changes Requested"
               :                                         "Approved"}
            </span>
            {awaitingReview && <NotifPill color="var(--amber, #f59e0b)">Awaiting your review</NotifPill>}
          </div>
        </div>

        {/* ── SUMMARY STRIP ─────────────────────────────────── */}
        <div className="cpw-summary-strip">
          <div className="cpw-summary-item">
            <span className="cpw-summary-label">Budget</span>
            <span className="cpw-summary-value">
              {project.budget ?? `₹${project.min_budget ?? 0}–₹${project.max_budget ?? 0}`}
            </span>
          </div>
          <div className="cpw-summary-sep" />
          <div className="cpw-summary-item">
            <span className="cpw-summary-label">Due</span>
            <span className="cpw-summary-value">
              {project.due_date ? new Date(project.due_date).toLocaleDateString() : "N/A"}
            </span>
          </div>
          <div className="cpw-summary-sep" />
          <div className="cpw-summary-item">
            <span className="cpw-summary-label">Submissions</span>
            <span className="cpw-summary-value">{totalSubmissions}</span>
          </div>
          <div className="cpw-summary-sep" />
          <div className="cpw-summary-item">
            <span className="cpw-summary-label">Last Update</span>
            <span className="cpw-summary-value">
              {submittedAt ? timeAgo(submittedAt) : "—"}
            </span>
          </div>
          <div className="cpw-summary-sep" />
          <div className="cpw-summary-item">
            <span className="cpw-summary-label">Review</span>
            <span className={`cpw-summary-value cpw-rv-${reviewStatus}`}>
              {reviewStatus === "approved" ? "✓ Approved"
               : reviewStatus === "revision_requested" ? "↩ Revision"
               : "⏳ Pending"}
            </span>
          </div>
        </div>
      </div>

      {/* ── PROGRESS STAGES ─────────────────────────────────── */}
      <div className="cpw-stage-bar-card dd-card" style={{ "--ci": 0.5 }}>
        <div className="cpw-stage-bar">
          {PROGRESS_STAGES.map((s, i) => {
            const stageIdx    = PROGRESS_STAGES.findIndex(x => x.key === currentStage);
            const thisIdx     = i;
            const isDone      = thisIdx < stageIdx;
            const isCurrent   = thisIdx === stageIdx;
            return (
              <div key={s.key} className="cpw-stage-item">
                <div className={`cpw-stage-dot ${isDone ? "done" : isCurrent ? "current" : ""}`}>
                  {isDone ? "✓" : thisIdx + 1}
                </div>
                <span className={`cpw-stage-label ${isCurrent ? "current" : ""}`}>{s.label}</span>
                {i < PROGRESS_STAGES.length - 1 && (
                  <div className={`cpw-stage-line ${isDone ? "done" : ""}`} />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── BODY ────────────────────────────────────────────── */}
      <div className="dd-workspace-body">

        {/* ════ LEFT COLUMN ══════════════════════════════════ */}
        <div className="dd-workspace-left">

          {/* Description */}
          <div className="dd-card" style={{ "--ci": 1 }}>
            <SectionTitle icon="📋" title="Project Description" />
            <p className="dd-card-desc dd-workspace-description">
              {project.description || "No description provided yet."}
            </p>
          </div>

          {/* Tags */}
          <div className="dd-card" style={{ "--ci": 2 }}>
            <SectionTitle icon="🏷️" title="Tags" />
            <div className="dd-card-tags">
              {project.tags?.length ? (
                project.tags.map((tag, idx) => (
                  <span key={`${tag}-${idx}`} className="dd-tag" style={{ "--ci": idx }}>{tag}</span>
                ))
              ) : (
                <span className="dd-card-desc">No tags</span>
              )}
            </div>
          </div>

          {/* Developer Panel */}
          <div className="dd-card cpw-dev-card" style={{ "--ci": 3 }}>
            <SectionTitle icon="👤" title="Assigned Developer"
              badge={devOnline ? "Online" : undefined}
              badgeColor={devOnline ? "var(--cyan)" : undefined}
            />
            {devName ? (
              <div className="cpw-dev-panel">
                <div className="cpw-dev-avatar">
                  <span>{devInitials}</span>
                  <span className={`cpw-dev-status-dot ${developerStatus}`} title={developerStatus} />
                </div>
                <div className="cpw-dev-info">
                  <span className="cpw-dev-name">{devName}</span>
                  <span className="cpw-dev-role">Developer</span>
                  <span className="cpw-dev-lastactive">
                    {devOnline ? "● Online now" : "● Last seen: recently"}
                  </span>
                </div>
              </div>
            ) : (
              <div className="cpw-dev-empty">
                <span className="cpw-dev-empty-icon">🔍</span>
                <p className="dd-card-desc">No developer assigned yet. Accept a bid to assign one.</p>
              </div>
            )}
          </div>

          {/* Activity Feed */}
          <div className="dd-card" style={{ "--ci": 4 }}>
            <SectionTitle
              icon="📡"
              title="Workspace Activity"
              badge={hasNewUpdate ? "New" : undefined}
              badgeColor="var(--cyan)"
            />
            <SubmissionHistory projectId={project.id} token={token} isClient={true} />
          </div>

        </div>

        {/* ════ RIGHT COLUMN ═════════════════════════════════ */}
        <div className="dd-workspace-actions">

          {/* Quick Actions */}
          <div className="dd-card cpw-actions-card" style={{ "--ci": 4 }}>
            <SectionTitle icon="⚡" title="Quick Actions" />
            <div className="cpw-quick-actions">

              <button
                className="cpw-action-btn"
                type="button"
                onClick={() => handleQuickAction("message")}
                disabled={actionLoading === "message"}
              >
                <span className="cpw-action-icon">💬</span>
                <span className="cpw-action-text">
                  <strong>Message Developer</strong>
                  <small>Send a direct message</small>
                </span>
                {actionLoading === "message" && <span className="cpw-spinner" />}
              </button>

              <button
                className="cpw-action-btn"
                type="button"
                onClick={() => handleQuickAction("request_update")}
                disabled={actionLoading === "request_update"}
              >
                <span className="cpw-action-icon">📣</span>
                <span className="cpw-action-text">
                  <strong>Request Update</strong>
                  <small>Ping developer for status</small>
                </span>
                {actionLoading === "request_update" && <span className="cpw-spinner" />}
              </button>

              <button
                className={`cpw-action-btn ${isUrgent ? "cpw-action-btn--urgent" : ""}`}
                type="button"
                onClick={() => handleQuickAction("urgent")}
                disabled={actionLoading === "urgent"}
              >
                <span className="cpw-action-icon">{isUrgent ? "🔕" : "🚨"}</span>
                <span className="cpw-action-text">
                  <strong>{isUrgent ? "Remove Urgent Flag" : "Mark as Urgent"}</strong>
                  <small>{isUrgent ? "Cancel urgency status" : "Notify developer ASAP"}</small>
                </span>
              </button>

              {reviewStatus === "approved" && (
                <button
                  className="cpw-action-btn"
                  type="button"
                  onClick={() => handleQuickAction("reopen")}
                  disabled={actionLoading === "reopen"}
                >
                  <span className="cpw-action-icon">🔄</span>
                  <span className="cpw-action-text">
                    <strong>Reopen Project</strong>
                    <small>Request additional work</small>
                  </span>
                </button>
              )}
            </div>

            {actionMessage && (
              <div className="cpw-action-toast">{actionMessage}</div>
            )}
          </div>

          {/* Files */}
          <div className="dd-card" style={{ "--ci": 5 }}>
            <SectionTitle icon="📁" title="Files"
              badge={files.length > 0 ? `${files.length}` : undefined}
              badgeColor="var(--violet)"
            />
            <p className="dd-card-desc">
              {loadingFiles ? "Loading files…"
               : files.length ? `${files.length} file${files.length > 1 ? "s" : ""} uploaded.`
               : "No files yet — waiting for developer submission."}
            </p>

            {files.length > 0 && (
              <div className="dd-file-list">
                {files.map((file) => {
                  const ext  = getFileExt(file.file_name);
                  const icon = getFileIcon(file.file_name);
                  const size = formatBytes(file.size);
                  return (
                    <div key={file.id ?? file.file_name} className="dd-file-item cpw-file-item">
                      <span className="cpw-file-type-icon">{icon}</span>
                      <div className="cpw-file-info">
                        <a
                          href={`${API_BASE_URL}/uploads/${file.file_name}`}
                          target="_blank"
                          rel="noreferrer"
                          className="dd-file-link"
                        >
                          {file.file_name}
                        </a>
                        <div className="cpw-file-meta-row">
                          {ext && <span className="cpw-file-ext-badge">.{ext}</span>}
                          {size && <span className="cpw-file-size">{size}</span>}
                        </div>
                      </div>
                      <a
                        className="dd-bid-btn cpw-dl-btn"
                        href={`${API_BASE_URL}/uploads/${file.file_name}`}
                        download
                        title="Download"
                      >
                        ↓
                      </a>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Deliverables */}
          <div className="dd-card" style={{ "--ci": 6 }}>
            <SectionTitle icon="🚀" title="Deliverables"
              badge={submittedAt ? "Updated " + timeAgo(submittedAt) : undefined}
              badgeColor="var(--violet)"
            />

            {loadingDeliverables ? (
              <p className="dd-card-desc">Loading deliverables…</p>
            ) : !deliverables.repoLink && !deliverables.demoLink && !deliverables.notes ? (
              <div className="cpw-empty-state">
                <span className="cpw-empty-icon">📭</span>
                <p>No deliverables submitted yet.</p>
              </div>
            ) : (
              <div className="cpw-deliverables">
                {deliverables.repoLink && (
                  <div className="cpw-deliverable-row">
                    <span className="cpw-del-icon">⬡</span>
                    <div className="cpw-del-info">
                      <span className="cpw-del-label">Repository</span>
                      <a href={deliverables.repoLink} target="_blank" rel="noreferrer" className="cpw-del-link">
                        Open Repo ↗
                      </a>
                    </div>
                    <CopyBtn text={deliverables.repoLink} />
                  </div>
                )}
                {deliverables.demoLink && (
                  <div className="cpw-deliverable-row">
                    <span className="cpw-del-icon">▶</span>
                    <div className="cpw-del-info">
                      <span className="cpw-del-label">Live Demo</span>
                      <a href={deliverables.demoLink} target="_blank" rel="noreferrer" className="cpw-del-link">
                        Preview Demo ↗
                      </a>
                    </div>
                    <CopyBtn text={deliverables.demoLink} />
                  </div>
                )}
                {deliverables.notes && (
                  <div className="cpw-notes-box">
                    <span className="cpw-notes-label">Developer Notes</span>
                    <p className="cpw-notes-text">{deliverables.notes}</p>
                  </div>
                )}
                {submittedAt && (
                  <div className="cpw-submitted-at">
                    Submitted {timeAgo(submittedAt)} · {new Date(submittedAt).toLocaleString()}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Review & Approval */}
          <div className="dd-card cpw-review-card" style={{ "--ci": 7 }}>
            <SectionTitle icon="✅" title="Review & Approval" />

            {/* Review status indicator */}
            <div className={`cpw-review-state cpw-review-state--${reviewStatus}`}>
              <span className="cpw-review-state-dot" />
              <span className="cpw-review-state-label">
                {reviewStatus === "approved"
                  ? "Project Approved — all done!"
                  : reviewStatus === "revision_requested"
                  ? "Revision Requested — awaiting developer response"
                  : "Pending Review — awaiting your decision"}
              </span>
            </div>

            {reviewStatus !== "approved" && (
              <>
                <textarea
                  className="dd-input"
                  placeholder="Feedback for developer (e.g., requested changes, improvements)..."
                  value={reviewFeedback}
                  onChange={(e) => setReviewFeedback(e.target.value)}
                  style={{ minHeight: "100px", marginTop: "12px" }}
                  disabled={reviewLoading}
                />

                <div className="cpw-review-btns">
                  <button
                    className="dd-bid-btn cpw-btn-approve"
                    type="button"
                    onClick={() => setShowApproveConfirm(true)}
                    disabled={reviewLoading}
                  >
                    {reviewLoading ? "Processing…" : "✓ Approve Project"}
                  </button>
                  <button
                    className="dd-bid-btn cpw-btn-revision"
                    type="button"
                    onClick={() => handleSubmitReview("revision")}
                    disabled={reviewLoading}
                  >
                    {reviewLoading ? "Processing…" : "↩ Request Changes"}
                  </button>
                </div>
              </>
            )}

            {reviewMessage && (
              <p className="dd-card-desc cpw-review-toast" style={{ marginTop: "10px" }}>{reviewMessage}</p>
            )}
            {error && (
              <p className="dd-card-desc cpw-error" style={{ marginTop: "10px" }}>{error}</p>
            )}

            {/* Review history */}
            {reviewHistory.length > 0 && (
              <div className="cpw-review-history">
                <span className="cpw-rh-title">Review History</span>
                {reviewHistory.map((r, i) => (
                  <div key={i} className="cpw-rh-item">
                    <span className={`cpw-rh-action ${r.action === "approve" ? "approve" : "revision"}`}>
                      {r.action === "approve" ? "✓ Approved" : "↩ Changes Requested"}
                    </span>
                    <span className="cpw-rh-time">{timeAgo(r.at)}</span>
                    {r.feedback && <p className="cpw-rh-feedback">{r.feedback}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Progress */}
          <div className="dd-card" style={{ "--ci": 8 }}>
            <SectionTitle icon="📈" title="Progress" />
            <div className="dd-workspace-progress" aria-label={`Progress: ${progressPct}%`}>
              <div className="dd-workspace-progress-fill" style={{ width: `${progressPct}%` }} />
            </div>
            <div className="cpw-progress-pct">{progressPct}% complete</div>
          </div>

        </div>
      </div>
    </div>
  );
}