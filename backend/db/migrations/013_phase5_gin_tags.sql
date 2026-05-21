-- Migration 013: Phase 5 — GIN Index on projects.tags + Normalize Existing Tags
--
-- Two changes, order matters:
--   1. Normalize existing tags to lowercase first so the GIN index is built
--      on already-consistent data. The application now stores tags lowercase
--      at write time (createProject), but historical rows may have mixed case.
--   2. Create the GIN index so discoverProjects can use && directly instead
--      of the correlated UNNEST/ARRAY_AGG subquery that forced a seq scan.
--
-- The GIN index enables PostgreSQL to use a Bitmap Index Scan for:
--   WHERE tags && $1::text[]
-- instead of scanning every open/bidding project row.

BEGIN;

-- Step 1: Normalize all existing tags to lowercase.
-- Only updates rows where at least one tag differs after lowercasing,
-- so this is a no-op on already-clean data.
UPDATE projects
SET tags = ARRAY(SELECT LOWER(t) FROM UNNEST(tags) AS t)
WHERE tags IS NOT NULL
  AND tags != ARRAY(SELECT LOWER(t) FROM UNNEST(tags) AS t);

COMMIT;

-- Step 2: Create GIN index outside transaction (cannot use CONCURRENTLY
-- inside BEGIN/COMMIT). The migration runner wraps files in a transaction,
-- so this statement runs after the COMMIT above as a standalone DDL.
--
-- NOTE: Because the runner uses a single client.query() call per file and
-- the COMMIT above ends the transaction, this CREATE INDEX runs outside
-- any transaction block — which is exactly what CONCURRENTLY requires.
--
-- If this fails with "CREATE INDEX CONCURRENTLY cannot run inside a
-- transaction block", run it manually:
--   CREATE INDEX CONCURRENTLY idx_projects_tags_gin ON projects USING GIN (tags);
--   INSERT INTO schema_migrations (filename) VALUES ('013_phase5_gin_tags.sql');
CREATE INDEX IF NOT EXISTS idx_projects_tags_gin ON projects USING GIN (tags);
