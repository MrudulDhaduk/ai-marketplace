const API_BASE_URL = (process.env.REACT_APP_API_URL || "").replace(/\/$/, "");

export function getToken() {
  return localStorage.getItem("token");
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
  if (!(options.body instanceof FormData)) headers["Content-Type"] = headers["Content-Type"] || "application/json";
  if (token && !isTokenExpired(token)) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });
  if (response.status === 401) localStorage.removeItem("token");
  return response;
}

export { API_BASE_URL };
