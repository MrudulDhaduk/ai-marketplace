/**
 * testDb.js — Test database helpers
 *
 * Creates an isolated pg Pool pointed at the test database.
 * Each test file calls resetDb() in beforeEach to wipe all tables
 * and re-seed with a known baseline, so tests are fully independent.
 */
require("dotenv").config({ path: require("path").resolve(__dirname, "../../../.env") });

const { Pool } = require("pg");

const pool = new Pool({
  connectionString:
    process.env.TEST_DATABASE_URL ||
    process.env.DATABASE_URL ||
    "postgresql://postgres:ghanshyam@localhost:5432/ai_marketplace_test",
  ssl: false,
  max: 5,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 5_000,
});

/**
 * Truncate all application tables in dependency order and reset sequences.
 * Called in beforeEach so every test starts with a clean slate.
 */
async function resetDb() {
  await pool.query(`
    TRUNCATE TABLE
      activity_comments,
      project_events,
      project_files,
      project_submissions,
      notifications,
      messages,
      bids,
      projects,
      user_skills,
      email_verifications,
      refresh_tokens,
      users
    RESTART IDENTITY CASCADE
  `);
}

/**
 * Seed a verified user and return the full row.
 */
async function seedUser({
  firstName = "Test",
  lastName = "User",
  username = "testuser",
  email = "test@example.com",
  password = "$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TiGniMnMnMnMnMnMnMnMnMnMnMnM", // "Password1"
  role = "client",
  emailVerified = true,
} = {}) {
  const result = await pool.query(
    `INSERT INTO users (first_name, last_name, username, email, password, role, email_verified)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [firstName, lastName, username, email, password, role, emailVerified],
  );
  return result.rows[0];
}

/**
 * Seed a project and return the full row.
 */
async function seedProject({
  title = "Test Project",
  description = "A test project description that is long enough",
  minBudget = 100,
  maxBudget = 500,
  dueDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
  status = "bidding",
  tags = ["javascript", "react"],
  clientId,
  assignedDeveloperId = null,
} = {}) {
  const result = await pool.query(
    `INSERT INTO projects
       (title, description, min_budget, max_budget, due_date, status, tags, client_id, assigned_developer_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [title, description, minBudget, maxBudget, dueDate, status, tags, clientId, assignedDeveloperId],
  );
  return result.rows[0];
}

/**
 * Seed a bid and return the full row.
 */
async function seedBid({ projectId, developerId, amount = 250, proposal = "I can do this project well within the deadline.", status = "pending" } = {}) {
  const result = await pool.query(
    `INSERT INTO bids (project_id, developer_id, amount, proposal, status)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [projectId, developerId, amount, proposal, status],
  );
  return result.rows[0];
}

module.exports = { pool, resetDb, seedUser, seedProject, seedBid };
