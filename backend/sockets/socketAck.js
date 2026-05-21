/**
 * socketAck.js — Critical event acknowledgement with retry
 *
 * Wraps socket.emit() for critical events with:
 *   - A 5-second ack timeout
 *   - Up to 3 retry attempts on timeout
 *   - Structured logging of ack latency and failures
 *
 * Usage:
 *   emitWithAck(io.to(room), eventName, envelope, { logger })
 *
 * The client must call the ack callback when it receives the event:
 *   socket.on("submission:created", (payload, ack) => {
 *     processEvent(payload);
 *     if (typeof ack === "function") ack({ received: true });
 *   });
 *
 * NOTE: Socket.IO ack callbacks only work when emitting to a single socket,
 * not to a room. For room emits we use fire-and-forget (the typed event
 * itself carries enough data for the client to self-heal via replay).
 * Acks are used when we have a direct socket reference (e.g. from the
 * connection handler or from io.sockets.sockets.get(socketId)).
 */

const ACK_TIMEOUT_MS = 5000;
const MAX_RETRIES    = 3;

/**
 * Emit a critical event to a single socket with ack + retry.
 *
 * @param {object} socket     - individual Socket.IO socket (not a room)
 * @param {string} eventName  - typed event name
 * @param {object} envelope   - full typed event envelope
 * @param {object} [opts]
 * @param {object} [opts.logger]   - logger instance
 * @param {number} [opts.attempt]  - current attempt (internal, starts at 1)
 */
function emitWithAck(socket, eventName, envelope, opts = {}) {
  const { logger = console, attempt = 1 } = opts;
  const emittedAt = Date.now();

  const timeoutId = setTimeout(() => {
    if (attempt < MAX_RETRIES) {
      logger.warn("socket ack timeout — retrying", {
        socketId:  socket.id,
        userId:    socket.user?.id,
        event:     eventName,
        seqId:     envelope.seqId,
        attempt,
      });
      emitWithAck(socket, eventName, envelope, { logger, attempt: attempt + 1 });
    } else {
      logger.warn("socket ack failed after max retries", {
        socketId:  socket.id,
        userId:    socket.user?.id,
        event:     eventName,
        seqId:     envelope.seqId,
        attempts:  attempt,
      });
      // Future: persist to pending_socket_deliveries table here
    }
  }, ACK_TIMEOUT_MS);

  socket.emit(eventName, envelope, (ack) => {
    clearTimeout(timeoutId);
    if (ack?.received) {
      const latencyMs = Date.now() - emittedAt;
      logger.debug("socket ack received", {
        socketId:  socket.id,
        userId:    socket.user?.id,
        event:     eventName,
        seqId:     envelope.seqId,
        latencyMs,
        attempt,
      });
    }
  });
}

/**
 * Emit a critical event to all sockets in a room, with ack on each
 * individual socket that is currently connected.
 *
 * @param {object} io         - Socket.IO server instance
 * @param {string} room       - room name (e.g. "project_42")
 * @param {string} eventName  - typed event name
 * @param {object} envelope   - full typed event envelope
 * @param {object} [opts]     - { logger }
 */
async function emitToRoomWithAck(io, room, eventName, envelope, opts = {}) {
  const { logger = console } = opts;

  // Emit to the room so all clients receive the event
  io.to(room).emit(eventName, envelope);

  // Get individual sockets in the room for ack tracking
  try {
    const sockets = await io.in(room).fetchSockets();
    for (const s of sockets) {
      emitWithAck(s, eventName, envelope, { logger });
    }
  } catch (err) {
    logger.error("emitToRoomWithAck fetchSockets error", err);
  }
}

module.exports = { emitWithAck, emitToRoomWithAck };
