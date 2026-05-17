-- Migration 000: Base schema
-- Creates all core tables. Safe to run multiple times (IF NOT EXISTS).

-- ── Users ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id               SERIAL PRIMARY KEY,
  first_name       VARCHAR(100) NOT NULL,
  last_name        VARCHAR(100) NOT NULL,
  username         VARCHAR(60)  NOT NULL UNIQUE,
  email            VARCHAR(255) NOT NULL UNIQUE,
  password         VARCHAR(255) NOT NULL,
  role             VARCHAR(20)  NOT NULL DEFAULT 'client' CHECK (role IN ('client', 'developer', 'admin')),
  bio              TEXT,
  email_verified   BOOLEAN NOT NULL DEFAULT false,
  phone            VARCHAR(30),
  phone_verified   BOOLEAN NOT NULL DEFAULT false,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Projects ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS projects (
  id                     SERIAL PRIMARY KEY,
  title                  VARCHAR(200) NOT NULL,
  description            TEXT NOT NULL,
  min_budget             NUMERIC(12,2) NOT NULL,
  max_budget             NUMERIC(12,2) NOT NULL,
  due_date               DATE,
  status                 VARCHAR(30) NOT NULL DEFAULT 'bidding'
                           CHECK (status IN ('open','bidding','active','completed','cancelled')),
  tags                   TEXT[] NOT NULL DEFAULT '{}',
  client_id              INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_developer_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  review_status          VARCHAR(30) NOT NULL DEFAULT 'pending'
                           CHECK (review_status IN ('pending','approved','revision_requested')),
  review_feedback        TEXT,
  reviewed_at            TIMESTAMPTZ,
  deliverable_link       TEXT,
  demo_link              TEXT,
  submission_note        TEXT,
  submitted_at           TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS projects_client_id_idx     ON projects (client_id);
CREATE INDEX IF NOT EXISTS projects_developer_id_idx  ON projects (assigned_developer_id);
CREATE INDEX IF NOT EXISTS projects_status_idx        ON projects (status);

-- ── Bids ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bids (
  id           SERIAL PRIMARY KEY,
  project_id   INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  developer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount       NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  proposal     TEXT NOT NULL,
  status       VARCHAR(20) NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','accepted','rejected')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, developer_id)
);

CREATE INDEX IF NOT EXISTS bids_project_id_idx    ON bids (project_id);
CREATE INDEX IF NOT EXISTS bids_developer_id_idx  ON bids (developer_id);

-- ── User Skills ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_skills (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  skill      VARCHAR(100) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, skill)
);

CREATE INDEX IF NOT EXISTS user_skills_user_id_idx ON user_skills (user_id);

-- ── Project Files ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS project_files (
  id          SERIAL PRIMARY KEY,
  project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  file_name   VARCHAR(500) NOT NULL,
  size        BIGINT,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  position    INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS project_files_project_id_idx ON project_files (project_id);

-- ── Project Submissions ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS project_submissions (
  id           SERIAL PRIMARY KEY,
  project_id   INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  repo_link    TEXT,
  demo_link    TEXT,
  notes        TEXT,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS project_submissions_project_id_idx ON project_submissions (project_id);
