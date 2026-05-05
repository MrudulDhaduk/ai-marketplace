import { useEffect, useMemo, useState } from "react";
import "./ProjectWorkspace.css";
import { socket } from "../../socket";
import SubmissionHistory from "./components/SubmissionHistory";

const STATUS_META = {
  active: { label: "Active", cls: "active" },
  review: { label: "In Review", cls: "review" },
  completed: { label: "Completed", cls: "completed" },
  draft: { label: "Draft", cls: "draft" },
};

function safeUrl(url) {
  if (typeof url !== "string") return "";

  const trimmed = url.trim();
  if (!trimmed) return "";

  if (!trimmed.startsWith("http")) {
    return "https://" + trimmed;
  }

  return trimmed;
}

export default function ClientProjectWorkspace({ project, onBack }) {
  const [files, setFiles] = useState([]);
  const [deliverables, setDeliverables] = useState({
    repoLink: "",
    demoLink: "",
    notes: "",
  });
  const [reviewFeedback, setReviewFeedback] = useState("");
  const [reviewStatus, setReviewStatus] = useState("pending");
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewMessage, setReviewMessage] = useState("");
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [loadingDeliverables, setLoadingDeliverables] = useState(false);
  const [error, setError] = useState("");
  const [submittedAt, setSubmittedAt] = useState(null);

  const statusMeta = STATUS_META[project?.status] || STATUS_META.draft;
  const progressPct =
    reviewStatus === "approved"
      ? 100
      : reviewStatus === "pending"
        ? 80
        : files.length > 0
          ? 50
          : 20;

  const token = useMemo(() => localStorage.getItem("token"), []);

  useEffect(() => {
    if (!project?.id) return;
    let cancelled = false;

    const fetchFiles = async () => {
      setLoadingFiles(true);
      setError("");
      try {
        const res = await fetch(
          `http://localhost:5000/projects/${project.id}/files`,
          {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          },
        );
        if (!res.ok) throw new Error(`Failed to fetch files: ${res.status}`);
        const data = await res.json();
        if (!cancelled) setFiles(Array.isArray(data) ? data : []);
      } catch (e) {
        if (!cancelled) {
          console.error(e);
          setFiles([]);
          setError("Could not load project files.");
        }
      } finally {
        if (!cancelled) setLoadingFiles(false);
      }
    };

    fetchFiles();
    return () => {
      cancelled = true;
    };
  }, [project?.id, token]);

  useEffect(() => {
    if (!project?.id) return;
    let cancelled = false;

    const fetchDeliverables = async () => {
      setLoadingDeliverables(true);
      setError("");

      try {
        const res = await fetch(
          `http://localhost:5000/api/projects/${project.id}`,
          {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          },
        );

        if (!res.ok) {
          throw new Error(
            `Failed to fetch project deliverables: ${res.status}`,
          );
        }

        const found = await res.json();

        if (cancelled) return;

        const repoLink = safeUrl(found?.deliverable_link);
        const demoLink = safeUrl(found?.demo_link);
        const notes =
          typeof found?.submission_note === "string"
            ? found.submission_note
            : "";

        setDeliverables({ repoLink, demoLink, notes });
        setReviewStatus(found?.review_status || "pending");
        setSubmittedAt(found?.submitted_at ?? null);
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

    return () => {
      cancelled = true;
    };
  }, [project?.id, token]);

  // 🔌 Socket.IO setup
  useEffect(() => {
    if (!project?.id) return;

    // Join project room
    socket.emit("join_project", project.id);

    // Listen for submission updates
    const handleProjectSubmitted = async () => {
      try {
        const res = await fetch(
          `http://localhost:5000/api/projects/${project.id}`,
          {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          },
        );
        if (!res.ok) return;
        const data = await res.json();

        const repoLink = safeUrl(data?.deliverable_link);
        const demoLink = safeUrl(data?.demo_link);
        const notes =
          typeof data?.submission_note === "string" ? data.submission_note : "";

        setDeliverables({ repoLink, demoLink, notes });
        setReviewStatus(data?.review_status || "pending");
        setSubmittedAt(data?.submitted_at ?? null);
      } catch (err) {
        console.error("Failed to fetch updated deliverables", err);
      }
    };

    // Listen for review updates
    const handleProjectReviewed = async () => {
      const res = await fetch(
        `http://localhost:5000/api/projects/${project.id}`,
        {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        },
      );

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

    socket.on("project_submitted", handleProjectSubmitted);
    socket.on("project_reviewed", handleProjectReviewed);

    return () => {
      socket.off("project_submitted", handleProjectSubmitted);
      socket.off("project_reviewed", handleProjectReviewed);
    };
  }, [project?.id, token]);

  const handleSubmitReview = async (action) => {
    if (!project?.id) return;
    setReviewLoading(true);
    setError("");

    try {
      const res = await fetch(
        `http://localhost:5000/projects/${project.id}/review`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            action,
            feedback: reviewFeedback,
          }),
        },
      );

      if (!res.ok) {
        throw new Error(`Failed to submit review: ${res.status}`);
      }

      const data = await res.json();
      setReviewStatus(data.project.review_status);
      setReviewMessage(
        action === "approve" ? "✓ Project approved" : "Revision request sent",
      );
      setTimeout(() => setReviewMessage(""), 3000);
    } catch (e) {
      console.error(e);
      setError("Failed to submit review");
    } finally {
      setReviewLoading(false);
    }
  };

  if (!project) return null;
  return (
    <div className="dd-content dd-workspace">
      <div className="dd-card dd-workspace-header" style={{ "--ci": 0 }}>
        <div className="dd-workspace-top">
          <button className="dd-bid-btn dd-workspace-back" onClick={onBack}>
            ← Back to Projects
          </button>
        </div>

        <div className="dd-workspace-title-row">
          <h2 className="dd-card-title">{project.title}</h2>
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <span className={`dd-status ${statusMeta.cls}`}>
              {statusMeta.label}
            </span>
            <span className={`dd-status ${reviewStatus}`}>
              {reviewStatus === "pending"
                ? "Under Review"
                : reviewStatus === "revision_requested"
                  ? "Changes Requested"
                  : "Approved"}
            </span>
          </div>
        </div>

        <div className="dd-card-meta dd-workspace-meta">
          <span>
            Budget:{" "}
            {project.budget ??
              `₹${project.min_budget ?? 0} – ₹${project.max_budget ?? 0}`}
          </span>
          <span>
            Due:{" "}
            {project.due_date
              ? new Date(project.due_date).toLocaleDateString()
              : "N/A"}
          </span>{" "}
        </div>
      </div>

      <div className="dd-workspace-body">
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

          <div className="dd-card" style={{ "--ci": 3 }}>
            <h3 className="dd-card-title">Assigned Developer</h3>
            <p className="dd-card-desc">
              {project.developer_name ||
                project.assignedDeveloper ||
                "Not assigned yet (accept a bid to assign)."}
            </p>
          </div>

          <SubmissionHistory projectId={project.id} token={token} />
        </div>

        <div className="dd-workspace-actions">
          <div className="dd-card" style={{ "--ci": 4 }}>
            <h3 className="dd-card-title">Files</h3>
            <p className="dd-card-desc">
              {loadingFiles
                ? "Loading files…"
                : files.length
                  ? "Uploaded project files."
                  : "Upload files or wait for developer submission"}
            </p>

            {files.length > 0 && (
              <div className="dd-file-list">
                {files.map((file) => (
                  <div key={file.id ?? file.file_name} className="dd-file-item">
                    <a
                      href={`http://localhost:5000/uploads/${file.file_name}`}
                      target="_blank"
                      rel="noreferrer"
                      className="dd-file-link"
                    >
                      📄 {file.file_name}
                    </a>
                    <a
                      className="dd-bid-btn"
                      href={`http://localhost:5000/uploads/${file.file_name}`}
                      download
                    >
                      Download
                    </a>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="dd-card" style={{ "--ci": 5 }}>
            <h3 className="dd-card-title">Deliverables</h3>
            <p className="dd-card-desc">
              {loadingDeliverables
                ? "Loading deliverables…"
                : "Links and notes for final delivery."}
            </p>

            <div className="dd-card-meta dd-workspace-meta">
              <span>
                Repo:{" "}
                {deliverables.repoLink ? (
                  <a
                    href={deliverables.repoLink}
                    target="_blank"
                    rel="noreferrer"
                  >
                    🔗 Open Repo
                  </a>
                ) : (
                  "—"
                )}
              </span>
              <span>
                Demo:{" "}
                {deliverables.demoLink ? (
                  <a
                    href={deliverables.demoLink}
                    target="_blank"
                    rel="noreferrer"
                  >
                    🔗 Open Demo
                  </a>
                ) : (
                  "—"
                )}
              </span>
            </div>

            {!deliverables.repoLink && !deliverables.demoLink && !deliverables.notes ? (
              <p className="dd-card-desc">No deliverables submitted yet</p>
            ) : deliverables.notes ? (
              <p className="dd-card-desc dd-workspace-description">
                {deliverables.notes}
              </p>
            ) : (
              <p className="dd-card-desc">No notes yet.</p>
            )}

            {submittedAt && (
              <p className="dd-card-desc">
                Submitted: {new Date(submittedAt).toLocaleString()}
              </p>
            )}
          </div>

          

          <div className="dd-card" style={{ "--ci": 6 }}>
            <h3 className="dd-card-title">Progress</h3>
            <div
              className="dd-workspace-progress"
              aria-label={`Progress: ${progressPct}%`}
            >
              <div
                className="dd-workspace-progress-fill"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>

          <div className="dd-card" style={{ "--ci": 7 }}>
            <h3 className="dd-card-title">Review & Approval</h3>
            <p className="dd-card-desc">
              {reviewStatus === "approved"
                ? "✓ Project approved"
                : reviewStatus === "revision_requested"
                  ? "Revision requested"
                  : "Review deliverables and approve or request changes."}
            </p>

            {reviewStatus !== "approved" && (
              <>
                <textarea
                  className="dd-input"
                  placeholder="Feedback for developer (e.g., requested changes, improvements)..."
                  value={reviewFeedback}
                  onChange={(e) => setReviewFeedback(e.target.value)}
                  style={{ minHeight: "100px", marginTop: "10px" }}
                  disabled={reviewLoading}
                />

                <div
                  style={{
                    display: "flex",
                    gap: 10,
                    flexWrap: "wrap",
                    marginTop: "10px",
                  }}
                >
                  <button
                    className="dd-bid-btn"
                    type="button"
                    onClick={() => handleSubmitReview("approve")}
                    disabled={reviewLoading}
                  >
                    {reviewLoading ? "Processing..." : "✓ Approve"}
                  </button>
                  <button
                    className="dd-bid-btn"
                    type="button"
                    onClick={() => handleSubmitReview("revision")}
                    disabled={reviewLoading}
                  >
                    {reviewLoading ? "Processing..." : "Request Changes"}
                  </button>
                </div>
              </>
            )}

            {reviewMessage && (
              <p className="dd-card-desc" style={{ marginTop: "10px" }}>
                {reviewMessage}
              </p>
            )}

            {error && (
              <p className="dd-card-desc" style={{ marginTop: "10px" }}>
                {error}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
