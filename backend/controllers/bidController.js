const pool = require("../config/db");
const logger = require("../utils/logger");
const { validateBid } = require("../utils/validation");

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

/** POST /projects/:id/bid */
async function placeBid(req, res) {
  try {
    const { id } = req.params;
    const { amount, proposal } = req.body;
    const developerId = req.user.id; // Always use authenticated user — never trust body

    const error = validateBid({ amount, proposal });
    if (error) return res.status(400).json({ message: error });

    const projectRes = await pool.query("SELECT * FROM projects WHERE id = $1", [id]);

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
       RETURNING *`,
      [id, developerId, Number(amount), proposal.trim()],
    );

    if (project.client_id) {
      req.io.to(`user_${project.client_id}`).emit("new_bid", {
        type: "new_bid",
        message: `New bid on "${project.title}"`,
        projectId: id,
        developerId,
        amount: Number(amount),
      });
    }

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
        `SELECT bids.id, bids.amount, bids.proposal, bids.status, bids.created_at,
                users.id AS developer_id, users.username, users.email,
                users.first_name, users.last_name
         FROM bids
         JOIN users ON bids.developer_id = users.id
         WHERE bids.project_id = $1
         ORDER BY bids.created_at DESC
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
      `SELECT client_id, status, assigned_developer_id FROM projects WHERE id = $1 FOR UPDATE`,
      [projectId],
    );

    if (!project.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Project not found" });
    }

    if (project.rows[0].client_id !== req.user.id) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "Unauthorized" });
    }

    if (project.rows[0].assigned_developer_id) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Project already assigned" });
    }

    if (project.rows[0].status !== "bidding") {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Project not open for assignment" });
    }

    const bidResult = await client.query(
      "SELECT * FROM bids WHERE id = $1 AND project_id = $2",
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

    const projectInfo = await pool.query("SELECT title FROM projects WHERE id = $1", [projectId]);
    const projectTitle = projectInfo.rows[0]?.title || "";

    req.io.to(`user_${bid.developer_id}`).emit("bid_accepted", {
      type: "bid_accepted",
      message: `Your bid for "${projectTitle}" was accepted 🎉`,
      projectId,
      amount: bid.amount,
    });

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
        `SELECT bids.id, bids.amount, bids.proposal, bids.status, bids.created_at,
                projects.title, projects.min_budget, projects.max_budget
         FROM bids
         JOIN projects ON bids.project_id = projects.id
         WHERE bids.developer_id = $1
         ORDER BY bids.created_at DESC
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
