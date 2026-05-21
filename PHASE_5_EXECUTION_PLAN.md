# Phase 5 Execution Plan — Database & Query Layer Optimization

> **Status:** Analysis only. No code changes made.
> **Date:** 2026-05-21
> **Scope:** Full backend query audit, schema performance analysis, and implementation roadmap.

---

## Table of Contents

1. [Activity Feed Optimization](#1-activity-feed-optimization)
2. [discoverProjects Query Optimization](#2-discoverprojects-query-optimization)
3. [File Reordering Optimization](#3-file-reordering-optimization)
4. [Redis Caching Layer](#4-redis-caching-layer)
5. [PostgreSQL Pool Tuning](#5-postgresql-pool-tuning)
6. [Schema Cleanup](#6-schema-cleanup)
7. [Replay / Event System Performance](#7-replay--event-system-performance)
8. [Implementation Plan](#8-implementation-plan)
9. [Migration Ordering Strategy](#9-migration-ordering-strategy)
10. [Risk Analysis & Rollback Strategy](#10-risk-analysis--rollback-strategy)
11. [Expected Performance Impact](#11-expected-performance-impact)
12. [Safe-to-Implement Checklist](#12-safe-to-implement-checklist)

---

## 1. Activity Feed Optimization

### 1.1 The `information_schema` Query — What It Is and Why It Exists

**Location:** `activityController.js` — functions `getActivity`, `approveEntry`, `requestRevisionOnEntry`, `resolveEntry`

**The query:**
```sql
SELECT column_name
FROM information_schema.columns
WHERE table_name = 'project_events'
  AND column_name IN ('actioned_at', 'approved_at')
```

**Why it was added:**
Migration 007 (`007_schema_stabilization.sql`) renames `approved_at` → `actioned_at` on `project_events`. The rename is wrapped in a `DO $$ ... IF EXISTS ... THEN ALTER TABLE ... RENAME COLUMN ... END IF $$` block, meaning it is safe to run on a DB that already has `actioned_at`. However, the developer could not guarantee at the time of writing that every deployment environment had run migration 007. The `information_schema` query was added as a runtime guard: detect which column name actually exists, then build the SQL dynamically.

**This pattern fires on every single request** to `getActivity`, `approveEntry`, `requestRevisionOnEntry`, and `resolveEntry` — 4 separate endpoints, each issuing an extra round-trip to PostgreSQL before doing any real work.

### 1.2 Does Migration 007 Fully Guarantee the Column Exists?

**Yes — with one caveat.**

The migration's `DO $$` block checks `information_schema.columns` itself and only renames if `approved_at` exists AND `actioned_at` does not. The live `schema.sql` dump (the ground-truth of the current DB state) shows:

```sql
CREATE TABLE public.project_events (
    ...
    actioned_at timestamp with time zone,
    ...
);
```

`approved_at` does **not** appear anywhere in `schema.sql`. This confirms migration 007 has already run on the live database and the rename is complete. The `approved_at` column no longer exists.

**The caveat:** The `information_schema` guard was written for a transitional period. That period is over. The live schema is stable.

### 1.3 Can the Runtime Detection Logic Be Safely Removed?

**Yes, unconditionally.** The conditions that justified it no longer exist:

| Condition | Status |
|---|---|
| `actioned_at` exists in live schema | ✅ Confirmed via schema.sql |
| `approved_at` no longer exists | ✅ Confirmed — absent from schema.sql |
| Migration 007 is idempotent | ✅ DO $$ block is safe to re-run |
| Any new environment will run all migrations before starting | ✅ `db/migrate.js` runs migrations in order at startup |

The replacement is a direct, hardcoded reference to `actioned_at` in all four functions.

### 1.4 Performance Gain Estimate

Each `information_schema` query hits the PostgreSQL catalog. On a local Docker setup this costs ~1–3 ms per call. In production with network latency it can be 3–8 ms. More importantly, `information_schema` views are not cached by the query planner — they scan `pg_attribute` and related system catalogs on every execution.

| Endpoint | Queries before | Queries after | Saved round-trips |
|---|---|---|---|
| `getActivity` | 4 (colCheck + main + commentCount + access) | 3 | 1 |
| `approveEntry` | 4 (colCheck + access + update + notify) | 3 | 1 |
| `requestRevisionOnEntry` | 4 | 3 | 1 |
| `resolveEntry` | 4 | 3 | 1 |

**Estimated latency reduction per request: 3–8 ms.** Under concurrent load (e.g. 50 active project rooms), this eliminates 50–400 ms of unnecessary catalog I/O per second.

---

## 2. discoverProjects Query Optimization

### 2.1 The Current Tags Filtering Query

**Location:** `projectController.js` → `discoverProjects`

```sql
SELECT id, title, ...
FROM projects
WHERE status IN ('open', 'bidding')
  AND (
    SELECT ARRAY_AGG(LOWER(t)) FROM UNNEST(tags) AS t
  ) && $1::text[]
ORDER BY id DESC
LIMIT $2 OFFSET $3
```

The same correlated subquery pattern appears in both the data fetch and the `COUNT(*)` query.

### 2.2 Why This Prevents Efficient Index Use

The expression `(SELECT ARRAY_AGG(LOWER(t)) FROM UNNEST(tags) AS t)` is a **correlated scalar subquery** evaluated per row. PostgreSQL cannot use any index on `projects.tags` to satisfy this predicate because:

1. The subquery is not a simple column reference — it is a derived expression.
2. `ARRAY_AGG(LOWER(t)) FROM UNNEST(tags)` materializes a new array for every row before the `&&` comparison can happen.
3. PostgreSQL's GIN index on `tags` supports the `&&` operator directly on the column, but only when the column is referenced directly — not when it is first transformed through `UNNEST` + `ARRAY_AGG`.
4. The query planner is forced into a **sequential scan** of all `open`/`bidding` projects, applying the subquery as a filter predicate row-by-row.

**Current execution plan (estimated):**
```
Seq Scan on projects  (cost=high)
  Filter: (status IN ('open','bidding'))
  Filter: (correlated subquery) && $1
  Rows removed by filter: N (all non-matching rows)
```

### 2.3 Optimal GIN Index Strategy

**Step 1 — Normalize tags at write time (application layer)**

The root cause is mixed-case tags stored in the array. The fix is to lowercase tags on `INSERT`/`UPDATE` in `createProject`. This makes the stored data consistent and eliminates the need for `LOWER()` at query time.

**Step 2 — Create a GIN index on the `tags` column**

```sql
CREATE INDEX CONCURRENTLY idx_projects_tags_gin
  ON projects USING GIN (tags);
```

A GIN (Generalized Inverted Index) index on an array column indexes each individual array element. PostgreSQL can use it directly for `&&` (overlap), `@>` (contains), and `<@` (contained by) operators.

**Step 3 — Rewrite the query to use direct column reference**

```sql
WHERE status IN ('open', 'bidding')
  AND tags && $1::text[]
```

This is the form the GIN index can satisfy. The planner will use a **Bitmap Index Scan** on `idx_projects_tags_gin` followed by a **Bitmap Heap Scan**, dramatically reducing rows examined.

**Step 4 — Normalize user skills to lowercase at query time (already done)**

The existing code does `ARRAY_AGG(LOWER(skill))` when fetching user skills — this is correct and should be kept.

### 2.4 How the `&&` Operator Changes Execution Behavior

With a GIN index and direct column reference:

| Aspect | Before (correlated subquery) | After (direct `&&` with GIN) |
|---|---|---|
| Index used | None (seq scan) | GIN bitmap index scan |
| Rows examined | All open/bidding projects | Only projects with matching tags |
| Per-row work | UNNEST + ARRAY_AGG subquery | Single index lookup |
| COUNT(*) query | Same seq scan | Same GIN index |
| Planner can parallelize | Limited | Yes (parallel bitmap scan) |

### 2.5 Expected Query Plan Improvements

For a table with 10,000 projects where 500 match a developer's skills:

| Metric | Before | After |
|---|---|---|
| Rows examined | ~10,000 | ~500 |
| Estimated cost | High (seq scan) | Low (bitmap scan) |
| Latency (estimated) | 15–40 ms | 1–3 ms |
| COUNT(*) latency | 15–40 ms | 1–3 ms |
| Total `discoverProjects` latency | 30–80 ms | 2–6 ms |

---

## 3. File Reordering Optimization

### 3.1 Current Reorder Loop

**Location:** `uploadController.js` → `reorderFiles`

```javascript
const client = await pool.connect();
await client.query("BEGIN");
for (const item of updates) {
  await client.query(
    "UPDATE project_files SET position = $1 WHERE id = $2",
    [item.position, item.id],
  );
}
await client.query("COMMIT");
```

### 3.2 Current Query Pattern: N Updates vs Single Bulk Update

For a reorder of N files, this issues **N individual `UPDATE` statements** inside a single transaction. Each statement:
- Acquires a row-level lock on the target row
- Writes a WAL (Write-Ahead Log) record
- Updates the heap page
- Updates any indexes on `project_files` (there are two: `project_files_project_id_position_idx` and `project_files_project_position_idx` — both covering `(project_id, position)`)

For a typical reorder of 5–10 files, this is 5–10 round-trips to the DB within the transaction, plus 10–20 index page updates.

### 3.3 Lock Contention Under Concurrent Usage

The current approach holds the transaction open for the duration of all N round-trips. During this window:

- Any concurrent read of `project_files` for the same project that needs a consistent view of `position` will see the intermediate state (within the same transaction) or block (if using `SELECT FOR UPDATE`).
- If two users trigger reorder simultaneously (unlikely but possible), the second transaction will block on the row locks held by the first.
- The longer the transaction is open, the higher the chance of lock wait timeouts under load.
- Each `UPDATE` also generates a separate WAL record, increasing I/O pressure.

### 3.4 Proposed VALUES-Based Bulk UPDATE Strategy

Replace the loop with a single `UPDATE ... FROM (VALUES ...)` statement:

```sql
UPDATE project_files AS pf
SET position = v.position
FROM (VALUES
  ($1::int, $2::int),
  ($3::int, $4::int),
  ...
) AS v(id, position)
WHERE pf.id = v.id
```

This executes as a **single statement**, meaning:
- One round-trip to the DB
- One WAL record (or one per page touched, but far fewer than N separate records)
- Row locks are acquired and released atomically
- The transaction window is minimized to a single statement execution time
- The query planner can use a hash join between the VALUES set and the table

**Parameter construction** in Node.js:
```javascript
const values = updates.flatMap((item, i) => [item.id, item.position]);
const placeholders = updates.map((_, i) => `($${i*2+1}::int, $${i*2+2}::int)`).join(', ');
await pool.query(
  `UPDATE project_files AS pf SET position = v.position
   FROM (VALUES ${placeholders}) AS v(id, position)
   WHERE pf.id = v.id`,
  values
);
```

The explicit transaction wrapper can be removed since a single statement is already atomic.

### 3.5 Latency Reduction Estimate

| Files reordered | Current (N round-trips) | After (1 round-trip) |
|---|---|---|
| 3 files | ~6–9 ms | ~1–2 ms |
| 5 files | ~10–15 ms | ~1–2 ms |
| 10 files | ~20–30 ms | ~1–2 ms |

**Estimated latency reduction: 80–90% for typical reorder operations.**

Additionally, the duplicate indexes `project_files_project_id_position_idx` and `project_files_project_position_idx` (both covering `(project_id, position)`) mean every `UPDATE` currently writes to two identical indexes. One should be dropped (see Section 6).

---

## 4. Redis Caching Layer

### 4.1 Stats Endpoint Audit

#### Client Stats — `GET /api/stats/client`

**Queries executed:**
```sql
-- Query 1: aggregate across all client projects
SELECT
  COUNT(*) FILTER (WHERE status IN ('bidding','active'))  AS active_projects,
  COUNT(*) FILTER (WHERE status = 'completed')            AS completed_projects,
  COUNT(*) FILTER (WHERE review_status = 'pending')       AS pending_reviews,
  SUM(CASE WHEN status = 'completed' THEN max_budget END) AS total_spend
FROM projects WHERE client_id = $1

-- Query 2: count all bids across client's projects
SELECT COUNT(b.id) AS total_bids
FROM bids b JOIN projects p ON b.project_id = p.id
WHERE p.client_id = $1
```

Both run in parallel. Query 2 is a join-aggregate that scans all bids for all of the client's projects. As bid volume grows, this becomes expensive.

#### Developer Stats — `GET /api/stats/developer`

**Queries executed (3 in parallel):**
```sql
-- Query 1: project aggregates
SELECT COUNT(*) FILTER (WHERE status = 'active'), ... FROM projects WHERE assigned_developer_id = $1

-- Query 2: bid aggregates
SELECT COUNT(*), COUNT(*) FILTER (WHERE status = 'accepted'), ... FROM bids WHERE developer_id = $1

-- Query 3: earnings
SELECT COALESCE(SUM(p.max_budget), 0) FROM projects p
WHERE p.assigned_developer_id = $1 AND p.status = 'completed'
```

Three separate queries, all aggregate scans. The earnings query is particularly expensive as projects grow.

#### Dashboard Activity Feeds — `GET /api/activity/client` and `GET /api/activity/developer`

Both execute a paginated `project_events` JOIN with `projects` and `users`, plus a separate `COUNT(*)` query. The developer activity query has an `OR` condition:
```sql
WHERE p.assigned_developer_id = $1
   OR (pe.actor_id = $1 AND pe.event_type = 'bid_placed')
```
This `OR` prevents index-only scans and forces a more expensive plan.

### 4.2 Repeated Expensive Aggregation Queries

The stats endpoints are called on every dashboard load and on every page navigation. They are pure aggregations with no side effects. The data they return changes only when:
- A project is created, assigned, or completed
- A bid is placed or accepted
- A review is submitted

These are low-frequency write events relative to the read frequency of the stats endpoints.

### 4.3 Redis Cache Strategy Design

#### Cache Keys

```
stats:client:{userId}          → client stats object
stats:developer:{userId}       → developer stats object
activity:client:{userId}:p{page}   → paginated client activity (optional)
activity:developer:{userId}:p{page} → paginated developer activity (optional)
```

#### TTL Policy

| Cache Key | TTL | Rationale |
|---|---|---|
| `stats:client:{userId}` | 60 seconds | Stats change on project/bid events; 60s staleness is acceptable |
| `stats:developer:{userId}` | 60 seconds | Same rationale |
| `activity:client:{userId}:p1` | 30 seconds | Page 1 is most frequently accessed; short TTL keeps it fresh |
| `activity:developer:{userId}:p1` | 30 seconds | Same |
| Activity pages > 1 | 120 seconds | Historical pages change rarely |

#### Invalidation Triggers

| Event | Invalidate |
|---|---|
| Project created | `stats:client:{clientId}` |
| Bid placed | `stats:developer:{devId}`, `stats:client:{clientId}` |
| Bid accepted / project assigned | `stats:client:{clientId}`, `stats:developer:{devId}` |
| Project review submitted | `stats:client:{clientId}`, `stats:developer:{devId}` |
| Project completed | `stats:client:{clientId}`, `stats:developer:{devId}` |
| Any `project_events` INSERT | `activity:client:{clientId}:*`, `activity:developer:{devId}:*` |

Invalidation should use `DEL` (not `EXPIRE 0`) to force a fresh fetch on next request.

#### Stale-Data Tolerance

Stats (active projects, completed count, total spend) are **tolerable at 60s staleness** — these are dashboard summary numbers, not transactional data. Activity feeds are more time-sensitive; page 1 should use 30s TTL.

### 4.4 Endpoints That Should NOT Be Cached

| Endpoint | Reason |
|---|---|
| `GET /projects/:id` | Per-project detail; must reflect latest review_status, is_urgent, etc. |
| `GET /projects/:id/activity` | Real-time workspace feed; staleness breaks the approval workflow |
| `GET /projects/:id/files` | File list must reflect uploads/deletes immediately |
| `GET /notifications` | Unread count must be accurate |
| `GET /messages` | Chat must be real-time |
| Any `POST`/`PUT`/`DELETE` | Mutations must never be cached |

### 4.5 Implementation Notes

The `redisClient` is already exported from `config/redis.js` and degrades gracefully to `null` when Redis is unavailable. The caching layer should follow the same pattern: if `redisClient` is null, skip cache and query DB directly. This ensures the app works in environments without Redis.

---

## 5. PostgreSQL Pool Tuning

### 5.1 Current Pool Configuration

**Location:** `config/db.js`

```javascript
const POOL_CONFIG = {
  max: Number(process.env.DB_POOL_MAX || 20),
  idleTimeoutMillis: Number(process.env.DB_IDLE_TIMEOUT_MS || 30_000),
  connectionTimeoutMillis: Number(process.env.DB_CONN_TIMEOUT_MS || 5_000),
};
```

**What is missing:**
- No `statement_timeout` — a runaway query can hold a connection indefinitely
- No `query_timeout` (node-postgres equivalent: `query_timeout` option on the Pool)
- No `allowExitOnIdle` — the process may hang on graceful shutdown
- No `min` connections — cold start latency on first requests after idle period

### 5.2 Recommended Configuration

```javascript
const POOL_CONFIG = {
  max: Number(process.env.DB_POOL_MAX || 20),
  min: Number(process.env.DB_POOL_MIN || 2),
  idleTimeoutMillis: Number(process.env.DB_IDLE_TIMEOUT_MS || 30_000),
  connectionTimeoutMillis: Number(process.env.DB_CONN_TIMEOUT_MS || 5_000),
  // Kills queries that run longer than 10s — prevents pool exhaustion from slow queries
  statement_timeout: Number(process.env.DB_STATEMENT_TIMEOUT_MS || 10_000),
  // Allows the process to exit cleanly when all clients are idle
  allowExitOnIdle: true,
};
```

`statement_timeout` is passed as a connection parameter to PostgreSQL and applies to every query on that connection. It is the most important missing guard.

### 5.3 How These Values Interact With Each Environment

#### Docker (local development)

- `max: 20` is fine — Docker PostgreSQL typically allows 100 connections by default
- `connectionTimeoutMillis: 5000` — generous for local; can be reduced to 3000
- `statement_timeout: 10000` — catches infinite loops in dev before they become production bugs
- `min: 2` — keeps 2 warm connections so the first request after startup is fast

#### Local Development (non-Docker)

- Same as Docker. The pool is per-process, so 20 max is well within PostgreSQL's default `max_connections = 100`.

#### Production Deployment

- `max: 20` per process. Under PM2 cluster mode with 4 workers: 80 total connections. PostgreSQL's `max_connections` should be set to at least 100 (leave headroom for admin connections).
- `statement_timeout: 10000` — critical in production. Without it, a slow query (e.g. a missing index after a data growth event) can exhaust the pool in seconds.
- `connectionTimeoutMillis: 5000` — if the pool is exhausted, requests fail fast with a clear error rather than queuing indefinitely.

#### Concurrent Socket.IO Traffic

Socket.IO connections do not hold DB connections open — they only acquire a pool connection for the duration of a query. However, high-frequency socket events (e.g. `project_events` replay on reconnect) can spike DB demand. The `statement_timeout` prevents any single replay query from blocking the pool.

### 5.4 Pool Exhaustion Risk Analysis

**Current risk factors:**
1. The `information_schema` queries (Section 1) add an extra connection acquisition per request — removing them reduces peak pool demand.
2. The file reorder loop (Section 3) holds a connection for N round-trips — the bulk UPDATE fix reduces this to 1.
3. Stats endpoints without caching (Section 4) run 2–3 queries per dashboard load — caching eliminates most of these.
4. No `statement_timeout` means a single slow query can hold a connection for minutes.

**After Phase 5 fixes:** Pool demand per request drops by approximately 30–40% across the most common endpoints.

---

## 6. Schema Cleanup

### 6.1 Duplicate Indexes Found

The following duplicate indexes were identified by cross-referencing `schema.sql` with all migration files:

#### `project_files` — Two identical indexes on `(project_id, position)`

```sql
-- From schema.sql (created by migration 001):
CREATE INDEX project_files_project_id_position_idx ON project_files (project_id, position);

-- Also from schema.sql (created by migration 005):
CREATE INDEX project_files_project_position_idx ON project_files (project_id, position);
```

**These are byte-for-byte identical in structure.** PostgreSQL maintains both, meaning every `INSERT`, `UPDATE`, and `DELETE` on `project_files` writes to two identical index structures. One must be dropped.

**Safe to drop:** `project_files_project_position_idx` (the older one from migration 005; the newer `project_files_project_id_position_idx` from migration 001 has a more descriptive name).

#### `project_events` — Overlapping indexes on `project_id` and `(project_id, created_at)`

```sql
CREATE INDEX project_events_project_id_idx ON project_events (project_id);
CREATE INDEX project_events_project_created_idx ON project_events (project_id, created_at DESC);
CREATE INDEX idx_project_events_project_created ON project_events (project_id, created_at DESC);
```

- `project_events_project_created_idx` and `idx_project_events_project_created` are **identical** — both cover `(project_id, created_at DESC)`. One was created in migration 005, the other in migration 010.
- `project_events_project_id_idx` (single column) is **made redundant** by either of the composite indexes above — PostgreSQL can use the composite index for queries that only filter on `project_id`.

**Safe to drop:**
- `idx_project_events_project_created` (the migration 010 duplicate — keep `project_events_project_created_idx` which was created first)
- `project_events_project_id_idx` (made redundant by the composite index)

#### `project_submissions` — Two identical indexes on `(project_id, submitted_at DESC)`

```sql
CREATE INDEX project_submissions_project_id_submitted_at_idx ON project_submissions (project_id, submitted_at DESC);
CREATE INDEX project_submissions_project_time_idx ON project_submissions (project_id, submitted_at DESC);
```

**Identical structure.** Created by migrations 001 and 005 respectively.

**Safe to drop:** `project_submissions_project_time_idx`

#### `bids` — Duplicate unique index

```sql
-- Unique constraint (enforced as unique index):
ALTER TABLE bids ADD CONSTRAINT bids_project_id_developer_id_key UNIQUE (project_id, developer_id);

-- Explicit unique index (from migration 001):
CREATE UNIQUE INDEX bids_project_developer_unique_idx ON bids (project_id, developer_id);
```

PostgreSQL creates an implicit index to enforce the `UNIQUE` constraint. The explicit `bids_project_developer_unique_idx` is therefore a duplicate.

**Safe to drop:** `bids_project_developer_unique_idx` (the constraint's implicit index serves the same purpose)

#### `projects` — Duplicate index on `assigned_developer_id`

```sql
CREATE INDEX projects_assigned_developer_id_idx ON projects (assigned_developer_id);
CREATE INDEX projects_developer_id_idx ON projects (assigned_developer_id);
```

**Identical.** Both index the same column.

**Safe to drop:** `projects_developer_id_idx`

#### `email_verifications` — Redundant partial and full index on `token`

```sql
CREATE INDEX email_verifications_token_idx ON email_verifications (token);
CREATE INDEX email_verifications_active_idx ON email_verifications (token) WHERE used_at IS NULL;
```

The partial index (`WHERE used_at IS NULL`) is more selective and is the one actually used by the token lookup query (which always looks up unused tokens). The full index `email_verifications_token_idx` is made redundant for the common case.

**Safe to drop:** `email_verifications_token_idx` — the partial index covers the only real use case, and the unique constraint on `token` already enforces uniqueness.

### 6.2 Indexes Likely Hurting Write Performance

Every index on a table adds overhead to `INSERT`, `UPDATE`, and `DELETE`. The worst offenders are tables with high write frequency:

| Table | Write frequency | Redundant indexes to drop |
|---|---|---|
| `project_events` | High (every action) | `idx_project_events_project_created`, `project_events_project_id_idx` |
| `project_files` | Medium | `project_files_project_position_idx` |
| `project_submissions` | Low-medium | `project_submissions_project_time_idx` |
| `bids` | Medium | `bids_project_developer_unique_idx` |
| `projects` | Medium | `projects_developer_id_idx` |

### 6.3 Missing Indexes After Phase 4 Realtime Work

The following indexes are absent but would benefit Phase 4+ query patterns:

#### Missing: GIN index on `projects.tags`
```sql
CREATE INDEX CONCURRENTLY idx_projects_tags_gin ON projects USING GIN (tags);
```
Required for the `discoverProjects` optimization (Section 2).

#### Missing: Index on `project_events.event_type`
The `statsController` developer activity query filters on `event_type = 'bid_placed'`. There is no index on `event_type` alone or `(actor_id, event_type)`.
```sql
CREATE INDEX CONCURRENTLY idx_project_events_actor_event
  ON project_events (actor_id, event_type)
  WHERE event_type = 'bid_placed';
```

#### Missing: Index on `pending_socket_deliveries` for cleanup
The `pending_socket_deliveries` table has `idx_psd_user_expires` on `(user_id, expires_at)`. A background cleanup job (pruning expired rows) would benefit from an index on `expires_at` alone:
```sql
CREATE INDEX CONCURRENTLY idx_psd_expires ON pending_socket_deliveries (expires_at)
  WHERE expires_at < NOW();
```
This is a partial index that only covers expired rows, keeping it small.

---

## 7. Replay / Event System Performance

### 7.1 `project_events` Growth Characteristics

Every user action in the workspace inserts a row into `project_events`. Based on the current event types:

| Event type | Frequency |
|---|---|
| `file_uploaded`, `file_deleted` | Per file operation |
| `bid_placed`, `bid_accepted` | Per bid lifecycle |
| `submission_added` | Per submission |
| `project_approved`, `revision_requested`, `resolved` | Per review cycle |
| `project_urgent`, `project_unurgent` | Occasional |
| `update_requested` | Occasional |
| `note_added`, `note_updated`, `note_deleted` | Per note |

For an active project with 10 developers bidding, 5 submission cycles, and regular file uploads, a single project can generate 50–200 events over its lifetime. At 1,000 active projects, the table reaches 50,000–200,000 rows. At 10,000 projects (growth scenario), it reaches 500,000–2,000,000 rows.

### 7.2 Is the Replay Index from Migration 010 Sufficient?

**Migration 010 creates:**
```sql
CREATE INDEX IF NOT EXISTS idx_project_events_project_created
  ON project_events (project_id, created_at DESC);
```

**The replay query pattern (from socket reconnect logic):**
```sql
SELECT * FROM project_events
WHERE project_id = $1 AND created_at > $2
ORDER BY created_at ASC
```

This query is **well-served** by the composite index `(project_id, created_at DESC)`. PostgreSQL can use it for both the equality filter on `project_id` and the range filter on `created_at`. The `DESC` vs `ASC` ordering difference is minor — the planner can scan the index in reverse.

**However**, there is a duplicate: `project_events_project_created_idx` (from migration 005) covers the exact same columns. As noted in Section 6, one should be dropped.

**Verdict:** The replay index is sufficient for current scale. No additional index is needed for the replay query itself.

### 7.3 Archival / Pruning Strategy

At 2,000,000+ rows, even indexed queries on `project_events` will see increased I/O due to index bloat and heap fragmentation. Recommended strategy:

#### Option A — Soft Archive (Recommended for Phase 5)

Add a boolean `archived` column and a partial index:
```sql
ALTER TABLE project_events ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX CONCURRENTLY idx_project_events_active
  ON project_events (project_id, created_at DESC)
  WHERE archived = false;
```

A background job (cron or pg_cron) archives events older than 90 days for completed projects:
```sql
UPDATE project_events pe
SET archived = true
FROM projects p
WHERE pe.project_id = p.id
  AND p.status = 'completed'
  AND pe.created_at < NOW() - INTERVAL '90 days';
```

All live queries add `AND archived = false` and use the partial index, which stays small.

#### Option B — Partitioning by `created_at` (Future, at 5M+ rows)

Range partition `project_events` by month. Old partitions can be detached and archived to cold storage. This is a significant schema change and should be deferred until the table actually reaches problematic size.

#### Option C — Separate `project_events_archive` table

Move old rows to an archive table with the same schema. Live queries only touch the main table. Archive queries join both. Simpler than partitioning but requires application-level routing.

### 7.4 Storage Growth Estimate

Each `project_events` row is approximately 200–400 bytes (id, project_id, actor_id, event_type, meta JSONB, timestamps, actor_name, actor_role, approval fields).

| Scale | Rows | Estimated table size | Index size |
|---|---|---|---|
| 1,000 projects | ~100,000 | ~30 MB | ~10 MB |
| 10,000 projects | ~1,000,000 | ~300 MB | ~100 MB |
| 100,000 projects | ~10,000,000 | ~3 GB | ~1 GB |

At 10,000 projects the table is manageable without partitioning. The soft-archive strategy (Option A) is the right Phase 5 investment.

---

## 8. Implementation Plan

### Step-by-Step Execution Order

The steps are ordered by: (1) zero-risk wins first, (2) schema changes before application changes that depend on them, (3) additive changes before destructive ones.

---

#### Step 1 — Remove `information_schema` Runtime Detection (Zero Risk)

**Files:** `activityController.js`
**Change:** Replace all 4 `colCheck` query blocks with hardcoded `actioned_at` references.
**Prerequisite:** Confirm migration 007 has run (already confirmed via schema.sql).
**Risk:** None. The column exists. The old column does not.
**Rollback:** Revert the 4 function changes. No DB change needed.

---

#### Step 2 — Add GIN Index on `projects.tags` (Additive, Non-Blocking)

**Migration:** `011_phase5_performance.sql`
```sql
CREATE INDEX CONCURRENTLY idx_projects_tags_gin ON projects USING GIN (tags);
```
`CONCURRENTLY` means no table lock. Safe to run on a live database.
**Prerequisite:** None.
**Risk:** Minimal. Index creation takes time proportional to table size but does not block reads or writes.
**Rollback:** `DROP INDEX CONCURRENTLY idx_projects_tags_gin;`

---

#### Step 3 — Normalize Tags at Write Time (Application Change)

**Files:** `projectController.js` → `createProject`
**Change:** Lowercase all tags before INSERT:
```javascript
Array.isArray(tags) ? tags.map(t => t.toLowerCase().trim()) : []
```
**Prerequisite:** Step 2 (GIN index should exist before the query rewrite in Step 4).
**Risk:** Low. Existing mixed-case tags in the DB will still work with the new query (user skills are already lowercased). New tags will be stored lowercase.
**Rollback:** Remove the `.map(t => t.toLowerCase().trim())` call.

---

#### Step 4 — Rewrite `discoverProjects` Tags Query (Application Change)

**Files:** `projectController.js` → `discoverProjects`
**Change:** Replace the correlated subquery with direct `&&` operator:
```sql
WHERE status IN ('open', 'bidding')
  AND tags && $1::text[]
```
**Prerequisite:** Step 2 (GIN index must exist for this to be efficient).
**Risk:** Low. The `&&` operator is semantically equivalent to the current subquery for lowercase-normalized data.
**Rollback:** Revert to the subquery form.

---

#### Step 5 — Bulk UPDATE for File Reordering (Application Change)

**Files:** `uploadController.js` → `reorderFiles`
**Change:** Replace the `for` loop with a single `UPDATE ... FROM (VALUES ...)` statement.
**Prerequisite:** None.
**Risk:** Low. The VALUES-based UPDATE is a standard PostgreSQL pattern. The authorization check before the update is unchanged.
**Rollback:** Revert to the loop.

---

#### Step 6 — Drop Duplicate Indexes (Schema Change, Destructive)

**Migration:** `011_phase5_performance.sql` (same file, after the GIN index)
```sql
DROP INDEX CONCURRENTLY IF EXISTS project_files_project_position_idx;
DROP INDEX CONCURRENTLY IF EXISTS idx_project_events_project_created;
DROP INDEX CONCURRENTLY IF EXISTS project_events_project_id_idx;
DROP INDEX CONCURRENTLY IF EXISTS project_submissions_project_time_idx;
DROP INDEX CONCURRENTLY IF EXISTS bids_project_developer_unique_idx;
DROP INDEX CONCURRENTLY IF EXISTS projects_developer_id_idx;
DROP INDEX CONCURRENTLY IF EXISTS email_verifications_token_idx;
```
**Prerequisite:** Verify each index is truly redundant (cross-check against Section 6 findings).
**Risk:** Medium. Dropping an index that is actually used by a query not covered in this audit would cause a query plan regression. Mitigation: run `EXPLAIN ANALYZE` on all major queries before and after.
**Rollback:** Re-create the dropped indexes (they are all non-unique, so recreation is safe).

---

#### Step 7 — Add Missing Indexes (Additive)

**Migration:** `011_phase5_performance.sql`
```sql
CREATE INDEX CONCURRENTLY idx_project_events_actor_event
  ON project_events (actor_id, event_type)
  WHERE event_type = 'bid_placed';

CREATE INDEX CONCURRENTLY idx_psd_expires
  ON pending_socket_deliveries (expires_at)
  WHERE expires_at < NOW() + INTERVAL '1 day';
```
**Risk:** None. Additive only.
**Rollback:** Drop the new indexes.

---

#### Step 8 — Redis Caching for Stats Endpoints (Application Change)

**Files:** `statsController.js`
**Change:** Wrap `getClientStats` and `getDeveloperStats` with a cache-aside pattern using `redisClient` from `config/redis.js`.
**Prerequisite:** `redisClient` is already available and null-safe.
**Risk:** Low. The null-safe pattern means the app degrades gracefully if Redis is unavailable.
**Rollback:** Remove the cache wrapper. Stats queries fall back to direct DB.

---

#### Step 9 — PostgreSQL Pool Tuning (Configuration Change)

**Files:** `config/db.js`
**Change:** Add `min: 2`, `statement_timeout`, `allowExitOnIdle: true`.
**Prerequisite:** None.
**Risk:** Low. `statement_timeout` will cause long-running queries to fail with an error rather than hang. Any query currently taking >10s will now surface as an error — this is desirable behavior.
**Rollback:** Remove the new config keys.

---

#### Step 10 — Soft Archive Strategy for `project_events` (Schema + Application)

**Migration:** `012_event_archival.sql`
```sql
ALTER TABLE project_events ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX CONCURRENTLY idx_project_events_active
  ON project_events (project_id, created_at DESC) WHERE archived = false;
```
**Application change:** Add `AND archived = false` to all `project_events` queries in `activityController.js` and `statsController.js`.
**Background job:** Add a scheduled cleanup function (can be a simple `setInterval` in `server.js` or a separate cron).
**Risk:** Medium. Adding `AND archived = false` to existing queries changes their semantics — archived events will no longer appear in feeds. This is the intended behavior but must be communicated to the team.
**Rollback:** Remove the `archived` column filter from queries. The column itself can remain (it defaults to `false`, so no data is hidden).

---

## 9. Migration Ordering Strategy

All schema changes should be consolidated into two new migration files:

### `011_phase5_performance.sql`

Covers: GIN index, duplicate index removal, missing indexes.
All changes use `CONCURRENTLY` where possible to avoid table locks.

```
Order within the file:
1. CREATE INDEX CONCURRENTLY idx_projects_tags_gin          (additive)
2. CREATE INDEX CONCURRENTLY idx_project_events_actor_event (additive)
3. CREATE INDEX CONCURRENTLY idx_psd_expires                (additive)
4. DROP INDEX CONCURRENTLY project_files_project_position_idx
5. DROP INDEX CONCURRENTLY idx_project_events_project_created
6. DROP INDEX CONCURRENTLY project_events_project_id_idx
7. DROP INDEX CONCURRENTLY project_submissions_project_time_idx
8. DROP INDEX CONCURRENTLY bids_project_developer_unique_idx
9. DROP INDEX CONCURRENTLY projects_developer_id_idx
10. DROP INDEX CONCURRENTLY email_verifications_token_idx
```

**Note:** `CREATE INDEX CONCURRENTLY` and `DROP INDEX CONCURRENTLY` cannot run inside a transaction block. This migration must NOT be wrapped in `BEGIN`/`COMMIT`. The migration runner (`db/migrate.js`) must handle this — verify it supports non-transactional migrations before running.

### `012_event_archival.sql`

Covers: soft archive column and partial index for `project_events`.

```sql
BEGIN;
ALTER TABLE project_events ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT false;
COMMIT;

-- Outside transaction (CONCURRENTLY):
CREATE INDEX CONCURRENTLY idx_project_events_active
  ON project_events (project_id, created_at DESC) WHERE archived = false;
```

### Application Changes Order

Application changes must follow their schema prerequisites:

```
1. Remove information_schema queries (no schema dep)
2. Normalize tags at write time (no schema dep)
3. Rewrite discoverProjects query (after GIN index from 011)
4. Bulk UPDATE for file reorder (no schema dep)
5. Redis caching for stats (no schema dep)
6. Pool tuning (no schema dep)
7. Add archived = false filters (after 012 migration)
8. Add background archival job (after 012 migration)
```

---

## 10. Risk Analysis & Rollback Strategy

### Risk Matrix

| Change | Risk Level | Impact if Wrong | Rollback Time |
|---|---|---|---|
| Remove information_schema queries | 🟢 Low | Query errors on actioned_at if column missing (impossible — confirmed) | < 5 min |
| GIN index creation | 🟢 Low | Index creation fails (safe — CONCURRENTLY) | Instant (DROP INDEX) |
| Tags normalization at write | 🟡 Medium | Mixed-case tags in old data won't match new lowercase queries | < 5 min |
| discoverProjects query rewrite | 🟡 Medium | Wrong results if tags not normalized | < 5 min |
| Bulk UPDATE reorder | 🟢 Low | Reorder fails (transaction rollback handles it) | < 5 min |
| Drop duplicate indexes | 🟡 Medium | Query plan regression if an index was used by an unaudited query | 10–30 min (recreate) |
| Add missing indexes | 🟢 Low | No impact if unused | Instant (DROP INDEX) |
| Redis caching | 🟢 Low | Stale stats for up to 60s; null-safe fallback | < 5 min |
| Pool tuning | 🟡 Medium | statement_timeout kills legitimate long queries | < 5 min |
| Event archival column | 🟢 Low | Column defaults to false — no data hidden | N/A |
| archived = false filters | 🟡 Medium | Archived events hidden from feeds | < 5 min |

### Tags Normalization Risk — Detailed

The most nuanced risk is the tags normalization + query rewrite combination. The current DB may contain mixed-case tags (e.g. `["React", "Node.JS"]`). After the rewrite, the query uses `tags && $1::text[]` where `$1` contains lowercase skills. The `&&` operator is case-sensitive on `text[]`.

**Mitigation:** Run a one-time data migration to lowercase all existing tags:
```sql
UPDATE projects SET tags = ARRAY(SELECT LOWER(t) FROM UNNEST(tags) AS t)
WHERE tags != ARRAY(SELECT LOWER(t) FROM UNNEST(tags) AS t);
```
This should be included in `011_phase5_performance.sql` **before** the GIN index creation (so the index is built on already-normalized data).

### Rollback Strategy

All rollbacks are non-destructive:
- **Application changes:** Git revert the specific file, redeploy.
- **Dropped indexes:** Re-create with `CREATE INDEX CONCURRENTLY` — no data loss, brief performance degradation during recreation.
- **Added columns:** Leave in place (they default to safe values). Remove with `ALTER TABLE ... DROP COLUMN` if needed.
- **Pool config:** Revert `config/db.js`, restart server.

---

## 11. Expected Performance Impact

### Per-Optimization Summary

| Optimization | Metric | Before | After | Improvement |
|---|---|---|---|---|
| Remove information_schema queries | Extra DB round-trips per request | 1 per activity endpoint call | 0 | -1 query/request |
| Remove information_schema queries | Latency per activity request | +3–8 ms overhead | 0 | 3–8 ms saved |
| GIN index + query rewrite | discoverProjects latency (10k projects) | 30–80 ms | 2–6 ms | ~90% reduction |
| GIN index + query rewrite | discoverProjects COUNT latency | 30–80 ms | 2–6 ms | ~90% reduction |
| Bulk UPDATE reorder | reorderFiles latency (5 files) | 10–15 ms | 1–2 ms | ~85% reduction |
| Bulk UPDATE reorder | DB connections held per reorder | 1 (for N round-trips) | 1 (for 1 round-trip) | N-1 fewer round-trips |
| Redis caching (stats) | getClientStats DB queries | 2 per request | 0 (cache hit) | 100% on cache hit |
| Redis caching (stats) | getDeveloperStats DB queries | 3 per request | 0 (cache hit) | 100% on cache hit |
| Redis caching (stats) | Stats endpoint latency | 10–30 ms | <1 ms (cache hit) | ~97% reduction |
| Pool tuning (statement_timeout) | Max query hold time | Unlimited | 10 s | Prevents pool exhaustion |
| Pool tuning (min: 2) | Cold start latency | 5–20 ms (new connection) | <1 ms (warm) | Eliminates cold start |
| Drop 7 duplicate indexes | Write overhead on project_events | 5 index writes per INSERT | 3 index writes per INSERT | -40% index I/O |
| Drop 7 duplicate indexes | Write overhead on project_files | 3 index writes per UPDATE | 2 index writes per UPDATE | -33% index I/O |
| Event archival | project_events query scan size | Full table | Active rows only | Proportional to archive ratio |

### Aggregate Impact Estimate

For a typical dashboard load (stats + activity feed + project list):

| Scenario | Current total DB queries | After Phase 5 | Reduction |
|---|---|---|---|
| Client dashboard load | ~8–10 queries | ~2–3 queries (cache hits) | ~70% |
| Developer dashboard load | ~9–12 queries | ~2–3 queries (cache hits) | ~75% |
| discoverProjects (skill-matched) | 2 slow seq-scan queries | 2 fast GIN queries | ~90% latency |
| File reorder (5 files) | 7 queries (5 updates + begin/commit) | 1 query | ~85% latency |
| Activity feed per project | 4 queries (was 5 with colCheck) | 3 queries | -1 query |

---

## 12. Safe-to-Implement Checklist

Use this checklist before starting implementation. Each item must be confirmed before the corresponding step proceeds.

### Pre-Implementation Verification

- [ ] **Migration 007 confirmed applied** — `schema.sql` shows `actioned_at` column, no `approved_at` column on `project_events`. ✅ Already confirmed.
- [ ] **Migration runner supports non-transactional migrations** — Verify `db/migrate.js` can handle `CONCURRENTLY` index operations outside a transaction block. Check the runner code before running migration 011.
- [ ] **Redis is available in target environment** — Confirm `REDIS_URL` and `REDIS_ENABLED` are set in production `.env`. The caching layer degrades gracefully if not, but confirm intent.
- [ ] **PostgreSQL `max_connections` headroom** — Confirm the production PostgreSQL instance has `max_connections >= 100` before adding `min: 2` to the pool (which keeps 2 connections open per process).
- [ ] **No unaudited queries depend on dropped indexes** — Run `EXPLAIN ANALYZE` on all major query paths in a staging environment after dropping indexes. Specifically check: any admin queries, any reporting queries, any queries added after the last schema audit.

### Per-Step Gates

- [ ] **Step 1 (remove colCheck):** `actioned_at` confirmed in schema. ✅
- [ ] **Step 2 (GIN index):** `CONCURRENTLY` confirmed supported by migration runner.
- [ ] **Step 3 (normalize tags):** Data migration to lowercase existing tags included in migration 011.
- [ ] **Step 4 (discoverProjects rewrite):** GIN index confirmed created (Step 2 complete).
- [ ] **Step 5 (bulk reorder):** Manual test with 1, 5, and 10 files in staging.
- [ ] **Step 6 (drop indexes):** `EXPLAIN ANALYZE` run on all affected tables in staging.
- [ ] **Step 7 (add indexes):** No gate — additive only.
- [ ] **Step 8 (Redis caching):** Cache invalidation triggers wired to all write paths.
- [ ] **Step 9 (pool tuning):** `statement_timeout` value reviewed against slowest legitimate query (activity feed with large event count — estimate 2–3 s max; 10 s timeout is safe).
- [ ] **Step 10 (archival):** Archival job tested in staging. `archived = false` filters added to all `project_events` queries before migration runs.

### Post-Implementation Verification

- [ ] All existing API tests pass.
- [ ] `discoverProjects` returns correct results for a developer with known skills.
- [ ] File reorder produces correct `position` values after bulk UPDATE.
- [ ] Stats endpoints return correct values after cache invalidation.
- [ ] Activity feed shows all events (no events accidentally hidden by `archived` filter before archival job runs).
- [ ] No pool exhaustion errors under simulated concurrent load (10+ simultaneous dashboard loads).
- [ ] `EXPLAIN ANALYZE` on `discoverProjects` confirms GIN index is used (look for `Bitmap Index Scan on idx_projects_tags_gin`).

---

*End of Phase 5 Execution Plan. No code changes have been made.*
