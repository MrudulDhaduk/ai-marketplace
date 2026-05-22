/**
 * Integration tests for authentication endpoints.
 *
 * Covers: signup, login, logout, /auth/me, email verification,
 * token refresh, and session security properties.
 */
process.env.NODE_ENV = "test";
process.env.REDIS_ENABLED = "false";
process.env.JWT_SECRET = "test-jwt-secret-not-for-production";
process.env.CSRF_SECRET = "test-csrf-secret-not-for-production";
process.env.JWT_EXPIRES_IN = "15m";
process.env.REFRESH_TOKEN_EXPIRES_DAYS = "30";
process.env.STORAGE_PROVIDER = "local";

jest.mock("../../config/db", () => require("../setup/testDb").pool);
jest.mock("../../config/redis", () => ({ pubClient: null, subClient: null, redisClient: null, REDIS_ENABLED: false }));
jest.mock("../../config/sentry", () => ({ sentryErrorHandler: (_e, _r, _s, n) => n(_e), captureSocketError: () => {}, Sentry: {}, DSN: null }));
jest.mock("../../services/emailService", () => ({ sendVerificationEmail: jest.fn().mockResolvedValue(undefined) }));

const request = require("supertest");
const express = require("express");
const { applySecurity } = require("../../middleware/security");
const requestLogger = require("../../middleware/requestLogger");
const createRoutes = require("../../routes");
const { resetDb, seedUser, pool } = require("../setup/testDb");
const { makeAuthCookie } = require("../setup/authHelpers");
const bcrypt = require("bcrypt");

// ── Build test app ────────────────────────────────────────────────────────────
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
  res.status(500).json({ message: err.message || "Internal server error" });
});

// ── Helpers ───────────────────────────────────────────────────────────────────
async function getCsrfToken(agent) {
  const res = await agent.get("/auth/csrf-token");
  const cookie = res.headers["set-cookie"]?.find((c) => c.startsWith("x-csrf-token="));
  const token = res.body.csrfToken;
  return { token, cookie };
}

async function registerAndVerify({ username = "alice", email = "alice@example.com", password = "Password1", role = "client" } = {}) {
  const hashedPassword = await bcrypt.hash(password, 4); // low rounds for test speed
  const user = await seedUser({ username, email, password: hashedPassword, role, emailVerified: true });
  return user;
}

// ── Tests ─────────────────────────────────────────────────────────────────────
beforeEach(async () => {
  await resetDb();
});

describe("POST /auth/signup", () => {
  test("creates a new user and returns 201", async () => {
    const res = await request(app)
      .post("/auth/signup")
      .send({
        firstName: "Alice",
        lastName: "Smith",
        username: "alice",
        email: "alice@example.com",
        password: "Password1",
        role: "client",
      });

    expect(res.status).toBe(201);
    expect(res.body.user.username).toBe("alice");
    expect(res.body.user.role).toBe("client");
    // Token must NOT be in the response body
    expect(res.body.token).toBeUndefined();
  });

  test("returns 409 when username is already taken", async () => {
    await registerAndVerify({ username: "alice" });

    const res = await request(app)
      .post("/auth/signup")
      .send({
        firstName: "Bob",
        lastName: "Jones",
        username: "alice",
        email: "bob@example.com",
        password: "Password1",
        role: "client",
      });

    expect(res.status).toBe(409);
    expect(res.body.field).toBe("username");
  });

  test("returns 409 when email is already registered", async () => {
    await registerAndVerify({ email: "alice@example.com" });

    const res = await request(app)
      .post("/auth/signup")
      .send({
        firstName: "Alice",
        lastName: "Two",
        username: "alice2",
        email: "alice@example.com",
        password: "Password1",
        role: "client",
      });

    expect(res.status).toBe(409);
    expect(res.body.field).toBe("email");
  });

  test("returns 400 for invalid email", async () => {
    const res = await request(app)
      .post("/auth/signup")
      .send({
        firstName: "Alice",
        lastName: "Smith",
        username: "alice3",
        email: "notanemail",
        password: "Password1",
        role: "client",
      });

    expect(res.status).toBe(400);
  });

  test("returns 400 for weak password", async () => {
    const res = await request(app)
      .post("/auth/signup")
      .send({
        firstName: "Alice",
        lastName: "Smith",
        username: "alice4",
        email: "alice4@example.com",
        password: "weak",
        role: "client",
      });

    expect(res.status).toBe(400);
  });

  test("defaults role to client for unknown roles", async () => {
    const res = await request(app)
      .post("/auth/signup")
      .send({
        firstName: "Alice",
        lastName: "Smith",
        username: "alice5",
        email: "alice5@example.com",
        password: "Password1",
        role: "admin", // should be rejected and defaulted to client
      });

    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe("client");
  });
});

describe("POST /auth/login", () => {
  test("returns 200 and sets httpOnly cookie on valid credentials", async () => {
    const password = "Password1";
    const hashedPassword = await bcrypt.hash(password, 4);
    await seedUser({ username: "alice", email: "alice@example.com", password: hashedPassword, emailVerified: true });

    const res = await request(app)
      .post("/auth/login")
      .send({ username: "alice", password });

    expect(res.status).toBe(200);
    expect(res.body.user.username).toBe("alice");
    // Token must NOT be in the response body
    expect(res.body.token).toBeUndefined();
    // httpOnly cookie must be set
    const cookies = res.headers["set-cookie"] || [];
    const authCookie = cookies.find((c) => c.startsWith("auth_token="));
    expect(authCookie).toBeDefined();
    expect(authCookie).toMatch(/HttpOnly/i);
  });

  test("returns 401 for wrong password", async () => {
    const hashedPassword = await bcrypt.hash("Password1", 4);
    await seedUser({ username: "alice", password: hashedPassword, emailVerified: true });

    const res = await request(app)
      .post("/auth/login")
      .send({ username: "alice", password: "WrongPassword1" });

    expect(res.status).toBe(401);
  });

  test("returns 401 for non-existent user", async () => {
    const res = await request(app)
      .post("/auth/login")
      .send({ username: "nobody", password: "Password1" });

    expect(res.status).toBe(401);
  });

  test("returns 403 EMAIL_NOT_VERIFIED for unverified user", async () => {
    const hashedPassword = await bcrypt.hash("Password1", 4);
    await seedUser({ username: "unverified", email: "unverified@example.com", password: hashedPassword, emailVerified: false });

    const res = await request(app)
      .post("/auth/login")
      .send({ username: "unverified", password: "Password1" });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("EMAIL_NOT_VERIFIED");
  });

  test("returns 400 for missing credentials", async () => {
    const res = await request(app)
      .post("/auth/login")
      .send({});

    expect(res.status).toBe(400);
  });
});

describe("GET /auth/me", () => {
  test("returns current user when authenticated", async () => {
    const user = await registerAndVerify({ username: "alice" });

    const res = await request(app)
      .get("/auth/me")
      .set("Cookie", makeAuthCookie(user));

    expect(res.status).toBe(200);
    expect(res.body.username).toBe("alice");
    expect(res.body.password).toBeUndefined();
  });

  test("returns 401 when not authenticated", async () => {
    const res = await request(app).get("/auth/me");
    expect(res.status).toBe(401);
  });

  test("returns 401 for invalid token", async () => {
    const res = await request(app)
      .get("/auth/me")
      .set("Cookie", "auth_token=invalid.token.here");

    expect(res.status).toBe(401);
  });
});

describe("POST /auth/logout", () => {
  test("clears auth cookies", async () => {
    const user = await registerAndVerify({ username: "alice" });
    const agent = request.agent(app);

    // Get CSRF token
    const csrfRes = await agent.get("/auth/csrf-token").set("Cookie", makeAuthCookie(user));
    const csrfToken = csrfRes.body.csrfToken;
    const csrfCookie = csrfRes.headers["set-cookie"]?.find((c) => c.startsWith("x-csrf-token="));

    const res = await agent
      .post("/auth/logout")
      .set("Cookie", [makeAuthCookie(user), csrfCookie].filter(Boolean).join("; "))
      .set("x-csrf-token", csrfToken);

    expect(res.status).toBe(200);
    // Auth cookie should be cleared (maxAge=0 or expires in past)
    const cookies = res.headers["set-cookie"] || [];
    const authCookie = cookies.find((c) => c.startsWith("auth_token="));
    expect(authCookie).toBeDefined();
    expect(authCookie).toMatch(/Max-Age=0|expires=Thu, 01 Jan 1970/i);
  });
});

describe("GET /auth/verify-email", () => {
  test("verifies a valid token", async () => {
    const user = await seedUser({ username: "unverified", emailVerified: false });
    const token = "a".repeat(64);
    const expiry = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await pool.query(
      "INSERT INTO email_verifications (user_id, token, expires_at) VALUES ($1, $2, $3)",
      [user.id, token, expiry],
    );

    const res = await request(app).get(`/auth/verify-email?token=${token}`);

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/verified/i);

    // User should now be verified in DB
    const dbUser = await pool.query("SELECT email_verified FROM users WHERE id = $1", [user.id]);
    expect(dbUser.rows[0].email_verified).toBe(true);
  });

  test("returns 400 for expired token", async () => {
    const user = await seedUser({ username: "unverified2", emailVerified: false });
    const token = "b".repeat(64);
    const expiry = new Date(Date.now() - 1000); // already expired
    await pool.query(
      "INSERT INTO email_verifications (user_id, token, expires_at) VALUES ($1, $2, $3)",
      [user.id, token, expiry],
    );

    const res = await request(app).get(`/auth/verify-email?token=${token}`);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("TOKEN_EXPIRED");
  });

  test("returns 400 for already-used token", async () => {
    const user = await seedUser({ username: "unverified3", emailVerified: false });
    const token = "c".repeat(64);
    const expiry = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await pool.query(
      "INSERT INTO email_verifications (user_id, token, expires_at, used_at) VALUES ($1, $2, $3, NOW())",
      [user.id, token, expiry],
    );

    const res = await request(app).get(`/auth/verify-email?token=${token}`);

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/already been used/i);
  });

  test("returns 400 for non-existent token", async () => {
    const res = await request(app).get("/auth/verify-email?token=doesnotexist");
    expect(res.status).toBe(400);
  });

  test("returns 400 when token param is missing", async () => {
    const res = await request(app).get("/auth/verify-email");
    expect(res.status).toBe(400);
  });
});

describe("POST /auth/refresh", () => {
  test("returns 401 when no refresh token cookie is present", async () => {
    const res = await request(app).post("/auth/refresh");
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("NO_REFRESH_TOKEN");
  });

  test("returns 401 for invalid refresh token", async () => {
    const res = await request(app)
      .post("/auth/refresh")
      .set("Cookie", "refresh_token=invalidtoken");

    expect(res.status).toBe(401);
    expect(res.body.code).toBe("INVALID_REFRESH_TOKEN");
  });

  test("valid refresh token issues new access token and rotates cookie", async () => {
    // Log in to get a real refresh token cookie
    const password = "Password1";
    const hashedPassword = await bcrypt.hash(password, 4);
    await seedUser({ username: "alice", email: "alice@example.com", password: hashedPassword, emailVerified: true });

    const loginRes = await request(app)
      .post("/auth/login")
      .send({ username: "alice", password });

    expect(loginRes.status).toBe(200);

    // Extract the refresh_token cookie from the login response
    const loginCookies = loginRes.headers["set-cookie"] || [];
    const refreshCookie = loginCookies.find((c) => c.startsWith("refresh_token="));
    expect(refreshCookie).toBeDefined();

    // Use the refresh token to get a new access token
    const refreshRes = await request(app)
      .post("/auth/refresh")
      .set("Cookie", refreshCookie);

    expect(refreshRes.status).toBe(200);
    expect(refreshRes.body.message).toMatch(/refreshed/i);

    // New auth_token cookie must be set
    const refreshCookies = refreshRes.headers["set-cookie"] || [];
    const newAuthCookie = refreshCookies.find((c) => c.startsWith("auth_token="));
    expect(newAuthCookie).toBeDefined();
    expect(newAuthCookie).toMatch(/HttpOnly/i);

    // New refresh_token cookie must also be rotated
    const newRefreshCookie = refreshCookies.find((c) => c.startsWith("refresh_token="));
    expect(newRefreshCookie).toBeDefined();

    // Old refresh token must now be revoked — using it again should fail
    const reuseRes = await request(app)
      .post("/auth/refresh")
      .set("Cookie", refreshCookie); // original cookie, not the new one

    expect(reuseRes.status).toBe(401);
    expect(reuseRes.body.code).toBe("TOKEN_REUSE_DETECTED");
  });
});
