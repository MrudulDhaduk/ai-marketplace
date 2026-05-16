const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const pool = require("../config/db");
const config = require("../config/env");
const { validateSignup, validateLogin } = require("../utils/validation");
const logger = require("../utils/logger");

async function signup(req, res) {
  const { firstName, lastName, username, email, password, role } = req.body;

  const error = validateSignup({ firstName, lastName, username, email, password });
  if (error) return res.status(400).json({ message: error });

  try {
    const hashedPassword = await bcrypt.hash(password, 12);
    const userRole = ["client", "developer"].includes(role) ? role : "client";

    const result = await pool.query(
      `INSERT INTO users (first_name, last_name, username, email, password, role)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, username, email, role`,
      [firstName.trim(), lastName.trim(), username.trim().toLowerCase(), email.trim().toLowerCase(), hashedPassword, userRole],
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === "23505") {
      if (err.constraint?.includes("username")) {
        return res.status(409).json({ field: "username", message: "Username already taken" });
      }
      if (err.constraint?.includes("email")) {
        return res.status(409).json({ field: "email", message: "Email already registered" });
      }
      return res.status(409).json({ field: "general", message: "User already exists" });
    }
    logger.error("Signup error", err);
    res.status(500).json({ message: "Signup failed" });
  }
}

async function login(req, res) {
  const { username, password } = req.body;

  const error = validateLogin({ username, password });
  if (error) return res.status(400).json({ message: error });

  try {
    const result = await pool.query(
      "SELECT * FROM users WHERE username = $1",
      [username.trim().toLowerCase()],
    );

    const user = result.rows[0];
    if (!user) {
      return res.status(401).json({ message: "Invalid username or password" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid username or password" });
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      config.jwt.secret,
      { expiresIn: config.jwt.expiresIn },
    );

    res.json({
      message: "Login successful",
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
      },
    });
  } catch (err) {
    logger.error("Login error", err);
    res.status(500).json({ message: "Login failed" });
  }
}

module.exports = { signup, login };
