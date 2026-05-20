/**
 * api.js — HTTP client for the NeuralForge API
 *
 * Phase 3 security changes:
 *   - JWT is now stored in an httpOnly cookie set by the server.
 *     The frontend never reads or stores the token value.
 *   - All state-changing requests include the x-csrf-token header.
 *   - The user object is stored in sessionStorage (cleared on tab close)
 *     instead of localStorage. It contains no secrets — only display data
 *     (id, username, email, role). The source of truth is the server cookie.
 *   - On 401, a silent token refresh is attempted via POST /auth/refresh.
 *     If the refresh succeeds the original request is retried once.
 *     If the refresh fails the auth:expired event is dispatched.
 *
 * MIGRATION NOTE:
 *   Existing users with tokens in localStorage will be silently migrated on
 *   their next page load — clearAuthSession() removes the old keys, and the
 *   next login will set the httpOnly cookie instead.
 */

const rawApiUrl = process.env.REACT_APP_API_URL || window.location.origin;
export const API_BASE_URL = rawApiUrl.replace(/\/$/, "");

// ── CSRF token management ─────────────────────────────────────────────────────
let _csrfToken = null;

function getCsrfCookieValue() {
  const match = document.cookie.match(/(?:^|;\s*)x-csrf-token=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

export async function fetchCsrfToken() {
  try {
    const res = await fetch(`${API_BASE_URL}/auth/csrf-token`, {
      credentials: "include",
    });
    if (res.ok) {
      const data = await res.json();
      _csrfToken = data.csrfToken;
    }
  } catch {
    // Non-fatal
  }
}

function getCsrfToken() {
  return _csrfToken || getCsrfCookieValue();
}

// ── User session (display data only — no secrets) ─────────────────────────────
export function getStoredUser() {
  try {
    const legacy = localStorage.getItem("user");
    if (legacy) {
      sessionStorage.setItem("user", legacy);
      localStorage.removeItem("user");
      localStorage.removeItem("token");
    }
    const raw = sessionStorage.getItem("user");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setStoredUser(user) {
  if (user) sessionStorage.setItem("user", JSON.stringify(user));
}

export function clearAuthSession() {
  sessionStorage.removeItem("user");
  localStorage.removeItem("token");
  localStorage.removeItem("user");
  _csrfToken = null;
}

// ── Legacy compatibility shims ────────────────────────────────────────────────
export function getToken() { return null; }
export function isTokenExpired() { return false; }
export function setAuthSession({ user }) { if (user) setStoredUser(user); }

// ── Silent token refresh ──────────────────────────────────────────────────────
// Tracks whether a refresh is already in-flight to prevent concurrent retries.
let _refreshPromise = null;

async function attemptSilentRefresh() {
  if (_refreshPromise) return _refreshPromise;

  _refreshPromise = fetch(`${API_BASE_URL}/auth/refresh`, {
    method: "POST",
    credentials: "include",
  }).then(async (res) => {
    _refreshPromise = null;
    if (res.ok) {
      // Refresh succeeded — fetch a new CSRF token too (the old one is still
      // valid but refreshing it here keeps things consistent)
      await fetchCsrfToken();
      return true;
    }
    return false;
  }).catch(() => {
    _refreshPromise = null;
    return false;
  });

  return _refreshPromise;
}

// ── Core request function ─────────────────────────────────────────────────────
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * apiRequest — wraps fetch with:
 *   - automatic CSRF header injection
 *   - credentials: "include" for cookie auth
 *   - one silent refresh attempt on 401 before giving up
 *
 * @param {string} path
 * @param {RequestInit} options
 * @param {boolean} [_isRetry] — internal flag to prevent infinite retry loops
 */
export async function apiRequest(path, options = {}, _isRetry = false) {
  const method = (options.method || "GET").toUpperCase();
  const headers = { ...(options.headers || {}) };

  if (!(options.body instanceof FormData)) {
    headers["Content-Type"] = headers["Content-Type"] || "application/json";
  }

  if (!SAFE_METHODS.has(method)) {
    const csrf = getCsrfToken();
    if (csrf) headers["x-csrf-token"] = csrf;
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers,
    credentials: "include",
  });

  // ── Silent refresh on 401 ─────────────────────────────────────────────────
  // The access token (15 min) may have expired. Try to silently refresh it
  // using the long-lived refresh token cookie, then retry the original request.
  // Only retry once — if the refresh itself fails, force re-login.
  if (response.status === 401 && !_isRetry) {
    const refreshed = await attemptSilentRefresh();
    if (refreshed) {
      // Retry the original request with the new access token
      return apiRequest(path, options, true);
    }
    // Refresh failed — session is truly expired
    clearAuthSession();
    window.dispatchEvent(new Event("auth:expired"));
    return response;
  }

  if (response.status === 401 && _isRetry) {
    clearAuthSession();
    window.dispatchEvent(new Event("auth:expired"));
  }

  // If CSRF token was rejected, refresh it so the next request succeeds
  if (response.status === 403) {
    const body = await response.clone().json().catch(() => ({}));
    if (body?.code === "INVALID_CSRF_TOKEN") {
      await fetchCsrfToken();
    }
  }

  return response;
}

