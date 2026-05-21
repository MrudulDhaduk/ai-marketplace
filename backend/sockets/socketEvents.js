/**
 * socketEvents.js — Typed event constants and emit helper
 *
 * All socket event names live here as constants.
 * emitTypedEvent() wraps every payload in the standard envelope:
 *   { v, event, seqId, projectId, actorId, actorName, actorRole, ts, data }
 */

// ── Event name constants ──────────────────────────────────────────────────────
const EVENTS = {
  // Submissions
  SUBMISSION_CREATED:      "submission:created",
  SUBMISSION_NOTE_ADDED:   "submission:note_added",
  SUBMISSION_NOTE_UPDATED: "submission:note_updated",
  SUBMISSION_NOTE_DELETED: "submission:note_deleted",

  // Approvals / revisions
  APPROVAL_GRANTED:        "approval:granted",
  REVISION_REQUESTED:      "revision:requested",
  REVISION_RESOLVED:       "revision:resolved",

  // Comments
  COMMENT_ADDED:           "comment:added",

  // Typing
  TYPING_STARTED:          "typing:started",
  TYPING_STOPPED:          "typing:stopped",

  // Notifications
  NOTIFICATION_RECEIVED:   "notification:received",

  // Project lifecycle
  PROJECT_STATUS_CHANGED:  "project:status_changed",
  PROJECT_ASSIGNED:        "project:assigned",
  PROJECT_URGENT_SET:      "project:urgent_set",
  PROJECT_URGENT_CLEARED:  "project:urgent_cleared",
  PROJECT_COMPLETED:       "project:completed",

  // Activity
  ACTIVITY_ENTRY_UPDATED:  "activity:entry_updated",

  // Messages
  MESSAGE_SENT:            "message:sent",

  // Bids
  BID_PLACED:              "bid:placed",
  BID_ACCEPTED:            "bid:accepted",

  // System
  SYSTEM_RECONNECT_ACK:    "system:reconnect_ack",
  SYSTEM_REPLAY_BATCH:     "system:replay_batch",
  SYSTEM_AUTH_EXPIRED:     "system:auth_expired",
  SYSTEM_RATE_LIMIT:       "system:rate_limit_exceeded",
};

/**
 * Emit a typed event envelope to a Socket.IO room or socket.
 *
 * @param {object} emitter   - io, io.to(room), or socket instance
 * @param {string} eventName - one of EVENTS.*
 * @param {object} opts
 * @param {number}  opts.projectId  - project scope (null for user-level events)
 * @param {number}  opts.actorId    - user who triggered the event
 * @param {string}  opts.actorName  - display name at time of event
 * @param {string}  opts.actorRole  - 'client' | 'developer'
 * @param {object}  opts.data       - event-specific payload
 * @param {number}  [opts.seqId]    - monotonic cursor (defaults to Date.now())
 * @param {Function} [opts.ack]     - optional ack callback for critical events
 */
function emitTypedEvent(emitter, eventName, opts = {}) {
  const {
    projectId = null,
    actorId   = null,
    actorName = null,
    actorRole = null,
    data      = {},
    seqId     = Date.now(),
    ack       = null,
  } = opts;

  const envelope = {
    v:         1,
    event:     eventName,
    seqId,
    projectId,
    actorId,
    actorName,
    actorRole,
    ts:        new Date().toISOString(),
    data,
  };

  if (ack) {
    emitter.emit(eventName, envelope, ack);
  } else {
    emitter.emit(eventName, envelope);
  }

  return envelope;
}

module.exports = { EVENTS, emitTypedEvent };
