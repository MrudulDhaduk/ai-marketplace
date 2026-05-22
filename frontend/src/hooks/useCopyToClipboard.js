/**
 * useCopyToClipboard.js — Clipboard copy with visual feedback hook
 *
 * Extracted in Phase 6 Step 2 to eliminate the duplicated copy-to-clipboard
 * pattern in ClientProjectWorkspace (CopyBtn component) and
 * DeveloperProjectWorkspace (copyToClipboard + copiedField state).
 *
 * Usage:
 *   const { copy, copiedKey } = useCopyToClipboard();
 *
 *   // In JSX:
 *   <button onClick={() => copy(repoLink, "repo")} aria-label="Copy to clipboard">
 *     {copiedKey === "repo" ? "✓" : "⎘"}
 *   </button>
 */
import { useState, useCallback } from "react";

const RESET_DELAY_MS = 1800;

/**
 * @returns {{
 *   copy: (text: string, key?: string) => void,
 *   copiedKey: string | null,
 * }}
 */
export function useCopyToClipboard() {
  const [copiedKey, setCopiedKey] = useState(null);

  const copy = useCallback((text, key = "default") => {
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), RESET_DELAY_MS);
    }).catch((err) => {
      console.error("Failed to copy to clipboard", err);
    });
  }, []);

  return { copy, copiedKey };
}
