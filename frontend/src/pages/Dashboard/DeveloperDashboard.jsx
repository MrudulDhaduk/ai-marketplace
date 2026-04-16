import { useState, useEffect, useRef, useCallback } from "react";
import "./DeveloperDashboard.css";
import TopBar from "../../components/TopBar";
/* ═══════════════════════════════════════════════════
   DUMMY DATA  (replace with API fetch)
═══════════════════════════════════════════════════ */
const DUMMY_PROJECTS = [
  {
    id: 1,
    title: "AI-Powered Resume Screener",
    description:
      "Build an NLP pipeline that scores resumes against job descriptions using semantic similarity. Must integrate with our existing HR system via REST API.",
    min_budget: 25000,
    max_budget: 45000,
    due_date: "2025-05-18",
    status: "open",
    tags: ["Python", "NLP", "FastAPI", "OpenAI"],
  },
  {
    id: 2,
    title: "Real-time Fraud Detection Dashboard",
    description:
      "Design and implement a streaming analytics dashboard that visualises transaction anomaly scores. WebSocket updates required.",
    min_budget: 40000,
    max_budget: 70000,
    due_date: "2025-06-02",
    status: "open",
    tags: ["React", "WebSocket", "Kafka", "Python"],
  },
  {
    id: 3,
    title: "LLM-based Legal Document Summariser",
    description:
      "Integrate Claude / GPT-4 to auto-summarise long legal documents with key clause extraction. Accuracy benchmarks required.",
    min_budget: 15000,
    max_budget: 30000,
    due_date: "2025-05-28",
    status: "open",
    tags: ["LangChain", "Claude", "Next.js", "Postgres"],
  },
  {
    id: 4,
    title: "Computer Vision for Retail Shelf Monitoring",
    description:
      "Train a YOLO v8 model to detect out-of-stock items from CCTV feeds. Cloud deployment on GCP with real-time alerting.",
    min_budget: 55000,
    max_budget: 90000,
    due_date: "2025-06-15",
    status: "open",
    tags: ["PyTorch", "YOLO", "GCP", "OpenCV"],
  },
  {
    id: 5,
    title: "Voice-to-CRM Data Entry Bot",
    description:
      "Whisper-based transcription tool that parses sales calls and auto-fills CRM fields. Salesforce integration required.",
    min_budget: 20000,
    max_budget: 38000,
    due_date: "2025-05-22",
    status: "bidding",
    tags: ["Whisper", "Salesforce", "Node.js", "AWS"],
  },
  {
    id: 6,
    title: "Personalised Learning Path Generator",
    description:
      "Build a recommendation engine that creates adaptive learning paths from user quiz performance. EdTech SaaS context.",
    min_budget: 18000,
    max_budget: 32000,
    due_date: "2025-06-08",
    status: "open",
    tags: ["Python", "Recommendation", "React", "Supabase"],
  },
];

const ALL_TAGS = [...new Set(DUMMY_PROJECTS.flatMap((p) => p.tags))].sort();

const STATUS_META = {
  open: { label: "Open", cls: "s-open" },
  bidding: { label: "Bidding", cls: "s-bidding" },
  closed: { label: "Closed", cls: "s-closed" },
};

/* ═══════════════════════════════════════════════════
   ICONS
═══════════════════════════════════════════════════ */
function ISearch() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M16.5 16.5L21 21"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
function IBell() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <path
        d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M13.73 21a2 2 0 0 1-3.46 0"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
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
function IMsg() {
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
function IBriefcase() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <rect
        x="2"
        y="7"
        width="20"
        height="14"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M12 12v4M10 14h4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
function IStar() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <polygon
        points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function ISettings() {
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

/* ═══════════════════════════════════════════════════
   HOOKS
═══════════════════════════════════════════════════ */
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

function useRipple(ref) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const handler = (e) => {
      const target = e.target.closest("[data-ripple]");
      if (!target) return;
      const rect = target.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height) * 1.6;
      const wave = document.createElement("span");
      wave.className = "dd-ripple";
      wave.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX - rect.left - size / 2}px;top:${e.clientY - rect.top - size / 2}px`;
      target.appendChild(wave);
      wave.addEventListener("animationend", () => wave.remove(), {
        once: true,
      });
    };
    el.addEventListener("click", handler);
    return () => el.removeEventListener("click", handler);
  }, [ref]);
}

function useTilt(ref, strength = 6) {
  const onMove = useCallback(
    (e) => {
      const el = ref.current;
      if (!el) return;
      const { left, top, width, height } = el.getBoundingClientRect();
      const x = ((e.clientX - left) / width - 0.5) * strength;
      const y = ((e.clientY - top) / height - 0.5) * strength;
      el.style.transform = `perspective(800px) rotateX(${-y}deg) rotateY(${x}deg) translateY(-4px)`;
      el.style.transition = "transform 0.08s ease";
    },
    [ref, strength],
  );

  const onLeave = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.transform = "";
    el.style.transition = "transform 0.5s cubic-bezier(0.34,1.56,0.64,1)";
  }, [ref]);

  return { onMouseMove: onMove, onMouseLeave: onLeave };
}

/* ═══════════════════════════════════════════════════
   BACKGROUND
═══════════════════════════════════════════════════ */
function Background({ mousePos }) {
  return (
    <div className="dd-bg">
      <div className="dd-bg-base" />
      <div className="dd-bg-orb dd-bg-orb--1" />
      <div className="dd-bg-orb dd-bg-orb--2" />
      <div className="dd-bg-orb dd-bg-orb--3" />
      <div
        className="dd-bg-cursor"
        style={{ left: mousePos.x, top: mousePos.y }}
      />
      <div className="dd-bg-grid" />
      <div className="dd-bg-noise" />
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   SIDEBAR
═══════════════════════════════════════════════════ */
const NAV = [
  { key: "feed", label: "Project Feed", Icon: IGrid },
  { key: "active", label: "Active Bids", Icon: IBriefcase },
  { key: "messages", label: "Messages", Icon: IMsg },
  { key: "ratings", label: "Ratings", Icon: IStar },
  { key: "settings", label: "Settings", Icon: ISettings },
];

function Sidebar({ user }) {
  const [active, setActive] = useState("feed");
  const [open, setOpen] = useState(false);

  return (
    <aside
      className={`dd-sidebar${open ? " dd-sidebar--open" : ""}`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <div className="dd-sb-logo">
        <span className="dd-sb-mark">NF</span>
        <span className="dd-sb-wordmark">NeuralForge</span>
      </div>

      <nav className="dd-sb-nav">
        {NAV.map(({ key, label, Icon }) => (
          <button
            key={key}
            className={`dd-sb-item${active === key ? " dd-sb-item--on" : ""}`}
            onClick={() => setActive(key)}
            title={label}
            data-ripple=""
          >
            <span className="dd-sb-icon">
              <Icon />
            </span>
            <span className="dd-sb-label">{label}</span>
            {active === key && <span className="dd-sb-pip" />}
          </button>
        ))}
      </nav>
    </aside>
  );
}


/* ═══════════════════════════════════════════════════
   FILTER BAR
═══════════════════════════════════════════════════ */
function FilterBar({
  budgetFilter,
  setBudgetFilter,
  tagFilter,
  setTagFilter,
  activeCount,
  showAll,
  setShowAll,
}) {
  const [tagOpen, setTagOpen] = useState(false);
  const dropRef = useRef(null);

  /* close dropdown on outside click */
  useEffect(() => {
    const handler = (e) => {
      if (dropRef.current && !dropRef.current.contains(e.target))
        setTagOpen(false);
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

      {/* Budget select */}
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

      {/* Tag multi-select */}
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
            {ALL_TAGS.map((tag) => (
              <button
                key={tag}
                className={`dd-tag-opt${tagFilter.includes(tag) ? " dd-tag-opt--on" : ""}`}
                onClick={() => toggleTag(tag)}
              >
                {tagFilter.includes(tag) && (
                  <span className="dd-tag-check">✓</span>
                )}
                {tag}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Move Show All Projects button here */}
      <button
        className="dd-filter-btn"
        onClick={() => setShowAll((prev) => !prev)}
      >
        {showAll ? "Show Matching" : "Show All Projects"}
      </button>

      {/* Clear */}
      {activeCount > 0 && (
        <button className="dd-filter-clear" onClick={clearAll}>
          Clear ({activeCount})
        </button>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   PROJECT CARD
═══════════════════════════════════════════════════ */
function formatBudget(min, max) {
  const fmt = (n) => (n >= 1000 ? `₹${(n / 1000).toFixed(0)}k` : `₹${n}`);
  return `${fmt(min)} – ${fmt(max)}`;
}

function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function daysLeft(iso) {
  const diff = new Date(iso) - new Date();
  const days = Math.ceil(diff / 86400000);
  if (days < 0) return { label: "Expired", urgent: true };
  if (days === 0) return { label: "Today", urgent: true };
  if (days <= 3) return { label: `${days}d`, urgent: true };
  return { label: `${days}d left`, urgent: false };
}

function ProjectCard({ project, idx }) {
  const ref = useRef(null);
  const tilt = useTilt(ref, 5);
  const meta = STATUS_META[project.status] || STATUS_META.open;
  const due = daysLeft(project.due_date);

  return (
    <article ref={ref} className="dd-card" style={{ "--ci": idx }} {...tilt}>
      {/* Animated left accent */}
      <div className="dd-card-accent" />

      {/* Header row */}
      <div className="dd-card-head">
        <span className={`dd-status ${meta.cls}`}>{meta.label}</span>
        <span className={`dd-due${due.urgent ? " dd-due--urgent" : ""}`}>
          <ICalendar />
          {due.label}
        </span>
      </div>

      {/* Title */}
      <h3 className="dd-card-title">{project.title}</h3>

      {/* Description */}
      <p className="dd-card-desc">{project.description}</p>

      {/* Tags */}
      <div className="dd-card-tags">
        {project.tags.slice(0, 4).map((tag) => (
          <span key={tag} className="dd-tag">
            {tag}
          </span>
        ))}
        {project.tags.length > 4 && (
          <span className="dd-tag dd-tag--more">
            +{project.tags.length - 4}
          </span>
        )}
      </div>

      {/* Footer */}
      <div className="dd-card-foot">
        <div className="dd-budget">
          <IWallet />
          <span className="dd-budget-val">
            {formatBudget(project.min_budget, project.max_budget)}
          </span>
        </div>
        <button className="dd-bid-btn" data-ripple="">
          <IZap />
          Bid Now
        </button>
      </div>

      {/* Hover glow */}
      <div className="dd-card-glow" />
    </article>
  );
}

/* ═══════════════════════════════════════════════════
   EMPTY STATE
═══════════════════════════════════════════════════ */
function EmptyState({ hasFilters, onClear }) {
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

/* ═══════════════════════════════════════════════════
   STAT STRIP  (minimal 3-number summary)
═══════════════════════════════════════════════════ */
function StatStrip({ projects }) {
  const open = projects.filter((p) => p.status === "open").length;
  const bidding = projects.filter((p) => p.status === "bidding").length;
  const avgBudget = projects.length
    ? Math.round(
        projects.reduce((s, p) => s + (p.min_budget + p.max_budget) / 2, 0) /
          projects.length /
          1000,
      )
    : 0;

  return (
    <div className="dd-stats">
      {[
        { val: open, label: "Open", accent: "cyan" },
        { val: bidding, label: "In Bidding", accent: "violet" },
        { val: `₹${avgBudget}k`, label: "Avg Budget", accent: "teal" },
      ].map((s, i) => (
        <div
          key={i}
          className={`dd-stat dd-stat--${s.accent}`}
          style={{ "--si": i }}
        >
          <span className="dd-stat-val">{s.val}</span>
          <span className="dd-stat-lbl">{s.label}</span>
        </div>
      ))}
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   ROOT
═══════════════════════════════════════════════════ */
export default function DeveloperDashboard() {
  const user = (() => {
    try {
      return JSON.parse(localStorage.getItem("user"));
    } catch {
      return null;
    }
  })();

  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [budget, setBudget] = useState("all");
  const [tags, setTags] = useState([]);
  const [view, setView] = useState("grid"); // "grid" | "list"
  const [showAll, setShowAll] = useState(false);

  const mousePos = useMousePos();
  const shellRef = useRef(null);
  useRipple(shellRef);

  /* ── Fetch projects from backend ── */
  useEffect(() => {
    const fetchProjects = async () => {
      setLoading(true);
      const user = JSON.parse(localStorage.getItem("user"));
      const url = `http://localhost:5000/projects/discover/${user.id}?all=${showAll}`;
      console.log("Fetching projects from:", url);
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error("fetch failed");
        const data = await res.json();
        console.log("Projects fetched:", data);
        setProjects(data || []);
      } catch {
        setProjects([]);
      } finally {
        setLoading(false);
      }
    };
    fetchProjects();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAll]);

  /* ── Filter logic ── */
  const filtered = projects.filter((p) => {
    if (p.status !== "open" && p.status !== "bidding") return false;

    const q = search.toLowerCase();
    if (
      q &&
      !p.title.toLowerCase().includes(q) &&
      !p.description?.toLowerCase().includes(q) &&
      !p.tags?.some((t) => t.toLowerCase().includes(q))
    )
      return false;

    if (budget === "low" && p.max_budget >= 25000) return false;
    if (budget === "mid" && (p.min_budget < 25000 || p.max_budget > 50000))
      return false;
    if (budget === "high" && p.min_budget <= 50000) return false;

    if (tags.length && !tags.some((t) => p.tags?.includes(t))) return false;

    return true;
  });

  const activeFilterCount = (budget !== "all" ? 1 : 0) + tags.length;
  const clearFilters = () => {
    setBudget("all");
    setTags([]);
    setSearch("");
  };

  return (
    <div ref={shellRef} className="dd-shell">
      {/* Fixed background — never clipped */}
      <Background mousePos={mousePos} />

      {/* 🔥 FULL WIDTH TOPBAR */}
      <TopBar
        search={search}
        onSearch={setSearch}
        total={projects.length}
        filtered={filtered.length}
      />

      {/* 🔥 BODY (Sidebar + Content) */}
      <div className="dd-body">
        <Sidebar user={user} />

        <div className="dd-main">
          <div className="dd-content">
            {/* Stats */}
            <StatStrip projects={projects} />

            {/* Filters + view toggle */}
            <div className="dd-controls">
              <FilterBar
                budgetFilter={budget}
                setBudgetFilter={setBudget}
                tagFilter={tags}
                setTagFilter={setTags}
                activeCount={activeFilterCount}
                showAll={showAll}
                setShowAll={setShowAll}
              />

              <div className="dd-view-toggle">
                <button
                  className={`dd-view-btn${view === "grid" ? " dd-view-btn--on" : ""}`}
                  onClick={() => setView("grid")}
                  title="Grid view"
                  data-ripple=""
                >
                  <IGrid />
                </button>

                <button
                  className={`dd-view-btn${view === "list" ? " dd-view-btn--on" : ""}`}
                  onClick={() => setView("list")}
                  title="List view"
                  data-ripple=""
                >
                  <IList />
                </button>
              </div>
            </div>

            {/* Project grid / list */}
            {loading ? (
              <div className="dd-loading">
                <div className="dd-spinner" />
                <span>Fetching projects…</span>
              </div>
            ) : filtered.length === 0 ? (
              <EmptyState
                hasFilters={!!(search || activeFilterCount)}
                onClear={clearFilters}
              />
            ) : (
              <div
                className={`dd-grid${view === "list" ? " dd-grid--list" : ""}`}
              >
                {filtered.map((p, i) => (
                  <ProjectCard key={p.id} project={p} idx={i} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
