-- Migration 002: Notifications table
-- Safe to run multiple times (IF NOT EXISTS)

CREATE TABLE IF NOT EXISTS notifications (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        VARCHAR(60) NOT NULL,
  message     TEXT NOT NULL,
  is_read     BOOLEAN NOT NULL DEFAULT false,
  meta        JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS notifications_user_id_idx       ON notifications (user_id);
CREATE INDEX IF NOT EXISTS notifications_user_unread_idx   ON notifications (user_id, is_read) WHERE is_read = false;
CREATE INDEX IF NOT EXISTS notifications_created_at_idx    ON notifications (created_at DESC);
