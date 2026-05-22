import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import "./TopBar.css";
import { useSocket } from "../context/SocketContext";
import { useAuth } from "../context/AuthContext";
import { apiRequest } from "../lib/api";
import { useNotifications } from "../hooks/useProjectQueries";
import { queryClient } from "../lib/queryClient";
import { queryKeys } from "../lib/queryKeys";
import { timeAgo } from "../utils/time";

/* ═══════════════════════════════════════
   ICONS
═══════════════════════════════════════ */
function ISearch() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.6" />
      <path d="M16.5 16.5L21 21" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
function IBell() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" stroke="currentColor" strokeWidth="1.5" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
function IUser() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="1.5" />
      <path d="M4 20c0-4 3.582-7 8-7s8 3 8 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
function ISettings() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.5" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
function ILogout() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <polyline points="16 17 21 12 16 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <line x1="21" y1="12" x2="9" y2="12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
function IChevron() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ═══════════════════════════════════════
   TOPBAR
═══════════════════════════════════════ */
export default function TopBar({
  title,
  search = "",
  onSearch = () => {},
  total = null,
  filtered = null,
  showSearch = true,
}) {
  const navigate = useNavigate();
  const { currentUser: user, logout } = useAuth();
  const socket = useSocket();
  const [dropOpen, setDropOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [searchFocused, setFocused] = useState(false);
  const dropRef = useRef(null);
  const notifRef = useRef(null);
  const searchRef = useRef(null);

  // Use TanStack Query for notifications — replaces manual fetch + socket refetch
  const { data: notifications = [] } = useNotifications(user?.id);
  // Local optimistic state for read status (avoids full refetch on mark-read)
  const [localNotifs, setLocalNotifs] = useState(null);
  const displayNotifs = localNotifs ?? notifications;

  // Sync local state when query data changes (e.g. after invalidation)
  useEffect(() => {
    setLocalNotifs(null);
  }, [notifications]);

  const initial = user?.username?.[0]?.toUpperCase() || "U";
  const unreadCount = displayNotifs.filter((n) => !n.is_read).length;

  /* ── Real-time notification listener ── */
  useEffect(() => {
    if (!user) return;

    // New notification arrives → prepend optimistically + invalidate cache
    // Handles both legacy "notification" and typed "notification:received"
    const handleNotification = (notif) => {
      // Typed envelope has { v, data: notifObj } — unwrap if needed
      const n = notif?.v === 1 ? notif : notif;
      setLocalNotifs((prev) => {
        const base = prev ?? notifications;
        if (base.some((x) => x.id === n.id)) return base;
        return [n, ...base];
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.notifications.list() });
    };

    // On reconnect, invalidate to pick up any missed notifications
    const onConnect = () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.notifications.list() });
    };

    socket.on("notification",          handleNotification);
    socket.on("notification:received", handleNotification);
    socket.on("connect",               onConnect);

    return () => {
      socket.off("notification",          handleNotification);
      socket.off("notification:received", handleNotification);
      socket.off("connect",               onConnect);
    };
  }, [user, notifications, socket]);
  useEffect(() => {
    if (!dropOpen && !notifOpen) return;
    const handler = (e) => {
      if (dropOpen && dropRef.current && !dropRef.current.contains(e.target)) setDropOpen(false);
      if (notifOpen && notifRef.current && !notifRef.current.contains(e.target)) setNotifOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [dropOpen, notifOpen]);

  /* ── Keyboard: close on Escape ── */
  useEffect(() => {
    const handler = (e) => {
      if (e.key === "Escape") { setDropOpen(false); setNotifOpen(false); }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  /* ── Mark single notification as read ── */
  const handleMarkRead = useCallback(async (notif) => {
    if (notif.is_read) return;
    // Optimistic update
    setLocalNotifs((prev) =>
      (prev ?? notifications).map((n) => n.id === notif.id ? { ...n, is_read: true } : n),
    );
    try {
      await apiRequest(`/notifications/${notif.id}/read`, { method: "PUT" });
    } catch {}
  }, [notifications]);

  /* ── Mark all as read ── */
  const handleMarkAllRead = useCallback(async () => {
    // Optimistic update
    setLocalNotifs((prev) =>
      (prev ?? notifications).map((n) => ({ ...n, is_read: true })),
    );
    try {
      await apiRequest("/notifications/read-all", { method: "PUT" });
    } catch {}
  }, [notifications]);

  const handleLogout = useCallback(async () => {
    await logout();
    navigate("/login");
  }, [logout, navigate]);

  const showCount = total !== null && filtered !== null;

  return (
    <header className="topbar">
      {/* ── LEFT ── */}
      <div className="topbar-left">
        <h1 className="topbar-title">{title}</h1>
        {showCount && (
          <span className="topbar-count">
            <strong>{filtered < total ? filtered : total}</strong>{" "}
            {filtered < total ? `of ${total} projects` : "projects"}
          </span>
        )}
      </div>

      {/* ── RIGHT ── */}
      <div className="topbar-right">
        {/* Search */}
        {showSearch && (
          <div className={`topbar-search${searchFocused ? " topbar-search--focus" : ""}`}>
            <span className="topbar-search-icon"><ISearch /></span>
            <input
              ref={searchRef}
              className="topbar-search-input"
              type="text"
              placeholder="Search…"
              value={search}
              onChange={(e) => onSearch(e.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              aria-label="Search"
            />
            {search && (
              <button
                className="topbar-search-clear"
                onClick={() => { onSearch(""); searchRef.current?.focus(); }}
                aria-label="Clear search"
              >
                ×
              </button>
            )}
          </div>
        )}

        {/* Notification bell */}
        <div ref={notifRef} style={{ position: "relative" }}>
          <button
            className="topbar-icon-btn"
            title="Notifications"
            aria-label={`Notifications${unreadCount > 0 ? `, ${unreadCount} unread` : ""}`}
            onClick={() => setNotifOpen((v) => !v)}
          >
            <IBell />
            {unreadCount > 0 && (
              <span className="topbar-notif-count" aria-hidden="true">
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            )}
          </button>

          {notifOpen && (
            <div className="notif-dropdown">
              <div className="notif-header">
                <span className="notif-header-title">Notifications</span>
                {unreadCount > 0 && (
                  <button className="notif-mark-all" onClick={handleMarkAllRead}>
                    Mark all read
                  </button>
                )}
              </div>
              {displayNotifs.length === 0 ? (
                <p className="notif-empty">No notifications yet</p>
              ) : (
                <ul className="notif-list">
                  {displayNotifs.slice(0, 20).map((n, i) => (
                    <li
                      key={n.id ?? i}
                      className={`notif-item${n.is_read ? "" : " notif-item--unread"}`}
                      onClick={() => handleMarkRead(n)}
                    >
                      <span className="notif-dot" />
                      <div className="notif-body">
                        <p className="notif-msg">{n.message}</p>
                        {n.created_at && (
                          <span className="notif-time">
                            {timeAgo(n.created_at)}
                          </span>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        {/* Profile */}
        <div className="topbar-profile" ref={dropRef}>
          <button
            className={`topbar-avatar-btn${dropOpen ? " topbar-avatar-btn--open" : ""}`}
            onClick={() => setDropOpen((v) => !v)}
            aria-haspopup="true"
            aria-expanded={dropOpen}
            aria-label="Open profile menu"
          >
            <span className="topbar-avatar">{initial}</span>
            <div className="topbar-user-info">
              <span className="topbar-username">{user?.username || "User"}</span>
              <span className="topbar-role">{user?.role || "Member"}</span>
            </div>
            <span className={`topbar-chevron${dropOpen ? " topbar-chevron--open" : ""}`}>
              <IChevron />
            </span>
          </button>

          {dropOpen && (
            <div className="topbar-dropdown" role="menu" aria-label="Profile menu">
              <div className="topbar-drop-user">
                <span className="topbar-drop-avatar">{initial}</span>
                <div>
                  <p className="topbar-drop-name">{user?.username || "User"}</p>
                  <p className="topbar-drop-email">{user?.email || user?.role || "Member"}</p>
                </div>
              </div>

              <div className="topbar-drop-divider" />

              <button
                className="topbar-drop-item"
                role="menuitem"
                onClick={() => { setDropOpen(false); navigate("/profile"); }}
              >
                <span className="topbar-drop-icon"><IUser /></span>
                Profile
              </button>

              <button
                className="topbar-drop-item"
                role="menuitem"
                onClick={() => { setDropOpen(false); navigate("/settings"); }}
              >
                <span className="topbar-drop-icon"><ISettings /></span>
                Settings
              </button>

              <div className="topbar-drop-divider" />

              <button
                className="topbar-drop-item topbar-drop-item--danger"
                role="menuitem"
                onClick={handleLogout}
              >
                <span className="topbar-drop-icon"><ILogout /></span>
                Log out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

