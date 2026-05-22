import React from "react";

/* ── MobileWorkspaceNav — bottom tab bar for mobile workspaces ── */
const MobileWorkspaceNav = React.memo(function MobileWorkspaceNav({
  activeSection,   // "overview" | "files" | "actions" | "activity"
  onSectionChange, // (section: string) => void
  fileCount,       // number
  hasNewUpdate,    // boolean
}) {
  const tabs = [
    { key: "overview",  label: "Overview",  icon: "📋" },
    { key: "files",     label: "Files",     icon: "📁" },
    { key: "actions",   label: "Actions",   icon: "⚡" },
    { key: "activity",  label: "Activity",  icon: "📡" },
  ];

  return (
    <nav className="dd-mobile-nav" aria-label="Workspace sections">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          className={`dd-mobile-nav-tab${activeSection === tab.key ? " dd-mobile-nav-tab--active" : ""}`}
          onClick={() => onSectionChange(tab.key)}
          type="button"
        >
          <span aria-hidden="true">{tab.icon}</span>
          <span>{tab.label}</span>
          {tab.key === "files" && fileCount > 0 && (
            <span className="dd-mobile-nav-badge">
              {fileCount > 99 ? "99+" : fileCount}
            </span>
          )}
          {tab.key === "activity" && hasNewUpdate && (
            <span className="dd-mobile-nav-dot" aria-hidden="true" />
          )}
        </button>
      ))}
    </nav>
  );
});

export default MobileWorkspaceNav;
