/**
 * Unit tests for backend/sockets/socketEvents.js
 *
 * Tests the typed event envelope contract — the shape that every
 * socket event must conform to. This is the contract between backend
 * and frontend; breaking it silently breaks realtime updates.
 */
const { EVENTS, emitTypedEvent } = require("../../sockets/socketEvents");

describe("EVENTS constants", () => {
  test("all event names are non-empty strings", () => {
    for (const [key, value] of Object.entries(EVENTS)) {
      expect(typeof value).toBe("string");
      expect(value.length).toBeGreaterThan(0);
    }
  });

  test("event names use colon-namespaced format", () => {
    // All events should be namespaced like "submission:created" or "system:reconnect_ack"
    // except legacy events — verify the pattern is consistent
    const namespaced = Object.values(EVENTS).filter((e) => e.includes(":"));
    expect(namespaced.length).toBe(Object.values(EVENTS).length);
  });

  test("no duplicate event values", () => {
    const values = Object.values(EVENTS);
    const unique = new Set(values);
    expect(unique.size).toBe(values.length);
  });

  test("critical events are defined", () => {
    expect(EVENTS.SUBMISSION_CREATED).toBe("submission:created");
    expect(EVENTS.APPROVAL_GRANTED).toBe("approval:granted");
    expect(EVENTS.REVISION_REQUESTED).toBe("revision:requested");
    expect(EVENTS.BID_ACCEPTED).toBe("bid:accepted");
    expect(EVENTS.MESSAGE_SENT).toBe("message:sent");
    expect(EVENTS.NOTIFICATION_RECEIVED).toBe("notification:received");
    expect(EVENTS.SYSTEM_REPLAY_BATCH).toBe("system:replay_batch");
    expect(EVENTS.SYSTEM_AUTH_EXPIRED).toBe("system:auth_expired");
  });
});

describe("emitTypedEvent", () => {
  let mockEmitter;
  let emittedEvents;

  beforeEach(() => {
    emittedEvents = [];
    mockEmitter = {
      emit: (eventName, envelope) => {
        emittedEvents.push({ eventName, envelope });
      },
    };
  });

  test("emits with correct envelope shape", () => {
    emitTypedEvent(mockEmitter, EVENTS.SUBMISSION_CREATED, {
      projectId: 42,
      actorId: 7,
      actorName: "Alice Smith",
      actorRole: "developer",
      data: { repoLink: "https://github.com/user/repo" },
    });

    expect(emittedEvents).toHaveLength(1);
    const { eventName, envelope } = emittedEvents[0];

    expect(eventName).toBe(EVENTS.SUBMISSION_CREATED);
    expect(envelope.v).toBe(1);
    expect(envelope.event).toBe(EVENTS.SUBMISSION_CREATED);
    expect(envelope.projectId).toBe(42);
    expect(envelope.actorId).toBe(7);
    expect(envelope.actorName).toBe("Alice Smith");
    expect(envelope.actorRole).toBe("developer");
    expect(envelope.data.repoLink).toBe("https://github.com/user/repo");
    expect(typeof envelope.seqId).toBe("number");
    expect(typeof envelope.ts).toBe("string");
  });

  test("returns the envelope object", () => {
    const envelope = emitTypedEvent(mockEmitter, EVENTS.BID_ACCEPTED, {
      projectId: 1,
      actorId: 2,
      data: { bidId: 5 },
    });

    expect(envelope).toBeDefined();
    expect(envelope.v).toBe(1);
    expect(envelope.data.bidId).toBe(5);
  });

  test("uses provided seqId when given", () => {
    const seqId = 1234567890;
    emitTypedEvent(mockEmitter, EVENTS.MESSAGE_SENT, {
      projectId: 1,
      actorId: 1,
      seqId,
      data: {},
    });

    expect(emittedEvents[0].envelope.seqId).toBe(seqId);
  });

  test("defaults missing fields to null", () => {
    emitTypedEvent(mockEmitter, EVENTS.NOTIFICATION_RECEIVED, { data: {} });
    const { envelope } = emittedEvents[0];
    expect(envelope.projectId).toBeNull();
    expect(envelope.actorId).toBeNull();
    expect(envelope.actorName).toBeNull();
    expect(envelope.actorRole).toBeNull();
  });

  test("calls ack callback when provided", () => {
    const ack = jest.fn();
    const emitterWithAck = {
      emit: (eventName, envelope, ackFn) => {
        emittedEvents.push({ eventName, envelope, ackFn });
      },
    };

    emitTypedEvent(emitterWithAck, EVENTS.SUBMISSION_CREATED, {
      projectId: 1,
      actorId: 1,
      data: {},
      ack,
    });

    expect(emittedEvents[0].ackFn).toBe(ack);
  });
});
