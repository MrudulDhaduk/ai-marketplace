/**
 * TimelineFilters.jsx
 * Filter bar for the workspace activity timeline.
 * Compact, pill-style filter buttons.
 */
import React from "react";
import "./TimelineFilters.css";

const FILTERS = [
  { key: "all",         label: "All",         icon: "⚡" },
  { key: "submissions", label: "Submissions",  icon: "🚀" },
  { key: "files",       label: "Files",        icon: "📁" },
  { key: "reviews",     label: "Reviews",      icon: "✅" },
  { key: "system",      label: "System",       icon: "🔧" },
];

export default function TimelineFilters({ activeFilter, onFilterChange, counts = {} }) {
  return (
    <div className="tlf-root" role="tablist" aria-label="Activity filter">
      {FILTERS.map((f) => (
        <button
          key={f.key}
          role="tab"
          aria-selected={activeFilter === f.key}
          className={`tlf-pill ${activeFilter === f.key ? "tlf-pill--active" : ""}`}
          onClick={() => onFilterChange(f.key)}
        >
          <span className="tlf-icon">{f.icon}</span>
          <span className="tlf-label">{f.label}</span>
          {counts[f.key] != null && counts[f.key] > 0 && (
            <span className="tlf-count">{counts[f.key]}</span>
          )}
        </button>
      ))}
    </div>
  );
}
