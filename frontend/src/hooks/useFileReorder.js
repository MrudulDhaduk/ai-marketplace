/**
 * useFileReorder.js — Drag-and-drop file reorder hook
 *
 * Extracted in Phase 6 Step 2 from DeveloperProjectWorkspace.
 * Handles drag state, optimistic cache update, and server persistence.
 * Reverts the cache on API failure.
 *
 * Usage:
 *   const { dragIndex, dragOver, handleDragStart, handleDragEnter, handleReorder }
 *     = useFileReorder(projectId, files);
 */
import { useState, useCallback } from "react";
import { apiRequest } from "../lib/api";
import { queryClient } from "../lib/queryClient";
import { queryKeys } from "../lib/queryKeys";
import { invalidateProjectFiles } from "./useProjectQueries";

/**
 * @param {number|string} projectId
 * @param {Array} files — current files array from React Query cache
 */
export function useFileReorder(projectId, files) {
  const [dragIndex, setDragIndex] = useState(null);
  const [dragOver,  setDragOver]  = useState(null);

  const handleDragStart = useCallback((index) => {
    setDragIndex(index);
  }, []);

  const handleDragEnter = useCallback((index) => {
    setDragOver(index);
  }, []);

  const handleReorder = useCallback((dropIndex) => {
    if (dragIndex === null || dragIndex === dropIndex) {
      setDragIndex(null);
      setDragOver(null);
      return;
    }

    const updated = [...files];
    const [dragged] = updated.splice(dragIndex, 1);
    updated.splice(dropIndex, 0, dragged);

    setDragIndex(null);
    setDragOver(null);

    // Optimistically update the query cache so the UI reorders instantly
    queryClient.setQueryData(
      queryKeys.projects.files(projectId),
      updated,
    );

    apiRequest("/files/reorder", {
      method: "PUT",
      body: JSON.stringify(updated.map((f, i) => ({ id: f.id, position: i + 1 }))),
    }).catch((e) => {
      console.error("Failed to reorder files", e);
      // Revert on failure
      invalidateProjectFiles(projectId);
    });
  }, [dragIndex, files, projectId]);

  return { dragIndex, dragOver, handleDragStart, handleDragEnter, handleReorder, setDragOver };
}
