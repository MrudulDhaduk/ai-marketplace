/**
 * uploadService.js — multer upload middleware factory
 *
 * Builds the multer instance using whichever storage engine the active
 * storageService provider exposes. Controllers import `upload` from here
 * exactly as before — the API contract is unchanged.
 */
const path = require("path");
const multer = require("multer");
const config = require("../config/env");
const storage = require("./storageService");

const upload = multer({
  storage: storage.getMulterStorage(),
  limits: {
    fileSize: config.uploads.maxFileSize,
    files: config.uploads.maxFiles,
  },
  fileFilter: storage.fileFilter,
});

/**
 * safeUploadPath — only meaningful for local disk storage.
 * Returns the absolute path for a stored file, guarded against path traversal.
 * For S3 storage this is a no-op (file deletion goes through storageService.deleteFile).
 */
function safeUploadPath(fileName) {
  const uploadDir = storage.uploadDir;
  if (!uploadDir) return fileName; // S3 — caller should use storageService.deleteFile
  const resolved = path.resolve(uploadDir, path.basename(fileName));
  if (!resolved.startsWith(uploadDir)) throw new Error("Invalid file path");
  return resolved;
}

module.exports = { upload, uploadDir: storage.uploadDir, safeUploadPath };
