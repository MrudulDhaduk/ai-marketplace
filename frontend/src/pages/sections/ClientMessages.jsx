import { useEffect, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { useClientProjects } from "../../hooks/useProjectQueries";
import ProjectPicker from "./components/ProjectPicker";
import MessagePanel from "./components/MessagePanel";

/* ── main component ──────────────────────────────── */
export default function ClientMessages({ initialProjectId }) {
  const { currentUser } = useAuth();
  const [selected, setSelected] = useState(null);

  // Reuse the shared projects query — no duplicate fetch
  const { data: rawProjects = [], isLoading: loading } = useClientProjects();
  // Only show projects that have an assigned developer (can message)
  const projects = rawProjects.filter((p) => p.assigned_developer_id);

  // Auto-select on load / when initialProjectId changes
  useEffect(() => {
    if (projects.length === 0) return;
    if (initialProjectId) {
      const target = projects.find((p) => p.id === initialProjectId);
      setSelected(target || projects[0] || null);
    } else if (!selected) {
      setSelected(projects[0]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects.length, initialProjectId]);

  if (loading) {
    return (
      <section className="pp">
        <div className="pp-head"><h2 className="pp-title">Messages</h2></div>
        <div className="pp-grid"><div className="pp-empty">Loading…</div></div>
      </section>
    );
  }

  return (
    <section className="pp msg-section">
      <div className="pp-head"><h2 className="pp-title">Messages</h2></div>
      <div className="msg-layout">
        <ProjectPicker projects={projects} selected={selected} onSelect={setSelected} />
        {selected ? (
          <MessagePanel
            project={selected}
            currentUser={currentUser}
            leaveOnUnmount={false}
            emptyStateText="No messages yet. Start the conversation."
          />
        ) : (
          <div className="msg-chat msg-chat--empty">
            <p className="msg-empty">Select a project to start messaging.</p>
          </div>
        )}
      </div>
    </section>
  );
}
