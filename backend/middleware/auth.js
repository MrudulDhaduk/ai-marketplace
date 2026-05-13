const jwt = require("jsonwebtoken");
const config = require("../config/env");

function authenticateUser(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  const token = authHeader.slice(7).trim();
  try {
    const decoded = jwt.verify(token, config.jwt.secret);
    req.user = { id: Number(decoded.id), username: decoded.username, role: decoded.role };
    return next();
  } catch (err) {
    const message = err.name === "TokenExpiredError" ? "Token expired" : "Invalid token";
    return res.status(401).json({ message });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ message: "Forbidden" });
    }
    next();
  };
}

function requireSelfParam(param = "id") {
  return (req, res, next) => {
    if (Number(req.user?.id) !== Number(req.params[param])) {
      return res.status(403).json({ message: "Forbidden" });
    }
    next();
  };
}

module.exports = { authenticateUser, requireRole, requireSelfParam };
