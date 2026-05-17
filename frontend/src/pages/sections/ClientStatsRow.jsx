import { useEffect, useRef, useState } from "react";
import { useTilt } from "../hooks";
import { apiRequest } from "../../lib/api";

/* ── animated count-up ─────────────────────────── */
function useCountUp(target, ms = 1300, delay = 0) {
  const [n, setN] = useState(0);
  useEffect(() => {
    setN(0);
    const tid = setTimeout(() => {
      const t0 = performance.now();
      const tick = (now) => {
        const p = Math.min((now - t0) / ms, 1);
        setN(Math.round((1 - (1 - p) ** 4) * target));
        if (p < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }, delay);
    return () => clearTimeout(tid);
  }, [target, ms, delay]);
  return n;
}

/* ── single stat card ──────────────────────────── */
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
          {stat.prefix}{count.toLocaleString()}
        </span>
        <span className="sc-label">{stat.label}</span>
      </div>
      <div className="sc-glow" />
      <div className="sc-border-line" />
    </div>
  );
}

/* ── stat definitions (values filled from API) ─── */
const STAT_DEFS = [
  { id: "activeProjects",   label: "Active",    prefix: "",  accent: "orange", Icon: IconFlame  },
  { id: "totalBids",        label: "Total Bids", prefix: "", accent: "gold",   Icon: IconBids   },
  { id: "totalSpend",       label: "Deployed",  prefix: "$", accent: "lime",   Icon: IconDeploy },
  { id: "completedProjects",label: "Completed", prefix: "",  accent: "teal",   Icon: IconShield },
];

export default function ClientStatsRow() {
  const [stats, setStats] = useState({
    activeProjects: 0,
    totalBids: 0,
    totalSpend: 0,
    completedProjects: 0,
  });

  useEffect(() => {
    apiRequest("/api/stats/client")
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (data) setStats(data); })
      .catch(() => {});
  }, []);

  const statCards = STAT_DEFS.map((def) => ({
    ...def,
    value: stats[def.id] ?? 0,
  }));

  return (
    <div className="stats-row">
      {statCards.map((stat, idx) => (
        <StatCard key={stat.id} stat={stat} idx={idx} />
      ))}
    </div>
  );
}

/* ── icons ─────────────────────────────────────── */
function IconFlame() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M12 2c0 5-6 7-6 12a6 6 0 0 0 12 0c0-5-6-7-6-12z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M12 12c0 2-2 3-2 5a2 2 0 0 0 4 0c0-2-2-3-2-5z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}
function IconBids() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M3 17l4-8 4 5 3-3 4 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function IconDeploy() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" />
      <path d="M12 8v4l3 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
function IconShield() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M12 3L4 7v5c0 4.4 3.4 8.5 8 9.5 4.6-1 8-5.1 8-9.5V7l-8-4z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M9 12l2 2 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
