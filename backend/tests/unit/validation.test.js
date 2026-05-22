/**
 * Unit tests for backend/utils/validation.js
 *
 * These are pure-function tests — no DB, no HTTP, no mocks needed.
 */
const {
  isNonEmptyString,
  isPositiveNumber,
  isValidEmail,
  isValidHttpsUrl,
  validateSignup,
  validateLogin,
  validateProject,
  validateBid,
  validateSubmission,
} = require("../../utils/validation");

// ── isNonEmptyString ──────────────────────────────────────────────────────────
describe("isNonEmptyString", () => {
  test("returns true for a normal string", () => {
    expect(isNonEmptyString("hello")).toBe(true);
  });

  test("returns false for empty string", () => {
    expect(isNonEmptyString("")).toBe(false);
  });

  test("returns false for whitespace-only string", () => {
    expect(isNonEmptyString("   ")).toBe(false);
  });

  test("returns false for non-string types", () => {
    expect(isNonEmptyString(null)).toBe(false);
    expect(isNonEmptyString(undefined)).toBe(false);
    expect(isNonEmptyString(42)).toBe(false);
    expect(isNonEmptyString([])).toBe(false);
  });

  test("returns false when string exceeds max length", () => {
    expect(isNonEmptyString("a".repeat(101), 100)).toBe(false);
  });

  test("returns true when string is exactly at max length", () => {
    expect(isNonEmptyString("a".repeat(100), 100)).toBe(true);
  });
});

// ── isPositiveNumber ──────────────────────────────────────────────────────────
describe("isPositiveNumber", () => {
  test("returns true for positive integers", () => {
    expect(isPositiveNumber(1)).toBe(true);
    expect(isPositiveNumber(100)).toBe(true);
  });

  test("returns true for positive floats", () => {
    expect(isPositiveNumber(0.01)).toBe(true);
    expect(isPositiveNumber("99.99")).toBe(true);
  });

  test("returns false for zero", () => {
    expect(isPositiveNumber(0)).toBe(false);
  });

  test("returns false for negative numbers", () => {
    expect(isPositiveNumber(-1)).toBe(false);
  });

  test("returns false for non-numeric strings", () => {
    expect(isPositiveNumber("abc")).toBe(false);
    expect(isPositiveNumber("")).toBe(false);
  });

  test("returns false for null/undefined", () => {
    expect(isPositiveNumber(null)).toBe(false);
    expect(isPositiveNumber(undefined)).toBe(false);
  });
});

// ── isValidEmail ──────────────────────────────────────────────────────────────
describe("isValidEmail", () => {
  test("accepts valid emails", () => {
    expect(isValidEmail("user@example.com")).toBe(true);
    expect(isValidEmail("user+tag@sub.domain.io")).toBe(true);
  });

  test("rejects emails without @", () => {
    expect(isValidEmail("notanemail")).toBe(false);
  });

  test("rejects emails without domain", () => {
    expect(isValidEmail("user@")).toBe(false);
  });

  test("rejects emails with spaces", () => {
    expect(isValidEmail("user @example.com")).toBe(false);
  });

  test("rejects non-string values", () => {
    expect(isValidEmail(null)).toBe(false);
    expect(isValidEmail(42)).toBe(false);
  });
});

// ── isValidHttpsUrl ───────────────────────────────────────────────────────────
describe("isValidHttpsUrl", () => {
  test("accepts valid HTTPS URLs", () => {
    expect(isValidHttpsUrl("https://github.com/user/repo")).toBe(true);
    expect(isValidHttpsUrl("https://example.com/path?q=1")).toBe(true);
  });

  test("rejects HTTP URLs", () => {
    expect(isValidHttpsUrl("http://example.com")).toBe(false);
  });

  test("rejects javascript: URLs", () => {
    expect(isValidHttpsUrl("javascript:alert(1)")).toBe(false);
  });

  test("rejects data: URLs", () => {
    expect(isValidHttpsUrl("data:text/html,<h1>hi</h1>")).toBe(false);
  });

  test("rejects empty strings", () => {
    expect(isValidHttpsUrl("")).toBe(false);
  });

  test("rejects non-string values", () => {
    expect(isValidHttpsUrl(null)).toBe(false);
    expect(isValidHttpsUrl(undefined)).toBe(false);
  });
});

// ── validateSignup ────────────────────────────────────────────────────────────
describe("validateSignup", () => {
  const valid = {
    firstName: "Alice",
    lastName: "Smith",
    username: "alice_smith",
    email: "alice@example.com",
    password: "Password1",
  };

  test("returns null for valid input", () => {
    expect(validateSignup(valid)).toBeNull();
  });

  test("rejects missing firstName", () => {
    expect(validateSignup({ ...valid, firstName: "" })).toMatch(/first name/i);
  });

  test("rejects missing lastName", () => {
    expect(validateSignup({ ...valid, lastName: "" })).toMatch(/last name/i);
  });

  test("rejects username shorter than 3 chars", () => {
    expect(validateSignup({ ...valid, username: "ab" })).toMatch(/3 characters/i);
  });

  test("rejects username with special characters", () => {
    expect(validateSignup({ ...valid, username: "alice!" })).toMatch(/letters, numbers/i);
  });

  test("rejects invalid email", () => {
    expect(validateSignup({ ...valid, email: "notanemail" })).toMatch(/email/i);
  });

  test("rejects password shorter than 8 chars", () => {
    expect(validateSignup({ ...valid, password: "Pass1" })).toMatch(/8 characters/i);
  });

  test("rejects password without uppercase", () => {
    expect(validateSignup({ ...valid, password: "password1" })).toMatch(/uppercase/i);
  });

  test("rejects password without number", () => {
    expect(validateSignup({ ...valid, password: "Password" })).toMatch(/number/i);
  });
});

// ── validateProject ───────────────────────────────────────────────────────────
describe("validateProject", () => {
  const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0];

  const valid = {
    title: "Build a React App",
    description: "A detailed description of the project requirements.",
    minBudget: 100,
    maxBudget: 500,
    dueDate: futureDate,
    tags: ["react", "javascript"],
  };

  test("returns null for valid input", () => {
    expect(validateProject(valid)).toBeNull();
  });

  test("rejects empty title", () => {
    expect(validateProject({ ...valid, title: "" })).toMatch(/title/i);
  });

  test("rejects minBudget >= maxBudget", () => {
    expect(validateProject({ ...valid, minBudget: 500, maxBudget: 500 })).toMatch(/minimum budget/i);
    expect(validateProject({ ...valid, minBudget: 600, maxBudget: 500 })).toMatch(/minimum budget/i);
  });

  test("rejects past due date", () => {
    expect(validateProject({ ...valid, dueDate: "2020-01-01" })).toMatch(/past/i);
  });

  test("rejects empty tags array", () => {
    expect(validateProject({ ...valid, tags: [] })).toMatch(/tag/i);
  });

  test("rejects more than 15 tags", () => {
    const tooManyTags = Array.from({ length: 16 }, (_, i) => `tag${i}`);
    expect(validateProject({ ...valid, tags: tooManyTags })).toMatch(/15 tags/i);
  });

  test("rejects non-array tags", () => {
    expect(validateProject({ ...valid, tags: "react" })).toMatch(/tag/i);
  });
});

// ── validateBid ───────────────────────────────────────────────────────────────
describe("validateBid", () => {
  const valid = {
    amount: 250,
    proposal: "I have extensive experience with this type of project and can deliver on time.",
  };

  test("returns null for valid input", () => {
    expect(validateBid(valid)).toBeNull();
  });

  test("rejects zero amount", () => {
    expect(validateBid({ ...valid, amount: 0 })).toMatch(/positive/i);
  });

  test("rejects negative amount", () => {
    expect(validateBid({ ...valid, amount: -100 })).toMatch(/positive/i);
  });

  test("rejects unreasonably large amount", () => {
    expect(validateBid({ ...valid, amount: 10_000_001 })).toMatch(/unreasonably/i);
  });

  test("rejects proposal shorter than 20 chars", () => {
    expect(validateBid({ ...valid, proposal: "Too short" })).toMatch(/20 characters/i);
  });

  test("rejects empty proposal", () => {
    expect(validateBid({ ...valid, proposal: "" })).toMatch(/required/i);
  });
});

// ── validateSubmission ────────────────────────────────────────────────────────
describe("validateSubmission", () => {
  const valid = {
    repoLink: "https://github.com/user/repo",
    demoLink: "https://demo.example.com",
  };

  test("returns null for valid input", () => {
    expect(validateSubmission(valid)).toBeNull();
  });

  test("returns null when demoLink is omitted", () => {
    expect(validateSubmission({ repoLink: valid.repoLink })).toBeNull();
  });

  test("rejects missing repoLink", () => {
    expect(validateSubmission({ ...valid, repoLink: "" })).toMatch(/repository/i);
  });

  test("rejects HTTP repoLink", () => {
    expect(validateSubmission({ ...valid, repoLink: "http://github.com/user/repo" })).toMatch(/https/i);
  });

  test("rejects HTTP demoLink", () => {
    expect(validateSubmission({ ...valid, demoLink: "http://demo.example.com" })).toMatch(/https/i);
  });

  test("rejects javascript: demoLink", () => {
    expect(validateSubmission({ ...valid, demoLink: "javascript:alert(1)" })).toMatch(/https/i);
  });
});
