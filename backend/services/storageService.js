/**
 * storageService.js
 * Storage abstraction layer.
 *
 * Currently uses local disk storage. Swap the provider to migrate to
 * S3, Cloudflare R2, or any other object store without touching
 * upload/download logic in controllers.
 *
 * Provider interface:
 *   getFileUrl(fileName)  → string  (public or signed URL)
 *   deleteFile(fileName)  → Promise<void>
 */
const path = require("path");
const fs = require("fs/promises");
const config = require("../config/env");

// ── Local disk provider ───────────────────────────────────────────────────────

const uploadDir = path.resolve(process.cwd(), config.uploads.dir);

const localProvider = {
  /**
   * Returns the public URL path for a stored file.
   * In production this would be a CDN URL.
   */
  getFileUrl(fileName) {
    // Relative path served by Express static middleware at /uploads
    return `/uploads/${path.basename(fileName)}`;
  },

  /**
   * Deletes a file from local disk.
   */
  async deleteFile(fileName) {
    const resolved = path.resolve(uploadDir, path.basename(fileName));
    if (!resolved.startsWith(uploadDir)) throw new Error("Invalid file path");
    try {
      await fs.unlink(resolved);
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
    }
  },
};

// ── Future: S3 / R2 provider skeleton ────────────────────────────────────────
// Uncomment and fill in when migrating to cloud storage.
//
// const { S3Client, DeleteObjectCommand } = require("@aws-sdk/client-s3");
// const s3 = new S3Client({ region: process.env.AWS_REGION });
// const BUCKET = process.env.S3_BUCKET;
//
// const s3Provider = {
//   getFileUrl(fileName) {
//     return `https://${BUCKET}.s3.amazonaws.com/${fileName}`;
//   },
//   async deleteFile(fileName) {
//     await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: fileName }));
//   },
// };

// ── Active provider ───────────────────────────────────────────────────────────
const storage = localProvider;

module.exports = storage;
