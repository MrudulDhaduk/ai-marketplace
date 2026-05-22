/**
 * Unit tests for backend/sockets/socketRateLimiter.js
 *
 * Tests the per-socket rate limiting logic without any network layer.
 */

// The module exports a singleton, so we need to reset modules between tests
// that need a fresh limiter state.

describe("socketRateLimiter", () => {
  let rateLimiter;
  let mockSocket;

  // Suppress logger output — rate limit violations intentionally log debug/warn
  // messages. We assert on behaviour (return values, disconnect calls), not logs.
  beforeAll(() => {
    jest.spyOn(console, "debug").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    jest.resetModules();
    rateLimiter = require("../../sockets/socketRateLimiter");
    mockSocket = {
      id: "socket-test-id",
      user: { id: 1, username: "testuser" },
      emit: jest.fn(),
      disconnect: jest.fn(),
    };
  });

  afterEach(() => {
    rateLimiter.cleanup(mockSocket.id);
  });

  test("allows events within the rate limit", () => {
    // typing allows 5 per second
    for (let i = 0; i < 5; i++) {
      expect(rateLimiter.check(mockSocket, "typing")).toBe(true);
    }
  });

  test("blocks events that exceed the rate limit", () => {
    // typing allows 5 per second — 6th should be blocked
    for (let i = 0; i < 5; i++) {
      rateLimiter.check(mockSocket, "typing");
    }
    expect(rateLimiter.check(mockSocket, "typing")).toBe(false);
  });

  test("cleanup removes socket state", () => {
    rateLimiter.check(mockSocket, "typing");
    expect(rateLimiter.size()).toBeGreaterThan(0);
    rateLimiter.cleanup(mockSocket.id);
    // After cleanup, the socket should be gone from state
    // A fresh check should be allowed again
    expect(rateLimiter.check(mockSocket, "typing")).toBe(true);
  });

  test("different event types have independent counters", () => {
    // Exhaust typing limit
    for (let i = 0; i < 5; i++) {
      rateLimiter.check(mockSocket, "typing");
    }
    expect(rateLimiter.check(mockSocket, "typing")).toBe(false);

    // register should still be allowed (different event type)
    expect(rateLimiter.check(mockSocket, "register")).toBe(true);
  });

  test("different sockets have independent counters", () => {
    const socket2 = { id: "socket-2", user: { id: 2 }, emit: jest.fn(), disconnect: jest.fn() };

    // Exhaust socket1 typing limit
    for (let i = 0; i < 5; i++) {
      rateLimiter.check(mockSocket, "typing");
    }
    expect(rateLimiter.check(mockSocket, "typing")).toBe(false);

    // socket2 should still be allowed
    expect(rateLimiter.check(socket2, "typing")).toBe(true);

    rateLimiter.cleanup(socket2.id);
  });

  test("disconnects socket after violation threshold for join_project", () => {
    // join_project disconnects after 10 violations
    // First exhaust the window (15 allowed per 60s)
    for (let i = 0; i < 15; i++) {
      rateLimiter.check(mockSocket, "join_project");
    }
    // Now trigger violations until disconnect threshold
    for (let i = 0; i < 10; i++) {
      rateLimiter.check(mockSocket, "join_project");
    }
    expect(mockSocket.disconnect).toHaveBeenCalledWith(true);
  });

  test("typing events never disconnect (disconnectAfterViolations is null)", () => {
    // Exceed typing limit many times
    for (let i = 0; i < 100; i++) {
      rateLimiter.check(mockSocket, "typing");
    }
    expect(mockSocket.disconnect).not.toHaveBeenCalled();
  });
});
