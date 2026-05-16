/* ─────────────────────────────────────────────────────────────
   Centralised server-side validation utilities.
   All validators return a string error message or null on success.
───────────────────────────────────────────────────────────── */

// ── Primitives ────────────────────────────────────────────────

function isNonEmptyString(value, max = 5000) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}

function isPositiveNumber(value) {
  return Number.isFinite(Number(value)) && Number(value) > 0;
}

function isValidEmail(value) {
  return typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

/**
 * Validates a URL is HTTPS only (prevents javascript:, data:, etc.)
 */
function isValidHttpsUrl(value) {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:";
  } catch {
    return false;
  }
}

// ── Domain validators ─────────────────────────────────────────

function validateSignup({ firstName, lastName, username, email, password }) {
  if (!isNonEmptyString(firstName, 50))  return "First name is required (max 50 chars)";
  if (!isNonEmptyString(lastName, 50))   return "Last name is required (max 50 chars)";

  if (!isNonEmptyString(username, 30))   return "Username is required (max 30 chars)";
  if (username.trim().length < 3)        return "Username must be at least 3 characters";
  if (!/^[a-zA-Z0-9_]+$/.test(username.trim())) return "Username may only contain letters, numbers, and underscores";

  if (!isValidEmail(email))              return "A valid email address is required";

  if (!isNonEmptyString(password, 128))  return "Password is required (max 128 chars)";
  if (password.length < 8)              return "Password must be at least 8 characters";
  if (!/[A-Z]/.test(password))          return "Password must contain at least one uppercase letter";
  if (!/[0-9]/.test(password))          return "Password must contain at least one number";

  return null;
}

function validateLogin({ username, password }) {
  if (!isNonEmptyString(username, 30)) return "Username is required";
  if (!isNonEmptyString(password, 128)) return "Password is required";
  return null;
}

function validateProject({ title, description, minBudget, maxBudget, dueDate, tags }) {
  if (!isNonEmptyString(title, 120))       return "Title is required (max 120 chars)";
  if (!isNonEmptyString(description, 5000)) return "Description is required (max 5000 chars)";

  if (!isPositiveNumber(minBudget))        return "Minimum budget must be a positive number";
  if (!isPositiveNumber(maxBudget))        return "Maximum budget must be a positive number";
  if (Number(minBudget) >= Number(maxBudget)) return "Minimum budget must be less than maximum budget";

  if (!dueDate) return "Due date is required";
  const due = new Date(dueDate);
  if (isNaN(due.getTime()))               return "Due date is invalid";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (due < today)                        return "Due date cannot be in the past";

  if (!Array.isArray(tags) || tags.length === 0) return "At least one tag is required";
  if (tags.length > 15)                   return "Maximum 15 tags allowed";
  for (const tag of tags) {
    if (!isNonEmptyString(tag, 40))       return "Each tag must be a non-empty string (max 40 chars)";
  }

  return null;
}

function validateBid({ amount, proposal }) {
  if (!isPositiveNumber(amount))          return "Bid amount must be a positive number";
  if (Number(amount) > 10_000_000)        return "Bid amount is unreasonably large";

  if (!isNonEmptyString(proposal, 2000))  return "Proposal is required (max 2000 chars)";
  if (proposal.trim().length < 20)        return "Proposal must be at least 20 characters";

  return null;
}

function validateSubmission({ repoLink, demoLink, notes }) {
  if (!isNonEmptyString(repoLink, 500))   return "Repository link is required";
  if (!isValidHttpsUrl(repoLink))         return "Repository link must be a valid HTTPS URL";

  if (demoLink && demoLink.trim()) {
    if (!isValidHttpsUrl(demoLink))       return "Demo link must be a valid HTTPS URL";
  }

  if (notes !== undefined && notes !== null && notes !== "") {
    if (!isNonEmptyString(notes, 2000))   return "Submission notes must be 2000 characters or less";
  }

  return null;
}

// ── Legacy helper (kept for backward compat) ──────────────────

function requireFields(body, fields) {
  const missing = fields.filter(
    (field) => body[field] === undefined || body[field] === null || body[field] === "",
  );
  return missing.length ? `${missing.join(", ")} required` : null;
}

module.exports = {
  // primitives
  isNonEmptyString,
  isPositiveNumber,
  isValidEmail,
  isValidHttpsUrl,
  // domain validators
  validateSignup,
  validateLogin,
  validateProject,
  validateBid,
  validateSubmission,
  // legacy
  requireFields,
};
