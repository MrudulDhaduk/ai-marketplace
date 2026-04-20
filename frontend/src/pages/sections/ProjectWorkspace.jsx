import "./ProjectWorkspace.css";
import { useEffect, useRef, useState } from "react";

export default function ProjectWorkspace({ project, onBack }) {
  const [files, setFiles] = useState([]);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [dragIndex, setDragIndex] = useState(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (!project?.id) return;

    const fetchFiles = async () => {
      try {
        const response = await fetch(
          `http://localhost:5000/projects/${project.id}/files`,
        );
        if (!response.ok) return;
        const data = await response.json();
        setFiles(data);
      } catch (error) {
        console.error("Failed to fetch files", error);
      }
    };

    fetchFiles();
  }, [project?.id]);

  const handleDelete = async (id) => {
    try {
      await fetch(`http://localhost:5000/files/${id}`, { method: "DELETE" });
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
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        updated.map((file, idx) => ({ id: file.id, position: idx })),
      ),
    }).catch((error) => {
      console.error("Failed to reorder files", error);
    });
  };

  const handleUpload = (selectedFiles) => {
    if (!project?.id || !selectedFiles?.length) return;

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
    xhr.send(formData);
  };

  const formatFileName = (name) => {
    if (name.length <= 25) return name;

    const ext = name.split(".").pop();
    const base = name.substring(0, name.lastIndexOf("."));

    return `${base.slice(0, 12)}...${base.slice(-5)}.${ext}`;
  };
  if (!project) return null;

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
          <span
            className={`dd-status ${
              project.status === "active" ? "active" : "completed"
            }`}
          >
            {project.status === "active" ? "In Progress" : "Completed"}
          </span>
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
        </div>

        <div className="dd-workspace-actions">
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
          </div>

          <div className="dd-card" style={{ "--ci": 4 }}>
            <h3 className="dd-card-title">Progress</h3>
            <div className="dd-workspace-progress">
              <div className="dd-workspace-progress-fill" />
            </div>
          </div>

          {project.status === "active" && (
            <div className="dd-card" style={{ "--ci": 5 }}>
              <h3 className="dd-card-title">Ready to Submit?</h3>
              <p className="dd-card-desc">
                Mark this project complete after final checks.
              </p>
              <button className="dd-bid-btn">Mark Complete</button>
            </div>
          )}

          {files.length > 0 && (
            <div className="dd-card" style={{ "--ci": 7 }}>
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
        </div>
      </div>
    </div>
  );
}
