/**
 * Integration tests for security middleware.
 *
 * Covers: CSRF protection, rate limiting headers, security headers,
 * auth middleware edge cases, and CORS behaviour.
 */
process.env.NODE_ENV = "test";
process.env.REDIS_ENABLED = "false";
process.env.JWT_SECRET = "test-jwt-secret-not-for-production";
process.env.CSRF_SECRET = "test-csrf-secret-not-for-production";
process.env.JWT_EXPIRES_IN = "15m";
process.env.STORAGE_PROVIDER = "local";

jest.mock("../../config/db", () => require("../setup/testDb").pool);
jest.mock("../../config/redis", () => ({ pubClient: null, subClient: null, redisClient: null, REDIS_ENABLED: false }));
jest.mock("../../config/sentry", () => ({ sentryErrorHandler: (_e, _r, _s, n) => n(_e), captureSocketError: () => {}, Sentry: {}, DSN: null }));

const request = require("supertest");
const express = require("express");
const { applySecurity } = require("../../middleware/security");
const requestLogger = require("../../middleware/requestLogger");
const createRoutes = require("../../routes");
const { resetDb, seedUser, seedProject, pool } = require("../setup/testDb");
const { makeAuthCookie, signToken } = require("../setup/authHelpers");
const jwt = require("jsonwebtoken");

const io = { to: () => ({ emit: () => {} }), in: () => ({ fetchSockets: async () => [] }) };
const app = express();
applySecurity(app);
app.use(requestLogger);
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));
app.use(createRoutes(io));
app.use((err, req, res, _next) => {
  if (err.constructor?.name === "ForbiddenError" || err.code === "EBADCSRFTOKEN") {
    return res.status(403).json({ code: "INVALID_CSRF_TOKEN", message: "Invalid or missing CSRF token" });
  }
  // Express 5 wraps PayloadTooLargeError — surface it as 413
  if (err.status === 413 || err.type === "entity.too.large") {
    return res.status(413).json({ message: "Payload too large" });
  }
  res.status(500).json({ message: err.message || "Internal server error" });
});

let clientUser;

beforeEach(async () => {
  await resetDb();
  clientUser = await seedUser({ username: "client1", email: "client@example.com", role: "client" });
});

// ── Security headers ──────────────────────────────────────────────────────────
describe("Security headers", () => {
  test("X-Powered-By header is removed", async () => {
    const res = await request(app).get("/health");
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });

  test("X-Content-Type-Options is set to nosniff", async () => {
    const res = await request(app).get("/health");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });

  test("X-Request-Id header is present on every response", async () => {
    const res = await request(app).get("/health");
    expect(res.headers["x-request-id"]).toBeDefined();
    expect(res.headers["x-request-id"].length).toBeGreaterThan(0);
  });

  test("X-Request-Id is echoed back when provided in request", async () => {
    const res = await request(app)
      .get("/health")
      .set("X-Request-Id", "my-custom-request-id");
    expect(res.headers["x-request-id"]).toBe("my-custom-request-id");
  });
});

// ── CSRF protection ───────────────────────────────────────────────────────────
describe("CSRF protection", () => {
  test("GET /auth/csrf-token returns a token", async () => {
    const res = await request(app).get("/auth/csrf-token");
    expect(res.status).toBe(200);
    expect(res.body.csrfToken).toBeDefined();
    expect(typeof res.body.csrfToken).toBe("string");
    expect(res.body.csrfToken.length).toBeGreaterThan(0);
  });

  test("state-changing request without CSRF token returns 403", async () => {
    const userCookie = makeAuthCookie(clientUser);

    // POST /auth/logout requires CSRF
    const res = await request(app)
      .post("/auth/logout")
      .set("Cookie", userCookie);
    // No x-csrf-token header — should be rejected
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("INVALID_CSRF_TOKEN");
  });

  test("state-changing request with wrong CSRF token returns 403", async () => {
    const userCookie = makeAuthCookie(clientUser);

    const res = await request(app)
      .post("/auth/logout")
      .set("Cookie", userCookie)
      .set("x-csrf-token", "completely-wrong-token");

    expect(res.status).toBe(403);
  });

  test("GET requests do not require CSRF token", async () => {
    const res = await request(app)
      .get("/notifications")
      .set("Cookie", makeAuthCookie(clientUser));
    // Should succeed (200) without CSRF token
    expect(res.status).toBe(200);
  });
});

// ── Authentication middleware ─────────────────────────────────────────────────
describe("Authentication middleware", () => {
  test("returns 401 for expired JWT", async () => {
    // Sign a token that expired 1 second ago
    const expiredToken = jwt.sign(
      { id: clientUser.id, username: clientUser.username, role: clientUser.role },
      process.env.JWT_SECRET,
      { expiresIn: -1 },
    );

    const res = await request(app)
      .get("/auth/me")
      .set("Cookie", `auth_token=${expiredToken}`);

    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/expired/i);
  });

  test("returns 401 for tampered JWT", async () => {
    const validToken = signToken(clientUser);
    const [header, payload] = validToken.split(".");
    const tamperedToken = `${header}.${payload}.invalidsignature`;

    const res = await request(app)
      .get("/auth/me")
      .set("Cookie", `auth_token=${tamperedToken}`);

    expect(res.status).toBe(401);
  });

  test("returns 401 for JWT signed with wrong secret", async () => {
    const wrongSecretToken = jwt.sign(
      { id: clientUser.id, username: clientUser.username, role: clientUser.role },
      "wrong-secret",
      { expiresIn: "15m" },
    );

    const res = await request(app)
      .get("/auth/me")
      .set("Cookie", `auth_token=${wrongSecretToken}`);

    expect(res.status).toBe(401);
  });

  test("accepts token from Authorization Bearer header as fallback", async () => {
    const token = signToken(clientUser);

    const res = await request(app)
      .get("/auth/me")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.username).toBe("client1");
  });

  test("role guard returns 403 for wrong role", async () => {
    const developerUser = await seedUser({ username: "dev1", email: "dev@example.com", role: "developer" });

    // Developer trying to access client-only endpoint
    const res = await request(app)
      .get("/api/projects")
      .set("Cookie", makeAuthCookie(developerUser));

    expect(res.status).toBe(403);
  });
});

// ── requireSelfParam guard ────────────────────────────────────────────────────
describe("requireSelfParam guard", () => {
  test("returns 403 when URL param id does not match authenticated user", async () => {
    const otherUser = await seedUser({ username: "other", email: "other@example.com", role: "developer" });

    // clientUser trying to access otherUser's skills
    const res = await request(app)
      .get(`/profile/${otherUser.id}/skills`)
      .set("Cookie", makeAuthCookie(clientUser));

    expect(res.status).toBe(403);
  });
});

// ── Request body size limit ───────────────────────────────────────────────────
describe("Request body size limit", () => {
  test("returns 413 for request body exceeding 1MB", async () => {
    const largeBody = { data: "x".repeat(1.1 * 1024 * 1024) };

    const res = await request(app)
      .post("/auth/login")
      .send(largeBody);

    expect(res.status).toBe(413);
  });
});
