-- Migration 009: Refresh Token Table
-- Enables short-lived access tokens (15 min) + long-lived refresh tokens (30 days).
-- Refresh tokens are stored server-side so individual sessions can be revoked
-- without invalidating all users (which changing JWT_SECRET would do).
--
-- MIGRATION NOTES:
--   - Existing users will be logged out on next access token expiry (up to 1 day
--     after deployment if JWT_EXPIRES_IN was "1d"). This is expected and safe.
--   - After deploying, set JWT_EXPIRES_IN=15m and REFRESH_TOKEN_EXPIRES_DAYS=30
--     in your environment. The old 1d tokens will still be accepted until they
--     expire naturally — no hard cutover needed.
--   - The cleanup job (DELETE FROM refresh_tokens WHERE expires_at < NOW()) should
--     be run periodically (e.g. pg_cron daily) to prevent table bloat.

BEGIN;

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- 64-byte hex token (128 chars). Stored as a SHA-256 hash so a DB leak
  -- doesn't immediately yield usable tokens.
  token_hash  VARCHAR(64) NOT NULL UNIQUE,
  -- Fingerprint: hash of (user-agent + ip) to detect token theft across devices.
  -- Not a hard block — used for anomaly logging only.
  fingerprint VARCHAR(64),
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Track which access token family this refresh token belongs to.
  -- Reuse of a revoked token in the same family triggers full family revocation
  -- (refresh token rotation with reuse detection).
  family_id   UUID NOT NULL DEFAULT gen_random_uuid()
);

CREATE INDEX IF NOT EXISTS refresh_tokens_user_id_idx    ON refresh_tokens (user_id);
CREATE INDEX IF NOT EXISTS refresh_tokens_token_hash_idx ON refresh_tokens (token_hash);
-- Partial index for fast lookup of active tokens only
CREATE INDEX IF NOT EXISTS refresh_tokens_active_idx
  ON refresh_tokens (token_hash)
  WHERE revoked_at IS NULL;

COMMIT;
