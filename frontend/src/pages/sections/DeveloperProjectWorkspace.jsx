import "./ProjectWorkspace.css";
import { useEffect, useRef, useState, useCallback } from "react";
import { useSocket, useConnectionState } from "../../context/SocketContext";
import ConnectionStatusBar from "../../components/ConnectionStatusBar";
import { useProjectDetail, useProjectFiles } from "../../hooks/useProjectQueries";
import { timeAgo } from "../../utils/time";
import { useProjectRoom } from "../../hooks/useProjectRoom";
import WorkspaceHeader from "./components/WorkspaceHeader";
import WorkspaceProgressBar from "./components/WorkspaceProgressBar";
import ActivityFeed from "./components/ActivityFeed";
import WorkspaceSidebar from "./components/WorkspaceSidebar";
import MobileWorkspaceNav from "./components/MobileWorkspaceNav";

/* ── stageIndex helper ───────────────────────────────────────
 * Kept in parent because it depends on repoLink (local form state
 * inside WorkspaceSidebar) — passed down as currentStageIdx prop.
 * ─────────────────────────────────────────────────────────── */
const stageIndex = (status, hasFiles, hasRepo) => {
  if (status === "approved") return 5;
  if (status === "pending") return 3;
  if (status === "revision_requested") return 4;
  if (hasRepo) return 2;
  if (hasFiles) return 1;
  return 0;
};

/* ── component ───────────────────────────────────────────── */
function DeveloperProjectWorkspace({ project, onBack, onOpenMessages, onComplete, onProjectUpdated }) {
  const fileInputRef = useRef(null);
  const [activeTab, setActiveTab] = useState("deliverables");
  const [activeSection, setActiveSection] = useState("overview");
  const [notification, setNotification] = useState(null);

  const socket = useSocket();
  const { connectionState, reconnectAttempt, onRetry } = useConnectionState();

  useProjectRoom(project?.id);

  /* ── server state ────────────────────────────────────────── */
  const { data: projectDetail } = useProjectDetail(project?.id);
  const { data: filesData = [] } = useProjectFiles(project?.id);

  const files          = filesData;
  const reviewStatus   = projectDetail?.review_status   ?? "pending";
  const reviewFeedback = projectDetail?.review_feedback ?? "";
  const submissionCount = projectDetail?.submission_count ?? 0;

  /* ── derived display values ──────────────────────────────── */
  const repoLink = projectDetail?.deliverable_link || "";

  const currentStageIdx = stageIndex(reviewStatus, files.length > 0, !!repoLink);

  const daysLeft = project.due_date
    ? Math.ceil((new Date(project.due_date) - Date.now()) / 86400000)
    : null;
  const dueBadgeClass =
    daysLeft === null ? "" :
    daysLeft < 0     ? "overdue" :
    daysLeft <= 3    ? "urgent"  :
    daysLeft <= 7    ? "soon"    : "";

  const nextAction =
    reviewStatus === "approved"           ? "Project complete 🎉" :
    reviewStatus === "pending"            ? "Awaiting client review…" :
    reviewStatus === "revision_requested" ? "Address feedback & resubmit" :
    repoLink                              ? "Submit latest update" : "Add repo link & submit";

  const versionLabel = submissionCount > 0 ? `v${submissionCount + 1}` : "v1";

  /* ── notification helper ─────────────────────────────────── */
  const pushNotif = useCallback((msg, type = "info") => {
    setNotification({ msg, type });
    setTimeout(() => setNotification(null), 4500);
  }, []);

  /* ── socket listeners ────────────────────────────────────── */
  useEffect(() => {
    if (!project?.id) return;

    const handleApprovalGranted = (envelope) => {
      if (envelope?.projectId !== project.id) return;
      pushNotif("✅ Client approved your work!", "success");
      setActiveTab("feedback");
      if (onProjectUpdated) onProjectUpdated({ id: project.id });
    };

    const handleRevisionRequested = (envelope) => {
      if (envelope?.projectId !== project.id) return;
      pushNotif("📬 Client requested revisions!", "warning");
      setActiveTab("feedback");
      if (onProjectUpdated) onProjectUpdated({ id: project.id });
    };

    socket.on("approval:granted",   handleApprovalGranted);
    socket.on("revision:requested", handleRevisionRequested);

    return () => {
      socket.off("approval:granted",   handleApprovalGranted);
      socket.off("revision:requested", handleRevisionRequested);
    };
  }, [project?.id, socket, pushNotif, onProjectUpdated]);

  /* ── render ──────────────────────────────────────────────── */
  return (
    <div className="dd-content dd-workspace">

      <ConnectionStatusBar
        connectionState={connectionState}
        reconnectAttempt={reconnectAttempt}
        onRetry={onRetry}
      />

      {/* Floating notification */}
      {notification && (
        <div className={`dd-notif dd-notif-${notification.type}`}>
          {notification.msg}
        </div>
      )}

      {/* HEADER */}
      <WorkspaceHeader
        variant="developer"
        project={project}
        projectDetail={projectDetail}
        reviewStatus={reviewStatus}
        isUrgent={false}
        hasNewUpdate={false}
        onBack={onBack}
        onDismissUpdate={() => {}}
        files={files}
        submissionCount={submissionCount}
        daysLeft={daysLeft}
        dueBadgeClass={dueBadgeClass}
        nextAction={nextAction}
        versionLabel={versionLabel}
      />

      {/* PROGRESS STEPPER */}
      <WorkspaceProgressBar
        variant="developer"
        reviewStatus={reviewStatus}
        stageIndex={currentStageIdx}
      />

      {/* BODY */}
      <div className="dd-workspace-body">

        {/* LEFT COLUMN */}
        <div className="dd-workspace-left">

          {/* Project brief */}
          <div className="dd-card" style={{ "--ci": 1 }}>
            <h3 className="dd-card-title">📋 Project Brief</h3>
            <p className="dd-card-desc dd-workspace-description">
              {project.description || "No description provided yet."}
            </p>
            {project.tags?.length > 0 && (
              <div className="dd-card-tags" style={{ marginTop: 12 }}>
                {project.tags.map((tag, idx) => (
                  <span key={`${tag}-${idx}`} className="dd-tag" style={{ "--ci": idx }}>{tag}</span>
                ))}
              </div>
            )}
          </div>

          {/* Client feedback card */}
          <div
            className={`dd-card dd-feedback-card ${reviewStatus === "revision_requested" ? "dd-feedback-urgent" : ""}`}
            style={{ "--ci": 2 }}
          >
            <div className="dd-feedback-header">
              <h3 className="dd-card-title">💬 Client Feedback</h3>
              <span
                className={`dd-status ${
                  reviewStatus === "revision_requested" ? "review" :
                  reviewStatus === "approved"           ? "approved" : "pending"
                }`}
              >
                {reviewStatus === "revision_requested" ? "Changes Requested" :
                 reviewStatus === "approved"           ? "Approved" : "Awaiting Review"}
              </span>
            </div>
            {reviewFeedback ? (
              <div className="dd-feedback-body">
                <p className="dd-card-desc">{reviewFeedback}</p>
                {projectDetail?.reviewed_at && (
                  <p className="dd-feedback-time">Received {timeAgo(projectDetail.reviewed_at)}</p>
                )}
              </div>
            ) : (
              <p className="dd-card-desc dd-empty-state">
                {reviewStatus === "pending"
                  ? "⏳ Waiting for client to review your submission…"
                  : "No feedback yet."}
              </p>
            )}
          </div>

          {/* Activity Feed */}
          <ActivityFeed projectId={project.id} isClient={false} />

        </div>

        {/* RIGHT COLUMN */}
        <WorkspaceSidebar
          project={project}
          projectDetail={projectDetail}
          files={files}
          reviewStatus={reviewStatus}
          reviewFeedback={reviewFeedback}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          onOpenMessages={onOpenMessages}
          onComplete={onComplete}
          onProjectUpdated={onProjectUpdated}
          fileInputRef={fileInputRef}
        />

      </div>

      {/* MOBILE NAV */}
      <MobileWorkspaceNav
        activeSection={activeSection}
        onSectionChange={setActiveSection}
        fileCount={files.length}
        hasNewUpdate={false}
      />

    </div>
  );
}

export default DeveloperProjectWorkspace;
