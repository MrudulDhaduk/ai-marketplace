const helmet = require("helmet");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const { RedisStore } = require("rate-limit-redis");
const hpp = require("hpp");
const cookieParser = require("cookie-parser");
const { doubleCsrf } = require("csrf-csrf");
const config = require("../config/env");
const { redisClient, REDIS_ENABLED } = require("../config/redis");
const logger = require("../utils/logger");

const corsOptions = {
  origin(origin, callback) {
    if (!origin || config.cors.origins.includes(origin)) return callback(null, true);
    return callback(new Error("Not allowed by CORS"));
  },
  credentials: true, // required for cookies to be sent cross-origin
};

// ── Rate limit store ──────────────────────────────────────────────────────────
// Use Redis when available so limits are shared across all instances.
function makeStore(prefix) {
  if (REDIS_ENABLED && redisClient) {
    return new RedisStore({
      sendCommand: (...args) => redisClient.call(...args),
      prefix: `rl:${prefix}:`,
    });
  }
  return undefined;
}

// ── Rate limit bypass for automated testing ──────────────────────────────────
// When X-Test-Bypass header matches TEST_API_KEY env var, skip all rate limits.
// TEST_API_KEY must be set in .env — if absent, bypass is disabled entirely.
// Never expose this header in production (TEST_API_KEY should not be set there).
const TEST_API_KEY = process.env.TEST_API_KEY || null;

function skipInTestMode(req) {
  if (!TEST_API_KEY) return false;
  return req.headers["x-test-bypass"] === TEST_API_KEY;
}

const apiLimiter    = rateLimit({ windowMs: 15 * 60 * 1000, max: 500, standardHeaders: true, legacyHeaders: false, store: makeStore("api"),    skip: skipInTestMode });
const authLimiter   = rateLimit({ windowMs: 15 * 60 * 1000, max: 25,  standardHeaders: true, legacyHeaders: false, store: makeStore("auth"),   skip: skipInTestMode });
const uploadLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 60,  standardHeaders: true, legacyHeaders: false, store: makeStore("upload"), skip: skipInTestMode });

// ── Per-email resend rate limiter ─────────────────────────────────────────────
// The IP-based authLimiter alone doesn't stop an attacker cycling IPs from
// spamming a specific email address. This limiter keys on the email address
// in the request body so the limit is per-target regardless of source IP.
// 3 resend attempts per 15 minutes per email address.
//
// Falls back to IP-keying when Redis is unavailable (in-memory store).
// In-memory is fine here — worst case an attacker gets a few extra attempts
// per instance before the window resets.
const resendLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  store: makeStore("resend"),
  // Skip all limits in test mode
  skip: skipInTestMode,
  // Key by the normalised email from the body, fall back to IP
  // ipKeyGenerator helper is required by express-rate-limit v8 for IPv6 safety
  keyGenerator(req) {
    const email = req.body?.email;
    if (email && typeof email === "string") {
      return `email:${email.trim().toLowerCase()}`;
    }
    // Normalise IPv6 ::ffff:x.x.x.x to plain IPv4 to avoid bypass via address format
    const ip = (req.ip || "").replace(/^::ffff:/, "");
    return `ip:${ip}`;
  },
  // Always return 200 to prevent email enumeration
  handler(req, res) {
    logger.warn("Resend verification rate limit hit", {
      email: req.body?.email ? req.body.email.trim().toLowerCase() : "unknown",
      ip: req.ip,
    });
    res.status(200).json({ message: "If that email exists and is unverified, a new link has been sent." });
  },
});

// ── CSRF protection (double-submit cookie pattern) ────────────────────────────
//
// How it works:
//   1. GET /auth/csrf-token sets a non-httpOnly cookie "x-csrf-token" that JS can read.
//   2. The frontend reads the cookie value and sends it back in the x-csrf-token header
//      on every state-changing request (POST/PUT/PATCH/DELETE).
//   3. The server validates that the header value matches the cookie value.
//
// Why this is safe:
//   An attacker's cross-origin page cannot read the cookie value because of
//   SameSite=Strict + CORS restrictions, so they cannot forge the header.
//
// IMPORTANT: CSRF protection is only needed because we switched to httpOnly
// cookies. The previous Bearer-header flow was inherently CSRF-safe.
const CSRF_SECRET = process.env.CSRF_SECRET || config.jwt.secret;
const { AUTH_COOKIE } = require("../config/constants");

const { generateCsrfToken, doubleCsrfProtection } = doubleCsrf({
  getSecret: () => CSRF_SECRET,
  // Tie the CSRF token to the auth session cookie so tokens can't be
  // reused across different users or after logout.
  // For unauthenticated requests (login/signup are CSRF-exempt) this
  // returns an empty string — that's fine because those routes skip CSRF.
  getSessionIdentifier: (req) => req.cookies?.[AUTH_COOKIE] ?? "",
  cookieName: "x-csrf-token",
  cookieOptions: {
    httpOnly: false,   // must be readable by JS to send back in header
    secure: config.isProduction,
    sameSite: config.isProduction ? "strict" : "lax",
    path: "/",
  },
  size: 64,
  getTokenFromRequest: (req) => req.headers["x-csrf-token"],
});

// ── Request timeout middleware ────────────────────────────────────────────────
// Terminates requests that exceed REQUEST_TIMEOUT_MS.
// Prevents slowloris-style resource exhaustion and runaway DB queries.
// Set REQUEST_TIMEOUT_MS=0 to disable.
function requestTimeout(req, res, next) {
  const ms = config.requestTimeoutMs;
  if (!ms) return next();

  const timer = setTimeout(() => {
    if (res.headersSent) return;
    logger.warn("Request timeout", {
      method: req.method,
      path: req.path,
      userId: req.user?.id,
    });
    res.status(503).json({ message: "Request timed out" });
  }, ms);

  res.on("finish", () => clearTimeout(timer));
  res.on("close",  () => clearTimeout(timer));

  next();
}

// ── Content Security Policy ───────────────────────────────────────────────────
// Strict CSP that eliminates the entire XSS-to-code-execution attack class.
// Even if an injection is found later, the browser will refuse to execute it.
//
// Directives explained:
//   default-src 'self'        — block everything not explicitly allowed
//   script-src  'self'        — no inline scripts, no eval, no CDN scripts
//   style-src   'self' 'unsafe-inline' — inline styles needed by React/CRA
//   img-src     'self' data: blob:     — data URIs for avatars, blob for previews
//   font-src    'self'        — no external font CDNs
//   connect-src 'self' ws: wss: — allow WebSocket connections (Socket.IO)
//   frame-ancestors 'none'   — prevents clickjacking (replaces X-Frame-Options)
//   object-src  'none'        — no Flash / plugins
//   base-uri    'self'        — prevents base-tag hijacking
//   form-action 'self'        — forms can only submit to same origin
//
// In development we add 'unsafe-eval' to script-src because CRA's hot-reload
// (webpack-dev-server) requires eval(). This is NEVER set in production.
function buildCsp(isProduction) {
  const scriptSrc = isProduction
    ? ["'self'"]
    : ["'self'", "'unsafe-eval'"]; // CRA hot-reload needs eval in dev

  // Allow connections back to the API origin + WebSocket upgrade
  const connectSrc = ["'self'", "ws:", "wss:"];

  return {
    directives: {
      defaultSrc:     ["'self'"],
      scriptSrc,
      styleSrc:       ["'self'", "'unsafe-inline'"],
      imgSrc:         ["'self'", "data:", "blob:"],
      fontSrc:        ["'self'"],
      connectSrc,
      frameSrc:       ["'none'"],
      frameAncestors: ["'none'"],
      objectSrc:      ["'none'"],
      baseUri:        ["'self'"],
      formAction:     ["'self'"],
      upgradeInsecureRequests: isProduction ? [] : null,
    },
  };
}

function applySecurity(app) {
  app.disable("x-powered-by");
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: "cross-origin" },
      contentSecurityPolicy: buildCsp(config.isProduction),
      // HSTS: tell browsers to only use HTTPS for 1 year (production only)
      // The load balancer should also set this, but defence-in-depth is fine.
      strictTransportSecurity: config.isProduction
        ? { maxAge: 31_536_000, includeSubDomains: true }
        : false,
      // Prevent MIME-type sniffing
      noSniff: true,
      // Referrer policy — don't leak full URL to third parties
      referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    }),
  );
  app.use(cors(corsOptions));
  app.use(cookieParser());
  app.use(hpp());
  app.use(apiLimiter);
  app.use(requestTimeout);
}

module.exports = {
  applySecurity,
  corsOptions,
  authLimiter,
  uploadLimiter,
  resendLimiter,
  doubleCsrfProtection,
  generateCsrfToken,
};
