import { useState, useEffect, useRef } from "react";
import "./BidModal.css";

/* ─── icons ─────────────────────────────────────── */
function IClose()  { return <svg viewBox="0 0 24 24" fill="none"><path d="M18 6 6 18M6 6l12 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>; }
function IWallet() { return <svg viewBox="0 0 24 24" fill="none"><rect x="2" y="6" width="20" height="14" rx="2" stroke="currentColor" strokeWidth="1.5"/><path d="M2 10h20" stroke="currentColor" strokeWidth="1.5"/><circle cx="17" cy="15" r="1.5" fill="currentColor"/></svg>; }
function IZap()    { return <svg viewBox="0 0 24 24" fill="none"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/></svg>; }
function ICheck()  { return <svg viewBox="0 0 24 24" fill="none"><path d="M20 6 9 17l-5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>; }
function IWarn()   { return <svg viewBox="0 0 24 24" fill="none"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" stroke="currentColor" strokeWidth="1.5"/><line x1="12" y1="9" x2="12" y2="13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><circle cx="12" cy="17" r="1" fill="currentColor"/></svg>; }
function IInfo()   { return <svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5"/><line x1="12" y1="8" x2="12" y2="12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><circle cx="12" cy="16" r="1" fill="currentColor"/></svg>; }

const MAX_PROPOSAL = 500;
const MIN_PROPOSAL = 20;
const PLATFORM_FEE = 0.10;

function fmt(n) {
  return Number(n).toLocaleString("en-IN");
}

export default function BidModal({ project, onClose }) {
  const [amount,   setAmount]   = useState("");
  const [proposal, setProposal] = useState("");
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState("");
  const [success,  setSuccess]  = useState(false);
  const [alreadyBid, setAlreadyBid] = useState(false);

  const overlayRef = useRef(null);
  const amountRef  = useRef(null);

  /* focus amount input on open */
  useEffect(() => {
    const t = setTimeout(() => amountRef.current?.focus(), 120);
    return () => clearTimeout(t);
  }, []);

  /* ESC to close */
  useEffect(() => {
    const handler = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  if (!project) return null;

  /* ── derived values ─────────────────────────── */
  const numAmount  = parseFloat(amount);
  const hasAmount  = amount !== "" && !isNaN(numAmount) && numAmount > 0;
  const tooLow     = hasAmount && numAmount < project.min_budget;
  const tooHigh    = hasAmount && numAmount > project.max_budget;
  const budgetWarn = tooLow || tooHigh;
  const netEarning = hasAmount ? (numAmount * (1 - PLATFORM_FEE)).toFixed(0) : null;
  const proposalLen = proposal.trim().length;
  const proposalShort = proposalLen > 0 && proposalLen < MIN_PROPOSAL;

  const canSubmit =
    !alreadyBid &&
    !loading &&
    hasAmount &&
    !budgetWarn &&
    proposalLen >= MIN_PROPOSAL;

  /* ── submit ─────────────────────────────────── */
  const handleSubmit = async () => {
    if (!canSubmit) return;
    try {
      setLoading(true);
      setError("");

      const user = JSON.parse(localStorage.getItem("user"));

      const res = await fetch(
        `http://localhost:5000/projects/${project.id}/bid`,
        {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({
            developerId: user?.id,
            amount:      numAmount,
            proposal:    proposal.trim(),
          }),
        }
      );

      const data = await res.json();

      if (!res.ok) {
        const msg = (data.message || "").toLowerCase();
        if (msg.includes("already")) {
          setAlreadyBid(true);
          setError("You have already placed a bid on this project.");
        } else {
          setError(data.message || "Something went wrong. Please try again.");
        }
      } else {
        setSuccess(true);
        setTimeout(onClose, 1800);
      }
    } catch {
      setError("Network error. Please check your connection.");
    } finally {
      setLoading(false);
    }
  };

  /* ── overlay click ──────────────────────────── */
  const handleOverlay = (e) => {
    if (e.target === overlayRef.current) onClose();
  };

  /* ── success screen ─────────────────────────── */
  if (success) {
    return (
      <div className="bm-overlay bm-overlay--visible" ref={overlayRef}>
        <div className="bm-card bm-card--success" role="dialog" aria-modal="true">
          <div className="bm-success-icon"><ICheck /></div>
          <h3 className="bm-success-title">Bid Submitted!</h3>
          <p className="bm-success-sub">
            Your bid of <strong>₹{fmt(numAmount)}</strong> has been sent to the client.
            Good luck! 🚀
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="bm-overlay bm-overlay--visible"
      ref={overlayRef}
      onClick={handleOverlay}
      role="dialog"
      aria-modal="true"
      aria-label={`Place bid on ${project.title}`}
    >
      <div className="bm-card">

        {/* ── Header ───────────────────────────── */}
        <div className="bm-header">
          <div className="bm-header-left">
            <span className="bm-header-eyebrow">Place a Bid</span>
            <h2 className="bm-header-title">{project.title}</h2>
            {project.tags?.length > 0 && (
              <div className="bm-tags">
                {project.tags.slice(0, 4).map(t => (
                  <span key={t} className="bm-tag">{t}</span>
                ))}
              </div>
            )}
          </div>

          <button
            className="bm-close"
            onClick={onClose}
            aria-label="Close modal"
          >
            <IClose />
          </button>
        </div>

        {/* ── Budget strip ─────────────────────── */}
        <div className="bm-budget-strip">
          <span className="bm-budget-icon"><IWallet /></span>
          <span className="bm-budget-label">Project budget</span>
          <span className="bm-budget-range">
            ₹{fmt(project.min_budget)} – ₹{fmt(project.max_budget)}
          </span>
        </div>

        {/* ── Already bid notice ───────────────── */}
        {alreadyBid && (
          <div className="bm-notice bm-notice--warn">
            <span className="bm-notice-icon"><IWarn /></span>
            You have already placed a bid on this project.
          </div>
        )}

        {/* ── Form ─────────────────────────────── */}
        <div className="bm-form">

          {/* Bid amount */}
          <div className="bm-field">
            <label className="bm-label" htmlFor="bm-amount">
              Your Bid Amount
            </label>
            <div className={`bm-input-wrap${budgetWarn ? " bm-input-wrap--warn" : hasAmount ? " bm-input-wrap--ok" : ""}`}>
              <span className="bm-currency">₹</span>
              <input
                id="bm-amount"
                ref={amountRef}
                className="bm-input"
                type="number"
                min="0"
                placeholder="0"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                disabled={alreadyBid}
                aria-describedby="bm-amount-hint"
              />
            </div>

            <div className="bm-field-footer" id="bm-amount-hint">
              {budgetWarn ? (
                <span className="bm-hint bm-hint--warn">
                  <IWarn />
                  {tooLow
                    ? `Below minimum budget of ₹${fmt(project.min_budget)}`
                    : `Above maximum budget of ₹${fmt(project.max_budget)}`}
                </span>
              ) : (
                <span className="bm-hint bm-hint--muted">
                  Within ₹{fmt(project.min_budget)} – ₹{fmt(project.max_budget)}
                </span>
              )}

              {netEarning && !budgetWarn && (
                <span className="bm-hint bm-hint--earn">
                  <IInfo />
                  You'll receive ₹{fmt(netEarning)} after 10% fee
                </span>
              )}
            </div>
          </div>

          {/* Proposal */}
          <div className="bm-field">
            <div className="bm-label-row">
              <label className="bm-label" htmlFor="bm-proposal">Proposal</label>
              <span className={`bm-char-count${proposalLen >= MAX_PROPOSAL ? " bm-char-count--max" : ""}`}>
                {proposalLen} / {MAX_PROPOSAL}
              </span>
            </div>
            <textarea
              id="bm-proposal"
              className={`bm-textarea${proposalShort ? " bm-textarea--warn" : proposalLen >= MIN_PROPOSAL ? " bm-textarea--ok" : ""}`}
              placeholder="Explain how you will approach this project, your relevant experience, and your estimated timeline…"
              value={proposal}
              onChange={e => {
                if (e.target.value.length <= MAX_PROPOSAL) setProposal(e.target.value);
              }}
              disabled={alreadyBid}
              rows={5}
              aria-describedby="bm-proposal-hint"
            />
            {proposalShort && (
              <p className="bm-hint bm-hint--warn" id="bm-proposal-hint">
                <IWarn />
                Minimum {MIN_PROPOSAL} characters required ({MIN_PROPOSAL - proposalLen} more needed)
              </p>
            )}
          </div>
        </div>

        {/* ── Error banner ─────────────────────── */}
        {error && !alreadyBid && (
          <div className="bm-notice bm-notice--error">
            <span className="bm-notice-icon"><IWarn /></span>
            {error}
          </div>
        )}

        {/* ── Actions ──────────────────────────── */}
        <div className="bm-actions">
          <button className="bm-btn bm-btn--cancel" onClick={onClose}>
            Cancel
          </button>
          <button
            className="bm-btn bm-btn--submit"
            onClick={handleSubmit}
            disabled={!canSubmit}
            aria-busy={loading}
          >
            {loading ? (
              <>
                <span className="bm-spinner" aria-hidden="true" />
                Submitting…
              </>
            ) : (
              <>
                <IZap />
                Submit Bid
              </>
            )}
          </button>
        </div>

      </div>
    </div>
  );
}