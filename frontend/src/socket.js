import { io } from "socket.io-client";
import { getToken, isTokenExpired } from "./api";

const socketUrl = process.env.REACT_APP_SOCKET_URL || process.env.REACT_APP_API_URL || window.location.origin;

export const socket = io(socketUrl, {
  transports: ["websocket"],
  autoConnect: true,
  auth: (cb) => {
    const token = getToken();
    cb({ token: token && !isTokenExpired(token) ? token : undefined });
  },
});

export function connectSocket() {
  if (!socket.connected) socket.connect();
  return socket;
}
