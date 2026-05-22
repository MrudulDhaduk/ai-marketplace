/**
 * useFileUpload.js — XHR-based file upload hook
 *
 * Extracted in Phase 6 Step 2 from DeveloperProjectWorkspace.
 * Handles multipart upload with progress tracking, CSRF header injection,
 * and React Query cache invalidation on success.
 *
 * Usage:
 *   const { upload, progress, notice } = useFileUpload(projectId);
 *   upload(fileList);  // FileList or File[]
 */
import { useState, useCallback } from "react";
import { API_BASE_URL } from "../lib/api";
import { invalidateProjectFiles } from "./useProjectQueries";

/**
 * @param {number|string} projectId
 * @returns {{ upload: (files: FileList|File[]) => void, progress: number, notice: string }}
 */
export function useFileUpload(projectId) {
  const [progress, setProgress] = useState(0);
  const [notice,   setNotice]   = useState("");

  const upload = useCallback((selectedFiles) => {
    if (!projectId || !selectedFiles?.length) return;

    setNotice("");
    const formData = new FormData();
    Array.from(selectedFiles).forEach((f) => formData.append("files", f));

    const xhr = new XMLHttpRequest();

    xhr.upload.onprogress = (e) => {
      if (!e.total) return;
      setProgress(Math.round((e.loaded * 100) / e.total));
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const response = JSON.parse(xhr.responseText);
          if (response?.files?.length) {
            // Invalidate files cache so the new files appear via query refetch
            invalidateProjectFiles(projectId);
          }
          setNotice("Files uploaded successfully");
          setTimeout(() => setNotice(""), 4000);
        } catch (e) {
          console.error("Invalid upload response", e);
        }
      } else {
        console.error("Upload failed", xhr.responseText);
      }
      setProgress(0);
    };

    xhr.onerror = () => {
      setProgress(0);
      console.error("Upload request failed");
    };

    xhr.open("POST", `${API_BASE_URL}/projects/${projectId}/upload`);
    // Auth cookie is sent automatically via withCredentials.
    xhr.withCredentials = true;
    // Send CSRF token as defence-in-depth (multipart uploads bypass CSRF middleware
    // body parsing, but we include it as a header for consistency).
    const csrfCookie = document.cookie.match(/(?:^|;\s*)x-csrf-token=([^;]+)/);
    if (csrfCookie) xhr.setRequestHeader("x-csrf-token", decodeURIComponent(csrfCookie[1]));
    xhr.send(formData);
  }, [projectId]);

  return { upload, progress, notice };
}
