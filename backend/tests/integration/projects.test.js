/**
 * Integration tests for project endpoints.
 *
 * Covers: create, list, get, discover, assigned, complete, review, urgent.
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

// ── Helpers ───────────────────────────────────────────────────────────────────
async function getCsrfToken(userCookie) {
  const res = await request(app)
    .get("/auth/csrf-token")
    .set("Cookie", userCookie);
  const csrfCookie = res.headers["set-cookie"]?.find((c) => c.startsWith("x-csrf-token="));
  return { token: res.body.csrfToken, cookie: csrfCookie };
}

const futureDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

const validProject = {
  title: "Build a React Dashboard",
  description: "We need a modern React dashboard with charts and real-time data.",
  minBudget: 500,
  maxBudget: 2000,
  dueDate: futureDate,
  tags: ["react", "javascript", "dashboard"],
};

// ── Tests ─────────────────────────────────────────────────────────────────────
let clientUser, developerUser;

beforeEach(async () => {
  await resetDb();
  clientUser = await seedUser({ username: "client1", email: "client@example.com", role: "client" });
  developerUser = await seedUser({ username: "dev1", email: "dev@example.com", role: "developer" });
});

describe("GET /health", () => {
  test("returns 200 with status ok", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    // Must not leak internal details
    expect(res.body.pool).toBeUndefined();
    expect(res.body.env).toBeUndefined();
  });
});

describe("POST /api/projects", () => {
  test("client can create a project", async () => {
    const clientCookie = makeAuthCookie(clientUser);
    const { token: csrfToken, cookie: csrfCookie } = await getCsrfToken(clientCookie);

    const res = await request(app)
      .post("/api/projects")
      .set("Cookie", [clientCookie, csrfCookie].filter(Boolean).join("; "))
      .set("x-csrf-token", csrfToken)
      .send(validProject);

    expect(res.status).toBe(201);
    expect(res.body.title).toBe(validProject.title);
    expect(res.body.client_id).toBe(clientUser.id);
    expect(res.body.status).toBe("bidding");
    // Tags should be normalized to lowercase
    expect(res.body.tags).toEqual(["react", "javascript", "dashboard"]);
  });

  test("developer cannot create a project", async () => {
    const devCookie = makeAuthCookie(developerUser);
    const { token: csrfToken, cookie: csrfCookie } = await getCsrfToken(devCookie);

    const res = await request(app)
      .post("/api/projects")
      .set("Cookie", [devCookie, csrfCookie].filter(Boolean).join("; "))
      .set("x-csrf-token", csrfToken)
      .send(validProject);

    expect(res.status).toBe(403);
  });

  test("returns 401 when not authenticated", async () => {
    const res = await request(app).post("/api/projects").send(validProject);
    expect(res.status).toBe(401);
  });

  test("returns 400 for missing title", async () => {
    const clientCookie = makeAuthCookie(clientUser);
    const { token: csrfToken, cookie: csrfCookie } = await getCsrfToken(clientCookie);

    const res = await request(app)
      .post("/api/projects")
      .set("Cookie", [clientCookie, csrfCookie].filter(Boolean).join("; "))
      .set("x-csrf-token", csrfToken)
      .send({ ...validProject, title: "" });

    expect(res.status).toBe(400);
  });

  test("returns 400 when minBudget >= maxBudget", async () => {
    const clientCookie = makeAuthCookie(clientUser);
    const { token: csrfToken, cookie: csrfCookie } = await getCsrfToken(clientCookie);

    const res = await request(app)
      .post("/api/projects")
      .set("Cookie", [clientCookie, csrfCookie].filter(Boolean).join("; "))
      .set("x-csrf-token", csrfToken)
      .send({ ...validProject, minBudget: 2000, maxBudget: 2000 });

    expect(res.status).toBe(400);
  });

  test("normalizes tags to lowercase", async () => {
    const clientCookie = makeAuthCookie(clientUser);
    const { token: csrfToken, cookie: csrfCookie } = await getCsrfToken(clientCookie);

    const res = await request(app)
      .post("/api/projects")
      .set("Cookie", [clientCookie, csrfCookie].filter(Boolean).join("; "))
      .set("x-csrf-token", csrfToken)
      .send({ ...validProject, tags: ["React", "JavaScript", "NODE.JS"] });

    expect(res.status).toBe(201);
    expect(res.body.tags).toEqual(["react", "javascript", "node.js"]);
  });
});

describe("GET /api/projects", () => {
  test("client sees their own projects", async () => {
    await seedProject({ title: "My Project", clientId: clientUser.id });
    await seedProject({ title: "Other Project", clientId: developerUser.id }); // different client

    const res = await request(app)
      .get("/api/projects")
      .set("Cookie", makeAuthCookie(clientUser));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].title).toBe("My Project");
    expect(res.body.pagination).toBeDefined();
  });

  test("returns 401 when not authenticated", async () => {
    const res = await request(app).get("/api/projects");
    expect(res.status).toBe(401);
  });

  test("developer cannot access client projects list", async () => {
    const res = await request(app)
      .get("/api/projects")
      .set("Cookie", makeAuthCookie(developerUser));

    expect(res.status).toBe(403);
  });

  test("pagination works correctly", async () => {
    for (let i = 0; i < 5; i++) {
      await seedProject({ title: `Project ${i}`, clientId: clientUser.id });
    }

    const res = await request(app)
      .get("/api/projects?page=1&limit=3")
      .set("Cookie", makeAuthCookie(clientUser));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(3);
    expect(res.body.pagination.total).toBe(5);
    expect(res.body.pagination.pages).toBe(2);
  });
});

describe("GET /api/projects/:id", () => {
  test("client can view their own project", async () => {
    const project = await seedProject({ clientId: clientUser.id });

    const res = await request(app)
      .get(`/api/projects/${project.id}`)
      .set("Cookie", makeAuthCookie(clientUser));

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(project.id);
    expect(res.body.submission_count).toBeDefined();
  });

  test("assigned developer can view the project", async () => {
    const project = await seedProject({
      clientId: clientUser.id,
      assignedDeveloperId: developerUser.id,
      status: "active",
    });

    const res = await request(app)
      .get(`/api/projects/${project.id}`)
      .set("Cookie", makeAuthCookie(developerUser));

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(project.id);
  });

  test("unrelated user gets 403", async () => {
    const project = await seedProject({ clientId: clientUser.id });
    const otherUser = await seedUser({ username: "other", email: "other@example.com", role: "developer" });

    const res = await request(app)
      .get(`/api/projects/${project.id}`)
      .set("Cookie", makeAuthCookie(otherUser));

    expect(res.status).toBe(403);
  });

  test("returns 404 for non-existent project", async () => {
    const res = await request(app)
      .get("/api/projects/99999")
      .set("Cookie", makeAuthCookie(clientUser));

    expect(res.status).toBe(404);
  });
});

describe("GET /projects (public listing)", () => {
  test("returns open and bidding projects without auth", async () => {
    await seedProject({ title: "Open Project", clientId: clientUser.id, status: "bidding" });
    await seedProject({ title: "Active Project", clientId: clientUser.id, status: "active" });

    const res = await request(app).get("/projects");

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].title).toBe("Open Project");
    // Must not expose client_id or sensitive fields
    expect(res.body.data[0].client_id).toBeUndefined();
  });

  test("returns correct pagination metadata", async () => {
    await seedProject({ title: "Project A", clientId: clientUser.id, status: "bidding" });
    await seedProject({ title: "Project B", clientId: clientUser.id, status: "bidding" });

    const res = await request(app).get("/projects?page=1&limit=1");

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.pagination.total).toBe(2);
    expect(res.body.pagination.pages).toBe(2);
    expect(res.body.pagination.page).toBe(1);
    expect(res.body.pagination.limit).toBe(1);
  });

  test("active/completed projects are excluded from public listing", async () => {
    await seedProject({ clientId: clientUser.id, status: "active", assignedDeveloperId: developerUser.id });
    await seedProject({ clientId: clientUser.id, status: "completed", assignedDeveloperId: developerUser.id });

    const res = await request(app).get("/projects");

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });
});

describe("GET /projects/discover/:id", () => {
  test("developer sees skill-matched projects", async () => {
    // Add skills to developer
    await pool.query(
      "INSERT INTO user_skills (user_id, skill) VALUES ($1, $2), ($1, $3)",
      [developerUser.id, "react", "javascript"],
    );

    await seedProject({ title: "React Project", clientId: clientUser.id, tags: ["react", "typescript"] });
    await seedProject({ title: "Python Project", clientId: clientUser.id, tags: ["python", "django"] });

    const res = await request(app)
      .get(`/projects/discover/${developerUser.id}`)
      .set("Cookie", makeAuthCookie(developerUser));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].title).toBe("React Project");
  });

  test("returns all projects when all=true", async () => {
    await seedProject({ title: "React Project", clientId: clientUser.id, tags: ["react"] });
    await seedProject({ title: "Python Project", clientId: clientUser.id, tags: ["python"] });

    const res = await request(app)
      .get(`/projects/discover/${developerUser.id}?all=true`)
      .set("Cookie", makeAuthCookie(developerUser));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
  });

  test("returns 403 when developer tries to access another user's feed", async () => {
    const otherDev = await seedUser({ username: "otherdev", email: "otherdev@example.com", role: "developer" });

    const res = await request(app)
      .get(`/projects/discover/${otherDev.id}`)
      .set("Cookie", makeAuthCookie(developerUser));

    expect(res.status).toBe(403);
  });

  test("returns empty array when developer has no skills", async () => {
    await seedProject({ clientId: clientUser.id, tags: ["react"] });

    const res = await request(app)
      .get(`/projects/discover/${developerUser.id}`)
      .set("Cookie", makeAuthCookie(developerUser));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });
});

describe("PATCH /projects/:id/urgent", () => {
  test("client can set a project as urgent", async () => {
    const project = await seedProject({ clientId: clientUser.id, assignedDeveloperId: developerUser.id, status: "active" });
    const clientCookie = makeAuthCookie(clientUser);
    const { token: csrfToken, cookie: csrfCookie } = await getCsrfToken(clientCookie);

    const res = await request(app)
      .patch(`/projects/${project.id}/urgent`)
      .set("Cookie", [clientCookie, csrfCookie].filter(Boolean).join("; "))
      .set("x-csrf-token", csrfToken)
      .send({ is_urgent: true });

    expect(res.status).toBe(200);
    expect(res.body.is_urgent).toBe(true);
  });

  test("returns 400 when is_urgent is not a boolean", async () => {
    const project = await seedProject({ clientId: clientUser.id });
    const clientCookie = makeAuthCookie(clientUser);
    const { token: csrfToken, cookie: csrfCookie } = await getCsrfToken(clientCookie);

    const res = await request(app)
      .patch(`/projects/${project.id}/urgent`)
      .set("Cookie", [clientCookie, csrfCookie].filter(Boolean).join("; "))
      .set("x-csrf-token", csrfToken)
      .send({ is_urgent: "yes" });

    expect(res.status).toBe(400);
  });

  test("developer cannot set urgency", async () => {
    const project = await seedProject({ clientId: clientUser.id, assignedDeveloperId: developerUser.id });
    const devCookie = makeAuthCookie(developerUser);
    const { token: csrfToken, cookie: csrfCookie } = await getCsrfToken(devCookie);

    const res = await request(app)
      .patch(`/projects/${project.id}/urgent`)
      .set("Cookie", [devCookie, csrfCookie].filter(Boolean).join("; "))
      .set("x-csrf-token", csrfToken)
      .send({ is_urgent: true });

    expect(res.status).toBe(403);
  });
});
