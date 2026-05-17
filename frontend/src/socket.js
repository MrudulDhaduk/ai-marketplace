import { io } from "socket.io-client";
import { getToken, isTokenExpired } from "./lib/api";

const socketUrl = process.env.REACT_APP_SOCKET_URL || process.env.REACT_APP_API_URL || window.location.origin;

// autoConnect: false — we connect manually after login to avoid
// unauthenticated connection errors on public pages
export const socket = io(socketUrl, {
  transports: ["websocket"],
  autoConnect: false,
  auth: (cb) => {
    const token = getToken();
    cb({ token: token && !isTokenExpired(token) ? token : undefined });
  },
});

export function connectSocket() {
  if (!socket.connected) socket.connect();
  return socket;
}

export function disconnectSocket() {
  if (socket.connected) socket.disconnect();
}
