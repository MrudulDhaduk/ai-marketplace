/**
 * Integration tests for the Workspace Activity Engine.
 *
 * Covers: get activity feed (with filters), approve entry, request revision,
 * resolve entry, add comment, get comments.
 *
 * Also regression-tests the seqId bug in approveEntry (was used before
 * declaration — would have thrown ReferenceError in production).
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

/** Seed a project_events row and return it */
async function seedEvent(projectId, actorId, eventType = "submission_added", approvalStatus = null) {
  const res = await pool.query(
    `INSERT INTO project_events
       (project_id, actor_id, event_type, meta, actor_name, actor_role, approval_status)
     VALUES ($1, $2, $3, '{}', 'Test Actor', 'developer', $4)
     RETURNING *`,
    [projectId, actorId, eventType, approvalStatus],
  );
  return res.rows[0];
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

// ── GET /projects/:id/activity ────────────────────────────────────────────────
describe("GET /projects/:id/activity", () => {
  test("client can fetch the activity feed", async () => {
    await seedEvent(project.id, developerUser.id, "submission_added");
    await seedEvent(project.id, developerUser.id, "file_uploaded");

    const res = await request(app)
      .get(`/projects/${project.id}/activity`)
      .set("Cookie", makeAuthCookie(clientUser));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.isClient).toBe(true);
  });

  test("developer can fetch the activity feed", async () => {
    await seedEvent(project.id, developerUser.id, "submission_added");

    const res = await request(app)
      .get(`/projects/${project.id}/activity`)
      .set("Cookie", makeAuthCookie(developerUser));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.isClient).toBe(false);
  });

  test("unrelated user gets 403", async () => {
    const other = await seedUser({ username: "other", email: "other@example.com", role: "developer" });

    const res = await request(app)
      .get(`/projects/${project.id}/activity`)
      .set("Cookie", makeAuthCookie(other));

    expect(res.status).toBe(403);
  });

  test("filter=submissions returns only submission events", async () => {
    await seedEvent(project.id, developerUser.id, "submission_added");
    await seedEvent(project.id, developerUser.id, "file_uploaded");
    await seedEvent(project.id, developerUser.id, "bid_accepted");

    const res = await request(app)
      .get(`/projects/${project.id}/activity?filter=submissions`)
      .set("Cookie", makeAuthCookie(clientUser));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].event_type).toBe("submission_added");
  });

  test("filter=files returns only file events", async () => {
    await seedEvent(project.id, developerUser.id, "file_uploaded");
    await seedEvent(project.id, developerUser.id, "file_deleted");
    await seedEvent(project.id, developerUser.id, "submission_added");

    const res = await request(app)
      .get(`/projects/${project.id}/activity?filter=files`)
      .set("Cookie", makeAuthCookie(clientUser));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    res.body.data.forEach((e) => {
      expect(["file_uploaded", "file_deleted"]).toContain(e.event_type);
    });
  });

  test("filter=reviews returns only review events", async () => {
    await seedEvent(project.id, developerUser.id, "project_approved");
    await seedEvent(project.id, developerUser.id, "revision_requested");
    await seedEvent(project.id, developerUser.id, "file_uploaded");

    const res = await request(app)
      .get(`/projects/${project.id}/activity?filter=reviews`)
      .set("Cookie", makeAuthCookie(clientUser));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
  });

  test("includes comment_count on each event", async () => {
    const event = await seedEvent(project.id, developerUser.id, "submission_added");
    // Add a comment to the event
    await pool.query(
      `INSERT INTO activity_comments (event_id, project_id, author_id, author_name, author_role, body)
       VALUES ($1, $2, $3, 'dev1', 'developer', 'Looks good!')`,
      [event.id, project.id, developerUser.id],
    );

    const res = await request(app)
      .get(`/projects/${project.id}/activity`)
      .set("Cookie", makeAuthCookie(clientUser));

    expect(res.status).toBe(200);
    const eventRow = res.body.data.find((e) => e.id === event.id);
    expect(eventRow.comment_count).toBe(1);
  });

  test("returns 401 when not authenticated", async () => {
    const res = await request(app).get(`/projects/${project.id}/activity`);
    expect(res.status).toBe(401);
  });
});

// ── POST /projects/:id/activity/:eventId/approve ──────────────────────────────
describe("POST /projects/:id/activity/:eventId/approve", () => {
  test("client can approve an activity entry (regression: seqId bug)", async () => {
    // This test would have thrown ReferenceError: seqId is not defined
    // before the bug fix in activityController.js approveEntry()
    const event = await seedEvent(project.id, developerUser.id, "submission_added", null);
    const clientCookie = makeAuthCookie(clientUser);
    const { token: csrfToken, cookie: csrfCookie } = await getCsrfToken(clientCookie);

    const res = await request(app)
      .post(`/projects/${project.id}/activity/${event.id}/approve`)
      .set("Cookie", [clientCookie, csrfCookie].filter(Boolean).join("; "))
      .set("x-csrf-token", csrfToken)
      .send({ feedback: "Great work!" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.event.approval_status).toBe("approved");
    expect(res.body.event.approval_feedback).toBe("Great work!");
  });

  test("developer cannot approve an entry", async () => {
    const event = await seedEvent(project.id, developerUser.id, "submission_added");
    const devCookie = makeAuthCookie(developerUser);
    const { token: csrfToken, cookie: csrfCookie } = await getCsrfToken(devCookie);

    const res = await request(app)
      .post(`/projects/${project.id}/activity/${event.id}/approve`)
      .set("Cookie", [devCookie, csrfCookie].filter(Boolean).join("; "))
      .set("x-csrf-token", csrfToken)
      .send({});

    expect(res.status).toBe(403);
  });

  test("returns 404 for non-existent event", async () => {
    const clientCookie = makeAuthCookie(clientUser);
    const { token: csrfToken, cookie: csrfCookie } = await getCsrfToken(clientCookie);

    const res = await request(app)
      .post(`/projects/${project.id}/activity/99999/approve`)
      .set("Cookie", [clientCookie, csrfCookie].filter(Boolean).join("; "))
      .set("x-csrf-token", csrfToken)
      .send({});

    expect(res.status).toBe(404);
  });

  test("approve sets actioned_at timestamp", async () => {
    const event = await seedEvent(project.id, developerUser.id, "submission_added");
    const clientCookie = makeAuthCookie(clientUser);
    const { token: csrfToken, cookie: csrfCookie } = await getCsrfToken(clientCookie);

    await request(app)
      .post(`/projects/${project.id}/activity/${event.id}/approve`)
      .set("Cookie", [clientCookie, csrfCookie].filter(Boolean).join("; "))
      .set("x-csrf-token", csrfToken)
      .send({});

    const dbEvent = await pool.query(
      "SELECT actioned_at FROM project_events WHERE id = $1",
      [event.id],
    );
    expect(dbEvent.rows[0].actioned_at).not.toBeNull();
  });
});

// ── POST /projects/:id/activity/:eventId/revision ─────────────────────────────
describe("POST /projects/:id/activity/:eventId/revision", () => {
  test("client can request revision on an entry", async () => {
    const event = await seedEvent(project.id, developerUser.id, "submission_added");
    const clientCookie = makeAuthCookie(clientUser);
    const { token: csrfToken, cookie: csrfCookie } = await getCsrfToken(clientCookie);

    const res = await request(app)
      .post(`/projects/${project.id}/activity/${event.id}/revision`)
      .set("Cookie", [clientCookie, csrfCookie].filter(Boolean).join("; "))
      .set("x-csrf-token", csrfToken)
      .send({ feedback: "Please redo the login page." });

    expect(res.status).toBe(200);
    expect(res.body.event.approval_status).toBe("revision_requested");
    expect(res.body.event.approval_feedback).toBe("Please redo the login page.");
  });

  test("revision clears actioned_at", async () => {
    const event = await seedEvent(project.id, developerUser.id, "submission_added", "approved");
    await pool.query("UPDATE project_events SET actioned_at = NOW() WHERE id = $1", [event.id]);

    const clientCookie = makeAuthCookie(clientUser);
    const { token: csrfToken, cookie: csrfCookie } = await getCsrfToken(clientCookie);

    await request(app)
      .post(`/projects/${project.id}/activity/${event.id}/revision`)
      .set("Cookie", [clientCookie, csrfCookie].filter(Boolean).join("; "))
      .set("x-csrf-token", csrfToken)
      .send({ feedback: "Needs more work." });

    const dbEvent = await pool.query(
      "SELECT actioned_at FROM project_events WHERE id = $1",
      [event.id],
    );
    expect(dbEvent.rows[0].actioned_at).toBeNull();
  });

  test("developer cannot request revision", async () => {
    const event = await seedEvent(project.id, developerUser.id, "submission_added");
    const devCookie = makeAuthCookie(developerUser);
    const { token: csrfToken, cookie: csrfCookie } = await getCsrfToken(devCookie);

    const res = await request(app)
      .post(`/projects/${project.id}/activity/${event.id}/revision`)
      .set("Cookie", [devCookie, csrfCookie].filter(Boolean).join("; "))
      .set("x-csrf-token", csrfToken)
      .send({ feedback: "Dev trying to request revision." });

    expect(res.status).toBe(403);
  });
});

// ── POST /projects/:id/activity/:eventId/resolve ──────────────────────────────
describe("POST /projects/:id/activity/:eventId/resolve", () => {
  test("developer can resolve a revision_requested entry", async () => {
    const event = await seedEvent(project.id, developerUser.id, "submission_added", "revision_requested");
    const devCookie = makeAuthCookie(developerUser);
    const { token: csrfToken, cookie: csrfCookie } = await getCsrfToken(devCookie);

    const res = await request(app)
      .post(`/projects/${project.id}/activity/${event.id}/resolve`)
      .set("Cookie", [devCookie, csrfCookie].filter(Boolean).join("; "))
      .set("x-csrf-token", csrfToken);

    expect(res.status).toBe(200);
    expect(res.body.event.approval_status).toBe("resolved");
  });

  test("client can also resolve an entry", async () => {
    const event = await seedEvent(project.id, developerUser.id, "submission_added", "revision_requested");
    const clientCookie = makeAuthCookie(clientUser);
    const { token: csrfToken, cookie: csrfCookie } = await getCsrfToken(clientCookie);

    const res = await request(app)
      .post(`/projects/${project.id}/activity/${event.id}/resolve`)
      .set("Cookie", [clientCookie, csrfCookie].filter(Boolean).join("; "))
      .set("x-csrf-token", csrfToken);

    expect(res.status).toBe(200);
    expect(res.body.event.approval_status).toBe("resolved");
  });

  test("unrelated user cannot resolve", async () => {
    const other = await seedUser({ username: "other", email: "other@example.com", role: "developer" });
    const event = await seedEvent(project.id, developerUser.id, "submission_added");
    const otherCookie = makeAuthCookie(other);
    const { token: csrfToken, cookie: csrfCookie } = await getCsrfToken(otherCookie);

    const res = await request(app)
      .post(`/projects/${project.id}/activity/${event.id}/resolve`)
      .set("Cookie", [otherCookie, csrfCookie].filter(Boolean).join("; "))
      .set("x-csrf-token", csrfToken);

    expect(res.status).toBe(403);
  });
});

// ── POST /projects/:id/activity/:eventId/comments ─────────────────────────────
describe("POST /projects/:id/activity/:eventId/comments", () => {
  test("client can add a comment to an activity entry", async () => {
    const event = await seedEvent(project.id, developerUser.id, "submission_added");
    const clientCookie = makeAuthCookie(clientUser);
    const { token: csrfToken, cookie: csrfCookie } = await getCsrfToken(clientCookie);

    const res = await request(app)
      .post(`/projects/${project.id}/activity/${event.id}/comments`)
      .set("Cookie", [clientCookie, csrfCookie].filter(Boolean).join("; "))
      .set("x-csrf-token", csrfToken)
      .send({ body: "Looks great, just one small thing." });

    expect(res.status).toBe(201);
    expect(res.body.comment.body).toBe("Looks great, just one small thing.");
    expect(res.body.comment.author_id).toBe(clientUser.id);
    expect(res.body.comment.author_role).toBe("client");
  });

  test("developer can add a comment", async () => {
    const event = await seedEvent(project.id, developerUser.id, "submission_added");
    const devCookie = makeAuthCookie(developerUser);
    const { token: csrfToken, cookie: csrfCookie } = await getCsrfToken(devCookie);

    const res = await request(app)
      .post(`/projects/${project.id}/activity/${event.id}/comments`)
      .set("Cookie", [devCookie, csrfCookie].filter(Boolean).join("; "))
      .set("x-csrf-token", csrfToken)
      .send({ body: "I addressed the feedback in the latest commit." });

    expect(res.status).toBe(201);
    expect(res.body.comment.author_role).toBe("developer");
  });

  test("returns 400 for empty comment body", async () => {
    const event = await seedEvent(project.id, developerUser.id, "submission_added");
    const clientCookie = makeAuthCookie(clientUser);
    const { token: csrfToken, cookie: csrfCookie } = await getCsrfToken(clientCookie);

    const res = await request(app)
      .post(`/projects/${project.id}/activity/${event.id}/comments`)
      .set("Cookie", [clientCookie, csrfCookie].filter(Boolean).join("; "))
      .set("x-csrf-token", csrfToken)
      .send({ body: "" });

    expect(res.status).toBe(400);
  });

  test("returns 400 for comment exceeding 2000 chars", async () => {
    const event = await seedEvent(project.id, developerUser.id, "submission_added");
    const clientCookie = makeAuthCookie(clientUser);
    const { token: csrfToken, cookie: csrfCookie } = await getCsrfToken(clientCookie);

    const res = await request(app)
      .post(`/projects/${project.id}/activity/${event.id}/comments`)
      .set("Cookie", [clientCookie, csrfCookie].filter(Boolean).join("; "))
      .set("x-csrf-token", csrfToken)
      .send({ body: "a".repeat(2001) });

    expect(res.status).toBe(400);
  });

  test("unrelated user cannot comment", async () => {
    const other = await seedUser({ username: "other", email: "other@example.com", role: "developer" });
    const event = await seedEvent(project.id, developerUser.id, "submission_added");
    const otherCookie = makeAuthCookie(other);
    const { token: csrfToken, cookie: csrfCookie } = await getCsrfToken(otherCookie);

    const res = await request(app)
      .post(`/projects/${project.id}/activity/${event.id}/comments`)
      .set("Cookie", [otherCookie, csrfCookie].filter(Boolean).join("; "))
      .set("x-csrf-token", csrfToken)
      .send({ body: "Unauthorized comment." });

    expect(res.status).toBe(403);
  });

  test("returns 404 when event does not belong to project (IDOR check)", async () => {
    const otherProject = await seedProject({
      clientId: clientUser.id,
      assignedDeveloperId: developerUser.id,
      status: "active",
    });
    const eventOnOtherProject = await seedEvent(otherProject.id, developerUser.id);

    const clientCookie = makeAuthCookie(clientUser);
    const { token: csrfToken, cookie: csrfCookie } = await getCsrfToken(clientCookie);

    // Try to comment on otherProject's event via project.id URL
    const res = await request(app)
      .post(`/projects/${project.id}/activity/${eventOnOtherProject.id}/comments`)
      .set("Cookie", [clientCookie, csrfCookie].filter(Boolean).join("; "))
      .set("x-csrf-token", csrfToken)
      .send({ body: "IDOR attempt." });

    expect(res.status).toBe(404);
  });
});

// ── GET /projects/:id/activity/:eventId/comments ──────────────────────────────
describe("GET /projects/:id/activity/:eventId/comments", () => {
  test("returns comments for an activity entry in chronological order", async () => {
    const event = await seedEvent(project.id, developerUser.id, "submission_added");

    await pool.query(
      `INSERT INTO activity_comments (event_id, project_id, author_id, author_name, author_role, body)
       VALUES ($1, $2, $3, 'client1', 'client', 'First comment'),
              ($1, $2, $4, 'dev1', 'developer', 'Second comment')`,
      [event.id, project.id, clientUser.id, developerUser.id],
    );

    const res = await request(app)
      .get(`/projects/${project.id}/activity/${event.id}/comments`)
      .set("Cookie", makeAuthCookie(clientUser));

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].body).toBe("First comment");
    expect(res.body[1].body).toBe("Second comment");
  });

  test("returns empty array when no comments", async () => {
    const event = await seedEvent(project.id, developerUser.id, "submission_added");

    const res = await request(app)
      .get(`/projects/${project.id}/activity/${event.id}/comments`)
      .set("Cookie", makeAuthCookie(clientUser));

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });

  test("unrelated user cannot view comments", async () => {
    const other = await seedUser({ username: "other", email: "other@example.com", role: "developer" });
    const event = await seedEvent(project.id, developerUser.id, "submission_added");

    const res = await request(app)
      .get(`/projects/${project.id}/activity/${event.id}/comments`)
      .set("Cookie", makeAuthCookie(other));

    expect(res.status).toBe(403);
  });
});
