-- Migration 003: Messages table for project-scoped chat
-- Safe to run multiple times (IF NOT EXISTS)

CREATE TABLE IF NOT EXISTS messages (
  id          SERIAL PRIMARY KEY,
  project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  sender_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  receiver_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body        TEXT NOT NULL,
  is_read     BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS messages_project_id_idx         ON messages (project_id);
CREATE INDEX IF NOT EXISTS messages_sender_id_idx          ON messages (sender_id);
CREATE INDEX IF NOT EXISTS messages_receiver_id_idx        ON messages (receiver_id);
CREATE INDEX IF NOT EXISTS messages_project_created_idx    ON messages (project_id, created_at ASC);
CREATE INDEX IF NOT EXISTS messages_unread_receiver_idx    ON messages (receiver_id, is_read) WHERE is_read = false;
