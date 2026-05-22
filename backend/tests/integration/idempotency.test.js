/**
 * Integration tests for the idempotency middleware.
 *
 * Tests the Idempotency-Key header behaviour: cache hit replay,
 * key validation, user scoping, and graceful degradation.
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

const validBid = {
  amount: 350,
  proposal: "I have extensive experience with this type of project and can deliver on time.",
};

let clientUser, developerUser, project;

beforeEach(async () => {
  await resetDb();
  clientUser = await seedUser({ username: "client1", email: "client@example.com", role: "client" });
  developerUser = await seedUser({ username: "dev1", email: "dev@example.com", role: "developer" });
  project = await seedProject({ clientId: clientUser.id, status: "bidding" });
});

describe("Idempotency-Key middleware on bid placement", () => {
  test("second request with same key returns cached response without re-executing", async () => {
    const devCookie = makeAuthCookie(developerUser);
    const { token: csrfToken, cookie: csrfCookie } = await getCsrfToken(devCookie);
    const cookieHeader = [devCookie, csrfCookie].filter(Boolean).join("; ");
    const idempotencyKey = "test-key-" + Date.now();

    // First request — creates the bid
    const res1 = await request(app)
      .post(`/projects/${project.id}/bid`)
      .set("Cookie", cookieHeader)
      .set("x-csrf-token", csrfToken)
      .set("Idempotency-Key", idempotencyKey)
      .send(validBid);

    expect(res1.status).toBe(201);

    // Second request with same key — should return cached response
    const res2 = await request(app)
      .post(`/projects/${project.id}/bid`)
      .set("Cookie", cookieHeader)
      .set("x-csrf-token", csrfToken)
      .set("Idempotency-Key", idempotencyKey)
      .send(validBid);

    expect(res2.status).toBe(201);
    expect(res2.body).toEqual(res1.body);

    // Verify only one bid was created in the DB
    const dbBids = await pool.query(
      "SELECT id FROM bids WHERE project_id = $1 AND developer_id = $2",
      [project.id, developerUser.id],
    );
    expect(dbBids.rows).toHaveLength(1);
  });

  test("different keys produce independent requests", async () => {
    const dev2 = await seedUser({ username: "dev2", email: "dev2@example.com", role: "developer" });
    const project2 = await seedProject({ clientId: clientUser.id, status: "bidding" });

    const devCookie = makeAuthCookie(developerUser);
    const { token: csrfToken, cookie: csrfCookie } = await getCsrfToken(devCookie);
    const cookieHeader = [devCookie, csrfCookie].filter(Boolean).join("; ");

    const res1 = await request(app)
      .post(`/projects/${project.id}/bid`)
      .set("Cookie", cookieHeader)
      .set("x-csrf-token", csrfToken)
      .set("Idempotency-Key", "key-alpha")
      .send(validBid);

    const res2 = await request(app)
      .post(`/projects/${project2.id}/bid`)
      .set("Cookie", cookieHeader)
      .set("x-csrf-token", csrfToken)
      .set("Idempotency-Key", "key-beta")
      .send(validBid);

    expect(res1.status).toBe(201);
    expect(res2.status).toBe(201);
    expect(res1.body.bid.project_id).not.toBe(res2.body.bid.project_id);
  });

  test("returns 400 for Idempotency-Key exceeding 128 chars", async () => {
    const devCookie = makeAuthCookie(developerUser);
    const { token: csrfToken, cookie: csrfCookie } = await getCsrfToken(devCookie);

    const res = await request(app)
      .post(`/projects/${project.id}/bid`)
      .set("Cookie", [devCookie, csrfCookie].filter(Boolean).join("; "))
      .set("x-csrf-token", csrfToken)
      .set("Idempotency-Key", "a".repeat(129))
      .send(validBid);

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/invalid idempotency-key/i);
  });

  test("proceeds normally when no Idempotency-Key header is sent", async () => {
    const devCookie = makeAuthCookie(developerUser);
    const { token: csrfToken, cookie: csrfCookie } = await getCsrfToken(devCookie);

    const res = await request(app)
      .post(`/projects/${project.id}/bid`)
      .set("Cookie", [devCookie, csrfCookie].filter(Boolean).join("; "))
      .set("x-csrf-token", csrfToken)
      // No Idempotency-Key header
      .send(validBid);

    expect(res.status).toBe(201);
  });

  test("same key from different users is treated independently", async () => {
    const dev2 = await seedUser({ username: "dev2", email: "dev2@example.com", role: "developer" });
    const project2 = await seedProject({ clientId: clientUser.id, status: "bidding" });

    const sharedKey = "shared-idempotency-key";

    // dev1 bids on project with shared key
    const dev1Cookie = makeAuthCookie(developerUser);
    const { token: csrf1, cookie: csrfCookie1 } = await getCsrfToken(dev1Cookie);
    const res1 = await request(app)
      .post(`/projects/${project.id}/bid`)
      .set("Cookie", [dev1Cookie, csrfCookie1].filter(Boolean).join("; "))
      .set("x-csrf-token", csrf1)
      .set("Idempotency-Key", sharedKey)
      .send(validBid);

    // dev2 bids on project2 with same key — should NOT get dev1's cached response
    const dev2Cookie = makeAuthCookie(dev2);
    const { token: csrf2, cookie: csrfCookie2 } = await getCsrfToken(dev2Cookie);
    const res2 = await request(app)
      .post(`/projects/${project2.id}/bid`)
      .set("Cookie", [dev2Cookie, csrfCookie2].filter(Boolean).join("; "))
      .set("x-csrf-token", csrf2)
      .set("Idempotency-Key", sharedKey)
      .send(validBid);

    expect(res1.status).toBe(201);
    expect(res2.status).toBe(201);
    // They should have different project IDs
    expect(res1.body.bid.project_id).not.toBe(res2.body.bid.project_id);
  });
});
