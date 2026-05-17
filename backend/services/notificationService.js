/**
 * notificationService.js
 * Central helper for creating persisted notifications and emitting
 * real-time socket events in one call.
 */
const pool = require("../config/db");
const logger = require("../utils/logger");

/**
 * Create a notification row and emit it via Socket.IO.
 *
 * @param {object} opts
 * @param {object} opts.io          - Socket.IO server instance
 * @param {number} opts.userId      - recipient user id
 * @param {string} opts.type        - notification type key (e.g. "new_bid")
 * @param {string} opts.message     - human-readable message
 * @param {object} [opts.meta]      - optional JSONB metadata
 */
async function createNotification({ io, userId, type, message, meta = null }) {
  try {
    // Ensure userId is always a number for consistent DB insert and room targeting
    const recipientId = Number(userId);

    const result = await pool.query(
      `INSERT INTO notifications (user_id, type, message, meta)
       VALUES ($1, $2, $3, $4)
       RETURNING id, user_id, type, message, is_read, meta, created_at`,
      [recipientId, type, message, meta ? JSON.stringify(meta) : null],
    );

    const notification = result.rows[0];

    if (io) {
      io.to(`user_${recipientId}`).emit("notification", notification);
    }

    return notification;
  } catch (err) {
    logger.error("createNotification error", err);
    return null;
  }
}

module.exports = { createNotification };
