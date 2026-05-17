import { useEffect, useRef, useState } from "react";
import { apiRequest } from "../../lib/api";

/* ── animated count-up ─────────────────────────── */
function useCountUp(target, ms = 1200, delay = 0) {
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

function StatCard({ label, value, prefix = "", accent, idx }) {
  const count = useCountUp(value, 1200, idx * 100);
  return (
    <div
      className={`stat-card sc-${accent}`}
      style={{ "--si": idx }}
    >
      <div className="sc-body">
        <span className="sc-value">{prefix}{count.toLocaleString()}</span>
        <span className="sc-label">{label}</span>
      </div>
      <div className="sc-glow" />
      <div className="sc-border-line" />
    </div>
  );
}

const STAT_DEFS = [
  { id: "activeProjects",    label: "Active",     prefix: "",  accent: "orange" },
  { id: "totalBids",         label: "Total Bids", prefix: "",  accent: "gold"   },
  { id: "totalEarned",       label: "Earned",     prefix: "₹", accent: "lime"   },
  { id: "completedProjects", label: "Completed",  prefix: "",  accent: "teal"   },
];

export default function DeveloperStatsRow() {
  const [stats, setStats] = useState({
    activeProjects: 0,
    totalBids: 0,
    totalEarned: 0,
    completedProjects: 0,
  });

  useEffect(() => {
    apiRequest("/api/stats/developer")
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (data) setStats(data); })
      .catch(() => {});
  }, []);

  return (
    <div className="stats-row">
      {STAT_DEFS.map((def, idx) => (
        <StatCard
          key={def.id}
          label={def.label}
          value={stats[def.id] ?? 0}
          prefix={def.prefix}
          accent={def.accent}
          idx={idx}
        />
      ))}
    </div>
  );
}
