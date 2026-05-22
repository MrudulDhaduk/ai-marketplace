import React from "react";
import { timeAgo } from "../../../utils/time";

/* ─── helpers ────────────────────────────────────────────── */

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

/* ─── STATUS_META (client variant) ──────────────────────── */
const STATUS_META = {
  active:    { label: "Active",    cls: "active"    },
  review:    { label: "In Review", cls: "review"    },
  completed: { label: "Completed", cls: "completed" },
  draft:     { label: "Draft",     cls: "draft"     },
};

/* ══════════════════════════════════════════════════════════
   WorkspaceHeader
   variant="client" (default) | variant="developer"

   Common props:
     project, projectDetail, reviewStatus, isUrgent,
     hasNewUpdate, onBack, onDismissUpdate

   Developer-only additional props:
     files, submissionCount, daysLeft, dueBadgeClass,
     nextAction, versionLabel
══════════════════════════════════════════════════════════ */
const WorkspaceHeader = React.memo(function WorkspaceHeader({
  /* common */
  project,
  projectDetail,
  reviewStatus,
  isUrgent,
  hasNewUpdate,
  onBack,
  onDismissUpdate,
  variant = "client",
  /* developer-variant extras */
  files,
  submissionCount: submissionCountProp,
  daysLeft,
  dueBadgeClass,
  nextAction,
  versionLabel,
}) {
  if (!project) return null;

  /* ── shared derived values ─────────────────────────────── */
  // submissionCount: prefer explicit prop (developer variant passes it),
  // fall back to projectDetail (client variant)
  const submissionCount =
    submissionCountProp !== undefined
      ? submissionCountProp
      : (projectDetail?.submission_count ?? 0);
  const submittedAt = projectDetail?.submitted_at ?? null;

  /* ── client-variant derived values ────────────────────── */
  const projectStatus = projectDetail?.status ?? project?.status ?? "active";
  const statusMeta    = STATUS_META[projectStatus] || STATUS_META.draft;
  const awaitingReview =
    reviewStatus === "pending" &&
    (projectDetail?.deliverable_link ||
      projectDetail?.demo_link ||
      projectDetail?.submission_note);

  /* ══════════════════════════════════════════════════════
     CLIENT VARIANT
  ══════════════════════════════════════════════════════ */
  if (variant === "client") {
    return (
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
              <span
                className="cpw-new-update-banner"
                onClick={onDismissUpdate}
              >
                <PulseDot color="var(--cyan)" />
                New update from developer — click to dismiss
              </span>
            )}
          </div>

          <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
            <span className={`dd-status ${statusMeta.cls}`}>{statusMeta.label}</span>
            <span className={`dd-status ${reviewStatus}`}>
              {reviewStatus === "pending"
                ? "Under Review"
                : reviewStatus === "revision_requested"
                ? "Changes Requested"
                : "Approved"}
            </span>
            {awaitingReview && (
              <NotifPill color="var(--amber, #f59e0b)">Awaiting your review</NotifPill>
            )}
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
              {project.due_date
                ? new Date(project.due_date).toLocaleDateString()
                : "N/A"}
            </span>
          </div>
          <div className="cpw-summary-sep" />
          <div className="cpw-summary-item">
            <span className="cpw-summary-label">Submissions</span>
            <span className="cpw-summary-value">{submissionCount}</span>
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
              {reviewStatus === "approved"
                ? "✓ Approved"
                : reviewStatus === "revision_requested"
                ? "↩ Revision"
                : "⏳ Pending"}
            </span>
          </div>
        </div>
      </div>
    );
  }

  /* ══════════════════════════════════════════════════════
     DEVELOPER VARIANT
     daysLeft, dueBadgeClass, nextAction are passed as props
     from DeveloperProjectWorkspace (computed there from
     local state like repoLink which WorkspaceHeader can't see)
  ══════════════════════════════════════════════════════ */
  const fileCount = Array.isArray(files) ? files.length : 0;

  return (
    <div className="dd-card dd-workspace-header" style={{ "--ci": 0 }}>
      <div className="dd-workspace-top">
        <button className="dd-bid-btn dd-workspace-back" onClick={onBack}>
          ← Back to My Projects
        </button>
      </div>

      <div className="dd-workspace-title-row">
        <div>
          <h2 className="dd-card-title">{project.title}</h2>
          {project.client_name && (
            <p className="dd-workspace-client">
              <span className="dd-client-dot">●</span> Client:{" "}
              <strong>{project.client_name}</strong>
            </p>
          )}
        </div>
        <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
          <span
            className={`dd-status ${
              project.status === "active" ? "active" : "completed"
            }`}
          >
            {project.status === "active" ? "🟢 Active" : "✅ Completed"}
          </span>
          {reviewStatus === "revision_requested" && (
            <span className="dd-status review">↩ Revision Needed</span>
          )}
          {reviewStatus === "approved" && (
            <span className="dd-status approved">✓ Approved</span>
          )}
          {reviewStatus === "pending" && (
            <span className="dd-status pending">⏳ Under Review</span>
          )}
          {daysLeft !== null && daysLeft !== undefined && (
            <span className={`dd-due-badge ${dueBadgeClass}`}>
              {daysLeft < 0
                ? `${Math.abs(daysLeft)}d overdue`
                : daysLeft === 0
                ? "Due today!"
                : `${daysLeft}d left`}
            </span>
          )}
        </div>
      </div>

      {/* ── Work Summary Strip ── */}
      <div className="dd-work-summary">
        <div className="dd-summary-chip">
          <span className="dd-summary-icon">📦</span>
          <div>
            <div className="dd-summary-val">{submissionCount || 0}</div>
            <div className="dd-summary-key">Submissions</div>
          </div>
        </div>
        <div className="dd-summary-chip">
          <span className="dd-summary-icon">📁</span>
          <div>
            <div className="dd-summary-val">{fileCount}</div>
            <div className="dd-summary-key">Files</div>
          </div>
        </div>
        <div className="dd-summary-chip">
          <span className="dd-summary-icon">🕐</span>
          <div>
            <div className="dd-summary-val">
              {timeAgo(projectDetail?.submitted_at) || "—"}
            </div>
            <div className="dd-summary-key">Last Update</div>
          </div>
        </div>
        <div className="dd-summary-chip dd-summary-next">
          <span className="dd-summary-icon">→</span>
          <div>
            <div className="dd-summary-val">{nextAction}</div>
            <div className="dd-summary-key">Next Action</div>
          </div>
        </div>
      </div>

      <div className="dd-card-meta dd-workspace-meta">
        <span>
          💰 ₹{project.min_budget} – ₹{project.max_budget}
        </span>
        <span>
          📅 Due:{" "}
          {project.due_date
            ? new Date(project.due_date).toLocaleDateString("en-IN", {
                day: "numeric",
                month: "short",
                year: "numeric",
              })
            : "N/A"}
        </span>
        {submissionCount > 0 && <span>📬 v{submissionCount} submitted</span>}
      </div>
    </div>
  );
});

export default WorkspaceHeader;
