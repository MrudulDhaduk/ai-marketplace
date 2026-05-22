import { useState } from "react";
import { apiRequest } from "../../../lib/api";
import { queryClient } from "../../../lib/queryClient";
import { queryKeys } from "../../../lib/queryKeys";
import { invalidateProject } from "../../../hooks/useProjectQueries";
import { timeAgo } from "../../../utils/time";

/* ─── ConfirmModal ───────────────────────────────────────── */
function ConfirmModal({ message, onConfirm, onCancel }) {
  return (
    <div className="cpw-modal-backdrop">
      <div className="cpw-modal">
        <p className="cpw-modal-msg">{message}</p>
        <div className="cpw-modal-actions">
          <button className="dd-bid-btn cpw-btn-confirm" type="button" onClick={onConfirm}>Yes, Approve</button>
          <button className="dd-bid-btn cpw-btn-cancel" type="button" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   ReviewPanel — client-only, owns review/approval state
══════════════════════════════════════════════════════════ */
export default function ReviewPanel({ projectId, reviewStatus, onReviewSubmitted }) {
  const [reviewFeedback,     setReviewFeedback]     = useState("");
  const [reviewLoading,      setReviewLoading]      = useState(false);
  const [reviewMessage,      setReviewMessage]      = useState("");
  const [showApproveConfirm, setShowApproveConfirm] = useState(false);
  const [reviewHistory,      setReviewHistory]      = useState([]);
  const [error,              setError]              = useState("");

  const handleSubmitReview = async (action) => {
    setReviewLoading(true);
    setError("");
    try {
      const res = await apiRequest(`/projects/${projectId}/review`, {
        method: "PUT",
        body: JSON.stringify({ action, feedback: reviewFeedback }),
      });
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      invalidateProject(projectId);
      queryClient.invalidateQueries({ queryKey: queryKeys.projects.list() });
      if (onReviewSubmitted) onReviewSubmitted({ id: projectId });
      setReviewHistory(prev => [{ action, feedback: reviewFeedback, at: new Date().toISOString() }, ...prev]);
      setReviewFeedback("");
      setReviewMessage(action === "approve" ? "✓ Project approved" : "Revision request sent");
      setTimeout(() => setReviewMessage(""), 3000);
    } catch (e) {
      setError("Failed to submit review");
    } finally {
      setReviewLoading(false);
    }
  };

  return (
    <>
      {/* Confirm modal rendered outside the card so it overlays the whole page */}
      {showApproveConfirm && (
        <ConfirmModal
          message="Are you sure you want to approve this project? This action marks the project as complete."
          onConfirm={() => { setShowApproveConfirm(false); handleSubmitReview("approve"); }}
          onCancel={() => setShowApproveConfirm(false)}
        />
      )}

      {/* Review status indicator */}
      <div className={`cpw-review-state cpw-review-state--${reviewStatus}`}>
        <span className="cpw-review-state-dot" />
        <span className="cpw-review-state-label">
          {reviewStatus === "approved"
            ? "Project Approved — all done!"
            : reviewStatus === "revision_requested"
            ? "Revision Requested — awaiting developer response"
            : "Pending Review — awaiting your decision"}
        </span>
      </div>

      {reviewStatus !== "approved" && (
        <>
          <textarea
            className="dd-input"
            placeholder="Feedback for developer (e.g., requested changes, improvements)..."
            value={reviewFeedback}
            onChange={(e) => setReviewFeedback(e.target.value)}
            style={{ minHeight: "100px", marginTop: "12px" }}
            disabled={reviewLoading}
          />

          <div className="cpw-review-btns">
            <button
              className="dd-bid-btn cpw-btn-approve"
              type="button"
              onClick={() => setShowApproveConfirm(true)}
              disabled={reviewLoading}
            >
              {reviewLoading ? "Processing…" : "✓ Approve Project"}
            </button>
            <button
              className="dd-bid-btn cpw-btn-revision"
              type="button"
              onClick={() => handleSubmitReview("revision")}
              disabled={reviewLoading}
            >
              {reviewLoading ? "Processing…" : "↩ Request Changes"}
            </button>
          </div>
        </>
      )}

      {reviewMessage && (
        <p className="dd-card-desc cpw-review-toast" style={{ marginTop: "10px" }}>{reviewMessage}</p>
      )}
      {error && (
        <p className="dd-card-desc cpw-error" style={{ marginTop: "10px" }}>{error}</p>
      )}

      {/* Review history */}
      {reviewHistory.length > 0 && (
        <div className="cpw-review-history">
          <span className="cpw-rh-title">Review History</span>
          {reviewHistory.map((r, i) => (
            <div key={i} className="cpw-rh-item">
              <span className={`cpw-rh-action ${r.action === "approve" ? "approve" : "revision"}`}>
                {r.action === "approve" ? "✓ Approved" : "↩ Changes Requested"}
              </span>
              <span className="cpw-rh-time">{timeAgo(r.at)}</span>
              {r.feedback && <p className="cpw-rh-feedback">{r.feedback}</p>}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
