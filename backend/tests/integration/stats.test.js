/**
 * Integration tests for stats and activity endpoints.
 *
 * Covers: client stats, developer stats, client activity, developer activity.
 * Verifies role-based access control and correct aggregate computation.
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
const { resetDb, seedUser, seedProject, seedBid, pool } = require("../setup/testDb");
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

let clientUser, developerUser;

beforeEach(async () => {
  await resetDb();
  clientUser = await seedUser({ username: "client1", email: "client@example.com", role: "client" });
  developerUser = await seedUser({ username: "dev1", email: "dev@example.com", role: "developer" });
});

// ── GET /api/stats/client ─────────────────────────────────────────────────────
describe("GET /api/stats/client", () => {
  test("returns correct stats for a client with projects", async () => {
    await seedProject({ clientId: clientUser.id, status: "bidding" });
    await seedProject({ clientId: clientUser.id, status: "active", assignedDeveloperId: developerUser.id });
    await seedProject({ clientId: clientUser.id, status: "completed", assignedDeveloperId: developerUser.id, maxBudget: 1000 });

    const res = await request(app)
      .get("/api/stats/client")
      .set("Cookie", makeAuthCookie(clientUser));

    expect(res.status).toBe(200);
    expect(res.body.activeProjects).toBe(2);   // bidding + active
    expect(res.body.completedProjects).toBe(1);
    expect(res.body.totalSpend).toBe(1000);
  });

  test("returns zeroed stats for a new client", async () => {
    const res = await request(app)
      .get("/api/stats/client")
      .set("Cookie", makeAuthCookie(clientUser));

    expect(res.status).toBe(200);
    expect(res.body.activeProjects).toBe(0);
    expect(res.body.completedProjects).toBe(0);
    expect(res.body.totalSpend).toBe(0);
    expect(res.body.totalBids).toBe(0);
  });

  test("developer cannot access client stats", async () => {
    const res = await request(app)
      .get("/api/stats/client")
      .set("Cookie", makeAuthCookie(developerUser));

    expect(res.status).toBe(403);
  });

  test("returns 401 when not authenticated", async () => {
    const res = await request(app).get("/api/stats/client");
    expect(res.status).toBe(401);
  });
});

// ── GET /api/stats/developer ──────────────────────────────────────────────────
describe("GET /api/stats/developer", () => {
  test("returns correct stats for a developer with projects", async () => {
    const activeProject = await seedProject({
      clientId: clientUser.id,
      status: "active",
      assignedDeveloperId: developerUser.id,
    });
    const completedProject = await seedProject({
      clientId: clientUser.id,
      status: "completed",
      assignedDeveloperId: developerUser.id,
      maxBudget: 800,
    });
    // Set review_status to approved on completed project
    await pool.query(
      "UPDATE projects SET review_status = 'approved' WHERE id = $1",
      [completedProject.id],
    );

    await seedBid({ projectId: activeProject.id, developerId: developerUser.id, status: "accepted" });

    const res = await request(app)
      .get("/api/stats/developer")
      .set("Cookie", makeAuthCookie(developerUser));

    expect(res.status).toBe(200);
    expect(res.body.activeProjects).toBe(1);
    expect(res.body.completedProjects).toBe(1);
    expect(res.body.approvedProjects).toBe(1);
    expect(res.body.acceptedBids).toBe(1);
    expect(res.body.totalEarned).toBe(800);
  });

  test("returns zeroed stats for a new developer", async () => {
    const res = await request(app)
      .get("/api/stats/developer")
      .set("Cookie", makeAuthCookie(developerUser));

    expect(res.status).toBe(200);
    expect(res.body.activeProjects).toBe(0);
    expect(res.body.totalBids).toBe(0);
    expect(res.body.totalEarned).toBe(0);
  });

  test("client cannot access developer stats", async () => {
    const res = await request(app)
      .get("/api/stats/developer")
      .set("Cookie", makeAuthCookie(clientUser));

    expect(res.status).toBe(403);
  });

  test("returns 401 when not authenticated", async () => {
    const res = await request(app).get("/api/stats/developer");
    expect(res.status).toBe(401);
  });
});

// ── GET /api/activity/client ──────────────────────────────────────────────────
describe("GET /api/activity/client", () => {
  test("returns activity events for client's projects", async () => {
    const project = await seedProject({ clientId: clientUser.id });
    await pool.query(
      `INSERT INTO project_events (project_id, actor_id, event_type, meta, actor_name, actor_role)
       VALUES ($1, $2, 'bid_placed', '{}', 'dev1', 'developer')`,
      [project.id, developerUser.id],
    );

    const res = await request(app)
      .get("/api/activity/client")
      .set("Cookie", makeAuthCookie(clientUser));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].event_type).toBe("bid_placed");
    expect(res.body.pagination).toBeDefined();
  });

  test("developer cannot access client activity", async () => {
    const res = await request(app)
      .get("/api/activity/client")
      .set("Cookie", makeAuthCookie(developerUser));

    expect(res.status).toBe(403);
  });

  test("returns empty array when no activity", async () => {
    const res = await request(app)
      .get("/api/activity/client")
      .set("Cookie", makeAuthCookie(clientUser));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });
});

// ── GET /api/activity/developer ───────────────────────────────────────────────
describe("GET /api/activity/developer", () => {
  test("returns activity events for developer's assigned projects", async () => {
    const project = await seedProject({
      clientId: clientUser.id,
      assignedDeveloperId: developerUser.id,
      status: "active",
    });
    await pool.query(
      `INSERT INTO project_events (project_id, actor_id, event_type, meta, actor_name, actor_role)
       VALUES ($1, $2, 'submission_added', '{}', 'dev1', 'developer')`,
      [project.id, developerUser.id],
    );

    const res = await request(app)
      .get("/api/activity/developer")
      .set("Cookie", makeAuthCookie(developerUser));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].event_type).toBe("submission_added");
  });

  test("client cannot access developer activity", async () => {
    const res = await request(app)
      .get("/api/activity/developer")
      .set("Cookie", makeAuthCookie(clientUser));

    expect(res.status).toBe(403);
  });
});
