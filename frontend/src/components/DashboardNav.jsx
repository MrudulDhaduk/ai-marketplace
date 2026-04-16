import "./DashboardNav.css";

const DashboardNav = () => {
  const user = JSON.parse(localStorage.getItem("user"));

  const handleLogout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    window.location.href = "/login";
  };

  return (
    <div className="dashboard-nav">

      {/* 🔍 Search */}
      <div className="dn-search">
        <input type="text" placeholder="Search projects..." />
      </div>

      {/* RIGHT SIDE */}
      <div className="dn-right">

        {/* 🔔 Notifications */}
        <button className="dn-icon">🔔</button>

        {/* 👤 Avatar */}
        <div className="dn-avatar">
          {user?.username?.[0]?.toUpperCase()}
        </div>

        {/* 🚪 Logout */}
        <button className="dn-logout" onClick={handleLogout}>
          Logout
        </button>

      </div>
    </div>
  );
};

export default DashboardNav;