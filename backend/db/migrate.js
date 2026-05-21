/**
 * migrate.js — Node.js migration runner
 * Tracks applied migrations in a schema_migrations table so each file
 * only ever runs once. Safe to re-run at any time.
 *
 * Usage:
 *   node backend/db/migrate.js
 *   npm run migrate
 */

require("dotenv").config();
const fs   = require("fs");
const path = require("path");
const { Pool } = require("pg");

// ── DB connection ─────────────────────────────────────────────────────────
const pool = new Pool(
  process.env.DATABASE_URL
    ? {
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : false,
      }
    : {
        user:     process.env.DB_USER     || "postgres",
        host:     process.env.DB_HOST     || "localhost",
        database: process.env.DB_NAME     || "ai_marketplace",
        password: process.env.DB_PASSWORD || "",
        port:     Number(process.env.DB_PORT) || 5432,
        ssl:      false,
      },
);

// ── All migration files in execution order ────────────────────────────────
const MIGRATIONS_DIR = path.join(__dirname, "migrations");

const MIGRATION_FILES = [
  "000_base_schema.sql",
  "001_security_indexes.sql",
  "002_notifications.sql",
  "003_messages.sql",
  "004_project_events.sql",
  "005_required_additions.sql",
  "006_workspace_activity.sql",
  "007_schema_stabilization.sql",
  "008_email_verification.sql",
  "009_refresh_tokens.sql",
  "010_phase4_realtime.sql",
];

async function runMigrations() {
  const client = await pool.connect();

  try {
    console.log("🔌 Connected to database\n");

    // Ensure tracking table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename   VARCHAR(255) PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Fetch already-applied migrations
    const applied = await client.query("SELECT filename FROM schema_migrations");
    const appliedSet = new Set(applied.rows.map((r) => r.filename));

    for (const file of MIGRATION_FILES) {
      if (appliedSet.has(file)) {
        console.log(`⏭️  ${file} — already applied, skipping`);
        continue;
      }

      const filePath = path.join(MIGRATIONS_DIR, file);

      if (!fs.existsSync(filePath)) {
        console.warn(`⚠️  Skipping ${file} — file not found`);
        continue;
      }

      const sql = fs.readFileSync(filePath, "utf8");

      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query(
          "INSERT INTO schema_migrations (filename) VALUES ($1)",
          [file],
        );
        await client.query("COMMIT");
        console.log(`✅ ${file}`);
      } catch (err) {
        await client.query("ROLLBACK");
        console.error(`❌ ${file} failed:\n   ${err.message}`);
        throw err;
      }
    }

    console.log("\n✅ All migrations complete.");
  } catch (err) {
    console.error("\n❌ Migration runner failed:", err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

runMigrations();
