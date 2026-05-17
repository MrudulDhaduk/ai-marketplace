const pool = require("../config/db");
const logger = require("../utils/logger");

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

/**
 * GET /api/stats/client
 * Returns aggregate stats for the authenticated client.
 */
async function getClientStats(req, res) {
  try {
    const userId = req.user.id;

    const [statsResult, bidsResult] = await Promise.all([
      pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE status IN ('bidding','active'))::int   AS active_projects,
           COUNT(*) FILTER (WHERE status = 'completed')::int             AS completed_projects,
           COUNT(*) FILTER (WHERE review_status = 'pending')::int        AS pending_reviews,
           COALESCE(SUM(CASE WHEN status = 'completed' THEN max_budget ELSE 0 END), 0)::int AS total_spend
         FROM projects
         WHERE client_id = $1`,
        [userId],
      ),
      pool.query(
        `SELECT COUNT(b.id)::int AS total_bids
         FROM bids b
         JOIN projects p ON b.project_id = p.id
         WHERE p.client_id = $1`,
        [userId],
      ),
    ]);

    const stats = statsResult.rows[0];
    const { total_bids } = bidsResult.rows[0];

    res.json({
      activeProjects: stats.active_projects,
      completedProjects: stats.completed_projects,
      pendingReviews: stats.pending_reviews,
      totalSpend: stats.total_spend,
      totalBids: total_bids,
    });
  } catch (err) {
    logger.error("getClientStats error", err);
    res.status(500).json({ message: "Failed to fetch stats" });
  }
}

/**
 * GET /api/stats/developer
 * Returns aggregate stats for the authenticated developer.
 */
async function getDeveloperStats(req, res) {
  try {
    const userId = req.user.id;

    const [projectStats, bidStats, earningsResult] = await Promise.all([
      pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE status = 'active')::int     AS active_projects,
           COUNT(*) FILTER (WHERE status = 'completed')::int  AS completed_projects,
           COUNT(*) FILTER (WHERE review_status = 'approved')::int AS approved_projects
         FROM projects
         WHERE assigned_developer_id = $1`,
        [userId],
      ),
      pool.query(
        `SELECT
           COUNT(*)::int                                                    AS total_bids,
           COUNT(*) FILTER (WHERE status = 'accepted')::int                AS accepted_bids,
           COUNT(*) FILTER (WHERE status = 'pending')::int                 AS pending_bids
         FROM bids
         WHERE developer_id = $1`,
        [userId],
      ),
      pool.query(
        `SELECT COALESCE(SUM(p.max_budget), 0)::int AS total_earned
         FROM projects p
         WHERE p.assigned_developer_id = $1 AND p.status = 'completed'`,
        [userId],
      ),
    ]);

    const ps = projectStats.rows[0];
    const bs = bidStats.rows[0];
    const { total_earned } = earningsResult.rows[0];

    res.json({
      activeProjects: ps.active_projects,
      completedProjects: ps.completed_projects,
      approvedProjects: ps.approved_projects,
      totalBids: bs.total_bids,
      acceptedBids: bs.accepted_bids,
      pendingBids: bs.pending_bids,
      totalEarned: total_earned,
    });
  } catch (err) {
    logger.error("getDeveloperStats error", err);
    res.status(500).json({ message: "Failed to fetch developer stats" });
  }
}

/**
 * GET /api/activity/client
 * Returns paginated activity feed for the authenticated client.
 * Pulls from project_events on projects owned by the client.
 */
async function getClientActivity(req, res) {
  try {
    const userId = req.user.id;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(req.query.limit) || DEFAULT_PAGE_SIZE));
    const offset = (page - 1) * limit;

    const [dataResult, countResult] = await Promise.all([
      pool.query(
        `SELECT
           pe.id,
           pe.event_type,
           pe.meta,
           pe.created_at,
           p.title  AS project_title,
           p.id     AS project_id,
           u.username AS actor_username
         FROM project_events pe
         JOIN projects p ON pe.project_id = p.id
         JOIN users u    ON pe.actor_id   = u.id
         WHERE p.client_id = $1
         ORDER BY pe.created_at DESC
         LIMIT $2 OFFSET $3`,
        [userId, limit, offset],
      ),
      pool.query(
        `SELECT COUNT(pe.id)::int AS total
         FROM project_events pe
         JOIN projects p ON pe.project_id = p.id
         WHERE p.client_id = $1`,
        [userId],
      ),
    ]);

    const total = countResult.rows[0].total;

    res.json({
      data: dataResult.rows,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    logger.error("getClientActivity error", err);
    res.status(500).json({ message: "Failed to fetch activity" });
  }
}

/**
 * GET /api/activity/developer
 * Returns paginated activity feed for the authenticated developer.
 */
async function getDeveloperActivity(req, res) {
  try {
    const userId = req.user.id;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(req.query.limit) || DEFAULT_PAGE_SIZE));
    const offset = (page - 1) * limit;

    const [dataResult, countResult] = await Promise.all([
      pool.query(
        `SELECT
           pe.id,
           pe.event_type,
           pe.meta,
           pe.created_at,
           p.title  AS project_title,
           p.id     AS project_id,
           u.username AS actor_username
         FROM project_events pe
         JOIN projects p ON pe.project_id = p.id
         JOIN users u    ON pe.actor_id   = u.id
         WHERE p.assigned_developer_id = $1
            OR (pe.actor_id = $1 AND pe.event_type = 'bid_placed')
         ORDER BY pe.created_at DESC
         LIMIT $2 OFFSET $3`,
        [userId, limit, offset],
      ),
      pool.query(
        `SELECT COUNT(pe.id)::int AS total
         FROM project_events pe
         JOIN projects p ON pe.project_id = p.id
         WHERE p.assigned_developer_id = $1
            OR (pe.actor_id = $1 AND pe.event_type = 'bid_placed')`,
        [userId],
      ),
    ]);

    const total = countResult.rows[0].total;

    res.json({
      data: dataResult.rows,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    logger.error("getDeveloperActivity error", err);
    res.status(500).json({ message: "Failed to fetch developer activity" });
  }
}

module.exports = { getClientStats, getDeveloperStats, getClientActivity, getDeveloperActivity };
