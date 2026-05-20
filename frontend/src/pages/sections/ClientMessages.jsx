import { useEffect, useRef, useState } from "react";
import { apiRequest } from "../../lib/api";
import { useSocket } from "../../context/SocketContext";
import { useAuth } from "../../context/AuthContext";
import { useClientProjects } from "../../hooks/useProjectQueries";

/* ── helpers ─────────────────────────────────────── */
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

/* ── project picker ──────────────────────────────── */
function ProjectPicker({ projects, selected, onSelect }) {
  return (
    <aside className="msg-sidebar">
      <div className="msg-sidebar-head">
        <span className="msg-sidebar-title">Projects</span>
      </div>
      {projects.length === 0 && (
        <p className="msg-sidebar-empty">No active projects with a developer yet.</p>
      )}
      <ul className="msg-project-list">
        {projects.map((p) => (
          <li
            key={p.id}
            className={`msg-project-item${selected?.id === p.id ? " msg-project-item--active" : ""}`}
            onClick={() => onSelect(p)}
          >
            <span className="msg-project-name">{p.title}</span>
            <span className={`msg-project-status msg-status--${p.status}`}>{p.status}</span>
          </li>
        ))}
      </ul>
    </aside>
  );
}

/* ── chat panel ──────────────────────────────────── */
function ChatPanel({ project, currentUser }) {
  const socket = useSocket();
  const [messages, setMessages] = useState([]);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [typing, setTyping] = useState(false);
  const [typingUser, setTypingUser] = useState("");
  const bottomRef = useRef(null);
  const typingTimer = useRef(null);

  /* fetch messages on project change */
  useEffect(() => {
    if (!project?.id) return;
    setMessages([]);
    apiRequest(`/projects/${project.id}/messages`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (data) setMessages(data.data ?? []); })
      .catch(() => {});
  }, [project?.id]);

  /* join socket room + realtime listeners */
  useEffect(() => {
    if (!project?.id) return;
    socket.emit("join_project", project.id);

    const handleNewMessage = (msg) => {
      setMessages((prev) => {
        if (prev.some((m) => m.id === msg.id)) return prev;
        return [...prev, msg];
      });
    };

    const handleTyping = ({ userId, username, typing: isTyping }) => {
      if (userId === currentUser?.id) return;
      setTyping(isTyping);
      setTypingUser(isTyping ? username : "");
    };

    socket.on("new_message", handleNewMessage);
    socket.on("typing",      handleTyping);
    return () => {
      socket.off("new_message", handleNewMessage);
      socket.off("typing",      handleTyping);
    };
  }, [project?.id, currentUser?.id, socket]);

  /* scroll to bottom on new messages */
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  /* typing indicator emit */
  const handleInputChange = (e) => {
    setBody(e.target.value);
    socket.emit("typing", { projectId: project.id, typing: true });
    clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => {
      socket.emit("typing", { projectId: project.id, typing: false });
    }, 1500);
  };

  const handleSend = async (e) => {
    e.preventDefault();
    if (!body.trim() || sending) return;
    setSending(true);
    clearTimeout(typingTimer.current);
    socket.emit("typing", { projectId: project.id, typing: false });
    try {
      const r = await apiRequest(`/projects/${project.id}/messages`, {
        method: "POST",
        body: JSON.stringify({ body: body.trim() }),
      });
      if (r.ok) {
        const data = await r.json();
        setMessages((prev) => {
          if (prev.some((m) => m.id === data.data?.id)) return prev;
          return [...prev, data.data];
        });
        setBody("");
      }
    } catch {}
    setSending(false);
  };

  return (
    <div className="msg-chat">
      {/* header */}
      <div className="msg-chat-head">
        <div>
          <span className="msg-chat-title">{project.title}</span>
          <span className={`msg-project-status msg-status--${project.status}`}>{project.status}</span>
        </div>
      </div>

      {/* messages */}
      <div className="msg-messages">
        {messages.length === 0 && (
          <p className="msg-empty">No messages yet. Start the conversation.</p>
        )}
        {messages.map((msg) => {
          const isMine = msg.sender_id === currentUser?.id;
          return (
            <div key={msg.id} className={`msg-bubble-row${isMine ? " msg-bubble-row--mine" : ""}`}>
              {!isMine && (
                <span className="msg-avatar">{(msg.sender_username || "?")[0].toUpperCase()}</span>
              )}
              <div className={`msg-bubble${isMine ? " msg-bubble--mine" : ""}`}>
                {!isMine && <span className="msg-sender">{msg.sender_username}</span>}
                <p className="msg-text">{msg.body}</p>
                <span className="msg-time">{timeAgo(msg.created_at)}</span>
              </div>
            </div>
          );
        })}
        {typing && (
          <div className="msg-typing">
            <span className="msg-typing-dots"><span /><span /><span /></span>
            <span className="msg-typing-label">{typingUser} is typing…</span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* input */}
      <form className="msg-input-row" onSubmit={handleSend}>
        <input
          className="msg-input"
          type="text"
          placeholder="Type a message…"
          value={body}
          onChange={handleInputChange}
          maxLength={4000}
          autoComplete="off"
        />
        <button className="msg-send-btn" type="submit" disabled={sending || !body.trim()}>
          {sending ? "…" : "Send ↗"}
        </button>
      </form>
    </div>
  );
}

/* ── main component ──────────────────────────────── */
export default function ClientMessages({ initialProjectId }) {
  const { currentUser } = useAuth();
  const [selected, setSelected] = useState(null);

  // Reuse the shared projects query — no duplicate fetch
  const { data: rawProjects = [], isLoading: loading } = useClientProjects();
  // Only show projects that have an assigned developer (can message)
  const projects = rawProjects.filter((p) => p.assigned_developer_id);

  // Auto-select on load / when initialProjectId changes
  useEffect(() => {
    if (projects.length === 0) return;
    if (initialProjectId) {
      const target = projects.find((p) => p.id === initialProjectId);
      setSelected(target || projects[0] || null);
    } else if (!selected) {
      setSelected(projects[0]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects.length, initialProjectId]);

  if (loading) {
    return (
      <section className="pp">
        <div className="pp-head"><h2 className="pp-title">Messages</h2></div>
        <div className="pp-grid"><div className="pp-empty">Loading…</div></div>
      </section>
    );
  }

  return (
    <section className="pp msg-section">
      <div className="pp-head"><h2 className="pp-title">Messages</h2></div>
      <div className="msg-layout">
        <ProjectPicker projects={projects} selected={selected} onSelect={setSelected} />
        {selected ? (
          <ChatPanel project={selected} currentUser={currentUser} />
        ) : (
          <div className="msg-chat msg-chat--empty">
            <p className="msg-empty">Select a project to start messaging.</p>
          </div>
        )}
      </div>
    </section>
  );
}
