/**
 * constants.js — Shared application constants
 *
 * Kept separate from env.js so they can be imported by any module
 * without risk of circular dependencies.
 */

// Name of the httpOnly auth cookie set on login (short-lived access token)
const AUTH_COOKIE = "auth_token";

// Name of the httpOnly refresh token cookie (long-lived, used to rotate access tokens)
const REFRESH_COOKIE = "refresh_token";

module.exports = { AUTH_COOKIE, REFRESH_COOKIE };
