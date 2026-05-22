/**
 * useProjectRoom.js — Socket room join + reconnect hook
 *
 * Extracted in Phase 6 Step 2 to eliminate the duplicated pattern in
 * ClientProjectWorkspace and DeveloperProjectWorkspace where both components
 * independently called joinProject(project.id) on mount and registered a
 * "connect" handler to re-join on reconnect.
 *
 * This hook:
 *   1. Joins the project room on mount (with lastSeqId for missed-event replay)
 *   2. Re-joins on every socket reconnect (so the server can replay missed events)
 *   3. Cleans up the "connect" listener on unmount / projectId change
 *
 * Usage:
 *   useProjectRoom(project.id);
 */
import { useEffect } from "react";
import { useSocket, useJoinProject } from "../context/SocketContext";

/**
 * @param {number|string|null|undefined} projectId
 */
export function useProjectRoom(projectId) {
  const socket     = useSocket();
  const joinProject = useJoinProject();

  useEffect(() => {
    if (!projectId) return;

    // Initial join — sends lastSeqId so server can replay missed events
    joinProject(projectId);

    // Re-join on every reconnect so the server replays any events missed
    // during the disconnection window
    const handleReconnect = () => {
      joinProject(projectId);
    };

    socket.on("connect", handleReconnect);

    return () => {
      socket.off("connect", handleReconnect);
    };
  }, [projectId, socket, joinProject]);
}
