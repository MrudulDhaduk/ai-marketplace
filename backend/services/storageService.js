/**
 * storageService.js — Storage abstraction layer
 *
 * Active provider is selected by STORAGE_PROVIDER env var:
 *   "local"  (default) — local disk, served via Express static
 *   "s3"               — AWS S3 or Cloudflare R2 (S3-compatible)
 *
 * Provider interface:
 *   getFileUrl(fileName)              → string  (URL to access the file)
 *   getSignedUrl(fileName, ttlSecs)   → Promise<string>  (time-limited URL)
 *   deleteFile(fileName)              → Promise<void>
 *   getMulterStorage()                → multer storage engine
 *
 * Controllers never import a provider directly — they always go through
 * this module so swapping providers requires no controller changes.
 */

const path = require("path");
const fs = require("fs/promises");
const config = require("../config/env");
const logger = require("../utils/logger");

const PROVIDER = process.env.STORAGE_PROVIDER || "local";

// ── Local disk provider ───────────────────────────────────────────────────────

const { createWriteStream, mkdirSync } = require("fs");
const multer = require("multer");
const { randomUUID } = require("crypto");

const uploadDir = path.resolve(process.cwd(), config.uploads.dir);
mkdirSync(uploadDir, { recursive: true });

const allowedMime = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "text/plain",
  "application/zip",
  "application/x-zip-compressed",
]);
const allowedExt = new Set([".pdf", ".png", ".jpg", ".jpeg", ".txt", ".zip"]);
const mimeToExt = {
  "application/pdf": new Set([".pdf"]),
  "image/png": new Set([".png"]),
  "image/jpeg": new Set([".jpg", ".jpeg"]),
  "text/plain": new Set([".txt"]),
  "application/zip": new Set([".zip"]),
  "application/x-zip-compressed": new Set([".zip"]),
};

function safeExt(originalName) {
  const ext = path.extname(originalName || "").toLowerCase();
  return allowedExt.has(ext) ? ext : "";
}

function fileFilter(req, file, cb) {
  const ext = safeExt(file.originalname);
  if (!allowedMime.has(file.mimetype) || !ext || !mimeToExt[file.mimetype]?.has(ext)) {
    return cb(new Error("Invalid file type"), false);
  }
  cb(null, true);
}

const localProvider = {
  getFileUrl(fileName) {
    return `/uploads/${path.basename(fileName)}`;
  },

  async getSignedUrl(fileName) {
    // Local files are served directly — no signing needed
    return this.getFileUrl(fileName);
  },

  async deleteFile(fileName) {
    const resolved = path.resolve(uploadDir, path.basename(fileName));
    if (!resolved.startsWith(uploadDir)) throw new Error("Invalid file path");
    try {
      await fs.unlink(resolved);
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
    }
  },

  getMulterStorage() {
    return multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, uploadDir),
      filename: (_req, file, cb) => cb(null, `${Date.now()}-${randomUUID()}${safeExt(file.originalname)}`),
    });
  },
};

// ── S3 / Cloudflare R2 provider ───────────────────────────────────────────────

function buildS3Provider() {
  const { S3Client, DeleteObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
  const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
  const multerS3 = require("multer-s3");

  const BUCKET = process.env.S3_BUCKET;
  const REGION = process.env.S3_REGION || "auto";
  const ENDPOINT = process.env.S3_ENDPOINT; // Set for Cloudflare R2
  const PUBLIC_URL_BASE = process.env.S3_PUBLIC_URL; // Optional CDN prefix

  if (!BUCKET) throw new Error("S3_BUCKET env var is required when STORAGE_PROVIDER=s3");

  const s3 = new S3Client({
    region: REGION,
    ...(ENDPOINT ? { endpoint: ENDPOINT, forcePathStyle: false } : {}),
    // Credentials come from AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY env vars
    // or from the EC2/ECS instance role automatically
  });

  logger.info("Storage: S3/R2 provider active", { bucket: BUCKET, region: REGION });

  return {
    getFileUrl(fileName) {
      if (PUBLIC_URL_BASE) return `${PUBLIC_URL_BASE.replace(/\/$/, "")}/${fileName}`;
      return `https://${BUCKET}.s3.${REGION}.amazonaws.com/${fileName}`;
    },

    async getSignedUrl(fileName, ttlSecs = 3600) {
      const command = new GetObjectCommand({ Bucket: BUCKET, Key: fileName });
      return getSignedUrl(s3, command, { expiresIn: ttlSecs });
    },

    async deleteFile(fileName) {
      await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: fileName }));
    },

    getMulterStorage() {
      return multerS3({
        s3,
        bucket: BUCKET,
        // Files are private by default — access via signed URLs
        acl: undefined,
        contentType: multerS3.AUTO_CONTENT_TYPE,
        key(_req, file, cb) {
          const ext = safeExt(file.originalname);
          cb(null, `uploads/${Date.now()}-${randomUUID()}${ext}`);
        },
      });
    },
  };
}

// ── Active provider selection ─────────────────────────────────────────────────

let activeProvider;

if (PROVIDER === "s3") {
  try {
    activeProvider = buildS3Provider();
  } catch (err) {
    logger.error("Failed to initialise S3 storage provider — falling back to local disk", err);
    activeProvider = localProvider;
  }
} else {
  logger.info("Storage: local disk provider active");
  activeProvider = localProvider;
}

// Export helpers used by uploadService and controllers
module.exports = {
  ...activeProvider,
  fileFilter,
  uploadDir,          // null-safe: only meaningful for local provider
  PROVIDER,
};
