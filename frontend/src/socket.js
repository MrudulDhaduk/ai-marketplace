/**
 * socket.js — Socket.IO client singleton
 *
 * Phase 3 change: The JWT is now in an httpOnly cookie and is not accessible
 * to JavaScript. Socket.IO's handshake cannot read httpOnly cookies directly,
 * so we use the withCredentials option to send the auth cookie automatically
 * on the initial HTTP upgrade request. The server's Socket.IO auth middleware
 * reads the cookie from the handshake headers.
 *
 * The Bearer-header fallback in the server auth middleware is kept for
 * backward compatibility with any non-browser clients.
 */
import { io } from "socket.io-client";

const socketUrl = process.env.REACT_APP_SOCKET_URL || process.env.REACT_APP_API_URL || window.location.origin;

export const socket = io(socketUrl, {
  transports: ["websocket"],
  autoConnect: false,
  // withCredentials sends the httpOnly auth cookie on the WebSocket upgrade
  // request, which the server reads in the Socket.IO auth middleware.
  withCredentials: true,
});

export function connectSocket() {
  if (!socket.connected) socket.connect();
  return socket;
}

export function disconnectSocket() {
  if (socket.connected) socket.disconnect();
}
