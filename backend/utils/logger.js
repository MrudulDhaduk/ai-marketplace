/**
 * Structured logger — replaces raw console.log/console.error throughout the backend.
 * In production, swap the transport here for Winston, Pino, or a cloud log service.
 */

const isProduction = process.env.NODE_ENV === "production";

function formatMessage(level, message, meta) {
  const ts = new Date().toISOString();
  const base = { ts, level, message };
  if (meta instanceof Error) {
    base.error = meta.message;
    if (!isProduction) base.stack = meta.stack;
  } else if (meta !== undefined) {
    base.meta = meta;
  }
  return JSON.stringify(base);
}

const logger = {
  info(message, meta) {
    console.log(formatMessage("info", message, meta));
  },
  warn(message, meta) {
    console.warn(formatMessage("warn", message, meta));
  },
  error(message, meta) {
    console.error(formatMessage("error", message, meta));
  },
  debug(message, meta) {
    if (!isProduction) {
      console.debug(formatMessage("debug", message, meta));
    }
  },
};

module.exports = logger;
