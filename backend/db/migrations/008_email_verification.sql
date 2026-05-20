-- Migration 008: Email Verification
-- Adds the email_verifications table for the token-based email verification flow.
-- The users.email_verified column already exists (added in migration 000).
--
-- MIGRATION NOTES:
--   - Existing users will have email_verified = false (the column default).
--   - If you are running this on a live database with existing users who should
--     be considered verified (e.g. internal test accounts), run:
--       UPDATE users SET email_verified = true WHERE <condition>;
--     BEFORE deploying the new login guard, or those users will be locked out.
--   - New signups after this migration will receive a verification email and
--     cannot log in until they click the link.

BEGIN;

CREATE TABLE IF NOT EXISTS email_verifications (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token      VARCHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS email_verifications_user_id_idx ON email_verifications (user_id);
CREATE INDEX IF NOT EXISTS email_verifications_token_idx   ON email_verifications (token);

-- Partial index for fast lookup of active (unused, unexpired) tokens
CREATE INDEX IF NOT EXISTS email_verifications_active_idx
  ON email_verifications (token)
  WHERE used_at IS NULL;

COMMIT;
