import { useRef, useState, useCallback } from "react";
import "./DeveloperDashboard.css";
import TopBar from "../../components/TopBar";
import DevSidebar from "../../components/DevSideBar";
import Background from "../../components/Background";
import ProjectFeed from "../sections/ProjectFeed";
import ActiveBids from "../sections/ActiveBids";
import MyProjects from "../sections/MyProjects";
import ProjectWorkspace from "../sections/DeveloperProjectWorkspace";
import DeveloperMessages from "../sections/DeveloperMessages";
import DeveloperRatings from "../sections/DeveloperRatings";
import DeveloperSettings from "../sections/DeveloperSettings";
import { useMousePos, useRipple } from "../hooks";
import React from "react";
import { useAuth } from "../../context/AuthContext";
import {
  useProjectFeed,
  useAssignedProjects,
  useDeveloperBids,
} from "../../hooks/useProjectQueries";
import { queryClient } from "../../lib/queryClient";
import { queryKeys } from "../../lib/queryKeys";
import ErrorBoundary from "../../components/ErrorBoundary";
import "../../components/ErrorBoundary.css";


const MemoBackground = React.memo(Background);

export default function DeveloperDashboard() {
  const { currentUser: user } = useAuth();

  const [search, setSearch] = useState("");
  const [budget, setBudget] = useState("all");
  const [tags, setTags] = useState([]);
  const [activeTab, setActiveTab] = useState("feed");
  const [view, setView] = useState("grid");
  const [showAll, setShowAll] = useState(false);
  const [selectedProject, setSelectedProject] = useState(null);
  const [filteredCount, setFilteredCount] = useState(0);
  const [bidsView, setBidsView] = useState("list");
  const [activeProject, setActiveProject] = useState(null);
  const [messageProjectId, setMessageProjectId] = useState(null);
  const mousePos = useMousePos();
  const shellRef = useRef(null);

  // Replace 3 manual useEffect fetches with TanStack Query hooks
  const { data: projects = [], isLoading: loading } = useProjectFeed(user?.id, showAll);
  const { data: assignedProjects = [] } = useAssignedProjects(user?.id);
  const { data: myBids = [] } = useDeveloperBids(user?.id);

  const allTags = [...new Set(projects.flatMap((p) => Array.isArray(p.tags) ? p.tags : []))].sort();

  useRipple(shellRef);

  const handleOpenMessages = (projectId) => {
    setMessageProjectId(projectId || null);
    setActiveProject(null);
    setActiveTab("messages");
  };

  const handleWorkspaceProjectUpdated = useCallback((updatedProject) => {
    // Invalidate assigned projects so MyProjects + workspace reflect the change
    queryClient.invalidateQueries({ queryKey: queryKeys.developer.assigned(user?.id) });
    queryClient.invalidateQueries({ queryKey: queryKeys.projects.detail(updatedProject.id) });
    // Keep activeProject in sync locally
    setActiveProject((prev) =>
      prev && prev.id === updatedProject.id ? { ...prev, ...updatedProject } : prev,
    );
  }, [user?.id]);

  const handleBidPlaced = (newBid) => {
    // Invalidate bids cache so ActiveBids updates without manual refresh
    queryClient.invalidateQueries({ queryKey: queryKeys.developer.bids(user?.id) });
  };

  return (
    <div className="developer-theme">
      <TopBar
        search={search}
        onSearch={setSearch}
        total={projects.length}
        filtered={filteredCount}
      />
      <div ref={shellRef} className="dd-shell">
        <MemoBackground mousePos={mousePos} />

        <div className="dd-body">
          <DevSidebar
            user={user}
            activeTab={activeTab}
            setActiveTab={(tab) => {
              // Clear message deep-link when switching tabs manually
              if (tab !== "messages") setMessageProjectId(null);
              setActiveTab(tab);
            }}
          />

          <div className="dd-main">
            {activeProject ? (
              <ErrorBoundary label="Developer Workspace">
                <ProjectWorkspace
                  project={activeProject}
                  onBack={() => setActiveProject(null)}
                  onOpenMessages={handleOpenMessages}
                  onComplete={handleWorkspaceProjectUpdated}
                  onProjectUpdated={handleWorkspaceProjectUpdated}
                />
              </ErrorBoundary>
            ) : (
              <>
                {activeTab === "feed" && (
                  <ErrorBoundary label="Project Feed">
                    <ProjectFeed
                      projects={projects}
                      loading={loading}
                      search={search}
                      setSearch={setSearch}
                      budget={budget}
                      setBudget={setBudget}
                      tags={tags}
                      setTags={setTags}
                      showAll={showAll}
                      setShowAll={setShowAll}
                      view={view}
                      setView={setView}
                      selectedProject={selectedProject}
                      setSelectedProject={setSelectedProject}
                      allTags={allTags}
                      setFilteredCount={setFilteredCount}
                      onBidPlaced={handleBidPlaced}
                    />
                  </ErrorBoundary>
                )}
                {activeTab === "active" && (
                  <ErrorBoundary label="Active Bids">
                    <ActiveBids
                      bids={myBids}
                      view={bidsView}
                      setView={setBidsView}
                    />
                  </ErrorBoundary>
                )}
                {activeTab === "my-projects" && (
                  <ErrorBoundary label="My Projects">
                    <MyProjects
                      assignedProjects={assignedProjects}
                      onOpenProject={setActiveProject}
                    />
                  </ErrorBoundary>
                )}
                {activeTab === "messages" && (
                  <ErrorBoundary label="Messages">
                    <DeveloperMessages initialProjectId={messageProjectId} />
                  </ErrorBoundary>
                )}
                {activeTab === "ratings" && (
                  <ErrorBoundary label="Ratings">
                    <DeveloperRatings />
                  </ErrorBoundary>
                )}
                {activeTab === "settings" && (
                  <ErrorBoundary label="Settings">
                    <DeveloperSettings />
                  </ErrorBoundary>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
