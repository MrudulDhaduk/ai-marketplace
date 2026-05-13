const jwt = require("jsonwebtoken");
const config = require("../config/env");
const pool = require("../config/db");

function setupSockets(io) {
  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.replace(/^Bearer\s+/i, "");
      if (!token) return next(new Error("Unauthorized"));
      const decoded = jwt.verify(token, config.jwt.secret);
      socket.user = { id: Number(decoded.id), role: decoded.role, username: decoded.username };
      next();
    } catch (err) {
      next(new Error(err.name === "TokenExpiredError" ? "Token expired" : "Unauthorized"));
    }
  });

  io.on("connection", (socket) => {
    socket.join(`user_${socket.user.id}`);

    socket.on("register", (userId) => {
      if (Number(userId) === Number(socket.user.id)) socket.join(`user_${socket.user.id}`);
    });

    socket.on("join_project", async (projectId) => {
      const id = Number(projectId);
      if (!Number.isInteger(id) || id <= 0) return;
      const result = await pool.query(
        "SELECT client_id, assigned_developer_id FROM projects WHERE id = $1",
        [id],
      );
      const project = result.rows[0];
      if (
        project &&
        (Number(project.client_id) === socket.user.id || Number(project.assigned_developer_id) === socket.user.id)
      ) {
        socket.join(`project_${id}`);
      }
    });
  });
}

module.exports = setupSockets;
