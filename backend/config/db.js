const { Pool } = require("pg");
const config = require("./env");
const logger = require("../utils/logger");

// ── Pool sizing ───────────────────────────────────────────────────────────────
// max: cap concurrent DB connections per process. Under PM2 cluster mode each
//      worker gets its own pool, so total = max × workers.
// idleTimeoutMillis: release idle clients after 30 s to avoid stale connections.
// connectionTimeoutMillis: fail fast (5 s) rather than queue indefinitely.
const POOL_CONFIG = {
  max: Number(process.env.DB_POOL_MAX || 20),
  idleTimeoutMillis: Number(process.env.DB_IDLE_TIMEOUT_MS || 30_000),
  connectionTimeoutMillis: Number(process.env.DB_CONN_TIMEOUT_MS || 5_000),
};

const pool = new Pool(
  config.db.connectionString
    ? { connectionString: config.db.connectionString, ssl: config.db.ssl, ...POOL_CONFIG }
    : {
        user: config.db.user,
        host: config.db.host,
        database: config.db.database,
        password: config.db.password,
        port: config.db.port,
        ssl: config.db.ssl,
        ...POOL_CONFIG,
      },
);

// ── Pool-level error handler ──────────────────────────────────────────────────
// Without this, an idle client error (e.g. DB restart) emits an unhandled
// 'error' event and crashes the Node process.
pool.on("error", (err) => {
  logger.error("pg pool idle client error", err);
});

pool.on("connect", () => {
  logger.debug("pg pool: new client connected");
});

module.exports = pool;
