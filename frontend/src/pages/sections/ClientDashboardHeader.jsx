function IconPlus() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <path
        d="M12 5v14M5 12h14"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default function ClientDashboardHeader({ user, onOpenCreateProject }) {
  const h = new Date().getHours();
  const greet = h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";

  return (
    <header className="dash-header">
      <div className="dash-header-left">
        <h1 className="dash-greeting">
          {greet}, <span className="dash-name">{user?.username || "there"}</span> 👋
        </h1>
        <p className="dash-sub">Your projects are live — here's what needs attention today.</p>
      </div>

      <button className="post-btn" data-ripple="" onClick={onOpenCreateProject}>
        <span className="post-btn-icon">
          <IconPlus />
        </span>
        Post New Project
        <span className="post-btn-shine" />
      </button>
    </header>
  );
}
