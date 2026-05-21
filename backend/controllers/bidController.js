const pool = require("../config/db");
const logger = require("../utils/logger");
const { validateBid } = require("../utils/validation");
const { createNotification } = require("../services/notificationService");
const { EVENTS, emitTypedEvent } = require("../sockets/socketEvents");
const { emitToRoomWithAck } = require("../sockets/socketAck");

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

    // Idempotency: if the developer already has a bid on this project,
    // return the existing bid instead of erroring. This handles double-clicks
    // and network retries transparently.
    const existingBid = await pool.query(
      "SELECT * FROM bids WHERE project_id = $1 AND developer_id = $2",
      [id, developerId],
    );

    if (existingBid.rows.length) {
      return res.status(200).json({
        message: "Bid already placed",
        bid: existingBid.rows[0],
        idempotent: true,
      });
    }

    const projectRes = await pool.query(
      `SELECT id, title, client_id, assigned_developer_id, status FROM projects WHERE id = $1`,
      [id],
    );

    if (!projectRes.rows.length) {
      return res.status(404).json({ message: "Project not found" });
    }

    const project = projectRes.rows[0];

    // A client cannot bid on their own project
    if (Number(project.client_id) === Number(developerId)) {
      return res.status(403).json({ message: "You cannot bid on your own project" });
    }

    if (project.assigned_developer_id) {
      return res.status(400).json({ message: "Project already assigned" });
    }

    if (project.status !== "bidding") {
      return res.status(400).json({ message: "Project is not accepting bids" });
    }

    const result = await pool.query(
      `INSERT INTO bids (project_id, developer_id, amount, proposal)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (project_id, developer_id) DO NOTHING
       RETURNING id, project_id, developer_id, amount, proposal, status, created_at`,
      [id, developerId, Number(amount), proposal.trim()],
    );

    // ON CONFLICT DO NOTHING returns no rows — fetch the existing bid
    const bid = result.rows[0] || (await pool.query(
      "SELECT id, project_id, developer_id, amount, proposal, status, created_at FROM bids WHERE project_id = $1 AND developer_id = $2",
      [id, developerId],
    )).rows[0];

    // Persist notification + emit socket event
    if (project.client_id && result.rows.length) {
      await createNotification({
        io: req.io,
        userId: project.client_id,
        type: "new_bid",
        message: `New bid on "${project.title}"`,
        meta: { projectId: Number(id), developerId, amount: Number(amount) },
      });
    }

    // Record project event only for new bids (not idempotent replays)
    if (result.rows.length) {
      const devRes = await pool.query(
        "SELECT first_name, last_name, username, role FROM users WHERE id = $1",
        [developerId],
      ).catch(() => ({ rows: [] }));
      const dev = devRes.rows[0];
      const devActorName = dev ? `${dev.first_name || ""} ${dev.last_name || ""}`.trim() || dev.username : "Unknown";

      await pool.query(
        `INSERT INTO project_events (project_id, actor_id, event_type, meta, actor_name, actor_role)
         VALUES ($1, $2, 'bid_placed', $3, $4, $5)`,
        [id, developerId, JSON.stringify({ amount: Number(amount) }), devActorName, dev?.role || "developer"],
      ).catch((e) => logger.error("project_events insert error", e));
    }

    res.status(201).json({ message: "Bid placed successfully", bid });
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

    // Fetch the bid early so we can do an idempotency check before the
    // project-state guards (which would otherwise return 400 on a replay
    // because the project is already 'active').
    const bidResult = await client.query(
      "SELECT id, developer_id, amount, status FROM bids WHERE id = $1 AND project_id = $2",
      [bidId, projectId],
    );

    const bid = bidResult.rows[0];
    if (!bid) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Bid not found" });
    }

    // Idempotency: if this bid was already accepted, return success immediately
    // without re-running the state-mutation logic.
    if (bid.status === "accepted") {
      await client.query("ROLLBACK");
      return res.json({
        message: "Bid accepted successfully",
        assignedDeveloperId: bid.developer_id,
        projectId,
        idempotent: true,
      });
    }

    if (proj.assigned_developer_id) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Project already assigned" });
    }

    if (proj.status !== "bidding") {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Project not open for assignment" });
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

    // Record project events with actor names
    const userRes = await pool.query(
      "SELECT first_name, last_name, username, role FROM users WHERE id = $1",
      [req.user.id],
    ).catch(() => ({ rows: [] }));
    const u = userRes.rows[0];
    const actorName = u ? `${u.first_name || ""} ${u.last_name || ""}`.trim() || u.username : "Unknown";

    // FIX #1 — insert only bid_accepted (project_assigned was a redundant duplicate)
    await pool.query(
      `INSERT INTO project_events (project_id, actor_id, event_type, meta, actor_name, actor_role)
       VALUES ($1, $2, 'bid_accepted', $3, $4, $5)`,
      [
        projectId,
        req.user.id,
        JSON.stringify({ bidId: Number(bidId), developerId: bid.developer_id }),
        actorName,
        u?.role || "client",
      ],
    ).catch((e) => logger.error("project_events insert error", e));

    // Emit workspace activity update
    const seqId = Date.now();

    // ── Typed events (Phase 4) — with ack ──────────────────────────────────
    const envelope = emitTypedEvent(req.io.to(`project_${projectId}`), EVENTS.BID_ACCEPTED, {
      projectId:  Number(projectId),
      actorId:    req.user.id,
      actorName:  actorName,
      actorRole:  u?.role || "client",
      seqId,
      data: {
        bidId:       Number(bidId),
        developerId: bid.developer_id,
        amount:      bid.amount,
      },
    });

    emitToRoomWithAck(req.io, `project_${projectId}`, EVENTS.BID_ACCEPTED, envelope, { logger });

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
