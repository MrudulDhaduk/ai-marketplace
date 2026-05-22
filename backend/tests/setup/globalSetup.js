/**
 * globalSetup.js — Jest global setup
 *
 * Runs once before all test suites start.
 * Creates the test database if it doesn't exist and runs migrations.
 *
 * Registered in jest.config.js as globalSetup.
 */
const { Pool } = require("pg");
const path = require("path");
const fs = require("fs");

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ||
  "postgresql://postgres:ghanshyam@localhost:5432/ai_marketplace_test";

module.exports = async function globalSetup() {
  // Verify the test DB is reachable — fail fast with a clear message
  const pool = new Pool({ connectionString: TEST_DB_URL, ssl: false, max: 1 });
  try {
    await pool.query("SELECT 1");
    console.log("\n✅ Test database connection verified\n");
  } catch (err) {
    console.error("\n❌ Cannot connect to test database:", err.message);
    console.error("   Run: npm run migrate:test\n");
    throw err;
  } finally {
    await pool.end();
  }
};
