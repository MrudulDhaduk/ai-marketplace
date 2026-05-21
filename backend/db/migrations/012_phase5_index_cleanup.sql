-- Migration 012: Phase 5 Index Cleanup — Remaining Duplicate Indexes
--
-- Migration 011 dropped the duplicate indexes on project_events.
-- This migration drops the remaining 4 redundant indexes identified in the
-- Phase 5 audit across project_files, project_submissions, bids, projects,
-- and email_verifications.
--
-- All drops are IF EXISTS — safe to run even if any were already removed.

BEGIN;

-- project_files: exact duplicate of project_files_project_id_position_idx
DROP INDEX IF EXISTS project_files_project_position_idx;

-- project_submissions: exact duplicate of project_submissions_project_id_submitted_at_idx
DROP INDEX IF EXISTS project_submissions_project_time_idx;

-- bids: duplicate of the implicit index from UNIQUE constraint bids_project_id_developer_id_key
DROP INDEX IF EXISTS bids_project_developer_unique_idx;

-- projects: exact duplicate of projects_assigned_developer_id_idx
DROP INDEX IF EXISTS projects_developer_id_idx;

-- email_verifications: made redundant by partial index + UNIQUE constraint
DROP INDEX IF EXISTS email_verifications_token_idx;

COMMIT;
