const rawApiUrl = process.env.REACT_APP_API_URL || window.location.origin;

export const API_BASE_URL = rawApiUrl.replace(/\/$/, "");

export function getToken() {
  return localStorage.getItem("token");
}

export function getStoredUser() {
  try {
    const raw = localStorage.getItem("user");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setAuthSession({ token, user }) {
  if (token) localStorage.setItem("token", token);
  if (user) localStorage.setItem("user", JSON.stringify(user));
}

export function clearAuthSession() {
  localStorage.removeItem("token");
  localStorage.removeItem("user");
}

export function isTokenExpired(token = getToken()) {
  if (!token) return true;
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    return payload.exp ? payload.exp * 1000 <= Date.now() : false;
  } catch {
    return true;
  }
}

export async function apiRequest(path, options = {}) {
  const token = getToken();
  const headers = { ...(options.headers || {}) };

  if (!(options.body instanceof FormData)) {
    headers["Content-Type"] = headers["Content-Type"] || "application/json";
  }
  if (token && !isTokenExpired(token)) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });

  // ARCH-7 fix: on 401, clear the stored session AND dispatch a custom event
  // so AuthContext can react and update its React state (token, currentUser).
  // Without this, the context still shows the user as authenticated even though
  // all subsequent API calls will fail silently.
  if (response.status === 401) {
    clearAuthSession();
    window.dispatchEvent(new Event("auth:expired"));
  }

  return response;
}
