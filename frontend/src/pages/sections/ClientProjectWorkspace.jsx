import { useEffect, useState, useCallback } from "react";
import "./ProjectWorkspace.css";
import { useSocket, useConnectionState } from "../../context/SocketContext";
import ConnectionStatusBar from "../../components/ConnectionStatusBar";
import { apiRequest } from "../../lib/api";
import { invalidateProject } from "../../hooks/useProjectQueries";
import { queryClient } from "../../lib/queryClient";
import { queryKeys } from "../../lib/queryKeys";
import {
  useProjectDetail,
  useProjectFiles,
} from "../../hooks/useProjectQueries";
import { timeAgo } from "../../utils/time";
import { useProjectRoom } from "../../hooks/useProjectRoom";
import WorkspaceHeader from "./components/WorkspaceHeader";
import WorkspaceProgressBar from "./components/WorkspaceProgressBar";
import FileManager from "./components/FileManager";
import DeliverableDisplay from "./components/DeliverableDisplay";
import ReviewPanel from "./components/ReviewPanel";
import QuickActionsPanel from "./components/QuickActionsPanel";
import ActivityFeed from "./components/ActivityFeed";
import MobileWorkspaceNav from "./components/MobileWorkspaceNav";

/* ─── helpers ────────────────────────────────────────────── */
function safeUrl(url) {
  if (typeof url !== "string") return "";
  const trimmed = url.trim();
  if (!trimmed) return "";
  return trimmed.startsWith("http") ? trimmed : "https://" + trimmed;
}

function getStageFromStatus(reviewStatus, fileCount) {
  if (reviewStatus === "approved")                      return "completed";
  if (reviewStatus === "pending" && fileCount > 0)      return "in_review";
  if (reviewStatus === "revision_requested")            return "submitted";
  if (fileCount > 0)                                    return "in_progress";
  return "not_started";
}

/* ══════════════════════════════════════════════════════════
   MAIN COMPONENT
══════════════════════════════════════════════════════════ */
export default function ClientProjectWorkspace({ project, onBack, onNavigateToMessages, onProjectUpdated }) {
  /* ── local UI state ─────────────────────────────────────── */
  const [actionMessage,  setActionMessage]  = useState("");
  const [actionLoading,  setActionLoading]  = useState(null);
  const [isUrgent,       setIsUrgent]       = useState(false);
  const [hasNewUpdate,   setHasNewUpdate]   = useState(false);
  const [activeSection,  setActiveSection]  = useState("overview");

  const socket = useSocket();
  const { connectionState, reconnectAttempt, onRetry } = useConnectionState();

  useProjectRoom(project?.id);

  /* ── server state ───────────────────────────────────────── */
  const { data: projectDetail, isLoading: loadingDeliverables } = useProjectDetail(project?.id);
  const { data: filesData = [], isLoading: loadingFiles } = useProjectFiles(project?.id);

  const files = filesData;
  const deliverables = {
    repoLink: safeUrl(projectDetail?.deliverable_link),
    demoLink: safeUrl(projectDetail?.demo_link),
    notes:    typeof projectDetail?.submission_note === "string" ? projectDetail.submission_note : "",
  };
  const reviewStatus = projectDetail?.review_status ?? "pending";
  const submittedAt  = projectDetail?.submitted_at  ?? null;

  /* ── sync derived values into local state ───────────────── */
  useEffect(() => {
    if (projectDetail?.is_urgent !== undefined) setIsUrgent(projectDetail.is_urgent ?? false);
  }, [projectDetail]);

  const currentStage = getStageFromStatus(reviewStatus, files.length);

  /* ── derived display values ─────────────────────────────── */
  const devName     = project?.developer_name || project?.assignedDeveloper || null;
  const devInitials = devName
    ? devName.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase()
    : "?";
  const devOnline = false;

  /* ── flash helper ───────────────────────────────────────── */
  const flashAction = useCallback((msg, ms = 3000) => {
    setActionMessage(msg);
    setTimeout(() => setActionMessage(""), ms);
  }, []);

  /* ── socket: submission:created ─────────────────────────── */
  useEffect(() => {
    if (!project?.id) return;
    const handleSubmissionCreated = (envelope) => {
      if (envelope?.projectId === project.id) setHasNewUpdate(true);
    };
    socket.on("submission:created", handleSubmissionCreated);
    return () => { socket.off("submission:created", handleSubmissionCreated); };
  }, [project?.id, socket]);

  /* ── quick-action handler ───────────────────────────────── */
  const handleQuickAction = async (actionKey) => {
    setActionLoading(actionKey);
    try {
      if (actionKey === "message") {
        if (onNavigateToMessages) {
          onNavigateToMessages(project.id);
        } else {
          flashAction("💬 Go to the Messages section to chat with your developer.");
        }
      }

      if (actionKey === "request_update") {
        const res = await apiRequest(`/projects/${project.id}/request-update`, {
          method: "POST",
          body: JSON.stringify({ feedback: "Client requested a status update." }),
        });
        flashAction(res.ok
          ? "📣 Update requested — developer has been notified."
          : "Failed to send update request.");
      }

      if (actionKey === "urgent") {
        const next = !isUrgent;
        const res = await apiRequest(`/projects/${project.id}/urgent`, {
          method: "PATCH",
          body: JSON.stringify({ is_urgent: next }),
        });
        if (res.ok) {
          setIsUrgent(next);
          flashAction(next ? "🚨 Marked as urgent — developer notified." : "🔕 Urgency flag removed.");
        } else {
          flashAction("Failed to update urgency flag.");
        }
      }

      if (actionKey === "reopen") {
        const res = await apiRequest(`/projects/${project.id}/review`, {
          method: "PUT",
          body: JSON.stringify({ action: "revision", feedback: "Client has requested additional work. Please resubmit when ready." }),
        });
        if (res.ok) {
          invalidateProject(project.id);
          queryClient.invalidateQueries({ queryKey: queryKeys.projects.list() });
          flashAction("🔄 Project reopened — developer has been notified.");
        } else {
          flashAction("Failed to reopen project.");
        }
      }
    } finally {
      setActionLoading(null);
    }
  };

  if (!project) return null;

  /* ══════════════════════════════════════════════════════════
     RENDER
  ══════════════════════════════════════════════════════════ */
  return (
    <div className="dd-content dd-workspace cpw-root">
      <ConnectionStatusBar
        connectionState={connectionState}
        reconnectAttempt={reconnectAttempt}
        onRetry={onRetry}
      />

      {/* HEADER */}
      <WorkspaceHeader
        variant="client"
        project={project}
        projectDetail={projectDetail}
        reviewStatus={reviewStatus}
        isUrgent={isUrgent}
        hasNewUpdate={hasNewUpdate}
        onBack={onBack}
        onDismissUpdate={() => setHasNewUpdate(false)}
      />

      {/* PROGRESS BAR */}
      <WorkspaceProgressBar
        variant="client"
        currentStage={currentStage}
        reviewStatus={reviewStatus}
      />

      {/* BODY */}
      <div className="dd-workspace-body">

        {/* LEFT COLUMN */}
        <div className="dd-workspace-left">

          {/* Description card */}
          <div className="dd-card" style={{ "--ci": 1 }}>
            <div className="cpw-section-header">
              <span className="cpw-section-icon">📋</span>
              <h3 className="dd-card-title cpw-section-title">Project Description</h3>
            </div>
            <p className="dd-card-desc dd-workspace-description">
              {project.description || "No description provided yet."}
            </p>
          </div>

          {/* Tags card */}
          <div className="dd-card" style={{ "--ci": 2 }}>
            <div className="cpw-section-header">
              <span className="cpw-section-icon">🏷️</span>
              <h3 className="dd-card-title cpw-section-title">Tags</h3>
            </div>
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

          {/* Developer panel */}
          <div className="dd-card cpw-dev-card" style={{ "--ci": 3 }}>
            <div className="cpw-section-header">
              <span className="cpw-section-icon">👤</span>
              <h3 className="dd-card-title cpw-section-title">Assigned Developer</h3>
              {devOnline && (
                <span className="cpw-notif-pill" style={{ "--pill-color": "var(--cyan)" }}>Online</span>
              )}
            </div>
            {devName ? (
              <div className="cpw-dev-panel">
                <div className="cpw-dev-avatar">
                  <span>{devInitials}</span>
                  <span className="cpw-dev-status-dot offline" title="offline" />
                </div>
                <div className="cpw-dev-info">
                  <span className="cpw-dev-name">{devName}</span>
                  <span className="cpw-dev-role">Developer</span>
                  <span className="cpw-dev-lastactive">● Last seen: recently</span>
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
            <ActivityFeed projectId={project.id} isClient={true} />
          </div>

        </div>

        {/* RIGHT COLUMN */}
        <div className="dd-workspace-actions">

          {/* Quick Actions */}
          <div className="dd-card cpw-actions-card" style={{ "--ci": 4 }}>
            <div className="cpw-section-header">
              <span className="cpw-section-icon">⚡</span>
              <h3 className="dd-card-title cpw-section-title">Quick Actions</h3>
            </div>
            <QuickActionsPanel
              layout="client"
              actions={[
                { key: "message",        label: "Message Developer",                    icon: "💬", description: "Send a direct message",      onClick: () => handleQuickAction("message"),        disabled: actionLoading === "message",        variant: "" },
                { key: "request_update", label: "Request Update",                       icon: "📣", description: "Ping developer for status",  onClick: () => handleQuickAction("request_update"), disabled: actionLoading === "request_update", variant: "" },
                { key: "urgent",         label: isUrgent ? "Remove Urgent Flag" : "Mark as Urgent", icon: isUrgent ? "🔕" : "🚨", description: isUrgent ? "Cancel urgency status" : "Notify developer ASAP", onClick: () => handleQuickAction("urgent"), disabled: actionLoading === "urgent", variant: isUrgent ? "urgent" : "" },
                ...(reviewStatus === "approved" ? [{ key: "reopen", label: "Reopen Project", icon: "🔄", description: "Request additional work", onClick: () => handleQuickAction("reopen"), disabled: actionLoading === "reopen", variant: "" }] : []),
              ]}
              actionMessage={actionMessage}
            />
          </div>

          {/* Files */}
          <div className="dd-card" style={{ "--ci": 5 }}>
            <div className="cpw-section-header">
              <span className="cpw-section-icon">📁</span>
              <h3 className="dd-card-title cpw-section-title">Files</h3>
              {files.length > 0 && (
                <span className="cpw-notif-pill" style={{ "--pill-color": "var(--violet)" }}>{files.length}</span>
              )}
            </div>
            <p className="dd-card-desc">
              {loadingFiles ? "Loading files…"
               : files.length ? `${files.length} file${files.length > 1 ? "s" : ""} uploaded.`
               : "No files yet — waiting for developer submission."}
            </p>
            {files.length > 0 && (
              <FileManager
                projectId={project.id}
                files={files}
                isLoading={loadingFiles}
                readonly={true}
              />
            )}
          </div>

          {/* Deliverables */}
          <div className="dd-card" style={{ "--ci": 6 }}>
            <div className="cpw-section-header">
              <span className="cpw-section-icon">🚀</span>
              <h3 className="dd-card-title cpw-section-title">Deliverables</h3>
              {submittedAt && (
                <span className="cpw-notif-pill" style={{ "--pill-color": "var(--violet)" }}>
                  Updated {timeAgo(submittedAt)}
                </span>
              )}
            </div>
            <DeliverableDisplay
              deliverables={deliverables}
              submittedAt={submittedAt}
              isLoading={loadingDeliverables}
            />
          </div>

          {/* Review & Approval */}
          <div className="dd-card cpw-review-card" style={{ "--ci": 7 }}>
            <div className="cpw-section-header">
              <span className="cpw-section-icon">✅</span>
              <h3 className="dd-card-title cpw-section-title">Review & Approval</h3>
            </div>
            <ReviewPanel
              projectId={project.id}
              reviewStatus={reviewStatus}
              onReviewSubmitted={onProjectUpdated}
            />
          </div>

        </div>
      </div>

      {/* MOBILE NAV */}
      <MobileWorkspaceNav
        activeSection={activeSection}
        onSectionChange={setActiveSection}
        fileCount={files.length}
        hasNewUpdate={hasNewUpdate}
      />
    </div>
  );
}
