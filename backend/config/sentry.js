/**
 * sentry.js — Sentry initialisation for the backend
 *
 * Must be required BEFORE any other module so Sentry can instrument
 * the Node.js runtime. Import this as the very first line of server.js.
 *
 * No-ops silently when SENTRY_DSN is not set (local dev / CI).
 */
const Sentry = require("@sentry/node");

const DSN = process.env.SENTRY_DSN;

if (DSN) {
  Sentry.init({
    dsn: DSN,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || "development",
    release: process.env.APP_VERSION || undefined,

    // Capture 100% of transactions in dev, 10% in production
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,

    // Attach request data (URL, method, headers) to every event
    // User IP is NOT sent — privacy-safe by default
    sendDefaultPii: false,
  });
}

/**
 * Express error handler middleware — must be registered AFTER all routes.
 * Forwards errors to Sentry then calls next(err) so the app error handler
 * can still send the HTTP response.
 */
function sentryErrorHandler(err, req, res, next) {
  if (DSN) {
    Sentry.withScope((scope) => {
      // Attach authenticated user id when available
      if (req.user?.id) {
        scope.setUser({ id: String(req.user.id) });
      }
      // Attach request correlation ID
      if (req.id) {
        scope.setTag("reqId", req.id);
      }
      Sentry.captureException(err);
    });
  }
  next(err);
}

/**
 * Capture a socket-level error with context.
 */
function captureSocketError(err, context = {}) {
  if (!DSN) return;
  Sentry.withScope((scope) => {
    scope.setTag("layer", "socket");
    for (const [k, v] of Object.entries(context)) scope.setExtra(k, v);
    Sentry.captureException(err);
  });
}

module.exports = { sentryErrorHandler, captureSocketError, Sentry, DSN };
