const jwt = require("jsonwebtoken");
const config = require("../config/env");
const { AUTH_COOKIE } = require("../config/constants");

function extractToken(req) {
  // 1. Prefer httpOnly cookie (primary auth mechanism post-Phase 3)
  if (req.cookies?.[AUTH_COOKIE]) return req.cookies[AUTH_COOKIE];
  // 2. Fall back to Authorization header (used by Socket.IO handshake and
  //    any legacy clients during the cookie migration window)
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) return authHeader.slice(7).trim();
  return null;
}

function authenticateUser(req, res, next) {
  const token = extractToken(req);
  if (!token) return res.status(401).json({ message: "Unauthorized" });
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
  const token = extractToken(req);
  if (!token) return next();
  try {
    const decoded = jwt.verify(token, config.jwt.secret);
    req.user = { id: Number(decoded.id), username: decoded.username, role: decoded.role };
  } catch {
    // invalid/expired token — proceed without user
  }
  return next();
}

module.exports = { authenticateUser, requireRole, requireSelfParam, optionalAuth };
