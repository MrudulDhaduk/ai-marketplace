import { useEffect, useState } from "react";
import { apiRequest } from "../../lib/api";
import { useAuth } from "../../context/AuthContext";

function timeAgo(dateStr) {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function ReviewCard({ project, idx }) {
  const isApproved = project.review_status === "approved";
  const isRevision = project.review_status === "revision_requested";

  return (
    <div className="dd-card" style={{ "--ci": idx }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px" }}>
        <div>
          <h3 className="dd-card-title" style={{ marginBottom: "4px" }}>{project.title}</h3>
          <span style={{ fontSize: "12px", opacity: 0.5 }}>
            {project.reviewed_at ? `Reviewed ${timeAgo(project.reviewed_at)}` : "Pending review"}
          </span>
        </div>
        <span className={`dd-status ${isApproved ? "approved" : isRevision ? "review" : "pending"}`}>
          {isApproved ? "✓ Approved" : isRevision ? "↩ Revision" : "⏳ Pending"}
        </span>
      </div>

      {project.review_feedback && (
        <div style={{
          marginTop: "12px",
          padding: "12px",
          background: "rgba(255,255,255,0.04)",
          borderRadius: "8px",
          borderLeft: `3px solid ${isApproved ? "var(--cyan, #22d3ee)" : "var(--amber, #f59e0b)"}`,
        }}>
          <p style={{ fontSize: "13px", opacity: 0.8, lineHeight: 1.6, margin: 0 }}>
            "{project.review_feedback}"
          </p>
        </div>
      )}

      <div className="dd-card-meta" style={{ marginTop: "12px" }}>
        <span>₹{project.min_budget} – ₹{project.max_budget}</span>
        <span className={`dd-status ${project.status === "completed" ? "completed" : "active"}`}>
          {project.status}
        </span>
      </div>
    </div>
  );
}

export default function DeveloperRatings() {
  const { currentUser } = useAuth();
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!currentUser?.id) return;
    apiRequest(`/projects/assigned/${currentUser.id}?limit=50`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        const rows = (data?.data ?? []).filter(
          (p) => p.review_status === "approved" || p.review_status === "revision_requested" || p.review_feedback
        );
        setProjects(rows);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [currentUser?.id]);

  const approved = projects.filter((p) => p.review_status === "approved").length;
  const total = projects.length;

  if (loading) {
    return (
      <div className="dd-content">
        <div className="dd-loading">
          <div className="dd-spinner" />
          <span>Loading reviews…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="dd-content">
      {/* Summary strip */}
      {total > 0 && (
        <div style={{ display: "flex", gap: "16px", marginBottom: "24px", flexWrap: "wrap" }}>
          <div className="dd-card" style={{ "--ci": 0, flex: 1, minWidth: "140px", textAlign: "center" }}>
            <div style={{ fontSize: "2rem", fontWeight: 700, color: "var(--cyan, #22d3ee)" }}>{approved}</div>
            <div style={{ fontSize: "12px", opacity: 0.6, marginTop: "4px" }}>Approved</div>
          </div>
          <div className="dd-card" style={{ "--ci": 1, flex: 1, minWidth: "140px", textAlign: "center" }}>
            <div style={{ fontSize: "2rem", fontWeight: 700 }}>{total}</div>
            <div style={{ fontSize: "12px", opacity: 0.6, marginTop: "4px" }}>Total Reviews</div>
          </div>
          <div className="dd-card" style={{ "--ci": 2, flex: 1, minWidth: "140px", textAlign: "center" }}>
            <div style={{ fontSize: "2rem", fontWeight: 700, color: "var(--lime, #84cc16)" }}>
              {total > 0 ? Math.round((approved / total) * 100) : 0}%
            </div>
            <div style={{ fontSize: "12px", opacity: 0.6, marginTop: "4px" }}>Approval Rate</div>
          </div>
        </div>
      )}

      {projects.length === 0 ? (
        <div className="dd-empty">
          <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>⭐</div>
          <h3 className="dd-empty-title">No reviews yet</h3>
          <p style={{ opacity: 0.6, marginTop: "8px" }}>
            Complete projects and get client feedback to see your reviews here.
          </p>
        </div>
      ) : (
        <div className="dd-grid">
          {projects.map((p, idx) => (
            <ReviewCard key={p.id} project={p} idx={idx} />
          ))}
        </div>
      )}
    </div>
  );
}
