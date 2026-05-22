import { useEffect, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { useAssignedProjects } from "../../hooks/useProjectQueries";
import ProjectPicker from "./components/ProjectPicker";
import MessagePanel from "./components/MessagePanel";

/* ── main component ──────────────────────────────── */
export default function DeveloperMessages({ initialProjectId }) {
  const { currentUser } = useAuth();
  const [selected, setSelected] = useState(null);

  /*
   * Reuse the shared assigned-projects query — no duplicate fetch.
   * DeveloperDashboard already fetches this; this component gets the
   * cached result for free.
   */
  const { data: projects = [], isLoading: loading } = useAssignedProjects(currentUser?.id);

  /* Auto-select on load / when initialProjectId changes */
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
            leaveOnUnmount={true}
            emptyStateText="No messages yet. Start the conversation with your client."
          />
        ) : (
          <div className="msg-chat msg-chat--empty">
            <div style={{ textAlign: "center", padding: "3rem" }}>
              <div style={{ fontSize: "2.5rem", marginBottom: "1rem" }}>💬</div>
              <p className="msg-empty">No active projects yet.</p>
              <p className="msg-empty" style={{ marginTop: "0.5rem", opacity: 0.6 }}>
                Once you're assigned to a project, you can message your client here.
              </p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
