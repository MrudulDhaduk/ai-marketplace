/**
 * DeliverableForm.jsx — Developer-only deliverable submission form
 *
 * Extracted from DeveloperProjectWorkspace in Phase 6 Step 5.
 * Owns all form state and submission logic for the deliverables tab.
 *
 * Props:
 *   projectId       — project ID string
 *   initialValues   — { repoLink, demoLink, notes } synced from query data
 *   isLocked        — boolean; disables inputs when true (approved / pending)
 *   submissionCount — number; used to derive version label
 *   onSubmitSuccess — callback invoked after a successful submission
 */
import { useState, useEffect } from "react";
import { apiRequest } from "../../../lib/api";
import { invalidateProject } from "../../../hooks/useProjectQueries";
import { useCopyToClipboard } from "../../../hooks/useCopyToClipboard";

export default function DeliverableForm({
  projectId,
  initialValues = {},
  isLocked = false,
  submissionCount = 0,
  onSubmitSuccess,
}) {
  // ── Form field state ──────────────────────────────────────────────────────
  const [repoLink, setRepoLink] = useState(initialValues.repoLink ?? "");
  const [demoLink, setDemoLink] = useState(initialValues.demoLink ?? "");
  const [notes, setNotes] = useState(initialValues.notes ?? "");

  // ── Submission lifecycle state ────────────────────────────────────────────
  const [submissionState, setSubmissionState] = useState("idle"); // "idle" | "submitting" | "submitted"
  const [submissionError, setSubmissionError] = useState("");
  const [showConfirm, setShowConfirm] = useState(false);

  // ── Clipboard hook ────────────────────────────────────────────────────────
  const { copy, copiedKey } = useCopyToClipboard();

  // ── Sync form fields from initialValues on mount / project change ─────────
  useEffect(() => {
    setRepoLink(initialValues.repoLink ?? "");
    setDemoLink(initialValues.demoLink ?? "");
    setNotes(initialValues.notes ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialValues.repoLink, initialValues.demoLink, initialValues.notes]);

  // ── Derived values ────────────────────────────────────────────────────────
  const versionLabel = submissionCount > 0 ? `v${submissionCount + 1}` : "v1";

  // ── Submit handler ────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!repoLink.trim()) {
      setSubmissionError("Repository link is required");
      return;
    }
    setSubmissionError("");
    setSubmissionState("submitting");
    setShowConfirm(false);

    try {
      const idempotencyKey = `submit-${projectId}-${Date.now()}`;
      const res = await apiRequest(`/projects/${projectId}/submit`, {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey },
        body: JSON.stringify({ repoLink, demoLink, notes }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Submission failed");

      invalidateProject(projectId);
      setSubmissionState("submitted");
      if (onSubmitSuccess) onSubmitSuccess();
      setTimeout(() => setSubmissionState("idle"), 3000);
    } catch (err) {
      setSubmissionState("idle");
      setSubmissionError(err.message || "Submission failed. Please try again.");
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      {/* ── Submit confirmation modal ── */}
      {showConfirm && (
        <div className="dd-modal-backdrop" onClick={() => setShowConfirm(false)}>
          <div className="dd-modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="dd-modal-title">Submit {versionLabel}?</h3>
            <p className="dd-modal-desc">
              This will notify the client and move the project to{" "}
              <strong>Under Review</strong>.
            </p>
            <div className="dd-modal-actions">
              <button
                className="dd-bid-btn dd-btn-ghost"
                onClick={() => setShowConfirm(false)}
              >
                Cancel
              </button>
              <button className="dd-bid-btn" onClick={handleSubmit}>
                🚀 Submit {versionLabel}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="dd-tab-body dd-deliverables">
        {/* ── Repo link field ── */}
        <div className="dd-field-group">
          <label className="dd-field-label">
            GitHub / Repository URL{" "}
            <span className="dd-required">*</span>
          </label>
          <div className="dd-input-row">
            <input
              type="text"
              placeholder="https://github.com/you/project"
              className="dd-input"
              value={repoLink}
              onChange={(e) => {
                setRepoLink(e.target.value);
                if (submissionError) setSubmissionError("");
              }}
              disabled={isLocked}
            />
            {repoLink && (
              <div className="dd-input-actions">
                <button
                  className="dd-icon-btn"
                  title="Copy"
                  onClick={() => copy(repoLink, "repo")}
                >
                  {copiedKey === "repo" ? "✓" : "⎘"}
                </button>
                <a
                  href={repoLink}
                  target="_blank"
                  rel="noreferrer"
                  className="dd-icon-btn"
                  title="Open"
                >
                  ↗
                </a>
              </div>
            )}
          </div>
        </div>

        {/* ── Demo link field ── */}
        <div className="dd-field-group">
          <label className="dd-field-label">Live Demo URL</label>
          <div className="dd-input-row">
            <input
              type="text"
              placeholder="https://your-demo.vercel.app"
              className="dd-input"
              value={demoLink}
              onChange={(e) => {
                setDemoLink(e.target.value);
                if (submissionError) setSubmissionError("");
              }}
              disabled={isLocked}
            />
            {demoLink && (
              <div className="dd-input-actions">
                <button
                  className="dd-icon-btn"
                  title="Copy"
                  onClick={() => copy(demoLink, "demo")}
                >
                  {copiedKey === "demo" ? "✓" : "⎘"}
                </button>
                <a
                  href={demoLink}
                  target="_blank"
                  rel="noreferrer"
                  className="dd-icon-btn"
                  title="Open"
                >
                  ↗
                </a>
              </div>
            )}
          </div>
        </div>

        {/* ── Notes field ── */}
        <div className="dd-field-group">
          <label className="dd-field-label">
            Update Notes
            {submissionCount > 0 && (
              <span className="dd-version-tag">{versionLabel}</span>
            )}
          </label>
          <textarea
            placeholder={`What changed in ${versionLabel}? (optional)`}
            className="dd-input"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            disabled={isLocked}
          />
        </div>

        {/* ── Submit button ── */}
        <button
          className="dd-bid-btn dd-submit-btn"
          onClick={() => {
            if (repoLink) setShowConfirm(true);
          }}
          disabled={isLocked || !repoLink || submissionState === "submitting"}
        >
          {submissionState === "submitting" ? (
            <>
              <span className="dd-spinner" /> Submitting…
            </>
          ) : (
            `🚀 Submit ${versionLabel}`
          )}
        </button>

        {/* ── Status messages ── */}
        {submissionState === "submitted" && (
          <div className="dd-success-msg">
            ⏳ Sent for review — client will be notified
          </div>
        )}
        {submissionError && (
          <div className="dd-error-msg">{submissionError}</div>
        )}

        {/* ── Empty state ── */}
        {!repoLink && !demoLink && !notes && (
          <p className="dd-card-desc dd-empty-state">
            No deliverables submitted yet
          </p>
        )}
      </div>
    </>
  );
}
