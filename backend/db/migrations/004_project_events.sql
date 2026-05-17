-- Migration 004: Project events table for activity feed
-- Safe to run multiple times (IF NOT EXISTS)

CREATE TABLE IF NOT EXISTS project_events (
  id          SERIAL PRIMARY KEY,
  project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  actor_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type  VARCHAR(60) NOT NULL,
  meta        JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- event_type values: bid_placed, bid_accepted, project_assigned,
--                    submission_added, revision_requested, project_approved

CREATE INDEX IF NOT EXISTS project_events_project_id_idx   ON project_events (project_id);
CREATE INDEX IF NOT EXISTS project_events_actor_id_idx     ON project_events (actor_id);
CREATE INDEX IF NOT EXISTS project_events_created_at_idx   ON project_events (created_at DESC);
-- For client activity feed: all events on projects owned by a client
CREATE INDEX IF NOT EXISTS project_events_project_created_idx ON project_events (project_id, created_at DESC);
