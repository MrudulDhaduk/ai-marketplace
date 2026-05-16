const pool = require("../config/db");
const logger = require("../utils/logger");
const { validateProject } = require("../utils/validation");

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

function getPagination(query) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(query.limit, 10) || DEFAULT_PAGE_SIZE));
  return { page, limit, offset: (page - 1) * limit };
}

function healthCheck(_req, res) {
  res.json({ status: "ok", ts: new Date().toISOString() });
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
        `SELECT id, title, description, min_budget, max_budget, due_date, status, tags, created_at
         FROM projects
         WHERE status IN ('open', 'bidding')
         ORDER BY created_at DESC NULLS LAST, id DESC
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
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(req.query.limit) || DEFAULT_PAGE_SIZE));
  const offset = (page - 1) * limit;

  try {
    const [dataResult, countResult] = await Promise.all([
      pool.query(
        "SELECT * FROM projects WHERE client_id = $1 ORDER BY id DESC LIMIT $2 OFFSET $3",
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
    const result = await pool.query("SELECT * FROM projects WHERE id = $1", [req.params.id]);
    const project = result.rows[0];

    if (!project) return res.status(404).json({ message: "Not found" });

    if (
      project.client_id !== req.user.id &&
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

/** GET /projects/discover/:id — developer project feed with pagination */
async function discoverProjects(req, res) {
  try {
    const { id } = req.params;
    const { all } = req.query;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(req.query.limit) || DEFAULT_PAGE_SIZE));
    const offset = (page - 1) * limit;

    const projectsRes = await pool.query(
      `SELECT * FROM projects WHERE status IN ('open', 'bidding') ORDER BY id DESC`,
    );
    const allProjects = projectsRes.rows;

    if (all === "true") {
      const paginated = allProjects.slice(offset, offset + limit);
      return res.json({
        data: paginated,
        pagination: { page, limit, total: allProjects.length, pages: Math.ceil(allProjects.length / limit) },
      });
    }

    const skillsRes = await pool.query(
      "SELECT skill FROM user_skills WHERE user_id = $1",
      [id],
    );
    const userSkills = skillsRes.rows.map((s) => s.skill.toLowerCase());

    if (!userSkills.length) {
      return res.json({ data: [], pagination: { page, limit, total: 0, pages: 0 } });
    }

    const filtered = allProjects.filter((p) => {
      const tech = p.technologies || p.tags || [];
      return tech.some((t) => userSkills.includes(t.toLowerCase()));
    });

    const paginated = filtered.slice(offset, offset + limit);
    res.json({
      data: paginated,
      pagination: { page, limit, total: filtered.length, pages: Math.ceil(filtered.length / limit) },
    });
  } catch (err) {
    logger.error("discoverProjects error", err);
    res.status(500).json({ message: "Error fetching projects" });
  }
}

/** GET /projects/assigned/:id */
async function getAssignedProjects(req, res) {
  try {
    const { id } = req.params;

    if (Number(req.user.id) !== Number(id)) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    const result = await pool.query(
      `SELECT * FROM projects
       WHERE assigned_developer_id = $1
       AND status IN ('active', 'completed')
       ORDER BY due_date ASC`,
      [id],
    );

    res.json(result.rows);
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
      "SELECT assigned_developer_id FROM projects WHERE id = $1",
      [id],
    );

    if (!projectCheck.rows.length) {
      return res.status(404).json({ message: "Project not found" });
    }

    if (Number(projectCheck.rows[0].assigned_developer_id) !== Number(req.user.id)) {
      return res.status(403).json({ message: "Unauthorized" });
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
      "SELECT client_id FROM projects WHERE id = $1",
      [id],
    );

    if (!project.rows.length) return res.status(404).json({ message: "Project not found" });
    if (project.rows[0].client_id !== req.user.id) return res.status(403).json({ message: "Not your project" });

    const reviewStatus = action === "approve" ? "approved" : "revision_requested";

    const result = await pool.query(
      `UPDATE projects SET review_status = $1, review_feedback = $2 WHERE id = $3 RETURNING *`,
      [reviewStatus, feedback?.trim() || null, id],
    );

    if (!result.rows.length) return res.status(404).json({ message: "Project not found" });

    req.io.to(`project_${id}`).emit("project_reviewed", {
      type: "project_reviewed",
      projectId: id,
      reviewStatus,
      feedback,
      message: action === "approve" ? "Your project was approved! 🎉" : "Your project needs revision",
    });

    res.json({ message: `Project ${reviewStatus}`, project: result.rows[0] });
  } catch (err) {
    logger.error("reviewProject error", err);
    res.status(500).json({ message: "Error reviewing project" });
  }
}

async function requestUpdate(req, res) {
  req.body = { ...req.body, action: "revision" };
  return reviewProject(req, res);
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
};
