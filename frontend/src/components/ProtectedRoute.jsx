import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

/**
 * ProtectedRoute
 *
 * Phase 3 change: AuthContext now validates the session via /auth/me on mount,
 * so there's a brief loading window. We render nothing (null) during that window
 * to avoid a flash-redirect to /login for users with valid cookies.
 */
const ProtectedRoute = ({ children, role }) => {
  const { isAuthenticated, loading, currentUser } = useAuth();

  // Still rehydrating session from cookie — don't redirect yet
  if (loading) return null;

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (role && currentUser?.role !== role) {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
};

export default ProtectedRoute;
