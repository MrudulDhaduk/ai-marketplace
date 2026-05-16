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

/**
 * optionalAuth — attaches req.user if a valid token is present, but never
 * rejects the request. Use for public endpoints that show extra data to
 * authenticated users (e.g. public profile view).
 */
function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) return next();
  const token = authHeader.slice(7).trim();
  try {
    const decoded = jwt.verify(token, config.jwt.secret);
    req.user = { id: Number(decoded.id), username: decoded.username, role: decoded.role };
  } catch {
    // invalid/expired token — just proceed without user
  }
  return next();
}

module.exports = { authenticateUser, requireRole, requireSelfParam, optionalAuth };
