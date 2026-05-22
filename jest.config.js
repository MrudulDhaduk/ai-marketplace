/**
 * jest.config.js — Backend test configuration
 *
 * Uses the Node test environment (no DOM).
 * Runs all files matching *.test.js inside backend/tests/.
 *
 * Each test file sets its own env vars and mocks before requiring
 * any app modules, so there is no global setup file needed.
 *
 * Timeout: 30s per test to accommodate real DB queries in integration tests.
 * Run tests serially (--runInBand) to avoid port/DB conflicts between suites.
 */

/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: "node",

  testMatch: [
    "<rootDir>/backend/tests/**/*.test.js",
  ],

  transform: {},

  testTimeout: 30_000,

  maxWorkers: 1,

  collectCoverageFrom: [
    "backend/**/*.js",
    "!backend/db/migrate.js",
    "!backend/db/migrations/**",
    "!backend/config/sentry.js",
    "!backend/server.js",
  ],

  coverageReporters: ["text", "lcov", "html"],

  coverageDirectory: "coverage/backend",

  verbose: true,

  // Clear the in-memory idempotency store before each test file so cached
  // responses from one suite don't contaminate the next (--runInBand shares
  // the same Node.js process and module registry).
  setupFilesAfterEnv: ["<rootDir>/backend/tests/setup/clearIdempotencyStore.js"],

  // Close the shared pg pool once after ALL suites finish
  globalTeardown: "<rootDir>/backend/tests/setup/globalTeardown.js",
};
