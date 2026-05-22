const pool = require("../config/db");
const logger = require("../utils/logger");
const { validateSubmission, isNonEmptyString } = require("../utils/validation");
const { createNotification } = require("../services/notificationService");
const { EVENTS, emitTypedEvent } = require("../sockets/socketEvents");
const { emitToRoomWithAck } = require("../sockets/socketAck");

/** POST /projects/:id/submit */
async function submitProject(req, res) {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { repoLink, demoLink, notes } = req.body;

    const error = validateSubmission({ repoLink, demoLink });
    if (error) return res.status(400).json({ message: error });

    await client.query("BEGIN");

    // FIX #7 — lock row and check both ownership AND review_status
    const projectCheck = await client.query(
      "SELECT assigned_developer_id, review_status, submitted_at, client_id, title FROM projects WHERE id = $1 FOR UPDATE",
      [id],
    );

    if (!projectCheck.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Project not found" });
    }

    const proj = projectCheck.rows[0];

    if (Number(proj.assigned_developer_id) !== Number(req.user.id)) {
      await client.query("ROLLBACK");
      return res.status(403).json({ message: "Unauthorized" });
    }

    // FIX #7 — backend guard: block resubmit while already under review.
    // Only applies when a submission has already been made (submitted_at IS NOT NULL).
    // A brand-new project has review_status = 'pending' by default but no submission yet.
    if (proj.review_status === "pending" && proj.submitted_at !== null) {
      await client.query("ROLLBACK");
      return res.status(409).json({ message: "A submission is already under review. Wait for client feedback before resubmitting." });
    }

    await client.query(
      `INSERT INTO project_submissions (project_id, repo_link, demo_link, notes)
       VALUES ($1, $2, $3, $4)`,
      [id, repoLink.trim(), demoLink?.trim() || null, notes?.trim() || null],
    );

    // FIX #5 — also clear reviewed_at on resubmit so stale timestamp is gone
    const result = await client.query(
      `UPDATE projects
       SET deliverable_link = $1,
           demo_link = $2,
           submission_note = $3,
           submitted_at = NOW(),
           review_status = 'pending',
           review_feedback = NULL,
           reviewed_at = NULL
       WHERE id = $4
       RETURNING *`,
      [repoLink.trim(), demoLink?.trim() || null, notes?.trim() || null, id],
    );

    // FIX #4 — resolve any open revision_requested entries on the activity timeline
    await client.query(
      `UPDATE project_events
       SET approval_status = 'resolved', actioned_at = NOW()
       WHERE project_id = $1
         AND approval_status = 'revision_requested'`,
      [id],
    );

    // Record project event INSIDE the transaction so it commits atomically
    const userRes = await client.query(
      "SELECT first_name, last_name, username, role FROM users WHERE id = $1",
      [req.user.id],
    ).catch(() => ({ rows: [] }));
    const u = userRes.rows[0];
    const actorName = u ? `${u.first_name || ""} ${u.last_name || ""}`.trim() || u.username : "Unknown";

    await client.query(
      `INSERT INTO project_events (project_id, actor_id, event_type, meta, actor_name, actor_role)
       VALUES ($1, $2, 'submission_added', $3, $4, $5)`,
      [id, req.user.id, JSON.stringify({ repoLink: repoLink.trim(), demoLink: demoLink?.trim() || null }), actorName, u?.role || "developer"],
    );

    await client.query("COMMIT");

    // FIX #2 — emit sockets AFTER commit so activity feed is consistent
    const seqId = Date.now();

    // ── Typed events (Phase 4) — with ack for critical delivery ───────────
    const envelope = emitTypedEvent(req.io.to(`project_${id}`), EVENTS.SUBMISSION_CREATED, {
      projectId:  Number(id),
      actorId:    req.user.id,
      actorName:  actorName,
      actorRole:  u?.role || "developer",
      seqId,
      data: {
        repoLink:    repoLink.trim(),
        demoLink:    demoLink?.trim() || null,
        notes:       notes?.trim() || null,
        submittedAt: new Date().toISOString(),
        reviewStatus: "pending",
      },
    });

    // Ack: re-emit with ack callback to each individual socket in the room
    emitToRoomWithAck(req.io, `project_${id}`, EVENTS.SUBMISSION_CREATED, envelope, { logger });

    // Notify client
    if (proj.client_id) {
      await createNotification({
        io: req.io,
        userId: proj.client_id,
        type: "submission_added",
        message: `New submission on "${proj.title}"`,
        meta: { projectId: Number(id) },
      });
    }

    res.json(result.rows[0]);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    logger.error("submitProject error", err);
    res.status(500).json({ message: "Submission failed" });
  } finally {
    client.release();
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

    // BUG-C6 fix: use Number() coercion on both sides so integer DB values
    // compare correctly against string JWT user ids
    if (
      Number(project.client_id) !== Number(req.user.id) &&
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

    // FIX #9 — only the assigned developer may add progress notes
    if (Number(p.assigned_developer_id) !== Number(userId)) {
      return res.status(403).json({ message: "Only the assigned developer can add progress notes" });
    }

    // BUG-C10 fix: insert project_events BEFORE emitting socket events so that
    // any client that immediately re-fetches the activity feed on receiving the
    // socket event will find the new row already committed.
    const result = await pool.query(
      "INSERT INTO project_submissions (project_id, notes) VALUES ($1, $2) RETURNING *",
      [projectId, notes.trim()],
    );

    // Record workspace activity event first
    const userRes = await pool.query(
      "SELECT first_name, last_name, username, role FROM users WHERE id = $1",
      [userId],
    ).catch(() => ({ rows: [] }));
    const u = userRes.rows[0];
    const actorName = u ? `${u.first_name || ""} ${u.last_name || ""}`.trim() || u.username : "Unknown";

    await pool.query(
      `INSERT INTO project_events (project_id, actor_id, event_type, meta, actor_name, actor_role)
       VALUES ($1, $2, 'note_added', $3, $4, $5)`,
      [projectId, userId, JSON.stringify({ notes: notes.trim(), submissionId: result.rows[0].id }), actorName, u?.role || "developer"],
    ).catch((e) => logger.error("project_events note_added insert error", e));

    // Emit AFTER the DB write so listeners see consistent data
    const seqId = Date.now();

    // ── Typed events (Phase 4) ──────────────────────────────────────────────
    emitTypedEvent(req.io.to(`project_${projectId}`), EVENTS.SUBMISSION_NOTE_ADDED, {
      projectId:  Number(projectId),
      actorId:    userId,
      actorName:  actorName,
      actorRole:  u?.role || "developer",
      seqId,
      data: {
        submissionId: result.rows[0].id,
        notes:        notes.trim(),
        createdAt:    result.rows[0].submitted_at || new Date().toISOString(),
      },
    });

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

    if (Number(p.assigned_developer_id) !== Number(userId)) {
      return res.status(403).json({ message: "Only the assigned developer can edit submission notes" });
    }

    // IDOR fix: scope the UPDATE to both id AND project_id so a developer
    // assigned to project A cannot modify a submission row from project B
    const result = await pool.query(
      "UPDATE project_submissions SET notes = $1 WHERE id = $2 AND project_id = $3 RETURNING *",
      [notes.trim(), id, projectId],
    );

    if (!result.rows.length) return res.status(404).json({ message: "Submission not found" });

    // ── Typed events (Phase 4) ──────────────────────────────────────────────
    emitTypedEvent(req.io.to(`project_${projectId}`), EVENTS.SUBMISSION_NOTE_UPDATED, {
      projectId:  Number(projectId),
      actorId:    userId,
      actorRole:  "developer",
      seqId:      Date.now(),
      data: { submissionId: Number(id), notes: notes.trim() },
    });

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

    if (Number(p.assigned_developer_id) !== Number(userId)) {
      return res.status(403).json({ message: "Only the assigned developer can delete submission entries" });
    }

    // IDOR fix: scope the DELETE to both id AND project_id
    const result = await pool.query(
      "DELETE FROM project_submissions WHERE id = $1 AND project_id = $2 RETURNING *",
      [id, projectId],
    );

    if (!result.rows.length) return res.status(404).json({ message: "Submission not found" });

    // ── Typed events (Phase 4) ──────────────────────────────────────────────
    emitTypedEvent(req.io.to(`project_${projectId}`), EVENTS.SUBMISSION_NOTE_DELETED, {
      projectId:  Number(projectId),
      actorId:    userId,
      actorRole:  "developer",
      seqId:      Date.now(),
      data: { submissionId: Number(id) },
    });

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
