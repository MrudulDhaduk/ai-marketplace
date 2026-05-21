/**
 * socketRateLimiter.js — Per-socket in-memory rate limiter
 *
 * Phase 4 scope: simple in-memory limiter per socket connection.
 * Redis-backed distributed limiting is Phase 5.
 *
 * Uses a sliding window counter per (socketId, eventType).
 * The Map is keyed by socketId and cleaned up on disconnect.
 *
 * Usage:
 *   const limiter = createSocketRateLimiter();
 *   limiter.check(socket, "typing")   → true (allowed) | false (drop)
 *   limiter.cleanup(socket.id)        → call on disconnect
 */

const logger = require("../utils/logger");

// ── Thresholds ────────────────────────────────────────────────────────────────
// Format: { windowMs, max, disconnectAfterViolations }
// disconnectAfterViolations: null = never disconnect (silent drop only)
const THRESHOLDS = {
  typing:        { windowMs: 1000,  max: 5,  disconnectAfterViolations: null },
  join_project:  { windowMs: 60000, max: 15, disconnectAfterViolations: 10   },
  leave_project: { windowMs: 60000, max: 15, disconnectAfterViolations: null },
  register:      { windowMs: 60000, max: 10, disconnectAfterViolations: null },
  replay_next:   { windowMs: 10000, max: 5,  disconnectAfterViolations: 5    },
  _unknown:      { windowMs: 10000, max: 5,  disconnectAfterViolations: 3    },
};

function createSocketRateLimiter() {
  // Map<socketId, { counters: Map<eventType, { count, windowStart }>, violations: number }>
  const state = new Map();

  /**
   * Check if the event is within rate limit for this socket.
   * Returns true if allowed, false if should be dropped.
   * Side effect: may call socket.disconnect() if violations exceed threshold.
   */
  function check(socket, eventType) {
    const threshold = THRESHOLDS[eventType] || THRESHOLDS._unknown;
    const { windowMs, max, disconnectAfterViolations } = threshold;

    if (!state.has(socket.id)) {
      state.set(socket.id, { counters: new Map(), violations: 0 });
    }

    const socketState = state.get(socket.id);
    const now = Date.now();

    if (!socketState.counters.has(eventType)) {
      socketState.counters.set(eventType, { count: 0, windowStart: now });
    }

    const counter = socketState.counters.get(eventType);

    // Reset window if expired
    if (now - counter.windowStart >= windowMs) {
      counter.count = 0;
      counter.windowStart = now;
    }

    counter.count++;

    if (counter.count > max) {
      socketState.violations++;

      logger.debug("socket rate limit hit", {
        socketId: socket.id,
        userId:   socket.user?.id,
        event:    eventType,
        count:    counter.count,
        max,
        violations: socketState.violations,
      });

      // Disconnect if violation threshold reached
      if (
        disconnectAfterViolations !== null &&
        socketState.violations >= disconnectAfterViolations
      ) {
        logger.warn("socket disconnected for rate limit abuse", {
          socketId:   socket.id,
          userId:     socket.user?.id,
          event:      eventType,
          violations: socketState.violations,
        });
        try {
          socket.emit("system:rate_limit_exceeded", {
            reason: "Too many events. Connection closed.",
          });
          socket.disconnect(true);
        } catch (_) { /* socket may already be gone */ }
      }

      return false; // drop the event
    }

    return true; // allow
  }

  /** Call on socket disconnect to free memory */
  function cleanup(socketId) {
    state.delete(socketId);
  }

  /** Expose state size for monitoring */
  function size() {
    return state.size;
  }

  return { check, cleanup, size };
}

// Export a singleton — one limiter instance for the whole server process
const rateLimiter = createSocketRateLimiter();
module.exports = rateLimiter;
