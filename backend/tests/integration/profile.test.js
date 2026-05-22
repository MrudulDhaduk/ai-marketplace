/**
 * Integration tests for profile endpoints.
 *
 * Covers: get profile, update profile, skills CRUD.
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
const { resetDb, seedUser, pool } = require("../setup/testDb");
const { makeAuthCookie } = require("../setup/authHelpers");

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

async function getCsrfToken(userCookie) {
  const res = await request(app).get("/auth/csrf-token").set("Cookie", userCookie);
  const csrfCookie = res.headers["set-cookie"]?.find((c) => c.startsWith("x-csrf-token="));
  return { token: res.body.csrfToken, cookie: csrfCookie };
}

let clientUser, developerUser;

beforeEach(async () => {
  await resetDb();
  clientUser = await seedUser({ username: "client1", email: "client@example.com", role: "client" });
  developerUser = await seedUser({ username: "dev1", email: "dev@example.com", role: "developer" });
});

// ── GET /profile/:id ──────────────────────────────────────────────────────────
describe("GET /profile/:id", () => {
  test("returns public profile fields for any visitor", async () => {
    const res = await request(app).get(`/profile/${developerUser.id}`);

    expect(res.status).toBe(200);
    expect(res.body.user.username).toBe("dev1");
    expect(res.body.user.role).toBe("developer");
    // Private fields must NOT be exposed to unauthenticated visitors
    expect(res.body.user.email).toBeUndefined();
    expect(res.body.user.password).toBeUndefined();
  });

  test("returns private fields when viewing own profile", async () => {
    const res = await request(app)
      .get(`/profile/${developerUser.id}`)
      .set("Cookie", makeAuthCookie(developerUser));

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe("dev@example.com");
    expect(res.body.user.email_verified).toBeDefined();
  });

  test("does NOT return private fields when viewing another user's profile", async () => {
    const res = await request(app)
      .get(`/profile/${developerUser.id}`)
      .set("Cookie", makeAuthCookie(clientUser));

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBeUndefined();
  });

  test("returns stats for developer profile", async () => {
    const res = await request(app).get(`/profile/${developerUser.id}`);

    expect(res.status).toBe(200);
    expect(res.body.stats).toBeDefined();
    expect(res.body.stats.projectsCompleted).toBeDefined();
    expect(res.body.stats.activeProjects).toBeDefined();
  });

  test("returns 404 for non-existent user", async () => {
    const res = await request(app).get("/profile/99999");
    expect(res.status).toBe(404);
  });
});

// ── PUT /profile/:id ──────────────────────────────────────────────────────────
describe("PUT /profile/:id", () => {
  test("user can update their own bio", async () => {
    const userCookie = makeAuthCookie(developerUser);
    const { token: csrfToken, cookie: csrfCookie } = await getCsrfToken(userCookie);

    const res = await request(app)
      .put(`/profile/${developerUser.id}`)
      .set("Cookie", [userCookie, csrfCookie].filter(Boolean).join("; "))
      .set("x-csrf-token", csrfToken)
      .send({ bio: "Full-stack developer with 5 years of experience." });

    expect(res.status).toBe(200);
    expect(res.body.user.bio).toBe("Full-stack developer with 5 years of experience.");
  });

  test("user cannot update another user's profile (IDOR check)", async () => {
    const userCookie = makeAuthCookie(clientUser);
    const { token: csrfToken, cookie: csrfCookie } = await getCsrfToken(userCookie);

    const res = await request(app)
      .put(`/profile/${developerUser.id}`)
      .set("Cookie", [userCookie, csrfCookie].filter(Boolean).join("; "))
      .set("x-csrf-token", csrfToken)
      .send({ bio: "Injected bio." });

    expect(res.status).toBe(403);
  });

  test("bio is truncated to 1000 chars", async () => {
    const userCookie = makeAuthCookie(developerUser);
    const { token: csrfToken, cookie: csrfCookie } = await getCsrfToken(userCookie);

    const longBio = "a".repeat(1500);
    const res = await request(app)
      .put(`/profile/${developerUser.id}`)
      .set("Cookie", [userCookie, csrfCookie].filter(Boolean).join("; "))
      .set("x-csrf-token", csrfToken)
      .send({ bio: longBio });

    expect(res.status).toBe(200);
    expect(res.body.user.bio.length).toBe(1000);
  });

  test("returns 401 when not authenticated", async () => {
    const res = await request(app)
      .put(`/profile/${developerUser.id}`)
      .send({ bio: "Test" });
    expect(res.status).toBe(401);
  });
});

// ── GET /profile/:id/skills ───────────────────────────────────────────────────
describe("GET /profile/:id/skills", () => {
  test("user can view their own skills", async () => {
    await pool.query(
      "INSERT INTO user_skills (user_id, skill) VALUES ($1, $2), ($1, $3)",
      [developerUser.id, "React", "Node.js"],
    );

    const res = await request(app)
      .get(`/profile/${developerUser.id}/skills`)
      .set("Cookie", makeAuthCookie(developerUser));

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(2);
    expect(res.body).toContain("React");
  });

  test("user cannot view another user's skills", async () => {
    const res = await request(app)
      .get(`/profile/${developerUser.id}/skills`)
      .set("Cookie", makeAuthCookie(clientUser));

    expect(res.status).toBe(403);
  });
});

// ── POST /profile/:id/skills ──────────────────────────────────────────────────
describe("POST /profile/:id/skills", () => {
  test("user can add a skill", async () => {
    const userCookie = makeAuthCookie(developerUser);
    const { token: csrfToken, cookie: csrfCookie } = await getCsrfToken(userCookie);

    const res = await request(app)
      .post(`/profile/${developerUser.id}/skills`)
      .set("Cookie", [userCookie, csrfCookie].filter(Boolean).join("; "))
      .set("x-csrf-token", csrfToken)
      .send({ skill: "TypeScript" });

    expect(res.status).toBe(201);
    expect(res.body.skill).toBe("TypeScript");
  });

  test("returns 409 when skill already exists (case-insensitive)", async () => {
    await pool.query(
      "INSERT INTO user_skills (user_id, skill) VALUES ($1, $2)",
      [developerUser.id, "typescript"],
    );

    const userCookie = makeAuthCookie(developerUser);
    const { token: csrfToken, cookie: csrfCookie } = await getCsrfToken(userCookie);

    const res = await request(app)
      .post(`/profile/${developerUser.id}/skills`)
      .set("Cookie", [userCookie, csrfCookie].filter(Boolean).join("; "))
      .set("x-csrf-token", csrfToken)
      .send({ skill: "TypeScript" }); // different case

    expect(res.status).toBe(409);
  });

  test("returns 400 for empty skill", async () => {
    const userCookie = makeAuthCookie(developerUser);
    const { token: csrfToken, cookie: csrfCookie } = await getCsrfToken(userCookie);

    const res = await request(app)
      .post(`/profile/${developerUser.id}/skills`)
      .set("Cookie", [userCookie, csrfCookie].filter(Boolean).join("; "))
      .set("x-csrf-token", csrfToken)
      .send({ skill: "" });

    expect(res.status).toBe(400);
  });

  test("user cannot add skills to another user's profile", async () => {
    const userCookie = makeAuthCookie(clientUser);
    const { token: csrfToken, cookie: csrfCookie } = await getCsrfToken(userCookie);

    const res = await request(app)
      .post(`/profile/${developerUser.id}/skills`)
      .set("Cookie", [userCookie, csrfCookie].filter(Boolean).join("; "))
      .set("x-csrf-token", csrfToken)
      .send({ skill: "Hacking" });

    expect(res.status).toBe(403);
  });
});

// ── DELETE /profile/:id/skills ────────────────────────────────────────────────
describe("DELETE /profile/:id/skills", () => {
  test("user can remove a skill", async () => {
    await pool.query(
      "INSERT INTO user_skills (user_id, skill) VALUES ($1, $2)",
      [developerUser.id, "React"],
    );

    const userCookie = makeAuthCookie(developerUser);
    const { token: csrfToken, cookie: csrfCookie } = await getCsrfToken(userCookie);

    const res = await request(app)
      .delete(`/profile/${developerUser.id}/skills`)
      .set("Cookie", [userCookie, csrfCookie].filter(Boolean).join("; "))
      .set("x-csrf-token", csrfToken)
      .send({ skill: "React" });

    expect(res.status).toBe(200);

    const dbCheck = await pool.query(
      "SELECT id FROM user_skills WHERE user_id = $1 AND skill = $2",
      [developerUser.id, "React"],
    );
    expect(dbCheck.rows).toHaveLength(0);
  });

  test("user cannot remove skills from another user's profile", async () => {
    await pool.query(
      "INSERT INTO user_skills (user_id, skill) VALUES ($1, $2)",
      [developerUser.id, "React"],
    );

    const userCookie = makeAuthCookie(clientUser);
    const { token: csrfToken, cookie: csrfCookie } = await getCsrfToken(userCookie);

    const res = await request(app)
      .delete(`/profile/${developerUser.id}/skills`)
      .set("Cookie", [userCookie, csrfCookie].filter(Boolean).join("; "))
      .set("x-csrf-token", csrfToken)
      .send({ skill: "React" });

    expect(res.status).toBe(403);
  });
});
