/**
 * SubmissionHistory.jsx — Universal Workspace Activity Engine
 *
 * Evolved from a manual-notes timeline into the central nervous system
 * of the workspace. Combines:
 *   • Manual progress notes (add / edit / delete) — preserved from original
 *   • Automatic system events (file uploads, bid accepted, submissions, etc.)
 *   • Timeline grouping (Today / Yesterday / Last Week / Older)
 *   • Per-entry client approval / revision / resolve
 *   • Threaded comments on any event
 *   • Filter bar (All / Submissions / Files / Reviews / System)
 *   • Realtime updates via socket
 */
import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { socket } from "../../../socket";
import "../ProjectWorkspace.css";
import "./SubmissionHistory.css";
import React from "react";
import { apiRequest } from "../../../lib/api";
import TimelineEventCard from "./TimelineEventCard";
import TimelineFilters from "./TimelineFilters";

/* ─── icons ─────────────────────────────────────────────────────────────────── */
function IEdit() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 1-2-2v-7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function ITrash() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <polyline points="3 6 5 6 21 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M10 11v6M14 11v6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
function ICheck() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M20 6 9 17l-5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function IClose() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M18 6 6 18M6 6l12 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
function IClock() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" />
      <path d="M12 7v5l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
function IHistory() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3 3v5h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 7v5l4 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/* ─── helpers ────────────────────────────────────────────────────────────────── */
function formatDate(iso) {
  const d = new Date(iso);
  return {
    date: d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }),
    time: d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }),
  };
}

function getDateGroup(iso) {
  const now  = new Date();
  const date = new Date(iso);
  const diffDays = Math.floor((now - date) / 86400000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays <= 7)  return "Last Week";
  return "Older";
}

const GROUP_ORDER = ["Today", "Yesterday", "Last Week", "Older"];

/* ─── skeleton shimmer ───────────────────────────────────────────────────────── */
function SkeletonItem({ delay = 0 }) {
  return (
    <div className="sh-timeline-item sh-skeleton-item" style={{ "--sk-delay": `${delay}s` }}>
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

/* ─── manual note timeline item (preserved from original) ───────────────────── */
function ManualNoteItem({
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
  isClient,
}) {
  const { date, time } = formatDate(item.submitted_at);
  const isEditing = editingId === item.id;
  const versionNum = total - idx;

  return (
    <div
      className={`sh-timeline-item${isLatest ? " sh-timeline-item--latest" : ""}${isEditing ? " sh-timeline-item--editing" : ""}`}
      style={{ "--ci": idx }}
    >
      <div className="sh-node-col">
        <div className={`sh-node${isLatest ? " sh-node--latest" : ""}`}>
          <span className="sh-node-inner" />
        </div>
        {idx < total - 1 && <div className="sh-connector" />}
      </div>

      <div className="sh-card">
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

          {/* BUG-M14 fix: only show edit/delete controls to the developer */}
          {!isEditing && !isClient && (
            <div className="sh-actions">
              <button className="sh-action-btn sh-action-btn--edit" onClick={() => onEditStart(item)} title="Edit notes">
                <IEdit />
              </button>
              <button className="sh-action-btn sh-action-btn--delete" onClick={() => onDelete(item.id)} title="Delete version">
                <ITrash />
              </button>
            </div>
          )}
        </div>

        {isEditing ? (
          <div className="sh-edit-block">
            <textarea
              className="sh-edit-textarea"
              value={editData.notes ?? item.notes ?? ""}
              onChange={(e) => onEditChange({ ...editData, notes: e.target.value })}
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

/* ─── date group header ──────────────────────────────────────────────────────── */
function GroupHeader({ label }) {
  return (
    <div className="sh-group-header">
      <span className="sh-group-label">{label}</span>
      <div className="sh-group-line" />
    </div>
  );
}

/* ─── empty state ────────────────────────────────────────────────────────────── */
function EmptyState({ filter }) {
  const messages = {
    all:         { title: "No activity yet",      text: "Events will appear here as work progresses." },
    submissions: { title: "No submissions yet",   text: "Submissions will appear when the developer submits work." },
    files:       { title: "No file events yet",   text: "File uploads and deletions will appear here." },
    reviews:     { title: "No reviews yet",       text: "Approval and revision events will appear here." },
    system:      { title: "No system events yet", text: "Bid acceptance, assignments, and status changes appear here." },
  };
  const msg = messages[filter] || messages.all;
  return (
    <div className="sh-state-empty">
      <div className="sh-empty-icon"><IHistory /></div>
      <p className="sh-state-title">{msg.title}</p>
      <p className="sh-state-text">{msg.text}</p>
    </div>
  );
}

/* ─── main component ─────────────────────────────────────────────────────────── */
export default React.memo(function SubmissionHistory({ projectId, token, isClient = false }) {
  /* ── manual notes state (preserved) ── */
  const [history,    setHistory]    = useState([]);
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState("");
  const [editingId,  setEditingId]  = useState(null);
  const [editData,   setEditData]   = useState({});
  const [newNote,    setNewNote]    = useState("");
  const [submitting, setSubmitting] = useState(false);

  /* ── activity feed state (new) ── */
  const [activity,        setActivity]        = useState([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activeFilter,    setActiveFilter]    = useState("all");
  const [activeTab,       setActiveTab]       = useState("activity"); // "activity" | "notes"

  const timelineRef = useRef(null);

  /* ── fetch manual notes (preserved) ── */
  const fetchHistory = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError("");
    try {
      const res = await apiRequest(`/projects/${projectId}/submissions`);
      if (!res.ok) { setError("Failed to load submission history"); return; }
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
  }, [projectId]);

  /* ── fetch activity feed (new) ── */
  const fetchActivity = useCallback(async () => {
    if (!projectId) return;
    setActivityLoading(true);
    try {
      const res = await apiRequest(`/projects/${projectId}/activity?filter=${activeFilter}&limit=60`);
      if (res.ok) {
        const data = await res.json();
        setActivity(Array.isArray(data.data) ? data.data : []);
      }
    } catch { /* silent — activity feed is non-critical */ }
    finally { setActivityLoading(false); }
  }, [projectId, activeFilter]);

  /* ── manual note CRUD (preserved) ── */
  const handleDelete = async (id) => {
    if (!window.confirm("Delete this update?")) return;
    await apiRequest(`/projects/${projectId}/submissions/${id}`, { method: "DELETE" });
    fetchHistory();
  };

  const handleUpdate = async (id) => {
    if (!editData.notes || editData.notes.trim() === "") return;
    await apiRequest(`/projects/${projectId}/submissions/${id}`, {
      method: "PUT",
      body: JSON.stringify(editData),
    });
    setEditingId(null);
    setEditData({});
    fetchHistory();
  };

  const handleEditStart  = (item) => { setEditingId(item.id); setEditData({ notes: item.notes ?? "" }); };
  const handleEditCancel = ()     => { setEditingId(null); setEditData({}); };

  const handleAddUpdate = async () => {
    if (!newNote.trim()) { alert("Please write an update"); return; }
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

  /* ── activity entry updated callback ── */
  const handleEntryUpdated = useCallback((eventId, newStatus) => {
    setActivity((prev) =>
      prev.map((e) => e.id === eventId ? { ...e, approval_status: newStatus } : e),
    );
  }, []);

  /* ── effects ── */
  useEffect(() => {
    if (!projectId) return;
    fetchHistory();
    fetchActivity();
  }, [projectId, fetchHistory, fetchActivity]);

  useEffect(() => {
    if (!projectId) return;
    fetchActivity();
  }, [activeFilter, fetchActivity]);

  useEffect(() => {
    if (!projectId) return;

    const handleHistoryUpdated = () => {
      fetchHistory();
      fetchActivity();
    };
    const handleActivityUpdated = () => fetchActivity();
    const handleCommentAdded = ({ eventId, comment }) => {
      setActivity((prev) =>
        prev.map((e) =>
          e.id === eventId
            ? { ...e, comment_count: (e.comment_count || 0) + 1 }
            : e,
        ),
      );
    };
    const handleEntryUpdatedSocket = ({ eventId, approval_status, approval_feedback, actioned_at }) => {
      setActivity((prev) =>
        prev.map((e) =>
          e.id === eventId
            ? {
                ...e,
                approval_status,
                approval_feedback: approval_feedback ?? e.approval_feedback,
                // BUG-C9 fix: update actioned_at in local state so the
                // timeline card shows the correct resolution timestamp
                // without requiring a full refetch
                actioned_at: actioned_at ?? e.actioned_at,
              }
            : e,
        ),
      );
    };

    // BUG-M1 fix: always pass the handler reference to socket.off so we only
    // remove THIS component's listener, not every listener for the event name.
    // The old bare socket.off("event") call was a global removal that would
    // silently kill listeners registered by any other mounted instance.
    socket.on("submission_history_updated", handleHistoryUpdated);
    socket.on("workspace_activity_updated", handleActivityUpdated);
    socket.on("activity_comment_added",     handleCommentAdded);
    socket.on("activity_entry_updated",     handleEntryUpdatedSocket);

    return () => {
      socket.off("submission_history_updated", handleHistoryUpdated);
      socket.off("workspace_activity_updated", handleActivityUpdated);
      socket.off("activity_comment_added",     handleCommentAdded);
      socket.off("activity_entry_updated",     handleEntryUpdatedSocket);
    };
  }, [projectId, fetchHistory, fetchActivity]);

  /* ── group activity by date ── */
  const groupedActivity = useMemo(() => {
    const groups = {};
    activity.forEach((event) => {
      const group = getDateGroup(event.created_at);
      if (!groups[group]) groups[group] = [];
      groups[group].push(event);
    });
    return groups;
  }, [activity]);

  /* ── filter counts ── */
  const filterCounts = useMemo(() => {
    // Only show counts when on "all" to avoid double-fetching
    return {};
  }, []);

  /* ── total count for header ── */
  const totalCount = activeTab === "activity" ? activity.length : history.length;

  return (
    <div className="sh-root" style={{ "--ci": 6 }}>

      {/* ── Panel header ── */}
      <div className="sh-panel-head">
        <div className="sh-panel-head-left">
          <span className="sh-panel-icon"><IHistory /></span>
          <div>
            <h3 className="sh-panel-title">Workspace Activity</h3>
            {totalCount > 0 && (
              <p className="sh-panel-sub">
                {totalCount} event{totalCount !== 1 ? "s" : ""}
              </p>
            )}
          </div>
        </div>

        {/* Tab switcher — Notes tab is developer-only (BUG-M13) */}
        <div className="sh-tab-switcher">
          <button
            className={`sh-tab-btn ${activeTab === "activity" ? "sh-tab-btn--active" : ""}`}
            onClick={() => setActiveTab("activity")}
          >
            ⚡ Activity
          </button>
          {!isClient && (
            <button
              className={`sh-tab-btn ${activeTab === "notes" ? "sh-tab-btn--active" : ""}`}
              onClick={() => setActiveTab("notes")}
            >
              📝 Notes
            </button>
          )}
        </div>
      </div>

      {/* ════ ACTIVITY TAB ════ */}
      {activeTab === "activity" && (
        <>
          {/* Filter bar */}
          <TimelineFilters
            activeFilter={activeFilter}
            onFilterChange={setActiveFilter}
            counts={filterCounts}
          />

          {/* Loading */}
          {activityLoading && (
            <div className="sh-timeline">
              <SkeletonItem delay={0} />
              <SkeletonItem delay={0.08} />
              <SkeletonItem delay={0.16} />
            </div>
          )}

          {/* Empty */}
          {!activityLoading && activity.length === 0 && (
            <EmptyState filter={activeFilter} />
          )}

          {/* Timeline grouped by date */}
          {!activityLoading && activity.length > 0 && (
            <div className="sh-timeline" ref={timelineRef}>
              {GROUP_ORDER.map((group) => {
                const events = groupedActivity[group];
                if (!events || events.length === 0) return null;
                return (
                  <React.Fragment key={group}>
                    <GroupHeader label={group} />
                    {events.map((event, idx) => {
                      const globalIdx = activity.indexOf(event);
                      return (
                        <TimelineEventCard
                          key={event.id}
                          event={event}
                          isLatest={globalIdx === 0}
                          isClient={isClient}
                          projectId={projectId}
                          onEntryUpdated={handleEntryUpdated}
                          animDelay={idx * 0.05}
                        />
                      );
                    })}
                  </React.Fragment>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* ════ NOTES TAB (manual entries — fully preserved) ════ */}
      {activeTab === "notes" && (
        <>
          {/* Add note form */}
          <div className="sh-add-section">
            <div className="sh-add-container">
              <textarea
                className="sh-add-input"
                placeholder="Write your progress update…"
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
              />
              <button className="sh-add-btn" onClick={handleAddUpdate} disabled={submitting}>
                {submitting ? "Adding…" : "Add Update 🚀"}
              </button>
            </div>
          </div>

          {/* Loading */}
          {loading && (
            <div className="sh-timeline">
              <SkeletonItem delay={0} />
              <SkeletonItem delay={0.08} />
              <SkeletonItem delay={0.16} />
            </div>
          )}

          {/* Error */}
          {!loading && error && (
            <div className="sh-state-empty">
              <p className="sh-state-text sh-state-text--error">{error}</p>
            </div>
          )}

          {/* Empty */}
          {!loading && !error && history.length === 0 && (
            <div className="sh-state-empty">
              <div className="sh-empty-icon"><IHistory /></div>
              <p className="sh-state-title">No notes yet</p>
              <p className="sh-state-text">Add a progress update above to get started.</p>
            </div>
          )}

          {/* Notes timeline */}
          {!loading && !error && history.length > 0 && (
            <div className="sh-timeline">
              {history.map((item, idx) => (
                <ManualNoteItem
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
                  isClient={isClient}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
});
