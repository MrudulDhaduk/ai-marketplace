const pool = require("../config/db");
const logger = require("../utils/logger");

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

/**
 * GET /notifications
 * Returns paginated notifications for the authenticated user.
 * Assumes a `notifications` table with columns:
 *   id, user_id, type, message, is_read, created_at, meta (jsonb)
 */
async function getNotifications(req, res) {
  try {
    const userId = req.user.id;
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(req.query.limit) || DEFAULT_PAGE_SIZE));
    const offset = (page - 1) * limit;

    const [dataResult, countResult] = await Promise.all([
      pool.query(
        `SELECT * FROM notifications
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT $2 OFFSET $3`,
        [userId, limit, offset],
      ),
      pool.query(
        "SELECT COUNT(*)::int AS total FROM notifications WHERE user_id = $1",
        [userId],
      ),
    ]);

    const total = countResult.rows[0].total;

    res.json({
      data: dataResult.rows,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    logger.error("getNotifications error", err);
    res.status(500).json({ message: "Failed to fetch notifications" });
  }
}

/**
 * PUT /notifications/:id/read
 * Marks a single notification as read.
 */
async function markRead(req, res) {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const result = await pool.query(
      `UPDATE notifications
       SET is_read = true
       WHERE id = $1 AND user_id = $2
       RETURNING *`,
      [id, userId],
    );

    if (!result.rows.length) {
      return res.status(404).json({ message: "Notification not found" });
    }

    res.json({ message: "Marked as read", notification: result.rows[0] });
  } catch (err) {
    logger.error("markRead error", err);
    res.status(500).json({ message: "Failed to mark notification as read" });
  }
}

/**
 * PUT /notifications/read-all
 * Marks all notifications for the user as read.
 */
async function markAllRead(req, res) {
  try {
    const userId = req.user.id;

    await pool.query(
      "UPDATE notifications SET is_read = true WHERE user_id = $1 AND is_read = false",
      [userId],
    );

    res.json({ message: "All notifications marked as read" });
  } catch (err) {
    logger.error("markAllRead error", err);
    res.status(500).json({ message: "Failed to mark notifications as read" });
  }
}

module.exports = { getNotifications, markRead, markAllRead };
