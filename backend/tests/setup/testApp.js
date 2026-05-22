/**
 * testApp.js — Builds the Express app wired to the test DB pool.
 *
 * We override the `pg` pool module before requiring any controllers
 * so all DB calls in the app hit the test database.
 * Socket.IO is stubbed with a no-op so tests don't need a real WS server.
 */
process.env.NODE_ENV = "test";
process.env.REDIS_ENABLED = "false";
process.env.JWT_SECRET = "test-jwt-secret-not-for-production";
process.env.CSRF_SECRET = "test-csrf-secret-not-for-production";
process.env.JWT_EXPIRES_IN = "15m";
process.env.REFRESH_TOKEN_EXPIRES_DAYS = "30";
process.env.STORAGE_PROVIDER = "local";
process.env.UPLOAD_DIR = require("os").tmpdir();

const express = require("express");
const cookieParser = require("cookie-parser");
const { pool } = require("./testDb");

// ── Stub the shared DB pool before any controller is loaded ──────────────────
// Jest module registry is per-file, so this is safe.
jest.mock("../../config/db", () => {
  const { pool } = require("./testDb");
  return pool;
});

// ── Stub Redis so rate limiters and caches degrade gracefully ─────────────────
jest.mock("../../config/redis", () => ({
  pubClient: null,
  subClient: null,
  redisClient: null,
  REDIS_ENABLED: false,
}));

// ── Stub Sentry so it doesn't try to connect in tests ────────────────────────
jest.mock("../../config/sentry", () => ({
  sentryErrorHandler: (_err, _req, _res, next) => next(_err),
  captureSocketError: () => {},
  Sentry: { init: () => {}, withScope: () => {}, captureException: () => {} },
  DSN: null,
}));

const { applySecurity, corsOptions } = require("../../middleware/security");
const requestLogger = require("../../middleware/requestLogger");
const createRoutes = require("../../routes");

/**
 * Build a fresh Express app for each test suite.
 * Returns { app, io } where io is a minimal stub.
 */
function buildTestApp() {
  const app = express();

  // Minimal io stub — controllers call req.io.to(...).emit(...)
  const io = {
    to: () => ({ emit: () => {} }),
    in: () => ({ fetchSockets: async () => [] }),
  };

  applySecurity(app);
  app.use(requestLogger);
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: true, limit: "1mb" }));

  app.use(createRoutes(io));

  // Generic error handler
  app.use((err, req, res, _next) => {
    if (err.message === "Not allowed by CORS") return res.status(403).json({ message: "CORS origin denied" });
    if (err.code === "EBADCSRFTOKEN" || err.constructor?.name === "ForbiddenError") {
      return res.status(403).json({ code: "INVALID_CSRF_TOKEN", message: "Invalid or missing CSRF token" });
    }
    res.status(500).json({ message: err.message || "Internal server error" });
  });

  return { app, io };
}

module.exports = { buildTestApp };
