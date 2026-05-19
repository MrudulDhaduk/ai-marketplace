/**
 * Structured logger — replaces raw console.log/console.error throughout the backend.
 *
 * Features:
 *  - JSON output on every line (machine-parseable by Datadog, CloudWatch, etc.)
 *  - LOG_LEVEL env var controls verbosity (debug | info | warn | error)
 *  - Accepts an optional `context` object for request correlation IDs
 *  - Error objects are serialised with message + stack (stack hidden in prod)
 */

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const isProduction = process.env.NODE_ENV === "production";
const configuredLevel = LEVELS[process.env.LOG_LEVEL] ?? (isProduction ? LEVELS.info : LEVELS.debug);

function serialize(level, message, meta) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    message,
    env: process.env.NODE_ENV || "development",
  };

  if (meta instanceof Error) {
    entry.error = meta.message;
    entry.errorType = meta.name;
    if (!isProduction) entry.stack = meta.stack;
  } else if (meta !== undefined && meta !== null) {
    // Spread flat objects directly so fields are top-level (easier to query in log tools)
    if (typeof meta === "object" && !Array.isArray(meta)) {
      Object.assign(entry, meta);
    } else {
      entry.meta = meta;
    }
  }

  return JSON.stringify(entry);
}

const logger = {
  debug(message, meta) {
    if (configuredLevel <= LEVELS.debug) console.debug(serialize("debug", message, meta));
  },
  info(message, meta) {
    if (configuredLevel <= LEVELS.info) console.log(serialize("info", message, meta));
  },
  warn(message, meta) {
    if (configuredLevel <= LEVELS.warn) console.warn(serialize("warn", message, meta));
  },
  error(message, meta) {
    if (configuredLevel <= LEVELS.error) console.error(serialize("error", message, meta));
  },

  /**
   * Returns a child logger that merges `context` into every log entry.
   * Use for request-scoped logging: const log = logger.child({ reqId, userId });
   */
  child(context) {
    return {
      debug: (msg, meta) => logger.debug(msg, { ...context, ...flatMeta(meta) }),
      info:  (msg, meta) => logger.info(msg,  { ...context, ...flatMeta(meta) }),
      warn:  (msg, meta) => logger.warn(msg,  { ...context, ...flatMeta(meta) }),
      error: (msg, meta) => logger.error(msg, { ...context, ...flatMeta(meta) }),
    };
  },
};

function flatMeta(meta) {
  if (!meta) return {};
  if (meta instanceof Error) return { error: meta.message, errorType: meta.name, stack: !isProduction ? meta.stack : undefined };
  if (typeof meta === "object" && !Array.isArray(meta)) return meta;
  return { meta };
}

module.exports = logger;
