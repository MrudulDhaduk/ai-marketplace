import { useEffect, useRef, useState } from "react";
import { apiRequest } from "../../../lib/api";
import { useSocket } from "../../../context/SocketContext";
import { useProjectMessages } from "../../../hooks/useProjectQueries";
import { useTypingIndicator } from "../../../hooks/useTypingIndicator";
import { timeAgo } from "../../../utils/time";

/**
 * MessagePanel — unified chat panel extracted from ClientMessages and
 * DeveloperMessages. The two ChatPanel implementations were near-identical;
 * the only behavioural differences are:
 *
 *   1. `emptyStateText` — the placeholder shown when there are no messages.
 *   2. `leaveOnUnmount` — when true, emits `leave_project` on cleanup
 *      (developer behaviour); client does not need this.
 *
 * Props:
 *   project        {object}  — the selected project object
 *   currentUser    {object}  — the authenticated user
 *   leaveOnUnmount {boolean} — emit leave_project on unmount (default: false)
 *   emptyStateText {string}  — empty-state copy (default: "No messages yet. Start the conversation.")
 *
 * Requirements: 9.1, 9.2, 9.3, 9.4, 9.7
 */
export default function MessagePanel({
  project,
  currentUser,
  leaveOnUnmount = false,
  emptyStateText = "No messages yet. Start the conversation.",
}) {
  const socket = useSocket();

  /* ── local state ──────────────────────────────────────────────────────── */
  const [messages, setMessages] = useState([]);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef(null);

  /* ── initial message load via useProjectMessages ──────────────────────── */
  const { data: initialMessages } = useProjectMessages(project?.id);

  useEffect(() => {
    if (!project?.id) return;
    // Reset local messages when project changes; seed from query cache
    setMessages([]);
  }, [project?.id]);

  useEffect(() => {
    if (initialMessages) {
      setMessages(initialMessages);
    }
  }, [initialMessages]);

  /* ── typing indicator ─────────────────────────────────────────────────── */
  const { typingUsers, handleInputChange: handleTypingChange, stopTyping } =
    useTypingIndicator(socket, project?.id, currentUser?.id);

  /* ── join socket room + realtime listeners ────────────────────────────── */
  useEffect(() => {
    if (!project?.id) return;
    socket.emit("join_project", project.id);

    const handleMessageSent = (envelope) => {
      if (!envelope?.data) return;
      const d = envelope.data;
      setMessages((prev) => {
        if (prev.some((m) => m.id === d.messageId)) return prev;
        return [
          ...prev,
          {
            id:              d.messageId,
            sender_id:       d.senderId,
            receiver_id:     d.receiverId,
            body:            d.body,
            is_read:         false,
            created_at:      d.createdAt,
            sender_username: d.senderUsername,
          },
        ];
      });
    };

    socket.on("message:sent", handleMessageSent);

    return () => {
      socket.off("message:sent", handleMessageSent);
      if (leaveOnUnmount) {
        socket.emit("leave_project", project.id);
      }
    };
  }, [project?.id, socket, leaveOnUnmount]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── scroll to bottom on new messages ────────────────────────────────── */
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  /* ── input change: update body + trigger typing indicator ────────────── */
  const handleInputChange = (e) => {
    setBody(e.target.value);
    handleTypingChange();
  };

  /* ── send message ─────────────────────────────────────────────────────── */
  const handleSend = async (e) => {
    e.preventDefault();
    if (!body.trim() || sending) return;
    setSending(true);

    // Stop typing immediately on send
    stopTyping();

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

  /* ── render ───────────────────────────────────────────────────────────── */
  return (
    <div className="msg-chat">
      {/* header */}
      <div className="msg-chat-head">
        <div>
          <span className="msg-chat-title">{project.title}</span>
          <span className={`msg-project-status msg-status--${project.status}`}>
            {project.status}
          </span>
        </div>
      </div>

      {/* messages */}
      <div className="msg-messages">
        {messages.length === 0 && (
          <p className="msg-empty">{emptyStateText}</p>
        )}
        {messages.map((msg) => {
          const isMine = msg.sender_id === currentUser?.id;
          return (
            <div
              key={msg.id}
              className={`msg-bubble-row${isMine ? " msg-bubble-row--mine" : ""}`}
            >
              {!isMine && (
                <span className="msg-avatar">
                  {(msg.sender_username || "?")[0].toUpperCase()}
                </span>
              )}
              <div className={`msg-bubble${isMine ? " msg-bubble--mine" : ""}`}>
                {!isMine && (
                  <span className="msg-sender">{msg.sender_username}</span>
                )}
                <p className="msg-text">{msg.body}</p>
                <span className="msg-time">{timeAgo(msg.created_at)}</span>
              </div>
            </div>
          );
        })}
        {typingUsers.length > 0 && (
          <div className="msg-typing">
            <span className="msg-typing-dots">
              <span />
              <span />
              <span />
            </span>
            <span className="msg-typing-label">
              {typingUsers.map((u) => u.username).join(", ")}
              {typingUsers.length === 1 ? " is" : " are"} typing…
            </span>
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
        <button
          className="msg-send-btn"
          type="submit"
          disabled={sending || !body.trim()}
        >
          {sending ? "…" : "Send ↗"}
        </button>
      </form>
    </div>
  );
}
