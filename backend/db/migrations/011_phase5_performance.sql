-- Migration 011: Phase 5 Performance — Full Duplicate Index Cleanup
--
-- This migration drops all redundant/duplicate indexes identified in the
-- Phase 5 audit across 5 tables. Every dropped index is provably redundant:
-- either an exact structural duplicate of another index, or made redundant
-- by a composite/partial/constraint index that covers the same queries.
--
-- INDEXES RETAINED (one per logical purpose):
--   project_events    → project_events_project_created_idx  (project_id, created_at DESC)
--   project_events    → project_events_approval_idx         (project_id, approval_status) partial
--   project_events    → project_events_actor_id_idx         (actor_id)
--   project_events    → project_events_created_at_idx       (created_at DESC)
--   project_files     → project_files_project_id_position_idx (project_id, position)
--   project_submissions → project_submissions_project_id_submitted_at_idx (project_id, submitted_at DESC)
--   bids              → bids_project_id_developer_id_key    (UNIQUE constraint — implicit index)
--   projects          → projects_assigned_developer_id_idx  (assigned_developer_id)
--   email_verifications → email_verifications_active_idx    (token) WHERE used_at IS NULL
--                       + email_verifications_token_key     (UNIQUE constraint)
--
-- PRODUCTION NOTE:
--   The migration runner wraps each file in BEGIN/COMMIT, which means
--   CONCURRENTLY cannot be used here. Regular DROP INDEX takes a brief
--   ShareUpdateExclusiveLock — safe on small-to-medium tables.
--
--   On a large production table (>500k rows), run the drops manually
--   outside a transaction using CONCURRENTLY, then mark this migration
--   as applied:
--     INSERT INTO schema_migrations (filename) VALUES ('011_phase5_performance.sql');

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. project_events — drop 2 redundant indexes
--    KEEP: project_events_project_created_idx (project_id, created_at DESC)
-- ─────────────────────────────────────────────────────────────────────────────

-- Exact duplicate of project_events_project_created_idx — added by migration 010
-- without checking that the identical index already existed from migration 005.
DROP INDEX IF EXISTS idx_project_events_project_created;

-- Single-column (project_id) index made fully redundant by the composite
-- (project_id, created_at DESC) index above. PostgreSQL can use the composite
-- for any query that only filters on project_id.
DROP INDEX IF EXISTS project_events_project_id_idx;


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. project_files — drop 1 redundant index
--    KEEP: project_files_project_id_position_idx (project_id, position)
-- ─────────────────────────────────────────────────────────────────────────────

-- Exact duplicate of project_files_project_id_position_idx — same columns,
-- same sort order, created by migration 005 alongside the identical index
-- from migration 001. Every INSERT/UPDATE on project_files was writing to
-- both. The more descriptively named _project_id_position_ variant is kept.
DROP INDEX IF EXISTS project_files_project_position_idx;


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. project_submissions — drop 1 redundant index
--    KEEP: project_submissions_project_id_submitted_at_idx (project_id, submitted_at DESC)
-- ─────────────────────────────────────────────────────────────────────────────

-- Exact duplicate of project_submissions_project_id_submitted_at_idx —
-- same columns, same DESC order. Created by migration 005 alongside the
-- identical index from migration 001.
DROP INDEX IF EXISTS project_submissions_project_time_idx;


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. bids — drop 1 redundant unique index
--    KEEP: implicit index from UNIQUE constraint bids_project_id_developer_id_key
-- ─────────────────────────────────────────────────────────────────────────────

-- PostgreSQL automatically creates a unique index to enforce the UNIQUE
-- constraint bids_project_id_developer_id_key on (project_id, developer_id).
-- The explicit bids_project_developer_unique_idx is therefore a second unique
-- index on the exact same columns — pure overhead on every bid INSERT.
DROP INDEX IF EXISTS bids_project_developer_unique_idx;


-- ─────────────────────────────────────────────────────────────────────────────
-- 5. projects — drop 1 redundant index
--    KEEP: projects_assigned_developer_id_idx (assigned_developer_id)
-- ─────────────────────────────────────────────────────────────────────────────

-- Exact duplicate of projects_assigned_developer_id_idx — same column,
-- different name. Both were created by different migrations without
-- IF NOT EXISTS checks against the other name.
DROP INDEX IF EXISTS projects_developer_id_idx;


-- ─────────────────────────────────────────────────────────────────────────────
-- 6. email_verifications — drop 1 redundant full index
--    KEEP: email_verifications_active_idx (token) WHERE used_at IS NULL
--          + UNIQUE constraint email_verifications_token_key (enforces uniqueness)
-- ─────────────────────────────────────────────────────────────────────────────

-- The token lookup query always searches for unused tokens (used_at IS NULL).
-- The partial index email_verifications_active_idx covers this case with a
-- smaller, more selective index. The UNIQUE constraint email_verifications_token_key
-- enforces uniqueness. The full non-partial index on token is therefore never
-- the best choice for any real query and adds write overhead on every
-- email verification INSERT.
DROP INDEX IF EXISTS email_verifications_token_idx;


COMMIT;
