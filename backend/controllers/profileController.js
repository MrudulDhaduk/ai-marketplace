const pool = require("../config/db");
const logger = require("../utils/logger");
const { isNonEmptyString } = require("../utils/validation");

/** GET /profile/:id — public safe view; authenticated self-view gets extra fields */
async function getProfile(req, res) {
  try {
    const { id } = req.params;
    const requesterId = req.user?.id ?? null;
    const isSelf = requesterId !== null && Number(requesterId) === Number(id);

    // Public fields always returned; private fields only for self
    const userResult = await pool.query(
      `SELECT id, username, role, bio
       ${isSelf ? ", email, email_verified, phone, phone_verified" : ""}
       FROM users WHERE id = $1`,
      [id],
    );

    if (!userResult.rows.length) {
      return res.status(404).json({ message: "User not found" });
    }

    const user = userResult.rows[0];

    const statsResult = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'completed') AS "projectsCompleted",
         COUNT(*) FILTER (WHERE status = 'active')    AS "activeProjects"
       FROM projects
       WHERE client_id = $1`,
      [id],
    );

    const signals = isSelf
      ? { emailVerified: user.email_verified, phoneVerified: user.phone_verified }
      : {};

    res.json({ user, stats: statsResult.rows[0], signals });
  } catch (err) {
    logger.error("getProfile error", err);
    res.status(500).json({ message: "Error fetching profile" });
  }
}

/** GET /profile/:id/skills */
async function getSkills(req, res) {
  try {
    const { id } = req.params;

    if (Number(req.user.id) !== Number(id)) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const result = await pool.query(
      "SELECT skill FROM user_skills WHERE user_id = $1 ORDER BY skill ASC",
      [id],
    );

    res.json(result.rows.map((r) => r.skill));
  } catch (err) {
    logger.error("getSkills error", err);
    res.status(500).json({ message: "Error fetching skills" });
  }
}

/** POST /profile/:id/skills */
async function addSkill(req, res) {
  try {
    const { id } = req.params;
    const { skill } = req.body;

    if (Number(req.user.id) !== Number(id)) {
      return res.status(403).json({ message: "Forbidden" });
    }

    if (!isNonEmptyString(skill, 60)) {
      return res.status(400).json({ message: "Skill must be a non-empty string (max 60 chars)" });
    }

    const trimmed = skill.trim();

    // Prevent duplicates
    const existing = await pool.query(
      "SELECT 1 FROM user_skills WHERE user_id = $1 AND LOWER(skill) = LOWER($2)",
      [id, trimmed],
    );
    if (existing.rows.length) {
      return res.status(409).json({ message: "Skill already added" });
    }

    const result = await pool.query(
      "INSERT INTO user_skills (user_id, skill) VALUES ($1, $2) RETURNING *",
      [id, trimmed],
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    logger.error("addSkill error", err);
    res.status(500).json({ message: "Error adding skill" });
  }
}

/** DELETE /profile/:id/skills */
async function removeSkill(req, res) {
  try {
    const { id } = req.params;
    const { skill } = req.body;

    if (Number(req.user.id) !== Number(id)) {
      return res.status(403).json({ message: "Forbidden" });
    }

    if (!isNonEmptyString(skill, 60)) {
      return res.status(400).json({ message: "Skill is required" });
    }

    await pool.query(
      "DELETE FROM user_skills WHERE user_id = $1 AND skill = $2",
      [id, skill.trim()],
    );

    res.json({ message: "Skill removed" });
  } catch (err) {
    logger.error("removeSkill error", err);
    res.status(500).json({ message: "Error removing skill" });
  }
}

module.exports = { getProfile, getSkills, addSkill, removeSkill };
