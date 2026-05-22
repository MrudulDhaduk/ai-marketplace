/**
 * useTypingIndicator.js — Typing indicator emit + receive hook
 *
 * Extracted in Phase 6 Step 2 to eliminate the near-identical typing
 * indicator logic duplicated in ClientMessages (ChatPanel) and
 * DeveloperMessages (ChatPanel).
 *
 * Handles:
 *   - Leading-edge emit of typing:started on first keystroke
 *   - Trailing debounce to emit typing:stopped after inactivity
 *   - Receiving typing:started / typing:stopped from other users
 *   - Auto-clearing stale typing indicators (TYPING_STALE_MS)
 *   - Cleanup on unmount (emits typing:stopped if still typing)
 *
 * Usage:
 *   const { typingUsers, handleInputChange, stopTyping } =
 *     useTypingIndicator(socket, projectId, currentUserId);
 *
 *   // In the input onChange:
 *   onChange={(e) => { setValue(e.target.value); handleInputChange(); }}
 *
 *   // Before sending a message:
 *   stopTyping();
 */
import { useState, useRef, useCallback, useEffect } from "react";

const TYPING_DEBOUNCE_MS = 1500;
const TYPING_STALE_MS    = 4000;

/**
 * @param {import('socket.io-client').Socket} socket
 * @param {number|string|null|undefined} projectId
 * @param {number|string|null|undefined} currentUserId
 * @returns {{
 *   typingUsers: Array<{username: string}>,
 *   handleInputChange: () => void,
 *   stopTyping: () => void,
 * }}
 */
export function useTypingIndicator(socket, projectId, currentUserId) {
  const [typingUsers, setTypingUsers] = useState(new Map());
  const debounceRef  = useRef(null);
  const isTypingRef  = useRef(false);

  // ── Receive typing events from other users ────────────────────────────────
  useEffect(() => {
    if (!projectId) return;

    const updateTypingUser = (userId, username, isTyping) => {
      setTypingUsers((prev) => {
        const next = new Map(prev);
        if (isTyping) {
          if (next.has(userId)) clearTimeout(next.get(userId).timeoutId);
          const timeoutId = setTimeout(() => {
            setTypingUsers((m) => { const n = new Map(m); n.delete(userId); return n; });
          }, TYPING_STALE_MS);
          next.set(userId, { username, timeoutId });
        } else {
          if (next.has(userId)) clearTimeout(next.get(userId).timeoutId);
          next.delete(userId);
        }
        return next;
      });
    };

    const handleTypingStarted = (envelope) => {
      if (envelope?.actorId === currentUserId) return;
      updateTypingUser(envelope.actorId, envelope.actorName, true);
    };

    const handleTypingStopped = (envelope) => {
      if (envelope?.actorId === currentUserId) return;
      updateTypingUser(envelope.actorId, envelope.actorName, false);
    };

    socket.on("typing:started", handleTypingStarted);
    socket.on("typing:stopped", handleTypingStopped);

    return () => {
      socket.off("typing:started", handleTypingStarted);
      socket.off("typing:stopped", handleTypingStopped);
    };
  }, [socket, projectId, currentUserId]);

  // ── Cleanup on unmount ────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      clearTimeout(debounceRef.current);
      if (isTypingRef.current && projectId) {
        socket.emit("typing", { projectId, typing: false });
        isTypingRef.current = false;
      }
    };
  }, [socket, projectId]);

  // ── Emit typing:started on first keystroke, debounce typing:stopped ───────
  const handleInputChange = useCallback(() => {
    if (!projectId) return;

    // Leading edge: emit typing:started only on first keystroke
    if (!isTypingRef.current) {
      socket.emit("typing", { projectId, typing: true });
      isTypingRef.current = true;
    }

    // Reset trailing debounce
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      socket.emit("typing", { projectId, typing: false });
      isTypingRef.current = false;
    }, TYPING_DEBOUNCE_MS);
  }, [socket, projectId]);

  // ── Immediately stop typing (call before sending a message) ──────────────
  const stopTyping = useCallback(() => {
    clearTimeout(debounceRef.current);
    if (isTypingRef.current && projectId) {
      socket.emit("typing", { projectId, typing: false });
      isTypingRef.current = false;
    }
  }, [socket, projectId]);

  // Convert Map to array for rendering
  const typingList = Array.from(typingUsers.values());

  return { typingUsers: typingList, handleInputChange, stopTyping };
}
