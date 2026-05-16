import { useEffect, useRef, useState } from "react";
import "./ClientDashboard.css";
import CreateProjectModal from "../../components/CreateProjectModal";
import TopBar from "../../components/TopBar";
import ProjectBidsModal from "../../components/ProjectBidsModal";
import Background from "../../components/Background";
import ClientSidebar from "../../components/ClientSidebar";
import { useMousePos, useRipple } from "../hooks";
import ClientOverview from "../sections/ClientOverview";
import ClientProjectsPanel from "../sections/ClientProjectsPanel";
import ClientMessages from "../sections/ClientMessages";
import ClientPayments from "../sections/ClientPayments";
import ClientProjectWorkspace from "../sections/ClientProjectWorkspace";
import { apiRequest } from "../../api";

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
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [section, setSection] = useState("overview");
  const mousePos = useMousePos();
  const shellRef = useRef(null);

  const [selectedProject, setSelectedProject] = useState(null);
  const [activeProject, setActiveProject] = useState(null);

  useRipple(shellRef, "ripple-wave");

  const handleNewProject = (project) => {
    setProjects((prev) => [formatProjectForCard(project), ...prev]);
  };

  useEffect(() => {
    const controller = new AbortController();

    const fetchProjects = async () => {
      try {
        const response = await apiRequest("/api/projects", {
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`Failed to fetch projects: ${response.status}`);
        }

        const data = await response.json();
        // Support both paginated { data: [] } and legacy flat array responses
        const rows = Array.isArray(data) ? data : (data.data ?? []);
        setProjects(rows.map((project) => formatProjectForCard(project)));
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

  return (
    <div className="client-theme">
      <div>
        <div className="client-theme">
          <TopBar />
        </div>
        <div
          ref={shellRef}
          className={`db-shell${light ? " db-shell--light" : ""}`}
        >
          <Background
            variant="client"
            light={light}
            mousePos={mousePos}
            tabTone={tabTone}
          />
          <ClientSidebar
            user={user}
            section={section}
            onSectionChange={setSection}
          />
          <div className="db-main">
            {section === "overview" && (
              <ClientOverview
                user={user}
                projects={projects}
                onOpenCreateProject={() => setShowCreateModal(true)}
                onTabChange={setTabTone}
                onViewProject={setSelectedProject}
              />
            )}
            {section === "projects" && (
              <>
                {!activeProject && (
                  <ClientProjectsPanel
                    projects={projects}
                    onTabChange={setTabTone}
                    onViewProject={setActiveProject}
                  />
                )}
                {activeProject && (
                  <ClientProjectWorkspace
                    project={activeProject}
                    onBack={() => setActiveProject(null)}
                  />
                )}
              </>
            )}
            {section === "messages" && <ClientMessages />}
            {section === "payments" && <ClientPayments />}
          </div>
          {showCreateModal && (
            <CreateProjectModal
              onClose={() => setShowCreateModal(false)}
              onCreate={(project) => {
                handleNewProject(project);
                setShowCreateModal(false);
              }}
            />
          )}
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
    </div>
  );
}
