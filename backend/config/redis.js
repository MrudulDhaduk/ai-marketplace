/**
 * redis.js — shared Redis client factory
 *
 * Returns a connected ioredis client when REDIS_URL is set and
 * REDIS_ENABLED !== "false". Returns null otherwise so callers can
 * degrade gracefully (single-instance mode).
 *
 * Usage:
 *   const { pubClient, subClient } = require('./config/redis');
 *   if (pubClient) { ... use Redis ... }
 */
const Redis = require("ioredis");
const logger = require("../utils/logger");

const REDIS_ENABLED = process.env.REDIS_ENABLED !== "false";
const REDIS_URL = process.env.REDIS_URL;

function createClient(name) {
  if (!REDIS_ENABLED || !REDIS_URL) return null;

  const client = new Redis(REDIS_URL, {
    // Reconnect with exponential back-off, max 30 s
    retryStrategy(times) {
      const delay = Math.min(times * 200, 30_000);
      logger.warn(`Redis ${name}: reconnect attempt ${times}, next in ${delay}ms`);
      return delay;
    },
    // Don't buffer commands while disconnected — fail fast
    enableOfflineQueue: false,
    lazyConnect: false,
    maxRetriesPerRequest: 3,
  });

  client.on("connect", () => logger.info(`Redis ${name}: connected`));
  client.on("ready",   () => logger.info(`Redis ${name}: ready`));
  client.on("error",   (err) => logger.error(`Redis ${name}: error`, err));
  client.on("close",   () => logger.warn(`Redis ${name}: connection closed`));

  return client;
}

// Socket.IO adapter needs two separate clients (pub + sub)
const pubClient = createClient("pub");
const subClient = pubClient ? pubClient.duplicate() : null;

// A general-purpose client for rate limiting etc.
const redisClient = pubClient ? pubClient.duplicate() : null;

module.exports = { pubClient, subClient, redisClient, REDIS_ENABLED: REDIS_ENABLED && !!REDIS_URL };
