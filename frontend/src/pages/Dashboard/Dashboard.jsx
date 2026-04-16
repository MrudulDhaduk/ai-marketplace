import ClientDashboard from "./ClientDashboard";
import DeveloperDashboard from "./DeveloperDashboard";
import { Navigate } from "react-router-dom";

const Dashboard = () => {
  const userData = localStorage.getItem("user");

  if (!userData || userData === "undefined") {
    return <Navigate to="/login" />;
  }

  let user;

  try {
    const parsed = JSON.parse(userData);
    user = parsed.user || parsed; // ✅ FIX
  } catch (err) {
    return <Navigate to="/login" />;
  }

  const role = user.role?.toLowerCase();

  if (role === "client") {
    return <ClientDashboard user={user} />;
  }

  if (role === "developer") {
    return <DeveloperDashboard user={user} />;
  }

  return <Navigate to="/login" />;
};

export default Dashboard;