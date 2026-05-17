import { createContext, useContext, useState, useCallback, useEffect } from "react";
import {
  getToken,
  getStoredUser,
  setAuthSession,
  clearAuthSession,
  isTokenExpired,
  apiRequest,
} from "../lib/api";
import { connectSocket, disconnectSocket } from "../socket";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => {
    const t = getToken();
    return t && !isTokenExpired(t) ? t : null;
  });
  const [currentUser, setCurrentUser] = useState(() => {
    const t = getToken();
    if (!t || isTokenExpired(t)) return null;
    return getStoredUser();
  });

  // Silently clear expired sessions on mount
  useEffect(() => {
    const t = getToken();
    if (t && isTokenExpired(t)) {
      clearAuthSession();
      setToken(null);
      setCurrentUser(null);
    } else if (t && !isTokenExpired(t)) {
      // Reconnect socket for persisted sessions (page refresh)
      connectSocket();
    }
  }, []);

  const login = useCallback(({ token: newToken, user }) => {
    setAuthSession({ token: newToken, user });
    setToken(newToken);
    setCurrentUser(user);
    connectSocket();
  }, []);

  const logout = useCallback(() => {
    clearAuthSession();
    setToken(null);
    setCurrentUser(null);
    disconnectSocket();
  }, []);

  const isAuthenticated = Boolean(token && !isTokenExpired(token));

  const value = {
    currentUser,
    token,
    login,
    logout,
    isAuthenticated,
    isTokenExpired,
    apiRequest,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
