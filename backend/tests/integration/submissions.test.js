/**
 * Integration tests for submission endpoints.
 *
 * Covers: submit project, get submissions, add/update/delete notes.
 * Critical paths: IDOR prevention, double-submit guard, review status transitions.
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

const validSubmission = {
  repoLink: "https://github.com/user/project-repo",
  demoLink: "https://demo.example.com",
  notes: "Completed all requirements. Tests are passing.",
};

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

describe("POST /projects/:id/submit", () => {
  test("assigned developer can submit a project", async () => {
    const devCookie = makeAuthCookie(developerUser);
    const { token: csrfToken, cookie: csrfCookie } = await getCsrfToken(devCookie);

    const res = await request(app)
      .post(`/projects/${project.id}/submit`)
      .set("Cookie", [devCookie, csrfCookie].filter(Boolean).join("; "))
      .set("x-csrf-token", csrfToken)
      .send(validSubmission);

    expect(res.status).toBe(200);
    expect(res.body.review_status).toBe("pending");
    expect(res.body.deliverable_link).toBe(validSubmission.repoLink);
  });

  test("unassigned developer cannot submit", async () => {
    const otherDev = await seedUser({ username: "otherdev", email: "otherdev@example.com", role: "developer" });
    const devCookie = makeAuthCookie(otherDev);
    const { token: csrfToken, cookie: csrfCookie } = await getCsrfToken(devCookie);

    const res = await request(app)
      .post(`/projects/${project.id}/submit`)
      .set("Cookie", [devCookie, csrfCookie].filter(Boolean).join("; "))
      .set("x-csrf-token", csrfToken)
      .send(validSubmission);

    expect(res.status).toBe(403);
  });

  test("client cannot submit a project", async () => {
    const clientCookie = makeAuthCookie(clientUser);
    const { token: csrfToken, cookie: csrfCookie } = await getCsrfToken(clientCookie);

    const res = await request(app)
      .post(`/projects/${project.id}/submit`)
      .set("Cookie", [clientCookie, csrfCookie].filter(Boolean).join("; "))
      .set("x-csrf-token", csrfToken)
      .send(validSubmission);

    expect(res.status).toBe(403);
  });

  test("blocks resubmit while already under review (409)", async () => {
    // Set review_status to pending AND submitted_at to simulate an in-review submission
    await pool.query(
      "UPDATE projects SET review_status = 'pending', submitted_at = NOW() WHERE id = $1",
      [project.id],
    );

    const devCookie = makeAuthCookie(developerUser);
    const { token: csrfToken, cookie: csrfCookie } = await getCsrfToken(devCookie);

    const res = await request(app)
      .post(`/projects/${project.id}/submit`)
      .set("Cookie", [devCookie, csrfCookie].filter(Boolean).join("; "))
      .set("x-csrf-token", csrfToken)
      .send(validSubmission);

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/already under review/i);
  });

  test("returns 400 for HTTP repoLink (must be HTTPS)", async () => {
    const devCookie = makeAuthCookie(developerUser);
    const { token: csrfToken, cookie: csrfCookie } = await getCsrfToken(devCookie);

    const res = await request(app)
      .post(`/projects/${project.id}/submit`)
      .set("Cookie", [devCookie, csrfCookie].filter(Boolean).join("; "))
      .set("x-csrf-token", csrfToken)
      .send({ ...validSubmission, repoLink: "http://github.com/user/repo" });

    expect(res.status).toBe(400);
  });

  test("returns 400 for missing repoLink", async () => {
    const devCookie = makeAuthCookie(developerUser);
    const { token: csrfToken, cookie: csrfCookie } = await getCsrfToken(devCookie);

    const res = await request(app)
      .post(`/projects/${project.id}/submit`)
      .set("Cookie", [devCookie, csrfCookie].filter(Boolean).join("; "))
      .set("x-csrf-token", csrfToken)
      .send({ demoLink: "https://demo.example.com" });

    expect(res.status).toBe(400);
  });

  test("clears review_feedback and reviewed_at on resubmit", async () => {
    // First submission
    await pool.query(
      "UPDATE projects SET review_status = 'revision_requested', review_feedback = 'Fix the UI', reviewed_at = NOW() WHERE id = $1",
      [project.id],
    );

    const devCookie = makeAuthCookie(developerUser);
    const { token: csrfToken, cookie: csrfCookie } = await getCsrfToken(devCookie);

    const res = await request(app)
      .post(`/projects/${project.id}/submit`)
      .set("Cookie", [devCookie, csrfCookie].filter(Boolean).join("; "))
      .set("x-csrf-token", csrfToken)
      .send(validSubmission);

    expect(res.status).toBe(200);
    expect(res.body.review_feedback).toBeNull();
    expect(res.body.reviewed_at).toBeNull();
    expect(res.body.review_status).toBe("pending");
  });
});

describe("GET /projects/:id/submissions", () => {
  test("client can view submissions for their project", async () => {
    await pool.query(
      "INSERT INTO project_submissions (project_id, repo_link, notes) VALUES ($1, $2, $3)",
      [project.id, "https://github.com/user/repo", "Initial submission"],
    );

    const res = await request(app)
      .get(`/projects/${project.id}/submissions`)
      .set("Cookie", makeAuthCookie(clientUser));

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(1);
  });

  test("assigned developer can view submissions", async () => {
    const res = await request(app)
      .get(`/projects/${project.id}/submissions`)
      .set("Cookie", makeAuthCookie(developerUser));

    expect(res.status).toBe(200);
  });

  test("unrelated user gets 403", async () => {
    const otherUser = await seedUser({ username: "other", email: "other@example.com", role: "developer" });

    const res = await request(app)
      .get(`/projects/${project.id}/submissions`)
      .set("Cookie", makeAuthCookie(otherUser));

    expect(res.status).toBe(403);
  });
});

describe("POST /projects/:projectId/submissions (add note)", () => {
  test("assigned developer can add a progress note", async () => {
    const devCookie = makeAuthCookie(developerUser);
    const { token: csrfToken, cookie: csrfCookie } = await getCsrfToken(devCookie);

    const res = await request(app)
      .post(`/projects/${project.id}/submissions`)
      .set("Cookie", [devCookie, csrfCookie].filter(Boolean).join("; "))
      .set("x-csrf-token", csrfToken)
      .send({ notes: "Completed the authentication module." });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.notes).toBe("Completed the authentication module.");
  });

  test("client cannot add progress notes", async () => {
    const clientCookie = makeAuthCookie(clientUser);
    const { token: csrfToken, cookie: csrfCookie } = await getCsrfToken(clientCookie);

    const res = await request(app)
      .post(`/projects/${project.id}/submissions`)
      .set("Cookie", [clientCookie, csrfCookie].filter(Boolean).join("; "))
      .set("x-csrf-token", csrfToken)
      .send({ notes: "Client trying to add a note." });

    expect(res.status).toBe(403);
  });

  test("returns 400 for empty notes", async () => {
    const devCookie = makeAuthCookie(developerUser);
    const { token: csrfToken, cookie: csrfCookie } = await getCsrfToken(devCookie);

    const res = await request(app)
      .post(`/projects/${project.id}/submissions`)
      .set("Cookie", [devCookie, csrfCookie].filter(Boolean).join("; "))
      .set("x-csrf-token", csrfToken)
      .send({ notes: "" });

    expect(res.status).toBe(400);
  });
});

describe("PUT /projects/:projectId/submissions/:id (update note)", () => {
  test("developer can update their own note", async () => {
    const noteRes = await pool.query(
      "INSERT INTO project_submissions (project_id, notes) VALUES ($1, $2) RETURNING *",
      [project.id, "Original note"],
    );
    const noteId = noteRes.rows[0].id;

    const devCookie = makeAuthCookie(developerUser);
    const { token: csrfToken, cookie: csrfCookie } = await getCsrfToken(devCookie);

    const res = await request(app)
      .put(`/projects/${project.id}/submissions/${noteId}`)
      .set("Cookie", [devCookie, csrfCookie].filter(Boolean).join("; "))
      .set("x-csrf-token", csrfToken)
      .send({ notes: "Updated note content." });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test("IDOR: developer cannot update a note from a different project", async () => {
    const otherProject = await seedProject({ clientId: clientUser.id, assignedDeveloperId: developerUser.id, status: "active" });
    const noteRes = await pool.query(
      "INSERT INTO project_submissions (project_id, notes) VALUES ($1, $2) RETURNING *",
      [otherProject.id, "Note on other project"],
    );
    const noteId = noteRes.rows[0].id;

    const devCookie = makeAuthCookie(developerUser);
    const { token: csrfToken, cookie: csrfCookie } = await getCsrfToken(devCookie);

    // Try to update otherProject's note via project.id URL (IDOR attempt)
    const res = await request(app)
      .put(`/projects/${project.id}/submissions/${noteId}`)
      .set("Cookie", [devCookie, csrfCookie].filter(Boolean).join("; "))
      .set("x-csrf-token", csrfToken)
      .send({ notes: "Injected update." });

    expect(res.status).toBe(404);
  });
});

describe("DELETE /projects/:projectId/submissions/:id", () => {
  test("developer can delete their own note", async () => {
    const noteRes = await pool.query(
      "INSERT INTO project_submissions (project_id, notes) VALUES ($1, $2) RETURNING *",
      [project.id, "Note to delete"],
    );
    const noteId = noteRes.rows[0].id;

    const devCookie = makeAuthCookie(developerUser);
    const { token: csrfToken, cookie: csrfCookie } = await getCsrfToken(devCookie);

    const res = await request(app)
      .delete(`/projects/${project.id}/submissions/${noteId}`)
      .set("Cookie", [devCookie, csrfCookie].filter(Boolean).join("; "))
      .set("x-csrf-token", csrfToken);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Verify it's gone from DB
    const dbCheck = await pool.query("SELECT id FROM project_submissions WHERE id = $1", [noteId]);
    expect(dbCheck.rows).toHaveLength(0);
  });

  test("IDOR: developer cannot delete a note from a different project", async () => {
    const otherProject = await seedProject({ clientId: clientUser.id, assignedDeveloperId: developerUser.id, status: "active" });
    const noteRes = await pool.query(
      "INSERT INTO project_submissions (project_id, notes) VALUES ($1, $2) RETURNING *",
      [otherProject.id, "Note on other project"],
    );
    const noteId = noteRes.rows[0].id;

    const devCookie = makeAuthCookie(developerUser);
    const { token: csrfToken, cookie: csrfCookie } = await getCsrfToken(devCookie);

    const res = await request(app)
      .delete(`/projects/${project.id}/submissions/${noteId}`)
      .set("Cookie", [devCookie, csrfCookie].filter(Boolean).join("; "))
      .set("x-csrf-token", csrfToken);

    expect(res.status).toBe(404);

    // Verify the note still exists in the DB (was not deleted)
    const dbCheck = await pool.query("SELECT id FROM project_submissions WHERE id = $1", [noteId]);
    expect(dbCheck.rows).toHaveLength(1);
  });
});
