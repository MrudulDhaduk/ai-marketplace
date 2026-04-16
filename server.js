const express = require("express");
const cors = require("cors");
const pool = require("./db");
const jwt = require("jsonwebtoken");
const app = express();
app.use(cors());
app.use(express.json());

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
      [id]
    );

    res.json(result.rows.map(r => r.skill));
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
      [id, skill]
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
      [id, skill]
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
       WHERE status IN ('open', 'bidding')`
    );

    const allProjects = projectsRes.rows;

    // 🔥 CASE 1 — SHOW ALL PROJECTS
    if (all === "true") {
      return res.json(allProjects);
    }

    // 🔥 CASE 2 — SKILL FILTERING
    const skillsRes = await pool.query(
      "SELECT skill FROM user_skills WHERE user_id = $1",
      [id]
    );

    const userSkills = skillsRes.rows.map(s => s.skill.toLowerCase());

    if (!userSkills.length) {
      return res.json([]);
    }

    const filtered = allProjects.filter(p => {
      const tech = p.technologies || p.tags || [];

      return tech.some(t =>
        userSkills.includes(t.toLowerCase())
      );
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

    const result = await pool.query(
      `INSERT INTO bids (project_id, developer_id, amount, proposal)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [id, developerId, amount, proposal]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error placing bid" });
  }
});

app.listen(5000, () => {
  console.log("Server running on port 5000");
});
