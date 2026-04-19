import { useEffect, useRef, useState } from "react";

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

function IFilter() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <polygon
        points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ITag() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <path
        d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <circle cx="7" cy="7" r="1.5" fill="currentColor" />
    </svg>
  );
}

export default function FilterBar({
  budgetFilter,
  setBudgetFilter,
  tagFilter,
  setTagFilter,
  activeCount,
  showAll,
  setShowAll,
  allTags,
}) {
  const [tagOpen, setTagOpen] = useState(false);
  const dropRef = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (dropRef.current && !dropRef.current.contains(e.target)) setTagOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const BUDGET_OPTS = [
    { label: "Any budget", value: "all" },
    { label: "Under ₹25k", value: "low" },
    { label: "₹25k – ₹50k", value: "mid" },
    { label: "Above ₹50k", value: "high" },
  ];

  const toggleTag = (tag) => {
    setTagFilter((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    );
  };

  const clearAll = () => {
    setBudgetFilter("all");
    setTagFilter([]);
  };

  return (
    <div className="dd-filters">
      <span className="dd-filters-icon">
        <IFilter />
      </span>

      <div className="dd-filter-group">
        {BUDGET_OPTS.map((opt) => (
          <button
            key={opt.value}
            className={`dd-filter-chip${budgetFilter === opt.value ? " dd-filter-chip--on" : ""}`}
            onClick={() => setBudgetFilter(opt.value)}
            data-ripple=""
          >
            {opt.label}
          </button>
        ))}
      </div>

      <div className="dd-tag-drop" ref={dropRef}>
        <button
          className={`dd-filter-chip dd-tag-trigger${tagFilter.length ? " dd-filter-chip--on" : ""}`}
          onClick={() => setTagOpen((v) => !v)}
          data-ripple=""
        >
          <ITag />
          {tagFilter.length
            ? `${tagFilter.length} tag${tagFilter.length > 1 ? "s" : ""}`
            : "Technologies"}
          <span className={`dd-chevron${tagOpen ? " dd-chevron--open" : ""}`}>
            <IChevron />
          </span>
        </button>

        {tagOpen && (
          <div className="dd-tag-menu">
            {allTags.map((tag) => (
              <button
                key={tag}
                className={`dd-tag-opt${tagFilter.includes(tag) ? " dd-tag-opt--on" : ""}`}
                onClick={() => toggleTag(tag)}
              >
                {tagFilter.includes(tag) && <span className="dd-tag-check">✓</span>}
                {tag}
              </button>
            ))}
          </div>
        )}
      </div>

      <button
        className="dd-filter-btn"
        onClick={() => setShowAll((prev) => !prev)}
      >
        {showAll ? "Show Matching" : "Show All Projects"}
      </button>

      {activeCount > 0 && (
        <button className="dd-filter-clear" onClick={clearAll}>
          Clear ({activeCount})
        </button>
      )}
    </div>
  );
}
