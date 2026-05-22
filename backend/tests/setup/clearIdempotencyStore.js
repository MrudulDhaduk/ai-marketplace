/**
 * clearIdempotencyStore.js — Jest setupFilesAfterFramework hook
 *
 * Runs before each test FILE (not each test) to clear the in-memory
 * idempotency store. This prevents cached responses from one test suite
 * bleeding into the next when running with --runInBand.
 *
 * Registered in jest.config.js as setupFilesAfterFramework.
 */
const { clearStoreForTesting } = require("../../middleware/idempotency");

beforeAll(() => {
  clearStoreForTesting();
});
