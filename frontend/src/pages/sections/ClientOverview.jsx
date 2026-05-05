import ClientDashboardHeader from "./ClientDashboardHeader";
import ClientStatsRow from "./ClientStatsRow";
import ClientProjectsPanel from "./ClientProjectsPanel";
import ClientActivityFeed from "./ClientActivityFeed";

export default function ClientOverview({
  user,
  projects,
  onOpenCreateProject,
  onTabChange,
  onViewProject,
}) {
  return (
    <>
      <ClientDashboardHeader
        user={user}
        onOpenCreateProject={onOpenCreateProject}
      />
      <ClientStatsRow />
      <div className="db-body">
        <ClientProjectsPanel
          projects={projects}
          onTabChange={onTabChange}
          onViewProject={onViewProject}
        />
        <ClientActivityFeed />
      </div>
    </>
  );
}
