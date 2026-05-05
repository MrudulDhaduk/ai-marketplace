import { useEffect, useRef, useState } from "react";
import { useTilt } from "../hooks";

const TABS = ["All", "Bidding", "Active", "Completed", "Draft"];

const STATUS_CONFIG = {
  active: { cls: "status-active", label: "Active" },
  review: { cls: "status-review", label: "In Review" },
  draft: { cls: "status-draft", label: "Draft" },
  completed: { cls: "status-completed", label: "Completed" },
};

function ProgressBar({ pct, status }) {
  const [w, setW] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setW(pct), 500);
    return () => clearTimeout(t);
  }, [pct]);

  return (
    <div className="prog-track">
      <div className={`prog-fill prog-fill--${status}`} style={{ width: `${w}%` }} />
    </div>
  );
}

function ProjectCard({ project, idx, onView }) {
  const ref = useRef(null);
  const tilt = useTilt(ref, 5);
  const cfg = STATUS_CONFIG[project.status] || STATUS_CONFIG.draft;

  return (
    <article
      ref={ref}
      className="pc"
      style={{ "--ci": idx }}
      data-ripple=""
      {...tilt}
    >
      <div className="pc-top">
        <span className="pc-cat">{project.cat}</span>
        <span className={`pc-badge ${cfg.cls}`}>
          <span className="status-dot" aria-hidden="true" />
          {cfg.label}
        </span>
      </div>
      <h3 className="pc-title">{project.title}</h3>
      <ProgressBar pct={project.progress} status={project.status} />
      <div className="pc-meta">
        <div className="pc-meta-col">
          <span className="pc-meta-lbl">Budget</span>
          <span className="pc-meta-val pc-meta-val--hi">{project.budget}</span>
        </div>
        <div className="pc-meta-col">
          <span className="pc-meta-lbl">Bids</span>
          <span className="pc-meta-val">{project.bids}</span>
        </div>
        <div className="pc-meta-col">
          <span className="pc-meta-lbl">Due</span>
          <span className="pc-meta-val">{project.due}</span>
        </div>
      </div>
      <div className="pc-footer">
        <div className="pc-tags">
          {(Array.isArray(project.tags) ? project.tags : []).map((tag) => (
            <span key={tag} className="pc-tag">
              {tag}
            </span>
          ))}
        </div>
        <button className="pc-view" data-ripple="" onClick={() => onView(project)}>
          View →
        </button>
      </div>
      <div className="pc-surface-glow" />
    </article>
  );
}

export default function ClientProjectsPanel({ projects, onTabChange, onViewProject }) {
  const [tab, setTab] = useState("All");
  const [animOut, setAnimOut] = useState(false);
  const [rendered, setRendered] = useState("All");

  const switchTab = (nextTab) => {
    if (nextTab === tab) return;
    setAnimOut(true);
    setTimeout(() => {
      setTab(nextTab);
      setRendered(nextTab);
      setAnimOut(false);
      onTabChange?.(nextTab.toLowerCase());
    }, 180);
  };

  const list =
    rendered === "All"
      ? projects
      : projects.filter((project) => project.status === rendered.toLowerCase());

  return (
    <section className="pp">
      <div className="pp-head">
        <h2 className="pp-title">Projects</h2>
        <nav className="tab-bar" role="tablist">
          {TABS.map((tabItem) => (
            <button
              key={tabItem}
              role="tab"
              aria-selected={tab === tabItem}
              className={`tb${tab === tabItem ? " tb--on" : ""}`}
              onClick={() => switchTab(tabItem)}
              data-ripple=""
            >
              {tabItem}
              {tabItem !== "All" && (
                <span className="tb-count">
                  {projects.filter((project) => project.status === tabItem.toLowerCase()).length}
                </span>
              )}
            </button>
          ))}
        </nav>
      </div>
      <div className={`pp-grid${animOut ? " pp-grid--out" : ""}`}>
        {list.length ? (
          list.map((project, index) => (
            <ProjectCard
              key={project.id ?? index}
              project={project}
              idx={index}
              onView={onViewProject}
            />
          ))
        ) : (
          <div className="pp-empty">No projects yet</div>
        )}
      </div>
    </section>
  );
}
