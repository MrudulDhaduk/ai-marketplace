const path = require("path");
const fs = require("fs");
const multer = require("multer");
const { randomUUID } = require("crypto");
const config = require("../config/env");

const uploadDir = path.resolve(process.cwd(), config.uploads.dir);
fs.mkdirSync(uploadDir, { recursive: true });

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

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${randomUUID()}${safeExt(file.originalname)}`),
});

function fileFilter(req, file, cb) {
  const ext = safeExt(file.originalname);
  if (!allowedMime.has(file.mimetype) || !ext || !mimeToExt[file.mimetype]?.has(ext)) {
    return cb(new Error("Invalid file type"), false);
  }
  cb(null, true);
}

const upload = multer({
  storage,
  limits: { fileSize: config.uploads.maxFileSize, files: config.uploads.maxFiles },
  fileFilter,
});

function safeUploadPath(fileName) {
  const resolved = path.resolve(uploadDir, path.basename(fileName));
  if (!resolved.startsWith(uploadDir)) throw new Error("Invalid file path");
  return resolved;
}

module.exports = { upload, uploadDir, safeUploadPath };
