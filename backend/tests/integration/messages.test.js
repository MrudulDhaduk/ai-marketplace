/**
 * Integration tests for message endpoints.
 *
 * Covers: send message, get messages, unread count.
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

describe("POST /projects/:id/messages", () => {
  test("client can send a message to the developer", async () => {
    const clientCookie = makeAuthCookie(clientUser);
    const { token: csrfToken, cookie: csrfCookie } = await getCsrfToken(clientCookie);

    const res = await request(app)
      .post(`/projects/${project.id}/messages`)
      .set("Cookie", [clientCookie, csrfCookie].filter(Boolean).join("; "))
      .set("x-csrf-token", csrfToken)
      .send({ body: "Hello, how is the project going?" });

    expect(res.status).toBe(201);
    expect(res.body.data.body).toBe("Hello, how is the project going?");
    expect(res.body.data.sender_id).toBe(clientUser.id);
    expect(res.body.data.receiver_id).toBe(developerUser.id);
  });

  test("developer can send a message to the client", async () => {
    const devCookie = makeAuthCookie(developerUser);
    const { token: csrfToken, cookie: csrfCookie } = await getCsrfToken(devCookie);

    const res = await request(app)
      .post(`/projects/${project.id}/messages`)
      .set("Cookie", [devCookie, csrfCookie].filter(Boolean).join("; "))
      .set("x-csrf-token", csrfToken)
      .send({ body: "Progress is on track, will deliver by Friday." });

    expect(res.status).toBe(201);
    expect(res.body.data.sender_id).toBe(developerUser.id);
    expect(res.body.data.receiver_id).toBe(clientUser.id);
  });

  test("unrelated user cannot send a message", async () => {
    const otherUser = await seedUser({ username: "other", email: "other@example.com", role: "developer" });
    const otherCookie = makeAuthCookie(otherUser);
    const { token: csrfToken, cookie: csrfCookie } = await getCsrfToken(otherCookie);

    const res = await request(app)
      .post(`/projects/${project.id}/messages`)
      .set("Cookie", [otherCookie, csrfCookie].filter(Boolean).join("; "))
      .set("x-csrf-token", csrfToken)
      .send({ body: "Unauthorized message attempt." });

    expect(res.status).toBe(403);
  });

  test("returns 400 for empty message body", async () => {
    const clientCookie = makeAuthCookie(clientUser);
    const { token: csrfToken, cookie: csrfCookie } = await getCsrfToken(clientCookie);

    const res = await request(app)
      .post(`/projects/${project.id}/messages`)
      .set("Cookie", [clientCookie, csrfCookie].filter(Boolean).join("; "))
      .set("x-csrf-token", csrfToken)
      .send({ body: "" });

    expect(res.status).toBe(400);
  });

  test("returns 400 for message exceeding 4000 chars", async () => {
    const clientCookie = makeAuthCookie(clientUser);
    const { token: csrfToken, cookie: csrfCookie } = await getCsrfToken(clientCookie);

    const res = await request(app)
      .post(`/projects/${project.id}/messages`)
      .set("Cookie", [clientCookie, csrfCookie].filter(Boolean).join("; "))
      .set("x-csrf-token", csrfToken)
      .send({ body: "a".repeat(4001) });

    expect(res.status).toBe(400);
  });

  test("returns 400 when project has no assigned developer", async () => {
    const unassignedProject = await seedProject({ clientId: clientUser.id, status: "bidding" });
    const clientCookie = makeAuthCookie(clientUser);
    const { token: csrfToken, cookie: csrfCookie } = await getCsrfToken(clientCookie);

    const res = await request(app)
      .post(`/projects/${unassignedProject.id}/messages`)
      .set("Cookie", [clientCookie, csrfCookie].filter(Boolean).join("; "))
      .set("x-csrf-token", csrfToken)
      .send({ body: "Hello?" });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/no recipient/i);
  });
});

describe("GET /projects/:id/messages", () => {
  test("client can view messages for their project", async () => {
    await pool.query(
      "INSERT INTO messages (project_id, sender_id, receiver_id, body) VALUES ($1, $2, $3, $4)",
      [project.id, clientUser.id, developerUser.id, "Test message"],
    );

    const res = await request(app)
      .get(`/projects/${project.id}/messages`)
      .set("Cookie", makeAuthCookie(clientUser));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].body).toBe("Test message");
    expect(res.body.pagination).toBeDefined();
  });

  test("marks messages as read when fetched by receiver", async () => {
    await pool.query(
      "INSERT INTO messages (project_id, sender_id, receiver_id, body, is_read) VALUES ($1, $2, $3, $4, false)",
      [project.id, clientUser.id, developerUser.id, "Unread message"],
    );

    // Developer fetches messages — should mark as read
    await request(app)
      .get(`/projects/${project.id}/messages`)
      .set("Cookie", makeAuthCookie(developerUser));

    const dbCheck = await pool.query(
      "SELECT is_read FROM messages WHERE project_id = $1 AND receiver_id = $2",
      [project.id, developerUser.id],
    );
    expect(dbCheck.rows[0].is_read).toBe(true);
  });

  test("unrelated user gets 403", async () => {
    const otherUser = await seedUser({ username: "other", email: "other@example.com", role: "developer" });

    const res = await request(app)
      .get(`/projects/${project.id}/messages`)
      .set("Cookie", makeAuthCookie(otherUser));

    expect(res.status).toBe(403);
  });
});

describe("GET /api/messages/unread-count", () => {
  test("returns correct unread count for the user", async () => {
    // 2 unread messages for developer
    await pool.query(
      "INSERT INTO messages (project_id, sender_id, receiver_id, body, is_read) VALUES ($1, $2, $3, $4, false), ($1, $2, $3, $5, false)",
      [project.id, clientUser.id, developerUser.id, "Message 1", "Message 2"],
    );
    // 1 read message
    await pool.query(
      "INSERT INTO messages (project_id, sender_id, receiver_id, body, is_read) VALUES ($1, $2, $3, $4, true)",
      [project.id, clientUser.id, developerUser.id, "Read message"],
    );

    const res = await request(app)
      .get("/api/messages/unread-count")
      .set("Cookie", makeAuthCookie(developerUser));

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);
  });

  test("returns 0 when no unread messages", async () => {
    const res = await request(app)
      .get("/api/messages/unread-count")
      .set("Cookie", makeAuthCookie(developerUser));

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(0);
  });

  test("returns 401 when not authenticated", async () => {
    const res = await request(app).get("/api/messages/unread-count");
    expect(res.status).toBe(401);
  });
});
