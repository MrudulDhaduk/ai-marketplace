import { useEffect } from "react";
import BidModal from "../../components/BidModal";
import EmptyState from "../../components/EmptyState";
import FilterBar from "../../components/FilterBar";
import ProjectCard from "../../components/ProjectCard";
import StatStrip from "../../components/StatStrip";

function IGrid() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <rect
        x="3"
        y="3"
        width="7"
        height="7"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <rect
        x="14"
        y="3"
        width="7"
        height="7"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <rect
        x="3"
        y="14"
        width="7"
        height="7"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <rect
        x="14"
        y="14"
        width="7"
        height="7"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  );
}

function IList() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <path
        d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default function ProjectFeed({
  projects,
  loading,
  search,
  setSearch,
  budget,
  setBudget,
  tags,
  setTags,
  showAll,
  setShowAll,
  view,
  setView,
  selectedProject,
  setSelectedProject,
  allTags,
  setFilteredCount,
}) {
  const filtered = projects.filter((p) => {
    if (p.status !== "open" && p.status !== "bidding") return false;

    const q = search.toLowerCase();
    if (
      q &&
      !p.title.toLowerCase().includes(q) &&
      !p.description?.toLowerCase().includes(q) &&
      !p.tags?.some((t) => t.toLowerCase().includes(q))
    )
      return false;

    if (budget === "low" && p.max_budget >= 25000) return false;
    if (budget === "mid" && (p.min_budget < 25000 || p.max_budget > 50000))
      return false;
    if (budget === "high" && p.min_budget <= 50000) return false;

    if (tags.length && !tags.some((t) => p.tags?.includes(t))) return false;

    return true;
  });

  useEffect(() => {
    if (setFilteredCount) setFilteredCount(filtered.length);
  }, [filtered.length, setFilteredCount]);

  const activeFilterCount = (budget !== "all" ? 1 : 0) + tags.length;
  const clearFilters = () => {
    setBudget("all");
    setTags([]);
    setSearch("");
  };

  return (
    
    <div className="dd-content">
      
      <StatStrip projects={projects} />

      <div className="dd-controls">
        <FilterBar
          budgetFilter={budget}
          setBudgetFilter={setBudget}
          tagFilter={tags}
          setTagFilter={setTags}
          activeCount={activeFilterCount}
          showAll={showAll}
          setShowAll={setShowAll}
          allTags={allTags}
        />

        <div className="dd-view-toggle">
          <button
            className={`dd-view-btn${view === "grid" ? " dd-view-btn--on" : ""}`}
            onClick={() => setView("grid")}
            title="Grid view"
            data-ripple=""
          >
            <IGrid />
          </button>

          <button
            className={`dd-view-btn${view === "list" ? " dd-view-btn--on" : ""}`}
            onClick={() => setView("list")}
            title="List view"
            data-ripple=""
          >
            <IList />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="dd-loading">
          <div className="dd-spinner" />
          <span>Fetching projects…</span>
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState hasFilters={!!(search || activeFilterCount)} onClear={clearFilters} />
      ) : (
        <div className={`dd-grid${view === "list" ? " dd-grid--list" : ""}`}>
          {filtered.map((p, i) => (
            <ProjectCard
              key={p.id}
              project={p}
              idx={i}
              setSelectedProject={setSelectedProject}
            />
          ))}
        </div>
      )}

      {selectedProject && (
        <BidModal project={selectedProject} onClose={() => setSelectedProject(null)} />
      )}
    </div>
  );
}
