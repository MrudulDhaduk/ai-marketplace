# Testing Guide

## Overview

The test suite covers both the backend (Node.js/Express) and frontend (React).

| Layer | Framework | Tests | Status |
|-------|-----------|-------|--------|
| Backend unit | Jest | 72 | ✅ |
| Backend integration | Jest + Supertest | 192 | ✅ |
| Frontend unit | Jest + React Testing Library | 72 | ✅ |
| **Total** | | **336** | **✅ All passing** |

---

## Backend Tests

### Prerequisites

Integration tests require a running PostgreSQL instance with a test database.

```bash
# Create the test database (one-time setup)
psql -U postgres -c "CREATE DATABASE ai_marketplace_test;"

# Run migrations on the test database
npm run migrate:test
```

### Running Tests

```bash
# All backend tests (unit + integration)
npm test

# Unit tests only (no DB required)
npm run test:unit

# Integration tests only
npm run test:integration

# With coverage report
npm run test:coverage
 
# Watch mode (re-runs on file changes)
npm run test:watch
```

### Test Database Configuration

Integration tests use the `TEST_DATABASE_URL` environment variable.
Default: `postgresql://postgres:postgres@localhost:5432/ai_marketplace_test`

Override by setting `TEST_DATABASE_URL` in your `.env` or shell:

```bash
TEST_DATABASE_URL=postgresql://myuser:mypass@localhost:5432/mytest npm test
```

### What's Tested

**Unit tests** (`backend/tests/unit/`):
- `validation.test.js` — All input validators (signup, login, project, bid, submission)
- `logger.test.js` — JSON structured logger, child logger, level filtering
- `socketEvents.test.js` — Typed event envelope contract, EVENTS constants
- `socketRateLimiter.test.js` — Per-socket rate limiting, disconnect thresholds

**Integration tests** (`backend/tests/integration/`):
- `auth.test.js` — Signup, login, logout, /auth/me, email verification, token refresh
- `projects.test.js` — Create, list, get, discover, assigned, urgent flag
- `bids.test.js` — Place bid, get bids, accept bid, developer bids, idempotency
- `submissions.test.js` — Submit, get, add/update/delete notes, IDOR prevention
- `projectReview.test.js` — Approve, revision, complete, request-update state machine
- `notifications.test.js` — Get, mark read, mark all read, IDOR prevention
- `messages.test.js` — Send, get, unread count, mark-as-read on fetch
- `profile.test.js` — Get profile, update bio, skills CRUD, IDOR prevention
- `stats.test.js` — Client stats, developer stats, activity feeds, role guards
- `idempotency.test.js` — Idempotency-Key caching, user scoping, key validation
- `security.test.js` — Security headers, CSRF, JWT edge cases, body size limit

---

## Frontend Tests

Frontend tests use CRA's built-in Jest + React Testing Library setup.

```bash
# Run all frontend tests (single pass)
npm test -- --watchAll=false

# Watch mode
npm test

# With coverage
npm test -- --watchAll=false --coverage
```

### What's Tested

**`src/__tests__/utils.test.js`**
- `formatProjectForCard` — budget/due formatting, field defaults
- `timeAgo` — relative time strings (just now, minutes, hours, days)
- `getFileIcon` / `formatBytes` — file display utilities
- `queryKeys` — all key factory functions return correct arrays

**`src/__tests__/ConnectionStatusBar.test.jsx`**
- All 6 connection states render correctly
- Retry button appears/hides based on state
- `onRetry` callback fires on click
- Accessibility: `role="status"`, `aria-live="polite"`, `aria-hidden` on icon
- CSS classes applied per state

**`src/__tests__/socketEvents.test.js`**
- `shouldProcess` guard: self-skip, deduplication, version check
- LRU seen-set eviction after MAX_SEEN items
- `lastSeqId` tracking (highest value wins)
- Edge cases: null envelope, missing projectId, same seqId across projects

---

## CI

The GitHub Actions workflow (`.github/workflows/ci.yml`) runs:

1. **Backend job**: syntax check → migrate test DB → unit tests → integration tests → upload coverage
2. **Frontend job**: install → test → build

Both jobs run on every push to `main`/`develop` and on all pull requests.

---

## Test Architecture Decisions

**Why real DB for integration tests?**
Mocking `pg` would hide SQL bugs, constraint violations, and transaction behaviour — exactly the things most likely to cause production incidents. Each test suite calls `resetDb()` in `beforeEach` to truncate all tables, so tests are fully isolated.

**Why `--runInBand`?**
Integration tests share a single PostgreSQL database. Running suites in parallel would cause race conditions on `TRUNCATE`. Serial execution is slower but deterministic.

**Why no global test setup file?**
Each integration test file sets its own `process.env` and `jest.mock()` calls before requiring any app modules. This makes each file self-contained and avoids subtle ordering bugs from shared global state.

**CSRF in tests**
State-changing requests need a valid CSRF token. Tests call `GET /auth/csrf-token` to get a token + cookie, then attach both to subsequent requests. This tests the real CSRF flow, not a mock.

---

## Bugs Found and Fixed by Tests

Writing the tests uncovered two real production bugs that were silently broken:

### Bug 1 — `activityController.js`: `seqId` used before declaration in `approveEntry`

The `approveEntry` function used `seqId` in the `emitTypedEvent` call without ever declaring it. This would have thrown `ReferenceError: seqId is not defined` the first time any client approved an activity entry in production. The test `"client can approve an activity entry (regression: seqId bug)"` directly reproduces this.

**Fix:** Added `const seqId = Date.now();` before the emit call in `activityController.js`.

### Bug 2 — `submissionController.js`: First submission on a new project blocked with 409

The resubmit guard `if (proj.review_status === "pending")` was too broad. Every new project has `review_status = 'pending'` as its default — so the very first submission attempt on any project was rejected with "A submission is already under review." The guard was only meant to block resubmission while an existing submission is under review.

**Fix:** Changed the guard to `if (proj.review_status === "pending" && proj.submitted_at !== null)` — only blocks when a submission has already been made. Also added `submitted_at` to the `FOR UPDATE` query in `submissionController.js`.
