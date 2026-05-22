import React from "react";

/* ── Client progress stages ─────────────────────────────── */
const PROGRESS_STAGES = [
  { key: "not_started", label: "Not Started", pct:  0  },
  { key: "in_progress", label: "In Progress",  pct: 35  },
  { key: "submitted",   label: "Submitted",    pct: 65  },
  { key: "in_review",   label: "In Review",    pct: 80  },
  { key: "completed",   label: "Completed",    pct: 100 },
];

/* ── Developer stages (6 stages, includes revision_requested) ── */
const STAGES = [
  { key: "not_started",        label: "Not Started",  icon: "○" },
  { key: "in_progress",        label: "In Progress",  icon: "◑" },
  { key: "submitted",          label: "Submitted",    icon: "⬆" },
  { key: "pending",            label: "Under Review", icon: "⏳" },
  { key: "revision_requested", label: "Revision",     icon: "↩" },
  { key: "approved",           label: "Approved",     icon: "✓" },
];

/* ── WorkspaceProgressBar ───────────────────────────────────
 *
 * Props:
 *   variant       "client" | "developer"
 *   currentStage  string key (client: "not_started"|"in_progress"|"submitted"|"in_review"|"completed")
 *   reviewStatus  string (developer: "pending"|"approved"|"revision_requested"|…)
 *   stageIndex    number — pre-computed by parent for developer variant
 *
 * React.memo with custom comparator: only re-renders when currentStage changes.
 * ─────────────────────────────────────────────────────────── */
const WorkspaceProgressBar = React.memo(
  function WorkspaceProgressBar({ variant = "client", currentStage, reviewStatus, stageIndex }) {

    /* ── CLIENT VARIANT ─────────────────────────────────── */
    if (variant === "client") {
      const stageIdx = PROGRESS_STAGES.findIndex(x => x.key === currentStage);

      return (
        <div className="cpw-stage-bar-card dd-card" style={{ "--ci": 0.5 }}>
          <div className="cpw-stage-bar">
            {PROGRESS_STAGES.map((s, i) => {
              const isDone    = i < stageIdx;
              const isCurrent = i === stageIdx;
              return (
                <div key={s.key} className="cpw-stage-item">
                  <div className={`cpw-stage-dot ${isDone ? "done" : isCurrent ? "current" : ""}`}>
                    {isDone ? "✓" : i + 1}
                  </div>
                  <span className={`cpw-stage-label ${isCurrent ? "current" : ""}`}>
                    {s.label}
                  </span>
                  {i < PROGRESS_STAGES.length - 1 && (
                    <div className={`cpw-stage-line ${isDone ? "done" : ""}`} />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      );
    }

    /* ── DEVELOPER VARIANT ──────────────────────────────── */
    // Filter out revision_requested for the linear stepper display
    const displayStages = STAGES.filter(s => s.key !== "revision_requested");
    // displayOrder maps stage keys to their linear position index
    const displayOrder = ["not_started", "in_progress", "submitted", "pending", "approved"];
    const currentStageIdx = typeof stageIndex === "number" ? stageIndex : 0;

    return (
      <div className="dd-card dd-stepper-card" style={{ "--ci": 0.5 }}>
        <div className="dd-stepper">
          {displayStages.map((stage, i) => {
            const si = displayOrder.indexOf(stage.key);
            const isActive =
              stage.key === reviewStatus ||
              (reviewStatus === "revision_requested" && stage.key === "submitted");
            const isDone = si < currentStageIdx && !isActive;
            return (
              <React.Fragment key={stage.key}>
                <div className={`dd-step ${isDone ? "done" : ""} ${isActive ? "active" : ""}`}>
                  <div className="dd-step-circle">{isDone ? "✓" : stage.icon}</div>
                  <div className="dd-step-label">{stage.label}</div>
                </div>
                {i < displayStages.length - 1 && (
                  <div className={`dd-step-line ${si < currentStageIdx ? "done" : ""}`} />
                )}
              </React.Fragment>
            );
          })}
        </div>
        {reviewStatus === "revision_requested" && (
          <div className="dd-revision-banner">
            ↩ Client requested revisions — update your work and resubmit
          </div>
        )}
      </div>
    );
  },
  // Custom comparator: re-render when any display-affecting prop changes.
  // currentStage drives the client variant; reviewStatus + stageIndex drive
  // the developer variant — all three must be compared.
  (prev, next) =>
    prev.currentStage === next.currentStage &&
    prev.reviewStatus === next.reviewStatus &&
    prev.stageIndex   === next.stageIndex
);

export default WorkspaceProgressBar;
