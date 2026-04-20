import { useEffect, useRef, useState } from "react";
import "./DeveloperDashboard.css";
import TopBar from "../../components/TopBar";
import DevSidebar from "../../components/DevSideBar";
import Background from "../../components/Background";
import ProjectFeed from "../sections/ProjectFeed";
import ActiveBids from "../sections/ActiveBids";
import MyProjects from "../sections/MyProjects";
import ProjectWorkspace from "../sections/ProjectWorkspace";
import { useMousePos, useRipple } from "../hooks";

const DUMMY_PROJECTS = [
  {
    id: 1,
    title: "AI-Powered Resume Screener",
    description:
      "Build an NLP pipeline that scores resumes against job descriptions using semantic similarity. Must integrate with our existing HR system via REST API.",
    min_budget: 25000,
    max_budget: 45000,
    due_date: "2025-05-18",
    status: "open",
    tags: ["Python", "NLP", "FastAPI", "OpenAI"],
  },
  {
    id: 2,
    title: "Real-time Fraud Detection Dashboard",
    description:
      "Design and implement a streaming analytics dashboard that visualises transaction anomaly scores. WebSocket updates required.",
    min_budget: 40000,
    max_budget: 70000,
    due_date: "2025-06-02",
    status: "open",
    tags: ["React", "WebSocket", "Kafka", "Python"],
  },
  {
    id: 3,
    title: "LLM-based Legal Document Summariser",
    description:
      "Integrate Claude / GPT-4 to auto-summarise long legal documents with key clause extraction. Accuracy benchmarks required.",
    min_budget: 15000,
    max_budget: 30000,
    due_date: "2025-05-28",
    status: "open",
    tags: ["LangChain", "Claude", "Next.js", "Postgres"],
  },
  {
    id: 4,
    title: "Computer Vision for Retail Shelf Monitoring",
    description:
      "Train a YOLO v8 model to detect out-of-stock items from CCTV feeds. Cloud deployment on GCP with real-time alerting.",
    min_budget: 55000,
    max_budget: 90000,
    due_date: "2025-06-15",
    status: "open",
    tags: ["PyTorch", "YOLO", "GCP", "OpenCV"],
  },
  {
    id: 5,
    title: "Voice-to-CRM Data Entry Bot",
    description:
      "Whisper-based transcription tool that parses sales calls and auto-fills CRM fields. Salesforce integration required.",
    min_budget: 20000,
    max_budget: 38000,
    due_date: "2025-05-22",
    status: "bidding",
    tags: ["Whisper", "Salesforce", "Node.js", "AWS"],
  },
  {
    id: 6,
    title: "Personalised Learning Path Generator",
    description:
      "Build a recommendation engine that creates adaptive learning paths from user quiz performance. EdTech SaaS context.",
    min_budget: 18000,
    max_budget: 32000,
    due_date: "2025-06-08",
    status: "open",
    tags: ["Python", "Recommendation", "React", "Supabase"],
  },
];

const ALL_TAGS = [...new Set(DUMMY_PROJECTS.flatMap((p) => p.tags))].sort();

export default function DeveloperDashboard() {
  const user = (() => {
    try {
      return JSON.parse(localStorage.getItem("user"));
    } catch {
      return null;
    }
  })();

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
  // Tracks the project currently opened in the in-dashboard workspace.
  const [activeProject, setActiveProject] = useState(null);
  const mousePos = useMousePos();
  const shellRef = useRef(null);

  useRipple(shellRef);
  // projects feed fetch
  useEffect(() => {
    const fetchProjects = async () => {
      setLoading(true);
      const sessionUser = JSON.parse(localStorage.getItem("user"));
      const url = `http://localhost:5000/projects/discover/${sessionUser.id}?all=${showAll}`;
      console.log("Fetching projects from:", url);
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error("fetch failed");
        const data = await res.json();
        console.log("Projects fetched:", data);
        setProjects(data || []);
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
    const fetchAssigned = async () => {
      try {
        const sessionUser = JSON.parse(localStorage.getItem("user"));

        const res = await fetch(
          `http://localhost:5000/projects/assigned/${sessionUser.id}`,
        );

        if (!res.ok) throw new Error("fetch failed");

        const data = await res.json();
        if (Array.isArray(data)) {
          setAssignedProjects(data);
        } else {
          console.error("Invalid assignedProjects response:", data);
          setAssignedProjects([]);
        }
      } catch (err) {
        console.error(err);
        setAssignedProjects([]);
      }
    };

    fetchAssigned();
  }, []);

  // my bids fetch (developer-specific)
  useEffect(() => {
    const fetchBids = async () => {
      try {
        const user = JSON.parse(localStorage.getItem("user"));

        const res = await fetch(
          `http://localhost:5000/bids/developer/${user.id}`,
        );

        const data = await res.json();

        if (Array.isArray(data)) {
          setMyBids(data);
        } else {
          setMyBids([]);
        }
      } catch (err) {
        console.error(err);
        setMyBids([]);
      }
    };

    fetchBids();
  }, []);

  return (
    <div ref={shellRef} className="dd-shell">
      <Background mousePos={mousePos} />

      <TopBar
        search={search}
        onSearch={setSearch}
        total={projects.length}
        filtered={filteredCount}
      />

      <div className="dd-body">
        <DevSidebar
          user={user}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
        />

        <div className="dd-main">
          {activeProject ? (
            <ProjectWorkspace
              project={activeProject}
              onBack={() => setActiveProject(null)}
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
                  allTags={ALL_TAGS}
                  setFilteredCount={setFilteredCount}
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
            </>
          )}
        </div>
      </div>
    </div>
  );
}
