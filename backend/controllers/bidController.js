const pool = require("../config/db");
const logger = require("../utils/logger");
const { validateBid } = require("../utils/validation");
const { createNotification } = require("../services/notificationService");

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

/** POST /projects/:id/bid */
async function placeBid(req, res) {
  try {
    const { id } = req.params;
    const { amount, proposal } = req.body;
    const developerId = req.user.id;

    const error = validateBid({ amount, proposal });
    if (error) return res.status(400).json({ message: error });

    const projectRes = await pool.query(
      `SELECT id, title, client_id, assigned_developer_id, status FROM projects WHERE id = $1`,
      [id],
    );

    if (!projectRes.rows.length) {
      return res.status(404).json({ message: "Project not found" });
    }

    const project = projectRes.rows[0];

    if (project.assigned_developer_id) {
      return res.status(400).json({ message: "Project already assigned" });
    }

    if (project.status !== "bidding") {
      return res.status(400).json({ message: "Project is not accepting bids" });
    }

    const existingBid = await pool.query(
      "SELECT 1 FROM bids WHERE project_id = $1 AND developer_id = $2",
      [id, developerId],
    );

    if (existingBid.rows.length) {
      return res.status(409).json({ message: "You already placed a bid on this project" });
    }

    const result = await pool.query(
      `INSERT INTO bids (project_id, developer_id, amount, proposal)
       VALUES ($1, $2, $3, $4)
       RETURNING id, project_id, developer_id, amount, proposal, status, created_at`,
      [id, developerId, Number(amount), proposal.trim()],
    );

    // Persist notification + emit socket event
    if (project.client_id) {
      await createNotification({
        io: req.io,
        userId: project.client_id,
        type: "new_bid",
        message: `New bid on "${project.title}"`,
        meta: { projectId: Number(id), developerId, amount: Number(amount) },
      });
    }

    // Record project event
    await pool.query(
      `INSERT INTO project_events (project_id, actor_id, event_type, meta)
       VALUES ($1, $2, 'bid_placed', $3)`,
      [id, developerId, JSON.stringify({ amount: Number(amount) })],
    ).catch((e) => logger.error("project_events insert error", e));

    res.status(201).json({ message: "Bid placed successfully", bid: result.rows[0] });
  } catch (err) {
    logger.error("placeBid error", err);
    res.status(500).json({ message: "Error placing bid" });
  }
}

/** GET /api/projects/:projectId/bids — with pagination */
async function getProjectBids(req, res) {
  const { projectId } = req.params;
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(req.query.limit) || DEFAULT_PAGE_SIZE));
  const offset = (page - 1) * limit;

  try {
    const project = await pool.query(
      "SELECT client_id FROM projects WHERE id = $1",
      [projectId],
    );

    if (!project.rows.length) return res.status(404).json({ error: "Project not found" });
    if (project.rows[0].client_id !== req.user.id) return res.status(403).json({ error: "Unauthorized" });

    const [bidsResult, countResult] = await Promise.all([
      pool.query(
        `SELECT b.id, b.amount, b.proposal, b.status, b.created_at,
                u.id AS developer_id, u.username, u.email,
                u.first_name, u.last_name
         FROM bids b
         JOIN users u ON b.developer_id = u.id
         WHERE b.project_id = $1
         ORDER BY b.created_at DESC
         LIMIT $2 OFFSET $3`,
        [projectId, limit, offset],
      ),
      pool.query("SELECT COUNT(*)::int AS total FROM bids WHERE project_id = $1", [projectId]),
    ]);

    const total = countResult.rows[0].total;

    res.json({
      data: bidsResult.rows,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    logger.error("getProjectBids error", err);
    res.status(500).json({ error: "Failed to fetch bids" });
  }
}

/** POST /api/projects/:projectId/accept-bid/:bidId */
async function acceptBid(req, res) {
  const { projectId, bidId } = req.params;
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const project = await client.query(
      `SELECT client_id, status, assigned_developer_id, title FROM projects WHERE id = $1 FOR UPDATE`,
      [projectId],
    );

    if (!project.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Project not found" });
    }

    const proj = project.rows[0];

    if (proj.client_id !== req.user.id) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "Unauthorized" });
    }

    if (proj.assigned_developer_id) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Project already assigned" });
    }

    if (proj.status !== "bidding") {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Project not open for assignment" });
    }

    const bidResult = await client.query(
      "SELECT id, developer_id, amount, status FROM bids WHERE id = $1 AND project_id = $2",
      [bidId, projectId],
    );

    const bid = bidResult.rows[0];
    if (!bid) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Bid not found" });
    }

    if (bid.status === "accepted") {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Bid already accepted" });
    }

    await client.query(
      "UPDATE projects SET status = 'active', assigned_developer_id = $1 WHERE id = $2",
      [bid.developer_id, projectId],
    );

    await client.query("UPDATE bids SET status = 'accepted' WHERE id = $1", [bidId]);
    await client.query(
      "UPDATE bids SET status = 'rejected' WHERE project_id = $1 AND id != $2",
      [projectId, bidId],
    );

    await client.query("COMMIT");

    // Persist notification + emit socket event to developer
    await createNotification({
      io: req.io,
      userId: Number(bid.developer_id),
      type: "bid_accepted",
      message: `Your bid for "${proj.title}" was accepted 🎉`,
      meta: { projectId: Number(projectId), amount: bid.amount },
    });

    // Record project events
    await pool.query(
      `INSERT INTO project_events (project_id, actor_id, event_type, meta)
       VALUES ($1, $2, 'bid_accepted', $3), ($1, $2, 'project_assigned', $4)`,
      [
        projectId,
        req.user.id,
        JSON.stringify({ bidId: Number(bidId), developerId: bid.developer_id }),
        JSON.stringify({ developerId: bid.developer_id }),
      ],
    ).catch((e) => logger.error("project_events insert error", e));

    res.json({
      message: "Bid accepted successfully",
      assignedDeveloperId: bid.developer_id,
      projectId,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    logger.error("acceptBid error", err);
    res.status(500).json({ error: "Failed to accept bid" });
  } finally {
    client.release();
  }
}

/** GET /bids/developer/:id — with pagination */
async function getDeveloperBids(req, res) {
  try {
    const { id } = req.params;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(req.query.limit) || DEFAULT_PAGE_SIZE));
    const offset = (page - 1) * limit;

    const [dataResult, countResult] = await Promise.all([
      pool.query(
        `SELECT b.id, b.amount, b.proposal, b.status, b.created_at,
                p.id AS project_id, p.title, p.min_budget, p.max_budget, p.status AS project_status
         FROM bids b
         JOIN projects p ON b.project_id = p.id
         WHERE b.developer_id = $1
         ORDER BY b.created_at DESC
         LIMIT $2 OFFSET $3`,
        [id, limit, offset],
      ),
      pool.query("SELECT COUNT(*)::int AS total FROM bids WHERE developer_id = $1", [id]),
    ]);

    const total = countResult.rows[0].total;

    res.json({
      data: dataResult.rows,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    logger.error("getDeveloperBids error", err);
    res.status(500).json({ message: "Error fetching bids" });
  }
}

module.exports = { placeBid, getProjectBids, acceptBid, getDeveloperBids };
