# Phase 4 — Realtime Reliability Architecture Plan

> **Status:** Architecture audit only. No implementation.
> **Audited commit state:** Post Phase 3 (security hardening, cookie auth, CSRF, Redis adapter enabled)

---

## Table of Contents

1. [Problem Analysis](#1-problem-analysis)
2. [Current Architecture Weaknesses](#2-current-architecture-weaknesses)
3. [Event Flow Analysis](#3-event-flow-analysis)
4. [Scalability Concerns](#4-scalability-concerns)
5. [Reliability Concerns](#5-reliability-concerns)
6. [Typed Event System Design](#6-typed-event-system-design)
7. [Socket Rate Limiting Design](#7-socket-rate-limiting-design)
8. [Typing Indicator Optimization](#8-typing-indicator-optimization)
9. [Connection State System](#9-connection-state-system)
10. [Missed-Event Recovery System](#10-missed-event-recovery-system)
11. [Critical Event Acknowledgements](#11-critical-event-acknowledgements)
12. [Observability Design](#12-observability-design)
13. [Testing Strategy](#13-testing-strategy)
14. [Implementation Order](#14-implementation-order)
15. [Migration Strategy](#15-migration-strategy)
16. [Rollback Safety](#16-rollback-safety)
17. [Risk Assessment](#17-risk-assessment)
18. [Architecture Diagrams](#18-architecture-diagrams)

---

## 1. Problem Analysis

### 1.1 The Core Problem: Generic Invalidation Events

The current realtime layer uses a **broadcast-then-refetch** pattern. Every meaningful backend mutation emits one or more of these generic socket events:

```
workspace_activity_updated  { projectId, eventType }
submission_history_updated  (no payload)
project_submitted           { type, projectId, message }
project_reviewed            { type, projectId, reviewStatus, feedback, message }
new_message                 { ...messageRow, sender_username }
notification                { ...notificationRow }
activity_entry_updated      { eventId, approval_status, approval_feedback, actioned_at? }
activity_comment_added      { eventId, comment }
typing                      { userId, username, typing }
```

When a client receives `workspace_activity_updated`, the frontend calls:

```js
queryClient.invalidateQueries({ queryKey: queryKeys.client.activity() });
queryClient.invalidateQueries({ queryKey: queryKeys.client.stats() });
queryClient.invalidateQueries({ queryKey: queryKeys.developer.stats() });
```

This triggers a **full HTTP refetch from PostgreSQL** for every connected client in the project room, regardless of whether the data they hold is actually stale for them.

### 1.2 Concrete Failure Scenarios Found in Audit

| Scenario | Current Behavior | Impact |
|---|---|---|
| Developer submits project | 3 events emitted: `project_submitted`, `submission_history_updated`, `workspace_activity_updated` | 3 separate invalidation cascades, up to 3 DB round-trips per connected client |
| Client approves activity entry | `activity_entry_updated` carries the new status — but `workspace_activity_updated` is also emitted from `reviewProject` | Double invalidation on the same data |
| Typing event | No rate limiting, no debounce enforcement server-side | A fast typist can flood the room with 10+ events/second |
| Reconnect | `refetchOnReconnect: true` in queryClient causes ALL mounted queries to refetch simultaneously | Reconnect storm on the DB |
| `submission_history_updated` | Carries zero payload | Frontend cannot do selective update; must always refetch |
| Redis outage | `redisClient` is a duplicate of `pubClient`; if Redis drops, rate limiting silently falls back to in-memory per-instance | Rate limits become per-instance, not global |
| Multi-tab | Each tab has its own socket connection; all tabs receive the same events and all trigger independent invalidations | N tabs = N DB queries for the same data |
| No ack on critical events | `project_submitted`, `bid_accepted` have no delivery confirmation | Silent loss during network blip is undetectable |

---

## 2. Current Architecture Weaknesses

### 2.1 Backend Socket Layer (`backend/sockets/index.js`)

- **No rate limiting on any socket event.** The `typing` handler does zero throttling. A malicious or buggy client can emit thousands of events per second.
- **No event versioning.** There is no `v` or `schema_version` field on any emitted payload. A future payload change is a silent breaking change for connected clients.
- **No acknowledgement callbacks.** All `socket.emit()` calls are fire-and-forget. There is no way to know if the client received a critical event.
- **`join_project` does a DB query on every call** with no caching. A client that reconnects frequently hammers the DB just to re-join rooms.
- **No disconnect strategy for abusive clients.** There is no mechanism to forcibly disconnect a socket that is misbehaving.
- **`register` event is redundant.** The server already joins `user_{id}` on connection. The `register` handler is dead code that adds confusion.

### 2.2 Frontend Socket Layer (`frontend/src/context/SocketContext.jsx`)

- **No connection state machine.** The context exposes only the raw socket instance. Components have no structured way to know if the socket is `connected`, `reconnecting`, or `degraded`.
- **No missed-event recovery.** On reconnect, `refetchOnReconnect: true` in `queryClient.js` triggers a full refetch of all mounted queries simultaneously. There is no cursor-based replay.
- **Global handlers only cover user-level events.** Project-room events (`project_submitted`, `project_reviewed`) are handled in `SocketContext` but invalidate broad keys (`client.activity()`, `developer.stats()`). There is no per-project selective update.
- **No offline queue.** Mutations attempted while disconnected fail silently or error. There is no pending-action queue.
- **No typing stop timeout.** If a user closes the tab while typing, the `typing: true` state persists for other users indefinitely.

### 2.3 Query Invalidation Strategy (`frontend/src/lib/queryClient.js`)

- **`refetchOnReconnect: true` is dangerous at scale.** With 10 mounted queries and 50 concurrent users reconnecting after a server restart, this generates 500 simultaneous DB queries.
- **`staleTime: 30s` is inconsistent with socket-driven freshness.** If the socket is working, 30s stale time is too long for activity feeds. If the socket is down, 30s is too short and causes unnecessary polling.
- **No query-level staleness differentiation.** Messages need near-zero stale time. Stats can tolerate 60s. All queries use the same 30s default.

### 2.4 Event Naming Inconsistency

Current events mix naming conventions:

```
workspace_activity_updated   ← snake_case, generic
project_submitted            ← snake_case, specific
activity_entry_updated       ← snake_case, specific
new_message                  ← snake_case, specific
notification                 ← bare noun
typing                       ← bare verb
```

There is no namespace, no version prefix, no category grouping. Adding a new event requires searching all frontend files to find where it might be consumed.

---

## 3. Event Flow Analysis

### 3.1 Current Event Flow (Problematic)

```
[Client Action: Submit Project]
        │
        ▼
[HTTP POST /projects/:id/submit]
        │
        ├─► DB: INSERT project_submissions
        ├─► DB: UPDATE projects (review_status = 'pending')
        ├─► DB: UPDATE project_events (resolve revisions)
        ├─► DB: INSERT project_events (submission_added)
        │
        ├─► socket.emit("project_submitted", { type, projectId, message })
        ├─► socket.emit("submission_history_updated")          ← no payload
        └─► socket.emit("workspace_activity_updated", { projectId, eventType })
                │
                ▼
        [SocketContext.jsx — handleProjectEvent]
                │
                ├─► invalidateQueries(client.activity())       ← full refetch
                ├─► invalidateQueries(client.stats())          ← full refetch
                └─► invalidateQueries(developer.stats())       ← full refetch

        [Workspace components — local handlers]
                │
                ├─► invalidateQueries(projects.submissions(id)) ← full refetch
                └─► invalidateQueries(projects.activity(id))    ← full refetch
```

**Result:** 1 user action → up to 5 DB queries per connected client.

### 3.2 Target Event Flow (Phase 4)

```
[Client Action: Submit Project]
        │
        ▼
[HTTP POST /projects/:id/submit]
        │
        ├─► DB writes (same as now)
        │
        └─► socket.emit("submission:created", {
                v: 1,
                projectId: 42,
                submissionId: 99,
                repoLink: "...",
                demoLink: "...",
                submittedAt: "2026-05-21T...",
                actorId: 7,
                actorName: "Jane Dev",
                seqId: 1716300000000   ← monotonic cursor for replay
            })
                │
                ▼
        [SocketContext.jsx — typed handler]
                │
                ├─► queryClient.setQueryData(                  ← NO refetch
                │     queryKeys.projects.submissions(42),
                │     (old) => appendSubmission(old, payload)
                │   )
                │
                ├─► queryClient.setQueryData(                  ← NO refetch
                │     queryKeys.projects.detail(42),
                │     (old) => { ...old, review_status: 'pending', submission_count: old.submission_count + 1 }
                │   )
                │
                └─► invalidateQueries(client.stats())          ← 1 refetch only
                    (stats cannot be derived from payload alone)
```

**Result:** 1 user action → 0–1 DB queries per connected client (stats only when mounted).

---

## 4. Scalability Concerns

### 4.1 DB Query Amplification

With the current generic invalidation pattern, DB load scales as:

```
DB queries per event = (mounted queries invalidated) × (connected clients in room)
```

For a project with 2 users (client + developer), each with 3 mounted queries, a single submission generates **6 DB queries**. At 100 concurrent active projects, a burst of submissions generates **600 simultaneous DB queries** from socket events alone.

### 4.2 Reconnect Storm

`refetchOnReconnect: true` means a server restart or Redis failover causes every connected client to simultaneously refetch all mounted queries. With 200 connected users each having 5 mounted queries, a restart generates **1,000 simultaneous DB queries** within the first 2 seconds.

**Mitigation needed:** Staggered reconnect with jitter + cursor-based replay instead of full refetch.

### 4.3 Typing Event Volume

The `typing` event has no server-side throttle. A user typing at 60 WPM generates roughly 5 keystrokes/second. With no debounce enforcement:

```
5 events/sec × 2 users × 100 active projects = 1,000 socket events/sec
```

Each event is broadcast to the project room. With Redis adapter, each event crosses the pub/sub bus. At scale this is significant Redis I/O for zero-value data.

### 4.4 Redis Adapter Single Point of Failure

The current Redis setup uses `pubClient.duplicate()` for both `subClient` and `redisClient`. If the Redis connection drops:
- Socket.IO falls back to in-memory adapter (events stop crossing instances)
- Rate limiting falls back to per-instance in-memory (limits become ineffective)
- Both failures happen silently with no observable signal to the frontend

### 4.5 Multi-Tab Amplification

Each browser tab opens an independent socket connection. A user with 3 tabs open in the same project room receives each event 3 times and triggers 3 independent query invalidations. TanStack Query deduplicates in-flight requests but the invalidation signals still fire 3 times.

---

## 5. Reliability Concerns

### 5.1 Silent Event Loss

Socket.IO operates over WebSocket with no application-level delivery guarantee. If the client's connection drops between the server emitting an event and the client receiving it, the event is lost. The current system has no mechanism to detect or recover from this.

**Affected critical events:** `project_submitted`, `bid_accepted`, `project_reviewed`, `activity_entry_updated`.

### 5.2 Out-of-Order Events

Network conditions can cause events to arrive out of order. Example:

```
Server emits at T=0: submission:created  { submissionId: 5, review_status: 'pending' }
Server emits at T=1: project:reviewed    { review_status: 'approved' }

Client receives:     project:reviewed    first (T=1 arrives before T=0)
                     submission:created  second
```

The client's optimistic state update from `project:reviewed` gets overwritten by the stale data in `submission:created`. The UI shows `review_status: 'pending'` when it should show `'approved'`.

### 5.3 Duplicate Events

Idempotency middleware exists on HTTP routes but not on socket events. A client that reconnects mid-operation may receive the same event twice (once before disconnect, once replayed after reconnect). Without deduplication, this causes double-appends to lists and double-increments to counters.

### 5.4 Stale Client After Long Disconnect

A client that was disconnected for longer than the replay window (e.g. laptop sleep) has no way to know how many events it missed. The current `refetchOnReconnect: true` handles this by refetching everything, but it is a blunt instrument that causes the reconnect storm described in §4.2.

### 5.5 Auth Token Expiry During Active Session

The JWT has a finite expiry. If the token expires while the socket is connected, the socket remains connected (the auth middleware only runs on handshake). However, subsequent HTTP requests will fail with 401. The frontend has no mechanism to signal this state to the socket layer or show a "session expired" UI.

### 5.6 `submission_history_updated` Carries No Payload

This event is emitted on `addSubmissionNote`, `updateSubmission`, and `deleteSubmission`. Because it carries no payload, the frontend cannot do a selective cache update. It must always trigger a full refetch of the submissions list. For delete operations, the frontend cannot even optimistically remove the item.

---

## 6. Typed Event System Design

### 6.1 Event Naming Convention

All events adopt a `domain:action` naming scheme with a version envelope.

**Format:** `{domain}:{action}`

**Domains:** `submission`, `approval`, `revision`, `comment`, `typing`, `notification`, `project`, `activity`, `message`, `bid`, `system`

**Actions:** `created`, `updated`, `deleted`, `approved`, `requested`, `resolved`, `accepted`, `rejected`, `sent`, `read`, `started`, `stopped`

**Full event registry:**

```
submission:created          submission:updated          submission:deleted
submission:note_added       submission:note_updated     submission:note_deleted

approval:granted            approval:pending

revision:requested          revision:resolved

comment:added

typing:started              typing:stopped

notification:received

project:status_changed      project:urgent_set          project:urgent_cleared
project:completed           project:assigned

activity:entry_updated

message:sent                message:read

bid:placed                  bid:accepted                bid:rejected

system:reconnect_ack        system:replay_batch         system:auth_expired
```

### 6.2 Payload Schema Strategy

Every event payload follows a standard envelope:

```json
{
  "v": 1,
  "event": "submission:created",
  "seqId": 1716300000000,
  "projectId": 42,
  "actorId": 7,
  "actorName": "Jane Dev",
  "actorRole": "developer",
  "ts": "2026-05-21T10:00:00.000Z",
  "data": { /* event-specific fields */ }
}
```

**Envelope fields:**

| Field | Type | Purpose |
|---|---|---|
| `v` | integer | Schema version. Clients ignore events with unknown `v`. |
| `event` | string | Canonical event name. Replaces the Socket.IO event name as the discriminator. |
| `seqId` | integer | Monotonic sequence ID (Unix ms from DB `created_at`). Used for ordering and replay cursor. |
| `projectId` | integer | Scope. Null for user-level events. |
| `actorId` | integer | Who triggered the event. |
| `actorName` | string | Display name at time of event. |
| `actorRole` | string | `client` or `developer`. |
| `ts` | ISO string | Server timestamp. |
| `data` | object | Event-specific payload (see below). |

### 6.3 Per-Event Data Payloads

**`submission:created`**
```json
{
  "submissionId": 99,
  "repoLink": "https://github.com/...",
  "demoLink": "https://...",
  "notes": "...",
  "submittedAt": "2026-05-21T..."
}
```

**`submission:note_added`**
```json
{ "submissionId": 100, "notes": "Progress update text", "createdAt": "..." }
```

**`submission:note_updated`**
```json
{ "submissionId": 100, "notes": "Updated text" }
```

**`submission:note_deleted`**
```json
{ "submissionId": 100 }
```

**`approval:granted`**
```json
{ "eventId": 55, "feedback": "Looks great", "actionedAt": "..." }
```

**`revision:requested`**
```json
{ "eventId": 55, "feedback": "Please fix the login flow", "actionedAt": null }
```

**`revision:resolved`**
```json
{ "eventId": 55, "actionedAt": "..." }
```

**`comment:added`**
```json
{ "eventId": 55, "comment": { "id": 12, "body": "...", "authorName": "...", "createdAt": "..." } }
```

**`project:status_changed`**
```json
{ "status": "completed", "reviewStatus": "approved", "feedback": null }
```

**`project:assigned`**
```json
{ "developerId": 7, "developerName": "Jane Dev", "bidId": 33, "amount": 1500 }
```

**`project:urgent_set` / `project:urgent_cleared`**
```json
{ "isUrgent": true }
```

**`bid:accepted`**
```json
{ "bidId": 33, "developerId": 7, "amount": 1500 }
```

**`message:sent`**
```json
{ "messageId": 201, "body": "...", "senderId": 7, "senderUsername": "janedev", "createdAt": "..." }
```

**`typing:started` / `typing:stopped`**
```json
{ "userId": 7, "username": "janedev" }
```

**`notification:received`**
```json
{ "id": 88, "type": "bid_accepted", "message": "...", "isRead": false, "meta": {}, "createdAt": "..." }
```

**`system:auth_expired`**
```json
{ "reason": "token_expired" }
```

**`system:replay_batch`**
```json
{ "events": [ /* array of envelope objects */ ], "hasMore": false }
```

### 6.4 Selective State Update Strategy

The goal is to eliminate DB refetches for events where the payload contains all the data needed to update the cache in place. Refetches are reserved for events where derived aggregates (counts, stats) cannot be computed from the payload alone.

**Decision matrix:**

| Event | Cache Action | Refetch Required? |
|---|---|---|
| `submission:created` | `setQueryData` — prepend to submissions list, increment `submission_count` on project detail, set `review_status: 'pending'` | No — unless stats panel is mounted |
| `submission:note_added` | `setQueryData` — append note to submissions list | No |
| `submission:note_updated` | `setQueryData` — find by `submissionId`, replace `notes` | No |
| `submission:note_deleted` | `setQueryData` — filter out by `submissionId` | No |
| `approval:granted` | `setQueryData` — update `approval_status`, `approval_feedback`, `actioned_at` on activity entry | No |
| `revision:requested` | `setQueryData` — same as above | No |
| `revision:resolved` | `setQueryData` — same as above | No |
| `comment:added` | `setQueryData` — append comment, increment `comment_count` on activity entry | No |
| `project:status_changed` | `setQueryData` — update `status`, `review_status`, `feedback` on project detail | No |
| `project:assigned` | `setQueryData` — update `assigned_developer_id`, `status: 'active'` | No |
| `project:urgent_set/cleared` | `setQueryData` — update `is_urgent` on project detail | No |
| `bid:accepted` | `setQueryData` — update bid status in bids list | `invalidate` developer.stats (earnings changed) |
| `message:sent` | `setQueryData` — append message to messages list | `invalidate` messages.unreadCount |
| `notification:received` | `setQueryData` — prepend to notifications list | No |
| `activity:entry_updated` | `setQueryData` — find entry by `eventId`, apply delta | No |
| `project:completed` | `setQueryData` — update project detail | `invalidate` client.stats, developer.stats |
| `typing:started/stopped` | Local component state only — never touches query cache | No |

**When refetches are still necessary:**
- Stats queries (`client.stats`, `developer.stats`) — these are aggregates that cannot be derived from individual event payloads without re-running the SQL
- After reconnect when `seqId` gap is too large for replay (> replay window)
- When the client receives an event with an unknown `v` (schema version mismatch)
- When `setQueryData` fails because the target query is not in cache (component not mounted)

### 6.5 Optimistic Consistency Strategy

For mutations initiated by the current user, the frontend already has the data before the socket event arrives. The strategy is:

1. **Mutation fires** → optimistic update applied immediately via `useMutation.onMutate`
2. **HTTP response arrives** → replace optimistic data with server-confirmed data (includes DB-generated fields like `id`, `created_at`)
3. **Socket event arrives** → check if `actorId === currentUser.id`; if yes, skip the `setQueryData` (the HTTP response already applied the canonical update)
4. **Other clients** → receive the socket event and apply `setQueryData` normally

This prevents the "double-apply" problem where the actor's own cache gets updated twice (once from HTTP response, once from socket event).

### 6.6 Event Versioning Strategy

- All events carry `v: 1` initially
- When a payload schema changes in a breaking way (field removed, type changed), increment to `v: 2`
- The frontend handler checks `v` before processing:
  ```
  if (payload.v > KNOWN_VERSION) → fall back to invalidateQueries (safe degradation)
  if (payload.v < KNOWN_VERSION) → discard (stale event from old server instance during rolling deploy)
  ```
- Non-breaking additions (new optional fields) do not require a version bump
- Version is checked per-event-type, not globally

### 6.7 Reconciliation Strategy

When the frontend detects it may have missed events (reconnect, tab focus after long idle), it requests a replay. If the replay window is exceeded or unavailable, it falls back to full invalidation of only the queries that are currently mounted and visible, not all queries in the cache.

**Reconciliation trigger conditions:**
- Socket `reconnect` event fires
- Tab becomes visible after `document.hidden` was true for > 30 seconds
- `system:replay_batch` arrives with `hasMore: true` (more events than batch limit)

### 6.8 Handling Out-of-Order Events

Each event carries a `seqId` (Unix ms timestamp from the DB row's `created_at`). The frontend maintains a per-project `lastSeqId` in a ref. On receiving an event:

```
if (event.seqId <= lastSeqId) → duplicate or out-of-order → discard
if (event.seqId > lastSeqId + LARGE_GAP_THRESHOLD) → gap detected → trigger reconciliation
else → apply update, set lastSeqId = event.seqId
```

`LARGE_GAP_THRESHOLD` is a configurable constant (suggested: 5000ms). A gap larger than this suggests missed events rather than normal out-of-order delivery.

### 6.9 Handling Duplicate Events

Each event envelope carries a unique `seqId`. The frontend maintains a small LRU set of recently seen `seqId` values per project (suggested size: 50). Before processing any event, check if `seqId` is in the seen set. If yes, discard. If no, add to set and process.

This handles the reconnect-replay duplicate scenario without requiring server-side deduplication state.

---

## 7. Socket Rate Limiting Design

### 7.1 Architecture Overview

Rate limiting for socket events must be **distributed** (Redis-backed) to be effective across multiple server instances. The design uses a **sliding window counter** per `(userId, eventType)` key stored in Redis.

```
Key format:  rl:socket:{userId}:{eventType}:{windowBucket}
Value:       integer count
TTL:         window duration
```

`windowBucket` is `Math.floor(Date.now() / windowMs)` — this creates a fixed-window bucket that auto-expires via Redis TTL. For a sliding window approximation, check both the current and previous bucket and weight them by elapsed time within the current window.

### 7.2 Per-Event Thresholds

| Event | Window | Max Count | Burst Allowance | Action on Exceed |
|---|---|---|---|---|
| `typing` | 1s | 3 | 5 (first 200ms) | Silently drop |
| `message` (via HTTP) | 60s | 20 | 3 | HTTP 429 |
| `join_project` | 60s | 10 | 2 | Disconnect after 3 violations |
| `leave_project` | 60s | 10 | 2 | Silently drop |
| `register` | 60s | 5 | 1 | Silently drop |
| Any unknown event | 10s | 5 | 0 | Disconnect immediately |
| Reconnect attempts | 60s | 10 | 3 | Delay with exponential backoff |

**Rationale for typing threshold (3/sec):** A fast typist at 120 WPM generates ~2 keystrokes/second. 3/sec allows for burst without penalising legitimate users. The frontend debounce (see §8) will reduce this further in practice.

**Rationale for message threshold (20/min):** This is a professional marketplace, not a chat app. 20 messages per minute is generous for legitimate use. The limit is on the HTTP route, not the socket, since messages go through `POST /projects/:id/messages`.

### 7.3 Redis-Backed Implementation Strategy

The rate limiter runs inside the Socket.IO event handler, before the event is processed:

```
socket.on("typing", async (data) => {
  const allowed = await checkRateLimit(socket.user.id, "typing", { window: 1000, max: 3 });
  if (!allowed) return;  // silently drop
  // ... process event
});
```

`checkRateLimit` uses a Redis Lua script for atomic increment-and-check to avoid race conditions between the read and write:

```lua
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local ttl = tonumber(ARGV[2])
local current = redis.call("INCR", key)
if current == 1 then redis.call("EXPIRE", key, ttl) end
if current > limit then return 0 end
return 1
```

This is a single round-trip to Redis per event, atomic, and auto-expiring.

### 7.4 In-Memory Fallback

When Redis is unavailable, the rate limiter falls back to a per-process in-memory Map with the same key structure. This is less accurate across instances but prevents the server from crashing or disabling rate limiting entirely. The fallback is logged as a warning so it is observable.

### 7.5 Burst Handling

For events with a burst allowance, use a **token bucket** variant: the first N events in a window are allowed without counting against the limit. This is implemented by storing the window start time alongside the count and applying the burst window only if `Date.now() - windowStart < BURST_WINDOW_MS`.

### 7.6 Abuse Prevention and Disconnect Strategy

**Violation tracking:** Each socket maintains a `violations` counter in memory (not Redis — it is per-connection state). On each rate limit exceed:

```
violations++
if violations >= DISCONNECT_THRESHOLD:
  socket.emit("system:rate_limit_exceeded", { reason: "abuse_detected" })
  socket.disconnect(true)
  logger.warn("Socket disconnected for abuse", { userId, socketId, violations })
```

**Disconnect thresholds by event type:**

| Event | Violations Before Disconnect |
|---|---|
| `typing` | Never disconnect (silently drop) |
| `join_project` | 5 |
| Unknown events | 3 |
| Any event after Redis confirms abuse | 1 |

**IP-level ban (future):** For repeated reconnect-and-abuse patterns, the disconnect strategy should be extended to track `(userId, IP)` pairs in Redis with a TTL ban. This is out of scope for Phase 4 but the architecture should leave a hook for it.

### 7.7 Memory Safety

The in-memory fallback Map must be bounded. Use an LRU eviction policy with a max size of 10,000 entries. Each entry is `{ count, windowStart }` — approximately 64 bytes. Max memory: ~640KB, negligible.

The per-socket `violations` counter is cleaned up automatically on `socket.on("disconnect")`.

---

## 8. Typing Indicator Optimization

### 8.1 Current Problem

The current `typing` handler is a raw passthrough:

```js
socket.on("typing", ({ projectId, typing }) => {
  socket.to(`project_${id}`).emit("typing", { userId, username, typing });
});
```

There is no debounce, no stop-typing timeout, no deduplication, and no protection against a client that emits `typing: true` and then disconnects without emitting `typing: false`.

### 8.2 Frontend Debounce Strategy

The frontend should implement a **leading + trailing debounce** pattern:

```
User starts typing:
  → Emit typing:started immediately (leading edge)
  → Start/reset a 2000ms debounce timer

User continues typing:
  → Each keystroke resets the timer
  → No additional events emitted during the debounce window

User stops typing (2000ms of silence):
  → Debounce fires → emit typing:stopped (trailing edge)

User sends message:
  → Cancel debounce timer
  → Emit typing:stopped immediately (the messageController already does this server-side via HTTP, but the frontend should also clear local state)
```

**Debounce timing rationale:**
- 2000ms trailing debounce: covers natural pauses between words without false "stopped" signals
- Leading edge emit: ensures the other user sees the indicator immediately, not after a 2-second delay
- This reduces typing events from ~5/sec to at most 1 event per 2 seconds per user (the leading edge), plus 1 stop event

### 8.3 Stop-Typing Behavior

Three triggers must emit `typing:stopped`:

1. Debounce timer fires (2000ms of no keystrokes)
2. Message is sent (user action)
3. Component unmounts (user navigates away)
4. Socket disconnects (server-side cleanup — see §8.5)

The frontend must handle all four cases. Cases 1–3 are frontend responsibility. Case 4 is server responsibility.

### 8.4 Multi-User Typing Handling

The frontend maintains a `typingUsers` Map keyed by `userId`:

```
typingUsers: Map<userId, { username, timeoutId }>
```

On receiving `typing:started`:
- Add/update entry in map
- Clear any existing timeout for that userId
- Set a new 4000ms timeout (2× the debounce window) that auto-removes the user if no `typing:stopped` arrives

On receiving `typing:stopped`:
- Clear the timeout
- Remove the entry from the map

**Why 4000ms server-side timeout vs 2000ms debounce:** The server-side timeout is a safety net for the case where `typing:stopped` is lost (network drop). It is set to 2× the debounce window to avoid false negatives during normal typing pauses.

### 8.5 Stale Typing Cleanup (Server-Side)

When a socket disconnects, the server must emit `typing:stopped` on behalf of the disconnected user to all rooms they were in:

```
socket.on("disconnect", () => {
  // For each project room the socket was in:
  for (const room of socket.rooms) {
    if (room.startsWith("project_")) {
      const projectId = room.replace("project_", "");
      socket.to(room).emit("typing:stopped", {
        v: 1, event: "typing:stopped",
        projectId: Number(projectId),
        actorId: socket.user.id,
        actorName: socket.user.username,
        seqId: Date.now(), ts: new Date().toISOString(), data: {}
      });
    }
  }
});
```

This requires tracking which project rooms a socket has joined. The current implementation does not track this — it is a required addition.

### 8.6 Race Conditions During Reconnect

If a user is typing when their socket disconnects and reconnects:

1. Disconnect fires → server emits `typing:stopped` for them (§8.5)
2. Client reconnects → client's debounce timer may still be running
3. Client resumes typing → emits `typing:started` again

This is the correct behavior. The only edge case is if the reconnect happens faster than the server's `typing:stopped` broadcast reaches other clients. In that case, other clients may briefly see the user as "not typing" before seeing them as "typing" again. This is acceptable — it is a cosmetic flicker, not a data integrity issue.

### 8.7 Minimizing Socket Spam

Combined effect of all optimizations:

| Scenario | Before | After |
|---|---|---|
| User types for 10 seconds | ~50 events | 1 `typing:started` + 1 `typing:stopped` = 2 events |
| User types, pauses 3s, types again | ~50 events | 2 `typing:started` + 1 `typing:stopped` = 3 events |
| User sends message | ~50 events + 1 stop | 1 `typing:started` + 1 `typing:stopped` = 2 events |
| User closes tab while typing | Stale indicator forever | 1 `typing:stopped` from server on disconnect |

---

## 9. Connection State System

### 9.1 State Machine Definition

The connection state is a finite state machine with 6 states:

```
                    ┌─────────────────────────────────────────┐
                    │                                         │
              auth valid                               token expired
                    │                                         │
    ┌───────────────▼──────────────┐              ┌──────────▼──────────┐
    │         CONNECTED            │              │    AUTH_EXPIRED      │
    │  socket.connected = true     │              │  show re-login UI    │
    └───────────────┬──────────────┘              └─────────────────────┘
                    │
              network drop
                    │
    ┌───────────────▼──────────────┐
    │        RECONNECTING          │◄──── retry attempt (with jitter)
    │  show reconnecting banner    │
    └───────────────┬──────────────┘
                    │
         reconnect_failed (attempt > 3)
                    │
    ┌───────────────▼──────────────┐
    │          DEGRADED            │
    │  show degraded warning       │
    │  mutations disabled          │
    └───────────────┬──────────────┘
                    │
         reconnect_failed (attempt > 10)
                    │
    ┌───────────────▼──────────────┐
    │        DISCONNECTED          │
    │  show offline banner         │
    │  queue mutations             │
    └───────────────┬──────────────┘
                    │
              manual retry / network restored
                    │
    ┌───────────────▼──────────────┐
    │    TRANSPORT_FALLBACK        │
    │  WebSocket failed, using     │
    │  long-polling fallback       │
    └──────────────────────────────┘
```

**State definitions:**

| State | Condition | User-Visible Behavior |
|---|---|---|
| `CONNECTED` | `socket.connected === true` | Normal operation, no UI indicator |
| `RECONNECTING` | Socket fired `disconnect`, attempting reconnect, attempt ≤ 3 | Subtle "Reconnecting…" banner, mutations still allowed (optimistic) |
| `DEGRADED` | Reconnect attempt 4–10 | Yellow warning banner, mutations show pending state |
| `DISCONNECTED` | Reconnect attempt > 10 or explicit disconnect | Red offline banner, mutations queued or blocked |
| `AUTH_EXPIRED` | Server emits `system:auth_expired` or HTTP 401 received | Modal prompt to re-authenticate, socket disconnected |
| `TRANSPORT_FALLBACK` | WebSocket upgrade failed, Socket.IO fell back to polling | Informational indicator only, functionality preserved |

### 9.2 State Propagation Architecture

Connection state lives in `SocketContext` and is exposed via a dedicated hook:

```
SocketContext value shape:
{
  socket: Socket,
  connectionState: 'connected' | 'reconnecting' | 'degraded' | 'disconnected' | 'auth_expired' | 'transport_fallback',
  reconnectAttempt: number,
  lastConnectedAt: Date | null,
  lastDisconnectedAt: Date | null,
}
```

**Global context:** `SocketContext` holds the state. All components that need connection awareness consume `useConnectionState()` — a derived hook that returns only the state fields, not the socket instance. This prevents unnecessary re-renders in components that only need the socket for event emission.

**Workspace-level indicators:** The `DeveloperWorkspace` and `ClientWorkspace` components subscribe to `useConnectionState()` and render a `ConnectionStatusBar` component that maps state to UI. The bar is only rendered when state is not `CONNECTED`.

**Retry UX:** In `RECONNECTING` state, show a non-blocking toast with attempt count. In `DEGRADED` state, show a persistent banner with a "Retry now" button that calls `socket.connect()`. In `DISCONNECTED` state, show a full-width banner with "You are offline. Changes will sync when reconnected."

### 9.3 Reconnect Configuration

Socket.IO client reconnect options to set on the singleton:

```js
{
  reconnection: true,
  reconnectionAttempts: 15,
  reconnectionDelay: 1000,        // start at 1s
  reconnectionDelayMax: 30000,    // cap at 30s
  randomizationFactor: 0.5,       // ±50% jitter to prevent thundering herd
}
```

**Why jitter matters:** Without jitter, all clients that disconnected at the same time (e.g. server restart) will attempt to reconnect at exactly the same intervals, creating a thundering herd. With 50% jitter, a 1000ms base delay becomes 500–1500ms, spreading the reconnect load.

### 9.4 Offline Queue Considerations

For Phase 4, the offline queue is **scoped to typing state only** — no mutation queuing. The rationale:

- Queuing mutations (messages, submissions) while offline introduces complex conflict resolution
- The existing HTTP layer already handles retries via TanStack Query's `retry: 1`
- Users expect mutations to fail visibly when offline, not silently queue

The one exception is **typing state**: when the socket reconnects, the frontend should re-emit `typing:started` if the user is currently in the typing state (debounce timer is active). This is a simple boolean check, not a queue.

**Future consideration:** A proper offline queue for messages (similar to WhatsApp's pending message indicator) is a Phase 5+ feature.

---

## 10. Missed-Event Recovery System

### 10.1 The Problem

When a client reconnects after a disconnect, it has missed all events emitted during the gap. The current system handles this with `refetchOnReconnect: true`, which refetches all mounted queries. This is correct but expensive.

The goal is to replace full refetches with **targeted replay** for short gaps, and fall back to selective invalidation for long gaps.

### 10.2 Cursor / Timestamp Recovery Design

Each client tracks a `lastSeqId` per project room. This is the `seqId` of the last successfully processed event. On reconnect, the client sends this cursor to the server:

```
Client → Server:  socket.emit("join_project", { projectId: 42, lastSeqId: 1716299990000 })
Server → Client:  socket.emit("system:replay_batch", { events: [...], hasMore: false })
```

The server queries `project_events` for all events with `created_at > lastSeqId_as_timestamp` up to a configurable replay window.

### 10.3 Replay Window Design

**Recommended replay window:** 5 minutes (300 seconds)

**Rationale:**
- Covers typical reconnect scenarios: network blip, laptop sleep/wake, mobile background
- Beyond 5 minutes, the number of events could be large enough that a full refetch is cheaper than processing a large replay batch
- Redis stream retention (if used) should match this window

**Replay window exceeded behavior:**
```
if (gap > REPLAY_WINDOW_MS || eventCount > MAX_REPLAY_EVENTS):
  → server sends system:replay_batch with { events: [], hasMore: false, fallback: true }
  → client falls back to invalidateQueries for all mounted project queries
  → this is equivalent to current behavior but only for the affected project
```

`MAX_REPLAY_EVENTS` recommended: 100 events per project per reconnect.

### 10.4 Redis Stream vs DB Query Tradeoff

**Option A: Query PostgreSQL `project_events` table**

Pros:
- No additional infrastructure
- Events are already persisted in `project_events`
- Consistent with the existing data model

Cons:
- Adds DB load on every reconnect
- `project_events` does not cover all event types (messages, notifications are in separate tables)
- Requires a composite index on `(project_id, created_at)` for performance

**Option B: Redis Streams**

Pros:
- Sub-millisecond replay from memory
- Built-in consumer group semantics
- Natural TTL via `MAXLEN` trim

Cons:
- Additional Redis data structure to maintain
- Events must be written to Redis stream AND PostgreSQL (dual write)
- Redis is already used for pub/sub adapter — adding streams increases Redis coupling
- If Redis is unavailable, replay is unavailable (falls back to full refetch)

**Recommendation: Option A (PostgreSQL) for Phase 4**

The `project_events` table already exists and covers the most important event types. The missing event types (messages, notifications) can be handled by targeted invalidation of those specific query keys rather than replay. A composite index on `(project_id, created_at DESC)` makes the replay query fast.

Redis Streams can be evaluated in Phase 5 if replay latency becomes a measured problem.

### 10.5 Replay Event Ordering

Events in the replay batch are ordered by `seqId` ascending (oldest first). The client processes them in order, applying `setQueryData` updates sequentially. The `lastSeqId` is updated after each event is processed, not after the batch completes, so a crash mid-batch does not cause re-processing of already-applied events on the next reconnect.

### 10.6 Duplicate Prevention in Replay

The client's LRU seen-set (§6.9) handles duplicates within a session. For cross-session duplicates (e.g. the same event replayed on two consecutive reconnects), the `seqId` check (`if seqId <= lastSeqId → discard`) is sufficient.

### 10.7 Stale Client Reconciliation

A client is considered "stale" if:
- `gap > REPLAY_WINDOW_MS` (missed too many events for replay)
- The client's `lastSeqId` is 0 (first connection, no cursor)
- The server cannot find the cursor in `project_events` (data was purged)

In all stale cases, the client receives `system:replay_batch` with `fallback: true` and performs targeted invalidation:

```
queryClient.invalidateQueries({ queryKey: queryKeys.projects.detail(projectId) })
queryClient.invalidateQueries({ queryKey: queryKeys.projects.activity(projectId) })
queryClient.invalidateQueries({ queryKey: queryKeys.projects.submissions(projectId) })
queryClient.invalidateQueries({ queryKey: queryKeys.projects.messages(projectId) })
```

This is 4 targeted queries instead of the current "invalidate everything" approach.

### 10.8 Server Memory Constraints

The replay query runs against PostgreSQL, not server memory. The server does not buffer events in memory. The only server-side memory cost is the Socket.IO room membership map, which is unchanged.

The `project_events` table should have a retention policy (e.g. archive events older than 90 days) to prevent unbounded growth. This is a separate concern from the replay window.

### 10.9 Recovery Batching

The replay batch is sent as a single `system:replay_batch` event with an array of event envelopes. The client processes the batch synchronously (no async gaps between events) to prevent interleaving with live events that may arrive during processing.

If `hasMore: true`, the client requests the next page:
```
socket.emit("replay_next", { projectId, afterSeqId: lastProcessedSeqId })
```

Maximum batch size: 50 events. This keeps the payload under 50KB for typical event sizes.

---

## 11. Critical Event Acknowledgements

### 11.1 Which Events Need Acknowledgement

Not all events require acknowledgement. The cost of ack tracking (server memory, round-trip latency) is only justified for events where silent loss has a meaningful business impact.

**Requires acknowledgement:**

| Event | Why |
|---|---|
| `submission:created` | Developer needs confirmation the client received the submission notification |
| `approval:granted` | Developer needs to know the approval was delivered (triggers project completion flow) |
| `revision:requested` | Developer needs to know revision feedback was delivered |
| `bid:accepted` | Developer's primary success event — must not be silently lost |
| `project:status_changed` (to completed) | Both parties need confirmation |
| `message:sent` | Standard message delivery confirmation |

**Does NOT require acknowledgement:**

| Event | Why |
|---|---|
| `typing:started/stopped` | Ephemeral, loss is cosmetically acceptable |
| `notification:received` | Notifications are persisted in DB; user can fetch them on next load |
| `comment:added` | Non-critical; user can refresh activity feed |
| `activity:entry_updated` | Non-critical status update |
| `project:urgent_set/cleared` | Informational; visible on next page load |

### 11.2 Acknowledgement Architecture

Socket.IO supports acknowledgement callbacks natively:

```js
// Server emits with ack callback
socket.emit("submission:created", payload, (ack) => {
  if (ack?.received) {
    clearTimeout(ackTimeout);
    logger.debug("submission:created ack received", { socketId: socket.id });
  }
});

// Client acknowledges
socket.on("submission:created", (payload, callback) => {
  processEvent(payload);
  callback({ received: true });
});
```

### 11.3 Ack Timeout and Retry Behavior

```
ACK_TIMEOUT_MS = 5000  (5 seconds)

On emit:
  1. Store { eventId, payload, attempts, emittedAt } in a per-socket pending-ack Map
  2. Set a 5s timeout
  3. If ack received before timeout → remove from pending Map
  4. If timeout fires:
     a. attempts++
     b. If attempts < MAX_RETRY (3) → re-emit with same payload
     c. If attempts >= MAX_RETRY → log warning, mark as undelivered
        → server stores undelivered event in DB for next-login delivery
```

**Next-login delivery:** Undelivered critical events are stored in a `pending_deliveries` table (or as a flag on the notification row). On the client's next socket connection, the server queries for pending deliveries and emits them before the client joins any rooms.

### 11.4 Exactly-Once vs At-Least-Once Semantics

**Recommendation: At-least-once with client-side deduplication**

Exactly-once delivery requires distributed coordination (two-phase commit or idempotency tokens tracked in Redis) that adds significant complexity. At-least-once is simpler and sufficient when combined with the client-side `seqId` deduplication (§6.9).

The practical guarantee is:
- Critical events will be delivered at least once
- The client will process each event at most once (deduplication)
- Combined effect: effectively exactly-once from the user's perspective

### 11.5 Frontend Pending States

For events that require ack, the frontend shows a pending indicator until the ack is confirmed via the HTTP response (not the socket ack). The socket ack is a delivery confirmation, not a processing confirmation. The HTTP response is the authoritative confirmation.

**Example flow for message send:**
```
1. User clicks Send
2. Mutation fires → message appears with "Sending…" indicator (optimistic)
3. HTTP 201 received → indicator changes to sent checkmark
4. socket:message:sent received by other party → their UI updates
5. (Optional) Read receipt: socket:message:read received → double checkmark
```

### 11.6 Retry UI

For mutations that fail (HTTP error, not socket), the frontend shows a "Failed to send — Retry" inline action. This is handled by TanStack Query's mutation error state and is not specific to Phase 4. Phase 4 adds the socket-level delivery confirmation layer on top.

### 11.7 Failure Reconciliation

If a critical event is marked as undelivered after MAX_RETRY attempts:

1. Server logs the failure with `userId`, `eventType`, `projectId`, `seqId`
2. Server stores the event payload in a `pending_socket_deliveries` table
3. On next connection from that `userId`, server queries the table and re-emits
4. Client processes via normal deduplication (seqId check prevents double-apply)
5. Server deletes the row after successful ack

This table needs a TTL cleanup job — rows older than 7 days are deleted (the event is too stale to be useful).

---

## 12. Observability Design

### 12.1 Socket Metrics to Collect

All metrics should be emitted to the existing logger and optionally to a metrics sink (Prometheus, Datadog, etc.). For Phase 4, structured log lines are sufficient.

**Connection metrics:**
```
socket_connected_total          counter   { userId, transport }
socket_disconnected_total       counter   { userId, reason }
socket_reconnect_attempt_total  counter   { userId, attempt }
socket_active_connections       gauge     (sampled every 30s)
socket_rooms_per_socket         histogram { socketId }
```

**Event throughput metrics:**
```
socket_event_emitted_total      counter   { event, direction: 'in'|'out' }
socket_event_dropped_total      counter   { event, reason: 'rate_limit'|'auth'|'invalid' }
socket_event_processing_ms      histogram { event }
```

**Ack metrics:**
```
socket_ack_received_total       counter   { event }
socket_ack_timeout_total        counter   { event }
socket_ack_latency_ms           histogram { event }
socket_pending_delivery_total   gauge     (undelivered critical events in DB)
```

**Reconnect and recovery metrics:**
```
socket_reconnect_success_total  counter   { userId }
socket_replay_requested_total   counter   { projectId }
socket_replay_events_sent       histogram { projectId }  (events per replay batch)
socket_replay_fallback_total    counter   { reason: 'gap_too_large'|'no_cursor' }
```

**Rate limiting metrics:**
```
socket_rate_limit_hit_total     counter   { userId, event }
socket_abuse_disconnect_total   counter   { userId }
socket_redis_fallback_active    gauge     (1 if using in-memory fallback, 0 if Redis)
```

### 12.2 Redis Adapter Monitoring

The Redis adapter failure is currently silent. Add explicit monitoring:

```
redis_adapter_status            gauge     { client: 'pub'|'sub' }  (1=connected, 0=disconnected)
redis_adapter_reconnect_total   counter   { client }
redis_command_latency_ms        histogram { command }
```

On Redis disconnect, emit a `system:degraded` log at WARN level with the reason. This should trigger an alert in production.

### 12.3 Dropped Event Monitoring

Events dropped by rate limiting should be logged at DEBUG level (not WARN — they are expected). Events dropped due to auth failure or invalid payload should be logged at WARN level. Events that fail to emit (socket error) should be logged at ERROR level.

### 12.4 Structured Log Format

All socket-related log lines should include:

```json
{
  "level": "info",
  "msg": "socket_event_emitted",
  "socketId": "abc123",
  "userId": 7,
  "event": "submission:created",
  "projectId": 42,
  "seqId": 1716300000000,
  "durationMs": 2,
  "ts": "2026-05-21T10:00:00.000Z"
}
```

This enables log-based alerting on event throughput, latency spikes, and error rates without requiring a separate metrics pipeline.

### 12.5 Frontend Observability

The frontend should log connection state transitions to the browser console in development and to a structured error boundary in production:

```
[SocketContext] state: connected → reconnecting (attempt 1, reason: transport close)
[SocketContext] state: reconnecting → connected (gap: 1240ms, replayed: 3 events)
[SocketContext] state: reconnecting → degraded (attempt 4)
```

In production, connection state transitions should be reported to Sentry (already integrated) as breadcrumbs, not errors. Only `AUTH_EXPIRED` and `DISCONNECTED` (after all retries) should be reported as Sentry events.

---

## 13. Testing Strategy

### 13.1 Reconnect Storm Testing

**Scenario:** 50 clients disconnect simultaneously (simulating server restart) and reconnect within a 5-second window.

**Test approach:**
1. Spin up test server with Redis adapter enabled
2. Connect 50 Socket.IO test clients, each joined to a different project room
3. Force-close the server's HTTP listener (simulates restart)
4. Measure: time to full reconnection, DB query count during reconnect window, Redis command count
5. Assert: DB queries during reconnect ≤ (connected clients × mounted queries per client × 1.2 buffer)
6. Assert: No client ends up in DISCONNECTED state after 30 seconds

**Tools:** `socket.io-client` in Node.js test scripts, `pg_stat_activity` for DB query monitoring, Redis `MONITOR` for Redis command counting.

### 13.2 Duplicate Event Testing

**Scenario:** Server emits the same event twice (simulating a retry after ack timeout).

**Test approach:**
1. Connect a test client
2. Intercept the socket emit and call it twice with the same payload and `seqId`
3. Assert: The query cache is updated exactly once (not twice)
4. Assert: List lengths are correct (no duplicate entries)
5. Assert: `lastSeqId` is updated correctly

### 13.3 Packet Loss Simulation

**Scenario:** 20% of socket events are dropped between server and client.

**Test approach:**
1. Use a proxy (e.g. `toxiproxy`) between test client and server
2. Configure 20% packet loss on the WebSocket connection
3. Run a sequence of 20 events
4. Assert: All critical events (submission, approval, bid) are eventually delivered (via ack retry)
5. Assert: Non-critical events (typing) are not retried
6. Assert: Client state is consistent with server state after 30 seconds

### 13.4 Socket Disconnect Testing

**Scenario:** Client disconnects mid-operation (e.g. during a submission flow).

**Test approach:**
1. Client starts a submission (HTTP POST in flight)
2. Disconnect the socket before the server emits `submission:created`
3. Client reconnects
4. Assert: Client receives `submission:created` via replay batch
5. Assert: UI reflects the submitted state

### 13.5 Redis Outage Testing

**Scenario:** Redis becomes unavailable while the server is running.

**Test approach:**
1. Start server with Redis adapter enabled
2. Connect 3 clients across 2 server instances
3. Kill Redis
4. Assert: Server logs Redis disconnect at WARN level
5. Assert: Socket.IO falls back to in-memory adapter (events only reach clients on the same instance)
6. Assert: Rate limiting falls back to in-memory (logged as warning)
7. Assert: No server crash, no unhandled promise rejection
8. Restore Redis
9. Assert: Adapter reconnects automatically, cross-instance events resume

### 13.6 Race Condition Testing

**Scenario:** Two clients simultaneously perform conflicting operations (e.g. both try to accept the same bid).

**Test approach:**
1. Create a project with 2 bids
2. Two clients simultaneously call `POST /accept-bid/:bidId` for different bids
3. Assert: Only one bid is accepted (DB transaction + FOR UPDATE lock)
4. Assert: The losing client receives an appropriate error response
5. Assert: Socket events reflect the correct final state
6. Assert: No duplicate `bid:accepted` events emitted

### 13.7 Multi-Tab Behavior Testing

**Scenario:** Same user has 3 tabs open in the same project workspace.

**Test approach:**
1. Open 3 Socket.IO connections with the same auth cookie (same userId)
2. Trigger a `submission:created` event from another user
3. Assert: All 3 tabs receive the event
4. Assert: TanStack Query deduplicates the refetch (only 1 HTTP request, not 3)
5. Assert: All 3 tabs show the same updated UI state

**Note:** TanStack Query's deduplication only works if all tabs share the same `queryClient` instance. In a standard React app, each tab has its own `queryClient`. This is a known limitation — multi-tab cache sharing requires BroadcastChannel integration (Phase 5+). For Phase 4, assert that each tab makes at most 1 DB query per event (not 0).

### 13.8 Delayed Acknowledgement Testing

**Scenario:** Client is slow to acknowledge (simulating a slow device).

**Test approach:**
1. Intercept the client's ack callback and delay it by 6 seconds (> ACK_TIMEOUT_MS of 5s)
2. Assert: Server retries the event after 5 seconds
3. Assert: Client receives the event twice
4. Assert: Client deduplicates and processes it only once
5. Assert: Server logs the ack timeout at DEBUG level

### 13.9 Server Restart Testing

**Scenario:** Server restarts with clients connected.

**Test approach:**
1. Connect 10 clients, each with a known `lastSeqId`
2. Emit 5 events to each project room
3. Restart the server
4. Assert: All clients reconnect within 30 seconds
5. Assert: Each client receives a `system:replay_batch` with the 5 missed events
6. Assert: Client state is consistent with server state after replay

### 13.10 Rate Limit Testing

**Scenario:** Client sends typing events at 20/second (far above the 3/second limit).

**Test approach:**
1. Connect a test client
2. Emit `typing:started` 20 times in 1 second
3. Assert: Server processes at most 3 events (drops the rest)
4. Assert: No error is returned to the client (silent drop)
5. Assert: After 3 violations of a higher-threshold event, client is disconnected
6. Assert: Redis rate limit key has the correct count and TTL

### 13.11 Edge Cases

| Edge Case | Expected Behavior |
|---|---|
| Event arrives with `v: 2` (unknown version) | Client falls back to `invalidateQueries`, logs warning |
| `seqId` is 0 or null | Treated as "no cursor", full reconciliation triggered |
| Replay batch contains events for a project the client is not in | Events are discarded (projectId check) |
| Client emits `join_project` for a project they are not authorized for | Server silently ignores (no room join, no error) |
| `typing:started` received from self (echo) | Discarded (actorId === currentUser.id check) |
| Server emits event to empty room | No-op, no error |
| Redis key collision between rate limit and other Redis usage | Prevented by key prefix `rl:socket:` namespace |
| `pending_socket_deliveries` table grows unbounded | TTL cleanup job deletes rows older than 7 days |
| Client sends `replay_next` for a project they left | Server checks room membership before replying |
| Auth token expires mid-session | Server emits `system:auth_expired`, client shows re-login modal |

---

## 14. Implementation Order

### Priority Classification

- **P0 — Critical path:** Blocks other steps or fixes active reliability bugs
- **P1 — High value:** Significant DB load reduction or UX improvement
- **P2 — Medium value:** Reliability improvement, no immediate user impact
- **P3 — Low value:** Observability and polish

### Step-by-Step Execution Order

---

#### Step 1 — Typed Event Infrastructure (Backend)
**Priority:** P0 | **Complexity:** Medium | **Breaking:** No (additive)

Create a central `socketEvents.js` module in `backend/sockets/` that defines all event names as constants and provides an `emitTypedEvent(io, room, eventName, data)` helper that wraps the payload in the standard envelope (§6.2). No existing emit calls are changed yet — this is purely additive infrastructure.

**Dependencies:** None
**Estimated effort:** 0.5 days

---

#### Step 2 — Socket Rate Limiter (Backend)
**Priority:** P0 | **Complexity:** Medium | **Breaking:** No

Implement the Redis-backed rate limiter (§7) as a standalone `socketRateLimiter.js` module. Wire it into the `typing` handler first (highest volume, lowest risk). Add the in-memory fallback. Add violation tracking and disconnect logic.

**Dependencies:** Step 1 (uses the same Redis client already in `config/redis.js`)
**Estimated effort:** 1 day

---

#### Step 3 — Migrate `typing` to Typed Events + Optimization (Backend + Frontend)
**Priority:** P0 | **Complexity:** Low | **Breaking:** Yes (event name changes)

Replace `typing` event with `typing:started` and `typing:stopped`. Add server-side disconnect cleanup (§8.5). Add frontend debounce (§8.2) and `typingUsers` Map (§8.4). This is the first breaking event name change — requires coordinated deploy.

**Dependencies:** Steps 1, 2
**Estimated effort:** 1 day

---

#### Step 4 — Connection State Machine (Frontend)
**Priority:** P1 | **Complexity:** Medium | **Breaking:** No

Add the 6-state connection state machine to `SocketContext`. Expose `useConnectionState()` hook. Add `ConnectionStatusBar` component. Configure reconnect jitter on the socket singleton. This is purely additive — no existing behavior changes.

**Dependencies:** None (can be done in parallel with Steps 1–3)
**Estimated effort:** 1 day

---

#### Step 5 — Migrate `submission_history_updated` to Typed Events (Backend + Frontend)
**Priority:** P1 | **Complexity:** Medium | **Breaking:** Yes

Replace `submission_history_updated` (no payload) with `submission:created`, `submission:note_added`, `submission:note_updated`, `submission:note_deleted`. Add full payloads. Update frontend handlers to use `setQueryData` instead of `invalidateQueries`.

**Dependencies:** Step 1
**Estimated effort:** 1.5 days

---

#### Step 6 — Migrate `workspace_activity_updated` to Typed Events (Backend + Frontend)
**Priority:** P1 | **Complexity:** High | **Breaking:** Yes

This is the highest-impact migration. Replace all `workspace_activity_updated` emits across `submissionController`, `bidController`, `projectController`, `activityController` with specific typed events. Update all frontend handlers. This step eliminates the majority of unnecessary DB refetches.

**Affected controllers:** `submissionController`, `bidController`, `projectController`, `activityController`
**Affected frontend:** `SocketContext`, workspace components

**Dependencies:** Steps 1, 5
**Estimated effort:** 2 days

---

#### Step 7 — Migrate `project_submitted` and `project_reviewed` (Backend + Frontend)
**Priority:** P1 | **Complexity:** Medium | **Breaking:** Yes

Replace `project_submitted` with `submission:created` (already done in Step 5) and `project_reviewed` with `approval:granted` or `revision:requested`. Update `SocketContext` global handlers to use `setQueryData`.

**Dependencies:** Steps 1, 5, 6
**Estimated effort:** 1 day

---

#### Step 8 — Migrate `activity_entry_updated` and `activity_comment_added` (Backend + Frontend)
**Priority:** P1 | **Complexity:** Low | **Breaking:** Yes

These events already carry good payloads. Wrap them in the standard envelope, rename to `approval:granted`, `revision:requested`, `revision:resolved`, `comment:added`. Update frontend handlers.

**Dependencies:** Step 1
**Estimated effort:** 0.5 days

---

#### Step 9 — Migrate `new_message` and `notification` (Backend + Frontend)
**Priority:** P1 | **Complexity:** Low | **Breaking:** Yes

Rename `new_message` → `message:sent`, `notification` → `notification:received`. Both already carry full payloads. Add `setQueryData` for messages list. Notification handler already does `invalidateQueries` — upgrade to `setQueryData` prepend.

**Dependencies:** Step 1
**Estimated effort:** 0.5 days

---

#### Step 10 — `seqId` and Deduplication Infrastructure (Backend + Frontend)
**Priority:** P1 | **Complexity:** Medium | **Breaking:** No

Add `seqId` to all event envelopes (use `Date.now()` at emit time as a pragmatic approximation; use DB `created_at` epoch ms for events that have a DB row). Add the LRU seen-set on the frontend. Add `lastSeqId` tracking per project in `SocketContext`.

**Dependencies:** Steps 5–9 (all events must be on the new envelope format first)
**Estimated effort:** 1 day

---

#### Step 11 — Missed-Event Recovery / Replay System (Backend + Frontend)
**Priority:** P2 | **Complexity:** High | **Breaking:** No

Add the `join_project` cursor parameter. Add the replay query against `project_events`. Add the `system:replay_batch` emit. Add the `replay_next` handler. Add the composite index on `(project_id, created_at DESC)`. Update frontend `join_project` emit to include `lastSeqId`. Add replay batch processing in `SocketContext`.

**Dependencies:** Step 10
**Estimated effort:** 2 days

---

#### Step 12 — Critical Event Acknowledgements (Backend + Frontend)
**Priority:** P2 | **Complexity:** High | **Breaking:** No

Add ack callbacks to the 6 critical events (§11.1). Add the pending-ack Map on the server. Add the `pending_socket_deliveries` table migration. Add next-login delivery on connect. Add the TTL cleanup job.

**Dependencies:** Steps 5–9 (events must be on typed format before adding acks)
**Estimated effort:** 2 days

---

#### Step 13 — `refetchOnReconnect` Strategy Update (Frontend)
**Priority:** P2 | **Complexity:** Low | **Breaking:** No

Change `refetchOnReconnect` from `true` to `false` in `queryClient.js`. Reconnect-triggered refetches are now handled by the replay system (Step 11). Add per-query overrides for queries that genuinely need reconnect refetch (e.g. stats).

**Dependencies:** Step 11 (replay must be working before disabling refetchOnReconnect)
**Estimated effort:** 0.5 days

---

#### Step 14 — Observability Instrumentation (Backend + Frontend)
**Priority:** P3 | **Complexity:** Low | **Breaking:** No

Add structured log lines for all socket metrics (§12). Add Sentry breadcrumbs for connection state transitions. Add Redis adapter health monitoring.

**Dependencies:** All previous steps
**Estimated effort:** 1 day

---

#### Step 15 — `pending_socket_deliveries` Cleanup Job (Backend)
**Priority:** P3 | **Complexity:** Low | **Breaking:** No

Add a scheduled job (cron or `setInterval`) that deletes `pending_socket_deliveries` rows older than 7 days. Can use `pg-cron` or a simple Node.js interval.

**Dependencies:** Step 12
**Estimated effort:** 0.5 days

---

## 15. Migration Strategy

### 15.1 Dual-Emit Transition Period

Steps 3 and 5–9 involve renaming socket events. A direct rename is a breaking change — old frontend code listening for `typing` will stop working the moment the backend emits `typing:started`. To avoid a hard cutover, use a **dual-emit** strategy during the transition:

```js
// During transition: emit both old and new event names
socket.to(room).emit("typing", legacyPayload);                    // old — remove after cutover
socket.to(room).emit("typing:started", typedEnvelopePayload);     // new
```

The frontend migrates handlers one event at a time. Once all frontend handlers for an event are on the new name, the old emit is removed from the backend.

**Transition window:** Each event should have a maximum 1-sprint dual-emit window. Do not leave dual-emit in place indefinitely — it doubles event volume.

### 15.2 Feature Flag Strategy

Wrap the typed event system behind a server-side feature flag:

```
TYPED_EVENTS_ENABLED=true   (env var)
```

When `false`, the server uses the old generic events. When `true`, it uses typed events. This allows instant rollback without a code deploy (just restart with the flag off).

The flag should be checked once at server startup and cached — not on every emit.

### 15.3 Database Migration Sequence

New tables/indexes required (in order):

```sql
-- Step 11: Replay index
CREATE INDEX CONCURRENTLY idx_project_events_project_created
  ON project_events (project_id, created_at DESC);

-- Step 12: Pending deliveries table
CREATE TABLE pending_socket_deliveries (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_name    TEXT NOT NULL,
  payload       JSONB NOT NULL,
  seq_id        BIGINT NOT NULL,
  attempts      INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at    TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '7 days'
);
CREATE INDEX idx_psd_user_id ON pending_socket_deliveries (user_id) WHERE expires_at > NOW();
```

Both migrations are non-destructive and can be run without downtime. `CREATE INDEX CONCURRENTLY` does not lock the table.

### 15.4 Coordinated Deploy Order

For each breaking event rename (Steps 3, 5–9):

```
1. Deploy backend with dual-emit (old + new event names)
2. Deploy frontend with new event name handlers (old handlers still present as fallback)
3. Verify in staging: both old and new handlers fire correctly
4. Remove old handlers from frontend → deploy
5. Remove old emit from backend → deploy
6. Verify: only new events in production logs
```

This 5-step process ensures zero downtime and instant rollback at any step.

### 15.5 Rollback Safety

**Step-level rollback:** Each step is independently reversible:
- Backend: revert the controller change, redeploy
- Frontend: revert the SocketContext handler, redeploy
- DB migrations: all are additive (no column drops, no table drops) — no rollback needed

**Feature flag rollback:** Set `TYPED_EVENTS_ENABLED=false` and restart. All events revert to the old generic format. Frontend falls back to `invalidateQueries` (the old behavior is preserved in the codebase until Phase 4 is fully stable).

**Redis rate limiter rollback:** Set `SOCKET_RATE_LIMIT_ENABLED=false`. The rate limiter middleware becomes a no-op passthrough.

**Replay system rollback:** Set `SOCKET_REPLAY_ENABLED=false`. The `join_project` handler ignores the `lastSeqId` parameter and does not emit `system:replay_batch`. The frontend falls back to `refetchOnReconnect: true`.

### 15.6 Breaking vs Non-Breaking Changes Summary

| Step | Breaking? | Notes |
|---|---|---|
| 1 — Typed event infrastructure | No | Additive only |
| 2 — Rate limiter | No | New behavior, no API change |
| 3 — typing events | Yes | Event name change; use dual-emit |
| 4 — Connection state machine | No | Frontend only, additive |
| 5 — submission events | Yes | Event name + payload change; use dual-emit |
| 6 — workspace_activity_updated | Yes | Highest risk; use dual-emit + feature flag |
| 7 — project_submitted/reviewed | Yes | Use dual-emit |
| 8 — activity_entry_updated | Yes | Use dual-emit |
| 9 — new_message/notification | Yes | Use dual-emit |
| 10 — seqId + deduplication | No | Additive envelope fields |
| 11 — Replay system | No | New socket events, no old events removed |
| 12 — Ack system | No | Additive callback parameter |
| 13 — refetchOnReconnect | No | Frontend config change |
| 14 — Observability | No | Additive logging |
| 15 — Cleanup job | No | New background process |

---

## 16. Rollback Safety

### 16.1 Rollback Plan Per Risk Level

**Low risk (Steps 1, 2, 4, 10, 13, 14, 15):**
- Revert the specific file change and redeploy
- No DB changes to undo
- No user-visible impact during rollback

**Medium risk (Steps 3, 5, 7, 8, 9):**
- Dual-emit means the old event is still being emitted during transition
- Rollback = remove the new event emit from backend, remove the new handler from frontend
- Old behavior is fully restored
- Window: rollback must happen before the old emit is removed (Step 4 of the deploy sequence)

**High risk (Step 6 — workspace_activity_updated migration):**
- This touches 4 controllers and the core invalidation logic
- Rollback plan:
  1. Set `TYPED_EVENTS_ENABLED=false` (instant, no deploy)
  2. If feature flag is not sufficient, revert the 4 controller files and redeploy
  3. The old `workspace_activity_updated` emit is preserved in the codebase until Step 6 is confirmed stable in production for 1 week

**High risk (Step 11 — Replay system):**
- If replay sends incorrect events, clients could show stale or wrong data
- Rollback plan:
  1. Set `SOCKET_REPLAY_ENABLED=false` (instant)
  2. Frontend falls back to `refetchOnReconnect: true` (already the current behavior)
  3. No data corruption possible — replay is read-only

**High risk (Step 12 — Ack system + pending_deliveries table):**
- If the ack retry loop has a bug, it could spam clients with duplicate events
- Rollback plan:
  1. Set `SOCKET_ACK_ENABLED=false` — disables ack callbacks, reverts to fire-and-forget
  2. The `pending_socket_deliveries` table remains but is not written to
  3. No data loss — events already delivered are unaffected

### 16.2 Staging Validation Checklist

Before each step goes to production:

- [ ] All existing socket event tests pass
- [ ] New event names appear in staging logs
- [ ] Old event names still appear (dual-emit period)
- [ ] DB query count per event is ≤ expected (measure with `pg_stat_activity`)
- [ ] No new Sentry errors in staging for 24 hours
- [ ] Rate limiter correctly drops events above threshold
- [ ] Reconnect test: disconnect and reconnect, verify state is consistent
- [ ] Multi-tab test: open 2 tabs, trigger event, verify both update

---

## 17. Risk Assessment

### 17.1 Risk Matrix

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Dual-emit causes 2× event volume temporarily | High | Low | Expected and bounded; remove old emit within 1 sprint |
| `setQueryData` update function has a bug, corrupts cache | Medium | High | Unit test every updater function; fallback to `invalidateQueries` on error |
| Redis rate limiter adds latency to every socket event | Medium | Medium | Lua script is single round-trip; benchmark before enabling in prod |
| Replay query is slow on large `project_events` tables | Low | Medium | `CREATE INDEX CONCURRENTLY` before enabling replay; add query timeout |
| Ack retry loop creates event storm on slow client | Low | High | MAX_RETRY=3 hard cap; exponential backoff between retries |
| Feature flag `TYPED_EVENTS_ENABLED` not set in prod | Medium | High | Default to `true` in code; require explicit `false` to disable |
| `pending_socket_deliveries` table grows unbounded | Low | Medium | TTL cleanup job (Step 15); add table size alert |
| seqId collision (two events at same millisecond) | Low | Low | seqId is used for ordering, not uniqueness; duplicates handled by seen-set |
| Rolling deploy: old server + new frontend mismatch | Medium | Medium | Dual-emit covers this; old server emits old events, new frontend handles both |
| `refetchOnReconnect: false` causes stale data if replay fails | Low | Medium | Replay failure falls back to targeted `invalidateQueries`; not silent |

### 17.2 Dependency Map

```
Step 1 (typed event infra)
  └─► Step 2 (rate limiter)
        └─► Step 3 (typing events)
  └─► Step 5 (submission events)
        └─► Step 6 (workspace_activity_updated)
              └─► Step 7 (project_submitted/reviewed)
  └─► Step 8 (activity_entry_updated)
  └─► Step 9 (new_message/notification)

Step 4 (connection state) — independent, can run in parallel

Steps 5,6,7,8,9 must all complete before:
  └─► Step 10 (seqId + deduplication)
        └─► Step 11 (replay system)
              └─► Step 13 (refetchOnReconnect: false)

Step 12 (ack system) — depends on Steps 5–9 (typed events)
  └─► Step 15 (cleanup job)

Step 14 (observability) — depends on all previous steps
```

### 17.3 Estimated Total Effort

| Phase | Steps | Estimated Effort |
|---|---|---|
| Foundation | 1, 2, 4 | 2.5 days |
| Event Migration | 3, 5, 6, 7, 8, 9 | 6 days |
| Reliability | 10, 11, 12, 13 | 5.5 days |
| Observability & Cleanup | 14, 15 | 1.5 days |
| **Total** | **15 steps** | **~15.5 days** |

Parallelizable: Steps 1–4 can run in parallel (2 developers). Steps 5–9 can be split across developers once Step 1 is done.

---

## 18. Architecture Diagrams

### 18.1 Current Architecture (Problem State)

```
┌─────────────────────────────────────────────────────────────────┐
│                        BACKEND                                  │
│                                                                 │
│  Controller                                                     │
│  ─────────                                                      │
│  submitProject()                                                │
│    │                                                            │
│    ├─► io.emit("project_submitted",    { type, projectId })     │
│    ├─► io.emit("submission_history_updated")   ← NO PAYLOAD     │
│    └─► io.emit("workspace_activity_updated",   { projectId,     │
│                                                  eventType })   │
└──────────────────────────────┬──────────────────────────────────┘
                               │ Socket.IO (Redis adapter)
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                        FRONTEND                                 │
│                                                                 │
│  SocketContext                                                  │
│  ─────────────                                                  │
│  on("project_submitted")  → invalidate client.activity()        │
│                           → invalidate client.stats()           │
│                           → invalidate developer.stats()        │
│                                                                 │
│  on("workspace_activity_updated")                               │
│    → (handled in workspace components)                          │
│    → invalidate projects.activity(id)                           │
│    → invalidate projects.submissions(id)                        │
│                                                                 │
│  Result: 5 DB queries per event per connected client            │
└─────────────────────────────────────────────────────────────────┘
```

### 18.2 Target Architecture (Phase 4 Complete)

```
┌─────────────────────────────────────────────────────────────────┐
│                        BACKEND                                  │
│                                                                 │
│  socketEvents.js (new)                                          │
│  ──────────────────────                                         │
│  emitTypedEvent(io, room, "submission:created", {               │
│    v:1, seqId, projectId, actorId, actorName, ts,               │
│    data: { submissionId, repoLink, demoLink, submittedAt }       │
│  })                                                             │
│                                                                 │
│  socketRateLimiter.js (new)                                     │
│  ──────────────────────────                                     │
│  Redis Lua script: atomic increment-and-check                   │
│  Per-socket violation counter → disconnect on abuse             │
└──────────────────────────────┬──────────────────────────────────┘
                               │ Socket.IO (Redis adapter)
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                        FRONTEND                                 │
│                                                                 │
│  SocketContext (enhanced)                                       │
│  ─────────────────────────                                      │
│  connectionState: 'connected' | 'reconnecting' | 'degraded'     │
│                 | 'disconnected' | 'auth_expired'               │
│  lastSeqId: Map<projectId, number>                              │
│  seenEvents: Map<projectId, LRUSet<seqId>>                      │
│                                                                 │
│  on("submission:created") →                                     │
│    if seqId in seen → discard                                   │
│    if actorId === me → skip (HTTP response already applied)     │
│    setQueryData(submissions(id), append)          ← NO refetch  │
│    setQueryData(projects.detail(id), update)      ← NO refetch  │
│    invalidate(client.stats())  ← 1 targeted refetch if mounted  │
│                                                                 │
│  on("system:replay_batch") →                                    │
│    process events in seqId order                                │
│    apply setQueryData for each                                  │
│                                                                 │
│  Result: 0–1 DB queries per event per connected client          │
└─────────────────────────────────────────────────────────────────┘
```

### 18.3 Rate Limiter Flow

```
Client emits "typing:started"
        │
        ▼
socketRateLimiter.checkLimit(userId, "typing", { window: 1000, max: 3 })
        │
        ├─► Redis available?
        │     YES → INCR rl:socket:{userId}:typing:{bucket}
        │           count > 3? → return false (drop)
        │           count ≤ 3? → return true (allow)
        │
        │     NO  → in-memory LRU Map fallback
        │           same logic, per-process only
        │
        ├─► allowed = false → silently return, violations++
        │     violations >= threshold? → socket.disconnect(true)
        │
        └─► allowed = true → broadcast to project room
```

### 18.4 Reconnect and Replay Flow

```
Client disconnects (network drop)
        │
        ▼
connectionState → RECONNECTING
Socket.IO reconnect with jitter (1s–30s, ±50%)
        │
        ▼
Socket reconnects → server auth middleware re-validates cookie
        │
        ▼
Client emits: join_project({ projectId: 42, lastSeqId: 1716299990000 })
        │
        ▼
Server queries:
  SELECT * FROM project_events
  WHERE project_id = 42
    AND created_at > to_timestamp(1716299990000 / 1000.0)
  ORDER BY created_at ASC
  LIMIT 50
        │
        ├─► 0 events → no replay needed, connectionState → CONNECTED
        │
        ├─► 1–50 events → emit system:replay_batch({ events, hasMore: false })
        │     client processes batch → setQueryData for each event
        │     connectionState → CONNECTED
        │
        └─► gap > 5 min OR > 100 events →
              emit system:replay_batch({ events: [], fallback: true })
              client → invalidateQueries (targeted, 4 queries)
              connectionState → CONNECTED
```

### 18.5 Typing Indicator Flow (Optimized)

```
User starts typing
        │
        ▼
Frontend: emit typing:started (leading edge)
          start 2000ms debounce timer
        │
User continues typing → reset timer (no new events)
        │
2000ms of silence
        │
        ▼
Frontend: emit typing:stopped (trailing edge)

─────────────────────────────────────────────

Other client receives typing:started
        │
        ▼
typingUsers.set(userId, { username, timeout: setTimeout(4000, remove) })
UI: show "Jane is typing…"
        │
Receives typing:stopped (or 4s timeout fires)
        │
        ▼
typingUsers.delete(userId)
UI: hide typing indicator

─────────────────────────────────────────────

User closes tab while typing
        │
        ▼
Server: socket.on("disconnect") fires
        │
        ▼
Server: for each project room → emit typing:stopped on behalf of user
        │
        ▼
Other clients: receive typing:stopped → hide indicator
```

---

*End of Phase 4 Architecture Plan*

**Document version:** 1.0
**Prepared for:** Implementation planning only — no code written
**Next step:** Review this document, confirm priorities, then begin Step 1
