import { useRef, useState } from "react";
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
import { useAuth } from "../../context/AuthContext";
import { useClientProjects } from "../../hooks/useProjectQueries";
import { queryClient } from "../../lib/queryClient";
import { queryKeys } from "../../lib/queryKeys";
import ErrorBoundary from "../../components/ErrorBoundary";
import "../../components/ErrorBoundary.css";

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
  const { currentUser: user } = useAuth();

  const [tabTone, setTabTone] = useState("all");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [section, setSection] = useState("overview");
  const mousePos = useMousePos();
  const shellRef = useRef(null);

  const [selectedProject, setSelectedProject] = useState(null);
  const [activeProject, setActiveProject] = useState(null);
  const [messageProjectId, setMessageProjectId] = useState(null);

  useRipple(shellRef, "ripple-wave");

  // Replace manual fetch with TanStack Query
  const { data: rawProjects = [] } = useClientProjects();
  const projects = rawProjects.map(formatProjectForCard);

  const handleNewProject = (project) => {
    // Invalidate the projects list so TanStack Query refetches with the new project
    queryClient.invalidateQueries({ queryKey: queryKeys.projects.list() });
  };

  const handleNavigateToMessages = (projectId) => {
    setMessageProjectId(projectId || null);
    setActiveProject(null);
    setSection("messages");
  };

  const handleProjectUpdated = (updatedProject) => {
    // Invalidate the specific project detail so all components see the update
    queryClient.invalidateQueries({ queryKey: queryKeys.projects.detail(updatedProject.id) });
    queryClient.invalidateQueries({ queryKey: queryKeys.projects.list() });
    // Keep activeProject in sync locally
    setActiveProject((prev) =>
      prev && prev.id === updatedProject.id ? { ...prev, ...updatedProject } : prev,
    );
  };

  return (
    <div className="client-theme">
      <div>
        <div className="client-theme">
          <TopBar />
        </div>
        <div
          ref={shellRef}
          className={`db-shell`}
        >
          <Background
            variant="client"
            light={false}
            mousePos={mousePos}
            tabTone={tabTone}
          />
          <ClientSidebar
            user={user}
            section={section}
            onSectionChange={(s) => {
              // Clear message deep-link when switching sections manually
              if (s !== "messages") setMessageProjectId(null);
              setSection(s);
            }}
          />
          <div className="db-main">
            {section === "overview" && (
              <ErrorBoundary label="Overview">
                <ClientOverview
                  user={user}
                  projects={projects}
                  onOpenCreateProject={() => setShowCreateModal(true)}
                  onTabChange={setTabTone}
                  onViewProject={setSelectedProject}
                />
              </ErrorBoundary>
            )}
            {section === "projects" && (
              <ErrorBoundary label="Projects">
                <>
                  {!activeProject && (
                    <ClientProjectsPanel
                      projects={projects}
                      onTabChange={setTabTone}
                      onViewProject={setActiveProject}
                    />
                  )}
                  {activeProject && (
                    <ErrorBoundary label="Project Workspace">
                      <ClientProjectWorkspace
                        project={activeProject}
                        onBack={() => setActiveProject(null)}
                        onNavigateToMessages={handleNavigateToMessages}
                        onProjectUpdated={handleProjectUpdated}
                      />
                    </ErrorBoundary>
                  )}
                </>
              </ErrorBoundary>
            )}
            {section === "messages" && (
              <ErrorBoundary label="Messages">
                <ClientMessages initialProjectId={messageProjectId} />
              </ErrorBoundary>
            )}
            {section === "payments" && (
              <ErrorBoundary label="Payments">
                <ClientPayments />
              </ErrorBoundary>
            )}
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
