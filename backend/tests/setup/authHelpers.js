/**
 * authHelpers.js — JWT and cookie helpers for integration tests.
 *
 * Tests that need an authenticated user call makeAuthCookie(user)
 * to get a cookie string they can attach to supertest requests.
 */
const jwt = require("jsonwebtoken");
const { AUTH_COOKIE } = require("../../config/constants");

const JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret-not-for-production";

/**
 * Sign a short-lived access token for a user object.
 * @param {{ id, username, role }} user
 * @returns {string} raw JWT
 */
function signToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: "15m" },
  );
}

/**
 * Returns a cookie header string for supertest .set("Cookie", ...).
 * @param {{ id, username, role }} user
 * @returns {string}
 */
function makeAuthCookie(user) {
  const token = signToken(user);
  return `${AUTH_COOKIE}=${token}`;
}

/**
 * Returns a supertest agent with auth cookie pre-set.
 * Usage: const agent = authedAgent(request(app), clientUser);
 */
function authedAgent(supertestRequest, user) {
  return supertestRequest.set("Cookie", makeAuthCookie(user));
}

module.exports = { signToken, makeAuthCookie, authedAgent };
