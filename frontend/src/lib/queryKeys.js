/**
 * queryKeys.js — Centralized query key factory
 *
 * All query keys live here so invalidation is consistent across the app.
 * Pattern: factory functions return arrays — TanStack Query matches on
 * prefix, so invalidating queryKeys.projects.all() also invalidates
 * queryKeys.projects.detail(id), queryKeys.projects.files(id), etc.
 *
 * Usage:
 *   useQuery({ queryKey: queryKeys.projects.list() })
 *   queryClient.invalidateQueries({ queryKey: queryKeys.projects.detail(id) })
 */

export const queryKeys = {
  // ── Projects ──────────────────────────────────────────────────────────────
  projects: {
    /** Invalidates ALL project queries */
    all: ()                  => ["projects"],
    /** Client's own project list */
    list: ()                 => ["projects", "list"],
    /** Single project detail */
    detail: (id)             => ["projects", "detail", id],
    /** Project files */
    files: (id)              => ["projects", "files", id],
    /** Project activity feed */
    activity: (id, filter)   => ["projects", "activity", id, filter],
    /** Project submission history (manual notes) */
    submissions: (id)        => ["projects", "submissions", id],
    /** Project messages */
    messages: (id)           => ["projects", "messages", id],
    /** Project bids */
    bids: (id)               => ["projects", "bids", id],
  },

  // ── Developer ─────────────────────────────────────────────────────────────
  developer: {
    /** All developer queries */
    all: ()                  => ["developer"],
    /** Discover feed */
    feed: (userId, showAll)  => ["developer", "feed", userId, showAll],
    /** Assigned projects */
    assigned: (userId)       => ["developer", "assigned", userId],
    /** My bids */
    bids: (userId)           => ["developer", "bids", userId],
    /** Stats */
    stats: ()                => ["developer", "stats"],
    /** Ratings */
    ratings: (userId)        => ["developer", "ratings", userId],
  },

  // ── Client ────────────────────────────────────────────────────────────────
  client: {
    /** All client queries */
    all: ()                  => ["client"],
    /** Stats */
    stats: ()                => ["client", "stats"],
    /** Activity feed */
    activity: ()             => ["client", "activity"],
  },

  // ── Notifications ─────────────────────────────────────────────────────────
  notifications: {
    all: ()                  => ["notifications"],
    list: ()                 => ["notifications", "list"],
  },

  // ── Profile ───────────────────────────────────────────────────────────────
  profile: {
    all: ()                  => ["profile"],
    detail: (userId)         => ["profile", "detail", userId],
    skills: (userId)         => ["profile", "skills", userId],
    activity: (userId, role) => ["profile", "activity", userId, role],
    projects: (userId, role) => ["profile", "projects", userId, role],
  },
};
