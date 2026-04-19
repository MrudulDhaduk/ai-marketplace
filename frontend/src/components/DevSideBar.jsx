import { useState } from "react";
import "./DevSideBar.css";

function IGrid() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <rect
        x="3"
        y="3"
        width="7"
        height="7"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <rect
        x="14"
        y="3"
        width="7"
        height="7"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <rect
        x="3"
        y="14"
        width="7"
        height="7"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <rect
        x="14"
        y="14"
        width="7"
        height="7"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  );
}

function IMsg() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <path
        d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IBriefcase() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <rect
        x="2"
        y="7"
        width="20"
        height="14"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M12 12v4M10 14h4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IStar() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <polygon
        points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
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

const NAV = [
  { key: "feed", label: "Project Feed", Icon: IGrid },
  { key: "my-projects", label: "My Projects", Icon: IBriefcase },
  { key: "active", label: "Active Bids", Icon: IBriefcase },
  { key: "messages", label: "Messages", Icon: IMsg },
  { key: "ratings", label: "Ratings", Icon: IStar },
  { key: "settings", label: "Settings", Icon: ISettings },
];

function DevSidebar({ user, activeTab, setActiveTab }) {
  const [open, setOpen] = useState(false);

  return (
    <aside
      className={`dd-sidebar${open ? " dd-sidebar--open" : ""}`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <div className="dd-sb-logo">
        <span className="dd-sb-mark">NF</span>
        <span className="dd-sb-wordmark">NeuralForge</span>
      </div>

      <nav className="dd-sb-nav">
        {NAV.map(({ key, label, Icon }) => (
          <button
            key={key}
            className={`dd-sb-item${activeTab === key ? " dd-sb-item--on" : ""}`}
            onClick={() => setActiveTab(key)}
            title={label}
            data-ripple=""
          >
            <span className="dd-sb-icon">
              <Icon />
            </span>
            <span className="dd-sb-label">{label}</span>
            {activeTab === key && <span className="dd-sb-pip" />}
          </button>
        ))}
      </nav>
    </aside>
  );
}

export default DevSidebar;
