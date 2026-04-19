import { useState, useEffect, useRef, useCallback } from "react";
import "./ClientDashboard.css";
import CreateProjectModal from "../../components/CreateProjectModal";
import TopBar from "../../components/TopBar";
import ProjectBidsModal from "../../components/ProjectBidsModal";
/* ═══════════════════════════════════════════════════
   DATA
═══════════════════════════════════════════════════ */
const STATS = [
  {
    id: "active",
    label: "Active",
    value: 4,
    prefix: "",
    accent: "orange",
    Icon: IconFlame,
  },
  {
    id: "bids",
    label: "New Bids",
    value: 17,
    prefix: "",
    accent: "gold",
    Icon: IconBids,
  },
  {
    id: "spent",
    label: "Deployed",
    value: 8400,
    prefix: "$",
    accent: "lime",
    Icon: IconDeploy,
  },
  {
    id: "done",
    label: "Completed",
    value: 12,
    prefix: "",
    accent: "teal",
    Icon: IconShield,
  },
];

const FEED = [
  {
    id: 1,
    dot: "orange",
    text: 'New bid on "AI Chatbot for E-commerce"',
    time: "2m ago",
  },
  {
    id: 2,
    dot: "teal",
    text: 'Dev replied on "Object Detection"',
    time: "14m ago",
  },
  {
    id: 3,
    dot: "lime",
    text: '"Voice-to-Invoice" milestone complete',
    time: "1h ago",
  },
  {
    id: 4,
    dot: "orange",
    text: '3 new bids on "Resume Screening"',
    time: "3h ago",
  },
  {
    id: 5,
    dot: "gold",
    text: 'Deadline alert: "Content Calendar" in 5 days',
    time: "5h ago",
  },
];

const TABS = ["All", "Bidding", "Active", "Completed", "Draft"];

function formatProjectForCard(p) {
  const hasBudgetText = typeof p.budget === "string" && p.budget.trim();
  const minBudget = p.min_budget ?? p.minBudget ?? 0;
  const maxBudget = p.max_budget ?? p.maxBudget ?? 0;
  const budget = hasBudgetText ? p.budget : `₹${minBudget} - ₹${maxBudget}`;

  const hasDueText = typeof p.due === "string" && p.due.trim();
  const dueSource = p.due_date ?? p.dueDate ?? null;
  const parsedDueDate = dueSource ? new Date(dueSource) : null;
  const due = hasDueText
    ? p.due
    : parsedDueDate && !Number.isNaN(parsedDueDate.getTime())
      ? parsedDueDate.toLocaleDateString("en-IN", {
          day: "numeric",
          month: "short",
        })
      : "No deadline";

  return {
    ...p,
    budget,
    due,
    status: p.status || "draft",
    bids: p.bids || 0,
    progress: p.progress || 0,
    tags: Array.isArray(p.tags) ? p.tags : [],
  };
}

/* ═══════════════════════════════════════════════════
   ICONS
═══════════════════════════════════════════════════ */
function IconFlame() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <path
        d="M12 2c0 5-6 7-6 12a6 6 0 0 0 12 0c0-5-6-7-6-12z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M12 12c0 2-2 3-2 5a2 2 0 0 0 4 0c0-2-2-3-2-5z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function IconBids() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <path
        d="M3 17l4-8 4 5 3-3 4 6"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function IconDeploy() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M12 8v4l3 3"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
function IconShield() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <path
        d="M12 3L4 7v5c0 4.4 3.4 8.5 8 9.5 4.6-1 8-5.1 8-9.5V7l-8-4z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M9 12l2 2 4-4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function IconPlus() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <path
        d="M12 5v14M5 12h14"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </svg>
  );
}
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
      <circle cx="7" cy="15" r="1" fill="currentColor" />
    </svg>
  );
}
function IconCog() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  );
}

/* ═══════════════════════════════════════════════════
   HOOKS
═══════════════════════════════════════════════════ */
function useCountUp(target, ms = 1300, delay = 0) {
  const [n, setN] = useState(0);
  useEffect(() => {
    const tid = setTimeout(() => {
      const t0 = performance.now();
      const tick = (now) => {
        const p = Math.min((now - t0) / ms, 1);
        setN(Math.round((1 - Math.pow(1 - p, 4)) * target));
        if (p < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }, delay);
    return () => clearTimeout(tid);
  }, [target, ms, delay]);
  return n;
}

function useTilt(elRef, strength = 7) {
  const onMove = useCallback(
    (e) => {
      const el = elRef.current;
      if (!el) return;
      const { left, top, width, height } = el.getBoundingClientRect();
      const x = ((e.clientX - left) / width - 0.5) * strength;
      const y = ((e.clientY - top) / height - 0.5) * strength;
      el.style.transform = `perspective(700px) rotateX(${-y}deg) rotateY(${x}deg) translateY(-4px)`;
      el.style.transition = "transform 0.08s ease";
    },
    [elRef, strength],
  );

  const onLeave = useCallback(() => {
    const el = elRef.current;
    if (!el) return;
    el.style.transform = "";
    el.style.transition = "transform 0.4s cubic-bezier(0.34,1.56,0.64,1)";
  }, [elRef]);

  return { onMouseMove: onMove, onMouseLeave: onLeave };
}

/* rAF-throttled mouse position — returns {x, y} in viewport coords */
function useMousePos() {
  const [pos, setPos] = useState({ x: -9999, y: -9999 });
  const raf = useRef(null);
  useEffect(() => {
    const onMove = (e) => {
      if (raf.current) return;
      raf.current = requestAnimationFrame(() => {
        setPos({ x: e.clientX, y: e.clientY });
        raf.current = null;
      });
    };
    window.addEventListener("mousemove", onMove, { passive: true });
    return () => {
      window.removeEventListener("mousemove", onMove);
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, []);
  return pos;
}

/* Delegated ripple — single listener on a container */
function useRipple(containerRef) {
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (e) => {
      const target = e.target.closest("[data-ripple]");
      if (!target) return;
      const rect = target.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height) * 1.6;
      const wave = document.createElement("span");
      wave.className = "ripple-wave";
      wave.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX - rect.left - size / 2}px;top:${e.clientY - rect.top - size / 2}px`;
      target.appendChild(wave);
      wave.addEventListener("animationend", () => wave.remove(), {
        once: true,
      });
    };
    el.addEventListener("click", handler);
    return () => el.removeEventListener("click", handler);
  }, [containerRef]);
}

/* ═══════════════════════════════════════════════════
   BACKGROUND COMPONENT
   KEY ARCHITECTURAL DECISION:
   • position: fixed — escapes all parent stacking contexts
   • z-index: 0 — behind sidebar (40) and content (1)
   • NO overflow:hidden on itself or any ancestor that
     could clip the cursor-orb child
   • .db-shell has NO background color — the fixed bg-layer
     IS the background, visible through the transparent shell
═══════════════════════════════════════════════════ */
function Background({ light, mousePos, tabTone }) {
  return (
    <div
      className={`bg-layer ${light ? `bg-layer--light bg-layer--tone-${tabTone}` : "bg-layer--dark"}`}
    >
      {light ? (
        /* ── LIGHT THEME LAYERS ── */
        <>
          <div className="bg-mesh" />
          <div className="bg-blob bg-blob--1" />
          <div className="bg-blob bg-blob--2" />
          <div className="bg-blob bg-blob--3" />
          <div className="bg-dot-grid" />
          <div className="bg-grain" />
        </>
      ) : (
        /* ── DARK THEME LAYERS ── */
        <>
          <div className="bg-orb bg-orb--1" />
          <div className="bg-orb bg-orb--2" />
          <div className="bg-orb bg-orb--3" />
          <div className="bg-aurora-grid" />
          <div className="bg-noise" />
          <div className="bg-vignette" />
        </>
      )}

      {/*
        CURSOR ORB — lives inside bg-layer which is position:fixed
        and has NO overflow:hidden, so it renders freely.
        JS drives left/top; CSS transition creates the smooth lag.
        transform:translate(-50%,-50%) centres it on the cursor.
      */}
      <div
        className={`bg-cursor-orb ${light ? "bg-cursor-orb--light" : "bg-cursor-orb--dark"}`}
        style={{ left: mousePos.x, top: mousePos.y }}
      />
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   SIDEBAR
═══════════════════════════════════════════════════ */
const NAV_ITEMS = [
  { key: "overview", label: "Overview", Icon: IconPulse },
  { key: "projects", label: "Projects", Icon: IconProjects },
  { key: "messages", label: "Messages", Icon: IconMsg },
  { key: "payments", label: "Payments", Icon: IconCard },
  { key: "settings", label: "Settings", Icon: IconCog },
];

function Sidebar({ user }) {
  const [active, setActive] = useState("overview");
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
            className={`sb-item${active === key ? " sb-item--on" : ""}`}
            onClick={() => setActive(key)}
            title={label}
            data-ripple=""
          >
            <span className="sb-icon">
              <Icon />
            </span>
            <span className="sb-label">{label}</span>
            {active === key && <span className="sb-active-bar" />}
          </button>
        ))}
      </nav>
      <div className="sb-footer">
        <div className="sb-avatar">
          {user?.username?.[0]?.toUpperCase() || "U"}
        </div>
        <div className="sb-user-info">
          <span className="sb-user-name">{user?.username || "User"}</span>
          <span className="sb-user-role">Client</span>
        </div>
      </div>
    </aside>
  );
}

/* ═══════════════════════════════════════════════════
   HEADER
═══════════════════════════════════════════════════ */
function DashHeader({ user, onCreateProject }) {
  const h = new Date().getHours();
  const greet =
    h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";

  const [showModal, setShowModal] = useState(false);

  return (
    <>
      <header className="dash-header">
        <div className="dash-header-left">
          <h1 className="dash-greeting">
            {greet},{" "}
            <span className="dash-name">{user?.username || "there"}</span> 👋
          </h1>

          <p className="dash-sub">
            Your projects are live — here's what needs attention today.
          </p>
        </div>

        <button
          className="post-btn"
          data-ripple=""
          onClick={() => setShowModal(true)}
        >
          <span className="post-btn-icon">
            <IconPlus />
          </span>
          Post New Project
          <span className="post-btn-shine" />
        </button>
      </header>

      {/* ✅ Modal */}
      {showModal && (
        <CreateProjectModal
          onClose={() => setShowModal(false)}
          onCreate={onCreateProject}
        />
      )}
    </>
  );
}

/* ═══════════════════════════════════════════════════
   STAT CARD
═══════════════════════════════════════════════════ */
function StatCard({ stat, idx }) {
  const count = useCountUp(stat.value, 1200, idx * 110);
  const ref = useRef(null);
  const tilt = useTilt(ref, 6);
  return (
    <div
      ref={ref}
      className={`stat-card sc-${stat.accent}`}
      style={{ "--si": idx }}
      data-ripple=""
      {...tilt}
    >
      <div className="sc-icon">
        <stat.Icon />
      </div>
      <div className="sc-body">
        <span className="sc-value">
          {stat.prefix}
          {count.toLocaleString()}
        </span>
        <span className="sc-label">{stat.label}</span>
      </div>
      <div className="sc-glow" />
      <div className="sc-border-line" />
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   PROGRESS BAR
═══════════════════════════════════════════════════ */
function ProgressBar({ pct, status }) {
  const [w, setW] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setW(pct), 500);
    return () => clearTimeout(t);
  }, [pct]);
  return (
    <div className="prog-track">
      <div
        className={`prog-fill prog-fill--${status}`}
        style={{ width: `${w}%` }}
      />
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   PROJECT CARD
═══════════════════════════════════════════════════ */
const S_CFG = {
  active: { cls: "status-active", label: "Active" },
  review: { cls: "status-review", label: "In Review" },
  draft: { cls: "status-draft", label: "Draft" },
  completed: { cls: "status-completed", label: "Completed" },
};

function ProjectCard({ p, idx, onView }) {
  const ref = useRef(null);
  const tilt = useTilt(ref, 5);
  const cfg = S_CFG[p.status] || S_CFG.draft;
  return (
    <article
      ref={ref}
      className="pc"
      style={{ "--ci": idx }}
      data-ripple=""
      {...tilt}
    >
      <div className="pc-top">
        <span className="pc-cat">{p.cat}</span>
        <span className={`pc-badge ${cfg.cls}`}>
          <span className="status-dot" aria-hidden="true" />
          {cfg.label}
        </span>
      </div>
      <h3 className="pc-title">{p.title}</h3>
      <ProgressBar pct={p.progress} status={p.status} />
      <div className="pc-meta">
        <div className="pc-meta-col">
          <span className="pc-meta-lbl">Budget</span>
          <span className="pc-meta-val pc-meta-val--hi">{p.budget}</span>
        </div>
        <div className="pc-meta-col">
          <span className="pc-meta-lbl">Bids</span>
          <span className="pc-meta-val">{p.bids}</span>
        </div>
        <div className="pc-meta-col">
          <span className="pc-meta-lbl">Due</span>
          <span className="pc-meta-val">{p.due}</span>
        </div>
      </div>
      <div className="pc-footer">
        <div className="pc-tags">
          {(Array.isArray(p.tags) ? p.tags : []).map((t) => (
            <span key={t} className="pc-tag">
              {t}
            </span>
          ))}
        </div>
        <button
          className="pc-view"
          data-ripple=""
          onClick={() => onView(p)}
        >
          View →
        </button>
      </div>
      <div className="pc-surface-glow" />
    </article>
  );
}

/* ═══════════════════════════════════════════════════
   PROJECTS PANEL
═══════════════════════════════════════════════════ */
function ProjectsPanel({ projects, onTabChange, onViewProject }) {
  const [tab, setTab] = useState("All");
  const [animOut, setAnimOut] = useState(false);
  const [rendered, setRendered] = useState("All");

  const switchTab = (t) => {
    if (t === tab) return;
    setAnimOut(true);
    setTimeout(() => {
      setTab(t);
      setRendered(t);
      setAnimOut(false);
      onTabChange?.(t.toLowerCase());
    }, 180);
  };

  const list =
    rendered === "All"
      ? projects
      : projects.filter((p) => p.status === rendered.toLowerCase());

  return (
    <section className="pp">
      <div className="pp-head">
        <h2 className="pp-title">Projects</h2>
        <nav className="tab-bar" role="tablist">
          {TABS.map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              className={`tb${tab === t ? " tb--on" : ""}`}
              onClick={() => switchTab(t)}
              data-ripple=""
            >
              {t}
              {t !== "All" && (
                <span className="tb-count">
                  {projects.filter((p) => p.status === t.toLowerCase()).length}
                </span>
              )}
            </button>
          ))}
        </nav>
      </div>
      <div className={`pp-grid${animOut ? " pp-grid--out" : ""}`}>
        {list.length ? (
          list.map((p, i) => (
            <ProjectCard
              key={p.id ?? i}
              p={p}
              idx={i}
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

/* ═══════════════════════════════════════════════════
   ACTIVITY FEED
═══════════════════════════════════════════════════ */
function ActivityFeed() {
  return (
    <aside className="feed">
      <div className="feed-head">
        <span className="feed-title">Live Feed</span>
        <span className="feed-live-badge">
          <span className="feed-live-dot" />
          Live
        </span>
      </div>
      <ul className="feed-list">
        {FEED.map((item, i) => (
          <li key={item.id} className="feed-row" style={{ "--fi": i }}>
            <span className={`feed-pip pip--${item.dot}`} />
            <div className="feed-content">
              <p className="feed-text">{item.text}</p>
              <span className="feed-time">{item.time}</span>
            </div>
          </li>
        ))}
      </ul>
    </aside>
  );
}

/* ═══════════════════════════════════════════════════
   ROOT
═══════════════════════════════════════════════════ */
export default function ClientDashboard() {
  const user = (() => {
    try {
      return JSON.parse(localStorage.getItem("user"));
    } catch {
      return null;
    }
  })();

  const [light, setLight] = useState(false);
  const [projects, setProjects] = useState([]);
  const [tabTone, setTabTone] = useState("all");
  const mousePos = useMousePos();
  const shellRef = useRef(null);

  // Step 1: Add selectedProject state
  const [selectedProject, setSelectedProject] = useState(null);

  useRipple(shellRef);

  const handleNewProject = (project) => {
    setProjects((prev) => [formatProjectForCard(project), ...prev]);
  };

  useEffect(() => {
    const controller = new AbortController();

    const fetchProjects = async () => {
      try {
        const token = localStorage.getItem("token");
        const response = await fetch("http://localhost:5000/api/projects", {
          headers: token
            ? {
                Authorization: `Bearer ${token}`,
              }
            : {},
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`Failed to fetch projects: ${response.status}`);
        }

        const data = await response.json();
        setProjects(
          Array.isArray(data)
            ? data.map((project) => formatProjectForCard(project))
            : [],
        );
      } catch (error) {
        if (error.name !== "AbortError") {
          console.error("Error fetching projects:", error);
          setProjects([]);
        }
      }
    };

    fetchProjects();

    return () => controller.abort();
  }, []);

  const formattedProjects = projects.map((p) => {
    const minBudget = p.min_budget ?? 0;
    const maxBudget = p.max_budget ?? 0;
    const hasDueDate = Boolean(p.due_date);
    const parsedDueDate = hasDueDate ? new Date(p.due_date) : null;
    const due =
      parsedDueDate && !Number.isNaN(parsedDueDate.getTime())
        ? parsedDueDate.toLocaleDateString("en-IN", {
            day: "numeric",
            month: "short",
          })
        : "No deadline";

    return {
      ...p,
      budget: `₹${minBudget} - ₹${maxBudget}`,
      due,
      status: p.status || "draft",
      bids: p.bids || 0,
      progress: p.progress || 0,
      tags: p.tags || [],
    };
  });

  return (
    /*
      .db-shell:
        - transparent background (bg-layer provides it via position:fixed)
        - no overflow:hidden (would clip fixed children)
        - carries theme class for CSS variable scoping
    */
    <div>
      <div className="client-theme">
        <TopBar />
      </div>
      <div
        ref={shellRef}
        className={`db-shell${light ? " db-shell--light" : ""}`}
      >
        <Background light={light} mousePos={mousePos} tabTone={tabTone} />
        <Sidebar user={user} />
        <div className="db-main">
          <DashHeader user={user} onCreateProject={handleNewProject} />
          <div className="stats-row">
            {STATS.map((s, i) => (
              <StatCard key={s.id} stat={s} idx={i} />
            ))}
          </div>
          <div className="db-body">
            <ProjectsPanel
              projects={projects}
              onTabChange={setTabTone}
              onViewProject={(project) => setSelectedProject(project)}
            />
            <ActivityFeed />
          </div>
        </div>
        <button
          className="theme-toggle"
          onClick={() => setLight((v) => !v)}
          title={light ? "Switch to dark" : "Switch to light"}
          aria-label={light ? "Switch to dark" : "Switch to light"}
        >
          {light ? "🌙" : "☀️"}
        </button>
        {selectedProject && (
          <div className="client-theme">
          <ProjectBidsModal 
            project={selectedProject}
            onClose={() => setSelectedProject(null)}
          />
          </div>
        )}
      </div>
    </div>
  );
}
