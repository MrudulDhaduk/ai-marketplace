-- Production hardening baseline indexes/constraints for ai_marketplace.
-- Safe to run multiple times where IF NOT EXISTS is supported.

CREATE UNIQUE INDEX IF NOT EXISTS users_username_unique_idx ON users (LOWER(username));
CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique_idx ON users (LOWER(email));

CREATE INDEX IF NOT EXISTS projects_client_id_idx ON projects (client_id);
CREATE INDEX IF NOT EXISTS projects_assigned_developer_id_idx ON projects (assigned_developer_id);
CREATE INDEX IF NOT EXISTS projects_status_idx ON projects (status);
CREATE INDEX IF NOT EXISTS projects_due_date_idx ON projects (due_date);

CREATE INDEX IF NOT EXISTS bids_project_id_idx ON bids (project_id);
CREATE INDEX IF NOT EXISTS bids_developer_id_idx ON bids (developer_id);
CREATE UNIQUE INDEX IF NOT EXISTS bids_project_developer_unique_idx ON bids (project_id, developer_id);

CREATE INDEX IF NOT EXISTS user_skills_user_id_idx ON user_skills (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS user_skills_user_skill_unique_idx ON user_skills (user_id, LOWER(skill));

CREATE INDEX IF NOT EXISTS project_files_project_id_position_idx ON project_files (project_id, position);
CREATE INDEX IF NOT EXISTS project_submissions_project_id_submitted_at_idx ON project_submissions (project_id, submitted_at DESC);

ALTER TABLE bids
  ADD CONSTRAINT bids_amount_positive CHECK (amount > 0) NOT VALID;

ALTER TABLE projects
  ADD CONSTRAINT projects_budget_valid CHECK (min_budget IS NULL OR max_budget IS NULL OR min_budget <= max_budget) NOT VALID;
