function ICode() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <polyline
        points="16 18 22 12 16 6"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <polyline
        points="8 6 2 12 8 18"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function EmptyState({ hasFilters, onClear }) {
  return (
    <div className="dd-empty">
      <div className="dd-empty-icon">
        <ICode />
      </div>
      <h3 className="dd-empty-title">
        {hasFilters ? "No matching projects" : "No projects available"}
      </h3>
      <p className="dd-empty-sub">
        {hasFilters
          ? "Try adjusting your filters to see more results."
          : "Check back soon — new AI projects are posted daily."}
      </p>
      {hasFilters && (
        <button className="dd-empty-cta" onClick={onClear} data-ripple="">
          Clear filters
        </button>
      )}
    </div>
  );
}
