-- Migration 005: Required additions to make the current platform functional
-- Fixes all blocking gaps between the real DB schema and what the code queries.
-- Safe to run multiple times (IF NOT EXISTS / IF NOT EXISTS column checks).
-- Run this against your live database before starting the server.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. NOTIFICATIONS TABLE
--    Required by: notificationService.js, notificationController.js
--    Every bid, message, review, and assignment creates a notification row.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        VARCHAR(60) NOT NULL,
  message     TEXT NOT NULL,
  is_read     BOOLEAN NOT NULL DEFAULT false,
  meta        JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS notifications_user_id_idx
  ON notifications (user_id);

CREATE INDEX IF NOT EXISTS notifications_user_unread_idx
  ON notifications (user_id, is_read)
  WHERE is_read = false;

CREATE INDEX IF NOT EXISTS notifications_created_at_idx
  ON notifications (created_at DESC);


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. MESSAGES TABLE
--    Required by: messageController.js
--    All project chat is stored here. Without it every send/fetch crashes.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS messages (
  id          SERIAL PRIMARY KEY,
  project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  sender_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  receiver_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body        TEXT NOT NULL,
  is_read     BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS messages_project_id_idx
  ON messages (project_id);

CREATE INDEX IF NOT EXISTS messages_project_created_idx
  ON messages (project_id, created_at ASC);

CREATE INDEX IF NOT EXISTS messages_unread_receiver_idx
  ON messages (receiver_id, is_read)
  WHERE is_read = false;


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. PROJECT_EVENTS TABLE
--    Required by: statsController.js (activity feed), bidController.js,
--                 submissionController.js, projectController.js
--    Activity feed and audit trail. Without it all activity queries crash.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS project_events (
  id          SERIAL PRIMARY KEY,
  project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  actor_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type  VARCHAR(60) NOT NULL,
  meta        JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- event_type values used by current code:
--   bid_placed, bid_accepted, project_assigned,
--   submission_added, revision_requested, project_approved

CREATE INDEX IF NOT EXISTS project_events_project_id_idx
  ON project_events (project_id);

CREATE INDEX IF NOT EXISTS project_events_actor_id_idx
  ON project_events (actor_id);

CREATE INDEX IF NOT EXISTS project_events_created_at_idx
  ON project_events (created_at DESC);

CREATE INDEX IF NOT EXISTS project_events_project_created_idx
  ON project_events (project_id, created_at DESC);


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. project_submissions — add repo_link and demo_link columns
--    Required by: submissionController.js
--    submitProject does INSERT INTO project_submissions (project_id, repo_link,
--    demo_link, notes) — crashes without these columns.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE project_submissions
  ADD COLUMN IF NOT EXISTS repo_link TEXT,
  ADD COLUMN IF NOT EXISTS demo_link TEXT;


-- ─────────────────────────────────────────────────────────────────────────────
-- 5. projects — add reviewed_at column
--    Required by: projectController.reviewProject
--    Does SET reviewed_at = NOW() — crashes without this column.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;


-- ─────────────────────────────────────────────────────────────────────────────
-- 6. project_files — add size column
--    Required by: uploadController.js (inserts size), frontend renders it.
--    Without it the INSERT silently fails on strict mode or errors on some PG
--    configs. Adding it makes file metadata complete.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE project_files
  ADD COLUMN IF NOT EXISTS size BIGINT;


-- ─────────────────────────────────────────────────────────────────────────────
-- 7. projects — add FK for assigned_developer_id
--    The real schema has no FK constraint on this column.
--    Adding it prevents orphaned developer references.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'projects_assigned_developer_id_fkey'
      AND table_name = 'projects'
  ) THEN
    ALTER TABLE projects
      ADD CONSTRAINT projects_assigned_developer_id_fkey
      FOREIGN KEY (assigned_developer_id) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 8. user_skills — unique constraint on (user_id, skill) case-insensitive
--    Migration 001 adds this but the real DB may not have it.
--    Prevents duplicate skills per user.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS user_skills_user_skill_unique_idx
  ON user_skills (user_id, LOWER(skill));


-- ─────────────────────────────────────────────────────────────────────────────
-- 9. Performance indexes on existing tables
--    These are safe to add — all IF NOT EXISTS.
-- ─────────────────────────────────────────────────────────────────────────────

-- projects: client lookup (used by getClientProjects, getClientStats)
CREATE INDEX IF NOT EXISTS projects_client_id_idx
  ON projects (client_id);

-- projects: status filter (used by listPublicProjects, discoverProjects)
CREATE INDEX IF NOT EXISTS projects_status_idx
  ON projects (status);

-- projects: due date sort (used by getAssignedProjects)
CREATE INDEX IF NOT EXISTS projects_due_date_idx
  ON projects (due_date);

-- bids: project lookup (used by getProjectBids, acceptBid)
CREATE INDEX IF NOT EXISTS bids_project_id_idx
  ON bids (project_id);

-- bids: developer lookup (used by getDeveloperBids, getDeveloperStats)
CREATE INDEX IF NOT EXISTS bids_developer_id_idx
  ON bids (developer_id);

-- project_files: project + position (used by getProjectFiles ordering)
CREATE INDEX IF NOT EXISTS project_files_project_position_idx
  ON project_files (project_id, position);

-- project_submissions: project + time (used by getSubmissions ordering)
CREATE INDEX IF NOT EXISTS project_submissions_project_time_idx
  ON project_submissions (project_id, submitted_at DESC);

-- user_skills: user lookup (used by discoverProjects skill matching)
CREATE INDEX IF NOT EXISTS user_skills_user_id_idx
  ON user_skills (user_id);
