import "./CreateProjectModal.css";
import { useState, useEffect, useRef } from "react";

/* ── Floating label field ─────────────────────────────────────── */
function Field({ label, id, children, error, className = "" }) {
  return (
    <div
      className={`cpm-field${error ? " cpm-field--error" : ""}${className ? ` ${className}` : ""}`}
    >
      {children}
      <label className="cpm-label" htmlFor={id}>
        {label}
      </label>
      {error && <p className="cpm-error-msg">{error}</p>}
    </div>
  );
}

/* ── Main component ───────────────────────────────────────────── */
const CreateProjectModal = ({ onClose, onCreate }) => {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [budgetMin, setBudgetMin] = useState("");
  const [budgetMax, setBudgetMax] = useState("");
  const [status, setStatus] = useState("draft");
  const [tags, setTags] = useState([]);
  const [tagInput, setTagInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState({});
  const [closing, setClosing] = useState(false);
  const [dueDate, setDueDate] = useState("");

  const budgetMaxRef = useRef(null);
  const firstInputRef = useRef(null);
  const dueDateRef = useRef(null);

  const minDueDate = new Date().toISOString().split("T")[0];
  const statusOptions = [
    { value: "draft", label: "Draft" },
    { value: "active", label: "Active" },
    { value: "review", label: "Review" },
    { value: "completed", label: "Completed" },
  ];
  const formattedDueDate = dueDate
    ? new Date(`${dueDate}T00:00:00`).toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "";

  const openDueDatePicker = () => {
    const input = dueDateRef.current;
    if (!input) return;
    if (typeof input.showPicker === "function") input.showPicker();
    else input.focus();
  };

  /* Auto-focus first input on mount */
  useEffect(() => {
    const t = setTimeout(() => firstInputRef.current?.focus(), 120);
    return () => clearTimeout(t);
  }, []);

  /* Escape key */
  useEffect(() => {
    const fn = (e) => {
      if (e.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, []);

  /* Animated close — plays out-animation then calls onClose */
  const handleClose = () => {
    setClosing(true);
    setTimeout(onClose, 260);
  };

  const addTag = (rawTag) => {
    const nextTag = rawTag.trim();
    if (!nextTag) return;

    const exists = tags.some((tag) => tag.toLowerCase() === nextTag.toLowerCase());
    if (exists) return;

    setTags((prev) => [...prev, nextTag]);
    setTagInput("");
    if (errors.tags) setErrors((prev) => ({ ...prev, tags: "" }));
  };

  const removeTag = (tagToRemove) => {
    setTags((prev) => prev.filter((tag) => tag !== tagToRemove));
  };

  const handleTagKeyDown = (e) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag(tagInput);
    }

    if (e.key === "Backspace" && !tagInput && tags.length) {
      setTags((prev) => prev.slice(0, -1));
    }
  };

  /* Validation */
  const validate = () => {
    const e = {};
    if (!title.trim()) e.title = "Project title is required.";
    if (!description.trim()) e.description = "Please add a description.";

    const min = Number(budgetMin);
    const max = Number(budgetMax);

    if (!budgetMin || isNaN(min) || min <= 0) e.budgetMin = "Enter a valid minimum.";
    if (!budgetMax || isNaN(max) || max <= 0) e.budgetMax = "Enter a valid maximum.";
    if (!e.budgetMin && !e.budgetMax && min >= max) e.budgetMin = "Min must be less than max.";
    if (!dueDate) {
      e.dueDate = "Please select a due date.";
    } else {
      const selected = new Date(dueDate);
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      if (selected < today) {
        e.dueDate = "Due date cannot be in the past.";
      }
    }
    if (!status) e.status = "Please choose a project status.";
    if (!tags.length) e.tags = "Add at least one technology.";
    return e;
  };

  const budgetRangeError =
    budgetMin && budgetMax && Number(budgetMin) >= Number(budgetMax)
      ? "Min must be less than max."
      : null;

  const handleCreateProject = async () => {
    const e = validate();
    if (Object.keys(e).length) {
      setErrors(e);
      return;
    }

    setLoading(true);
    try {
      const token = localStorage.getItem("token");

      const res = await fetch("http://localhost:5000/api/projects", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          title,
          description,
          minBudget: budgetMin,
          maxBudget: budgetMax,
          dueDate,
          status,
          tags,
        }),
      });

      if (!res.ok) {
        throw new Error(`Failed to create project: ${res.status}`);
      }

      const data = await res.json();
      console.log("Created:", data);
      const formatted = {
        ...data,
        budget: `₹${data.min_budget ?? 0} - ₹${data.max_budget ?? 0}`,
        due: data.due_date
          ? new Date(data.due_date).toLocaleDateString("en-IN", {
              day: "numeric",
              month: "short",
            })
          : "No deadline",
        status: data.status || "draft",
        tags: Array.isArray(data.tags) ? data.tags : [],
        bids: data.bids || 0,
        progress: data.progress || 0,
      };

      onCreate?.(formatted);

      handleClose();
    } catch (err) {
      console.error(err);
      setErrors({ general: "Something went wrong. Please try again." });
    } finally {
      setLoading(false);
    }
  };

  const isEmpty =
    !title.trim() ||
    !description.trim() ||
    !budgetMin ||
    !budgetMax ||
    !dueDate ||
    !status ||
    !tags.length;
  const isInvalid = !!budgetRangeError;

  return (
    <div
      className={`cpm-overlay${closing ? " cpm-overlay--out" : ""}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Create new project"
    >
      <div className={`cpm-modal${closing ? " cpm-modal--out" : ""}`}>
        <div className="cpm-top-glow" aria-hidden="true" />

        <div className="cpm-header">
          <div className="cpm-header-text">
            <div className="cpm-eyebrow">
              <span className="cpm-eyebrow-dot" />
              New Project
            </div>
            <h2 className="cpm-title">What are you building?</h2>
            <p className="cpm-subtitle">
              Post your AI project and start receiving bids.
            </p>
          </div>
          <button
            type="button"
            className="cpm-close"
            onClick={onClose}
            aria-label="Close modal"
          >
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
              <path
                d="M5 5l10 10M15 5L5 15"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        {errors.general && (
          <div className="cpm-banner-error" role="alert">
            <svg width="14" height="14" viewBox="0 0 20 20" fill="none">
              <circle cx="10" cy="10" r="9" stroke="currentColor" strokeWidth="1.6" />
              <path
                d="M10 6v5M10 13.5v.5"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
            {errors.general}
          </div>
        )}

        <div className="cpm-form">
          <Field label="Project Title" id="cpm-title" error={errors.title}>
            <input
              id="cpm-title"
              ref={firstInputRef}
              className={`cpm-input${title ? " cpm-input--filled" : ""}${errors.title ? " cpm-input--error" : ""}`}
              type="text"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                if (errors.title) setErrors((p) => ({ ...p, title: "" }));
              }}
              autoComplete="off"
            />
          </Field>

          <Field label="Project Description" id="cpm-desc" error={errors.description}>
            <textarea
              id="cpm-desc"
              className={`cpm-input cpm-textarea${description ? " cpm-input--filled" : ""}${errors.description ? " cpm-input--error" : ""}`}
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
                if (errors.description) setErrors((p) => ({ ...p, description: "" }));
              }}
            />
          </Field>

          <div className="cpm-budget-row">
            <div className={`cpm-field${errors.budgetMin || budgetRangeError ? " cpm-field--error" : ""}`}>
              <div className="cpm-budget-wrap">
                <span className="cpm-currency">₹</span>
                <input
                  id="cpm-budget-min"
                  className={`cpm-input cpm-budget-input${budgetMin ? " cpm-input--filled" : ""}${errors.budgetMin || budgetRangeError ? " cpm-input--error" : ""}`}
                  type="number"
                  min="0"
                  value={budgetMin}
                  onChange={(e) => {
                    setBudgetMin(e.target.value);
                    if (errors.budgetMin) setErrors((p) => ({ ...p, budgetMin: "" }));
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Tab" && !e.shiftKey && budgetMin) {
                      budgetMaxRef.current?.focus();
                    }
                  }}
                />
                <label className="cpm-label" htmlFor="cpm-budget-min">
                  Min Budget
                </label>
              </div>
              {errors.budgetMin && !budgetRangeError && (
                <p className="cpm-error-msg">{errors.budgetMin}</p>
              )}
            </div>

            <span className="cpm-budget-dash" aria-hidden="true">—</span>

            <div className={`cpm-field${errors.budgetMax || budgetRangeError ? " cpm-field--error" : ""}`}>
              <div className="cpm-budget-wrap">
                <span className="cpm-currency">₹</span>
                <input
                  id="cpm-budget-max"
                  ref={budgetMaxRef}
                  className={`cpm-input cpm-budget-input${budgetMax ? " cpm-input--filled" : ""}${errors.budgetMax || budgetRangeError ? " cpm-input--error" : ""}`}
                  type="number"
                  min="0"
                  value={budgetMax}
                  onChange={(e) => {
                    setBudgetMax(e.target.value);
                    if (errors.budgetMax) setErrors((p) => ({ ...p, budgetMax: "" }));
                  }}
                />
                <label className="cpm-label" htmlFor="cpm-budget-max">
                  Max Budget
                </label>
              </div>
              {errors.budgetMax && !budgetRangeError && (
                <p className="cpm-error-msg">{errors.budgetMax}</p>
              )}
            </div>
          </div>

          {budgetRangeError && (
            <p className="cpm-error-msg cpm-range-error" role="alert">
              <svg width="11" height="11" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <circle cx="10" cy="10" r="9" stroke="currentColor" strokeWidth="1.7" />
                <path
                  d="M10 6v5M10 13.5v.5"
                  stroke="currentColor"
                  strokeWidth="1.9"
                  strokeLinecap="round"
                />
              </svg>
              {budgetRangeError}
            </p>
          )}

          <Field
            label="Due Date"
            id="cpm-due-date"
            error={errors.dueDate}
            className="cpm-field--date"
          >
            <div className="cpm-date-wrap">
              <input
                id="cpm-due-date"
                ref={dueDateRef}
                className={`cpm-input cpm-date-input${dueDate ? " cpm-input--filled" : ""}${errors.dueDate ? " cpm-input--error" : ""}`}
                type="date"
                min={minDueDate}
                value={dueDate}
                onChange={(e) => {
                  setDueDate(e.target.value);
                  if (errors.dueDate) setErrors((p) => ({ ...p, dueDate: "" }));
                }}
              />
              <span
                className={`cpm-date-value${dueDate ? " cpm-date-value--filled" : ""}`}
                aria-hidden="true"
              >
                {formattedDueDate || "Select a target delivery date"}
              </span>
              <button
                type="button"
                className="cpm-date-trigger"
                onClick={openDueDatePicker}
                aria-label={dueDate ? "Change due date" : "Choose due date"}
              >
                <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <path
                    d="M6.75 2.75v2.5M13.25 2.75v2.5M3.75 7.25h12.5M5.75 4.75h8.5c1.105 0 2 .895 2 2v7.5c0 1.105-.895 2-2 2h-8.5c-1.105 0-2-.895-2-2v-7.5c0-1.105.895-2 2-2Z"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </div>
          </Field>

          <Field
            label="Project Status"
            id="cpm-status"
            error={errors.status}
            className="cpm-field--status"
          >
            <div className="cpm-status-group" id="cpm-status" role="radiogroup">
              {statusOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={status === option.value}
                  className={`cpm-status-pill${status === option.value ? " cpm-status-pill--active" : ""}`}
                  onClick={() => {
                    setStatus(option.value);
                    if (errors.status) setErrors((prev) => ({ ...prev, status: "" }));
                  }}
                >
                  <span className="cpm-status-pill-dot" aria-hidden="true" />
                  {option.label}
                </button>
              ))}
            </div>
          </Field>

          <Field
            label="Technologies"
            id="cpm-tags"
            error={errors.tags}
            className="cpm-field--tags"
          >
            <div
              className={`cpm-tags-wrap${tags.length || tagInput ? " cpm-tags-wrap--filled" : ""}${errors.tags ? " cpm-tags-wrap--error" : ""}`}
            >
              <div className="cpm-tags-list">
                {tags.map((tag) => (
                  <span key={tag} className="cpm-tag-chip">
                    <span className="cpm-tag-chip-text">{tag}</span>
                    <button
                      type="button"
                      className="cpm-tag-chip-remove"
                      onClick={() => removeTag(tag)}
                      aria-label={`Remove ${tag}`}
                    >
                      ×
                    </button>
                  </span>
                ))}
                <input
                  id="cpm-tags"
                  className="cpm-tags-input"
                  type="text"
                  value={tagInput}
                  onChange={(e) => {
                    const value = e.target.value;
                    if (value.includes(",")) {
                      const pieces = value.split(",");
                      pieces.slice(0, -1).forEach((piece) => addTag(piece));
                      setTagInput(pieces[pieces.length - 1]);
                    } else {
                      setTagInput(value);
                    }
                    if (errors.tags) setErrors((prev) => ({ ...prev, tags: "" }));
                  }}
                  onKeyDown={handleTagKeyDown}
                  autoComplete="off"
                />
              </div>
            </div>
          </Field>
        </div>

        <div className="cpm-actions">
          <button className="cpm-cancel" onClick={handleClose} disabled={loading}>
            Cancel
          </button>
          <button
            className={`cpm-create${loading ? " cpm-create--loading" : ""}${isEmpty || isInvalid ? " cpm-create--dim" : ""}`}
            onClick={handleCreateProject}
            disabled={loading || isInvalid}
            aria-busy={loading}
          >
            {loading ? (
              <>
                <span className="cpm-spinner" aria-hidden="true" />
                Creating…
              </>
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <path
                    d="M10 4v12M4 10h12"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                  />
                </svg>
                Create Project
              </>
            )}
            <span className="cpm-shine" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default CreateProjectModal;
