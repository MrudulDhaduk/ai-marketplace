-- Migration 010: Phase 4 Realtime Reliability
-- Non-destructive. All changes are additive.

-- ── Replay index ──────────────────────────────────────────────────────────────
-- Speeds up the missed-event replay query:
--   SELECT * FROM project_events WHERE project_id = $1 AND created_at > $2
-- NOTE: Cannot use CONCURRENTLY inside a transaction block.
-- Using regular CREATE INDEX (takes a brief lock, safe on small tables).
CREATE INDEX IF NOT EXISTS idx_project_events_project_created
  ON project_events (project_id, created_at DESC);

-- ── Ack / pending delivery table ─────────────────────────────────────────────
-- Stores critical socket events that could not be delivered (ack timeout).
-- On next connection from that user, the server re-emits these events.
CREATE TABLE IF NOT EXISTS pending_socket_deliveries (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_name  TEXT         NOT NULL,
  payload     JSONB        NOT NULL,
  seq_id      BIGINT       NOT NULL,
  attempts    INTEGER      NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW() + INTERVAL '7 days'
);

CREATE INDEX IF NOT EXISTS idx_psd_user_expires
  ON pending_socket_deliveries (user_id, expires_at);
