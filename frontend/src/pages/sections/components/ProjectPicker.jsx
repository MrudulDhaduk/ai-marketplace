/* ── ProjectPicker — shared sidebar project list ─────────── */
export default function ProjectPicker({ projects, selected, onSelect }) {
  return (
    <aside className="msg-sidebar">
      <div className="msg-sidebar-head">
        <span className="msg-sidebar-title">Projects</span>
      </div>
      {projects.length === 0 && (
        <p className="msg-sidebar-empty">No active projects yet.</p>
      )}
      <ul className="msg-project-list">
        {projects.map((p) => (
          <li
            key={p.id}
            className={`msg-project-item${selected?.id === p.id ? " msg-project-item--active" : ""}`}
            onClick={() => onSelect(p)}
          >
            <span className="msg-project-name">{p.title}</span>
            <span className={`msg-project-status msg-status--${p.status}`}>{p.status}</span>
          </li>
        ))}
      </ul>
    </aside>
  );
}
