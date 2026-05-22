/**
 * time.js — Shared time formatting utilities
 *
 * Extracted in Phase 6 Step 1 to eliminate 6 duplicate copies of timeAgo
 * across: ClientProjectWorkspace, DeveloperProjectWorkspace, ClientMessages,
 * DeveloperMessages, ClientActivityFeed, TopBar.
 */

/**
 * Returns a human-readable relative time string.
 * @param {string|null} dateStr — ISO date string
 * @returns {string}
 */
export function timeAgo(dateStr) {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
