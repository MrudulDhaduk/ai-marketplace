import { useState } from "react";

function IconPulse() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <polyline
        points="2 12 6 12 9 4 12 20 15 12 18 12 22 12"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconProjects() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <rect x="3" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function IconMsg() {
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

function IconCard() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <rect x="2" y="6" width="20" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M2 10h20" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="7" cy="15" r="1" fill="currentColor" />
    </svg>
  );
}

const NAV_ITEMS = [
  { key: "overview", label: "Overview", Icon: IconPulse },
  { key: "projects", label: "Projects", Icon: IconProjects },
  { key: "messages", label: "Messages", Icon: IconMsg },
  { key: "payments", label: "Payments", Icon: IconCard },
];

export default function ClientSidebar({ user, section = "overview", onSectionChange }) {
  const [open, setOpen] = useState(false);

  return (
    <aside
      className={`sidebar${open ? " sidebar--open" : ""}`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <div className="sb-logo">
        <span className="sb-logo-mark">NF</span>
        <span className="sb-logo-text">NeuralForge</span>
      </div>
      <nav className="sb-nav">
        {NAV_ITEMS.map(({ key, label, Icon }) => (
          <button
            key={key}
            className={`sb-item${section === key ? " sb-item--on" : ""}`}
            onClick={() => onSectionChange?.(key)}
            title={label}
            data-ripple=""
          >
            <span className="sb-icon">
              <Icon />
            </span>
            <span className="sb-label">{label}</span>
            {section === key && <span className="sb-active-bar" />}
          </button>
        ))}
      </nav>
      <div className="sb-footer">
        <div className="sb-avatar">{user?.username?.[0]?.toUpperCase() || "U"}</div>
        <div className="sb-user-info">
          <span className="sb-user-name">{user?.username || "User"}</span>
          <span className="sb-user-role">Client</span>
        </div>
      </div>
    </aside>
  );
}
