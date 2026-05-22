/**
 * ActivityFeed.jsx — Workspace Activity section wrapper
 *
 * Renders a section header and SubmissionHistory wrapped in an ErrorBoundary.
 * Stateless — no hooks, no local state.
 *
 * Props:
 *   projectId  — number|string  — passed through to SubmissionHistory
 *   isClient   — boolean        — passed through to SubmissionHistory
 */
import ErrorBoundary from "../../../components/ErrorBoundary";
import SubmissionHistory from "./SubmissionHistory";

export default function ActivityFeed({ projectId, isClient }) {
  return (
    <>
      <div className="cpw-section-header">
        <span className="cpw-section-icon">📡</span>
        <h3 className="dd-card-title cpw-section-title">Workspace Activity</h3>
      </div>
      <ErrorBoundary label="Workspace Activity">
        <SubmissionHistory projectId={projectId} isClient={isClient} />
      </ErrorBoundary>
    </>
  );
}
