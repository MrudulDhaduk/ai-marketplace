/**
 * TimelineEventCard.jsx
 * Renders a single workspace activity event in the timeline.
 * Handles all event types, approval actions (client-only), and threaded comments.
 */
import React, { useState, useCallback } from "react";
import { apiRequest } from "../../../lib/api";
import "./TimelineEventCard.css";

/* ─── Event type config ─────────────────────────────────────────────────────── */
export const EVENT_CONFIG = {
  submission_added:   { icon: "🚀", label: "Submission",       color: "var(--cyan)",    badge: "Submission",  canApprove: true  },
  note_added:         { icon: "📝", label: "Progress Note",    color: "var(--violet)",  badge: "Note",        canApprove: false },
  note_updated:       { icon: "✏️", label: "Note Updated",     color: "var(--violet)",  badge: "Edited",      canApprove: false },
  note_deleted:       { icon: "🗑️", label: "Note Deleted",     color: "#94a3b8",        badge: "Deleted",     canApprove: false },
  file_uploaded:      { icon: "📤", label: "Files Uploaded",   color: "#4ade80",        badge: "Files",       canApprove: false },
  file_deleted:       { icon: "🗑️", label: "File Deleted",     color: "#f87171",        badge: "Deleted",     canApprove: false },
  bid_placed:         { icon: "💰", label: "Bid Placed",       color: "#fbbf24",        badge: "Bid",         canApprove: false },
  bid_accepted:       { icon: "🤝", label: "Bid Accepted",     color: "#fbbf24",        badge: "System",      canApprove: false },
  project_assigned:   { icon: "👤", label: "Developer Assigned", color: "#fbbf24",      badge: "System",      canApprove: false },
  project_approved:   { icon: "✅", label: "Project Approved", color: "#4ade80",        badge: "Approved",    canApprove: false },
  revision_requested: { icon: "↩️", label: "Revision Requested", color: "#f87171",      badge: "Revision",    canApprove: false },
  update_requested:   { icon: "📣", label: "Update Requested", color: "#fbbf24",        badge: "Ping",        canApprove: false },
  repo_updated:       { icon: "⬡",  label: "Repo Updated",    color: "var(--cyan)",    badge: "Repo",        canApprove: false },
  demo_updated:       { icon: "▶",  label: "Demo Updated",    color: "var(--cyan)",    badge: "Demo",        canApprove: false },
  project_urgent:     { icon: "🚨", label: "Marked Urgent",   color: "#f87171",        badge: "Urgent",      canApprove: false },
  project_unurgent:   { icon: "🔕", label: "Urgency Removed", color: "#94a3b8",        badge: "System",      canApprove: false },
  status_changed:     { icon: "🔄", label: "Status Changed",  color: "#fbbf24",        badge: "System",      canApprove: false },
};

const DEFAULT_CONFIG = { icon: "📌", label: "Activity", color: "var(--text-2)", badge: "Event", canApprove: false };

/* ─── helpers ───────────────────────────────────────────────────────────────── */
function timeAgo(iso) {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function formatFull(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-IN", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

/* ─── Approval badge ────────────────────────────────────────────────────────── */
function ApprovalBadge({ status }) {
  if (!status) return null;
  const map = {
    approved:           { label: "✓ Approved",          cls: "tec-approval--approved"  },
    revision_requested: { label: "↩ Revision Requested", cls: "tec-approval--revision"  },
    resolved:           { label: "✓ Resolved",           cls: "tec-approval--resolved"  },
  };
  const cfg = map[status];
  if (!cfg) return null;
  return <span className={`tec-approval-badge ${cfg.cls}`}>{cfg.label}</span>;
}

/* ─── Event body renderer ───────────────────────────────────────────────────── */
function EventBody({ event }) {
  const meta = event.meta || {};

  switch (event.event_type) {
    case "submission_added":
      return (
        <div className="tec-body">
          {meta.repoLink && (
            <a href={meta.repoLink} target="_blank" rel="noreferrer" className="tec-link">
              ⬡ Open Repository ↗
            </a>
          )}
          {meta.demoLink && (
            <a href={meta.demoLink} target="_blank" rel="noreferrer" className="tec-link">
              ▶ Live Demo ↗
            </a>
          )}
        </div>
      );

    case "note_added":
    case "note_updated":
      return meta.notes ? (
        <div className="tec-body">
          <p className="tec-note-text">{meta.notes}</p>
        </div>
      ) : null;

    case "file_uploaded":
      return (
        <div className="tec-body">
          <span className="tec-file-count">
            {meta.count || 1} file{(meta.count || 1) !== 1 ? "s" : ""} uploaded
          </span>
          {Array.isArray(meta.files) && meta.files.length > 0 && (
            <div className="tec-file-chips">
              {meta.files.slice(0, 4).map((f, i) => (
                <span key={i} className="tec-file-chip">{f.split("_").slice(0, -1).join("_") || f}</span>
              ))}
              {meta.files.length > 4 && (
                <span className="tec-file-chip tec-file-chip--more">+{meta.files.length - 4} more</span>
              )}
            </div>
          )}
        </div>
      );

    case "bid_accepted":
      return (
        <div className="tec-body">
          <span className="tec-system-text">Developer assigned to project</span>
        </div>
      );

    case "project_approved":
      return (
        <div className="tec-body">
          <span className="tec-system-text tec-system-text--success">Project marked as complete 🎉</span>
        </div>
      );

    case "revision_requested":
      return meta.feedback ? (
        <div className="tec-body">
          <p className="tec-note-text tec-note-text--revision">{meta.feedback}</p>
        </div>
      ) : null;

    case "project_urgent":
      return (
        <div className="tec-body">
          <span className="tec-system-text tec-system-text--urgent">🚨 Client marked this project as urgent</span>
        </div>
      );

    default:
      return null;
  }
}

/* ─── Threaded comment ──────────────────────────────────────────────────────── */
function CommentItem({ comment }) {
  const isClient = comment.author_role === "client";
  return (
    <div className={`tec-comment ${isClient ? "tec-comment--client" : "tec-comment--dev"}`}>
      <div className="tec-comment-avatar">
        {(comment.author_name || "?")[0].toUpperCase()}
      </div>
      <div className="tec-comment-body">
        <div className="tec-comment-meta">
          <span className="tec-comment-author">{comment.author_name || "Unknown"}</span>
          <span className="tec-comment-role">{isClient ? "Client" : "Developer"}</span>
          <span className="tec-comment-time">{timeAgo(comment.created_at)}</span>
        </div>
        <p className="tec-comment-text">{comment.body}</p>
      </div>
    </div>
  );
}

/* ─── Main component ────────────────────────────────────────────────────────── */
export default function TimelineEventCard({
  event,
  isLatest,
  isClient,
  projectId,
  onEntryUpdated,
  animDelay = 0,
}) {
  const cfg = EVENT_CONFIG[event.event_type] || DEFAULT_CONFIG;

  const [showComments,   setShowComments]   = useState(false);
  const [comments,       setComments]       = useState([]);
  const [loadingComments, setLoadingComments] = useState(false);
  const [commentInput,   setCommentInput]   = useState("");
  const [submittingComment, setSubmittingComment] = useState(false);
  const [approvalLoading, setApprovalLoading] = useState(null);
  const [approvalFeedback, setApprovalFeedback] = useState("");
  const [showApprovalForm, setShowApprovalForm] = useState(false);
  const [localApproval,  setLocalApproval]  = useState({
    status:   event.approval_status   || null,
    feedback: event.approval_feedback || null,
  });

  /* ── load comments ── */
  const loadComments = useCallback(async () => {
    if (loadingComments) return;
    setLoadingComments(true);
    try {
      const res = await apiRequest(`/projects/${projectId}/activity/${event.id}/comments`);
      if (res.ok) setComments(await res.json());
    } catch { /* silent */ }
    finally { setLoadingComments(false); }
  }, [projectId, event.id, loadingComments]);

  const toggleComments = () => {
    if (!showComments && comments.length === 0) loadComments();
    setShowComments((v) => !v);
  };

  /* ── add comment ── */
  const handleAddComment = async () => {
    if (!commentInput.trim() || submittingComment) return;
    setSubmittingComment(true);
    try {
      const res = await apiRequest(`/projects/${projectId}/activity/${event.id}/comments`, {
        method: "POST",
        body: JSON.stringify({ body: commentInput.trim() }),
      });
      if (res.ok) {
        const data = await res.json();
        setComments((prev) => [...prev, data.comment]);
        setCommentInput("");
      }
    } catch { /* silent */ }
    finally { setSubmittingComment(false); }
  };

  /* ── approval actions ── */
  const handleApproval = async (action) => {
    setApprovalLoading(action);
    try {
      const res = await apiRequest(`/projects/${projectId}/activity/${event.id}/${action}`, {
        method: "POST",
        body: JSON.stringify({ feedback: approvalFeedback.trim() || null }),
      });
      if (res.ok) {
        const newStatus = action === "approve" ? "approved" : action === "revision" ? "revision_requested" : "resolved";
        setLocalApproval({ status: newStatus, feedback: approvalFeedback.trim() || null });
        setShowApprovalForm(false);
        setApprovalFeedback("");
        if (onEntryUpdated) onEntryUpdated(event.id, newStatus);
      }
    } catch { /* silent */ }
    finally { setApprovalLoading(null); }
  };

  // BUG-M9 fix: once comments have been loaded locally, use comments.length
  // as the authoritative count. Fall back to event.comment_count only when
  // the thread hasn't been opened yet (comments array is still empty and
  // we haven't fetched). This prevents the stale event.comment_count from
  // overriding the live local count after a comment is added.
  const commentCount = showComments || comments.length > 0
    ? comments.length
    : (event.comment_count || 0);

  return (
    <div
      className={`tec-item${isLatest ? " tec-item--latest" : ""}`}
      style={{ "--tec-color": cfg.color, "--tec-delay": `${animDelay}s` }}
    >
      {/* ── Node column ── */}
      <div className="tec-node-col">
        <div className={`tec-node${isLatest ? " tec-node--latest" : ""}`}>
          <span className="tec-node-icon">{cfg.icon}</span>
        </div>
        <div className="tec-connector" />
      </div>

      {/* ── Card ── */}
      <div className="tec-card">
        {/* Header */}
        <div className="tec-card-head">
          <div className="tec-head-left">
            <div className="tec-title-row">
              <span className="tec-event-label">{cfg.label}</span>
              <span className="tec-type-badge" style={{ "--badge-color": cfg.color }}>
                {cfg.badge}
              </span>
              {isLatest && <span className="tec-latest-badge">Latest</span>}
              <ApprovalBadge status={localApproval.status} />
            </div>
            <div className="tec-meta-row">
              <span className="tec-actor">
                <span className="tec-actor-avatar">
                  {(event.actor_name || "?")[0].toUpperCase()}
                </span>
                {event.actor_name || "Unknown"}
                <span className="tec-actor-role">
                  {event.actor_role === "client" ? "· Client" : "· Developer"}
                </span>
              </span>
              <span className="tec-dot">·</span>
              <span className="tec-time" title={formatFull(event.created_at)}>
                {timeAgo(event.created_at)}
              </span>
            </div>
          </div>

          {/* Client approval actions — only on approvable events */}
          {isClient && cfg.canApprove && !localApproval.status && (
            <button
              className="tec-review-trigger"
              onClick={() => setShowApprovalForm((v) => !v)}
              title="Review this entry"
            >
              Review
            </button>
          )}
        </div>

        {/* Event body */}
        <EventBody event={{ ...event, meta: event.meta || {} }} />

        {/* Approval feedback display */}
        {localApproval.status && localApproval.feedback && (
          <div className={`tec-approval-feedback tec-approval-feedback--${localApproval.status}`}>
            <span className="tec-approval-feedback-label">
              {localApproval.status === "approved" ? "Approval note" : "Revision feedback"}:
            </span>
            <p>{localApproval.feedback}</p>
          </div>
        )}

        {/* Approval form (client only) */}
        {isClient && showApprovalForm && (
          <div className="tec-approval-form">
            <textarea
              className="tec-approval-textarea"
              placeholder="Optional feedback for developer…"
              value={approvalFeedback}
              onChange={(e) => setApprovalFeedback(e.target.value)}
              rows={2}
            />
            <div className="tec-approval-btns">
              <button
                className="tec-btn tec-btn--approve"
                onClick={() => handleApproval("approve")}
                disabled={!!approvalLoading}
              >
                {approvalLoading === "approve" ? "…" : "✓ Approve"}
              </button>
              <button
                className="tec-btn tec-btn--revision"
                onClick={() => handleApproval("revision")}
                disabled={!!approvalLoading}
              >
                {approvalLoading === "revision" ? "…" : "↩ Request Revision"}
              </button>
              <button
                className="tec-btn tec-btn--cancel"
                onClick={() => { setShowApprovalForm(false); setApprovalFeedback(""); }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Resolve button for developer when revision requested */}
        {!isClient && localApproval.status === "revision_requested" && (
          <button
            className="tec-btn tec-btn--resolve"
            onClick={() => handleApproval("resolve")}
            disabled={approvalLoading === "resolve"}
          >
            {approvalLoading === "resolve" ? "…" : "✓ Mark Resolved"}
          </button>
        )}

        {/* Thread toggle */}
        <div className="tec-thread-bar">
          <button className="tec-thread-toggle" onClick={toggleComments}>
            <span className="tec-thread-icon">💬</span>
            {commentCount > 0
              ? `${commentCount} comment${commentCount !== 1 ? "s" : ""}`
              : "Add comment"}
            <span className={`tec-thread-chevron ${showComments ? "open" : ""}`}>›</span>
          </button>
        </div>

        {/* Thread */}
        {showComments && (
          <div className="tec-thread">
            {loadingComments && (
              <div className="tec-thread-loading">Loading…</div>
            )}
            {!loadingComments && comments.map((c) => (
              <CommentItem key={c.id} comment={c} />
            ))}
            {!loadingComments && comments.length === 0 && (
              <p className="tec-thread-empty">No comments yet. Be the first.</p>
            )}

            {/* Comment input */}
            <div className="tec-comment-input-row">
              <input
                className="tec-comment-input"
                placeholder="Write a comment…"
                value={commentInput}
                onChange={(e) => setCommentInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleAddComment(); } }}
                maxLength={2000}
              />
              <button
                className="tec-comment-send"
                onClick={handleAddComment}
                disabled={!commentInput.trim() || submittingComment}
              >
                {submittingComment ? "…" : "↑"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
