require("dotenv").config();

const requiredInProduction = ["JWT_SECRET", "DATABASE_URL"];

if (process.env.NODE_ENV === "production") {
  for (const key of requiredInProduction) {
    if (!process.env[key]) {
      throw new Error(`Missing required production environment variable: ${key}`);
    }
  }
}

const csv = (value, fallback = []) =>
  (value ? value.split(",") : fallback).map((item) => item.trim()).filter(Boolean);

// JWT expiry string → milliseconds for cookie maxAge
function parseDurationMs(str = "1d") {
  const units = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  const match = String(str).match(/^(\d+)([smhd])$/);
  if (!match) return 86_400_000; // default 1 day
  return parseInt(match[1], 10) * units[match[2]];
}

const config = {
  nodeEnv: process.env.NODE_ENV || "development",
  isProduction: process.env.NODE_ENV === "production",
  port: Number(process.env.PORT || 5000),
  jwt: {
    secret: process.env.JWT_SECRET || "dev-only-change-me-before-production",
    expiresIn: process.env.JWT_EXPIRES_IN || "15m",
    get cookieMaxAgeMs() {
      return parseDurationMs(process.env.JWT_EXPIRES_IN || "15m");
    },
    refreshSecret: process.env.REFRESH_TOKEN_SECRET || process.env.JWT_SECRET || "dev-only-change-me-before-production",
    refreshExpiryDays: Number(process.env.REFRESH_TOKEN_EXPIRES_DAYS || 30),
  },
  cors: {
    origins: csv(process.env.CORS_ORIGINS || process.env.FRONTEND_URL, []),
  },
  db: {
    connectionString: process.env.DATABASE_URL,
    user: process.env.DB_USER || "postgres",
    host: process.env.DB_HOST,
    database: process.env.DB_NAME || "ai_marketplace",
    password: process.env.DB_PASSWORD || "",
    port: Number(process.env.DB_PORT || 5432),
    ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : false,
  },
  uploads: {
    dir: process.env.UPLOAD_DIR || "uploads",
    maxFileSize: Number(process.env.UPLOAD_MAX_BYTES || 5 * 1024 * 1024),
    maxFiles: Number(process.env.UPLOAD_MAX_FILES || 10),
  },
  email: {
    // SMTP transport — set SMTP_HOST to enable real email delivery.
    // When SMTP_HOST is absent the app logs verification URLs instead (dev mode).
    host: process.env.SMTP_HOST || "",
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true", // true = TLS on port 465
    user: process.env.SMTP_USER || "",
    pass: process.env.SMTP_PASS || "",
    from: process.env.EMAIL_FROM || "noreply@neuralforge.io",
    // Base URL used to build verification links in emails
    appUrl: process.env.APP_URL || process.env.FRONTEND_URL || "http://localhost:3000",
  },
  // Request timeout in milliseconds (0 = disabled)
  requestTimeoutMs: Number(process.env.REQUEST_TIMEOUT_MS || 30_000),
};

module.exports = config;
