/**
 * globalTeardown.js — Jest global teardown
 *
 * Closes the shared pg pool after ALL test suites have finished.
 * This prevents "pool has been ended" errors when test files run
 * sequentially with --runInBand and share the same pool instance.
 *
 * Registered in jest.config.js as globalTeardown.
 */
module.exports = async function globalTeardown() {
  // The pool is a singleton in testDb.js. We need to require it here
  // to close it after all suites complete.
  // Note: globalTeardown runs in a separate context from tests, so we
  // use a direct pg connection rather than the cached module.
  const { Pool } = require("pg");
  const pool = new Pool({
    connectionString:
      process.env.TEST_DATABASE_URL ||
      "postgresql://postgres:ghanshyam@localhost:5432/ai_marketplace_test",
    ssl: false,
  });
  try {
    await pool.end();
  } catch {
    // Already closed — ignore
  }
};
