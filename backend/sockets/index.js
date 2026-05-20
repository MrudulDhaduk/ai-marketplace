const jwt = require("jsonwebtoken");
const config = require("../config/env");
const pool = require("../config/db");
const logger = require("../utils/logger");
const { captureSocketError } = require("../config/sentry");
const { AUTH_COOKIE } = require("../config/constants");

// Parse a cookie string into a key→value map
function parseCookies(cookieHeader = "") {
  return Object.fromEntries(
    cookieHeader.split(";").map((c) => {
      const [k, ...v] = c.trim().split("=");
      return [k.trim(), decodeURIComponent(v.join("="))];
    }),
  );
}

function setupSockets(io) {
  // ── Auth middleware ──────────────────────────────────────────────────────────
  io.use((socket, next) => {
    try {
      // 1. Try httpOnly cookie (primary — sent via withCredentials on WS upgrade)
      const cookies = parseCookies(socket.handshake.headers?.cookie || "");
      const cookieToken = cookies[AUTH_COOKIE];

      // 2. Fall back to Bearer header (legacy clients / non-browser environments)
      const headerToken = socket.handshake.auth?.token ||
        socket.handshake.headers?.authorization?.replace(/^Bearer\s+/i, "");

      const token = cookieToken || headerToken;
      if (!token) return next(new Error("Unauthorized"));

      const decoded = jwt.verify(token, config.jwt.secret);
      socket.user = {
        id: Number(decoded.id),
        role: decoded.role,
        username: decoded.username,
      };
      next();
    } catch (err) {
      next(new Error(err.name === "TokenExpiredError" ? "Token expired" : "Unauthorized"));
    }
  });

  io.on("connection", (socket) => {
    logger.debug("socket connected", { socketId: socket.id, userId: socket.user.id });

    // Always join personal room for targeted notifications
    socket.join(`user_${socket.user.id}`);

    socket.on("disconnect", (reason) => {
      logger.debug("socket disconnected", { socketId: socket.id, userId: socket.user.id, reason });
    });

    socket.on("error", (err) => {
      logger.error("socket error", err);
      captureSocketError(err, { socketId: socket.id, userId: socket.user?.id });
    });

    // ── register (legacy support) ──────────────────────────────────────────────
    socket.on("register", (userId) => {
      if (Number(userId) === socket.user.id) {
        socket.join(`user_${socket.user.id}`);
      }
    });

    // ── join_project ───────────────────────────────────────────────────────────
    socket.on("join_project", async (projectId) => {
      const id = Number(projectId);
      if (!Number.isInteger(id) || id <= 0) return;

      try {
        const result = await pool.query(
          "SELECT client_id, assigned_developer_id FROM projects WHERE id = $1",
          [id],
        );
        const project = result.rows[0];
        if (
          project &&
          (Number(project.client_id) === socket.user.id ||
            Number(project.assigned_developer_id) === socket.user.id)
        ) {
          socket.join(`project_${id}`);
        }
      } catch (err) {
        logger.error("join_project error", err);
      }
    });

    // ── typing indicator ───────────────────────────────────────────────────────
    // Client emits: { projectId, typing: true|false }
    socket.on("typing", ({ projectId, typing }) => {
      const id = Number(projectId);
      if (!Number.isInteger(id) || id <= 0) return;
      // Broadcast to everyone else in the project room
      socket.to(`project_${id}`).emit("typing", {
        userId: socket.user.id,
        username: socket.user.username,
        typing: Boolean(typing),
      });
    });

    // ── leave_project ──────────────────────────────────────────────────────────
    socket.on("leave_project", (projectId) => {
      const id = Number(projectId);
      if (Number.isInteger(id) && id > 0) {
        socket.leave(`project_${id}`);
      }
    });
  });
}

module.exports = setupSockets;
