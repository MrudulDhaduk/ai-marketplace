import { useEffect, useRef, useState } from "react";
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
import { apiRequest } from "../../lib/api";
import { useAuth } from "../../context/AuthContext";


const MemoBackground = React.memo(Background);

export default function DeveloperDashboard() {
  const { currentUser: user } = useAuth();

  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [budget, setBudget] = useState("all");
  const [tags, setTags] = useState([]);
  const [activeTab, setActiveTab] = useState("feed");
  const [view, setView] = useState("grid");
  const [showAll, setShowAll] = useState(false);
  const [selectedProject, setSelectedProject] = useState(null);
  const [filteredCount, setFilteredCount] = useState(0);
  const [assignedProjects, setAssignedProjects] = useState([]);
  const [myBids, setMyBids] = useState([]);
  const [bidsView, setBidsView] = useState("list");
  const [activeProject, setActiveProject] = useState(null);
  // For "Message Developer" deep-link from workspace
  const [messageProjectId, setMessageProjectId] = useState(null);
  const mousePos = useMousePos();
  const shellRef = useRef(null);

  const allTags = [...new Set(projects.flatMap((p) => Array.isArray(p.tags) ? p.tags : []))].sort();

  useRipple(shellRef);

  // projects feed fetch
  useEffect(() => {
    if (!user?.id) return;
    const fetchProjects = async () => {
      setLoading(true);
      try {
        const res = await apiRequest(`/projects/discover/${user.id}?all=${showAll}`);
        if (!res.ok) throw new Error("fetch failed");
        const data = await res.json();
        const rows = Array.isArray(data) ? data : (data.data ?? []);
        setProjects(rows);
      } catch {
        setProjects([]);
      } finally {
        setLoading(false);
      }
    };
    fetchProjects();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAll]);

  // assigned projects fetch
  useEffect(() => {
    if (!user?.id) return;
    const fetchAssigned = async () => {
      try {
        const res = await apiRequest(`/projects/assigned/${user.id}`);
        if (!res.ok) throw new Error("fetch failed");
        const data = await res.json();
        const rows = Array.isArray(data) ? data : (data.data ?? []);
        setAssignedProjects(rows);
      } catch {
        setAssignedProjects([]);
      }
    };
    fetchAssigned();
  }, []);

  // my bids fetch
  useEffect(() => {
    if (!user?.id) return;
    const fetchBids = async () => {
      try {
        const res = await apiRequest(`/bids/developer/${user.id}`);
        const data = await res.json();
        const rows = Array.isArray(data) ? data : (data.data ?? []);
        setMyBids(rows);
      } catch {
        setMyBids([]);
      }
    };
    fetchBids();
  }, []);

  // Navigate to messages tab for a specific project (called from workspace)
  const handleOpenMessages = (projectId) => {
    setMessageProjectId(projectId || null);
    setActiveProject(null);
    setActiveTab("messages");
  };

  // Called by BidModal on successful bid — immediately prepends the new bid
  // to myBids so "Active Bids" updates without a manual refresh
  const handleBidPlaced = (newBid) => {
    setMyBids((prev) => [newBid, ...prev]);
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
              <ProjectWorkspace
                project={activeProject}
                onBack={() => setActiveProject(null)}
                onOpenMessages={handleOpenMessages}
                onComplete={(updatedProject) => {
                  setAssignedProjects((prev) =>
                    prev.map((p) =>
                      p.id === updatedProject.id ? updatedProject : p,
                    ),
                  );
                }}
              />
            ) : (
              <>
                {activeTab === "feed" && (
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
                )}
                {activeTab === "active" && (
                  <ActiveBids
                    bids={myBids}
                    view={bidsView}
                    setView={setBidsView}
                  />
                )}
                {activeTab === "my-projects" && (
                  <MyProjects
                    assignedProjects={assignedProjects}
                    onOpenProject={setActiveProject}
                  />
                )}
                {activeTab === "messages" && (
                  <DeveloperMessages initialProjectId={messageProjectId} />
                )}
                {activeTab === "ratings" && (
                  <DeveloperRatings />
                )}
                {activeTab === "settings" && (
                  <DeveloperSettings />
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
