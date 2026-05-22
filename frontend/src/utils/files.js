/**
 * files.js — Shared file display utilities
 *
 * Extracted in Phase 6 Step 1 to eliminate duplicate FILE_ICONS, getFileIcon,
 * and formatBytes definitions in ClientProjectWorkspace and
 * DeveloperProjectWorkspace.
 */

export const FILE_ICONS = {
  pdf:  "📄", zip: "🗜️", rar: "🗜️",
  png:  "🖼️", jpg: "🖼️", jpeg: "🖼️", gif: "🖼️", svg: "🖼️", webp: "🖼️",
  mp4:  "🎬", mov: "🎬", avi: "🎬",
  mp3:  "🎵", wav: "🎵",
  doc:  "📝", docx: "📝", txt: "📃",
  xls:  "📊", xlsx: "📊", csv: "📊",
  ppt:  "📑", pptx: "📑",
  js:   "⚡", ts: "⚡", jsx: "⚛️", tsx: "⚛️",
  py:   "🐍", rb: "💎", go: "🐹", rs: "🦀",
  html: "🌐", css: "🎨",
  json: "🔧", xml: "🔧", yaml: "🔧", yml: "🔧",
  md:   "📋",
};

/**
 * Returns the lowercase file extension from a filename.
 * @param {string} name
 * @returns {string}
 */
export function getFileExt(name = "") {
  return name.split(".").pop()?.toLowerCase() || "";
}

/**
 * Returns an emoji icon for a given filename based on its extension.
 * @param {string} name
 * @returns {string}
 */
export function getFileIcon(name = "") {
  return FILE_ICONS[getFileExt(name)] || "📁";
}

/**
 * Formats a byte count into a human-readable string (B / KB / MB).
 * Returns null for falsy input so callers can conditionally render.
 * @param {number|null|undefined} bytes
 * @returns {string|null}
 */
export function formatBytes(bytes) {
  if (!bytes || bytes === 0) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}
