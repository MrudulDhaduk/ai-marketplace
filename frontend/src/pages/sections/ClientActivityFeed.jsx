import { useEffect } from "react";
import { useSocket } from "../../context/SocketContext";
import { useClientActivity } from "../../hooks/useProjectQueries";
import { queryClient } from "../../lib/queryClient";
import { queryKeys } from "../../lib/queryKeys";

/* ── event type → dot colour + label ─────────────── */
const EVENT_META = {
  bid_placed:       { dot: "orange", label: "New bid"          },
  bid_accepted:     { dot: "teal",   label: "Bid accepted"     },
  project_assigned: { dot: "teal",   label: "Developer assigned" },
  submission_added: { dot: "lime",   label: "Submission added" },
  revision_requested: { dot: "gold", label: "Revision requested" },
  project_approved: { dot: "cyan",   label: "Project approved" },
};

function timeAgo(dateStr) {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function buildText(event) {
  const meta = EVENT_META[event.event_type] || { label: event.event_type };
  const project = event.project_title ? `"${event.project_title}"` : "a project";
  const actor = event.actor_username ? `@${event.actor_username}` : "";
  switch (event.event_type) {
    case "bid_placed":       return `${actor} placed a bid on ${project}`;
    case "bid_accepted":     return `Bid accepted on ${project}`;
    case "project_assigned": return `Developer assigned to ${project}`;
    case "submission_added": return `New submission on ${project}`;
    case "revision_requested": return `Revision requested on ${project}`;
    case "project_approved": return `${project} approved ✓`;
    default:                 return `${meta.label} on ${project}`;
  }
}

export default function ClientActivityFeed() {
  const socket = useSocket();
  const { data: feed = [], isLoading: loading } = useClientActivity();

  /* Invalidate the cached activity query when typed socket events fire. */
  useEffect(() => {
    const invalidate = () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.client.activity() });
    };

    socket.on("submission:created",  invalidate);
    socket.on("approval:granted",    invalidate);
    socket.on("revision:requested",  invalidate);
    socket.on("bid:accepted",        invalidate);
    socket.on("notification:received", invalidate);

    return () => {
      socket.off("submission:created",   invalidate);
      socket.off("approval:granted",     invalidate);
      socket.off("revision:requested",   invalidate);
      socket.off("bid:accepted",         invalidate);
      socket.off("notification:received", invalidate);
    };
  }, [socket]);

  return (
    <aside className="feed">
      <div className="feed-head">
        <span className="feed-title">Live Feed</span>
        <span className="feed-live-badge">
          <span className="feed-live-dot" />
          Live
        </span>
      </div>

      {loading && (
        <ul className="feed-list">
          {[...Array(4)].map((_, i) => (
            <li key={i} className="feed-row feed-row--skeleton" style={{ "--fi": i }}>
              <span className="feed-pip pip--skeleton" />
              <div className="feed-content">
                <div className="feed-skeleton-line" />
                <div className="feed-skeleton-time" />
              </div>
            </li>
          ))}
        </ul>
      )}

      {!loading && feed.length === 0 && (
        <p className="feed-empty">No activity yet — create a project to get started.</p>
      )}

      {!loading && feed.length > 0 && (
        <ul className="feed-list">
          {feed.map((item, index) => {
            const meta = EVENT_META[item.event_type] || { dot: "gold" };
            return (
              <li key={item.id} className="feed-row" style={{ "--fi": index }}>
                <span className={`feed-pip pip--${meta.dot}`} />
                <div className="feed-content">
                  <p className="feed-text">{buildText(item)}</p>
                  <span className="feed-time">{timeAgo(item.created_at)}</span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
