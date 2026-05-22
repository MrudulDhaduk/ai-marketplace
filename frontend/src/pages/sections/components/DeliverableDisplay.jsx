import React, { useState } from "react";
import { timeAgo } from "../../../utils/time";

/* ─── CopyBtn ────────────────────────────────────────────── */
function CopyBtn({ text }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  };
  return (
    <button className="cpw-icon-btn cpw-copy-btn" onClick={copy} title="Copy link" type="button">
      {copied ? "✓" : "⎘"}
    </button>
  );
}

/* ─── DeliverableDisplay ─────────────────────────────────── */
/**
 * Read-only deliverables section extracted from ClientProjectWorkspace.
 *
 * Props:
 *   deliverables  – { repoLink: string, demoLink: string, notes: string }
 *   submittedAt   – string | null
 *   isLoading     – boolean
 */
const DeliverableDisplay = React.memo(function DeliverableDisplay({
  deliverables = { repoLink: "", demoLink: "", notes: "" },
  submittedAt = null,
  isLoading = false,
}) {
  if (isLoading) {
    return <p className="dd-card-desc">Loading deliverables…</p>;
  }

  if (!deliverables.repoLink && !deliverables.demoLink && !deliverables.notes) {
    return (
      <div className="cpw-empty-state">
        <span className="cpw-empty-icon">📭</span>
        <p>No deliverables submitted yet.</p>
      </div>
    );
  }

  return (
    <div className="cpw-deliverables">
      {deliverables.repoLink && (
        <div className="cpw-deliverable-row">
          <span className="cpw-del-icon">⬡</span>
          <div className="cpw-del-info">
            <span className="cpw-del-label">Repository</span>
            <a href={deliverables.repoLink} target="_blank" rel="noreferrer" className="cpw-del-link">
              Open Repo ↗
            </a>
          </div>
          <CopyBtn text={deliverables.repoLink} />
        </div>
      )}
      {deliverables.demoLink && (
        <div className="cpw-deliverable-row">
          <span className="cpw-del-icon">▶</span>
          <div className="cpw-del-info">
            <span className="cpw-del-label">Live Demo</span>
            <a href={deliverables.demoLink} target="_blank" rel="noreferrer" className="cpw-del-link">
              Preview Demo ↗
            </a>
          </div>
          <CopyBtn text={deliverables.demoLink} />
        </div>
      )}
      {deliverables.notes && (
        <div className="cpw-notes-box">
          <span className="cpw-notes-label">Developer Notes</span>
          <p className="cpw-notes-text">{deliverables.notes}</p>
        </div>
      )}
      {submittedAt && (
        <div className="cpw-submitted-at">
          Submitted {timeAgo(submittedAt)} · {new Date(submittedAt).toLocaleString()}
        </div>
      )}
    </div>
  );
});

export default DeliverableDisplay;
