/**
 * Integration tests for the project review flow.
 *
 * This is the most critical business logic path:
 * submit → review (approve/revision) → complete
 *
 * Tests the full state machine and guards against invalid transitions.
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

let clientUser, developerUser, project;

beforeEach(async () => {
  await resetDb();
  clientUser = await seedUser({ username: "client1", email: "client@example.com", role: "client" });
  developerUser = await seedUser({ username: "dev1", email: "dev@example.com", role: "developer" });
  project = await seedProject({
    clientId: clientUser.id,
    assignedDeveloperId: developerUser.id,
    status: "active",
  });
});

// ── PUT /projects/:id/review ──────────────────────────────────────────────────
describe("PUT /projects/:id/review", () => {
  test("client can approve a submission", async () => {
    // Set project to pending review
    await pool.query(
      "UPDATE projects SET review_status = 'pending', submitted_at = NOW() WHERE id = $1",
      [project.id],
    );

    const clientCookie = makeAuthCookie(clientUser);
    const { token: csrfToken, cookie: csrfCookie } = await getCsrfToken(clientCookie);

    const res = await request(app)
      .put(`/projects/${project.id}/review`)
      .set("Cookie", [clientCookie, csrfCookie].filter(Boolean).join("; "))
      .set("x-csrf-token", csrfToken)
      .send({ action: "approve" });

    expect(res.status).toBe(200);
    expect(res.body.project.review_status).toBe("approved");
    // Approving should also set status to completed
    expect(res.body.project.status).toBe("completed");
  });

  test("client can request a revision with feedback", async () => {
    await pool.query(
      "UPDATE projects SET review_status = 'pending', submitted_at = NOW() WHERE id = $1",
      [project.id],
    );

    const clientCookie = makeAuthCookie(clientUser);
    const { token: csrfToken, cookie: csrfCookie } = await getCsrfToken(clientCookie);

    const res = await request(app)
      .put(`/projects/${project.id}/review`)
      .set("Cookie", [clientCookie, csrfCookie].filter(Boolean).join("; "))
      .set("x-csrf-token", csrfToken)
      .send({ action: "revision", feedback: "Please fix the login page styling." });

    expect(res.status).toBe(200);
    expect(res.body.project.review_status).toBe("revision_requested");
    expect(res.body.project.review_feedback).toBe("Please fix the login page styling.");
    // Status should remain active (not completed)
    expect(res.body.project.status).toBe("active");
  });

  test("requesting revision on a completed project reverts status to active", async () => {
    // Simulate a completed project being reopened
    await pool.query(
      "UPDATE projects SET status = 'completed', review_status = 'approved' WHERE id = $1",
      [project.id],
    );

    const clientCookie = makeAuthCookie(clientUser);
    const { token: csrfToken, cookie: csrfCookie } = await getCsrfToken(clientCookie);

    const res = await request(app)
      .put(`/projects/${project.id}/review`)
      .set("Cookie", [clientCookie, csrfCookie].filter(Boolean).join("; "))
      .set("x-csrf-token", csrfToken)
      .send({ action: "revision", feedback: "Actually, one more thing." });

    expect(res.status).toBe(200);
    expect(res.body.project.review_status).toBe("revision_requested");
    // Must revert to active to satisfy DB constraint
    expect(res.body.project.status).toBe("active");
  });

  test("developer cannot review a project", async () => {
    const devCookie = makeAuthCookie(developerUser);
    const { token: csrfToken, cookie: csrfCookie } = await getCsrfToken(devCookie);

    const res = await request(app)
      .put(`/projects/${project.id}/review`)
      .set("Cookie", [devCookie, csrfCookie].filter(Boolean).join("; "))
      .set("x-csrf-token", csrfToken)
      .send({ action: "approve" });

    expect(res.status).toBe(403);
  });

  test("returns 400 for invalid action", async () => {
    const clientCookie = makeAuthCookie(clientUser);
    const { token: csrfToken, cookie: csrfCookie } = await getCsrfToken(clientCookie);

    const res = await request(app)
      .put(`/projects/${project.id}/review`)
      .set("Cookie", [clientCookie, csrfCookie].filter(Boolean).join("; "))
      .set("x-csrf-token", csrfToken)
      .send({ action: "delete" });

    expect(res.status).toBe(400);
  });

  test("returns 404 for non-existent project", async () => {
    const clientCookie = makeAuthCookie(clientUser);
    const { token: csrfToken, cookie: csrfCookie } = await getCsrfToken(clientCookie);

    const res = await request(app)
      .put("/projects/99999/review")
      .set("Cookie", [clientCookie, csrfCookie].filter(Boolean).join("; "))
      .set("x-csrf-token", csrfToken)
      .send({ action: "approve" });

    expect(res.status).toBe(404);
  });
});

// ── PUT /projects/:id/complete ────────────────────────────────────────────────
describe("PUT /projects/:id/complete", () => {
  test("developer can complete an approved project", async () => {
    await pool.query(
      "UPDATE projects SET review_status = 'approved' WHERE id = $1",
      [project.id],
    );

    const devCookie = makeAuthCookie(developerUser);
    const { token: csrfToken, cookie: csrfCookie } = await getCsrfToken(devCookie);

    const res = await request(app)
      .put(`/projects/${project.id}/complete`)
      .set("Cookie", [devCookie, csrfCookie].filter(Boolean).join("; "))
      .set("x-csrf-token", csrfToken);

    expect(res.status).toBe(200);
    expect(res.body.project.status).toBe("completed");
  });

  test("developer cannot complete a project that is not approved", async () => {
    // review_status is 'pending' by default
    const devCookie = makeAuthCookie(developerUser);
    const { token: csrfToken, cookie: csrfCookie } = await getCsrfToken(devCookie);

    const res = await request(app)
      .put(`/projects/${project.id}/complete`)
      .set("Cookie", [devCookie, csrfCookie].filter(Boolean).join("; "))
      .set("x-csrf-token", csrfToken);

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/approved by the client/i);
  });

  test("client cannot mark a project as complete", async () => {
    await pool.query(
      "UPDATE projects SET review_status = 'approved' WHERE id = $1",
      [project.id],
    );

    const clientCookie = makeAuthCookie(clientUser);
    const { token: csrfToken, cookie: csrfCookie } = await getCsrfToken(clientCookie);

    const res = await request(app)
      .put(`/projects/${project.id}/complete`)
      .set("Cookie", [clientCookie, csrfCookie].filter(Boolean).join("; "))
      .set("x-csrf-token", csrfToken);

    expect(res.status).toBe(403);
  });

  test("unassigned developer cannot complete a project", async () => {
    const otherDev = await seedUser({ username: "otherdev", email: "otherdev@example.com", role: "developer" });
    await pool.query(
      "UPDATE projects SET review_status = 'approved' WHERE id = $1",
      [project.id],
    );

    const devCookie = makeAuthCookie(otherDev);
    const { token: csrfToken, cookie: csrfCookie } = await getCsrfToken(devCookie);

    const res = await request(app)
      .put(`/projects/${project.id}/complete`)
      .set("Cookie", [devCookie, csrfCookie].filter(Boolean).join("; "))
      .set("x-csrf-token", csrfToken);

    expect(res.status).toBe(403);
  });
});

// ── POST /projects/:id/request-update ────────────────────────────────────────
describe("POST /projects/:id/request-update", () => {
  test("client can request an update from the developer", async () => {
    const clientCookie = makeAuthCookie(clientUser);
    const { token: csrfToken, cookie: csrfCookie } = await getCsrfToken(clientCookie);

    const res = await request(app)
      .post(`/projects/${project.id}/request-update`)
      .set("Cookie", [clientCookie, csrfCookie].filter(Boolean).join("; "))
      .set("x-csrf-token", csrfToken)
      .send({ feedback: "Can you give me a status update?" });

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/sent/i);
  });

  test("developer cannot request an update", async () => {
    const devCookie = makeAuthCookie(developerUser);
    const { token: csrfToken, cookie: csrfCookie } = await getCsrfToken(devCookie);

    const res = await request(app)
      .post(`/projects/${project.id}/request-update`)
      .set("Cookie", [devCookie, csrfCookie].filter(Boolean).join("; "))
      .set("x-csrf-token", csrfToken)
      .send({ feedback: "Update from dev?" });

    expect(res.status).toBe(403);
  });

  test("returns 400 when project has no assigned developer", async () => {
    const unassignedProject = await seedProject({ clientId: clientUser.id, status: "bidding" });
    const clientCookie = makeAuthCookie(clientUser);
    const { token: csrfToken, cookie: csrfCookie } = await getCsrfToken(clientCookie);

    const res = await request(app)
      .post(`/projects/${unassignedProject.id}/request-update`)
      .set("Cookie", [clientCookie, csrfCookie].filter(Boolean).join("; "))
      .set("x-csrf-token", csrfToken)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/no developer/i);
  });
});
