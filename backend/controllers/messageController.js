const pool = require("../config/db");
const logger = require("../utils/logger");
const { createNotification } = require("../services/notificationService");
const { EVENTS, emitTypedEvent } = require("../sockets/socketEvents");

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

/**
 * GET /projects/:id/messages
 * Returns paginated messages for a project.
 * Only the client and assigned developer can read messages.
 */
async function getMessages(req, res) {
  try {
    const { id: projectId } = req.params;
    const userId = req.user.id;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(req.query.limit) || DEFAULT_PAGE_SIZE));
    const offset = (page - 1) * limit;

    const projectRes = await pool.query(
      "SELECT client_id, assigned_developer_id FROM projects WHERE id = $1",
      [projectId],
    );

    if (!projectRes.rows.length) return res.status(404).json({ message: "Project not found" });

    const p = projectRes.rows[0];
    if (Number(p.client_id) !== userId && Number(p.assigned_developer_id) !== userId) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    const [dataResult, countResult] = await Promise.all([
      pool.query(
        `SELECT
           m.id, m.body, m.is_read, m.created_at,
           m.sender_id, m.receiver_id,
           u.username AS sender_username
         FROM messages m
         JOIN users u ON m.sender_id = u.id
         WHERE m.project_id = $1
         ORDER BY m.created_at ASC
         LIMIT $2 OFFSET $3`,
        [projectId, limit, offset],
      ),
      pool.query(
        "SELECT COUNT(*)::int AS total FROM messages WHERE project_id = $1",
        [projectId],
      ),
    ]);

    // Mark messages sent to this user as read
    await pool.query(
      "UPDATE messages SET is_read = true WHERE project_id = $1 AND receiver_id = $2 AND is_read = false",
      [projectId, userId],
    );

    const total = countResult.rows[0].total;
    res.json({
      data: dataResult.rows,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    logger.error("getMessages error", err);
    res.status(500).json({ message: "Failed to fetch messages" });
  }
}

/**
 * POST /projects/:id/messages
 * Send a message in a project thread.
 */
async function sendMessage(req, res) {
  try {
    const { id: projectId } = req.params;
    const senderId = req.user.id;
    const { body } = req.body;

    if (!body || typeof body !== "string" || !body.trim()) {
      return res.status(400).json({ message: "Message body is required" });
    }
    if (body.trim().length > 4000) {
      return res.status(400).json({ message: "Message too long (max 4000 chars)" });
    }

    const projectRes = await pool.query(
      "SELECT client_id, assigned_developer_id, title FROM projects WHERE id = $1",
      [projectId],
    );

    if (!projectRes.rows.length) return res.status(404).json({ message: "Project not found" });

    const p = projectRes.rows[0];
    const isClient = Number(p.client_id) === senderId;
    const isDeveloper = Number(p.assigned_developer_id) === senderId;

    if (!isClient && !isDeveloper) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    // Receiver is the other party
    const receiverId = isClient ? Number(p.assigned_developer_id) : Number(p.client_id);

    if (!receiverId) {
      return res.status(400).json({ message: "No recipient — project has no assigned developer yet" });
    }

    const result = await pool.query(
      `INSERT INTO messages (project_id, sender_id, receiver_id, body)
       VALUES ($1, $2, $3, $4)
       RETURNING id, project_id, sender_id, receiver_id, body, is_read, created_at`,
      [projectId, senderId, receiverId, body.trim()],
    );

    const message = result.rows[0];

    // Emit real-time event to the project room
    const seqId = Date.now();

    // ── Typed events (Phase 4) ──────────────────────────────────────────────
    emitTypedEvent(req.io.to(`project_${projectId}`), EVENTS.MESSAGE_SENT, {
      projectId:  Number(projectId),
      actorId:    senderId,
      actorName:  req.user.username,
      actorRole:  isClient ? "client" : "developer",
      seqId,
      data: {
        messageId:      message.id,
        body:           message.body,
        senderId:       message.sender_id,
        receiverId:     message.receiver_id,
        senderUsername: req.user.username,
        isRead:         false,
        createdAt:      message.created_at,
      },
    });

    // Emit typing-stopped to clear indicator
    req.io.to(`project_${projectId}`).emit("typing", {
      userId: senderId,
      typing: false,
    });

    // Persist notification for receiver
    await createNotification({
      io: req.io,
      userId: receiverId,
      type: "new_message",
      message: `New message on "${p.title}" from ${req.user.username}`,
      meta: { projectId: Number(projectId), senderId },
    });

    res.status(201).json({ message: "Message sent", data: { ...message, sender_username: req.user.username } });
  } catch (err) {
    logger.error("sendMessage error", err);
    res.status(500).json({ message: "Failed to send message" });
  }
}

/**
 * GET /api/messages/unread-count
 * Returns total unread message count for the authenticated user.
 */
async function getUnreadCount(req, res) {
  try {
    const result = await pool.query(
      "SELECT COUNT(*)::int AS count FROM messages WHERE receiver_id = $1 AND is_read = false",
      [req.user.id],
    );
    res.json({ count: result.rows[0].count });
  } catch (err) {
    logger.error("getUnreadCount error", err);
    res.status(500).json({ message: "Failed to fetch unread count" });
  }
}

module.exports = { getMessages, sendMessage, getUnreadCount };
