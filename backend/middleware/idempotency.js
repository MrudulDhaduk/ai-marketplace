/**
 * idempotency.js — Server-side idempotency key middleware
 *
 * Prevents duplicate mutations caused by network retries or double-clicks.
 * Clients send an `Idempotency-Key` header (UUID v4 recommended) with any
 * state-changing request. The server:
 *   1. Checks if the key was already processed (Redis or in-memory fallback).
 *   2. If yes — returns the cached response immediately (no re-execution).
 *   3. If no  — executes the handler, caches the response, returns it.
 *
 * TTL: 24 hours (keys expire automatically).
 * Scope: per-user — the same key from two different users is treated as distinct.
 *
 * Usage in routes:
 *   router.post("/projects/:id/bid", authenticateUser, idempotency(), bidController.placeBid);
 */

const { redisClient, REDIS_ENABLED } = require("../config/redis");
const logger = require("../utils/logger");

const TTL_SECONDS = 24 * 60 * 60; // 24 hours

// In-memory fallback for environments without Redis.
// Not suitable for multi-instance deployments — use Redis in production.
const memoryStore = new Map();

function memoryGet(key) {
  const entry = memoryStore.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    memoryStore.delete(key);
    return null;
  }
  return entry.value;
}

function memorySet(key, value) {
  memoryStore.set(key, { value, expiresAt: Date.now() + TTL_SECONDS * 1000 });
}

async function storeGet(key) {
  if (REDIS_ENABLED && redisClient) {
    const val = await redisClient.get(key);
    return val ? JSON.parse(val) : null;
  }
  return memoryGet(key);
}

async function storeSet(key, value) {
  if (REDIS_ENABLED && redisClient) {
    await redisClient.set(key, JSON.stringify(value), "EX", TTL_SECONDS);
  } else {
    memorySet(key, value);
  }
}

/**
 * idempotency() — returns Express middleware.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.required=false] - If true, reject requests missing the header.
 */
function idempotency({ required = false } = {}) {
  return async (req, res, next) => {
    const rawKey = req.headers["idempotency-key"];

    if (!rawKey) {
      if (required) {
        return res.status(400).json({ message: "Idempotency-Key header is required" });
      }
      return next(); // key is optional — proceed without idempotency
    }

    // Validate key format (max 128 chars, printable ASCII)
    if (typeof rawKey !== "string" || rawKey.length > 128 || !/^[\x20-\x7E]+$/.test(rawKey)) {
      return res.status(400).json({ message: "Invalid Idempotency-Key format" });
    }

    // Scope key to the authenticated user to prevent cross-user replay
    const userId = req.user?.id ?? "anon";
    const storeKey = `idem:${userId}:${rawKey}`;

    try {
      const cached = await storeGet(storeKey);

      if (cached) {
        logger.debug("Idempotency cache hit", { key: rawKey, userId });
        // Replay the original response
        return res
          .status(cached.status)
          .set(cached.headers)
          .json(cached.body);
      }

      // Intercept res.json to capture the response for caching
      const originalJson = res.json.bind(res);
      res.json = async function (body) {
        // Only cache successful responses (2xx)
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            await storeSet(storeKey, {
              status: res.statusCode,
              headers: { "Content-Type": "application/json" },
              body,
            });
          } catch (err) {
            logger.error("Idempotency store write failed", { key: rawKey, err });
          }
        }
        return originalJson(body);
      };

      next();
    } catch (err) {
      logger.error("Idempotency middleware error", err);
      // Non-fatal — proceed without idempotency protection on store failure
      next();
    }
  };
}

module.exports = { idempotency };

// ── Test helper ───────────────────────────────────────────────────────────────
// Clears the in-memory store between test suites so cached responses from one
// suite don't bleed into the next. Only used in test environments.
/* istanbul ignore next */
function clearStoreForTesting() {
  memoryStore.clear();
}

module.exports = { idempotency, clearStoreForTesting };
