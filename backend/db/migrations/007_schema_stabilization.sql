-- Migration 007: Schema Stabilization
-- Fixes:
--   BUG #6  — add is_urgent column (was local state only, never persisted)
--   BUG #10 — add CHECK constraint to prevent impossible status+review_status combos
--   BUG #12 — restore CHECK constraints on status and review_status that were lost in live dump
--   BUG #14 — rename approved_at to actioned_at to reflect correct semantics
--             (approved_at was being set on revision_requested events, which is wrong)

BEGIN;

-- ── BUG #6: Add is_urgent column ─────────────────────────────────────────────
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS is_urgent BOOLEAN NOT NULL DEFAULT false;

-- ── BUG #12: Restore CHECK constraints on projects.status ────────────────────
-- Drop any existing loose constraint first (idempotent)
ALTER TABLE projects
  DROP CONSTRAINT IF EXISTS projects_status_check;

ALTER TABLE projects
  ADD CONSTRAINT projects_status_check
    CHECK (status IN ('open', 'bidding', 'active', 'completed', 'cancelled', 'draft'));

-- ── BUG #12: Restore CHECK constraint on projects.review_status ──────────────
ALTER TABLE projects
  DROP CONSTRAINT IF EXISTS projects_review_status_check;

ALTER TABLE projects
  ADD CONSTRAINT projects_review_status_check
    CHECK (review_status IN ('pending', 'approved', 'revision_requested'));

-- ── BUG #10: Prevent impossible status + review_status combinations ───────────
-- A completed project cannot have an open revision request
-- An active project cannot be in approved state without being completed
ALTER TABLE projects
  DROP CONSTRAINT IF EXISTS projects_status_review_consistency;

ALTER TABLE projects
  ADD CONSTRAINT projects_status_review_consistency CHECK (
    NOT (status = 'completed' AND review_status = 'revision_requested')
  );

-- ── BUG #14: Rename approved_at → actioned_at on project_events ──────────────
-- approved_at was semantically wrong — it was being set on revision_requested
-- and resolved events too. Rename to actioned_at to reflect "last action timestamp".
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'project_events' AND column_name = 'approved_at'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'project_events' AND column_name = 'actioned_at'
  ) THEN
    ALTER TABLE project_events RENAME COLUMN approved_at TO actioned_at;
  END IF;
END $$;

-- ── Ensure update_requested is a valid event_type (no constraint to update,
--    but document it here for clarity) ─────────────────────────────────────────
-- project_events.event_type is VARCHAR(60) with no CHECK constraint — intentional
-- to allow new event types without migrations. No change needed.

COMMIT;
