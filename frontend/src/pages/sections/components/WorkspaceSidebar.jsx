/**
 * WorkspaceSidebar.jsx — Developer-only right column container
 *
 * Extracted in Phase 6 Step 5b from DeveloperProjectWorkspace.
 *
 * Props:
 *   project          — raw project object
 *   projectDetail    — from useProjectDetail (submission_count, deliverable_link, etc.)
 *   files            — array from useProjectFiles
 *   reviewStatus     — string: "pending" | "approved" | "revision_requested"
 *   reviewFeedback   — string
 *   activeTab        — "deliverables" | "files" | "feedback"
 *   onTabChange      — (tab: string) => void
 *   onOpenMessages   — () => void
 *   onComplete       — (project) => void
 *   onProjectUpdated — (project) => void
 *   fileInputRef     — React ref — passed to FileManager for programmatic click
 *
 * Internal state: actionLoading (string|null — key of the currently loading quick action)
 *
 * Requirements: 11.1, 11.2, 11.3, 11.5
 */
import { useState } from "react";
import { apiRequest } from "../../../lib/api";
import { invalidateProject } from "../../../hooks/useProjectQueries";
import { queryClient } from "../../../lib/queryClient";
import { queryKeys } from "../../../lib/queryKeys";
import QuickActionsPanel from "./QuickActionsPanel";
import DeliverableForm from "./DeliverableForm";
import FileManager from "./FileManager";
import { timeAgo } from "../../../utils/time";

export default function WorkspaceSidebar({
  project,
  projectDetail,
  files,
  reviewStatus,
  reviewFeedback,
  activeTab,
  onTabChange,
  onOpenMessages,
  onComplete,
  onProjectUpdated,
  fileInputRef,
}) {
  const [actionLoading, setActionLoading] = useState(null);

  /* ── derived values ─────────────────────────────────────────────── */
  const isLocked = reviewStatus === "approved" || reviewStatus === "pending";
  const repoLink = projectDetail?.deliverable_link || "";
  const demoLink = projectDetail?.demo_link || "";
  const notes = projectDetail?.submission_note || "";
  const submissionCount = projectDetail?.submission_count ?? 0;
  const versionLabel = submissionCount > 0 ? `v${submissionCount + 1}` : "v1";

  /* ── mark complete ──────────────────────────────────────────────── */
  const handleMarkComplete = async () => {
    if (reviewStatus !== "approved") return;
    try {
      const res = await apiRequest(`/projects/${project.id}/complete`, { method: "PUT" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      invalidateProject(project.id);
      queryClient.invalidateQueries({ queryKey: queryKeys.developer.assigned(undefined) });
      if (onComplete) onComplete({ ...project, status: "completed" });
      if (onProjectUpdated) onProjectUpdated({ ...project, status: "completed" });
    } catch (err) {
      console.error(err);
    }
  };

  /* ── quick actions array ────────────────────────────────────────── */
  const actions = [
    {
      key: "upload",
      label: "Upload File",
      icon: "📤",
      description: "",
      onClick: () => { onTabChange("files"); fileInputRef?.current?.click(); },
      disabled: false,
      variant: "",
    },
    {
      key: "links",
      label: "Update Links",
      icon: "🔗",
      description: "",
      onClick: () => onTabChange("deliverables"),
      disabled: isLocked,
      variant: "",
    },
    {
      key: "feedback",
      label: "View Feedback",
      icon: "💬",
      description: "",
      onClick: () => onTabChange("feedback"),
      disabled: false,
      variant: "",
    },
    {
      key: "submit",
      label: `Submit ${versionLabel}`,
      icon: "🚀",
      description: "",
      onClick: () => { if (repoLink) onTabChange("deliverables"); },
      disabled: isLocked || !repoLink,
      variant: "primary",
    },
  ];

  /* ── render ─────────────────────────────────────────────────────── */
  return (
    <div className="dd-workspace-actions">

      {/* ── Quick Actions card ── */}
      <div className="dd-card dd-quick-actions" style={{ "--ci": 3 }}>
        <h3 className="dd-card-title">⚡ Quick Actions</h3>
        <QuickActionsPanel actions={actions} layout="developer" />
      </div>

      {/* ── Tabbed panel card ── */}
      <div className="dd-card dd-tab-card" style={{ "--ci": 4 }}>
        {/* Tab bar */}
        <div className="dd-tabs">
          {["deliverables", "files", "feedback"].map((tab) => (
            <button
              key={tab}
              className={`dd-tab ${activeTab === tab ? "active" : ""}`}
              onClick={() => onTabChange(tab)}
            >
              {tab === "deliverables"
                ? "🚀 Submit"
                : tab === "files"
                ? `📁 Files${files && files.length > 0 ? ` (${files.length})` : ""}`
                : "💬 Feedback"}
            </button>
          ))}
        </div>

        {/* DELIVERABLES TAB */}
        {activeTab === "deliverables" && (
          <DeliverableForm
            projectId={project.id}
            initialValues={{ repoLink, demoLink, notes }}
            isLocked={isLocked}
            submissionCount={submissionCount}
            onSubmitSuccess={() => {
              if (onProjectUpdated) onProjectUpdated({ id: project.id });
            }}
          />
        )}

        {/* FILES TAB */}
        {activeTab === "files" && (
          <div className="dd-tab-body">
            <FileManager
              projectId={project.id}
              files={files}
              isLoading={false}
              readonly={false}
            />
          </div>
        )}

        {/* FEEDBACK TAB */}
        {activeTab === "feedback" && (
          <div className="dd-tab-body">
            <div className={`dd-feedback-inner ${reviewStatus === "revision_requested" ? "urgent" : ""}`}>
              <div className="dd-feedback-status-row">
                <span
                  className={`dd-status ${
                    reviewStatus === "revision_requested"
                      ? "review"
                      : reviewStatus === "approved"
                      ? "approved"
                      : "pending"
                  }`}
                >
                  {reviewStatus === "revision_requested"
                    ? "↩ Changes Requested"
                    : reviewStatus === "approved"
                    ? "✓ Approved"
                    : "⏳ Awaiting Review"}
                </span>
                {projectDetail?.reviewed_at && (
                  <span className="dd-feedback-time">
                    {timeAgo(projectDetail.reviewed_at)}
                  </span>
                )}
              </div>
              {reviewFeedback ? (
                <p className="dd-card-desc" style={{ marginTop: 10 }}>
                  {reviewFeedback}
                </p>
              ) : (
                <p className="dd-card-desc dd-empty-state">
                  {reviewStatus === "pending"
                    ? "⏳ Waiting for client to review…"
                    : "No feedback yet from client."}
                </p>
              )}
              {reviewStatus === "revision_requested" && (
                <button
                  className="dd-bid-btn"
                  style={{ marginTop: 14, width: "100%" }}
                  onClick={() => onTabChange("deliverables")}
                >
                  → Update &amp; Resubmit
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Progress / Mark Complete card ── */}
      <div className="dd-card" style={{ "--ci": 5 }}>
        {reviewStatus === "approved" && project.status !== "completed" && (
          <>
            <h3 className="dd-card-title">✅ Ready to Wrap Up?</h3>
            <p className="dd-card-desc">
              Mark this project complete after final approval.
            </p>
            <button
              className="dd-bid-btn"
              onClick={handleMarkComplete}
            >
              Mark as Complete
            </button>
          </>
        )}
        {reviewStatus !== "approved" && (
          <>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 8,
              }}
            >
              <h3 className="dd-card-title">📊 Progress</h3>
              <span className="dd-progress-pct">
                {reviewStatus === "pending"
                  ? "80%"
                  : files && files.length > 0
                  ? "50%"
                  : "20%"}
              </span>
            </div>
            <div className="dd-workspace-progress">
              <div
                className="dd-workspace-progress-fill"
                style={{
                  width:
                    reviewStatus === "pending"
                      ? "80%"
                      : files && files.length > 0
                      ? "50%"
                      : "20%",
                }}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
