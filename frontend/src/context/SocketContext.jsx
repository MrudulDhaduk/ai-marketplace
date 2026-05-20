/**
 * SocketContext.jsx — Centralized socket lifecycle management
 *
 * Wraps the existing socket singleton in a React context so that:
 *   1. Components access the socket via `useSocket()` instead of importing
 *      the singleton directly (easier to test, mock, and replace).
 *   2. Socket connection/disconnection is tied to auth state — the provider
 *      connects when the user is authenticated and disconnects on logout.
 *   3. All socket→queryClient invalidation handlers live here, giving us
 *      ONE invalidation → ONE shared refetch → ALL components update.
 *
 * IMPORTANT: This does NOT change any socket event names or room architecture.
 * It is a pure wrapper around the existing socket.js singleton.
 */
import { createContext, useContext, useEffect } from "react";
import { socket, connectSocket, disconnectSocket } from "../socket";
import { queryClient } from "../lib/queryClient";
import { queryKeys } from "../lib/queryKeys";
import { useAuth } from "./AuthContext";

const SocketContext = createContext(null);

export function SocketProvider({ children }) {
  const { isAuthenticated, currentUser } = useAuth();

  /* ── Connect / disconnect with auth state ─────────────────────────────── */
  useEffect(() => {
    if (isAuthenticated) {
      connectSocket();
    } else {
      disconnectSocket();
    }
    // Cleanup on unmount (e.g. full page unload)
    return () => {
      // Do NOT disconnect here — AuthContext.logout handles that.
      // Disconnecting on every re-render would break the socket.
    };
  }, [isAuthenticated]);

  /* ── Register user room when connected ───────────────────────────────── */
  useEffect(() => {
    if (!currentUser?.id) return;

    const onConnect = () => {
      socket.emit("register", currentUser.id);
    };

    // If already connected, register immediately
    if (socket.connected) {
      socket.emit("register", currentUser.id);
    }

    socket.on("connect", onConnect);
    return () => {
      socket.off("connect", onConnect);
    };
  }, [currentUser?.id]);

  /* ── Global socket → query invalidation handlers ─────────────────────── */
  /*
   * These handlers replace the scattered socket.on → fetch() patterns.
   * When a socket event fires, we invalidate the relevant query keys.
   * TanStack Query then refetches only the queries that are currently
   * mounted and stale — no duplicate requests, no timing races.
   *
   * Components that previously did:
   *   socket.on("project_submitted", () => fetch(...))
   * now just have their useQuery automatically refetch via invalidation.
   *
   * NOTE: Project-room events (project_submitted, project_reviewed, etc.)
   * are still handled locally in workspace components because they need
   * to invalidate specific project IDs. The global handlers here cover
   * user-level events (notifications, activity feed, stats).
   */
  useEffect(() => {
    if (!currentUser?.id) return;

    /* Notification received → refresh notification list */
    const handleNotification = () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.notifications.list() });
    };

    /* Any project event → refresh client activity feed + stats */
    const handleProjectEvent = () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.client.activity() });
      queryClient.invalidateQueries({ queryKey: queryKeys.client.stats() });
      queryClient.invalidateQueries({ queryKey: queryKeys.developer.stats() });
    };

    socket.on("notification",      handleNotification);
    socket.on("project_submitted", handleProjectEvent);
    socket.on("project_reviewed",  handleProjectEvent);

    return () => {
      socket.off("notification",      handleNotification);
      socket.off("project_submitted", handleProjectEvent);
      socket.off("project_reviewed",  handleProjectEvent);
    };
  }, [currentUser?.id]);

  return (
    <SocketContext.Provider value={socket}>
      {children}
    </SocketContext.Provider>
  );
}

/**
 * useSocket() — access the socket instance from any component.
 *
 * Components should use this instead of importing socket directly.
 * The socket instance is the same singleton — this just makes the
 * dependency explicit and testable.
 */
export function useSocket() {
  const ctx = useContext(SocketContext);
  if (!ctx) throw new Error("useSocket must be used inside <SocketProvider>");
  return ctx;
}
