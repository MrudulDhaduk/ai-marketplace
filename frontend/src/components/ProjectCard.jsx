import { useRef } from "react";
import { useTilt } from "../pages/hooks";

const STATUS_META = {
  open: { label: "Open", cls: "s-open" },
  bidding: { label: "Bidding", cls: "s-bidding" },
  closed: { label: "Closed", cls: "s-closed" },
};

function ICalendar() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <rect
        x="3"
        y="4"
        width="18"
        height="18"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M16 2v4M8 2v4M3 10h18"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IWallet() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <rect
        x="2"
        y="6"
        width="20"
        height="14"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path d="M2 10h20" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="17" cy="15" r="1.5" fill="currentColor" />
    </svg>
  );
}

function IZap() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <polygon
        points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function formatBudget(min, max) {
  const fmt = (n) => (n >= 1000 ? `₹${(n / 1000).toFixed(0)}k` : `₹${n}`);
  return `${fmt(min)} – ${fmt(max)}`;
}

function daysLeft(iso) {
  const diff = new Date(iso) - new Date();
  const days = Math.ceil(diff / 86400000);
  if (days < 0) return { label: "Expired", urgent: true };
  if (days === 0) return { label: "Today", urgent: true };
  if (days <= 3) return { label: `${days}d`, urgent: true };
  return { label: `${days}d left`, urgent: false };
}

export default function ProjectCard({ project, idx, setSelectedProject }) {
  const ref = useRef(null);
  const tilt = useTilt(ref, 5);
  const meta = STATUS_META[project.status] || STATUS_META.open;
  const due = daysLeft(project.due_date);

  return (
    <article ref={ref} className="dd-card" style={{ "--ci": idx }} {...tilt}>
      <div className="dd-card-accent" />

      <div className="dd-card-head">
        <span className={`dd-status ${meta.cls}`}>{meta.label}</span>
        <span className={`dd-due${due.urgent ? " dd-due--urgent" : ""}`}>
          <ICalendar />
          {due.label}
        </span>
      </div>

      <h3 className="dd-card-title">{project.title}</h3>
      <p className="dd-card-desc">{project.description}</p>

      <div className="dd-card-tags">
        {project.tags.slice(0, 4).map((tag) => (
          <span key={tag} className="dd-tag">
            {tag}
          </span>
        ))}
        {project.tags.length > 4 && (
          <span className="dd-tag dd-tag--more">+{project.tags.length - 4}</span>
        )}
      </div>

      <div className="dd-card-foot">
        <div className="dd-budget">
          <IWallet />
          <span className="dd-budget-val">
            {formatBudget(project.min_budget, project.max_budget)}
          </span>
        </div>
        <button
          className="dd-bid-btn"
          data-ripple=""
          onClick={() => setSelectedProject(project)}
        >
          <IZap />
          Bid Now
        </button>
      </div>

      <div className="dd-card-glow" />
    </article>
  );
}
