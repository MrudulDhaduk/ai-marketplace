import { io } from "socket.io-client";

// Single shared Socket.IO client instance for the app.
// URL defaults to the API server on localhost:5000.
export const socket = io(process.env.REACT_APP_SOCKET_URL || "http://localhost:5000", {
  transports: ["websocket"],
});

