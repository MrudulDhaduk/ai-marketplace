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

function IList() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <path
        d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
export default function ActiveBids({ bids, view, setView }) {
  if (!Array.isArray(bids) || bids.length === 0) {
    return (
      <div className="dd-content">
        <div className="dd-empty">
          <h3>No bids yet</h3>
          <p>Start bidding on projects to see them here.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="dd-content">
      <div className="dd-controls">
        <div className="dd-view-toggle">
          <button
            className={`dd-view-btn${view === "grid" ? " dd-view-btn--on" : ""}`}
            onClick={() => setView("grid")}
            title="Grid view"
          >
            <IGrid />
          </button>

          <button
            className={`dd-view-btn${view === "list" ? " dd-view-btn--on" : ""}`}
            onClick={() => setView("list")}
            title="List view"
          >
            <IList />
          </button>
        </div>
      </div>
      <div key={view} className={`dd-grid${view === "list" ? " dd-grid--list" : ""}`}>
        {bids.map((b, i) => (
          <div key={b.id} className="dd-card" style={{ "--ci": i }}>
            <h3 className="dd-card-title">{b.title}</h3>

            <p className="dd-card-desc">{b.proposal}</p>

            <div className="dd-card-meta">
              <span>₹{b.amount}</span>

              <span className={`dd-status ${b.status}`}>{b.status}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
