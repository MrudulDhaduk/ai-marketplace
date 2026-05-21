/**
 * useProjectQueries.js — TanStack Query hooks for project data
 *
 * Replaces the scattered useEffect + fetch patterns across:
 *   - ClientDashboard (GET /api/projects)
 *   - DeveloperDashboard (GET /projects/assigned, /projects/discover)
 *   - ClientProjectWorkspace (GET /api/projects/:id, /projects/:id/files)
 *   - DeveloperProjectWorkspace (same endpoints)
 *   - SubmissionHistory (GET /projects/:id/submissions, /projects/:id/activity)
 *   - ClientMessages / DeveloperMessages (GET /projects/:id/messages)
 *
 * Each hook returns the standard TanStack Query result shape:
 *   { data, isLoading, isError, error, refetch }
 */
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "../lib/api";
import { queryClient } from "../lib/queryClient";
import { queryKeys } from "../lib/queryKeys";

/* ── helpers ──────────────────────────────────────────────────────────────── */
async function fetchJson(path) {
  const res = await apiRequest(path);
  if (!res.ok) throw new Error(`Request failed: ${res.status} ${path}`);
  return res.json();
}

/* ══════════════════════════════════════════════════════════════════════════
   CLIENT QUERIES
══════════════════════════════════════════════════════════════════════════ */

/**
 * Client's own project list.
 * Replaces: ClientDashboard useEffect → GET /api/projects
 */
export function useClientProjects() {
  return useQuery({
    queryKey: queryKeys.projects.list(),
    queryFn: async () => {
      const data = await fetchJson("/api/projects");
      const rows = Array.isArray(data) ? data : (data.data ?? []);
      return rows;
    },
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   DEVELOPER QUERIES
══════════════════════════════════════════════════════════════════════════ */

/**
 * Developer's assigned projects.
 * Replaces: DeveloperDashboard fetchAssigned, DeveloperMessages fetch,
 *           DeveloperRatings fetch
 */
export function useAssignedProjects(userId) {
  return useQuery({
    queryKey: queryKeys.developer.assigned(userId),
    queryFn: async () => {
      const data = await fetchJson(`/projects/assigned/${userId}`);
      const rows = Array.isArray(data) ? data : (data.data ?? []);
      return rows;
    },
    enabled: Boolean(userId),
  });
}

/**
 * Developer's project discovery feed.
 * Replaces: DeveloperDashboard useEffect → GET /projects/discover/:id
 */
export function useProjectFeed(userId, showAll) {
  return useQuery({
    queryKey: queryKeys.developer.feed(userId, showAll),
    queryFn: async () => {
      const data = await fetchJson(`/projects/discover/${userId}?all=${showAll}`);
      const rows = Array.isArray(data) ? data : (data.data ?? []);
      return rows;
    },
    enabled: Boolean(userId),
  });
}

/**
 * Developer's own bids.
 * Replaces: DeveloperDashboard useEffect → GET /bids/developer/:id
 */
export function useDeveloperBids(userId) {
  return useQuery({
    queryKey: queryKeys.developer.bids(userId),
    queryFn: async () => {
      const data = await fetchJson(`/bids/developer/${userId}`);
      const rows = Array.isArray(data) ? data : (data.data ?? []);
      return rows;
    },
    enabled: Boolean(userId),
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   SHARED PROJECT DETAIL QUERIES
══════════════════════════════════════════════════════════════════════════ */

/**
 * Single project detail (deliverables, review status, etc.)
 * Replaces: ClientProjectWorkspace + DeveloperProjectWorkspace
 *           useEffect → GET /api/projects/:id
 */
export function useProjectDetail(projectId) {
  return useQuery({
    queryKey: queryKeys.projects.detail(projectId),
    queryFn: () => fetchJson(`/api/projects/${projectId}`),
    enabled: Boolean(projectId),
  });
}

/**
 * Project files list.
 * Replaces: ClientProjectWorkspace + DeveloperProjectWorkspace
 *           useEffect → GET /projects/:id/files
 */
export function useProjectFiles(projectId) {
  return useQuery({
    queryKey: queryKeys.projects.files(projectId),
    queryFn: async () => {
      const data = await fetchJson(`/projects/${projectId}/files`);
      return Array.isArray(data) ? data : [];
    },
    enabled: Boolean(projectId),
  });
}

/**
 * Project activity feed (workspace timeline).
 * Replaces: SubmissionHistory useEffect → GET /projects/:id/activity
 */
export function useProjectActivity(projectId, filter = "all") {
  return useQuery({
    queryKey: queryKeys.projects.activity(projectId, filter),
    queryFn: async () => {
      const data = await fetchJson(
        `/projects/${projectId}/activity?filter=${filter}&limit=60`
      );
      return Array.isArray(data.data) ? data.data : [];
    },
    enabled: Boolean(projectId),
  });
}

/**
 * Project submission history (manual developer notes).
 * Replaces: SubmissionHistory useEffect → GET /projects/:id/submissions
 */
export function useProjectSubmissions(projectId) {
  return useQuery({
    queryKey: queryKeys.projects.submissions(projectId),
    queryFn: async () => {
      const data = await fetchJson(`/projects/${projectId}/submissions`);
      const sorted = Array.isArray(data)
        ? [...data].sort(
            (a, b) => new Date(b.submitted_at) - new Date(a.submitted_at)
          )
        : [];
      return sorted;
    },
    enabled: Boolean(projectId),
  });
}

/**
 * Project messages.
 * Replaces: ClientMessages/ChatPanel + DeveloperMessages/ChatPanel
 *           useEffect → GET /projects/:id/messages
 */
export function useProjectMessages(projectId) {
  return useQuery({
    queryKey: queryKeys.projects.messages(projectId),
    queryFn: async () => {
      const data = await fetchJson(`/projects/${projectId}/messages`);
      return data.data ?? [];
    },
    enabled: Boolean(projectId),
    // Messages are realtime via socket — don't refetch on window focus
    refetchOnWindowFocus: false,
    // Keep messages fresh for only 10s (socket handles the rest)
    staleTime: 10 * 1000,
  });
}

/**
 * Project bids list.
 * Replaces: ProjectBidsModal useEffect → GET /api/projects/:id/bids
 */
export function useProjectBids(projectId) {
  return useQuery({
    queryKey: queryKeys.projects.bids(projectId),
    queryFn: async () => {
      const data = await fetchJson(`/api/projects/${projectId}/bids`);
      return Array.isArray(data) ? data : (data.data ?? []);
    },
    enabled: Boolean(projectId),
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   STATS QUERIES
══════════════════════════════════════════════════════════════════════════ */

export function useClientStats() {
  return useQuery({
    queryKey: queryKeys.client.stats(),
    queryFn: () => fetchJson("/api/stats/client"),
    staleTime: 60 * 1000,
    // Stats are aggregates — can't be derived from socket payloads alone.
    // Refetch on reconnect to recover any missed aggregate changes.
    refetchOnReconnect: true,
  });
}

export function useDeveloperStats() {
  return useQuery({
    queryKey: queryKeys.developer.stats(),
    queryFn: () => fetchJson("/api/stats/developer"),
    staleTime: 60 * 1000,
    refetchOnReconnect: true,
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   ACTIVITY FEED QUERIES
══════════════════════════════════════════════════════════════════════════ */

/**
 * Client activity feed.
 * Replaces: ClientActivityFeed useEffect + socket-triggered refetches
 */
export function useClientActivity() {
  return useQuery({
    queryKey: queryKeys.client.activity(),
    queryFn: async () => {
      const data = await fetchJson("/api/activity/client?limit=10");
      return data.data ?? [];
    },
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   NOTIFICATIONS QUERY
══════════════════════════════════════════════════════════════════════════ */

/**
 * Notification list.
 * Replaces: TopBar useEffect → GET /notifications?limit=20
 */
export function useNotifications(userId) {
  return useQuery({
    queryKey: queryKeys.notifications.list(),
    queryFn: async () => {
      const data = await fetchJson("/notifications?limit=20");
      return data.data ?? [];
    },
    enabled: Boolean(userId),
    // Notifications are realtime via socket — no window focus refetch
    refetchOnWindowFocus: false,
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   INVALIDATION HELPERS
   Call these from socket event handlers instead of manual fetch() calls.
══════════════════════════════════════════════════════════════════════════ */

/**
 * Invalidate all queries related to a specific project.
 */
export function invalidateProject(projectId) {
  queryClient.invalidateQueries({ queryKey: queryKeys.projects.detail(projectId) });
  queryClient.invalidateQueries({ queryKey: queryKeys.projects.files(projectId) });
  queryClient.invalidateQueries({ queryKey: queryKeys.projects.activity(projectId) });
  queryClient.invalidateQueries({ queryKey: queryKeys.projects.submissions(projectId) });
}

/**
 * Invalidate project files only (for file_uploaded, file_deleted, files_reordered).
 */
export function invalidateProjectFiles(projectId) {
  queryClient.invalidateQueries({ queryKey: queryKeys.projects.files(projectId) });
}

/**
 * Invalidate project activity only.
 */
export function invalidateProjectActivity(projectId) {
  // Invalidate all activity queries for this project regardless of filter
  queryClient.invalidateQueries({
    queryKey: ["projects", "activity", projectId],
    exact: false,
  });
  queryClient.invalidateQueries({ queryKey: queryKeys.projects.submissions(projectId) });
}
