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

const config = {
  nodeEnv: process.env.NODE_ENV || "development",
  isProduction: process.env.NODE_ENV === "production",
  port: Number(process.env.PORT || 5000),
  jwt: {
    secret: process.env.JWT_SECRET || "dev-only-change-me-before-production",
    expiresIn: process.env.JWT_EXPIRES_IN || "1d",
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
};

module.exports = config;
