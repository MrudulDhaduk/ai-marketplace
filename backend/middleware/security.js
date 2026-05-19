const helmet = require("helmet");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const { RedisStore } = require("rate-limit-redis");
const hpp = require("hpp");
const config = require("../config/env");
const { redisClient, REDIS_ENABLED } = require("../config/redis");

const corsOptions = {
  origin(origin, callback) {
    if (!origin || config.cors.origins.includes(origin)) return callback(null, true);
    return callback(new Error("Not allowed by CORS"));
  },
  credentials: true,
};

// ── Rate limit store ──────────────────────────────────────────────────────────
// Use Redis when available so limits are shared across all instances.
// Falls back to in-memory (default) for single-instance / local dev.
function makeStore(prefix) {
  if (REDIS_ENABLED && redisClient) {
    return new RedisStore({
      sendCommand: (...args) => redisClient.call(...args),
      prefix: `rl:${prefix}:`,
    });
  }
  return undefined; // express-rate-limit default (in-memory)
}

const apiLimiter    = rateLimit({ windowMs: 15 * 60 * 1000, max: 500, standardHeaders: true, legacyHeaders: false, store: makeStore("api") });
const authLimiter   = rateLimit({ windowMs: 15 * 60 * 1000, max: 25,  standardHeaders: true, legacyHeaders: false, store: makeStore("auth") });
const uploadLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 60,  standardHeaders: true, legacyHeaders: false, store: makeStore("upload") });

function applySecurity(app) {
  app.disable("x-powered-by");
  app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
  app.use(cors(corsOptions));
  app.use(hpp());
  app.use(apiLimiter);
}

module.exports = { applySecurity, corsOptions, authLimiter, uploadLimiter };
