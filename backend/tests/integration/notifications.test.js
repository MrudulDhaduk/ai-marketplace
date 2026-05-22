/**
 * Integration tests for notification endpoints.
 *
 * Covers: get notifications, mark read, mark all read.
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

async function seedNotification(userId, { type = "new_bid", message = "Test notification", isRead = false } = {}) {
  const res = await pool.query(
    "INSERT INTO notifications (user_id, type, message, is_read) VALUES ($1, $2, $3, $4) RETURNING *",
    [userId, type, message, isRead],
  );
  return res.rows[0];
}

let user1, user2;

beforeEach(async () => {
  await resetDb();
  user1 = await seedUser({ username: "user1", email: "user1@example.com", role: "client" });
  user2 = await seedUser({ username: "user2", email: "user2@example.com", role: "developer" });
});

describe("GET /notifications", () => {
  test("returns notifications for the authenticated user", async () => {
    await seedNotification(user1.id, { message: "User1 notification" });
    await seedNotification(user2.id, { message: "User2 notification" }); // should not appear

    const res = await request(app)
      .get("/notifications")
      .set("Cookie", makeAuthCookie(user1));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].message).toBe("User1 notification");
    expect(res.body.pagination).toBeDefined();
  });

  test("returns empty array when user has no notifications", async () => {
    const res = await request(app)
      .get("/notifications")
      .set("Cookie", makeAuthCookie(user1));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
    expect(res.body.pagination.total).toBe(0);
  });

  test("returns 401 when not authenticated", async () => {
    const res = await request(app).get("/notifications");
    expect(res.status).toBe(401);
  });

  test("pagination works correctly", async () => {
    for (let i = 0; i < 5; i++) {
      await seedNotification(user1.id, { message: `Notification ${i}` });
    }

    const res = await request(app)
      .get("/notifications?page=1&limit=3")
      .set("Cookie", makeAuthCookie(user1));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(3);
    expect(res.body.pagination.total).toBe(5);
    expect(res.body.pagination.pages).toBe(2);
  });

  test("notifications are ordered by created_at DESC (newest first)", async () => {
    const n1 = await seedNotification(user1.id, { message: "First" });
    const n2 = await seedNotification(user1.id, { message: "Second" });

    const res = await request(app)
      .get("/notifications")
      .set("Cookie", makeAuthCookie(user1));

    expect(res.status).toBe(200);
    // Second notification should appear first (newer)
    expect(res.body.data[0].id).toBe(n2.id);
    expect(res.body.data[1].id).toBe(n1.id);
  });
});

describe("PUT /notifications/:id/read", () => {
  test("marks a notification as read", async () => {
    const notification = await seedNotification(user1.id, { isRead: false });
    const userCookie = makeAuthCookie(user1);
    const { token: csrfToken, cookie: csrfCookie } = await getCsrfToken(userCookie);

    const res = await request(app)
      .put(`/notifications/${notification.id}/read`)
      .set("Cookie", [userCookie, csrfCookie].filter(Boolean).join("; "))
      .set("x-csrf-token", csrfToken);

    expect(res.status).toBe(200);
    expect(res.body.notification.is_read).toBe(true);

    // Verify in DB
    const dbCheck = await pool.query("SELECT is_read FROM notifications WHERE id = $1", [notification.id]);
    expect(dbCheck.rows[0].is_read).toBe(true);
  });

  test("returns 404 when notification does not belong to user (IDOR check)", async () => {
    const notification = await seedNotification(user2.id); // belongs to user2
    const userCookie = makeAuthCookie(user1);
    const { token: csrfToken, cookie: csrfCookie } = await getCsrfToken(userCookie);

    const res = await request(app)
      .put(`/notifications/${notification.id}/read`)
      .set("Cookie", [userCookie, csrfCookie].filter(Boolean).join("; "))
      .set("x-csrf-token", csrfToken);

    expect(res.status).toBe(404);
  });

  test("returns 401 when not authenticated", async () => {
    const notification = await seedNotification(user1.id);
    const res = await request(app).put(`/notifications/${notification.id}/read`);
    expect(res.status).toBe(401);
  });
});

describe("PUT /notifications/read-all", () => {
  test("marks all user notifications as read", async () => {
    await seedNotification(user1.id, { isRead: false });
    await seedNotification(user1.id, { isRead: false });
    await seedNotification(user2.id, { isRead: false }); // should not be affected

    const userCookie = makeAuthCookie(user1);
    const { token: csrfToken, cookie: csrfCookie } = await getCsrfToken(userCookie);

    const res = await request(app)
      .put("/notifications/read-all")
      .set("Cookie", [userCookie, csrfCookie].filter(Boolean).join("; "))
      .set("x-csrf-token", csrfToken);

    expect(res.status).toBe(200);

    // Verify user1's notifications are all read
    const user1Notifs = await pool.query(
      "SELECT is_read FROM notifications WHERE user_id = $1",
      [user1.id],
    );
    expect(user1Notifs.rows.every((n) => n.is_read)).toBe(true);

    // Verify user2's notification is still unread
    const user2Notifs = await pool.query(
      "SELECT is_read FROM notifications WHERE user_id = $1",
      [user2.id],
    );
    expect(user2Notifs.rows[0].is_read).toBe(false);
  });

  test("returns 401 when not authenticated", async () => {
    const res = await request(app).put("/notifications/read-all");
    expect(res.status).toBe(401);
  });
});
