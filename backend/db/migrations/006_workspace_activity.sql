-- Migration 006: Workspace Activity Engine
-- Extends project_events with actor name denormalization and adds
-- activity_comments table for threaded feedback on timeline entries.
-- Safe to run multiple times (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Denormalize actor display name onto project_events
--    Avoids a JOIN on every activity feed query.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE project_events
  ADD COLUMN IF NOT EXISTS actor_name  VARCHAR(200),
  ADD COLUMN IF NOT EXISTS actor_role  VARCHAR(20);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Threaded comments on timeline entries
--    Allows client/developer to leave threaded feedback on any event.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS activity_comments (
  id          SERIAL PRIMARY KEY,
  event_id    INTEGER NOT NULL REFERENCES project_events(id) ON DELETE CASCADE,
  project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  author_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  author_name VARCHAR(200),
  author_role VARCHAR(20),
  body        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS activity_comments_event_id_idx
  ON activity_comments (event_id);

CREATE INDEX IF NOT EXISTS activity_comments_project_id_idx
  ON activity_comments (project_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Per-submission approval state
--    Tracks client approval/revision on individual timeline entries.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE project_events
  ADD COLUMN IF NOT EXISTS approval_status VARCHAR(30) DEFAULT NULL
    CHECK (approval_status IS NULL OR approval_status IN ('approved','revision_requested','resolved'));

ALTER TABLE project_events
  ADD COLUMN IF NOT EXISTS approval_feedback TEXT;

ALTER TABLE project_events
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Extended event_type values (documentation comment only — VARCHAR(60) is
--    already wide enough; no constraint change needed)
--
--    New types used by the workspace activity engine:
--      file_uploaded       — developer uploaded N files
--      file_deleted        — developer deleted a file
--      repo_updated        — repo link changed
--      demo_updated        — demo link changed
--      project_urgent      — client marked project urgent
--      project_unurgent    — client removed urgent flag
--      status_changed      — project status transition
--      note_added          — manual progress note (was: submission_added for notes)
--      note_updated        — manual note edited
--      note_deleted        — manual note deleted
--      message_sent        — (future) message in thread
-- ─────────────────────────────────────────────────────────────────────────────

-- Performance index for approval queries
CREATE INDEX IF NOT EXISTS project_events_approval_idx
  ON project_events (project_id, approval_status)
  WHERE approval_status IS NOT NULL;
