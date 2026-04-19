const express = require("express");
const cors = require("cors");
const pool = require("./db");
const jwt = require("jsonwebtoken");
const app = express();
app.use(cors());
app.use(express.json());

const http = require("http");
const { Server } = require("socket.io");

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
  },
});

const authenticateUser = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({ message: "No token" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, "SECRET_KEY");
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ message: "Invalid token" });
  }
};

app.get("/", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW()");
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).send("DB Error");
  }
});

app.post("/api/projects", authenticateUser, async (req, res) => {
  try {
    console.log("BODY:", req.body);
    console.log("USER:", req.user);

    const { title, description, minBudget, maxBudget, dueDate, status, tags } =
      req.body;
    const userId = req.user.id;

    const result = await pool.query(
      `INSERT INTO projects 
   (title, description, min_budget, max_budget, due_date, status, tags, client_id)
   VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
   RETURNING *`,
      [
        title,
        description,
        minBudget,
        maxBudget,
        dueDate,
        status || "draft",
        tags || [],
        userId,
      ],
    );

    console.log("INSERTED:", result.rows[0]);

    res.json(result.rows[0]);
  } catch (err) {
    console.error("ERROR:", err);
    res.status(500).json({ message: "Error creating project" });
  }
});

app.get("/api/projects", authenticateUser, async (req, res) => {
  try {
    const userId = req.user.id;

    const result = await pool.query(
      "SELECT * FROM projects WHERE client_id = $1 ORDER BY id DESC",
      [userId],
    );

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error fetching projects");
  }
});

const bcrypt = require("bcrypt");

app.post("/auth/signup", async (req, res) => {
  try {
    console.log("Signup API called");

    const { firstName, lastName, username, email, password, role } = req.body;

    // basic validation
    if (!firstName || !lastName || !username || !email || !password) {
      return res.status(400).send("All fields are required");
    }

    // hash password
    const hashedPassword = await bcrypt.hash(password, 10);
    const userRole = role || "client";
    const result = await pool.query(
      `INSERT INTO users (first_name, last_name, username, email, password, role)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, username, email, role`,
      [firstName, lastName, username, email, hashedPassword, userRole],
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);

    if (err.code === "23505") {
      if (err.constraint.includes("username")) {
        return res.status(400).json({
          field: "username",
          message: "Username already taken",
        });
      }

      if (err.constraint.includes("email")) {
        return res.status(400).json({
          field: "email",
          message: "Email already registered",
        });
      }

      return res.status(400).json({
        field: "general",
        message: "User already exists",
      });
    }

    res.status(500).send("Signup error");
  }
});
app.post("/auth/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    // 🔒 basic validation
    if (!username || !password) {
      return res.status(400).json({
        message: "Username and password are required",
      });
    }

    // 🔍 find user
    const result = await pool.query("SELECT * FROM users WHERE username = $1", [
      username,
    ]);

    const user = result.rows[0];

    // ❌ user not found
    if (!user) {
      return res.status(400).json({
        message: "Invalid username or password",
      });
    }

    // 🔐 compare password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({
        message: "Invalid username or password",
      });
    }

    const jwt = require("jsonwebtoken");

    const token = jwt.sign(
      { id: user.id, username: user.username },
      "SECRET_KEY",
      { expiresIn: "1d" },
    );

    res.json({
      message: "Login successful",
      token, // ✅ VERY IMPORTANT
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      message: "Server error",
    });
  }
});
app.get("/profile/:id", async (req, res) => {
  try {
    const { id } = req.params;
    // 🔍 get user
    const userResult = await pool.query(
      "SELECT id, username, email, role, email_verified, phone, phone_verified, bio FROM users WHERE id = $1",
      [id],
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    const user = userResult.rows[0];
    const signals = {
      emailVerified: user.email_verified,
      phoneVerified: user.phone_verified,
    };
    // 📊 get stats
    const statsResult = await pool.query(
      `SELECT 
        COUNT(*) FILTER (WHERE status = 'completed') AS "projectsCompleted",
        COUNT(*) FILTER (WHERE status = 'active') AS "activeProjects"
       FROM projects
       WHERE client_id = $1`,
      [id],
    );

    const stats = statsResult.rows[0];

    res.json({
      user,
      stats,
      signals,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error fetching profile" });
  }
});

/* Skills API:
- GET /profile/:id/skills - get all skills for user
- POST /profile/:id/skills - add a skill (body: { skill })
- DELETE /profile/:id/skills - delete a skill (body: { skill })
*/

app.get("/profile/:id/skills", async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      "SELECT skill FROM user_skills WHERE user_id = $1",
      [id],
    );

    res.json(result.rows.map((r) => r.skill));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error fetching skills" });
  }
});

app.post("/profile/:id/skills", async (req, res) => {
  try {
    const { id } = req.params;
    const { skill } = req.body;

    const result = await pool.query(
      "INSERT INTO user_skills (user_id, skill) VALUES ($1, $2) RETURNING *",
      [id, skill],
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error adding skill" });
  }
});

app.delete("/profile/:id/skills", async (req, res) => {
  try {
    const { id } = req.params;
    const { skill } = req.body;

    await pool.query(
      "DELETE FROM user_skills WHERE user_id = $1 AND skill = $2",
      [id, skill],
    );

    res.json({ message: "Deleted" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error deleting skill" });
  }
});

/* ════════════════════════════════════════════════════
   project discovery (skill matching) api for developers
════════════════════════════════════════════════════ */

app.get("/projects/discover/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { all } = req.query; // 🔥 NEW

    // ✅ Get open/bidding projects
    const projectsRes = await pool.query(
      `SELECT * FROM projects 
       WHERE status IN ('open', 'bidding')`,
    );

    const allProjects = projectsRes.rows;

    // 🔥 CASE 1 — SHOW ALL PROJECTS
    if (all === "true") {
      return res.json(allProjects);
    }

    // 🔥 CASE 2 — SKILL FILTERING
    const skillsRes = await pool.query(
      "SELECT skill FROM user_skills WHERE user_id = $1",
      [id],
    );

    const userSkills = skillsRes.rows.map((s) => s.skill.toLowerCase());

    if (!userSkills.length) {
      return res.json([]);
    }

    const filtered = allProjects.filter((p) => {
      const tech = p.technologies || p.tags || [];

      return tech.some((t) => userSkills.includes(t.toLowerCase()));
    });

    res.json(filtered);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error fetching projects" });
  }
});

/* ════════════════════════════════════════════════════
   Bidding API for developers
════════════════════════════════════════════════════ */
app.post("/projects/:id/bid", async (req, res) => {
  try {
    const { id } = req.params;
    const { developerId, amount, proposal } = req.body;

    // 🔴 1. Basic validation
    if (!developerId || !amount || !proposal) {
      return res.status(400).json({ message: "All fields are required" });
    }

    // 🔴 2. Check project exists
    const projectRes = await pool.query(
      "SELECT * FROM projects WHERE id = $1",
      [id],
    );

    if (projectRes.rows.length === 0) {
      return res.status(404).json({ message: "Project not found" });
    }

    const project = projectRes.rows[0]; // ✅ NOW SAFE

    // 🔴 3. Check if already assigned
    if (project.assigned_developer_id) {
      return res.status(400).json({
        message: "Project already assigned",
      });
    }

    // 🔴 4. Check status
    if (project.status !== "bidding") {
      return res.status(400).json({
        message: "Project is not accepting bids",
      });
    }

    // 🔴 5. Prevent duplicate bids
    const existingBid = await pool.query(
      "SELECT * FROM bids WHERE project_id = $1 AND developer_id = $2",
      [id, developerId],
    );

    if (existingBid.rows.length > 0) {
      return res.status(400).json({
        message: "You already placed a bid",
      });
    }

    // 🔴 6. Insert bid
    const result = await pool.query(
      `INSERT INTO bids (project_id, developer_id, amount, proposal)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [id, developerId, amount, proposal],
    );

    // ✅ Real-time notify client: new bid placed
    if (project.client_id) {
      io.to(`user_${project.client_id}`).emit("new_bid", {
        type: "new_bid",
        message: `New bid on "${project.title}"`,
        projectId: id,
        developerId: developerId,
        amount: amount,
      });
    }
    res.json({
      message: "Bid placed successfully",
      bid: result.rows[0],
    });
  } catch (err) {
    console.error("🔥 BID ERROR:", err);
    res.status(500).json({ message: err.message });
  }
});

/* ════════════════════════════════════════════════════
   Bidding API for clients (accept/reject bids, auto-contract)
════════════════════════════════════════════════════ */
app.get("/api/projects/:projectId/bids", authenticateUser, async (req, res) => {
  const { projectId } = req.params;

  try {
    // Fetch project for authorization
    const project = await pool.query(
      "SELECT client_id FROM projects WHERE id = $1",
      [projectId],
    );

    if (project.rows.length === 0) {
      return res.status(404).json({ error: "Project not found" });
    }

    if (project.rows[0].client_id !== req.user.id) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    const bids = await pool.query(
      `
      SELECT 
        bids.id,
        bids.amount,
        bids.proposal,
        bids.status,
        bids.created_at,
        users.id as developer_id,
        users.username,
        users.email,
        users.first_name,
        users.last_name
      FROM bids
      JOIN users ON bids.developer_id = users.id
      WHERE bids.project_id = $1
      ORDER BY bids.created_at DESC
      `,
      [projectId],
    );

    res.json(bids.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Failed to fetch bids" });
  }
});

app.post(
  "/api/projects/:projectId/accept-bid/:bidId",
  authenticateUser,
  async (req, res) => {
    const { projectId, bidId } = req.params;

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      // Authorization and project fetch + ROW LOCK and extra field
      const project = await client.query(
        `SELECT client_id, status, assigned_developer_id 
         FROM projects 
         WHERE id = $1 
         FOR UPDATE`,
        [projectId],
      );

      if (project.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Project not found" });
      }

      if (project.rows[0].client_id !== req.user.id) {
        await client.query("ROLLBACK");
        return res.status(403).json({ error: "Unauthorized" });
      }

      // Check if already assigned to a developer
      if (project.rows[0].assigned_developer_id) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "Project already assigned" });
      }

      // Flexible project status check
      if (project.rows[0].status !== "bidding") {
        await client.query("ROLLBACK");
        return res
          .status(400)
          .json({ error: "Project not open for assignment" });
      }

      // 1. Get bid
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

      // 2. Update project → assign developer + mark active
      await client.query(
        `
        UPDATE projects
        SET status = 'active',
            assigned_developer_id = $1
        WHERE id = $2
        `,
        [bid.developer_id, projectId],
      );

      // 3. Mark selected bid as accepted
      await client.query(
        `
        UPDATE bids
        SET status = 'accepted'
        WHERE id = $1
        `,
        [bidId],
      );

      // 4. Reject all other bids
      await client.query(
        `
        UPDATE bids
        SET status = 'rejected'
        WHERE project_id = $1 AND id != $2
        `,
        [projectId, bidId],
      );

      await client.query("COMMIT");

      // ✅ Real-time notify developer: bid accepted
      const projectInfo = await client.query(
        "SELECT title FROM projects WHERE id = $1",
        [projectId],
      );
      const projectTitle = projectInfo.rows?.[0]?.title || "";

      io.to(`user_${bid.developer_id}`).emit("bid_accepted", {
        type: "bid_accepted",
        message: `Your bid for "${projectTitle}" was accepted 🎉`,
        projectId: projectId,
        amount: bid.amount,
      });

      res.json({
        message: "Bid accepted successfully",
        assignedDeveloperId: bid.developer_id,
        projectId: projectId,
      });
    } catch (err) {
      await client.query("ROLLBACK");
      console.error(err);
      res.status(500).json({ error: err.message || "Failed to accept bid" });
    } finally {
      client.release();
    }
  },
);

/* ════════════════════════════════════════════════════
    Get assigned projects for developer dashboard(MY PROJECTS tab)
════════════════════════════════════════════════════ */

app.get("/projects/assigned/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT * FROM projects
       WHERE assigned_developer_id = $1
       AND status IN ('active', 'completed')
       ORDER BY due_date ASC`,
      [id]
    );

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error fetching assigned projects" });
  }
});

/* ════════════════════════════════════════════════════
    Socket.IO real-time notifications
════════════════════════════════════════════════════ */
io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.on("register", (userId) => {
    socket.join(`user_${userId}`);
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
  });
});

/* ════════════════════════════════════════════════════
    Get bids placed by developer (for Active Bids tab)
════════════════════════════════════════════════════ */

app.get("/bids/developer/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT 
         bids.id,
         bids.amount,
         bids.proposal,
         bids.status,
         bids.created_at,
         projects.title,
         projects.min_budget,
         projects.max_budget
       FROM bids
       JOIN projects ON bids.project_id = projects.id
       WHERE bids.developer_id = $1
       ORDER BY bids.created_at DESC`,
      [id]
    );

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error fetching bids" });
  }
});

server.listen(5000, () => {
  console.log("Server running on port 5000");
});
