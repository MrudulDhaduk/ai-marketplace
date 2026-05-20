const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const pool = require("../config/db");
const config = require("../config/env");
const { AUTH_COOKIE, REFRESH_COOKIE } = require("../config/constants");
const { validateSignup, validateLogin } = require("../utils/validation");
const logger = require("../utils/logger");
const { sendVerificationEmail } = require("../services/emailService");

// ── Cookie helpers ────────────────────────────────────────────────────────────

function accessCookieOptions() {
  return {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: config.isProduction ? "strict" : "lax",
    maxAge: config.jwt.cookieMaxAgeMs,
    path: "/",
  };
}

function refreshCookieOptions() {
  return {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: config.isProduction ? "strict" : "lax",
    // Refresh cookie lives for the full refresh window (default 30 days)
    maxAge: config.jwt.refreshExpiryDays * 24 * 60 * 60 * 1000,
    // Scope to the refresh endpoint only — the cookie is never sent to other routes
    path: "/auth/refresh",
  };
}

function clearAuthCookies(res) {
  res.clearCookie(AUTH_COOKIE, { ...accessCookieOptions(), maxAge: 0 });
  res.clearCookie(REFRESH_COOKIE, { ...refreshCookieOptions(), maxAge: 0 });
}

// ── Refresh token helpers ─────────────────────────────────────────────────────

// Generate a cryptographically random 64-byte token (128 hex chars)
function generateRefreshToken() {
  return crypto.randomBytes(64).toString("hex");
}

// Store the SHA-256 hash of the token — raw token never touches the DB
function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// Build a fingerprint from the request to detect cross-device token theft.
// Not a hard block — used for anomaly logging only.
function buildFingerprint(req) {
  const ua = req.headers["user-agent"] || "";
  const ip = req.ip || "";
  return crypto.createHash("sha256").update(`${ua}:${ip}`).digest("hex");
}

async function issueTokenPair(res, user, req, existingFamilyId = null) {
  // 1. Sign short-lived access token (default 15 min)
  const accessToken = jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn },
  );

  // 2. Generate refresh token and store its hash
  const rawRefresh = generateRefreshToken();
  const tokenHash = hashToken(rawRefresh);
  const fingerprint = buildFingerprint(req);
  const expiresAt = new Date(Date.now() + config.jwt.refreshExpiryDays * 24 * 60 * 60 * 1000);

  // If rotating an existing token, keep the same family_id so reuse detection
  // can revoke the whole family. New logins get a fresh family.
  const familyClause = existingFamilyId
    ? `'${existingFamilyId}'::uuid`
    : "gen_random_uuid()";

  await pool.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, fingerprint, expires_at, family_id)
     VALUES ($1, $2, $3, $4, ${familyClause})`,
    [user.id, tokenHash, fingerprint, expiresAt],
  );

  // 3. Set both cookies
  res.cookie(AUTH_COOKIE, accessToken, accessCookieOptions());
  res.cookie(REFRESH_COOKIE, rawRefresh, refreshCookieOptions());
}

// ── Controllers ───────────────────────────────────────────────────────────────

async function signup(req, res) {
  const { firstName, lastName, username, email, password, role } = req.body;

  const error = validateSignup({ firstName, lastName, username, email, password });
  if (error) return res.status(400).json({ message: error });

  const client = await pool.connect();
  try {
    const hashedPassword = await bcrypt.hash(password, 12);
    const userRole = ["client", "developer"].includes(role) ? role : "client";

    const verifyToken = crypto.randomBytes(32).toString("hex");
    const verifyExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await client.query("BEGIN");

    const result = await client.query(
      `INSERT INTO users (first_name, last_name, username, email, password, role)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, username, email, role`,
      [firstName.trim(), lastName.trim(), username.trim().toLowerCase(), email.trim().toLowerCase(), hashedPassword, userRole],
    );

    const newUser = result.rows[0];

    await client.query(
      `INSERT INTO email_verifications (user_id, token, expires_at) VALUES ($1, $2, $3)`,
      [newUser.id, verifyToken, verifyExpiry],
    );

    await client.query("COMMIT");

    sendVerificationEmail(email.trim().toLowerCase(), verifyToken).catch((err) =>
      logger.error("Failed to send verification email", { userId: newUser.id, err }),
    );

    logger.info("User registered", { userId: newUser.id, role: userRole });
    res.status(201).json({
      message: "Account created. Please check your email to verify your account before logging in.",
      user: { id: newUser.id, username: newUser.username, email: newUser.email, role: newUser.role },
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    if (err.code === "23505") {
      if (err.constraint?.includes("username")) return res.status(409).json({ field: "username", message: "Username already taken" });
      if (err.constraint?.includes("email"))    return res.status(409).json({ field: "email",    message: "Email already registered" });
      return res.status(409).json({ field: "general", message: "User already exists" });
    }
    logger.error("Signup error", err);
    res.status(500).json({ message: "Signup failed" });
  } finally {
    client.release();
  }
}

async function login(req, res) {
  const { username, password } = req.body;

  const error = validateLogin({ username, password });
  if (error) return res.status(400).json({ message: error });

  try {
    const result = await pool.query(
      "SELECT * FROM users WHERE username = $1",
      [username.trim().toLowerCase()],
    );

    const user = result.rows[0];
    if (!user) return res.status(401).json({ message: "Invalid username or password" });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(401).json({ message: "Invalid username or password" });

    if (!user.email_verified) {
      return res.status(403).json({
        code: "EMAIL_NOT_VERIFIED",
        message: "Please verify your email address before logging in.",
      });
    }

    // Issue access token (15 min) + refresh token (30 days)
    await issueTokenPair(res, user, req);

    logger.info("User logged in", { userId: user.id });
    res.json({
      message: "Login successful",
      user: { id: user.id, username: user.username, email: user.email, role: user.role },
    });
  } catch (err) {
    logger.error("Login error", err);
    res.status(500).json({ message: "Login failed" });
  }
}

/**
 * POST /auth/refresh
 *
 * Silent token rotation — called by the frontend before the access token expires.
 * Implements refresh token rotation with reuse detection:
 *   - Valid token → revoke old, issue new pair (same family)
 *   - Reused/revoked token → revoke entire family (session theft detected)
 *   - Expired/missing token → 401 (force re-login)
 */
async function refresh(req, res) {
  const rawToken = req.cookies?.[REFRESH_COOKIE];

  if (!rawToken) {
    return res.status(401).json({ code: "NO_REFRESH_TOKEN", message: "No refresh token" });
  }

  const tokenHash = hashToken(rawToken);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const result = await client.query(
      `SELECT rt.id, rt.user_id, rt.revoked_at, rt.expires_at, rt.family_id, rt.fingerprint,
              u.id AS uid, u.username, u.role, u.email_verified
       FROM refresh_tokens rt
       JOIN users u ON rt.user_id = u.id
       WHERE rt.token_hash = $1`,
      [tokenHash],
    );

    if (!result.rows.length) {
      await client.query("ROLLBACK");
      clearAuthCookies(res);
      return res.status(401).json({ code: "INVALID_REFRESH_TOKEN", message: "Invalid refresh token" });
    }

    const row = result.rows[0];

    // ── Reuse detection ───────────────────────────────────────────────────────
    // If this token was already revoked, an attacker may have stolen it.
    // Revoke the entire family to force re-login on all devices in this session.
    if (row.revoked_at) {
      logger.warn("Refresh token reuse detected — revoking family", {
        userId: row.user_id,
        familyId: row.family_id,
        ip: req.ip,
      });
      await client.query(
        "UPDATE refresh_tokens SET revoked_at = NOW() WHERE family_id = $1 AND revoked_at IS NULL",
        [row.family_id],
      );
      await client.query("COMMIT");
      clearAuthCookies(res);
      return res.status(401).json({ code: "TOKEN_REUSE_DETECTED", message: "Session invalidated. Please log in again." });
    }

    // ── Expiry check ──────────────────────────────────────────────────────────
    if (new Date(row.expires_at) < new Date()) {
      await client.query("ROLLBACK");
      clearAuthCookies(res);
      return res.status(401).json({ code: "REFRESH_TOKEN_EXPIRED", message: "Session expired. Please log in again." });
    }

    // ── Fingerprint anomaly logging ───────────────────────────────────────────
    const currentFingerprint = buildFingerprint(req);
    if (row.fingerprint && row.fingerprint !== currentFingerprint) {
      // Log but don't block — fingerprints change legitimately (VPN, mobile networks)
      logger.warn("Refresh token fingerprint mismatch", {
        userId: row.user_id,
        familyId: row.family_id,
        ip: req.ip,
      });
    }

    // ── Rotate: revoke old token, issue new pair ──────────────────────────────
    await client.query(
      "UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = $1",
      [row.id],
    );

    await client.query("COMMIT");

    const user = { id: row.user_id, username: row.username, role: row.role };
    await issueTokenPair(res, user, req, row.family_id);

    logger.info("Token refreshed", { userId: user.id });
    res.json({ message: "Token refreshed" });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    logger.error("Token refresh error", err);
    res.status(500).json({ message: "Token refresh failed" });
  } finally {
    client.release();
  }
}

async function logout(req, res) {
  const rawToken = req.cookies?.[REFRESH_COOKIE];

  // Revoke the refresh token in the DB so it can't be replayed
  if (rawToken) {
    const tokenHash = hashToken(rawToken);
    await pool.query(
      "UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = $1 AND revoked_at IS NULL",
      [tokenHash],
    ).catch((err) => logger.error("Logout: failed to revoke refresh token", err));
  }

  clearAuthCookies(res);
  res.json({ message: "Logged out" });
}

/** GET /auth/me — returns current user from cookie (used on page refresh) */
async function getMe(req, res) {
  try {
    const result = await pool.query(
      "SELECT id, username, email, role FROM users WHERE id = $1",
      [req.user.id],
    );
    if (!result.rows.length) return res.status(404).json({ message: "User not found" });
    res.json(result.rows[0]);
  } catch (err) {
    logger.error("getMe error", err);
    res.status(500).json({ message: "Failed to fetch user" });
  }
}

/** GET /auth/verify-email?token=... */
async function verifyEmail(req, res) {
  const { token } = req.query;
  if (!token || typeof token !== "string") {
    return res.status(400).json({ message: "Invalid verification token" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const result = await client.query(
      `SELECT user_id, expires_at, used_at FROM email_verifications WHERE token = $1`,
      [token],
    );

    if (!result.rows.length) {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: "Invalid or expired verification link" });
    }

    const row = result.rows[0];

    if (row.used_at) {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: "This verification link has already been used" });
    }

    if (new Date(row.expires_at) < new Date()) {
      await client.query("ROLLBACK");
      return res.status(400).json({ code: "TOKEN_EXPIRED", message: "Verification link has expired. Please request a new one." });
    }

    await client.query("UPDATE email_verifications SET used_at = NOW() WHERE token = $1", [token]);
    await client.query("UPDATE users SET email_verified = true WHERE id = $1", [row.user_id]);
    await client.query("COMMIT");

    logger.info("Email verified", { userId: row.user_id });
    res.json({ message: "Email verified successfully. You can now log in." });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    logger.error("verifyEmail error", err);
    res.status(500).json({ message: "Verification failed" });
  } finally {
    client.release();
  }
}

/** POST /auth/resend-verification */
async function resendVerification(req, res) {
  const { email } = req.body;
  if (!email || typeof email !== "string") {
    return res.status(400).json({ message: "Email is required" });
  }

  try {
    const result = await pool.query(
      "SELECT id, email, email_verified FROM users WHERE email = $1",
      [email.trim().toLowerCase()],
    );

    // Always return 200 to prevent email enumeration
    if (!result.rows.length || result.rows[0].email_verified) {
      return res.json({ message: "If that email exists and is unverified, a new link has been sent." });
    }

    const user = result.rows[0];

    const verifyToken = crypto.randomBytes(32).toString("hex");
    const verifyExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await pool.query(
      "UPDATE email_verifications SET used_at = NOW() WHERE user_id = $1 AND used_at IS NULL",
      [user.id],
    );
    await pool.query(
      "INSERT INTO email_verifications (user_id, token, expires_at) VALUES ($1, $2, $3)",
      [user.id, verifyToken, verifyExpiry],
    );

    sendVerificationEmail(user.email, verifyToken).catch((err) =>
      logger.error("Failed to resend verification email", { userId: user.id, err }),
    );

    res.json({ message: "If that email exists and is unverified, a new link has been sent." });
  } catch (err) {
    logger.error("resendVerification error", err);
    res.status(500).json({ message: "Failed to resend verification email" });
  }
}

module.exports = { signup, login, logout, refresh, getMe, verifyEmail, resendVerification };
