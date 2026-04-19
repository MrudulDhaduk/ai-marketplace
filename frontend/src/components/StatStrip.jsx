export default function StatStrip({ projects }) {
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
