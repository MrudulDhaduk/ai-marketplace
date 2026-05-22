/**
 * FileManager.jsx — Shared file management component
 *
 * Extracted in Phase 6 Step 3c from DeveloperProjectWorkspace and
 * ClientProjectWorkspace.
 *
 * Props:
 *   projectId  — number|string
 *   files      — array from useProjectFiles
 *   isLoading  — boolean
 *   readonly   — boolean: true = client view (read-only list + download links)
 *                         false = developer view (upload, drag-reorder, delete)
 *   onUpload   — optional (FileList) => void callback (readonly=false only)
 *   onDelete   — optional (fileId) => void callback (readonly=false only)
 *
 * Internal state: isDropZoneActive
 * Hooks (called unconditionally): useFileUpload, useFileReorder
 * Refs: fileInputRef, dropZoneRef
 */
import { useRef, useState } from "react";
import { apiRequest, API_BASE_URL } from "../../../lib/api";
import { getFileIcon, formatBytes, getFileExt } from "../../../utils/files";
import { timeAgo } from "../../../utils/time";
import { useFileUpload } from "../../../hooks/useFileUpload";
import { useFileReorder } from "../../../hooks/useFileReorder";
import { invalidateProjectFiles } from "../../../hooks/useProjectQueries";

/* ── helpers ──────────────────────────────────────────────────────────── */

/**
 * Strips timestamp prefix from filename and truncates long names.
 * e.g. "report_1700000000.pdf" → "report.pdf"
 *      "very-long-filename-that-exceeds-limit.pdf" → "very-long-filen….pdf"
 */
function formatFileName(name) {
  if (!name) return "";
  const cleaned = name.replace(/_\d{10,}(?=\.)/, "");
  if (cleaned.length <= 28) return cleaned;
  const ext = cleaned.split(".").pop();
  const base = cleaned.substring(0, cleaned.lastIndexOf("."));
  return `${base.slice(0, 14)}…${base.slice(-4)}.${ext}`;
}

/* ══════════════════════════════════════════════════════════════════════
   COMPONENT
══════════════════════════════════════════════════════════════════════ */
export default function FileManager({
  projectId,
  files,
  isLoading,
  readonly,
  onUpload,
  onDelete,
}) {
  // Internal UI state
  const [isDropZoneActive, setIsDropZoneActive] = useState(false);

  // Refs for file input and drop zone
  const fileInputRef = useRef(null);
  const dropZoneRef  = useRef(null);

  // Hooks called unconditionally — UI is conditionally rendered based on readonly
  const { upload: uploadFiles, progress: uploadProgress, notice: uploadNotice } =
    useFileUpload(projectId);

  const {
    dragIndex,
    dragOver,
    handleDragStart,
    handleDragEnter,
    handleReorder,
    setDragOver,
  } = useFileReorder(projectId, files);

  /* ── upload handler ─────────────────────────────────────────────── */
  const handleUpload = (selectedFiles) => {
    if (!selectedFiles?.length) return;
    uploadFiles(selectedFiles);
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (onUpload) onUpload(selectedFiles);
  };

  /* ── drop zone handlers ─────────────────────────────────────────── */
  const handleDropZoneDrop = (e) => {
    e.preventDefault();
    setIsDropZoneActive(false);
    const dropped = e.dataTransfer.files;
    if (dropped?.length) handleUpload(dropped);
  };

  /* ── delete handler ─────────────────────────────────────────────── */
  const handleDelete = async (id) => {
    if (!window.confirm("Delete this file?")) return;
    try {
      const delRes = await apiRequest(`/files/${id}`, { method: "DELETE" });
      if (!delRes.ok) return;
      // Invalidate files cache — TanStack Query refetches the updated list
      invalidateProjectFiles(projectId);
      if (onDelete) onDelete(id);
    } catch (e) {
      console.error("Failed to delete file", e);
    }
  };

  /* ══════════════════════════════════════════════════════════════════
     READONLY MODE — client view: read-only file list with download links
  ══════════════════════════════════════════════════════════════════ */
  if (readonly) {
    if (isLoading) {
      return <p className="dd-card-desc">Loading files…</p>;
    }

    if (!files || files.length === 0) {
      return (
        <p className="dd-card-desc">
          No files yet — waiting for developer submission.
        </p>
      );
    }

    return (
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
    );
  }

  /* ══════════════════════════════════════════════════════════════════
     EDITABLE MODE — developer view: upload drop zone, progress bar,
     drag-reorder, delete buttons
  ══════════════════════════════════════════════════════════════════ */
  return (
    <div>
      {/* Hidden file input */}
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

      {/* Upload progress bar */}
      {uploadProgress > 0 && (
        <div className="dd-upload-progress">
          <div
            className="dd-upload-progress-fill"
            style={{ width: `${uploadProgress}%` }}
          />
        </div>
      )}

      {/* Upload success notice */}
      {uploadNotice && (
        <p className="dd-card-desc dd-success-msg">{uploadNotice}</p>
      )}

      {/* File list */}
      {files && files.length > 0 ? (
        <div className="dd-file-list">
          {files.map((file, index) => (
            <div
              key={file.id}
              className={`dd-file-item ${dragOver === index ? "dd-drag-over" : ""}`}
              draggable
              onDragStart={() => handleDragStart(index)}
              onDragOver={(e) => { e.preventDefault(); handleDragEnter(index); }}
              onDrop={() => handleReorder(index)}
              onDragEnd={() => { setDragOver(null); }}
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
              <button
                className="dd-file-delete"
                onClick={() => handleDelete(file.id)}
                title="Delete file"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p
          className="dd-card-desc dd-empty-state"
          style={{ textAlign: "center", padding: "12px 0" }}
        >
          No files uploaded yet
        </p>
      )}
    </div>
  );
}
