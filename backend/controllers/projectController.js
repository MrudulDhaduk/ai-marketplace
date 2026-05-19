const pool = require("../config/db");
const logger = require("../utils/logger");
const { validateProject } = require("../utils/validation");
const { createNotification } = require("../services/notificationService");

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

function getPagination(query) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(query.limit, 10) || DEFAULT_PAGE_SIZE));
  return { page, limit, offset: (page - 1) * limit };
}

/** GET /health — real liveness + readiness probe */
async function healthCheck(_req, res) {
  const start = Date.now();
  let dbOk = false;
  let dbLatencyMs = null;

  try {
    const dbStart = Date.now();
    await pool.query("SELECT 1");
    dbLatencyMs = Date.now() - dbStart;
    dbOk = true;
  } catch (err) {
    logger.error("Health check DB ping failed", err);
  }

  const status = dbOk ? "ok" : "degraded";
  const httpStatus = dbOk ? 200 : 503;

  res.status(httpStatus).json({
    status,
    ts: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    env: process.env.NODE_ENV || "development",
    db: {
      ok: dbOk,
      latencyMs: dbLatencyMs,
      pool: {
        total: pool.totalCount,
        idle: pool.idleCount,
        waiting: pool.waitingCount,
      },
    },
    responseMs: Date.now() - start,
  });
}

/** POST /api/projects */
async function createProject(req, res) {
  const { title, description, minBudget, maxBudget, dueDate, tags } = req.body;
  const userId = req.user.id;

  const error = validateProject({ title, description, minBudget, maxBudget, dueDate, tags });
  if (error) return res.status(400).json({ message: error });

  try {
    const result = await pool.query(
      `INSERT INTO projects (title, description, min_budget, max_budget, due_date, status, tags, client_id)
       VALUES ($1, $2, $3, $4, $5, 'bidding', $6, $7)
       RETURNING *`,
      [
        title.trim(),
        description.trim(),
        Number(minBudget),
        Number(maxBudget),
        dueDate,
        Array.isArray(tags) ? tags : [],
        userId,
      ],
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    logger.error("createProject error", err);
    res.status(500).json({ message: "Error creating project" });
  }
}

/** GET /projects — public marketplace preview with pagination */
async function listPublicProjects(req, res) {
  const { page, limit, offset } = getPagination(req.query);

  try {
    const [dataResult, countResult] = await Promise.all([
      pool.query(
        `SELECT id, title, description, min_budget, max_budget, due_date, status, tags, submitted_at
         FROM projects
         WHERE status IN ('open', 'bidding')
         ORDER BY submitted_at DESC NULLS LAST, id DESC
         LIMIT $1 OFFSET $2`,
        [limit, offset],
      ),
      pool.query("SELECT COUNT(*)::int AS total FROM projects WHERE status IN ('open', 'bidding')"),
    ]);

    const total = countResult.rows[0].total;
    res.json({ data: dataResult.rows, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (err) {
    logger.error("listPublicProjects error", err);
    res.status(500).json({ message: "Error fetching projects" });
  }
}

/** GET /api/projects — client's own projects with pagination */
async function getClientProjects(req, res) {
  const userId = req.user.id;
  const { page, limit, offset } = getPagination(req.query);

  try {
    const [dataResult, countResult] = await Promise.all([
      pool.query(
        `SELECT id, title, description, min_budget, max_budget, due_date, status,
                tags, review_status, assigned_developer_id, submitted_at, is_urgent,
                (SELECT COUNT(*)::int FROM bids WHERE project_id = projects.id) AS bids,
                (SELECT COUNT(*)::int FROM project_submissions ps WHERE ps.project_id = projects.id) AS submission_count
         FROM projects
         WHERE client_id = $1
         ORDER BY id DESC
         LIMIT $2 OFFSET $3`,
        [userId, limit, offset],
      ),
      pool.query("SELECT COUNT(*)::int AS total FROM projects WHERE client_id = $1", [userId]),
    ]);

    const total = countResult.rows[0].total;

    res.json({
      data: dataResult.rows,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    logger.error("getClientProjects error", err);
    res.status(500).json({ message: "Error fetching projects" });
  }
}

/** GET /api/projects/:id */
async function getProject(req, res) {
  try {
    // BUG-C2 fix: compute submission_count inline so both workspaces get a
    // real count on every fetch instead of always receiving undefined/0.
    const result = await pool.query(
      `SELECT p.*,
              (SELECT COUNT(*)::int
               FROM project_submissions ps
               WHERE ps.project_id = p.id) AS submission_count
       FROM projects p
       WHERE p.id = $1`,
      [req.params.id],
    );
    const project = result.rows[0];

    if (!project) return res.status(404).json({ message: "Not found" });

    if (
      Number(project.client_id) !== Number(req.user.id) &&
      Number(project.assigned_developer_id) !== Number(req.user.id)
    ) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    res.json(project);
  } catch (err) {
    logger.error("getProject error", err);
    res.status(500).json({ message: "Error fetching project" });
  }
}

/** GET /projects/discover/:id — developer project feed with SQL-level filtering */
async function discoverProjects(req, res) {
  try {
    const { id } = req.params;
    const { all } = req.query;
    const { page, limit, offset } = getPagination(req.query);

    // Show all open/bidding projects (no skill filter)
    if (all === "true") {
      const [dataResult, countResult] = await Promise.all([
        pool.query(
          `SELECT id, title, description, min_budget, max_budget, due_date, status, tags, submitted_at
           FROM projects
           WHERE status IN ('open', 'bidding')
           ORDER BY id DESC
           LIMIT $1 OFFSET $2`,
          [limit, offset],
        ),
        pool.query(
          "SELECT COUNT(*)::int AS total FROM projects WHERE status IN ('open', 'bidding')",
        ),
      ]);
      const total = countResult.rows[0].total;
      return res.json({
        data: dataResult.rows,
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      });
    }

    // Skill-matched feed — filter entirely in SQL using array overlap operator
    const skillsRes = await pool.query(
      "SELECT ARRAY_AGG(LOWER(skill)) AS skills FROM user_skills WHERE user_id = $1",
      [id],
    );
    const userSkills = skillsRes.rows[0]?.skills || [];

    if (!userSkills.length) {
      return res.json({ data: [], pagination: { page, limit, total: 0, pages: 0 } });
    }

    // Use PostgreSQL array overlap (&&) to match tags against user skills
    const [dataResult, countResult] = await Promise.all([
      pool.query(
        `SELECT id, title, description, min_budget, max_budget, due_date, status, tags, submitted_at
         FROM projects
         WHERE status IN ('open', 'bidding')
           AND (
             SELECT ARRAY_AGG(LOWER(t)) FROM UNNEST(tags) AS t
           ) && $1::text[]
         ORDER BY id DESC
         LIMIT $2 OFFSET $3`,
        [userSkills, limit, offset],
      ),
      pool.query(
        `SELECT COUNT(*)::int AS total
         FROM projects
         WHERE status IN ('open', 'bidding')
           AND (
             SELECT ARRAY_AGG(LOWER(t)) FROM UNNEST(tags) AS t
           ) && $1::text[]`,
        [userSkills],
      ),
    ]);

    const total = countResult.rows[0].total;
    res.json({
      data: dataResult.rows,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    logger.error("discoverProjects error", err);
    res.status(500).json({ message: "Error fetching projects" });
  }
}

/** GET /projects/assigned/:id — with pagination */
async function getAssignedProjects(req, res) {
  try {
    const { id } = req.params;
    const { page, limit, offset } = getPagination(req.query);

    if (Number(req.user.id) !== Number(id)) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    const [dataResult, countResult] = await Promise.all([
      pool.query(
        `SELECT id, title, description, min_budget, max_budget, due_date, status,
                tags, review_status, review_feedback, client_id, assigned_developer_id,
                deliverable_link, demo_link, submitted_at, is_urgent,
                (SELECT COUNT(*)::int FROM project_submissions ps WHERE ps.project_id = projects.id) AS submission_count
         FROM projects
         WHERE assigned_developer_id = $1
           AND status IN ('active', 'completed')
         ORDER BY due_date ASC NULLS LAST
         LIMIT $2 OFFSET $3`,
        [id, limit, offset],
      ),
      pool.query(
        `SELECT COUNT(*)::int AS total FROM projects
         WHERE assigned_developer_id = $1 AND status IN ('active', 'completed')`,
        [id],
      ),
    ]);

    const total = countResult.rows[0].total;
    res.json({
      data: dataResult.rows,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    logger.error("getAssignedProjects error", err);
    res.status(500).json({ message: "Error fetching assigned projects" });
  }
}

/** PUT /projects/:id/complete */
async function completeProject(req, res) {
  try {
    const { id } = req.params;

    const projectCheck = await pool.query(
      "SELECT assigned_developer_id, review_status FROM projects WHERE id = $1",
      [id],
    );

    if (!projectCheck.rows.length) {
      return res.status(404).json({ message: "Project not found" });
    }

    const proj = projectCheck.rows[0];

    if (Number(proj.assigned_developer_id) !== Number(req.user.id)) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    // FIX #8 — require client approval before marking complete
    if (proj.review_status !== "approved") {
      return res.status(409).json({ message: "Project must be approved by the client before it can be marked complete" });
    }

    const result = await pool.query(
      "UPDATE projects SET status = 'completed' WHERE id = $1 RETURNING *",
      [id],
    );

    res.json({ message: "Project marked as completed", project: result.rows[0] });
  } catch (err) {
    logger.error("completeProject error", err);
    res.status(500).json({ message: "Error completing project" });
  }
}

/** PUT /projects/:id/review */
async function reviewProject(req, res) {
  try {
    const { id } = req.params;
    const { action, feedback } = req.body;

    if (!action || !["approve", "revision"].includes(action)) {
      return res.status(400).json({ message: "Invalid action. Must be 'approve' or 'revision'" });
    }

    if (action === "revision" && feedback && typeof feedback !== "string") {
      return res.status(400).json({ message: "Feedback must be a string" });
    }

    const project = await pool.query(
      "SELECT client_id, assigned_developer_id, title, review_status, status FROM projects WHERE id = $1",
      [id],
    );

    if (!project.rows.length) return res.status(404).json({ message: "Project not found" });
    if (project.rows[0].client_id !== req.user.id) return res.status(403).json({ message: "Not your project" });

    const reviewStatus = action === "approve" ? "approved" : "revision_requested";
    const eventType = action === "approve" ? "project_approved" : "revision_requested";

    // BUG-C5 fix: when requesting a revision on an already-completed/approved
    // project (i.e. a "reopen"), we must also revert status back to 'active'.
    // Without this the DB CHECK constraint
    //   NOT (status = 'completed' AND review_status = 'revision_requested')
    // fires a constraint violation and the request silently 500s.
    let updateQuery;
    if (action === "approve") {
      // Approving always advances status to completed
      updateQuery = `UPDATE projects
         SET review_status = $1, review_feedback = $2, reviewed_at = NOW(), status = 'completed'
         WHERE id = $3 RETURNING *`;
    } else {
      // Requesting revision: if the project is currently completed (reopen
      // scenario), revert status to active so the constraint is satisfied
      updateQuery = `UPDATE projects
         SET review_status = $1,
             review_feedback = $2,
             reviewed_at = NOW(),
             status = CASE WHEN status = 'completed' THEN 'active' ELSE status END
         WHERE id = $3 RETURNING *`;
    }

    const result = await pool.query(updateQuery, [reviewStatus, feedback?.trim() || null, id]);

    if (!result.rows.length) return res.status(404).json({ message: "Project not found" });

    const proj = project.rows[0];

    // Emit socket event to project room
    req.io.to(`project_${id}`).emit("project_reviewed", {
      type: "project_reviewed",
      projectId: id,
      reviewStatus,
      feedback,
      message: action === "approve" ? "Your project was approved! 🎉" : "Your project needs revision",
    });
    req.io.to(`project_${id}`).emit("workspace_activity_updated", {
      projectId: Number(id),
      eventType,
    });

    // Persist notification for developer
    if (proj.assigned_developer_id) {
      await createNotification({
        io: req.io,
        userId: Number(proj.assigned_developer_id),
        type: eventType,
        message: action === "approve"
          ? `"${proj.title}" was approved 🎉`
          : `Revision requested on "${proj.title}"`,
        meta: { projectId: Number(id), feedback: feedback?.trim() || null },
      });
    }

    // Record project event with actor name
    const userRes = await pool.query(
      "SELECT first_name, last_name, username, role FROM users WHERE id = $1",
      [req.user.id],
    ).catch(() => ({ rows: [] }));
    const u = userRes.rows[0];
    const actorName = u ? `${u.first_name || ""} ${u.last_name || ""}`.trim() || u.username : "Unknown";

    await pool.query(
      `INSERT INTO project_events (project_id, actor_id, event_type, meta, actor_name, actor_role)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, req.user.id, eventType, JSON.stringify({ feedback: feedback?.trim() || null }), actorName, u?.role || "client"],
    ).catch((e) => logger.error("project_events insert error", e));

    res.json({ message: `Project ${reviewStatus}`, project: result.rows[0] });
  } catch (err) {
    logger.error("reviewProject error", err);
    res.status(500).json({ message: "Error reviewing project" });
  }
}

// FIX #3 — requestUpdate is a distinct "ping" action, NOT a revision
// It sends a notification without creating a duplicate revision_requested event
async function requestUpdate(req, res) {
  try {
    const { id } = req.params;
    const { feedback } = req.body;

    const project = await pool.query(
      "SELECT client_id, assigned_developer_id, title FROM projects WHERE id = $1",
      [id],
    );

    if (!project.rows.length) return res.status(404).json({ message: "Project not found" });
    if (project.rows[0].client_id !== req.user.id) return res.status(403).json({ message: "Not your project" });

    const proj = project.rows[0];

    if (!proj.assigned_developer_id) {
      return res.status(400).json({ message: "No developer assigned to this project" });
    }

    // Notify developer without touching review_status or inserting a revision event
    await createNotification({
      io: req.io,
      userId: Number(proj.assigned_developer_id),
      type: "update_requested",
      message: feedback?.trim() || `Client requested a status update on "${proj.title}"`,
      meta: { projectId: Number(id) },
    });

    // Record as a distinct system event type so it doesn't pollute the revision flow
    const userRes = await pool.query(
      "SELECT first_name, last_name, username, role FROM users WHERE id = $1",
      [req.user.id],
    ).catch(() => ({ rows: [] }));
    const u = userRes.rows[0];
    const actorName = u ? `${u.first_name || ""} ${u.last_name || ""}`.trim() || u.username : "Unknown";

    await pool.query(
      `INSERT INTO project_events (project_id, actor_id, event_type, meta, actor_name, actor_role)
       VALUES ($1, $2, 'update_requested', $3, $4, $5)`,
      [id, req.user.id, JSON.stringify({ feedback: feedback?.trim() || null }), actorName, u?.role || "client"],
    ).catch((e) => logger.error("project_events insert error", e));

    req.io.to(`project_${id}`).emit("workspace_activity_updated", {
      projectId: Number(id),
      eventType: "update_requested",
    });

    res.json({ message: "Update request sent to developer" });
  } catch (err) {
    logger.error("requestUpdate error", err);
    res.status(500).json({ message: "Error sending update request" });
  }
}

// FIX #6 — persist is_urgent to DB so it survives page reloads
async function setUrgent(req, res) {
  try {
    const { id } = req.params;
    const { is_urgent } = req.body;

    if (typeof is_urgent !== "boolean") {
      return res.status(400).json({ message: "is_urgent must be a boolean" });
    }

    const project = await pool.query(
      "SELECT client_id, assigned_developer_id, title FROM projects WHERE id = $1",
      [id],
    );

    if (!project.rows.length) return res.status(404).json({ message: "Project not found" });
    if (project.rows[0].client_id !== req.user.id) return res.status(403).json({ message: "Not your project" });

    await pool.query("UPDATE projects SET is_urgent = $1 WHERE id = $2", [is_urgent, id]);

    const proj = project.rows[0];

    // Notify developer when flagged urgent
    if (is_urgent && proj.assigned_developer_id) {
      await createNotification({
        io: req.io,
        userId: Number(proj.assigned_developer_id),
        type: "update_requested",
        message: `🚨 "${proj.title}" has been marked as URGENT by the client. Please prioritise.`,
        meta: { projectId: Number(id) },
      });

      // Record as a system event (not a revision)
      const userRes = await pool.query(
        "SELECT first_name, last_name, username, role FROM users WHERE id = $1",
        [req.user.id],
      ).catch(() => ({ rows: [] }));
      const u = userRes.rows[0];
      const actorName = u ? `${u.first_name || ""} ${u.last_name || ""}`.trim() || u.username : "Unknown";

      await pool.query(
        `INSERT INTO project_events (project_id, actor_id, event_type, meta, actor_name, actor_role)
         VALUES ($1, $2, 'project_urgent', $3, $4, $5)`,
        [id, req.user.id, JSON.stringify({}), actorName, u?.role || "client"],
      ).catch((e) => logger.error("project_events insert error", e));

      req.io.to(`project_${id}`).emit("workspace_activity_updated", {
        projectId: Number(id),
        eventType: "project_urgent",
      });
    }

    // BUG-M12 fix: emit project_unurgent event when urgency is removed so the
    // activity timeline shows the change and the developer workspace updates.
    if (!is_urgent) {
      const userRes = await pool.query(
        "SELECT first_name, last_name, username, role FROM users WHERE id = $1",
        [req.user.id],
      ).catch(() => ({ rows: [] }));
      const u = userRes.rows[0];
      const actorName = u ? `${u.first_name || ""} ${u.last_name || ""}`.trim() || u.username : "Unknown";

      await pool.query(
        `INSERT INTO project_events (project_id, actor_id, event_type, meta, actor_name, actor_role)
         VALUES ($1, $2, 'project_unurgent', $3, $4, $5)`,
        [id, req.user.id, JSON.stringify({}), actorName, u?.role || "client"],
      ).catch((e) => logger.error("project_events project_unurgent insert error", e));

      req.io.to(`project_${id}`).emit("workspace_activity_updated", {
        projectId: Number(id),
        eventType: "project_unurgent",
      });
    }

    res.json({ success: true, is_urgent });
  } catch (err) {
    logger.error("setUrgent error", err);
    res.status(500).json({ message: "Error updating urgency flag" });
  }
}

module.exports = {
  healthCheck,
  createProject,
  listPublicProjects,
  getClientProjects,
  getProject,
  discoverProjects,
  getAssignedProjects,
  completeProject,
  reviewProject,
  requestUpdate,
  setUrgent,
};
