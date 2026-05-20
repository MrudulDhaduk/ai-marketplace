import "./ProjectWorkspace.css";
import { useEffect, useRef, useState, useCallback } from "react";
import { useSocket } from "../../context/SocketContext";
import { useAuth } from "../../context/AuthContext";
import SubmissionHistory from "./components/SubmissionHistory";
import React from "react";
import { apiRequest, API_BASE_URL } from "../../lib/api";
import {
  useProjectDetail,
  useProjectFiles,
  invalidateProject,
  invalidateProjectFiles,
} from "../../hooks/useProjectQueries";
import { queryClient } from "../../lib/queryClient";
import { queryKeys } from "../../lib/queryKeys";
import ErrorBoundary from "../../components/ErrorBoundary";
import "../../components/ErrorBoundary.css";

/* ── helpers ─────────────────────────────────────────── */
const timeAgo = (dateStr) => {
  if (!dateStr) return null;
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
};

const FILE_ICONS = {
  pdf: "📄", zip: "🗜️", rar: "🗜️", png: "🖼️", jpg: "🖼️", jpeg: "🖼️",
  gif: "🖼️", svg: "🖼️", mp4: "🎬", mp3: "🎵", doc: "📝", docx: "📝",
  xls: "📊", xlsx: "📊", ppt: "📑", pptx: "📑", txt: "📃",
  js: "⚡", ts: "⚡", jsx: "⚛️", tsx: "⚛️", css: "🎨", html: "🌐",
  json: "🔧", md: "📋", py: "🐍", rb: "💎", go: "🐹", rs: "🦀",
};
const getFileIcon = (name = "") => {
  const ext = name.split(".").pop()?.toLowerCase();
  return FILE_ICONS[ext] || "📁";
};
const formatBytes = (b) => {
  if (!b) return "";
  if (b < 1024) return `${b}B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)}KB`;
  return `${(b / (1024 * 1024)).toFixed(1)}MB`;
};

/* stages */
const STAGES = [
  { key: "not_started", label: "Not Started", icon: "○" },
  { key: "in_progress", label: "In Progress", icon: "◑" },
  { key: "submitted",   label: "Submitted",   icon: "⬆" },
  { key: "pending",     label: "Under Review", icon: "⏳" },
  { key: "revision_requested", label: "Revision", icon: "↩" },
  { key: "approved",    label: "Approved",    icon: "✓" },
];
const stageIndex = (status, hasFiles, hasRepo) => {
  if (status === "approved") return 5;
  if (status === "pending") return 3;
  if (status === "revision_requested") return 4;
  if (hasRepo) return 2;
  if (hasFiles) return 1;
  return 0;
};

/* ── component ───────────────────────────────────────── */
function DeveloperProjectWorkspace({ project, onBack, onOpenMessages, onComplete, onProjectUpdated }) {
  // UI-only state
  const [uploadProgress, setUploadProgress] = useState(0);
  const [dragIndex, setDragIndex] = useState(null);
  const [dragOver, setDragOver] = useState(null);
  const fileInputRef = useRef(null);
  const dropZoneRef = useRef(null);
  const [submissionState, setSubmissionState] = useState("idle");
  const [submissionError, setSubmissionError] = useState("");
  const [uploadNotice, setUploadNotice] = useState("");
  const [copiedField, setCopiedField] = useState("");
  const [activeTab, setActiveTab] = useState("deliverables");
  const [showConfirm, setShowConfirm] = useState(false);
  const [isDropZoneActive, setIsDropZoneActive] = useState(false);
  const [notification, setNotification] = useState(null);

  // Editable deliverable fields (local form state — synced from query on load)
  const [repoLink, setRepoLink] = useState("");
  const [demoLink, setDemoLink] = useState("");
  const [notes, setNotes] = useState("");

  // Phase 3: token is now httpOnly — not accessible to JS.
  // XHR upload uses withCredentials to send the cookie automatically.
  const { currentUser } = useAuth();
  const socket = useSocket();

  /* ── Server state via TanStack Query ────────────────────── */
  const { data: projectDetail } = useProjectDetail(project?.id);
  const { data: filesData = [] } = useProjectFiles(project?.id);

  // Derive display values from query data
  const files           = filesData;
  const reviewStatus    = projectDetail?.review_status    ?? "pending";
  const reviewFeedback  = projectDetail?.review_feedback  ?? "";
  const projectData     = projectDetail ?? project;
  const submissionCount = projectDetail?.submission_count ?? 0;

  // Sync form fields from query data on first load / project change
  useEffect(() => {
    if (!projectDetail) return;
    setRepoLink(projectDetail.deliverable_link || "");
    setDemoLink(projectDetail.demo_link || "");
    setNotes(projectDetail.submission_note || "");
  // projectDetail.id ensures we re-sync when the project changes,
  // without re-running on every background refetch of the same project
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id, projectDetail?.id]);

  const pushNotif = useCallback((msg, type = "info") => {
    setNotification({ msg, type });
    setTimeout(() => setNotification(null), 4500);
  }, []);

  /* ── socket ──────────────────────────────────────────── */
  useEffect(() => {
    if (!project?.id) return;

    const handleProjectReviewed = () => {
      // Invalidate project detail — TanStack Query refetches automatically
      invalidateProject(project.id);
      pushNotif("📬 Client left new feedback!", "warning");
      setActiveTab("feedback");
      // Notify parent dashboard
      if (onProjectUpdated) {
        queryClient.invalidateQueries({ queryKey: queryKeys.developer.assigned(undefined) });
        onProjectUpdated({ id: project.id });
      }
    };

    const handleProjectSubmitted = () => {
      invalidateProject(project.id);
    };

    // BUG-M2 fix: workspace_activity_updated (entry-level approval) also
    // refreshes review status
    const handleWorkspaceActivityUpdated = () => {
      invalidateProject(project.id);
    };

    // ARCH-8 fix: re-join project room on reconnect
    const handleReconnect = () => {
      socket.emit("join_project", project.id);
    };

    // BUG-C7 fix: register listeners BEFORE emitting join_project
    socket.on("project_reviewed",           handleProjectReviewed);
    socket.on("project_submitted",          handleProjectSubmitted);
    socket.on("workspace_activity_updated", handleWorkspaceActivityUpdated);
    socket.on("connect",                    handleReconnect);

    socket.emit("join_project", project.id);

    return () => {
      socket.off("project_reviewed",           handleProjectReviewed);
      socket.off("project_submitted",          handleProjectSubmitted);
      socket.off("workspace_activity_updated", handleWorkspaceActivityUpdated);
      socket.off("connect",                    handleReconnect);
    };
  }, [project?.id, socket, pushNotif, onProjectUpdated]);

  /* ── file delete ─────────────────────────────────────── */
  const handleDelete = async (id) => {
    if (!window.confirm("Delete this file?")) return;
    try {
      const delRes = await apiRequest(`/files/${id}`, { method: "DELETE" });
      if (!delRes.ok) return;
      // Invalidate files cache — TanStack Query refetches the updated list
      invalidateProjectFiles(project.id);
      pushNotif("🗑️ File deleted", "info");
    } catch (e) { console.error("Failed to delete file", e); }
  };

  /* ── reorder ─────────────────────────────────────────── */
  const handleReorder = (dropIndex) => {
    if (dragIndex === null || dragIndex === dropIndex) return;
    const updated = [...files];
    const [dragged] = updated.splice(dragIndex, 1);
    updated.splice(dropIndex, 0, dragged);
    setDragIndex(null);
    setDragOver(null);
    // Optimistically update the query cache so the UI reorders instantly
    queryClient.setQueryData(
      queryKeys.projects.files(project.id),
      updated,
    );
    apiRequest("/files/reorder", {
      method: "PUT",
      body: JSON.stringify(updated.map((f, i) => ({ id: f.id, position: i + 1 }))),
    }).catch((e) => {
      console.error("Failed to reorder files", e);
      // Revert on failure
      invalidateProjectFiles(project.id);
    });
  };

  /* ── upload ──────────────────────────────────────────── */
  const handleUpload = (selectedFiles) => {
    if (!project?.id || !selectedFiles?.length) return;
    setUploadNotice("");
    const formData = new FormData();
    Array.from(selectedFiles).forEach((f) => formData.append("files", f));
    const xhr = new XMLHttpRequest();
    xhr.upload.onprogress = (e) => {
      if (!e.total) return;
      setUploadProgress(Math.round((e.loaded * 100) / e.total));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const response = JSON.parse(xhr.responseText);
          if (response?.files?.length) {
            // Invalidate files cache so the new files appear via query refetch
            invalidateProjectFiles(project.id);
          }
          setUploadNotice("Files uploaded successfully");
          pushNotif("✅ Files uploaded", "success");
          setTimeout(() => setUploadNotice(""), 4000);
        } catch (e) { console.error("Invalid upload response", e); }
      } else { console.error("Upload failed", xhr.responseText); }
      setUploadProgress(0);
      if (fileInputRef.current) fileInputRef.current.value = "";
    };
    xhr.onerror = () => { setUploadProgress(0); console.error("Upload request failed"); };
    xhr.open("POST", `${API_BASE_URL}/projects/${project.id}/upload`);
    // Phase 3: auth cookie is sent automatically via withCredentials.
    // No Bearer header needed — the httpOnly cookie carries the JWT.
    xhr.withCredentials = true;
    // Multipart uploads are exempt from CSRF middleware (it can't parse them),
    // but we still send the token as a best-practice defence-in-depth measure.
    const csrfCookie = document.cookie.match(/(?:^|;\s*)x-csrf-token=([^;]+)/);
    if (csrfCookie) xhr.setRequestHeader("x-csrf-token", decodeURIComponent(csrfCookie[1]));
    xhr.send(formData);
  };

  /* ── drag & drop zone ────────────────────────────────── */
  const handleDropZoneDrop = (e) => {
    e.preventDefault();
    setIsDropZoneActive(false);
    const dropped = e.dataTransfer.files;
    if (dropped?.length) handleUpload(dropped);
  };

  /* ── format file name ────────────────────────────────── */
  const formatFileName = (name) => {
    if (!name) return "";
    const cleaned = name.replace(/_\d{10,}(?=\.)/, "");
    if (cleaned.length <= 28) return cleaned;
    const ext = cleaned.split(".").pop();
    const base = cleaned.substring(0, cleaned.lastIndexOf("."));
    return `${base.slice(0, 14)}…${base.slice(-4)}.${ext}`;
  };

  /* ── copy to clipboard ───────────────────────────────── */
  const copyToClipboard = (text, field) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedField(field);
      setTimeout(() => setCopiedField(""), 2000);
    });
  };

  /* ── submit deliverables ─────────────────────────────── */
  const handleSubmitDeliverables = async () => {
    if (!repoLink.trim()) { setSubmissionError("Repository link is required"); return; }
    setSubmissionError("");
    setSubmissionState("submitting");
    setShowConfirm(false);
    try {
      // Idempotency key prevents duplicate submissions from double-clicks or retries
      const idempotencyKey = `submit-${project.id}-${Date.now()}`;
      const res = await apiRequest(`/projects/${project.id}/submit`, {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey },
        body: JSON.stringify({ repoLink, demoLink, notes }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Submission failed");
      // Invalidate project detail so submission count + status update
      invalidateProject(project.id);
      setSubmissionState("submitted");
      pushNotif("🚀 Work submitted for review!", "success");
      setTimeout(() => setSubmissionState("idle"), 3000);
    } catch (err) {
      setSubmissionState("idle");
      setSubmissionError(err.message || "Submission failed. Please try again.");
    }
  };

  /* ── mark project complete ───────────────────────────── */
  const handleMarkComplete = async () => {
    if (reviewStatus !== "approved") return;
    try {
      const res = await apiRequest(`/projects/${project.id}/complete`, { method: "PUT" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      // Invalidate so the status badge updates everywhere
      invalidateProject(project.id);
      queryClient.invalidateQueries({ queryKey: queryKeys.developer.assigned(undefined) });
      pushNotif("🎉 Project marked as complete!", "success");
      const updated = { ...projectData, status: "completed" };
      if (onComplete) onComplete(updated);
      if (onProjectUpdated) onProjectUpdated(updated);
    } catch (err) {
      pushNotif(err.message || "Failed to mark complete", "error");
    }
  };

  const isLocked = reviewStatus === "approved" || reviewStatus === "pending";
  const currentStageIdx = stageIndex(reviewStatus, files.length > 0, !!repoLink);
  const daysLeft = project.due_date
    ? Math.ceil((new Date(project.due_date) - Date.now()) / 86400000)
    : null;
  const dueBadgeClass = daysLeft === null ? "" : daysLeft < 0 ? "overdue" : daysLeft <= 3 ? "urgent" : daysLeft <= 7 ? "soon" : "";

  const nextAction =
    reviewStatus === "approved" ? "Project complete 🎉" :
    reviewStatus === "pending" ? "Awaiting client review…" :
    reviewStatus === "revision_requested" ? "Address feedback & resubmit" :
    repoLink ? "Submit latest update" : "Add repo link & submit";

  const versionLabel = submissionCount > 0 ? `v${submissionCount + 1}` : "v1";

  return (
    <div className="dd-content dd-workspace">

      {/* ── Floating notification ── */}
      {notification && (
        <div className={`dd-notif dd-notif-${notification.type}`}>
          {notification.msg}
        </div>
      )}

      {/* ── Submit confirmation modal ── */}
      {showConfirm && (
        <div className="dd-modal-backdrop" onClick={() => setShowConfirm(false)}>
          <div className="dd-modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="dd-modal-title">Submit {versionLabel}?</h3>
            <p className="dd-modal-desc">
              This will notify the client and move the project to <strong>Under Review</strong>.
            </p>
            <div className="dd-modal-actions">
              <button className="dd-bid-btn dd-btn-ghost" onClick={() => setShowConfirm(false)}>Cancel</button>
              <button className="dd-bid-btn" onClick={handleSubmitDeliverables}>
                🚀 Submit {versionLabel}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ════ HEADER ════ */}
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
                <span className="dd-client-dot">●</span> Client: <strong>{project.client_name}</strong>
              </p>
            )}
          </div>
          <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
            <span className={`dd-status ${project.status === "active" ? "active" : "completed"}`}>
              {project.status === "active" ? "🟢 Active" : "✅ Completed"}
            </span>
            {reviewStatus === "revision_requested" && <span className="dd-status review">↩ Revision Needed</span>}
            {reviewStatus === "approved" && <span className="dd-status approved">✓ Approved</span>}
            {reviewStatus === "pending" && <span className="dd-status pending">⏳ Under Review</span>}
            {daysLeft !== null && (
              <span className={`dd-due-badge ${dueBadgeClass}`}>
                {daysLeft < 0 ? `${Math.abs(daysLeft)}d overdue` : daysLeft === 0 ? "Due today!" : `${daysLeft}d left`}
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
              <div className="dd-summary-val">{files.length}</div>
              <div className="dd-summary-key">Files</div>
            </div>
          </div>
          <div className="dd-summary-chip">
            <span className="dd-summary-icon">🕐</span>
            <div>
              <div className="dd-summary-val">{timeAgo(projectData?.submitted_at) || "—"}</div>
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
          <span>💰 ₹{project.min_budget} – ₹{project.max_budget}</span>
          <span>📅 Due: {project.due_date ? new Date(project.due_date).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "N/A"}</span>
          {submissionCount > 0 && <span>📬 v{submissionCount} submitted</span>}
        </div>
      </div>

      {/* ════ PROGRESS STEPPER ════ */}
      <div className="dd-card dd-stepper-card" style={{ "--ci": 0.5 }}>
        <div className="dd-stepper">
          {STAGES.filter(s => s.key !== "revision_requested").map((stage, i) => {
            // map stage index for display (skip revision in linear flow)
            const displayOrder = ["not_started","in_progress","submitted","pending","approved"];
            const si = displayOrder.indexOf(stage.key);
            const isActive = stage.key === reviewStatus || (reviewStatus === "revision_requested" && stage.key === "submitted");
            const isDone = si < currentStageIdx && !isActive;
            return (
              <React.Fragment key={stage.key}>
                <div className={`dd-step ${isDone ? "done" : ""} ${isActive ? "active" : ""}`}>
                  <div className="dd-step-circle">{isDone ? "✓" : stage.icon}</div>
                  <div className="dd-step-label">{stage.label}</div>
                </div>
                {i < 4 && <div className={`dd-step-line ${si < currentStageIdx ? "done" : ""}`} />}
              </React.Fragment>
            );
          })}
        </div>
        {reviewStatus === "revision_requested" && (
          <div className="dd-revision-banner">
            ↩ Client requested revisions — update your work and resubmit
          </div>
        )}
      </div>

      {/* ════ BODY ════ */}
      <div className="dd-workspace-body">

        {/* LEFT */}
        <div className="dd-workspace-left">

          {/* Project context */}
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

          {/* Client feedback - always show */}
          <div className={`dd-card dd-feedback-card ${reviewStatus === "revision_requested" ? "dd-feedback-urgent" : ""}`} style={{ "--ci": 2 }}>
            <div className="dd-feedback-header">
              <h3 className="dd-card-title">💬 Client Feedback</h3>
              <span className={`dd-status ${reviewStatus === "revision_requested" ? "review" : reviewStatus === "approved" ? "approved" : "pending"}`}>
                {reviewStatus === "revision_requested" ? "Changes Requested" : reviewStatus === "approved" ? "Approved" : "Awaiting Review"}
              </span>
            </div>
            {reviewFeedback ? (
              <div className="dd-feedback-body">
                <p className="dd-card-desc">{reviewFeedback}</p>
                {projectData?.reviewed_at && (
                  <p className="dd-feedback-time">Received {timeAgo(projectData.reviewed_at)}</p>
                )}
              </div>
            ) : (
              <p className="dd-card-desc dd-empty-state">
                {reviewStatus === "pending" ? "⏳ Waiting for client to review your submission…" : "No feedback yet."}
              </p>
            )}
          </div>

          {/* Submission history */}
          <div className="dd-workspace-safe">
            <ErrorBoundary label="Workspace Activity">
              <SubmissionHistory projectId={project.id} />
            </ErrorBoundary>
          </div>
        </div>

        {/* RIGHT */}
        <div className="dd-workspace-actions">

          {/* Quick actions */}
          <div className="dd-card dd-quick-actions" style={{ "--ci": 3 }}>
            <h3 className="dd-card-title">⚡ Quick Actions</h3>
            <div className="dd-qa-grid">
              <button className="dd-qa-btn" onClick={() => { setActiveTab("files"); fileInputRef.current?.click(); }}>
                <span className="dd-qa-icon">📤</span>
                <span>Upload File</span>
              </button>
              <button className="dd-qa-btn" onClick={() => setActiveTab("deliverables")} disabled={isLocked}>
                <span className="dd-qa-icon">🔗</span>
                <span>Update Links</span>
              </button>
              <button className="dd-qa-btn" onClick={() => setActiveTab("feedback")}>
                <span className="dd-qa-icon">💬</span>
                <span>View Feedback</span>
              </button>
              <button
                className="dd-qa-btn dd-qa-btn-primary"
                onClick={() => { if (repoLink) setShowConfirm(true); }}
                disabled={isLocked || !repoLink}
              >
                <span className="dd-qa-icon">🚀</span>
                <span>Submit {versionLabel}</span>
              </button>
            </div>
          </div>

          {/* Tabbed panel */}
          <div className="dd-card dd-tab-card" style={{ "--ci": 4 }}>
            <div className="dd-tabs">
              {["deliverables", "files", "feedback"].map((tab) => (
                <button
                  key={tab}
                  className={`dd-tab ${activeTab === tab ? "active" : ""}`}
                  onClick={() => setActiveTab(tab)}
                >
                  {tab === "deliverables" ? "🚀 Submit" : tab === "files" ? `📁 Files ${files.length > 0 ? `(${files.length})` : ""}` : "💬 Feedback"}
                </button>
              ))}
            </div>

            {/* DELIVERABLES TAB */}
            {activeTab === "deliverables" && (
              <div className="dd-tab-body dd-deliverables">
                <div className="dd-field-group">
                  <label className="dd-field-label">GitHub / Repository URL <span className="dd-required">*</span></label>
                  <div className="dd-input-row">
                    <input
                      type="text"
                      placeholder="https://github.com/you/project"
                      className="dd-input"
                      value={repoLink}
                      onChange={(e) => { setRepoLink(e.target.value); if (submissionError) setSubmissionError(""); }}
                      disabled={isLocked}
                    />
                    {repoLink && (
                      <div className="dd-input-actions">
                        <button className="dd-icon-btn" title="Copy" onClick={() => copyToClipboard(repoLink, "repo")}>
                          {copiedField === "repo" ? "✓" : "⎘"}
                        </button>
                        <a href={repoLink} target="_blank" rel="noreferrer" className="dd-icon-btn" title="Open">↗</a>
                      </div>
                    )}
                  </div>
                </div>

                <div className="dd-field-group">
                  <label className="dd-field-label">Live Demo URL</label>
                  <div className="dd-input-row">
                    <input
                      type="text"
                      placeholder="https://your-demo.vercel.app"
                      className="dd-input"
                      value={demoLink}
                      onChange={(e) => { setDemoLink(e.target.value); if (submissionError) setSubmissionError(""); }}
                      disabled={isLocked}
                    />
                    {demoLink && (
                      <div className="dd-input-actions">
                        <button className="dd-icon-btn" title="Copy" onClick={() => copyToClipboard(demoLink, "demo")}>
                          {copiedField === "demo" ? "✓" : "⎘"}
                        </button>
                        <a href={demoLink} target="_blank" rel="noreferrer" className="dd-icon-btn" title="Open">↗</a>
                      </div>
                    )}
                  </div>
                </div>

                <div className="dd-field-group">
                  <label className="dd-field-label">
                    Update Notes
                    {submissionCount > 0 && <span className="dd-version-tag">{versionLabel}</span>}
                  </label>
                  <textarea
                    placeholder={`What changed in ${versionLabel}? (optional)`}
                    className="dd-input"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    disabled={isLocked}
                  />
                </div>

                <button
                  className="dd-bid-btn dd-submit-btn"
                  onClick={() => { if (repoLink) setShowConfirm(true); }}
                  disabled={reviewStatus === "approved" || !repoLink || submissionState === "submitting"}
                >
                  {submissionState === "submitting" ? (
                    <><span className="dd-spinner" /> Submitting…</>
                  ) : (
                    `🚀 Submit ${versionLabel}`
                  )}
                </button>

                {submissionState === "submitted" && (
                  <div className="dd-success-msg">⏳ Sent for review — client will be notified</div>
                )}
                {submissionError && <div className="dd-error-msg">{submissionError}</div>}

                {!repoLink && !demoLink && !notes && (
                  <p className="dd-card-desc dd-empty-state">No deliverables submitted yet</p>
                )}
                {reviewStatus === "revision_requested" && (
                  <div className="dd-revision-hint">
                    ↩ Address the client feedback above, then resubmit
                  </div>
                )}
                {projectData?.submitted_at && (
                  <p className="dd-card-desc dd-submitted-time">
                    Last submitted {timeAgo(projectData.submitted_at)}
                  </p>
                )}
              </div>
            )}

            {/* FILES TAB */}
            {activeTab === "files" && (
              <div className="dd-tab-body">
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="dd-file-input"
                  onChange={(e) => handleUpload(e.target.files)}
                />

                {/* Drop zone */}
                <div
                  ref={dropZoneRef}
                  className={`dd-drop-zone ${isDropZoneActive ? "active" : ""}`}
                  onDragOver={(e) => { e.preventDefault(); setIsDropZoneActive(true); }}
                  onDragLeave={() => setIsDropZoneActive(false)}
                  onDrop={handleDropZoneDrop}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <span className="dd-drop-icon">📤</span>
                  <span className="dd-drop-label">Drop files here or click to upload</span>
                  <span className="dd-drop-hint">Any file type accepted</span>
                </div>

                {uploadProgress > 0 && (
                  <div className="dd-upload-progress">
                    <div className="dd-upload-progress-fill" style={{ width: `${uploadProgress}%` }} />
                  </div>
                )}
                {uploadNotice && <p className="dd-card-desc dd-success-msg">{uploadNotice}</p>}

                {files.length > 0 ? (
                  <div className="dd-file-list">
                    {files.map((file, index) => (
                      <div
                        key={file.id}
                        className={`dd-file-item ${dragOver === index ? "dd-drag-over" : ""}`}
                        draggable
                        onDragStart={() => setDragIndex(index)}
                        onDragOver={(e) => { e.preventDefault(); setDragOver(index); }}
                        onDrop={() => handleReorder(index)}
                        onDragEnd={() => { setDragIndex(null); setDragOver(null); }}
                      >
                        <span className="dd-file-type-icon">{getFileIcon(file.file_name)}</span>
                        <div className="dd-file-info">
                          <a
                            href={`${API_BASE_URL}/uploads/${file.file_name}`}
                            target="_blank"
                            rel="noreferrer"
                            className="dd-file-link"
                          >
                            {formatFileName(file.file_name)}
                          </a>
                          {(file.size || file.uploaded_at) && (
                            <span className="dd-file-meta">
                              {file.size ? formatBytes(file.size) : ""}
                              {file.size && file.uploaded_at ? " · " : ""}
                              {file.uploaded_at ? timeAgo(file.uploaded_at) : ""}
                            </span>
                          )}
                        </div>
                        <span className="dd-drag-handle" title="Drag to reorder">⠿</span>
                        <button className="dd-file-delete" onClick={() => handleDelete(file.id)} title="Delete file">✕</button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="dd-card-desc dd-empty-state" style={{ textAlign: "center", padding: "12px 0" }}>
                    No files uploaded yet
                  </p>
                )}
              </div>
            )}

            {/* FEEDBACK TAB */}
            {activeTab === "feedback" && (
              <div className="dd-tab-body">
                <div className={`dd-feedback-inner ${reviewStatus === "revision_requested" ? "urgent" : ""}`}>
                  <div className="dd-feedback-status-row">
                    <span className={`dd-status ${reviewStatus === "revision_requested" ? "review" : reviewStatus === "approved" ? "approved" : "pending"}`}>
                      {reviewStatus === "revision_requested" ? "↩ Changes Requested" : reviewStatus === "approved" ? "✓ Approved" : "⏳ Awaiting Review"}
                    </span>
                    {projectData?.reviewed_at && (
                      <span className="dd-feedback-time">{timeAgo(projectData.reviewed_at)}</span>
                    )}
                  </div>
                  {reviewFeedback ? (
                    <p className="dd-card-desc" style={{ marginTop: 10 }}>{reviewFeedback}</p>
                  ) : (
                    <p className="dd-card-desc dd-empty-state">
                      {reviewStatus === "pending" ? "⏳ Waiting for client to review…" : "No feedback yet from client."}
                    </p>
                  )}
                  {reviewStatus === "revision_requested" && (
                    <button
                      className="dd-bid-btn"
                      style={{ marginTop: 14, width: "100%" }}
                      onClick={() => setActiveTab("deliverables")}
                    >
                      → Update & Resubmit
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* PROGRESS */}
          <div className="dd-card" style={{ "--ci": 7 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <h3 className="dd-card-title">📊 Progress</h3>
              <span className="dd-progress-pct">
                {reviewStatus === "approved" ? "100%" : reviewStatus === "pending" ? "80%" : files.length > 0 ? "50%" : "20%"}
              </span>
            </div>
            <div className="dd-workspace-progress">
              <div
                className="dd-workspace-progress-fill"
                style={{
                  width: reviewStatus === "approved" ? "100%" : reviewStatus === "pending" ? "80%" : files.length > 0 ? "50%" : "20%",
                }}
              />
            </div>
            <p className="dd-card-desc" style={{ marginTop: 8, fontSize: 12 }}>
              {nextAction}
            </p>
          </div>

          {/* MARK COMPLETE — FIX #11: wired onClick + use live projectData.status */}
          {(projectData?.status ?? project.status) === "active" && (
            <div className="dd-card" style={{ "--ci": 8 }}>
              <h3 className="dd-card-title">✅ Ready to Wrap Up?</h3>
              <p className="dd-card-desc">
                Mark this project complete after final approval.
              </p>
              <button
                className="dd-bid-btn"
                onClick={handleMarkComplete}
                disabled={reviewStatus !== "approved"}
                title={reviewStatus !== "approved" ? "Requires client approval first" : ""}
              >
                Mark Complete
              </button>
              {reviewStatus !== "approved" && (
                <p className="dd-card-desc" style={{ fontSize: 11, marginTop: 6, opacity: 0.6 }}>
                  Requires client approval
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default React.memo(DeveloperProjectWorkspace);