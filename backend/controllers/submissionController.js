const pool = require("../config/db");
const logger = require("../utils/logger");
const { validateSubmission, isNonEmptyString } = require("../utils/validation");
const { createNotification } = require("../services/notificationService");

/** POST /projects/:id/submit */
async function submitProject(req, res) {
  try {
    const { id } = req.params;
    const { repoLink, demoLink, notes } = req.body;

    const error = validateSubmission({ repoLink, demoLink });
    if (error) return res.status(400).json({ message: error });

    const projectCheck = await pool.query(
      "SELECT assigned_developer_id FROM projects WHERE id = $1",
      [id],
    );

    if (!projectCheck.rows.length) return res.status(404).json({ message: "Project not found" });

    if (Number(projectCheck.rows[0].assigned_developer_id) !== Number(req.user.id)) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    await pool.query(
      `INSERT INTO project_submissions (project_id, repo_link, demo_link, notes)
       VALUES ($1, $2, $3, $4)`,
      [id, repoLink.trim(), demoLink?.trim() || null, notes?.trim() || null],
    );

    const result = await pool.query(
      `UPDATE projects
       SET deliverable_link = $1,
           demo_link = $2,
           submission_note = $3,
           submitted_at = NOW(),
           review_status = 'pending',
           review_feedback = NULL
       WHERE id = $4
       RETURNING *`,
      [repoLink.trim(), demoLink?.trim() || null, notes?.trim() || null, id],
    );

    req.io.to(`project_${id}`).emit("project_submitted", {
      type: "project_submitted",
      projectId: id,
      message: "Project deliverables submitted for review",
    });
    req.io.to(`project_${id}`).emit("submission_history_updated");

    // Notify client
    const projectInfo = await pool.query(
      "SELECT client_id, title FROM projects WHERE id = $1",
      [id],
    );
    if (projectInfo.rows[0]?.client_id) {
      await createNotification({
        io: req.io,
        userId: projectInfo.rows[0].client_id,
        type: "submission_added",
        message: `New submission on "${projectInfo.rows[0].title}"`,
        meta: { projectId: Number(id) },
      });
    }

    // Record project event
    await pool.query(
      `INSERT INTO project_events (project_id, actor_id, event_type, meta)
       VALUES ($1, $2, 'submission_added', $3)`,
      [id, req.user.id, JSON.stringify({ repoLink: repoLink.trim() })],
    ).catch((e) => logger.error("project_events insert error", e));

    res.json(result.rows[0]);
  } catch (err) {
    logger.error("submitProject error", err);
    res.status(500).json({ message: "Submission failed" });
  }
}

/** GET /projects/:id/submissions */
async function getSubmissions(req, res) {
  try {
    const { id } = req.params;

    const projectResult = await pool.query(
      "SELECT client_id, assigned_developer_id FROM projects WHERE id = $1",
      [id],
    );

    const project = projectResult.rows[0];
    if (!project) return res.status(404).json({ message: "Project not found" });

    if (
      project.client_id !== req.user.id &&
      Number(project.assigned_developer_id) !== Number(req.user.id)
    ) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    const result = await pool.query(
      "SELECT * FROM project_submissions WHERE project_id = $1 ORDER BY submitted_at DESC",
      [id],
    );

    res.json(result.rows);
  } catch (err) {
    logger.error("getSubmissions error", err);
    res.status(500).json({ message: "Failed to fetch submissions" });
  }
}

/** POST /projects/:projectId/submissions — add a note entry */
async function addSubmissionNote(req, res) {
  try {
    const { projectId } = req.params;
    const { notes } = req.body;

    if (!isNonEmptyString(notes, 2000)) {
      return res.status(400).json({ message: "Notes must be a non-empty string (max 2000 chars)" });
    }

    const project = await pool.query(
      "SELECT client_id, assigned_developer_id FROM projects WHERE id = $1",
      [projectId],
    );

    if (!project.rows.length) return res.status(404).json({ message: "Project not found" });

    const userId = req.user.id;
    const p = project.rows[0];

    if (p.client_id !== userId && Number(p.assigned_developer_id) !== Number(userId)) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    const result = await pool.query(
      "INSERT INTO project_submissions (project_id, notes) VALUES ($1, $2) RETURNING *",
      [projectId, notes.trim()],
    );

    req.io.to(`project_${projectId}`).emit("submission_history_updated");

    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    logger.error("addSubmissionNote error", err);
    res.status(500).json({ message: "Failed to add submission note" });
  }
}

/** PUT /projects/:projectId/submissions/:id */
async function updateSubmission(req, res) {
  try {
    const { id, projectId } = req.params;
    const { notes } = req.body;

    if (!isNonEmptyString(notes, 2000)) {
      return res.status(400).json({ message: "Notes must be a non-empty string (max 2000 chars)" });
    }

    const project = await pool.query(
      "SELECT client_id, assigned_developer_id FROM projects WHERE id = $1",
      [projectId],
    );

    if (!project.rows.length) return res.status(404).json({ message: "Project not found" });

    const userId = req.user.id;
    const p = project.rows[0];

    if (p.client_id !== userId && Number(p.assigned_developer_id) !== Number(userId)) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    const result = await pool.query(
      "UPDATE project_submissions SET notes = $1 WHERE id = $2 RETURNING *",
      [notes.trim(), id],
    );

    if (!result.rows.length) return res.status(404).json({ message: "Submission not found" });

    req.io.to(`project_${projectId}`).emit("submission_history_updated");

    res.json({ success: true });
  } catch (err) {
    logger.error("updateSubmission error", err);
    res.status(500).json({ message: "Failed to update submission" });
  }
}

/** DELETE /projects/:projectId/submissions/:id */
async function deleteSubmission(req, res) {
  try {
    const { id, projectId } = req.params;

    const project = await pool.query(
      "SELECT client_id, assigned_developer_id FROM projects WHERE id = $1",
      [projectId],
    );

    if (!project.rows.length) return res.status(404).json({ message: "Project not found" });

    const userId = req.user.id;
    const p = project.rows[0];

    if (p.client_id !== userId && Number(p.assigned_developer_id) !== Number(userId)) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    const result = await pool.query(
      "DELETE FROM project_submissions WHERE id = $1 RETURNING *",
      [id],
    );

    if (!result.rows.length) return res.status(404).json({ message: "Submission not found" });

    req.io.to(`project_${projectId}`).emit("submission_history_updated");

    res.json({ success: true });
  } catch (err) {
    logger.error("deleteSubmission error", err);
    res.status(500).json({ message: "Failed to delete submission" });
  }
}

module.exports = {
  submitProject,
  getSubmissions,
  addSubmissionNote,
  updateSubmission,
  deleteSubmission,
};
