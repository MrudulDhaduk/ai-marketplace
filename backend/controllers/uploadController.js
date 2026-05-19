const multer = require("multer");
const pool = require("../config/db");
const { upload } = require("../services/uploadService");
const storageService = require("../services/storageService");
const logger = require("../utils/logger");

/** POST /projects/:id/upload */
function uploadFiles(req, res) {
    upload.fields([
      { name: "files", maxCount: 10 },
      { name: "file", maxCount: 1 },
    ])(req, res, async (err) => {
      if (err instanceof multer.MulterError) {
        if (err.code === "LIMIT_FILE_SIZE") {
          return res.status(400).json({ message: "File too large (max 5MB)" });
        }
        return res.status(400).json({ message: err.message });
      } else if (err) {
        return res.status(400).json({ message: err.message });
      }

      const filesFromPayload = [
        ...(req.files?.files || []),
        ...(req.files?.file || []),
      ];

      if (!filesFromPayload.length) {
        return res.status(400).json({ message: "No files uploaded" });
      }

      const { id } = req.params;

      // Helper to clean up uploaded files on error
      const cleanup = async () => {
        for (const file of filesFromPayload) {
          try {
            // file.key is set by multer-s3; file.filename is set by multer disk storage
            await storageService.deleteFile(file.key || file.filename);
          } catch (e) {
            if (e.code !== "ENOENT") logger.error("Cleanup error", e);
          }
        }
      };

      try {
        const projectCheck = await pool.query(
          "SELECT assigned_developer_id FROM projects WHERE id = $1",
          [id],
        );

        if (!projectCheck.rows.length) {
          await cleanup();
          return res.status(404).json({ message: "Project not found" });
        }

        if (
          projectCheck.rows[0].assigned_developer_id == null ||
          Number(projectCheck.rows[0].assigned_developer_id) !== Number(req.user.id)
        ) {
          await cleanup();
          return res.status(403).json({ message: "Unauthorized" });
        }

        const insertedRows = [];

        for (const file of filesFromPayload) {
          // multer-s3 sets file.key; multer disk storage sets file.filename
          const storedName = file.key || file.filename;
          const inserted = await pool.query(
            `INSERT INTO project_files (project_id, file_name, size, uploaded_at, position)
             VALUES (
               $1, $2, $3, NOW(),
               (SELECT COALESCE(MAX(position), 0) + 1 FROM project_files WHERE project_id = $1)
             )
             RETURNING *`,
            [id, storedName, file.size || null],
          );
          insertedRows.push(inserted.rows[0]);
        }

        // Record workspace activity event for file upload
        try {
          const userRes = await pool.query(
            "SELECT first_name, last_name, username, role FROM users WHERE id = $1",
            [req.user.id],
          );
          const u = userRes.rows[0];
          const actorName = u ? `${u.first_name || ""} ${u.last_name || ""}`.trim() || u.username : "Unknown";
          const fileNames = insertedRows.map((f) => f.file_name);

          await pool.query(
            `INSERT INTO project_events (project_id, actor_id, event_type, meta, actor_name, actor_role)
             VALUES ($1, $2, 'file_uploaded', $3, $4, $5)`,
            [
              id,
              req.user.id,
              JSON.stringify({ count: insertedRows.length, files: fileNames }),
              actorName,
              u?.role || "developer",
            ],
          );

          // Emit realtime update to project room
          req.io.to(`project_${id}`).emit("workspace_activity_updated", {
            projectId: Number(id),
            eventType: "file_uploaded",
          });
        } catch (evtErr) {
          logger.error("file_uploaded event insert error", evtErr);
        }

        res.json({ message: "Files uploaded successfully", files: insertedRows });
      } catch (error) {
        await cleanup();
        logger.error("uploadFiles error", error);
        res.status(500).json({ message: "Upload failed" });
      }
    });
}

/** GET /projects/:id/files */
async function getProjectFiles(req, res) {
  try {
    const { id } = req.params;

    const projectRes = await pool.query(
      "SELECT client_id, assigned_developer_id FROM projects WHERE id = $1",
      [id],
    );

    if (!projectRes.rows.length) return res.status(404).json({ message: "Project not found" });

    const p = projectRes.rows[0];
    if (
      Number(p.client_id) !== Number(req.user.id) &&
      Number(p.assigned_developer_id || 0) !== Number(req.user.id)
    ) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    const result = await pool.query(
      "SELECT * FROM project_files WHERE project_id = $1 ORDER BY position ASC",
      [id],
    );

    res.json(result.rows);
  } catch (err) {
    logger.error("getProjectFiles error", err);
    res.status(500).json({ message: "Failed to fetch project files" });
  }
}

/** DELETE /files/:id */
async function deleteFile(req, res) {
  try {
    const { id } = req.params;

    const fileResult = await pool.query(
      `SELECT pf.file_name, pf.project_id, p.assigned_developer_id
       FROM project_files pf
       INNER JOIN projects p ON p.id = pf.project_id
       WHERE pf.id = $1`,
      [id],
    );

    if (!fileResult.rows.length) return res.status(404).json({ message: "File not found" });

    const { file_name, project_id, assigned_developer_id } = fileResult.rows[0];

    if (
      assigned_developer_id == null ||
      Number(assigned_developer_id) !== Number(req.user.id)
    ) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    try {
      await storageService.deleteFile(file_name);
    } catch (unlinkError) {
      if (unlinkError.code !== "ENOENT") throw unlinkError;
    }

    await pool.query("DELETE FROM project_files WHERE id = $1", [id]);

    // ARCH-9 fix: record a file_deleted event and emit workspace_activity_updated
    // so the client's file list and activity feed update in realtime.
    try {
      const userRes = await pool.query(
        "SELECT first_name, last_name, username, role FROM users WHERE id = $1",
        [req.user.id],
      );
      const u = userRes.rows[0];
      const actorName = u ? `${u.first_name || ""} ${u.last_name || ""}`.trim() || u.username : "Unknown";

      await pool.query(
        `INSERT INTO project_events (project_id, actor_id, event_type, meta, actor_name, actor_role)
         VALUES ($1, $2, 'file_deleted', $3, $4, $5)`,
        [project_id, req.user.id, JSON.stringify({ file: file_name }), actorName, u?.role || "developer"],
      );

      req.io.to(`project_${project_id}`).emit("workspace_activity_updated", {
        projectId: Number(project_id),
        eventType: "file_deleted",
      });
    } catch (evtErr) {
      logger.error("file_deleted event insert error", evtErr);
    }

    res.json({ message: "File deleted successfully" });
  } catch (err) {
    logger.error("deleteFile error", err);
    res.status(500).json({ message: "Failed to delete file" });
  }
}

/** PUT /files/reorder */
async function reorderFiles(req, res) {
  try {
    const updates = req.body;

    if (!Array.isArray(updates)) {
      return res.status(400).json({ message: "Invalid reorder payload — expected array" });
    }

    if (!updates.length) return res.json({ message: "Files reordered successfully" });

    // Validate each item
    for (const item of updates) {
      if (typeof item?.id !== "number" || typeof item?.position !== "number") {
        return res.status(400).json({ message: "Each item must have numeric id and position" });
      }
    }

    const fileIds = updates.map((item) => item.id);
    const ownership = await pool.query(
      `SELECT COUNT(*)::int AS cnt, MIN(p.id) AS project_id
       FROM project_files pf
       INNER JOIN projects p ON p.id = pf.project_id
       WHERE pf.id = ANY($1::int[])
         AND p.assigned_developer_id IS NOT NULL
         AND p.assigned_developer_id = $2`,
      [fileIds, req.user.id],
    );

    if (ownership.rows[0].cnt !== updates.length) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    const projectId = ownership.rows[0].project_id;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const item of updates) {
        await client.query(
          "UPDATE project_files SET position = $1 WHERE id = $2",
          [item.position, item.id],
        );
      }
      await client.query("COMMIT");
    } catch (transactionError) {
      await client.query("ROLLBACK");
      throw transactionError;
    } finally {
      client.release();
    }

    // ARCH-10 fix: emit a socket event so the client's file list order updates
    // in realtime when the developer reorders files.
    if (projectId) {
      req.io.to(`project_${projectId}`).emit("workspace_activity_updated", {
        projectId: Number(projectId),
        eventType: "files_reordered",
      });
    }

    res.json({ message: "Files reordered successfully" });
  } catch (err) {
    logger.error("reorderFiles error", err);
    res.status(500).json({ message: "Failed to reorder files" });
  }
}

module.exports = { uploadFiles, getProjectFiles, deleteFile, reorderFiles, getFileUrl };

/** GET /files/:id/url — returns a (signed) URL for a single file */
async function getFileUrl(req, res) {
  try {
    const { id } = req.params;
    const ttl = Number(req.query.ttl) || 3600; // seconds

    const fileResult = await pool.query(
      `SELECT pf.file_name, pf.project_id, p.client_id, p.assigned_developer_id
       FROM project_files pf
       INNER JOIN projects p ON p.id = pf.project_id
       WHERE pf.id = $1`,
      [id],
    );

    if (!fileResult.rows.length) return res.status(404).json({ message: "File not found" });

    const { file_name, project_id, client_id, assigned_developer_id } = fileResult.rows[0];

    if (
      Number(client_id) !== Number(req.user.id) &&
      Number(assigned_developer_id || 0) !== Number(req.user.id)
    ) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    const url = await storageService.getSignedUrl(file_name, ttl);
    res.json({ url, expiresIn: ttl });
  } catch (err) {
    logger.error("getFileUrl error", err);
    res.status(500).json({ message: "Failed to generate file URL" });
  }
}
