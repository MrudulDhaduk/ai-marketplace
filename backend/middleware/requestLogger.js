/**
 * requestLogger.js
 *
 * Attaches a unique request ID to every incoming request and logs
 * method + path + status + duration on completion.
 *
 * The `reqId` is available as `req.id` and forwarded in the
 * `X-Request-Id` response header so it can be correlated in
 * frontend error reports and Sentry breadcrumbs.
 */
const { randomUUID } = require("crypto");
const logger = require("../utils/logger");

function requestLogger(req, res, next) {
  const reqId = req.headers["x-request-id"] || randomUUID();
  req.id = reqId;
  res.setHeader("X-Request-Id", reqId);

  const start = Date.now();

  res.on("finish", () => {
    const ms = Date.now() - start;
    const level = res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info";
    logger[level]("http request", {
      reqId,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      ms,
      userId: req.user?.id ?? null,
    });
  });

  next();
}

module.exports = requestLogger;
