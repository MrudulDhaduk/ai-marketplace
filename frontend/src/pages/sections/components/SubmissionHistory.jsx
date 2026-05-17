import { useEffect, useState, useRef } from "react";
import { socket } from "../../../socket";
import "../ProjectWorkspace.css";
import "./SubmissionHistory.css";
import React from "react";
import { apiRequest } from "../../../lib/api";
/* ─── icons ────────────────────────────────────── */
function IEdit() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <path
        d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 1-2-2v-7"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function ITrash() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <polyline
        points="3 6 5 6 21 6"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        d="M10 11v6M14 11v6"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
function ICheck() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <path
        d="M20 6 9 17l-5-5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function IClose() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <path
        d="M18 6 6 18M6 6l12 12"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}
function IClock() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M12 7v5l3 3"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
function IHistory() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <path
        d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M3 3v5h5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M12 7v5l4 2"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function formatDate(iso) {
  const d = new Date(iso);
  const date = d.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const time = d.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return { date, time };
}

/* ─── skeleton shimmer item ────────────────────── */
function SkeletonItem({ delay = 0 }) {
  return (
    <div
      className="sh-timeline-item sh-skeleton-item"
      style={{ "--sk-delay": `${delay}s` }}
    >
      <div className="sh-node-col">
        <div className="sh-node sh-node--skeleton" />
        <div className="sh-connector" />
      </div>
      <div className="sh-card sh-skeleton-card">
        <div className="sh-sk-line sh-sk-line--title" />
        <div className="sh-sk-line sh-sk-line--body" />
        <div className="sh-sk-line sh-sk-line--short" />
      </div>
    </div>
  );
}

/* ─── single timeline entry ─────────────────────── */
function TimelineItem({
  item,
  idx,
  total,
  isLatest,
  editingId,
  editData,
  onEditStart,
  onEditCancel,
  onEditChange,
  onEditSave,
  onDelete,
}) {
  const { date, time } = formatDate(item.submitted_at);
  const isEditing = editingId === item.id;
  const versionNum = total - idx;

  return (
    <div
      className={`sh-timeline-item${isLatest ? " sh-timeline-item--latest" : ""}${isEditing ? " sh-timeline-item--editing" : ""}`}
      style={{ "--ci": item.id }}
    >
      {/* ── Node + connector column ── */}
      <div className="sh-node-col">
        <div className={`sh-node${isLatest ? " sh-node--latest" : ""}`}>
          <span className="sh-node-inner" />
        </div>
        {idx < total - 1 && <div className="sh-connector" />}
      </div>

      {/* ── Card ── */}
      <div className="sh-card">
        {/* Card header */}
        <div className="sh-card-head">
          <div className="sh-card-head-left">
            <div className="sh-version-row">
              <span className="sh-version-label">
                {isLatest ? "Latest Update" : `Update #${versionNum}`}
              </span>
              {isLatest && <span className="sh-latest-badge">Latest</span>}
            </div>
            <div className="sh-timestamp">
              <IClock />
              {date} at {time}
            </div>
          </div>

          {/* Action buttons — only show when not editing */}
          {!isEditing && (
            <div className="sh-actions">
              <button
                className="sh-action-btn sh-action-btn--edit"
                onClick={() => onEditStart(item)}
                title="Edit notes"
              >
                <IEdit />
              </button>
              <button
                className="sh-action-btn sh-action-btn--delete"
                onClick={() => onDelete(item.id)}
                title="Delete version"
              >
                <ITrash />
              </button>
            </div>
          )}
        </div>

        {/* Notes — view or edit */}
        {isEditing ? (
          <div className="sh-edit-block">
            <textarea
              className="sh-edit-textarea"
              value={editData.notes ?? item.notes ?? ""}
              onChange={(e) =>
                onEditChange({ ...editData, notes: e.target.value })
              }
              placeholder="Add notes about this version…"
              rows={4}
              autoFocus
            />
            {editData.notes !== undefined && editData.notes.trim() === "" && (
              <p className="sh-edit-warn">Notes cannot be empty.</p>
            )}
            <div className="sh-edit-actions">
              <button className="sh-btn sh-btn--cancel" onClick={onEditCancel}>
                <IClose /> Cancel
              </button>
              <button
                className="sh-btn sh-btn--save"
                onClick={() => onEditSave(item.id)}
                disabled={!editData.notes || editData.notes.trim() === ""}
              >
                <ICheck /> Save changes
              </button>
            </div>
          </div>
        ) : (
          item.notes && (
            <div className="sh-notes">
              <p className="sh-notes-text">{item.notes}</p>
            </div>
          )
        )}
      </div>
    </div>
  );
}

/* ─── main component ────────────────────────────── */
export default React.memo(function SubmissionHistory({ projectId, token }) {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [editData, setEditData] = useState({});
  const [newNote, setNewNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const fetchHistory = async () => {
    if (!projectId) return;
    setLoading(true);
    setError("");
    try {
      const res = await apiRequest(`/projects/${projectId}/submissions`);
      if (!res.ok) {
        setError("Failed to load submission history");
        return;
      }
      const data = await res.json();
      const sorted = Array.isArray(data)
        ? [...data].sort((a, b) => new Date(b.submitted_at) - new Date(a.submitted_at))
        : [];
      setHistory(sorted);
    } catch {
      setError("Failed to load submission history");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this version?")) return;
    await apiRequest(
      `/projects/${projectId}/submissions/${id}`,
      { method: "DELETE" },
    );
    fetchHistory();
  };

  const handleUpdate = async (id) => {
    if (!editData.notes || editData.notes.trim() === "") return;
    await apiRequest(
      `/projects/${projectId}/submissions/${id}`,
      {
        method: "PUT",
        body: JSON.stringify(editData),
      },
    );
    setEditingId(null);
    setEditData({});
    fetchHistory();
  };

  const handleEditStart = (item) => {
    setEditingId(item.id);
    setEditData({ notes: item.notes ?? "" }); // pre-fill current notes
  };

  const handleEditCancel = () => {
    setEditingId(null);
    setEditData({});
  };

  const handleAddUpdate = async () => {
    if (!newNote.trim()) {
      alert("Please write an update");
      return;
    }
    try {
      setSubmitting(true);
      await apiRequest(`/projects/${projectId}/submissions`, {
        method: "POST",
        body: JSON.stringify({ notes: newNote }),
      });
      setNewNote("");
      fetchHistory();
    } catch {
      alert("Failed to add update");
    } finally {
      setSubmitting(false);
    }
  };

  useEffect(() => {
    if (!projectId) return;
    fetchHistory();
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    const handleHistoryUpdated = () => fetchHistory();
    socket.off("submission_history_updated");
    socket.on("submission_history_updated", handleHistoryUpdated);
    return () => socket.off("submission_history_updated", handleHistoryUpdated);
  }, [projectId, token]);

  return (
    <div className="sh-root dd-card" style={{ "--ci": 6 }}>
      {/* ── Panel header ── */}
      <div className="sh-panel-head">
        <div className="sh-panel-head-left">
          <span className="sh-panel-icon">
            <IHistory />
          </span>

          <div>
            <h3 className="sh-panel-title">Submission History</h3>
            {!loading && history.length > 0 && (
              <p className="sh-panel-sub">
                {history.length} version{history.length !== 1 ? "s" : ""}
              </p>
            )}
          </div>
        </div>

        {/* 👉 RIGHT SIDE */}
        <div className="sh-add-container">
          <textarea
            className="sh-add-input"
            placeholder="Write your progress update..."
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
          />

          <button
            className="sh-add-btn"
            onClick={handleAddUpdate}
            disabled={submitting}
          >
            {submitting ? "Adding..." : "Add Update 🚀"}
          </button>
        </div>
      </div>

      {/* ── Loading skeleton ── */}
      {loading && (
        <div className="sh-timeline">
          <SkeletonItem delay={0} />
          <SkeletonItem delay={0.08} />
          <SkeletonItem delay={0.16} />
        </div>
      )}

      {/* ── Error ── */}
      {!loading && error && (
        <div className="sh-state-empty">
          <p className="sh-state-text sh-state-text--error">{error}</p>
        </div>
      )}

      {/* ── Empty ── */}
      {!loading && !error && history.length === 0 && (
        <div className="sh-state-empty">
          <div className="sh-empty-icon">
            <IHistory />
          </div>
          <p className="sh-state-title">No submissions yet</p>
          <p className="sh-state-text">
            Versions will appear here once you submit work.
          </p>
        </div>
      )}

      {/* ── Timeline ── */}
      {!loading && !error && history.length > 0 && (
        <div className="sh-timeline">
          {history.map((item, idx) => (
            <TimelineItem
              key={`${item.id}-${item.submitted_at}`}
              item={item}
              idx={idx}
              total={history.length}
              isLatest={idx === 0}
              editingId={editingId}
              editData={editData}
              onEditStart={handleEditStart}
              onEditCancel={handleEditCancel}
              onEditChange={setEditData}
              onEditSave={handleUpdate}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
});
