/**
 * AuthContext.jsx — Authentication state management
 *
 * Phase 3 changes:
 *   - JWT is now in an httpOnly cookie. The frontend never holds the token.
 *   - On mount, /auth/me is called to rehydrate the session from the cookie.
 *   - login() stores only the user object (no token).
 *   - logout() calls POST /auth/logout to clear both server-side cookies
 *     (access token + refresh token).
 *   - CSRF token is fetched on mount and after login.
 *   - Silent token refresh is handled transparently in api.js — AuthContext
 *     only sees the auth:expired event when refresh also fails.
 */
import { createContext, useContext, useState, useCallback, useEffect } from "react";
import {
  getStoredUser,
  setAuthSession,
  clearAuthSession,
  apiRequest,
  fetchCsrfToken,
} from "../lib/api";
import { connectSocket, disconnectSocket } from "../socket";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(() => getStoredUser());
  const [loading, setLoading] = useState(true); // true while /auth/me is in-flight

  // On mount: fetch CSRF token, then rehydrate session from the httpOnly cookie
  useEffect(() => {
    let cancelled = false;

    async function rehydrate() {
      // Always fetch a fresh CSRF token first
      await fetchCsrfToken();

      // If we have a stored user, try to validate the cookie is still alive
      try {
        const res = await apiRequest("/auth/me");
        if (!cancelled) {
          if (res.ok) {
            const user = await res.json();
            setCurrentUser(user);
            setAuthSession({ user });
            connectSocket();
          } else {
            // Cookie expired or invalid — clear local state
            clearAuthSession();
            setCurrentUser(null);
          }
        }
      } catch {
        // Network error — keep whatever we have in sessionStorage
        if (!cancelled) setCurrentUser(getStoredUser());
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    rehydrate();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Listen for 401 events dispatched by apiRequest
  useEffect(() => {
    const handleExpired = () => {
      setCurrentUser(null);
      disconnectSocket();
    };
    window.addEventListener("auth:expired", handleExpired);
    return () => window.removeEventListener("auth:expired", handleExpired);
  }, []);

  const login = useCallback(async ({ user }) => {
    setAuthSession({ user });
    setCurrentUser(user);
    // Fetch a fresh CSRF token now that the auth cookie is set
    await fetchCsrfToken();
    connectSocket();
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiRequest("/auth/logout", { method: "POST" });
    } catch {
      // Best-effort — clear local state regardless
    }
    clearAuthSession();
    setCurrentUser(null);
    disconnectSocket();
  }, []);

  const isAuthenticated = Boolean(currentUser);

  const value = {
    currentUser,
    loading,
    login,
    logout,
    isAuthenticated,
    // Legacy shims — kept so existing components don't break
    token: null,
    isTokenExpired: () => false,
    apiRequest,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
