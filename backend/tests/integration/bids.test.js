/**
 * Integration tests for bid endpoints.
 *
 * Covers: place bid, get bids, accept bid, developer bids.
 * Critical paths: idempotency, race condition guards, IDOR prevention.
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

async function getCsrfToken(userCookie) {
  const res = await request(app).get("/auth/csrf-token").set("Cookie", userCookie);
  const csrfCookie = res.headers["set-cookie"]?.find((c) => c.startsWith("x-csrf-token="));
  return { token: res.body.csrfToken, cookie: csrfCookie };
}

const validBid = {
  amount: 350,
  proposal: "I have 5 years of experience with this exact type of project and can deliver on time.",
};

let clientUser, developerUser, project;

beforeEach(async () => {
  await resetDb();
  clientUser = await seedUser({ username: "client1", email: "client@example.com", role: "client" });
  developerUser = await seedUser({ username: "dev1", email: "dev@example.com", role: "developer" });
  project = await seedProject({ clientId: clientUser.id, status: "bidding" });
});

describe("POST /projects/:id/bid", () => {
  test("developer can place a bid", async () => {
    const devCookie = makeAuthCookie(developerUser);
    const { token: csrfToken, cookie: csrfCookie } = await getCsrfToken(devCookie);

    const res = await request(app)
      .post(`/projects/${project.id}/bid`)
      .set("Cookie", [devCookie, csrfCookie].filter(Boolean).join("; "))
      .set("x-csrf-token", csrfToken)
      .send(validBid);

    expect(res.status).toBe(201);
    expect(res.body.bid.amount).toBe("350.00");
    expect(res.body.bid.developer_id).toBe(developerUser.id);
    expect(res.body.bid.project_id).toBe(project.id);
  });

  test("client cannot bid on their own project", async () => {
    const clientCookie = makeAuthCookie(clientUser);
    const { token: csrfToken, cookie: csrfCookie } = await getCsrfToken(clientCookie);

    const res = await request(app)
      .post(`/projects/${project.id}/bid`)
      .set("Cookie", [clientCookie, csrfCookie].filter(Boolean).join("; "))
      .set("x-csrf-token", csrfToken)
      .send(validBid);

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/cannot bid on your own/i);
  });

  test("returns 400 when project is not in bidding status", async () => {
    // Project is active but has no assigned developer — status guard fires
    const activeProject = await seedProject({ clientId: clientUser.id, status: "active" });
    const devCookie = makeAuthCookie(developerUser);
    const { token: csrfToken, cookie: csrfCookie } = await getCsrfToken(devCookie);

    const res = await request(app)
      .post(`/projects/${activeProject.id}/bid`)
      .set("Cookie", [devCookie, csrfCookie].filter(Boolean).join("; "))
      .set("x-csrf-token", csrfToken)
      .send(validBid);

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/not accepting bids/i);
  });

  test("idempotency: second bid returns 200 with existing bid", async () => {
    const devCookie = makeAuthCookie(developerUser);
    const { token: csrfToken, cookie: csrfCookie } = await getCsrfToken(devCookie);
    const cookieHeader = [devCookie, csrfCookie].filter(Boolean).join("; ");

    // First bid
    await request(app)
      .post(`/projects/${project.id}/bid`)
      .set("Cookie", cookieHeader)
      .set("x-csrf-token", csrfToken)
      .send(validBid);

    // Second bid (retry/double-click)
    const res = await request(app)
      .post(`/projects/${project.id}/bid`)
      .set("Cookie", cookieHeader)
      .set("x-csrf-token", csrfToken)
      .send(validBid);

    expect(res.status).toBe(200);
    expect(res.body.idempotent).toBe(true);
    expect(res.body.bid).toBeDefined();
  });

  test("returns 400 for invalid bid amount", async () => {
    const devCookie = makeAuthCookie(developerUser);
    const { token: csrfToken, cookie: csrfCookie } = await getCsrfToken(devCookie);

    const res = await request(app)
      .post(`/projects/${project.id}/bid`)
      .set("Cookie", [devCookie, csrfCookie].filter(Boolean).join("; "))
      .set("x-csrf-token", csrfToken)
      .send({ ...validBid, amount: -100 });

    expect(res.status).toBe(400);
  });

  test("returns 400 for proposal that is too short", async () => {
    const devCookie = makeAuthCookie(developerUser);
    const { token: csrfToken, cookie: csrfCookie } = await getCsrfToken(devCookie);

    const res = await request(app)
      .post(`/projects/${project.id}/bid`)
      .set("Cookie", [devCookie, csrfCookie].filter(Boolean).join("; "))
      .set("x-csrf-token", csrfToken)
      .send({ ...validBid, proposal: "Too short" });

    expect(res.status).toBe(400);
  });

  test("returns 404 for non-existent project", async () => {
    const devCookie = makeAuthCookie(developerUser);
    const { token: csrfToken, cookie: csrfCookie } = await getCsrfToken(devCookie);

    const res = await request(app)
      .post("/projects/99999/bid")
      .set("Cookie", [devCookie, csrfCookie].filter(Boolean).join("; "))
      .set("x-csrf-token", csrfToken)
      .send(validBid);

    expect(res.status).toBe(404);
  });
});

describe("GET /api/projects/:projectId/bids", () => {
  test("client can view bids on their project", async () => {
    await seedBid({ projectId: project.id, developerId: developerUser.id });

    const res = await request(app)
      .get(`/api/projects/${project.id}/bids`)
      .set("Cookie", makeAuthCookie(clientUser));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].developer_id).toBe(developerUser.id);
    expect(res.body.pagination).toBeDefined();
  });

  test("developer cannot view bids on a project they did not create", async () => {
    const res = await request(app)
      .get(`/api/projects/${project.id}/bids`)
      .set("Cookie", makeAuthCookie(developerUser));

    expect(res.status).toBe(403);
  });

  test("returns 404 for non-existent project", async () => {
    const res = await request(app)
      .get("/api/projects/99999/bids")
      .set("Cookie", makeAuthCookie(clientUser));

    expect(res.status).toBe(404);
  });
});

describe("POST /api/projects/:projectId/accept-bid/:bidId", () => {
  test("client can accept a bid and project becomes active", async () => {
    const bid = await seedBid({ projectId: project.id, developerId: developerUser.id });
    const clientCookie = makeAuthCookie(clientUser);
    const { token: csrfToken, cookie: csrfCookie } = await getCsrfToken(clientCookie);

    const res = await request(app)
      .post(`/api/projects/${project.id}/accept-bid/${bid.id}`)
      .set("Cookie", [clientCookie, csrfCookie].filter(Boolean).join("; "))
      .set("x-csrf-token", csrfToken);

    expect(res.status).toBe(200);
    expect(res.body.assignedDeveloperId).toBe(developerUser.id);

    // Verify DB state
    const dbProject = await pool.query("SELECT status, assigned_developer_id FROM projects WHERE id = $1", [project.id]);
    expect(dbProject.rows[0].status).toBe("active");
    expect(dbProject.rows[0].assigned_developer_id).toBe(developerUser.id);

    // Other bids should be rejected
    const dbBid = await pool.query("SELECT status FROM bids WHERE id = $1", [bid.id]);
    expect(dbBid.rows[0].status).toBe("accepted");
  });

  test("other bids are rejected when one is accepted", async () => {
    const dev2 = await seedUser({ username: "dev2", email: "dev2@example.com", role: "developer" });
    const bid1 = await seedBid({ projectId: project.id, developerId: developerUser.id });
    const bid2 = await seedBid({ projectId: project.id, developerId: dev2.id });

    const clientCookie = makeAuthCookie(clientUser);
    const { token: csrfToken, cookie: csrfCookie } = await getCsrfToken(clientCookie);

    await request(app)
      .post(`/api/projects/${project.id}/accept-bid/${bid1.id}`)
      .set("Cookie", [clientCookie, csrfCookie].filter(Boolean).join("; "))
      .set("x-csrf-token", csrfToken);

    const dbBid2 = await pool.query("SELECT status FROM bids WHERE id = $1", [bid2.id]);
    expect(dbBid2.rows[0].status).toBe("rejected");
  });

  test("idempotency: accepting an already-accepted bid returns 200", async () => {
    const bid = await seedBid({ projectId: project.id, developerId: developerUser.id, status: "accepted" });
    // Manually set project to active
    await pool.query("UPDATE projects SET status = 'active', assigned_developer_id = $1 WHERE id = $2", [developerUser.id, project.id]);

    const clientCookie = makeAuthCookie(clientUser);
    const { token: csrfToken, cookie: csrfCookie } = await getCsrfToken(clientCookie);

    const res = await request(app)
      .post(`/api/projects/${project.id}/accept-bid/${bid.id}`)
      .set("Cookie", [clientCookie, csrfCookie].filter(Boolean).join("; "))
      .set("x-csrf-token", csrfToken);

    expect(res.status).toBe(200);
    expect(res.body.idempotent).toBe(true);
  });

  test("developer cannot accept a bid", async () => {
    const bid = await seedBid({ projectId: project.id, developerId: developerUser.id });
    const devCookie = makeAuthCookie(developerUser);
    const { token: csrfToken, cookie: csrfCookie } = await getCsrfToken(devCookie);

    const res = await request(app)
      .post(`/api/projects/${project.id}/accept-bid/${bid.id}`)
      .set("Cookie", [devCookie, csrfCookie].filter(Boolean).join("; "))
      .set("x-csrf-token", csrfToken);

    expect(res.status).toBe(403);
  });

  test("returns 400 when project is already assigned", async () => {
    const dev2 = await seedUser({ username: "dev2", email: "dev2@example.com", role: "developer" });
    const bid1 = await seedBid({ projectId: project.id, developerId: developerUser.id });
    const bid2 = await seedBid({ projectId: project.id, developerId: dev2.id });

    // Manually assign project
    await pool.query("UPDATE projects SET status = 'active', assigned_developer_id = $1 WHERE id = $2", [developerUser.id, project.id]);

    const clientCookie = makeAuthCookie(clientUser);
    const { token: csrfToken, cookie: csrfCookie } = await getCsrfToken(clientCookie);

    const res = await request(app)
      .post(`/api/projects/${project.id}/accept-bid/${bid2.id}`)
      .set("Cookie", [clientCookie, csrfCookie].filter(Boolean).join("; "))
      .set("x-csrf-token", csrfToken);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already assigned/i);
  });
});

describe("GET /bids/developer/:id", () => {
  test("developer can view their own bids", async () => {
    await seedBid({ projectId: project.id, developerId: developerUser.id, amount: 400 });

    const res = await request(app)
      .get(`/bids/developer/${developerUser.id}`)
      .set("Cookie", makeAuthCookie(developerUser));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].project_id).toBe(project.id);
    expect(res.body.data[0].amount).toBe("400.00");
    expect(res.body.data[0].title).toBe(project.title);
  });

  test("developer cannot view another developer's bids (IDOR check)", async () => {
    const dev2 = await seedUser({ username: "dev2", email: "dev2@example.com", role: "developer" });

    const res = await request(app)
      .get(`/bids/developer/${dev2.id}`)
      .set("Cookie", makeAuthCookie(developerUser));

    expect(res.status).toBe(403);
  });
});
