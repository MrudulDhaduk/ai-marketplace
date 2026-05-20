// ── Sentry must be initialised before any other require ──────────────────────
require("./config/sentry");
const { sentryErrorHandler } = require("./config/sentry");

const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");
const { createAdapter } = require("@socket.io/redis-adapter");
const config = require("./config/env");
const { applySecurity, corsOptions } = require("./middleware/security");
const requestLogger = require("./middleware/requestLogger");
const createRoutes = require("./routes");
const setupSockets = require("./sockets");
const logger = require("./utils/logger");
const { pubClient, subClient, REDIS_ENABLED } = require("./config/redis");

// ── Import pool for graceful shutdown drain ───────────────────────────────────
const pool = require("./config/db");

// ── Conditionally import uploadDir (only used for local disk storage) ─────────
let uploadDir;
try {
  uploadDir = require("./services/uploadService").uploadDir;
} catch {
  uploadDir = null;
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: corsOptions });

// ── Redis adapter for horizontal scaling ──────────────────────────────────────
// When REDIS_URL is set, Socket.IO events fan out across all instances via
// Redis pub/sub. Room logic and event semantics are unchanged.
if (REDIS_ENABLED && pubClient && subClient) {
  io.adapter(createAdapter(pubClient, subClient));
  logger.info("Socket.IO: Redis adapter enabled");
} else {
  logger.info("Socket.IO: using in-memory adapter (single-instance mode)");
}

applySecurity(app);
app.use(requestLogger);
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

setupSockets(io);
app.use(createRoutes(io));

// Serve local uploads only when disk storage is active.
// Files are gated behind authentication — the static middleware runs AFTER
// authenticateUser so unauthenticated requests get a 401, not the file.
if (uploadDir) {
  const { authenticateUser } = require("./middleware/auth");
  app.use("/uploads", authenticateUser, express.static(uploadDir, { dotfiles: "deny", index: false, maxAge: 0 }));
}

// ── Error handlers (order matters) ───────────────────────────────────────────
// 1. Sentry captures the error with request context
app.use(sentryErrorHandler);
// 2. App sends the HTTP response
app.use((err, req, res, next) => {
  if (err.message === "Not allowed by CORS") return res.status(403).json({ message: "CORS origin denied" });
  // csrf-csrf throws ForbiddenError for invalid/missing CSRF tokens
  if (err.code === "EBADCSRFTOKEN" || err.constructor?.name === "ForbiddenError" || err.message === "invalid csrf token") {
    return res.status(403).json({ code: "INVALID_CSRF_TOKEN", message: "Invalid or missing CSRF token" });
  }
  logger.error("Unhandled request error", err);
  res.status(500).json({ message: "Internal server error" });
});
// ── Graceful shutdown ─────────────────────────────────────────────────────────
// Handles SIGTERM (Docker/Kubernetes stop) and SIGINT (Ctrl-C / PM2 reload).
// Order: stop accepting → drain HTTP → close sockets → drain DB pool.
const SHUTDOWN_TIMEOUT_MS = Number(process.env.SHUTDOWN_TIMEOUT_MS || 10_000);

async function gracefulShutdown(signal) {
  logger.info(`Received ${signal} — starting graceful shutdown`);

  // 1. Stop accepting new HTTP connections
  server.close(async () => {
    logger.info("HTTP server closed");

    // 2. Close Socket.IO (waits for in-flight events)
    io.close(async () => {
      logger.info("Socket.IO server closed");

      // 3. Drain the DB pool
      try {
        await pool.end();
        logger.info("DB pool drained");
      } catch (err) {
        logger.error("DB pool drain error", err);
      }

      // 4. Disconnect Redis clients
      const { pubClient: pub, subClient: sub, redisClient: rc } = require("./config/redis");
      for (const [name, client] of [["pub", pub], ["sub", sub], ["redis", rc]]) {
        if (client) {
          try { await client.quit(); logger.info(`Redis ${name}: disconnected`); }
          catch (e) { logger.error(`Redis ${name}: disconnect error`, e); }
        }
      }

      logger.info("Graceful shutdown complete");
      process.exit(0);
    });
  });

  // Force-exit if shutdown takes too long (prevents hanging deploys)
  setTimeout(() => {
    logger.error("Graceful shutdown timed out — forcing exit");
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS).unref();
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT",  () => gracefulShutdown("SIGINT"));

// ── Unhandled rejection / exception safety net ───────────────────────────────
process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled promise rejection", reason instanceof Error ? reason : new Error(String(reason)));
});

process.on("uncaughtException", (err) => {
  logger.error("Uncaught exception — shutting down", err);
  gracefulShutdown("uncaughtException");
});

if (require.main === module) {
  server.listen(config.port, () => {
    logger.info("Server running", { port: config.port, env: config.nodeEnv });
  });
}

module.exports = { app, server, io };
