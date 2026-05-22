/**
 * format.js — Shared data formatting utilities
 *
 * Extracted in Phase 6 Step 1. formatProjectForCard was previously
 * defined inline in ClientDashboard.jsx.
 */

/**
 * Normalises a raw project object from the API into the shape expected
 * by ProjectCard and ClientProjectsPanel.
 * @param {object} p — raw project from API
 * @returns {object}
 */
export function formatProjectForCard(p) {
  const hasBudgetText = typeof p.budget === "string" && p.budget.trim();
  const minBudget = p.min_budget ?? p.minBudget ?? 0;
  const maxBudget = p.max_budget ?? p.maxBudget ?? 0;
  const budget = hasBudgetText ? p.budget : `₹${minBudget} - ₹${maxBudget}`;

  const hasDueText = typeof p.due === "string" && p.due.trim();
  const dueSource = p.due_date ?? p.dueDate ?? null;
  const parsedDueDate = dueSource ? new Date(dueSource) : null;
  const due = hasDueText
    ? p.due
    : parsedDueDate && !Number.isNaN(parsedDueDate.getTime())
      ? parsedDueDate.toLocaleDateString("en-IN", {
          day: "numeric",
          month: "short",
        })
      : "No deadline";

  return {
    ...p,
    budget,
    due,
    status: p.status || "draft",
    bids: p.bids || 0,
    progress: p.progress || 0,
    tags: Array.isArray(p.tags) ? p.tags : [],
  };
}
