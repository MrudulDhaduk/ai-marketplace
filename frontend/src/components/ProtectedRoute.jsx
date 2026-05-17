import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

/**
 * ProtectedRoute
 * Redirects to /login if:
 *  - no token exists
 *  - token is expired (auto-logs out and redirects)
 *
 * Optionally pass `role` to restrict to a specific user role.
 */
const ProtectedRoute = ({ children, role }) => {
  const { isAuthenticated, currentUser, logout } = useAuth();

  if (!isAuthenticated) {
    // clearAuthSession already called by isAuthenticated check via isTokenExpired
    logout();
    return <Navigate to="/login" replace />;
  }

  if (role && currentUser?.role !== role) {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
};

export default ProtectedRoute;
