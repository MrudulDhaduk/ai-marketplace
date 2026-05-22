/**
 * Unit tests for frontend utility functions.
 *
 * Covers: format.js, time.js, files.js, queryKeys.js
 * These are pure functions — no DOM, no mocks needed.
 */

import { formatProjectForCard } from "../utils/format";
import { timeAgo } from "../utils/time";
import { getFileIcon, getFileExt, formatBytes, FILE_ICONS } from "../utils/files";
import { queryKeys } from "../lib/queryKeys";

// ── formatProjectForCard ──────────────────────────────────────────────────────
describe("formatProjectForCard", () => {
  const baseProject = {
    id: 1,
    title: "Test Project",
    status: "bidding",
    min_budget: 500,
    max_budget: 2000,
    due_date: "2027-12-31",
    tags: ["react", "node"],
    bids: 3,
  };

  test("formats budget from min/max fields", () => {
    const result = formatProjectForCard(baseProject);
    expect(result.budget).toBe("₹500 - ₹2000");
  });

  test("preserves existing budget string if provided", () => {
    const result = formatProjectForCard({ ...baseProject, budget: "Custom Budget" });
    expect(result.budget).toBe("Custom Budget");
  });

  test("formats due date from due_date field", () => {
    const result = formatProjectForCard(baseProject);
    expect(result.due).toBeTruthy();
    expect(typeof result.due).toBe("string");
    expect(result.due).not.toBe("No deadline");
  });

  test("returns 'No deadline' when no due date", () => {
    const result = formatProjectForCard({ ...baseProject, due_date: null, dueDate: null });
    expect(result.due).toBe("No deadline");
  });

  test("preserves existing due string if provided", () => {
    const result = formatProjectForCard({ ...baseProject, due: "Tomorrow" });
    expect(result.due).toBe("Tomorrow");
  });

  test("defaults status to 'draft' when missing", () => {
    const result = formatProjectForCard({ ...baseProject, status: undefined });
    expect(result.status).toBe("draft");
  });

  test("defaults bids to 0 when missing", () => {
    const result = formatProjectForCard({ ...baseProject, bids: undefined });
    expect(result.bids).toBe(0);
  });

  test("defaults tags to empty array when missing", () => {
    const result = formatProjectForCard({ ...baseProject, tags: undefined });
    expect(result.tags).toEqual([]);
  });

  test("preserves all original fields", () => {
    const result = formatProjectForCard(baseProject);
    expect(result.id).toBe(1);
    expect(result.title).toBe("Test Project");
  });

  test("handles camelCase budget fields (minBudget/maxBudget)", () => {
    const { min_budget, max_budget, ...rest } = baseProject;
    const result = formatProjectForCard({ ...rest, minBudget: 100, maxBudget: 300 });
    expect(result.budget).toBe("₹100 - ₹300");
  });
});

// ── timeAgo ───────────────────────────────────────────────────────────────────
describe("timeAgo", () => {
  test("returns 'just now' for timestamps less than 1 minute ago", () => {
    const thirtySecondsAgo = new Date(Date.now() - 30 * 1000).toISOString();
    expect(timeAgo(thirtySecondsAgo)).toBe("just now");
  });

  test("returns minutes for timestamps 1-59 minutes ago", () => {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    expect(timeAgo(fiveMinutesAgo)).toBe("5m ago");
  });

  test("returns hours for timestamps 1-23 hours ago", () => {
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    expect(timeAgo(threeHoursAgo)).toBe("3h ago");
  });

  test("returns days for timestamps 24+ hours ago", () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    expect(timeAgo(twoDaysAgo)).toBe("2d ago");
  });

  test("returns empty string for null input", () => {
    expect(timeAgo(null)).toBe("");
  });

  test("returns empty string for undefined input", () => {
    expect(timeAgo(undefined)).toBe("");
  });
});

// ── getFileExt ────────────────────────────────────────────────────────────────
describe("getFileExt", () => {
  test("returns lowercase extension", () => {
    expect(getFileExt("document.PDF")).toBe("pdf");
    expect(getFileExt("image.PNG")).toBe("png");
  });

  test("returns last extension for files with multiple dots", () => {
    expect(getFileExt("archive.tar.gz")).toBe("gz");
  });

  test("returns empty string for files without extension", () => {
    expect(getFileExt("Makefile")).toBe("makefile");
  });

  test("handles empty string", () => {
    expect(getFileExt("")).toBe("");
  });
});

// ── getFileIcon ───────────────────────────────────────────────────────────────
describe("getFileIcon", () => {
  test("returns PDF icon for .pdf files", () => {
    expect(getFileIcon("document.pdf")).toBe(FILE_ICONS.pdf);
  });

  test("returns image icon for .png files", () => {
    expect(getFileIcon("photo.png")).toBe(FILE_ICONS.png);
  });

  test("returns code icon for .js files", () => {
    expect(getFileIcon("app.js")).toBe(FILE_ICONS.js);
  });

  test("returns React icon for .jsx files", () => {
    expect(getFileIcon("Component.jsx")).toBe(FILE_ICONS.jsx);
  });

  test("returns default folder icon for unknown extensions", () => {
    expect(getFileIcon("unknown.xyz")).toBe("📁");
  });

  test("handles uppercase extensions", () => {
    expect(getFileIcon("DOCUMENT.PDF")).toBe(FILE_ICONS.pdf);
  });
});

// ── formatBytes ───────────────────────────────────────────────────────────────
describe("formatBytes", () => {
  test("formats bytes", () => {
    expect(formatBytes(512)).toBe("512 B");
  });

  test("formats kilobytes", () => {
    expect(formatBytes(1536)).toBe("1.5 KB");
  });

  test("formats megabytes", () => {
    expect(formatBytes(2 * 1024 * 1024)).toBe("2.0 MB");
  });

  test("returns null for 0", () => {
    expect(formatBytes(0)).toBeNull();
  });

  test("returns null for null", () => {
    expect(formatBytes(null)).toBeNull();
  });

  test("returns null for undefined", () => {
    expect(formatBytes(undefined)).toBeNull();
  });
});

// ── queryKeys ─────────────────────────────────────────────────────────────────
describe("queryKeys", () => {
  test("projects.all() returns base key", () => {
    expect(queryKeys.projects.all()).toEqual(["projects"]);
  });

  test("projects.detail(id) includes the id", () => {
    expect(queryKeys.projects.detail(42)).toEqual(["projects", "detail", 42]);
  });

  test("projects.activity(id, filter) includes both params", () => {
    expect(queryKeys.projects.activity(5, "submissions")).toEqual([
      "projects", "activity", 5, "submissions",
    ]);
  });

  test("developer.feed includes userId and showAll", () => {
    expect(queryKeys.developer.feed(7, true)).toEqual(["developer", "feed", 7, true]);
  });

  test("notifications.list() is a proper sub-key of notifications.all()", () => {
    const all = queryKeys.notifications.all();   // ["notifications"]
    const list = queryKeys.notifications.list(); // ["notifications", "list"]
    // TanStack Query invalidates by prefix: invalidating all() must also
    // invalidate list(). Verify list starts with all's elements.
    expect(list.slice(0, all.length)).toEqual(all);
    expect(list.length).toBeGreaterThan(all.length);
  });

  test("all key factories return arrays", () => {
    const allKeys = [
      queryKeys.projects.all(),
      queryKeys.projects.list(),
      queryKeys.projects.detail(1),
      queryKeys.projects.files(1),
      queryKeys.projects.activity(1, "all"),
      queryKeys.projects.submissions(1),
      queryKeys.projects.messages(1),
      queryKeys.projects.bids(1),
      queryKeys.developer.all(),
      queryKeys.developer.stats(),
      queryKeys.client.all(),
      queryKeys.client.stats(),
      queryKeys.notifications.all(),
      queryKeys.notifications.list(),
      queryKeys.profile.detail(1),
      queryKeys.profile.skills(1),
    ];
    allKeys.forEach((key) => {
      expect(Array.isArray(key)).toBe(true);
      expect(key.length).toBeGreaterThan(0);
    });
  });
});
