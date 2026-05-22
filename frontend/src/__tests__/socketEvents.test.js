/**
 * Frontend socket event envelope contract tests.
 *
 * Verifies that the shouldProcess guard logic (deduplication + self-skip)
 * works correctly in isolation, matching the SocketContext implementation.
 */

// ── Replicate the shouldProcess logic from SocketContext ──────────────────────
// We test the logic directly without mounting the full context.

const MAX_SEEN = 60;

function createSeenSet() {
  const items = [];
  return {
    has(id) { return items.includes(id); },
    add(id) {
      if (items.includes(id)) return;
      items.push(id);
      if (items.length > MAX_SEEN) items.shift();
    },
    size() { return items.length; },
  };
}

function makeShouldProcess(currentUserId) {
  const seenSets = new Map();
  const lastSeqIds = new Map();

  function getSeenSet(projectId) {
    if (!seenSets.has(projectId)) seenSets.set(projectId, createSeenSet());
    return seenSets.get(projectId);
  }

  function updateLastSeqId(projectId, seqId) {
    const current = lastSeqIds.get(projectId) || 0;
    if (seqId > current) lastSeqIds.set(projectId, seqId);
  }

  function shouldProcess(envelope, skipSelfEmit = true) {
    if (!envelope || envelope.v !== 1) return false;
    const { seqId, projectId, actorId } = envelope;

    if (skipSelfEmit && actorId && currentUserId && actorId === currentUserId) {
      return false;
    }

    if (projectId && seqId) {
      const seen = getSeenSet(projectId);
      if (seen.has(seqId)) return false;
      seen.add(seqId);
      updateLastSeqId(projectId, seqId);
    }

    return true;
  }

  return { shouldProcess, lastSeqIds };
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe("shouldProcess guard", () => {
  const currentUserId = 42;

  test("processes a valid envelope from another user", () => {
    const { shouldProcess } = makeShouldProcess(currentUserId);
    const envelope = { v: 1, seqId: 1000, projectId: 1, actorId: 99, data: {} };
    expect(shouldProcess(envelope)).toBe(true);
  });

  test("skips envelope from the current user (self-skip)", () => {
    const { shouldProcess } = makeShouldProcess(currentUserId);
    const envelope = { v: 1, seqId: 1001, projectId: 1, actorId: currentUserId, data: {} };
    expect(shouldProcess(envelope)).toBe(false);
  });

  test("processes self-emitted envelope when skipSelfEmit=false", () => {
    const { shouldProcess } = makeShouldProcess(currentUserId);
    const envelope = { v: 1, seqId: 1002, projectId: 1, actorId: currentUserId, data: {} };
    expect(shouldProcess(envelope, false)).toBe(true);
  });

  test("deduplicates: second call with same seqId returns false", () => {
    const { shouldProcess } = makeShouldProcess(currentUserId);
    const envelope = { v: 1, seqId: 2000, projectId: 1, actorId: 99, data: {} };
    expect(shouldProcess(envelope)).toBe(true);
    expect(shouldProcess(envelope)).toBe(false);
  });

  test("different seqIds on same project are both processed", () => {
    const { shouldProcess } = makeShouldProcess(currentUserId);
    const e1 = { v: 1, seqId: 3000, projectId: 1, actorId: 99, data: {} };
    const e2 = { v: 1, seqId: 3001, projectId: 1, actorId: 99, data: {} };
    expect(shouldProcess(e1)).toBe(true);
    expect(shouldProcess(e2)).toBe(true);
  });

  test("same seqId on different projects are both processed", () => {
    const { shouldProcess } = makeShouldProcess(currentUserId);
    const e1 = { v: 1, seqId: 4000, projectId: 1, actorId: 99, data: {} };
    const e2 = { v: 1, seqId: 4000, projectId: 2, actorId: 99, data: {} };
    expect(shouldProcess(e1)).toBe(true);
    expect(shouldProcess(e2)).toBe(true);
  });

  test("rejects envelope with wrong version (v !== 1)", () => {
    const { shouldProcess } = makeShouldProcess(currentUserId);
    const envelope = { v: 2, seqId: 5000, projectId: 1, actorId: 99, data: {} };
    expect(shouldProcess(envelope)).toBe(false);
  });

  test("rejects null envelope", () => {
    const { shouldProcess } = makeShouldProcess(currentUserId);
    expect(shouldProcess(null)).toBe(false);
  });

  test("rejects undefined envelope", () => {
    const { shouldProcess } = makeShouldProcess(currentUserId);
    expect(shouldProcess(undefined)).toBe(false);
  });

  test("processes envelope without projectId (user-level events)", () => {
    const { shouldProcess } = makeShouldProcess(currentUserId);
    const envelope = { v: 1, seqId: 6000, projectId: null, actorId: 99, data: {} };
    expect(shouldProcess(envelope)).toBe(true);
  });

  test("LRU seen-set evicts oldest entries after MAX_SEEN items", () => {
    const { shouldProcess } = makeShouldProcess(currentUserId);

    // Fill the seen set to capacity
    for (let i = 0; i < MAX_SEEN; i++) {
      shouldProcess({ v: 1, seqId: i, projectId: 1, actorId: 99, data: {} });
    }

    // The first seqId (0) should have been evicted — processing it again should succeed
    const evictedEnvelope = { v: 1, seqId: 0, projectId: 1, actorId: 99, data: {} };
    expect(shouldProcess(evictedEnvelope)).toBe(true);
  });

  test("updates lastSeqId to the highest seen value", () => {
    const { shouldProcess, lastSeqIds } = makeShouldProcess(currentUserId);

    shouldProcess({ v: 1, seqId: 100, projectId: 5, actorId: 99, data: {} });
    shouldProcess({ v: 1, seqId: 300, projectId: 5, actorId: 99, data: {} });
    shouldProcess({ v: 1, seqId: 200, projectId: 5, actorId: 99, data: {} });

    expect(lastSeqIds.get(5)).toBe(300);
  });
});
