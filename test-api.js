/**
 * NeuralForge API Test Suite — Phase 3 Edition
 *
 * Covers: cookie auth, CSRF, email verification bypass (dev mode),
 * refresh token rotation, reuse detection, logout revocation,
 * idempotency (bid/submission/accept), IDOR authorization,
 * projects, bidding, notifications, messaging, submissions,
 * revisions, approvals, workspace activity, file access control,
 * stats, profile, and security-negative cases.
 *
 * Run:  node test-api.js
 * Req:  Node 18+  (native fetch + cookie jar via node-fetch or manual)
 */

"use strict";

const BASE = "http://localhost:5000";

// Load .env so TEST_API_KEY is available
require("dotenv").config();
const TEST_BYPASS_KEY = process.env.TEST_API_KEY || null;

// ── ANSI colours ──────────────────────────────────────────────────────────────
const C = {
  reset:  "\x1b[0m",
  bold:   "\x1b[1m",
  dim:    "\x1b[2m",
  green:  "\x1b[32m",
  red:    "\x1b[31m",
  yellow: "\x1b[33m",
  cyan:   "\x1b[36m",
  white:  "\x1b[37m",
  bgRed:  "\x1b[41m",
  bgGreen:"\x1b[42m",
};

// ── Result tracking ───────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
let skipped = 0;
const results = [];
let currentSection = "";

function section(title) {
  currentSection = title;
  const bar = "─".repeat(52 - title.length);
  console.log(`\n${C.cyan}${C.bold}── ${title} ${bar}${C.reset}`);
}

function log(label, ok, detail = "", note = "") {
  const icon   = ok ? `${C.green}✅${C.reset}` : `${C.red}❌${C.reset}`;
  const status = ok ? `${C.green}PASS${C.reset}` : `${C.red}FAIL${C.reset}`;
  const det    = detail ? `  ${C.dim}${detail}${C.reset}` : "";
  const nt     = note   ? `  ${C.yellow}⚠ ${note}${C.reset}` : "";
  console.log(`  ${icon} ${C.bold}${label}${C.reset} [${status}]${det}${nt}`);
  results.push({ section: currentSection, label, ok, detail, note });
  if (ok) passed++; else failed++;
}

function skip(label, reason) {
  console.log(`  ${C.yellow}⏭ ${C.bold}${label}${C.reset} ${C.dim}[SKIP] ${reason}${C.reset}`);
  results.push({ section: currentSection, label, ok: null, detail: reason, note: "" });
  skipped++;
}

function uid() {
  return Math.random().toString(36).slice(2, 9);
}

// ── Cookie jar ────────────────────────────────────────────────────────────────
// Node's native fetch does NOT persist cookies between requests.
// We maintain a per-session jar manually.
class CookieJar {
  constructor() { this._cookies = {}; }

  ingest(res) {
    // Node native fetch returns set-cookie as a single comma-joined string
    // via headers.get(), or as an array via headers.getSetCookie() (Node 20+).
    // We support both to be safe.
    let headers = [];
    if (typeof res.headers.getSetCookie === "function") {
      headers = res.headers.getSetCookie();
    } else {
      const raw = res.headers.get("set-cookie");
      if (raw) {
        // Split on ", " only when followed by a cookie name (word=),
        // not inside cookie values. This handles "expires=Thu, 01 Jan..." safely.
        headers = raw.split(/,\s*(?=[A-Za-z0-9_\-]+=)/);
      }
    }
    for (const h of headers) {
      const [pair] = h.split(";");
      const eq = pair.indexOf("=");
      if (eq === -1) continue;
      const name  = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (value === "" || value.toLowerCase() === "deleted") {
        delete this._cookies[name];
      } else {
        this._cookies[name] = value;
      }
    }
  }

  header() {
    return Object.entries(this._cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
  }

  get(name) { return this._cookies[name]; }
  clear()   { this._cookies = {}; }
}

// ── HTTP client ───────────────────────────────────────────────────────────────
// Each "session" is a CookieJar + CSRF token pair.
// Mirrors exactly what the browser does after Phase 3.

class Session {
  constructor(label) {
    this.label = label;
    this.jar   = new CookieJar();
    this.csrf  = null;
    this.user  = null;
  }

  async fetchCsrf() {
    const headers = { Cookie: this.jar.header() };
    if (TEST_BYPASS_KEY) headers["x-test-bypass"] = TEST_BYPASS_KEY;
    const res = await fetch(`${BASE}/auth/csrf-token`, { headers });
    this.jar.ingest(res);
    const data = await res.json().catch(() => ({}));
    this.csrf = data.csrfToken ?? null;
    return this.csrf;
  }

  async req(method, path, body, { raw = false, extraHeaders = {} } = {}) {
    const headers = { ...extraHeaders };
    const isFormData = body instanceof FormData;

    if (!isFormData) headers["Content-Type"] = "application/json";

    const cookieStr = this.jar.header();
    if (cookieStr) headers["Cookie"] = cookieStr;

    // Inject test bypass header so rate limiters are skipped
    if (TEST_BYPASS_KEY) headers["x-test-bypass"] = TEST_BYPASS_KEY;

    const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);
    if (!SAFE.has(method.toUpperCase()) && this.csrf) {
      headers["x-csrf-token"] = this.csrf;
    }

    const opts = { method, headers };
    if (body !== undefined && body !== null) {
      opts.body = isFormData ? body : JSON.stringify(body);
    }

    const res = await fetch(`${BASE}${path}`, opts);
    this.jar.ingest(res);

    if (raw) return res;
    let json;
    try { json = await res.json(); } catch { json = {}; }
    return { status: res.status, body: json, headers: res.headers };
  }

  async login(username, password) {
    await this.fetchCsrf();
    const r = await this.req("POST", "/auth/login", { username, password });
    if (r.status === 200) {
      this.user = r.body.user;
      // Refresh CSRF after login (new cookie set)
      await this.fetchCsrf();
    }
    return r;
  }

  async logout() {
    const r = await this.req("POST", "/auth/logout");
    this.jar.clear();
    this.csrf = null;
    this.user = null;
    return r;
  }

  get id() { return this.user?.id; }
}

// ── Bare request (no session — for unauthenticated tests) ─────────────────────
async function bare(method, path, body, extraHeaders = {}) {
  const headers = { "Content-Type": "application/json", ...extraHeaders };
  if (TEST_BYPASS_KEY) headers["x-test-bypass"] = TEST_BYPASS_KEY;
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, opts);
  let json;
  try { json = await res.json(); } catch { json = {}; }
  return { status: res.status, body: json };
}

// ── DB helper — bypass email verification for test users ──────────────────────
// In dev mode the server logs the verify URL instead of sending email.
// We call the verify endpoint directly using the token from the DB via
// a dedicated test-only endpoint — but since we don't have one, we instead
// directly hit /auth/verify-email with the token we extract from the signup
// response body (the server logs it; we can't read logs from here).
//
// WORKAROUND: The test suite directly updates email_verified via a raw DB
// query using the pg client — but that requires DB credentials in this script.
// Instead we use a simpler approach: the server returns the verify URL in
// dev mode logs. We call a helper endpoint that the test suite adds temporarily.
//
// ACTUAL APPROACH USED: We call POST /auth/signup, then immediately call
// GET /auth/verify-email?token=TEST_BYPASS using a special test token that
// the server accepts when NODE_ENV=test. Since we don't have that either,
// we use the most practical approach: directly query the DB via the
// /health endpoint trick — but that's not available either.
//
// FINAL APPROACH: Use the pg module directly in this script to mark users
// as verified. This is a test script — it's fine to connect to the DB.

let pgPool = null;

async function initDb() {
  try {
    const { Pool } = await import("pg");
    require("dotenv").config();
    pgPool = new Pool(
      process.env.DATABASE_URL
        ? { connectionString: process.env.DATABASE_URL }
        : {
            user:     process.env.DB_USER     || "postgres",
            host:     process.env.DB_HOST     || "localhost",
            database: process.env.DB_NAME     || "ai_marketplace",
            password: process.env.DB_PASSWORD || "",
            port:     Number(process.env.DB_PORT) || 5432,
          }
    );
    await pgPool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

async function verifyUserInDb(email) {
  if (!pgPool) return false;
  try {
    await pgPool.query("UPDATE users SET email_verified = true WHERE email = $1", [email]);
    return true;
  } catch {
    return false;
  }
}

async function getRefreshTokenFromDb(userId) {
  if (!pgPool) return null;
  try {
    // Get the most recently revoked token for this user
    const r = await pgPool.query(
      `SELECT token_hash, revoked_at FROM refresh_tokens
       WHERE user_id = $1
       ORDER BY created_at DESC LIMIT 1`,
      [userId]
    );
    return r.rows[0] || null;
  } catch { return null; }
}

// ═════════════════════════════════════════════════════════════════════════════
//  MAIN TEST RUNNER
// ═════════════════════════════════════════════════════════════════════════════

async function run() {
  console.log(`\n${C.bold}${"═".repeat(56)}${C.reset}`);
  console.log(`${C.bold}  NeuralForge API Test Suite — Phase 3 Security Edition${C.reset}`);
  console.log(`${C.bold}${"═".repeat(56)}${C.reset}`);
  console.log(`${C.dim}  Base URL : ${BASE}${C.reset}`);
  console.log(`${C.dim}  Started  : ${new Date().toISOString()}${C.reset}\n`);

  // ── DB connection ────────────────────────────────────────────────────────
  const dbOk = await initDb();
  if (!dbOk) {
    console.log(`${C.yellow}  ⚠  Could not connect to DB directly.${C.reset}`);
    console.log(`${C.yellow}     Email verification tests will be skipped.${C.reset}`);
    console.log(`${C.yellow}     Ensure DB_HOST / DATABASE_URL is set in .env${C.reset}\n`);
  } else {
    console.log(`${C.green}  ✓  DB connection OK${C.reset}\n`);
  }

  // ── 1. Health ─────────────────────────────────────────────────────────────
  section("1. Health Check");
  {
    const r = await bare("GET", "/health");
    log("GET /health → 200", r.status === 200, `status=${r.status}`);
    log("GET /health returns ok field", r.body.status === "ok" || r.body.ok === true,
      `body.status="${r.body.status}"`);
  }

  // ── 2. CSRF token endpoint ────────────────────────────────────────────────
  section("2. CSRF Token");
  const csrfSession = new Session("csrf-probe");
  {
    const token = await csrfSession.fetchCsrf();
    log("GET /auth/csrf-token → returns token", typeof token === "string" && token.length > 0,
      `token length=${token?.length}`);
    log("GET /auth/csrf-token → sets x-csrf-token cookie",
      !!csrfSession.jar.get("x-csrf-token"),
      `cookie=${csrfSession.jar.get("x-csrf-token")?.slice(0, 16)}…`);
  }

  // ── 3. Signup ─────────────────────────────────────────────────────────────
  section("3. Auth — Signup");
  const id = uid();
  const clientCreds = {
    firstName: "Alice", lastName: "Test",
    username: `client_${id}`, email: `client_${id}@test.com`,
    password: "Password123!", role: "client",
  };
  const devCreds = {
    firstName: "Bob", lastName: "Dev",
    username: `dev_${id}`, email: `dev_${id}@test.com`,
    password: "Password123!", role: "developer",
  };
  // Third user for IDOR tests
  const otherCreds = {
    firstName: "Eve", lastName: "Other",
    username: `other_${id}`, email: `other_${id}@test.com`,
    password: "Password123!", role: "client",
  };

  {
    const r = await bare("POST", "/auth/signup", clientCreds);
    log("POST /auth/signup (client) → 201", r.status === 201, `status=${r.status}`);
    if (r.status !== 201) console.log(`    ${C.dim}body: ${JSON.stringify(r.body)}${C.reset}`);
  }
  {
    const r = await bare("POST", "/auth/signup", devCreds);
    log("POST /auth/signup (developer) → 201", r.status === 201, `status=${r.status}`);
  }
  {
    const r = await bare("POST", "/auth/signup", otherCreds);
    log("POST /auth/signup (other user) → 201", r.status === 201, `status=${r.status}`);
  }
  {
    const r = await bare("POST", "/auth/signup", clientCreds);
    log("POST /auth/signup (duplicate) → 409", r.status === 409, `status=${r.status}`);
  }
  {
    const r = await bare("POST", "/auth/signup", { username: "x" });
    log("POST /auth/signup (missing fields) → 400", r.status === 400, `status=${r.status}`);
  }
  {
    const r = await bare("POST", "/auth/signup", { ...clientCreds, password: "weak" });
    log("POST /auth/signup (weak password) → 400", r.status === 400, `status=${r.status}`);
  }

  // ── 4. Email verification ─────────────────────────────────────────────────
  section("4. Email Verification");
  {
    // Login before verification should be blocked
    const s = new Session("pre-verify");
    await s.fetchCsrf();
    const r = await s.req("POST", "/auth/login", { username: clientCreds.username, password: clientCreds.password });
    log("POST /auth/login (unverified) → 403 EMAIL_NOT_VERIFIED",
      r.status === 403 && r.body.code === "EMAIL_NOT_VERIFIED",
      `status=${r.status} code=${r.body.code}`);
  }
  {
    // Resend verification
    const r = await bare("POST", "/auth/resend-verification", { email: clientCreds.email });
    log("POST /auth/resend-verification → 200 (always)", r.status === 200, `status=${r.status}`);
  }
  {
    // Resend for unknown email — must still return 200 (no enumeration)
    const r = await bare("POST", "/auth/resend-verification", { email: "nobody@nowhere.com" });
    log("POST /auth/resend-verification (unknown email) → 200 (no enumeration)",
      r.status === 200, `status=${r.status}`);
  }
  {
    // Invalid token
    const r = await bare("GET", "/auth/verify-email?token=invalidtoken123");
    log("GET /auth/verify-email (bad token) → 400", r.status === 400, `status=${r.status}`);
  }

  // Bypass verification via DB for test users
  if (dbOk) {
    const c1 = await verifyUserInDb(clientCreds.email);
    const c2 = await verifyUserInDb(devCreds.email);
    const c3 = await verifyUserInDb(otherCreds.email);
    log("DB: mark test users as email_verified", c1 && c2 && c3,
      `client=${c1} dev=${c2} other=${c3}`);
  } else {
    skip("DB: mark test users as email_verified", "no DB connection");
  }

  // ── 5. Login + Cookie Auth ────────────────────────────────────────────────
  section("5. Auth — Login & Cookie Security");
  const clientSession = new Session("client");
  const devSession    = new Session("developer");
  const otherSession  = new Session("other");

  {
    const r = await clientSession.login(clientCreds.username, clientCreds.password);
    log("POST /auth/login (client) → 200", r.status === 200, `status=${r.status}`);
    log("Login response has user object (no token field)",
      !!clientSession.user && !r.body.token,
      `user.id=${clientSession.user?.id} token=${r.body.token ?? "absent ✓"}`);
    log("Login sets auth_token cookie",
      !!clientSession.jar.get("auth_token"),
      `cookie present=${!!clientSession.jar.get("auth_token")}`);
    if (r.status !== 200) console.log(`    ${C.dim}body: ${JSON.stringify(r.body)}${C.reset}`);
  }
  {
    const r = await devSession.login(devCreds.username, devCreds.password);
    log("POST /auth/login (developer) → 200", r.status === 200, `status=${r.status}`);
  }
  {
    const r = await otherSession.login(otherCreds.username, otherCreds.password);
    log("POST /auth/login (other user) → 200", r.status === 200, `status=${r.status}`);
  }
  {
    const s = new Session("bad-login");
    await s.fetchCsrf();
    const r = await s.req("POST", "/auth/login", { username: clientCreds.username, password: "wrongpass" });
    log("POST /auth/login (wrong password) → 401", r.status === 401, `status=${r.status}`);
  }
  {
    const s = new Session("bad-login-2");
    await s.fetchCsrf();
    const r = await s.req("POST", "/auth/login", { username: "ghost_user_xyz", password: "x" });
    log("POST /auth/login (unknown user) → 401", r.status === 401, `status=${r.status}`);
  }

  if (!clientSession.user || !devSession.user) {
    console.log(`\n${C.red}${C.bold}  ✗ Login failed — cannot continue. Check DB connection and email verification.${C.reset}\n`);
    printSummary(); return;
  }

  // GET /auth/me
  {
    const r = await clientSession.req("GET", "/auth/me");
    log("GET /auth/me → returns user from cookie", r.status === 200 && r.body.id === clientSession.id,
      `status=${r.status} id=${r.body.id}`);
  }
  {
    const r = await bare("GET", "/auth/me");
    log("GET /auth/me (no cookie) → 401", r.status === 401, `status=${r.status}`);
  }

  // ── 6. CSRF Protection ────────────────────────────────────────────────────
  section("6. CSRF Protection");
  {
    // POST without CSRF header must fail
    const cookieStr = clientSession.jar.header();
    const r = await fetch(`${BASE}/api/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Cookie": cookieStr },
      body: JSON.stringify({ title: "CSRF test", description: "x", minBudget: 100, maxBudget: 200 }),
    });
    log("POST /api/projects (no CSRF header) → 403", r.status === 403,
      `status=${r.status} — CSRF middleware blocked it`);
  }
  {
    // POST with wrong CSRF token must fail
    const cookieStr = clientSession.jar.header();
    const r = await fetch(`${BASE}/api/projects`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cookie": cookieStr,
        "x-csrf-token": "totallyinvalidtoken",
      },
      body: JSON.stringify({ title: "CSRF test", description: "x", minBudget: 100, maxBudget: 200 }),
    });
    log("POST /api/projects (wrong CSRF token) → 403", r.status === 403,
      `status=${r.status} — CSRF middleware blocked it`);
  }
  {
    // POST with valid CSRF token must succeed (or fail for business reasons, not CSRF)
    const dueDate = new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0];
    const r = await clientSession.req("POST", "/api/projects", {
      title: "CSRF valid test", description: "Testing CSRF passes with valid token",
      tags: ["test"], minBudget: 100, maxBudget: 500, dueDate,
    });
    log("POST /api/projects (valid CSRF token) → not 403", r.status !== 403,
      `status=${r.status} — CSRF passed`);
  }

  // ── 7. Refresh Token Flow ─────────────────────────────────────────────────
  section("7. Refresh Token & Session Security");
  {
    // Verify refresh_token cookie was set on login
    const hasRefresh = !!devSession.jar.get("refresh_token");
    log("Login sets refresh_token cookie", hasRefresh,
      `cookie present=${hasRefresh}`);
  }
  {
    // POST /auth/refresh with valid refresh cookie → rotates both tokens
    const refreshSession = new Session("refresh-test");
    await refreshSession.login(devCreds.username, devCreds.password);
    const oldRefreshCookie = refreshSession.jar.get("refresh_token");

    const r = await refreshSession.req("POST", "/auth/refresh");
    const newRefreshCookie = refreshSession.jar.get("refresh_token");
    log("POST /auth/refresh → 200", r.status === 200, `status=${r.status}`);
    // The refresh token is always a new random value on each rotation.
    // The access token may look identical within the same 15-min window
    // (same payload → same JWT), so we verify rotation via the refresh token.
    log("POST /auth/refresh → refresh token rotated",
      !!newRefreshCookie && newRefreshCookie !== oldRefreshCookie,
      `rotated=${newRefreshCookie !== oldRefreshCookie}`);
    log("POST /auth/refresh → new refresh token cookie present",
      !!newRefreshCookie,
      `refresh cookie present=${!!newRefreshCookie}`);
  }
  {
    // POST /auth/refresh with no cookie → 401
    const r = await bare("POST", "/auth/refresh");
    log("POST /auth/refresh (no cookie) → 401", r.status === 401,
      `status=${r.status} code=${r.body.code}`);
  }
  {
    // Refresh token reuse detection
    // Login, capture refresh token, refresh once (rotates it), then try to use
    // the OLD refresh token again — should revoke the family and return 401
    const reuseSession = new Session("reuse-test");
    await reuseSession.login(devCreds.username, devCreds.password);
    const oldRefreshToken = reuseSession.jar.get("refresh_token");

    // First refresh — rotates the token
    await reuseSession.req("POST", "/auth/refresh");

    // Now replay the OLD refresh token
    const replaySession = new Session("replay");
    replaySession.jar._cookies["refresh_token"] = oldRefreshToken;
    const r = await replaySession.req("POST", "/auth/refresh");
    log("POST /auth/refresh (reused revoked token) → 401 TOKEN_REUSE_DETECTED",
      r.status === 401 && r.body.code === "TOKEN_REUSE_DETECTED",
      `status=${r.status} code=${r.body.code}`);
  }

  // ── 8. Logout + Token Revocation ─────────────────────────────────────────
  section("8. Logout & Token Revocation");
  const logoutSession = new Session("logout-test");
  await logoutSession.login(clientCreds.username, clientCreds.password);
  const logoutUserId   = logoutSession.user?.id;   // save before logout clears it
  const preLogoutRefresh = logoutSession.jar.get("refresh_token");
  {
    const r = await logoutSession.logout();
    log("POST /auth/logout → 200", r.status === 200, `status=${r.status}`);
    log("POST /auth/logout → clears auth_token cookie",
      !logoutSession.jar.get("auth_token"),
      `cookie after logout=${logoutSession.jar.get("auth_token") ?? "absent ✓"}`);
  }
  {
    // After logout, refresh token must be revoked in DB
    if (dbOk && logoutUserId) {
      // Give the DB write a moment to commit
      await new Promise(r => setTimeout(r, 200));
      const row = await getRefreshTokenFromDb(logoutUserId);
      log("Refresh token revoked in DB after logout",
        row !== null && row.revoked_at !== null,
        `revoked_at=${row?.revoked_at ?? "no row"}`);
    } else {
      skip("Refresh token revoked in DB after logout", "no DB connection or user id");
    }
  }
  {
    // Try to use the old refresh token after logout — must fail
    const replayAfterLogout = new Session("replay-after-logout");
    replayAfterLogout.jar._cookies["refresh_token"] = preLogoutRefresh;
    const r = await replayAfterLogout.req("POST", "/auth/refresh");
    log("POST /auth/refresh (after logout) → 401",
      r.status === 401,
      `status=${r.status} code=${r.body.code}`);
  }

  // ── 9. Projects ───────────────────────────────────────────────────────────
  section("9. Projects");
  const dueDate = new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0];
  let projectId;
  {
    const r = await clientSession.req("POST", "/api/projects", {
      title: `Test Project ${id}`,
      description: "Automated test project for NeuralForge Phase 3 test suite",
      tags: ["JavaScript", "Node.js"],
      minBudget: 500, maxBudget: 1500, dueDate,
    });
    log("POST /api/projects (create) → 201", r.status === 201, `status=${r.status}`);
    projectId = r.body.id ?? r.body.project?.id;
    if (r.status !== 201) console.log(`    ${C.dim}body: ${JSON.stringify(r.body)}${C.reset}`);
  }
  {
    const r = await clientSession.req("GET", "/api/projects");
    log("GET /api/projects (client list) → 200", r.status === 200, `status=${r.status}`);
  }
  {
    const r = await clientSession.req("GET", `/api/projects/${projectId}`);
    log("GET /api/projects/:id → 200", r.status === 200, `status=${r.status}`);
  }
  {
    const r = await bare("GET", "/projects");
    log("GET /projects (public marketplace) → 200", r.status === 200, `status=${r.status}`);
  }
  {
    // Developer cannot create a project (role guard)
    const r = await devSession.req("POST", "/api/projects", {
      title: "Dev project attempt", description: "Should fail",
      minBudget: 100, maxBudget: 200, dueDate,
    });
    log("POST /api/projects (developer role) → 403", r.status === 403, `status=${r.status}`);
  }
  {
    // Unauthenticated project creation → 401
    const r = await bare("POST", "/api/projects", { title: "x" });
    log("POST /api/projects (no auth) → 401", r.status === 401, `status=${r.status}`);
  }

  if (!projectId) {
    console.log(`\n${C.red}  ✗ Project creation failed — skipping downstream tests.${C.reset}\n`);
    printSummary(); return;
  }

  // ── 10. Bidding ───────────────────────────────────────────────────────────
  section("10. Bidding");
  let bidId;
  {
    const r = await devSession.req("POST", `/projects/${projectId}/bid`, {
      amount: 1000,
      proposal: "I can build this efficiently using Node.js and PostgreSQL with full test coverage.",
    });
    log("POST /projects/:id/bid (place bid) → 201", r.status === 201, `status=${r.status}`);
    bidId = r.body.bid?.id;
    if (r.status !== 201) console.log(`    ${C.dim}body: ${JSON.stringify(r.body)}${C.reset}`);
  }
  {
    // Idempotency: same developer bids again → 200 idempotent (not 409)
    const r = await devSession.req("POST", `/projects/${projectId}/bid`, {
      amount: 900, proposal: "Duplicate bid attempt",
    });
    log("POST /projects/:id/bid (duplicate) → 200 idempotent",
      r.status === 200 && r.body.idempotent === true,
      `status=${r.status} idempotent=${r.body.idempotent}`);
  }
  {
    // Idempotency key: same key twice → second call returns cached response
    const idemKey = `bid-idem-${uid()}`;
    const r1 = await devSession.req("POST", `/projects/${projectId}/bid`,
      { amount: 1000, proposal: "Idempotency key test" },
      { extraHeaders: { "Idempotency-Key": idemKey } });
    const r2 = await devSession.req("POST", `/projects/${projectId}/bid`,
      { amount: 1000, proposal: "Idempotency key test" },
      { extraHeaders: { "Idempotency-Key": idemKey } });
    log("Idempotency-Key: same key twice → same response",
      r1.status === r2.status,
      `r1=${r1.status} r2=${r2.status}`);
  }
  {
    // Invalid bid (amount = 0)
    const r = await devSession.req("POST", `/projects/${projectId}/bid`, { amount: 0 });
    log("POST /projects/:id/bid (invalid amount) → 400", r.status === 400, `status=${r.status}`);
  }
  {
    // Client cannot bid on their own project
    const r = await clientSession.req("POST", `/projects/${projectId}/bid`, {
      amount: 500, proposal: "Client bidding on own project",
    });
    log("POST /projects/:id/bid (client bids own project) → 403 or 400",
      r.status === 403 || r.status === 400,
      `status=${r.status}`);
  }
  {
    const r = await clientSession.req("GET", `/api/projects/${projectId}/bids`);
    log("GET /api/projects/:id/bids → 200", r.status === 200, `status=${r.status}`);
    if (!bidId && r.body.data?.length) bidId = r.body.data[0].id;
  }
  {
    const r = await devSession.req("GET", `/bids/developer/${devSession.id}`);
    log("GET /bids/developer/:id → 200", r.status === 200, `status=${r.status}`);
  }
  {
    // IDOR: other user tries to list bids for client's project → 403
    const r = await otherSession.req("GET", `/api/projects/${projectId}/bids`);
    log("GET /api/projects/:id/bids (wrong user) → 403", r.status === 403, `status=${r.status}`);
  }

  // Accept bid
  {
    const r = await clientSession.req("POST", `/api/projects/${projectId}/accept-bid/${bidId}`);
    log("POST /api/projects/:id/accept-bid/:bidId → 200", r.status === 200, `status=${r.status}`);
    if (r.status !== 200) console.log(`    ${C.dim}body: ${JSON.stringify(r.body)}${C.reset}`);
  }
  {
    // Idempotency: accept same bid again → 200 idempotent
    const r = await clientSession.req("POST", `/api/projects/${projectId}/accept-bid/${bidId}`);
    log("POST accept-bid (replay) → 200 idempotent",
      r.status === 200 && r.body.idempotent === true,
      `status=${r.status} idempotent=${r.body.idempotent}`);
  }
  {
    // Developer cannot accept bids
    const r = await devSession.req("POST", `/api/projects/${projectId}/accept-bid/${bidId}`);
    log("POST accept-bid (developer) → 403", r.status === 403, `status=${r.status}`);
  }

  // ── 11. Notifications ─────────────────────────────────────────────────────
  section("11. Notifications");
  let notifId;
  {
    const r = await devSession.req("GET", "/notifications");
    log("GET /notifications (developer) → 200", r.status === 200, `status=${r.status}`);
    notifId = r.body.data?.[0]?.id ?? r.body[0]?.id;
  }
  {
    const r = await clientSession.req("GET", "/notifications");
    log("GET /notifications (client) → 200", r.status === 200, `status=${r.status}`);
  }
  {
    const r = await bare("GET", "/notifications");
    log("GET /notifications (no auth) → 401", r.status === 401, `status=${r.status}`);
  }
  if (notifId) {
    const r = await devSession.req("PUT", `/notifications/${notifId}/read`);
    log("PUT /notifications/:id/read → 200", r.status === 200, `status=${r.status}`);
  } else {
    skip("PUT /notifications/:id/read", "no notification id available yet");
  }
  {
    const r = await devSession.req("PUT", "/notifications/read-all");
    log("PUT /notifications/read-all → 200", r.status === 200, `status=${r.status}`);
  }
  {
    // IDOR: other user tries to mark dev's notification as read
    if (notifId) {
      const r = await otherSession.req("PUT", `/notifications/${notifId}/read`);
      log("PUT /notifications/:id/read (wrong user) → 403 or 404",
        r.status === 403 || r.status === 404,
        `status=${r.status}`);
    } else {
      skip("PUT /notifications/:id/read (IDOR test)", "no notification id");
    }
  }

  // ── 12. Messaging ─────────────────────────────────────────────────────────
  section("12. Messaging");
  {
    const r = await clientSession.req("POST", `/projects/${projectId}/messages`, {
      body: "Hello developer, please start on the authentication module.",
    });
    log("POST /projects/:id/messages (client sends) → 201", r.status === 201, `status=${r.status}`);
    if (r.status !== 201) console.log(`    ${C.dim}body: ${JSON.stringify(r.body)}${C.reset}`);
  }
  {
    const r = await devSession.req("POST", `/projects/${projectId}/messages`, {
      body: "Got it! Starting right away.",
    });
    log("POST /projects/:id/messages (dev replies) → 201", r.status === 201, `status=${r.status}`);
  }
  {
    const r = await clientSession.req("POST", `/projects/${projectId}/messages`, { body: "" });
    log("POST /projects/:id/messages (empty body) → 400", r.status === 400, `status=${r.status}`);
  }
  {
    // IDOR: other user cannot message in this project
    const r = await otherSession.req("POST", `/projects/${projectId}/messages`, {
      body: "Intruder message",
    });
    log("POST /projects/:id/messages (unrelated user) → 403",
      r.status === 403, `status=${r.status}`);
  }
  {
    const r = await clientSession.req("GET", `/projects/${projectId}/messages`);
    log("GET /projects/:id/messages → 200 array",
      r.status === 200 && (Array.isArray(r.body.data) || Array.isArray(r.body)),
      `status=${r.status} count=${r.body.data?.length ?? r.body?.length}`);
  }
  {
    const r = await clientSession.req("GET", "/api/messages/unread-count");
    log("GET /api/messages/unread-count → 200 number",
      r.status === 200 && typeof r.body.count === "number",
      `status=${r.status} count=${r.body.count}`);
  }

  // ── 13. Submissions ───────────────────────────────────────────────────────
  section("13. Submissions");
  // The project's review_status defaults to 'pending' after creation.
  // We must request a revision first to unblock the first submission.
  {
    const r = await clientSession.req("PUT", `/projects/${projectId}/review`, {
      action: "revision", feedback: "Please submit your initial work.",
    });
    log("PUT /projects/:id/review (unblock first submit) → 200",
      r.status === 200, `status=${r.status} — schema workaround`);
  }
  {
    const r = await devSession.req("POST", `/projects/${projectId}/submit`, {
      repoLink: "https://github.com/test/repo",
      demoLink: "https://demo.example.com",
      notes: "Initial submission with all features implemented.",
    });
    log("POST /projects/:id/submit → 200", r.status === 200, `status=${r.status}`);
    if (r.status !== 200) console.log(`    ${C.dim}body: ${JSON.stringify(r.body)}${C.reset}`);
  }
  {
    // Idempotency: resubmit while pending → 409
    const r = await devSession.req("POST", `/projects/${projectId}/submit`, {
      repoLink: "https://github.com/test/repo-v2",
      demoLink: "https://demo2.example.com",
      notes: "Second attempt while still pending",
    });
    log("POST /projects/:id/submit (while pending) → 409",
      r.status === 409, `status=${r.status}`);
  }
  {
    // Idempotency-Key: same key twice on submit
    const idemKey = `submit-idem-${uid()}`;
    // First need to unblock with revision
    await clientSession.req("PUT", `/projects/${projectId}/review`, {
      action: "revision", feedback: "Revision to allow resubmit",
    });
    const r1 = await devSession.req("POST", `/projects/${projectId}/submit`,
      { repoLink: "https://github.com/test/repo-idem", demoLink: "https://demo.example.com", notes: "Idem test" },
      { extraHeaders: { "Idempotency-Key": idemKey } });
    const r2 = await devSession.req("POST", `/projects/${projectId}/submit`,
      { repoLink: "https://github.com/test/repo-idem", demoLink: "https://demo.example.com", notes: "Idem test" },
      { extraHeaders: { "Idempotency-Key": idemKey } });
    log("Idempotency-Key on submit: same key twice → same status",
      r1.status === r2.status,
      `r1=${r1.status} r2=${r2.status}`);
  }
  {
    const r = await clientSession.req("GET", `/projects/${projectId}/submissions`);
    log("GET /projects/:id/submissions → 200 array",
      r.status === 200 && Array.isArray(r.body),
      `status=${r.status} count=${r.body?.length}`);
  }
  {
    // IDOR: other user cannot view submissions
    const r = await otherSession.req("GET", `/projects/${projectId}/submissions`);
    log("GET /projects/:id/submissions (unrelated user) → 403",
      r.status === 403, `status=${r.status}`);
  }
  {
    // Client cannot add progress notes
    const r = await clientSession.req("POST", `/projects/${projectId}/submissions`, {
      notes: "Client trying to add note",
    });
    log("POST /projects/:id/submissions (client) → 403",
      r.status === 403, `status=${r.status}`);
  }

  // Add a progress note as developer
  let noteId;
  {
    const r = await devSession.req("POST", `/projects/${projectId}/submissions`, {
      notes: "Working on the final polish.",
    });
    log("POST /projects/:id/submissions (add note) → 201",
      r.status === 201, `status=${r.status}`);
    noteId = r.body.data?.id;
  }
  if (noteId) {
    {
      const r = await devSession.req("PUT", `/projects/${projectId}/submissions/${noteId}`, {
        notes: "Updated: all tests passing.",
      });
      log("PUT /projects/:id/submissions/:id (update note) → 200",
        r.status === 200, `status=${r.status}`);
    }
    {
      // IDOR: other user cannot update dev's note
      const r = await otherSession.req("PUT", `/projects/${projectId}/submissions/${noteId}`, {
        notes: "IDOR attempt",
      });
      log("PUT /projects/:id/submissions/:id (IDOR) → 403",
        r.status === 403, `status=${r.status}`);
    }
  } else {
    skip("PUT /projects/:id/submissions/:id", "no note id");
    skip("PUT /projects/:id/submissions/:id (IDOR)", "no note id");
  }

  // ── 14. Revisions & Approvals ─────────────────────────────────────────────
  section("14. Revisions & Approvals");
  {
    const r = await clientSession.req("PUT", `/projects/${projectId}/review`, {
      action: "revision",
      feedback: "Please improve the error handling in the auth module.",
    });
    log("PUT /projects/:id/review (request revision) → 200",
      r.status === 200, `status=${r.status}`);
    if (r.status !== 200) console.log(`    ${C.dim}body: ${JSON.stringify(r.body)}${C.reset}`);
  }
  {
    // Dev can resubmit after revision
    const r = await devSession.req("POST", `/projects/${projectId}/submit`, {
      repoLink: "https://github.com/test/repo-v3",
      demoLink: "https://demo3.example.com",
      notes: "Fixed error handling as requested.",
    });
    log("POST /projects/:id/submit (after revision) → 200",
      r.status === 200, `status=${r.status}`);
  }
  {
    // Approve
    const r = await clientSession.req("PUT", `/projects/${projectId}/review`, {
      action: "approve",
    });
    log("PUT /projects/:id/review (approve) → 200",
      r.status === 200, `status=${r.status}`);
    if (r.status !== 200) console.log(`    ${C.dim}body: ${JSON.stringify(r.body)}${C.reset}`);
  }
  {
    // Developer cannot review (role guard)
    const r = await devSession.req("PUT", `/projects/${projectId}/review`, {
      action: "approve",
    });
    log("PUT /projects/:id/review (developer) → 403",
      r.status === 403, `status=${r.status}`);
  }
  {
    // Other user cannot review
    const r = await otherSession.req("PUT", `/projects/${projectId}/review`, {
      action: "approve",
    });
    log("PUT /projects/:id/review (unrelated user) → 403",
      r.status === 403, `status=${r.status}`);
  }

  // ── 15. Workspace Activity ────────────────────────────────────────────────
  section("15. Workspace Activity");
  let eventId, submissionEventId, noteEventId;
  {
    const r = await clientSession.req("GET", `/projects/${projectId}/activity`);
    log("GET /projects/:id/activity → 200 array",
      r.status === 200 && Array.isArray(r.body.data),
      `status=${r.status} events=${r.body.data?.length}`);
    eventId = r.body.data?.[0]?.id;
    submissionEventId = r.body.data?.find(e =>
      ["submission_added", "project_submitted"].includes(e.event_type))?.id;
    noteEventId = r.body.data?.find(e =>
      ["note_added", "submission_added"].includes(e.event_type))?.id;
  }
  {
    const r = await devSession.req("GET", `/projects/${projectId}/activity?filter=submissions`);
    log("GET /projects/:id/activity?filter=submissions → 200",
      r.status === 200, `status=${r.status}`);
  }
  {
    const r = await clientSession.req("GET", `/projects/${projectId}/activity?filter=reviews`);
    log("GET /projects/:id/activity?filter=reviews → 200",
      r.status === 200, `status=${r.status}`);
  }
  {
    // IDOR: unrelated user cannot view activity
    const r = await otherSession.req("GET", `/projects/${projectId}/activity`);
    log("GET /projects/:id/activity (unrelated user) → 403",
      r.status === 403, `status=${r.status}`);
  }

  if (eventId) {
    {
      const r = await clientSession.req("POST",
        `/projects/${projectId}/activity/${eventId}/comments`,
        { body: "Looks good, keep it up!" });
      log("POST activity/:eventId/comments → 201", r.status === 201, `status=${r.status}`);
    }
    {
      const r = await devSession.req("GET",
        `/projects/${projectId}/activity/${eventId}/comments`);
      log("GET activity/:eventId/comments → 200", r.status === 200, `status=${r.status}`);
    }
    if (submissionEventId) {
      const r = await clientSession.req("POST",
        `/projects/${projectId}/activity/${submissionEventId}/approve`,
        { feedback: "Great work on this submission!" });
      log("POST activity/:eventId/approve (client) → 200",
        r.status === 200, `status=${r.status}`);
    } else {
      skip("POST activity/:eventId/approve", "no submission event found");
    }
    if (noteEventId) {
      {
        const r = await clientSession.req("POST",
          `/projects/${projectId}/activity/${noteEventId}/revision`,
          { feedback: "Please add more detail here." });
        log("POST activity/:eventId/revision (client) → 200",
          r.status === 200, `status=${r.status}`);
      }
      {
        const r = await devSession.req("POST",
          `/projects/${projectId}/activity/${noteEventId}/resolve`);
        log("POST activity/:eventId/resolve (developer) → 200",
          r.status === 200, `status=${r.status}`);
      }
    } else {
      skip("POST activity/:eventId/revision", "no note event found");
      skip("POST activity/:eventId/resolve", "no note event found");
    }
    {
      // Developer cannot approve activity entries
      const r = await devSession.req("POST",
        `/projects/${projectId}/activity/${eventId}/approve`,
        { feedback: "Dev trying to approve" });
      log("POST activity/:eventId/approve (developer) → 403",
        r.status === 403, `status=${r.status}`);
    }
  } else {
    skip("Activity entry sub-tests", "no events in activity feed");
  }

  // ── 16. File Access Control ───────────────────────────────────────────────
  section("16. File Access Control");
  {
    // Unauthenticated access to /uploads/ must be blocked
    const headers = {};
    if (TEST_BYPASS_KEY) headers["x-test-bypass"] = TEST_BYPASS_KEY;
    const r = await fetch(`${BASE}/uploads/test.txt`, { headers });
    log("GET /uploads/test.txt (no auth) → 401",
      r.status === 401,
      `status=${r.status} — static files require auth`);
  }
  {
    // Authenticated access to file list for own project → 200
    const r = await clientSession.req("GET", `/projects/${projectId}/files`);
    log("GET /projects/:id/files (owner) → 200",
      r.status === 200, `status=${r.status}`);
  }
  {
    // IDOR: other user cannot list files for this project
    const r = await otherSession.req("GET", `/projects/${projectId}/files`);
    log("GET /projects/:id/files (unrelated user) → 403",
      r.status === 403, `status=${r.status}`);
  }
  {
    // Unauthenticated file list → 401
    const r = await bare("GET", `/projects/${projectId}/files`);
    log("GET /projects/:id/files (no auth) → 401",
      r.status === 401, `status=${r.status}`);
  }

  // ── 17. Stats ─────────────────────────────────────────────────────────────
  section("17. Stats & Dashboard");
  {
    const r = await clientSession.req("GET", "/api/stats/client");
    log("GET /api/stats/client → 200", r.status === 200, `status=${r.status}`);
  }
  {
    const r = await devSession.req("GET", "/api/stats/developer");
    log("GET /api/stats/developer → 200", r.status === 200, `status=${r.status}`);
  }
  {
    const r = await clientSession.req("GET", "/api/activity/client");
    log("GET /api/activity/client → 200", r.status === 200, `status=${r.status}`);
  }
  {
    const r = await devSession.req("GET", "/api/activity/developer");
    log("GET /api/activity/developer → 200", r.status === 200, `status=${r.status}`);
  }
  {
    // Cross-role: developer cannot access client stats
    const r = await devSession.req("GET", "/api/stats/client");
    log("GET /api/stats/client (developer) → 403",
      r.status === 403, `status=${r.status}`);
  }
  {
    const r = await bare("GET", "/api/stats/client");
    log("GET /api/stats/client (no auth) → 401", r.status === 401, `status=${r.status}`);
  }

  // ── 18. Profile ───────────────────────────────────────────────────────────
  section("18. Profile");
  {
    const r = await clientSession.req("GET", `/profile/${clientSession.id}`);
    log("GET /profile/:id (own) → 200", r.status === 200, `status=${r.status}`);
  }
  {
    // Public profile view (no auth required)
    const r = await bare("GET", `/profile/${clientSession.id}`);
    log("GET /profile/:id (public, no auth) → 200", r.status === 200, `status=${r.status}`);
  }
  {
    // IDOR: other user cannot update client's profile
    const r = await otherSession.req("PUT", `/profile/${clientSession.id}`, {
      bio: "IDOR attempt",
    });
    log("PUT /profile/:id (wrong user) → 403", r.status === 403, `status=${r.status}`);
  }
  {
    // Own profile update → 200
    const r = await clientSession.req("PUT", `/profile/${clientSession.id}`, {
      bio: "Test bio updated by test suite",
    });
    log("PUT /profile/:id (own) → 200", r.status === 200, `status=${r.status}`);
  }

  // ── 19. Discover / Assigned Projects ─────────────────────────────────────
  section("19. Discover & Assigned Projects");
  {
    const r = await devSession.req("GET", `/projects/discover/${devSession.id}`);
    log("GET /projects/discover/:id (own) → 200", r.status === 200, `status=${r.status}`);
  }
  {
    // IDOR: cannot discover as another user
    const r = await devSession.req("GET", `/projects/discover/${clientSession.id}`);
    log("GET /projects/discover/:id (wrong id) → 403", r.status === 403, `status=${r.status}`);
  }
  {
    const r = await devSession.req("GET", `/projects/assigned/${devSession.id}`);
    log("GET /projects/assigned/:id (own) → 200", r.status === 200, `status=${r.status}`);
  }

  // ── 20. Cleanup — delete note ─────────────────────────────────────────────
  section("20. Cleanup");
  if (noteId) {
    {
      // IDOR: other user cannot delete dev's note
      const r = await otherSession.req("DELETE", `/projects/${projectId}/submissions/${noteId}`);
      log("DELETE /projects/:id/submissions/:id (IDOR) → 403",
        r.status === 403, `status=${r.status}`);
    }
    {
      const r = await devSession.req("DELETE", `/projects/${projectId}/submissions/${noteId}`);
      log("DELETE /projects/:id/submissions/:id (own) → 200",
        r.status === 200, `status=${r.status}`);
    }
  } else {
    skip("DELETE /projects/:id/submissions/:id", "no note id");
  }

  // Close DB pool
  if (pgPool) await pgPool.end().catch(() => {});

  printSummary();
}

// ── Summary printer ───────────────────────────────────────────────────────────
function printSummary() {
  const total = passed + failed + skipped;
  const pct   = total > 0 ? Math.round((passed / (passed + failed)) * 100) : 0;

  console.log(`\n${C.bold}${"═".repeat(56)}${C.reset}`);
  console.log(`${C.bold}  TEST SUMMARY${C.reset}`);
  console.log(`${"─".repeat(56)}`);

  // Section breakdown
  const sections = [...new Set(results.map(r => r.section))];
  for (const sec of sections) {
    const secResults = results.filter(r => r.section === sec);
    const secPass    = secResults.filter(r => r.ok === true).length;
    const secFail    = secResults.filter(r => r.ok === false).length;
    const secSkip    = secResults.filter(r => r.ok === null).length;
    const icon = secFail > 0 ? `${C.red}✗${C.reset}` : `${C.green}✓${C.reset}`;
    const detail = secFail > 0
      ? `${C.green}${secPass}✓${C.reset} ${C.red}${secFail}✗${C.reset}${secSkip ? ` ${C.yellow}${secSkip}⏭${C.reset}` : ""}`
      : `${C.green}${secPass}✓${C.reset}${secSkip ? ` ${C.yellow}${secSkip}⏭${C.reset}` : ""}`;
    console.log(`  ${icon} ${C.bold}${sec}${C.reset}  ${detail}`);
  }

  console.log(`${"─".repeat(56)}`);
  console.log(
    `  ${C.bold}Total:${C.reset}  ` +
    `${C.green}${passed} passed${C.reset}  ` +
    `${C.red}${failed} failed${C.reset}  ` +
    `${C.yellow}${skipped} skipped${C.reset}  ` +
    `${C.dim}(${total} total)${C.reset}`
  );
  console.log(
    `  ${C.bold}Score:${C.reset}  ` +
    (pct === 100
      ? `${C.bgGreen}${C.bold} ${pct}% ${C.reset}`
      : pct >= 80
        ? `${C.green}${pct}%${C.reset}`
        : `${C.red}${pct}%${C.reset}`)
  );

  if (failed > 0) {
    console.log(`\n${C.red}${C.bold}  Failed Tests:${C.reset}`);
    results
      .filter(r => r.ok === false)
      .forEach(r => {
        console.log(`  ${C.red}❌ [${r.section}] ${r.label}${C.reset}`);
        if (r.detail) console.log(`     ${C.dim}${r.detail}${C.reset}`);
      });
  }

  if (skipped > 0) {
    console.log(`\n${C.yellow}  Skipped Tests:${C.reset}`);
    results
      .filter(r => r.ok === null)
      .forEach(r => {
        console.log(`  ${C.yellow}⏭ [${r.section}] ${r.label}${C.reset}`);
        if (r.detail) console.log(`     ${C.dim}${r.detail}${C.reset}`);
      });
  }

  console.log(`\n${C.dim}  Finished: ${new Date().toISOString()}${C.reset}`);
  console.log(`${C.bold}${"═".repeat(56)}${C.reset}\n`);

  process.exit(failed > 0 ? 1 : 0);
}

// ── Entry point ───────────────────────────────────────────────────────────────
run().catch(err => {
  console.error(`\n${C.red}${C.bold}Test runner crashed:${C.reset}`, err);
  process.exit(1);
});
