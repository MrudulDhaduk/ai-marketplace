/**
 * socket.js — Socket.IO client singleton
 *
 * Phase 3: JWT is in an httpOnly cookie. withCredentials sends it on the
 * WebSocket upgrade request automatically.
 *
 * Phase 4: Added reconnect configuration with jitter to prevent thundering
 * herd on server restart. All clients reconnect at randomized intervals
 * instead of simultaneously.
 */
import { io } from "socket.io-client";

const socketUrl =
  process.env.REACT_APP_SOCKET_URL ||
  process.env.REACT_APP_API_URL ||
  window.location.origin;

export const socket = io(socketUrl, {
  transports:   ["websocket"],
  autoConnect:  false,
  withCredentials: true,

  // ── Reconnect with jitter (Phase 4) ──────────────────────────────────────
  // Prevents all clients reconnecting simultaneously after a server restart.
  // With randomizationFactor: 0.5, a 1000ms base delay becomes 500–1500ms.
  reconnection:           true,
  reconnectionAttempts:   15,
  reconnectionDelay:      1000,   // start at 1s
  reconnectionDelayMax:   30000,  // cap at 30s
  randomizationFactor:    0.5,    // ±50% jitter
});

export function connectSocket() {
  if (!socket.connected) socket.connect();
  return socket;
}

export function disconnectSocket() {
  if (socket.connected) socket.disconnect();
}
