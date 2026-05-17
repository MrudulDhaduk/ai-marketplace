import { Navigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import ClientDashboard from "./ClientDashboard";
import DeveloperDashboard from "./DeveloperDashboard";

const Dashboard = () => {
  const { currentUser, isAuthenticated } = useAuth();

  if (!isAuthenticated || !currentUser) {
    return <Navigate to="/login" replace />;
  }

  const role = currentUser.role?.toLowerCase();

  if (role === "client") return <ClientDashboard />;
  if (role === "developer") return <DeveloperDashboard />;

  return <Navigate to="/login" replace />;
};

export default Dashboard;
