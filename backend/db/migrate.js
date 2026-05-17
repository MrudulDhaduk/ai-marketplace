/**
 * migrate.js — Node.js migration runner
 * Runs all SQL migration files in order against the configured database.
 * Works on Windows without requiring psql in PATH.
 *
 * Usage:
 *   node backend/db/migrate.js
 *   npm run migrate
 *
 * Requires DATABASE_URL or individual DB env vars in .env
 */

require("dotenv").config();
const fs   = require("fs");
const path = require("path");
const { Pool } = require("pg");

// ── DB connection (mirrors config/db.js logic) ────────────────────────────
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

// ── Migration files in execution order ───────────────────────────────────
const MIGRATIONS_DIR = path.join(__dirname, "migrations");

const MIGRATION_FILES = [
  "001_security_indexes.sql",
  "002_notifications.sql",
  "003_messages.sql",
  "004_project_events.sql",
  "005_required_additions.sql",
];

async function runMigrations() {
  const client = await pool.connect();

  try {
    console.log("🔌 Connected to database\n");

    for (const file of MIGRATION_FILES) {
      const filePath = path.join(MIGRATIONS_DIR, file);

      if (!fs.existsSync(filePath)) {
        console.warn(`⚠️  Skipping ${file} — file not found`);
        continue;
      }

      const sql = fs.readFileSync(filePath, "utf8");

      try {
        await client.query(sql);
        console.log(`✅ ${file}`);
      } catch (err) {
        // Some statements (like ADD CONSTRAINT IF NOT EXISTS via DO block)
        // may produce non-fatal notices — only abort on real errors
        if (err.severity === "ERROR" || err.severity === "FATAL") {
          console.error(`❌ ${file} failed:\n   ${err.message}`);
          throw err;
        } else {
          console.log(`✅ ${file} (with notice: ${err.message})`);
        }
      }
    }

    console.log("\n✅ All migrations complete.");
  } catch (err) {
    console.error("\n❌ Migration failed:", err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

runMigrations();
