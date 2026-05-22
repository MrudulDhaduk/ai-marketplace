/**
 * Unit tests for backend/utils/logger.js
 */
describe("logger", () => {
  let logger;
  let consoleSpy;

  beforeEach(() => {
    jest.resetModules();
    process.env.LOG_LEVEL = "debug";
    process.env.NODE_ENV = "test";
    logger = require("../../utils/logger");
  });

  afterEach(() => {
    if (consoleSpy) consoleSpy.mockRestore();
  });

  test("info() writes JSON with correct level", () => {
    consoleSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    logger.info("test message", { userId: 42 });
    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(parsed.level).toBe("info");
    expect(parsed.message).toBe("test message");
    expect(parsed.userId).toBe(42);
    expect(parsed.ts).toBeDefined();
  });

  test("error() serialises Error objects", () => {
    consoleSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    const err = new Error("something broke");
    logger.error("caught error", err);
    const parsed = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(parsed.level).toBe("error");
    expect(parsed.error).toBe("something broke");
    expect(parsed.errorType).toBe("Error");
  });

  test("warn() writes JSON with warn level", () => {
    consoleSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    logger.warn("watch out");
    const parsed = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(parsed.level).toBe("warn");
  });

  test("child() merges context into every log entry", () => {
    consoleSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const child = logger.child({ reqId: "abc-123", userId: 7 });
    child.info("child log");
    const parsed = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(parsed.reqId).toBe("abc-123");
    expect(parsed.userId).toBe(7);
    expect(parsed.message).toBe("child log");
  });

  test("debug() is suppressed when LOG_LEVEL=info", () => {
    jest.resetModules();
    process.env.LOG_LEVEL = "info";
    const quietLogger = require("../../utils/logger");
    consoleSpy = jest.spyOn(console, "debug").mockImplementation(() => {});
    quietLogger.debug("should not appear");
    expect(consoleSpy).not.toHaveBeenCalled();
  });
});
