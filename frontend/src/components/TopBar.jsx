import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import "./TopBar.css";
import { socket } from "../socket";
/* ═══════════════════════════════════════
   ICONS
═══════════════════════════════════════ */
function ISearch() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M16.5 16.5L21 21"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
function IBell() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <path
        d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M13.73 21a2 2 0 0 1-3.46 0"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
function IUser() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M4 20c0-4 3.582-7 8-7s8 3 8 7"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
function ISettings() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  );
}
function ILogout() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <path
        d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <polyline
        points="16 17 21 12 16 7"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <line
        x1="21"
        y1="12"
        x2="9"
        y2="12"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
function IChevron() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <path
        d="M6 9l6 6 6-6"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
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
  const [dropOpen, setDropOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [notifOpen, setNotifOpen] = useState(false);
  const [searchFocused, setFocused] = useState(false);
  const dropRef = useRef(null);
  const notifRef = useRef(null);
  const searchRef = useRef(null);

  const user = (() => {
    try {
      return JSON.parse(localStorage.getItem("user"));
    } catch {
      return null;
    }
  })();

  const initial = user?.username?.[0]?.toUpperCase() || "U";

  /* Close dropdowns on outside click */
  useEffect(() => {
    if (!dropOpen && !notifOpen) return;
    const handler = (e) => {
      if (dropOpen && dropRef.current && !dropRef.current.contains(e.target)) setDropOpen(false);
      if (notifOpen && notifRef.current && !notifRef.current.contains(e.target)) setNotifOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [dropOpen, notifOpen]);

  /* Keyboard: close dropdowns on Escape */
  useEffect(() => {
    const handler = (e) => {
      if (e.key === "Escape") {
        setDropOpen(false);
        setNotifOpen(false);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  /* Register user for role-based rooms */
  useEffect(() => {
    if (user?.id) {
      socket.emit("register", user.id);
    }
  }, [user]);

  /* Role-based listeners */
  useEffect(() => {
    if (!user) return;

    if (user.role === "client") {
      socket.on("new_bid", (data) => {
        setNotifications((prev) => [data, ...prev]);
      });
    }

    if (user.role === "developer") {
      socket.on("bid_accepted", (data) => {
        setNotifications((prev) => [data, ...prev]);
      });
    }

    return () => {
      socket.off("new_bid");
      socket.off("bid_accepted");
    };
  }, [user]);

  const handleLogout = useCallback(() => {
    localStorage.removeItem("user");
    localStorage.removeItem("token");
    navigate("/login");
  }, [navigate]);

  const showCount = total !== null && filtered !== null;

  const countLabel = showCount
    ? filtered < total
      ? `${filtered} of ${total} projects`
      : `${total} projects`
    : null;

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
          <div
            className={`topbar-search${searchFocused ? " topbar-search--focus" : ""}`}
          >
            <span className="topbar-search-icon">
              <ISearch />
            </span>
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
                onClick={() => {
                  onSearch("");
                  searchRef.current?.focus();
                }}
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
            aria-label="Notifications"
            onClick={() => setNotifOpen((v) => !v)}
          >
            <IBell />
            <span className="topbar-notif-dot" aria-hidden="true" />
            {notifications.length > 0 && (
              <span className="topbar-notif-count">
                {notifications.length}
              </span>
            )}
          </button>

          {notifOpen && (
            <div className="notif-dropdown">
              {notifications.length === 0 ? (
                <p className="notif-empty">No notifications</p>
              ) : (
                notifications.map((n, i) => (
                  <div key={i} className="notif-item">
                    {n.message}
                  </div>
                ))
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
              <span className="topbar-username">
                {user?.username || "User"}
              </span>
              <span className="topbar-role">{user?.role || "Member"}</span>
            </div>
            <span
              className={`topbar-chevron${dropOpen ? " topbar-chevron--open" : ""}`}
            >
              <IChevron />
            </span>
          </button>

          {/* Dropdown */}
          {dropOpen && (
            <div
              className="topbar-dropdown"
              role="menu"
              aria-label="Profile menu"
            >
              {/* User card inside dropdown */}
              <div className="topbar-drop-user">
                <span className="topbar-drop-avatar">{initial}</span>
                <div>
                  <p className="topbar-drop-name">{user?.username || "User"}</p>
                  <p className="topbar-drop-email">
                    {user?.email || user?.role || "Member"}
                  </p>
                </div>
              </div>

              <div className="topbar-drop-divider" />

              <button
                className="topbar-drop-item"
                role="menuitem"
                onClick={() => {
                  setDropOpen(false);
                  navigate("/profile");
                }}
              >
                <span className="topbar-drop-icon">
                  <IUser />
                </span>
                Profile
              </button>

              <button
                className="topbar-drop-item"
                role="menuitem"
                onClick={() => {
                  setDropOpen(false);
                  navigate("/settings");
                }}
              >
                <span className="topbar-drop-icon">
                  <ISettings />
                </span>
                Settings
              </button>

              <div className="topbar-drop-divider" />

              <button
                className="topbar-drop-item topbar-drop-item--danger"
                role="menuitem"
                onClick={handleLogout}
              >
                <span className="topbar-drop-icon">
                  <ILogout />
                </span>
                Log out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
