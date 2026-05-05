import "./ProjectWorkspace.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { socket } from "../../socket";
import SubmissionHistory from "./components/SubmissionHistory";
import React from "react";  

function DeveloperProjectWorkspace({ project, onBack }) {
  const [files, setFiles] = useState([]);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [dragIndex, setDragIndex] = useState(null);
  const fileInputRef = useRef(null);
  const [repoLink, setRepoLink] = useState("");
  const [demoLink, setDemoLink] = useState("");
  const [notes, setNotes] = useState("");
  const [reviewStatus, setReviewStatus] = useState("pending");
  const [reviewFeedback, setReviewFeedback] = useState("");
  const [projectData, setProjectData] = useState(project);
  const [submissionState, setSubmissionState] = useState("idle");
  const [submissionError, setSubmissionError] = useState("");
  const [uploadNotice, setUploadNotice] = useState("");
  const token = useMemo(() => localStorage.getItem("token"), []);

  useEffect(() => {
    if (!project?.id) return;

    const fetchFiles = async () => {
      try {
        const response = await fetch(
          `http://localhost:5000/projects/${project.id}/files`,
          {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          },
        );
        if (!response.ok) return;
        const data = await response.json();
        setFiles(data);
      } catch (error) {
        console.error("Failed to fetch files", error);
      }
    };

    fetchFiles();
  }, [project?.id, token]);
  useEffect(() => {
    if (!project?.id) return;

    const fetchDeliverables = async () => {
      try {
        const res = await fetch(
          `http://localhost:5000/api/projects/${project.id}`,
          {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          },
        );

        if (!res.ok) {
          setSubmissionError("Failed to load project data");
          return;
        }

        const data = await res.json();

        // 🔥 PREFILL INPUTS
        setRepoLink(data?.deliverable_link || "");
        setDemoLink(data?.demo_link || "");
        setNotes(data?.submission_note || "");
        setReviewStatus(data?.review_status || "pending");
        setReviewFeedback(data?.review_feedback || "");
        setProjectData(data);
      } catch (err) {
        console.error("Failed to fetch deliverables", err);
        setSubmissionError("Failed to load project data");
      }
    };

    fetchDeliverables();
  }, [project?.id, token]);

  // 🔌 Socket.IO setup
  useEffect(() => {
    if (!project?.id) return;

    // Join project room
    socket.emit("join_project", project.id);

    // Listen for project review updates
    const handleProjectReviewed = async () => {
      try {
        const res = await fetch(
          `http://localhost:5000/api/projects/${project.id}`,
          {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          },
        );
        if (!res.ok) return;
        const data = await res.json();

        setReviewStatus(data?.review_status || "pending");
        setReviewFeedback(data?.review_feedback || "");
        setProjectData(data);
      } catch (err) {
        console.error("Failed to fetch updated project data", err);
      }
    };

    // Listen for submission confirmation
    const handleProjectSubmitted = async () => {
      const res = await fetch(
        `http://localhost:5000/api/projects/${project.id}`,
        {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        },
      );
      if (!res.ok) return;
      const data = await res.json();
      

      setRepoLink(data?.deliverable_link || "");
      setDemoLink(data?.demo_link || "");
      setNotes(data?.submission_note || "");
      setReviewStatus(data?.review_status || "pending");
      setProjectData(data);
    };

    socket.on("project_reviewed", handleProjectReviewed);
    socket.on("project_submitted", handleProjectSubmitted);

    return () => {
      socket.off("project_reviewed", handleProjectReviewed);
      socket.off("project_submitted", handleProjectSubmitted);
    };
  }, [project?.id, token]);
  const handleDelete = async (id) => {
    if (!window.confirm("Delete this file?")) return;
    try {
      const delRes = await fetch(`http://localhost:5000/files/${id}`, {
        method: "DELETE",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!delRes.ok) return;
      setFiles((prev) => prev.filter((file) => file.id !== id));
    } catch (error) {
      console.error("Failed to delete file", error);
    }
  };

  const handleReorder = (dropIndex) => {
    if (dragIndex === null || dragIndex === dropIndex) return;

    const updated = [...files];
    const [dragged] = updated.splice(dragIndex, 1);
    updated.splice(dropIndex, 0, dragged);

    setFiles(updated);
    setDragIndex(null);

    fetch("http://localhost:5000/files/reorder", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(
        updated.map((file, idx) => ({ id: file.id, position: idx })),
      ),
    }).catch((error) => {
      console.error("Failed to reorder files", error);
    });
  };

  const handleUpload = (selectedFiles) => {
    if (!project?.id || !selectedFiles?.length) return;

    setUploadNotice("");

    const formData = new FormData();
    Array.from(selectedFiles).forEach((file) => {
      formData.append("files", file);
    });

    const xhr = new XMLHttpRequest();

    xhr.upload.onprogress = (e) => {
      if (!e.total) return;
      const percent = Math.round((e.loaded * 100) / e.total);
      setUploadProgress(percent);
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const response = JSON.parse(xhr.responseText);
          if (response?.files?.length) {
            setFiles((prev) => [...prev, ...response.files]);
          }
          setUploadNotice("Files uploaded successfully");
          setTimeout(() => setUploadNotice(""), 4000);
        } catch (error) {
          console.error("Invalid upload response", error);
        }
      } else {
        console.error("Upload failed", xhr.responseText);
      }
      setUploadProgress(0);
      if (fileInputRef.current) fileInputRef.current.value = "";
    };

    xhr.onerror = () => {
      setUploadProgress(0);
      console.error("Upload request failed");
    };

    xhr.open("POST", `http://localhost:5000/projects/${project.id}/upload`);
    if (token) {
      xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    }
    xhr.send(formData);
  };

  const formatFileName = (name) => {
    if (!name) return "";

    // Remove timestamp pattern like _1715638293847
    const cleaned = name.replace(/_\d{10,}(?=\.)/, "");

    if (cleaned.length <= 25) return cleaned;

    const ext = cleaned.split(".").pop();
    const base = cleaned.substring(0, cleaned.lastIndexOf("."));

    return `${base.slice(0, 12)}...${base.slice(-5)}.${ext}`;
  };
  if (!project) return null;
  const handleSubmitDeliverables = async () => {
    if (!repoLink) {
      setSubmissionError("Repository link is required");
      return;
    }
    setSubmissionError("");
    setSubmissionState("submitting");
    try {
      const res = await fetch(
        `http://localhost:5000/projects/${project.id}/submit`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            repoLink: repoLink,
            demoLink: demoLink,
            notes,
          }),
        },
      );

      const data = await res.json();

      if (!res.ok) throw new Error(data.message);

      console.log("Deliverables submitted successfully");
      setSubmissionState("submitted");
      setTimeout(() => setSubmissionState("idle"), 3000);
      // Data will be refreshed via socket events
    } catch (err) {
      console.error(err);
      console.error("Submission failed");
      setSubmissionState("idle");
      setSubmissionError("Submission failed");
    }
  };
  return (
    <div className="dd-content dd-workspace">
      <div className="dd-card dd-workspace-header" style={{ "--ci": 0 }}>
        <div className="dd-workspace-top">
          <button className="dd-bid-btn dd-workspace-back" onClick={onBack}>
            ← Back to My Projects
          </button>
        </div>

        <div className="dd-workspace-title-row">
          <h2 className="dd-card-title">{project.title}</h2>
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <span
              className={`dd-status ${
                project.status === "active" ? "active" : "completed"
              }`}
            >
              {project.status === "active" ? "In Progress" : "Completed"}
            </span>
            {reviewStatus === "revision_requested" && (
              <span className="dd-status review">Revision Needed</span>
            )}
            {reviewStatus === "approved" && (
              <span className="dd-status approved">Approved ✓</span>
            )}
            {reviewStatus === "pending" && (
              <span className="dd-status pending">Under Review</span>
            )}
          </div>
        </div>

        <div className="dd-card-meta dd-workspace-meta">
          <span>
            Budget: ₹{project.min_budget} – ₹{project.max_budget}
          </span>
          <span>
            Due: {new Date(project.due_date).toLocaleDateString() || "N/A"}
          </span>
        </div>
      </div>

      <div className="dd-workspace-body">
        {/* LEFT SIDE */}
        <div className="dd-workspace-left">
          <div className="dd-card" style={{ "--ci": 1 }}>
            <h3 className="dd-card-title">Project Description</h3>
            <p className="dd-card-desc dd-workspace-description">
              {project.description || "No description provided yet."}
            </p>
          </div>

          <div className="dd-card" style={{ "--ci": 2 }}>
            <h3 className="dd-card-title">Tags</h3>
            <div className="dd-card-tags">
              {project.tags?.length ? (
                project.tags.map((tag, idx) => (
                  <span
                    key={`${tag}-${idx}`}
                    className="dd-tag"
                    style={{ "--ci": idx }}
                  >
                    {tag}
                  </span>
                ))
              ) : (
                <span className="dd-card-desc">No tags</span>
              )}
            </div>
          </div>
          <div className="dd-workspace-safe">
            <SubmissionHistory projectId={project.id} token={token} />
          </div>
        </div>

        {/* RIGHT SIDE */}
        <div className="dd-workspace-actions">
          {/* FILE UPLOAD */}
          <div className="dd-card" style={{ "--ci": 3 }}>
            <h3 className="dd-card-title">File Upload</h3>
            <p className="dd-card-desc">
              Add your deliverables and supporting files.
            </p>

            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="dd-file-input"
              onChange={(e) => handleUpload(e.target.files)}
            />

            <button
              className="dd-bid-btn"
              onClick={() => fileInputRef.current?.click()}
            >
              Upload Files
            </button>

            {uploadProgress > 0 && (
              <div className="dd-upload-progress">
                <div
                  className="dd-upload-progress-fill"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
            )}

            {uploadNotice ? (
              <p className="dd-card-desc">{uploadNotice}</p>
            ) : null}
          </div>

          {/* UPLOADED FILES (moved up) */}
          {files.length > 0 && (
            <div className="dd-card" style={{ "--ci": 4 }}>
              <h3 className="dd-card-title">Uploaded Files</h3>
              <div className="dd-file-list">
                {files.map((file, index) => (
                  <div
                    key={file.id}
                    className="dd-file-item"
                    draggable
                    onDragStart={() => setDragIndex(index)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => handleReorder(index)}
                    onDragEnd={() => setDragIndex(null)}
                  >
                    <a
                      href={`http://localhost:5000/uploads/${file.file_name}`}
                      target="_blank"
                      rel="noreferrer"
                      className="dd-file-link"
                    >
                      📄 {formatFileName(file.file_name)}
                    </a>

                    <button
                      className="dd-file-delete"
                      onClick={() => handleDelete(file.id)}
                    >
                      ❌
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* CLIENT FEEDBACK */}
          {reviewStatus === "revision_requested" && reviewFeedback && (
            <div className="dd-card" style={{ "--ci": 5 }}>
              <h3 className="dd-card-title">Client Feedback</h3>
              <p className="dd-card-desc dd-workspace-description">
                {reviewFeedback}
              </p>
            </div>
          )}

          {/* SUBMIT DELIVERABLES */}
          <div className="dd-card dd-deliverables" style={{ "--ci": 6 }}>
            <h3 className="dd-card-title">Submit Deliverables</h3>

            <input
              type="text"
              placeholder="GitHub Repo URL"
              className="dd-input"
              value={repoLink}
              onChange={(e) => setRepoLink(e.target.value)}
              disabled={
                reviewStatus === "approved" || reviewStatus === "pending"
              }
            />

            <input
              type="text"
              placeholder="Live Demo URL"
              className="dd-input"
              value={demoLink}
              onChange={(e) => setDemoLink(e.target.value)}
              disabled={
                reviewStatus === "approved" || reviewStatus === "pending"
              }
            />

            <textarea
              placeholder="Additional notes (optional)"
              className="dd-input"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={
                reviewStatus === "approved" || reviewStatus === "pending"
              }
            />

            <button
              className="dd-bid-btn"
              onClick={handleSubmitDeliverables}
              disabled={reviewStatus === "approved" || !repoLink}
            >
              {submissionState === "submitting"
                ? "Submitting..."
                : "Submit Work 🚀"}
            </button>

            {submissionState === "submitted" && (
              <p className="dd-card-desc">⏳ Submission sent for review</p>
            )}

            {submissionError && (
              <p className="dd-card-desc">{submissionError}</p>
            )}

            {!repoLink && !demoLink && !notes && (
              <p className="dd-card-desc">No deliverables submitted yet</p>
            )}

            {reviewStatus === "revision_requested" && (
              <p className="dd-card-desc">
                <span className="dd-status review">
                  Client requested changes — update and resubmit your work
                </span>
              </p>
            )}
            {projectData?.submitted_at && (
              <p className="dd-card-desc">
                Submitted: {new Date(projectData.submitted_at).toLocaleString()}
              </p>
            )}
          </div>

          {/* PROGRESS */}
          <div className="dd-card" style={{ "--ci": 7 }}>
            <h3 className="dd-card-title">Progress</h3>
            <div className="dd-workspace-progress">
              <div
                className="dd-workspace-progress-fill"
                style={{
                  width:
                    reviewStatus === "approved"
                      ? "100%"
                      : reviewStatus === "pending"
                        ? "80%"
                        : files.length > 0
                          ? "50%"
                          : "20%",
                }}
              />
            </div>
          </div>

          {/* FINAL ACTION */}
          {project.status === "active" && (
            <div className="dd-card" style={{ "--ci": 8 }}>
              <h3 className="dd-card-title">Ready to Submit?</h3>
              <p className="dd-card-desc">
                Mark this project complete after final checks.
              </p>
              <button className="dd-bid-btn">Mark Complete</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default React.memo(DeveloperProjectWorkspace);
