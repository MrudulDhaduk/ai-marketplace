const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");
const config = require("./config/env");
const { applySecurity, corsOptions } = require("./middleware/security");
const createRoutes = require("./routes");
const setupSockets = require("./sockets");
const { uploadDir } = require("./services/uploadService");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: corsOptions });

applySecurity(app);
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

setupSockets(io);
app.use(createRoutes(io));
app.use("/uploads", express.static(uploadDir, { dotfiles: "deny", index: false, maxAge: config.isProduction ? "1d" : 0 }));

app.use((err, req, res, next) => {
  if (err.message === "Not allowed by CORS") return res.status(403).json({ message: "CORS origin denied" });
  console.error(err);
  res.status(500).json({ message: "Internal server error" });
});

if (require.main === module) {
  server.listen(config.port, () => {
    console.log(`Server running on port ${config.port}`);
  });
}

module.exports = { app, server, io };
