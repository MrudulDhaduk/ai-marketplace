/**
 * activityController.js
 * Workspace Activity Engine — serves the unified timeline for both
 * DeveloperWorkspace and ClientWorkspace.
 *
 * Endpoints:
 *   GET  /projects/:id/activity          — paginated activity feed
 *   POST /projects/:id/activity/:eventId/approve   — client approves an entry
 *   POST /projects/:id/activity/:eventId/revision  — client requests revision
 *   POST /projects/:id/activity/:eventId/resolve   — mark resolved
 *   POST /projects/:id/activity/:eventId/comments  — add threaded comment
 *   GET  /projects/:id/activity/:eventId/comments  — get comments for entry
 */

const pool   = require("../config/db");
const logger = require("../utils/logger");
const { createNotification } = require("../services/notificationService");
const { EVENTS, emitTypedEvent } = require("../sockets/socketEvents");
const { emitToRoomWithAck } = require("../sockets/socketAck");

/* ─── helpers ──────────────────────────────────────────────────────────────── */

/** Verify the requesting user is the client or assigned developer of a project */
async function verifyProjectAccess(projectId, userId) {
  const res = await pool.query(
    "SELECT client_id, assigned_developer_id FROM projects WHERE id = $1",
    [projectId],
  );
  if (!res.rows.length) return null;
  const p = res.rows[0];
  const isClient    = Number(p.client_id) === Number(userId);
  const isDeveloper = Number(p.assigned_developer_id) === Number(userId);
  if (!isClient && !isDeveloper) return null;
  return { ...p, isClient, isDeveloper };
}

/* ─── GET /projects/:id/activity ───────────────────────────────────────────── */
async function getActivity(req, res) {
  try {
    const { id } = req.params;
    const { filter = "all", page = 1, limit = 50 } = req.query;

    const access = await verifyProjectAccess(id, req.user.id);
    if (!access) return res.status(403).json({ message: "Unauthorized" });

    // Build WHERE clause for filter
    const filterMap = {
      all:        null,
      submissions: `event_type IN ('submission_added','project_submitted')`,
      files:       `event_type IN ('file_uploaded','file_deleted')`,
      reviews:     `event_type IN ('project_approved','revision_requested','note_added','note_updated','note_deleted')`,
      system:      `event_type IN ('bid_accepted','project_assigned','repo_updated','demo_updated','project_urgent','project_unurgent','status_changed','update_requested')`,
    };

    const filterClause = filterMap[filter] ? `AND (${filterMap[filter]})` : "";

    const offset = (Math.max(1, Number(page)) - 1) * Math.min(100, Number(limit));

    // Phase 5 — BUG-C3 runtime detection removed.
    // Migration 007 renamed approved_at → actioned_at and has been confirmed
    // applied on all environments (verified via schema.sql dump). The
    // information_schema catalog query that previously ran on every request
    // is no longer needed. Reference actioned_at directly.
    const result = await pool.query(
      `SELECT
         pe.id,
         pe.project_id,
         pe.actor_id,
         pe.event_type,
         pe.meta,
         pe.created_at,
         pe.actor_name,
         pe.actor_role,
         pe.approval_status,
         pe.approval_feedback,
         pe.actioned_at,
         COALESCE(u.first_name || ' ' || u.last_name, u.username, 'Unknown') AS resolved_actor_name,
         u.role AS resolved_actor_role
       FROM project_events pe
       LEFT JOIN users u ON u.id = pe.actor_id
       WHERE pe.project_id = $1
         ${filterClause}
       ORDER BY pe.created_at DESC
       LIMIT $2 OFFSET $3`,
      [id, Math.min(100, Number(limit)), offset],
    );

    // Attach comment counts
    const eventIds = result.rows.map((r) => r.id);
    let commentCounts = {};
    if (eventIds.length) {
      const ccRes = await pool.query(
        `SELECT event_id, COUNT(*)::int AS cnt
         FROM activity_comments
         WHERE event_id = ANY($1::int[])
         GROUP BY event_id`,
        [eventIds],
      );
      ccRes.rows.forEach((r) => { commentCounts[r.event_id] = r.cnt; });
    }

    const rows = result.rows.map((r) => ({
      ...r,
      actor_name: r.actor_name || r.resolved_actor_name || "Unknown",
      actor_role: r.actor_role || r.resolved_actor_role || "unknown",
      comment_count: commentCounts[r.id] || 0,
    }));

    res.json({ data: rows, isClient: access.isClient });
  } catch (err) {
    logger.error("getActivity error", err);
    res.status(500).json({ message: "Failed to fetch activity" });
  }
}

/* ─── POST /projects/:id/activity/:eventId/approve ─────────────────────────── */
async function approveEntry(req, res) {
  try {
    const { id, eventId } = req.params;
    const { feedback } = req.body;

    const access = await verifyProjectAccess(id, req.user.id);
    if (!access || !access.isClient) return res.status(403).json({ message: "Only the client can approve entries" });

    // Phase 5 — BUG-C3 runtime detection removed. actioned_at confirmed stable.
    const result = await pool.query(
      `UPDATE project_events
       SET approval_status = 'approved', approval_feedback = $1, actioned_at = NOW()
       WHERE id = $2 AND project_id = $3
       RETURNING *`,
      [feedback?.trim() || null, eventId, id],
    );

    if (!result.rows.length) return res.status(404).json({ message: "Event not found" });

    // Notify developer
    const projRes = await pool.query(
      "SELECT assigned_developer_id, title FROM projects WHERE id = $1",
      [id],
    );
    const proj = projRes.rows[0];
    if (proj?.assigned_developer_id) {
      await createNotification({
        io: req.io,
        userId: Number(proj.assigned_developer_id),
        type: "entry_approved",
        message: `Client approved an update on "${proj.title}"`,
        meta: { projectId: Number(id), eventId: Number(eventId) },
      });
    }

    // ── Typed events (Phase 4) — with ack ──────────────────────────────────
    const seqId = Date.now();
    const approvalEnvelope = emitTypedEvent(req.io.to(`project_${id}`), EVENTS.APPROVAL_GRANTED, {
      projectId:  Number(id),
      actorId:    req.user.id,
      actorRole:  "client",
      seqId,
      data: {
        eventId:          Number(eventId),
        approvalStatus:   "approved",
        approvalFeedback: feedback?.trim() || null,
        actionedAt:       new Date().toISOString(),
      },
    });

    emitToRoomWithAck(req.io, `project_${id}`, EVENTS.APPROVAL_GRANTED, approvalEnvelope, { logger });

    res.json({ success: true, event: result.rows[0] });
  } catch (err) {
    logger.error("approveEntry error", err);
    res.status(500).json({ message: "Failed to approve entry" });
  }
}

/* ─── POST /projects/:id/activity/:eventId/revision ────────────────────────── */
async function requestRevisionOnEntry(req, res) {
  try {
    const { id, eventId } = req.params;
    const { feedback } = req.body;

    const access = await verifyProjectAccess(id, req.user.id);
    if (!access || !access.isClient) return res.status(403).json({ message: "Only the client can request revisions" });

    // Phase 5 — BUG-C3 runtime detection removed. actioned_at confirmed stable.
    const result = await pool.query(
      `UPDATE project_events
       SET approval_status = 'revision_requested', approval_feedback = $1, actioned_at = NULL
       WHERE id = $2 AND project_id = $3
       RETURNING *`,
      [feedback?.trim() || null, eventId, id],
    );

    if (!result.rows.length) return res.status(404).json({ message: "Event not found" });

    // Notify developer
    const projRes = await pool.query(
      "SELECT assigned_developer_id, title FROM projects WHERE id = $1",
      [id],
    );
    const proj = projRes.rows[0];
    if (proj?.assigned_developer_id) {
      await createNotification({
        io: req.io,
        userId: Number(proj.assigned_developer_id),
        type: "entry_revision_requested",
        message: `Client requested revision on an update for "${proj.title}"`,
        meta: { projectId: Number(id), eventId: Number(eventId), feedback: feedback?.trim() || null },
      });
    }

    const seqId = Date.now();

    // ── Typed events (Phase 4) — with ack ──────────────────────────────────
    const revisionEnvelope = emitTypedEvent(req.io.to(`project_${id}`), EVENTS.REVISION_REQUESTED, {
      projectId:  Number(id),
      actorId:    req.user.id,
      actorRole:  "client",
      seqId,
      data: {
        eventId:          Number(eventId),
        approvalStatus:   "revision_requested",
        approvalFeedback: feedback?.trim() || null,
        actionedAt:       null,
      },
    });

    emitToRoomWithAck(req.io, `project_${id}`, EVENTS.REVISION_REQUESTED, revisionEnvelope, { logger });

    res.json({ success: true, event: result.rows[0] });
  } catch (err) {
    logger.error("requestRevisionOnEntry error", err);
    res.status(500).json({ message: "Failed to request revision" });
  }
}

/* ─── POST /projects/:id/activity/:eventId/resolve ─────────────────────────── */
async function resolveEntry(req, res) {
  try {
    const { id, eventId } = req.params;

    const access = await verifyProjectAccess(id, req.user.id);
    if (!access) return res.status(403).json({ message: "Unauthorized" });

    // Phase 5 — BUG-C3/C4 runtime detection removed. actioned_at confirmed stable.
    // Sets actioned_at = NOW() so the resolution timestamp is recorded.
    const result = await pool.query(
      `UPDATE project_events
       SET approval_status = 'resolved', actioned_at = NOW()
       WHERE id = $1 AND project_id = $2
       RETURNING *`,
      [eventId, id],
    );

    if (!result.rows.length) return res.status(404).json({ message: "Event not found" });

    const actionedAt = result.rows[0].actioned_at;

    const seqId = Date.now();

    // ── Typed events (Phase 4) ──────────────────────────────────────────────
    emitTypedEvent(req.io.to(`project_${id}`), EVENTS.REVISION_RESOLVED, {
      projectId:  Number(id),
      actorId:    req.user.id,
      seqId,
      data: {
        eventId:        Number(eventId),
        approvalStatus: "resolved",
        actionedAt:     actionedAt,
      },
    });

    res.json({ success: true, event: result.rows[0] });
  } catch (err) {
    logger.error("resolveEntry error", err);
    res.status(500).json({ message: "Failed to resolve entry" });
  }
}

/* ─── POST /projects/:id/activity/:eventId/comments ────────────────────────── */
async function addComment(req, res) {
  try {
    const { id, eventId } = req.params;
    const { body } = req.body;

    if (!body || typeof body !== "string" || !body.trim()) {
      return res.status(400).json({ message: "Comment body is required" });
    }
    if (body.trim().length > 2000) {
      return res.status(400).json({ message: "Comment too long (max 2000 chars)" });
    }

    const access = await verifyProjectAccess(id, req.user.id);
    if (!access) return res.status(403).json({ message: "Unauthorized" });

    // Verify event belongs to project
    const eventCheck = await pool.query(
      "SELECT id FROM project_events WHERE id = $1 AND project_id = $2",
      [eventId, id],
    );
    if (!eventCheck.rows.length) return res.status(404).json({ message: "Event not found" });

    // Resolve actor display name from DB (req.user only has id/username/role from JWT)
    const userRes = await pool.query(
      "SELECT first_name, last_name, username FROM users WHERE id = $1",
      [req.user.id],
    ).catch(() => ({ rows: [] }));
    const u = userRes.rows[0];
    const actorName = u
      ? `${u.first_name || ""} ${u.last_name || ""}`.trim() || u.username || req.user.username || "Unknown"
      : req.user.username || "Unknown";

    const result = await pool.query(
      `INSERT INTO activity_comments (event_id, project_id, author_id, author_name, author_role, body)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [eventId, id, req.user.id, actorName, req.user.role, body.trim()],
    );

    const comment = result.rows[0];

    const seqId = Date.now();

    // ── Typed events (Phase 4) ──────────────────────────────────────────────
    emitTypedEvent(req.io.to(`project_${id}`), EVENTS.COMMENT_ADDED, {
      projectId:  Number(id),
      actorId:    req.user.id,
      actorName:  actorName,
      actorRole:  req.user.role,
      seqId,
      data: { eventId: Number(eventId), comment },
    });

    res.status(201).json({ success: true, comment });
  } catch (err) {
    logger.error("addComment error", err);
    res.status(500).json({ message: "Failed to add comment" });
  }
}

/* ─── GET /projects/:id/activity/:eventId/comments ─────────────────────────── */
async function getComments(req, res) {
  try {
    const { id, eventId } = req.params;

    const access = await verifyProjectAccess(id, req.user.id);
    if (!access) return res.status(403).json({ message: "Unauthorized" });

    const result = await pool.query(
      `SELECT * FROM activity_comments
       WHERE event_id = $1 AND project_id = $2
       ORDER BY created_at ASC`,
      [eventId, id],
    );

    res.json(result.rows);
  } catch (err) {
    logger.error("getComments error", err);
    res.status(500).json({ message: "Failed to fetch comments" });
  }
}

module.exports = {
  getActivity,
  approveEntry,
  requestRevisionOnEntry,
  resolveEntry,
  addComment,
  getComments,
};
