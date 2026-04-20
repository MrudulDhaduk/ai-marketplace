export default function MyProjects({ assignedProjects, onOpenProject }) {
  if (!assignedProjects || assignedProjects.length === 0) {
    return (
      <div className="dd-content">
        <div className="dd-empty">
          <h3 className="dd-empty-title">My Projects coming soon</h3>
        </div>
      </div>
    );
  }
  return (
    <div className="dd-content">
      <div className="dd-grid">
        {(Array.isArray(assignedProjects) ? assignedProjects : []).map((p, idx) => (
          <div key={p.id} className="dd-card dd-card--assigned" style={{ "--ci": idx }}>
            
            <h3 className="dd-card-title">{p.title}</h3>
            
            <p className="dd-card-desc">{p.description}</p>

            <div className="dd-card-meta">
              <span>
                ₹{p.min_budget} – ₹{p.max_budget}
              </span>

              <span
                className={`dd-status ${
                  p.status === "active" ? "active" : "completed"
                }`}
              >
                {p.status === "active" ? "In Progress" : "Completed"}
              </span>
            </div>

            <button
              className="dd-bid-btn"
              // Opens workspace in-place without changing route/layout.
              onClick={() => onOpenProject?.(p)}
            >
              {p.status === "active"
                ? "Continue Work →"
                : "View Details"}
            </button>

          </div>
        ))}
      </div>
    </div>
  );
}
