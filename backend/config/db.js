const { Pool } = require("pg");
const config = require("./env");
const logger = require("../utils/logger");

// ── Pool sizing ───────────────────────────────────────────────────────────────
// max:                     cap concurrent DB connections per process. Under PM2
//                          cluster mode each worker gets its own pool, so
//                          total connections = max × workers.
// min:                     keep 2 warm connections so the first request after
//                          an idle period doesn't pay new-connection latency.
// idleTimeoutMillis:       release idle clients after 30 s to avoid stale
//                          connections accumulating.
// connectionTimeoutMillis: fail fast (5 s) rather than queue indefinitely when
//                          the pool is exhausted.
// statement_timeout:       kill any query that runs longer than 10 s. Without
//                          this a single runaway query holds a connection
//                          indefinitely — 20 concurrent slow queries fully
//                          exhaust the pool and bring the API down.
//                          10 s is well above the slowest legitimate query
//                          (~2–3 s for a large activity feed) while still
//                          catching lock waits and missing-index full scans.
// allowExitOnIdle:         let the process exit cleanly when all clients are
//                          idle (important for graceful shutdown under PM2).
const POOL_CONFIG = {
  max:                     Number(process.env.DB_POOL_MAX          || 20),
  min:                     Number(process.env.DB_POOL_MIN          || 2),
  idleTimeoutMillis:       Number(process.env.DB_IDLE_TIMEOUT_MS   || 30_000),
  connectionTimeoutMillis: Number(process.env.DB_CONN_TIMEOUT_MS   || 5_000),
  statement_timeout:       Number(process.env.DB_STATEMENT_TIMEOUT || 10_000),
  allowExitOnIdle:         true,
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
