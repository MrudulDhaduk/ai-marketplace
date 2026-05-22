# PHASE 6 — Frontend Architecture Refactor Plan

> **Status:** Planning only. Nothing in this document is implemented.
> **Prerequisite:** Phases 1–5 complete and stable in production.
> **Goal:** Modernise and modularise the frontend without breaking realtime behaviour, auth flow, React Query caching, or socket replay reliability introduced in Phases 2–5.

---

## Table of Contents

1. [Current Frontend Architecture Audit](#1-current-frontend-architecture-audit)
2. [Vite Migration Strategy](#2-vite-migration-strategy)
3. [Workspace Decomposition Plan](#3-workspace-decomposition-plan)
4. [Route-Level Code Splitting Plan](#4-route-level-code-splitting-plan)
5. [Skeleton Loading Architecture](#5-skeleton-loading-architecture)
6. [Accessibility Refactor Plan](#6-accessibility-refactor-plan)
7. [Responsive Workspace Architecture](#7-responsive-workspace-architecture)
8. [File Download UX Improvements](#8-file-download-ux-improvements)
9. [Risk Analysis](#9-risk-analysis)
10. [Recommended Execution Order](#10-recommended-execution-order)

---

## 1. Current Frontend Architecture Audit

### 1.1 Component Inventory by LOC

| File | LOC | Primary Responsibility |
|------|-----|----------------------|
| `pages/sections/ProjectWorkspace.css` | 1,900 | Shared workspace styles (both workspaces) |
| `pages/sections/DeveloperProjectWorkspace.jsx` | 743 | Developer workspace — upload, submit, feedback, files |
| `pages/sections/ClientProjectWorkspace.jsx` | 723 | Client workspace — review, approve, quick actions, files |
| `context/SocketContext.jsx` | 584 | Socket lifecycle, typed event handlers, cache updates |
| `components/CreateProjectModal.jsx` | 554 | Project creation form |
| `pages/sections/components/SubmissionHistory.jsx` | 487 | Activity timeline + manual notes |
| `components/BidModal.jsx` | 385 | Bid placement form |
| `pages/sections/components/TimelineEventCard.jsx` | 382 | Single timeline event with comments/approval |
| `components/TopBar.jsx` | 324 | Header, notifications dropdown, profile dropdown |
| `pages/sections/ClientMessages.jsx` | 273 | Client chat panel + project picker |
| `pages/sections/DeveloperMessages.jsx` | 282 | Developer chat panel + project picker (near-duplicate) |
| `pages/Dashboard/ClientDashboard.jsx` | 173 | Client dashboard shell + section routing |
| `pages/Dashboard/DeveloperDashboard.jsx` | 160 | Developer dashboard shell + section routing |
| `components/ProjectBidsModal.jsx` | 59 | Thin wrapper around bids list |
| `pages/sections/ClientActivityFeed.jsx` | 103 | Live activity feed sidebar |
| `pages/sections/ProjectFeed.jsx` | 169 | Developer project discovery feed |
| `hooks/useProjectQueries.js` | ~280 | All TanStack Query hooks |
| `context/AuthContext.jsx` | 102 | Auth state, CSRF, session rehydration |
| `lib/api.js` | ~180 | HTTP client, CSRF, silent refresh |


### 1.2 Responsibility Overload — Top Offenders

**`DeveloperProjectWorkspace.jsx` (743 lines)**
Manages: file upload via XHR with progress, drag-and-drop reorder, deliverable form state, submission flow with idempotency key, confirmation modal, tabbed panel (deliverables / files / feedback), progress stepper, socket join/replay, React Query cache invalidation, notification toasts, mark-complete flow. This is 8 distinct responsibilities in one component.

**`ClientProjectWorkspace.jsx` (723 lines)**
Manages: review/approval flow, quick actions (message, request update, urgent flag, reopen), file display, deliverable display, progress stages, developer panel, confirm modal, socket join/replay, React Query cache invalidation, action toasts, new-update banner. This is 7 distinct responsibilities in one component.

**`SocketContext.jsx` (584 lines)**
Manages: connection state machine (6 states), per-project seqId deduplication (LRU), actor self-skip, typed event handlers for 16 event types, React Query cache mutations for all event types, missed-event replay dispatch, user room registration. This is appropriately centralised but the file is large enough to warrant internal organisation into named sections (already partially done with comments).

**`CreateProjectModal.jsx` (554 lines)**
Manages: multi-step form, tag management, budget validation, date validation, API submission, error display. Could be split into form sections but is lower priority than the workspace components.

**`ProjectWorkspace.css` (1,900 lines)**
Single CSS file shared by both workspaces. Contains styles for: workspace header, progress stepper, body layout, review badges, feedback card, quick actions, tabs, inputs, file system, modals, notifications, responsive breakpoints, and all CPW-namespaced client-specific overrides. This needs to be split into per-component CSS modules during decomposition.

### 1.3 Route Entry Points

```
/                    → Home (eager — landing page, must be fast)
/signup              → Signup (eager — auth critical path)
/login               → Login (eager — auth critical path)
/verify-email        → VerifyEmail (eager — email link target)
/dashboard           → Dashboard → ClientDashboard | DeveloperDashboard (lazy candidate)
/profile             → Profile (lazy candidate)
```

There are only 6 routes. The entire dashboard (the heaviest part of the app) is loaded eagerly. No code splitting exists today.

### 1.4 Bundle Bottlenecks

- **No code splitting at all.** Every component, including the full workspace, SocketContext, all modals, and all dashboard sections, is in a single JS bundle.
- **`react-scripts` (CRA) uses Webpack 5** with no route-level splitting configured. The default CRA build does not split vendor chunks intelligently.
- **`ProjectWorkspace.css` (1,900 lines)** is imported by both workspace components, meaning it is always loaded even for users who never open a workspace.
- **`SocketContext.jsx`** imports the socket singleton at module load time, which means the Socket.IO client library is bundled into the main chunk even for unauthenticated users visiting the landing page.
- **`@sentry/react`** is initialised in `sentry.js` which is the first import in `index.js`. This is correct for error tracking but adds to the initial parse cost.
- **No tree-shaking of icon components.** Inline SVG icon functions are defined inside component files (TopBar, SubmissionHistory), which is fine, but some components import entire libraries if any are added later.

### 1.5 Duplicated Logic

| Logic | Duplicated In |
|-------|--------------|
| `timeAgo()` helper | `ClientProjectWorkspace`, `DeveloperProjectWorkspace`, `ClientMessages`, `DeveloperMessages`, `ClientActivityFeed`, `TopBar` — 6 copies |
| `ChatPanel` component | `ClientMessages` and `DeveloperMessages` are near-identical (282 vs 273 lines). The only differences are the project source query (`useClientProjects` vs `useAssignedProjects`) and a `leave_project` emit in the developer version. |
| `ProjectPicker` component | Defined identically in both `ClientMessages` and `DeveloperMessages`. |
| `FILE_ICONS` map | Defined in both `ClientProjectWorkspace` and `DeveloperProjectWorkspace`. |
| `getFileIcon()` / `formatBytes()` | Defined in both workspace components. |
| `formatProjectForCard()` | Defined in `ClientDashboard` — should be a shared utility. |
| Socket join + reconnect pattern | Both workspace components independently call `joinProject(project.id)` and register a `connect` handler for reconnect. This pattern should be a custom hook `useProjectRoom(projectId)`. |
| Loading state rendering | Each section component renders its own ad-hoc loading state (spinner, "Loading…" text, skeleton). No consistent system. |


### 1.6 Accessibility Issues

#### Missing ARIA Labels

| Component | Element | Issue |
|-----------|---------|-------|
| `ClientProjectWorkspace` | `<button className="cpw-icon-btn cpw-copy-btn">` | Label is `title="Copy link"` only — no `aria-label`. `title` is not reliably announced by screen readers. |
| `ClientProjectWorkspace` | Download `<a>` with content `↓` | Arrow character is not meaningful to screen readers. Needs `aria-label="Download {filename}"`. |
| `DeveloperProjectWorkspace` | `<button className="dd-icon-btn" title="Copy">` | Same issue — `title` only, no `aria-label`. |
| `DeveloperProjectWorkspace` | `<a href={repoLink} ... className="dd-icon-btn" title="Open">↗` | Arrow character, no `aria-label`. |
| `DeveloperProjectWorkspace` | `<button className="dd-file-delete">🗑️</button>` | Emoji-only button. Needs `aria-label="Delete {filename}"`. |
| `DeveloperProjectWorkspace` | `<button className="dd-qa-btn">` (Quick Actions grid) | Emoji icons inside buttons have no `aria-hidden="true"` on the emoji span. |
| `DeveloperProjectWorkspace` | `<button className="dd-tab">🚀 Submit` | Emoji not hidden from screen readers. |
| `SubmissionHistory` | `<button className="sh-action-btn sh-action-btn--edit">` | SVG icon button — SVG has no `aria-label` or `title`. |
| `SubmissionHistory` | `<button className="sh-action-btn sh-action-btn--delete">` | Same — SVG icon only. |
| `SubmissionHistory` | `<button className="sh-tab-btn">⚡ Activity` | Emoji not hidden. |
| `TopBar` | Notification `<li>` items | Clickable `<li>` elements are not buttons. Should be `<button>` or have `role="button"` + `tabIndex`. |
| `ClientMessages` / `DeveloperMessages` | `<li className="msg-project-item">` | Clickable list items without `role="button"` or keyboard handler. |
| `ConnectionStatusBar` | `⟳`, `⚠`, `✕` icon spans | `aria-hidden="true"` is present — this is correct. |

#### Emoji-Only Buttons

| Component | Button | Fix Needed |
|-----------|--------|-----------|
| `DeveloperProjectWorkspace` | `🚀 Submit v1` (submit button) | Add `aria-label` or ensure text is screen-reader visible |
| `DeveloperProjectWorkspace` | Quick action buttons: `📤`, `🔗`, `💬`, `🚀` | Emoji spans need `aria-hidden="true"` |
| `ClientProjectWorkspace` | Quick action buttons: `💬`, `📣`, `🚨`, `🔄` | Same |
| `SubmissionHistory` | `⚡ Activity`, `📝 Notes` tab buttons | Emoji spans need `aria-hidden="true"` |
| `ClientActivityFeed` | `Live` badge with `feed-live-dot` | Decorative — fine, but the dot has no accessible label |

#### Keyboard Traps

| Component | Issue |
|-----------|-------|
| `ClientProjectWorkspace` — `ConfirmModal` | Modal has no focus trap. When opened, Tab can escape to background content. No `aria-modal="true"`, no `role="dialog"`, no focus management on open/close. |
| `DeveloperProjectWorkspace` — submit confirm modal | Same issue — `dd-modal-backdrop` has no focus trap, no `role="dialog"`, no `aria-labelledby`. |
| `TopBar` — notification dropdown | Dropdown has no `role="listbox"` or `role="menu"`. Arrow key navigation not implemented. Escape closes it (correct), but Tab does not cycle through items. |
| `TopBar` — profile dropdown | Has `role="menu"` and `aria-expanded` (correct), but items lack `tabIndex` management. Focus does not move into the menu on open. |

#### Modal Focus Problems

Both workspace modals (`ConfirmModal` in CPW, `dd-modal` in DPW) share the same issues:
- No `role="dialog"` or `aria-modal="true"`
- No `aria-labelledby` pointing to the modal title
- Focus is not moved into the modal on open
- Focus is not returned to the trigger button on close
- Background content is not inert while modal is open

#### Dropdown Navigation Issues

- `TopBar` notification list: no keyboard navigation (arrow keys, Home, End)
- `TopBar` profile menu: has `role="menu"` but items lack `role="menuitem"` keyboard behaviour
- `FilterBar` tag dropdown (if any): not audited — needs review during implementation
- `ClientMessages` / `DeveloperMessages` project picker: `<ul>/<li>` pattern with click handlers but no keyboard support

#### Screen Reader Support Gaps

- Progress steppers in both workspaces use visual-only indicators (dot colours, numbers). No `aria-current="step"` on the active step.
- Status badges (`.dd-status`) convey meaning through colour only — no text alternative for colour-blind users (though text labels are present, which partially mitigates this).
- The `PulseDot` component in CPW is purely decorative but has no `aria-hidden="true"`.
- Toast notifications (`.dd-notif`) have `pointer-events: none` and no `role="status"` or `aria-live` region.

### 1.7 Mobile Responsiveness Issues

**Workspace layout (`ProjectWorkspace.css`)**
- The 2-column grid (`grid-template-columns: 1fr 380px`) collapses to single column at `900px`. This is correct.
- Below `700px`, the work summary strip wraps to 2×2 grid. Acceptable.
- Below `600px`, header padding reduces and title font shrinks. Acceptable.
- **Missing:** No mobile navigation for switching between workspace sections. On mobile, the right column (actions, files, deliverables) appears below the left column with no way to jump between them without scrolling.
- **Missing:** The sticky right column (`position: sticky; top: 20px`) becomes `position: static` at `900px` — correct — but there is no mobile tab bar or anchor navigation to reach it.
- **Missing:** The progress stepper overflows horizontally on very small screens (it uses `overflow-x: auto` which works but is not ideal UX).
- **Missing:** The tabbed panel in `DeveloperProjectWorkspace` works on mobile but the tab labels include emoji + text which can wrap awkwardly.

**Dashboard shells**
- `ClientDashboard` and `DeveloperDashboard` use sidebar navigation (`ClientSidebar`, `DevSidebar`). No audit of whether these sidebars collapse on mobile — this needs to be checked during implementation.
- `TopBar` search input and notification/profile controls are not audited for mobile overflow.

**Messages**
- `ClientMessages` / `DeveloperMessages` use a 2-panel layout (sidebar + chat). No responsive breakpoint to stack them vertically on mobile.

**Modals**
- Both workspace modals have `max-width: 380px; width: 100%; padding: 20px` — these should be fine on mobile.
- `CreateProjectModal` (554 lines) has not been audited for mobile layout.

### 1.8 CRA / react-scripts Limitations

| Limitation | Impact |
|-----------|--------|
| **Webpack 5 cold start** | `react-scripts start` takes 15–30s on first run. Vite HMR starts in under 1s. |
| **No native ESM dev server** | CRA bundles everything before serving. Vite serves unbundled ESM in dev, making HMR near-instant. |
| **`REACT_APP_*` env prefix** | All env vars must be prefixed `REACT_APP_`. Vite uses `VITE_`. Migration requires renaming all env vars. Currently only `REACT_APP_API_URL` is used in `api.js`. |
| **No route-level code splitting by default** | CRA does not configure dynamic imports automatically. Must be added manually (same in Vite, but Vite's Rollup handles it more efficiently). |
| **`react-scripts` is in maintenance mode** | CRA has not had a major release since 2022. Security vulnerabilities in its dependency tree are not being patched. |
| **Slow production builds** | Webpack production builds are significantly slower than Vite/Rollup for this project size. |
| **`reportWebVitals.js`** | CRA-specific file. Must be removed or replaced during migration. |
| **`setupTests.js`** | CRA-specific Jest setup. Must be replaced with Vitest config if tests are migrated. |
| **`public/index.html` template** | CRA uses `%PUBLIC_URL%` placeholder. Vite uses `<script type="module" src="/src/main.jsx">` directly in `index.html`. |
| **`process.env.NODE_ENV`** | Used in `index.js` for devtools conditional. Vite uses `import.meta.env.MODE` instead. |

---

## 2. Vite Migration Strategy

> **Do NOT implement yet.** This section is planning only.

### 2.1 Package Migration Plan

**Remove:**
```
react-scripts@5.0.1
```

**Add:**
```
vite@^5.x (latest stable)
@vitejs/plugin-react@^4.x
vite-plugin-svgr@^4.x (if SVG imports are needed)
```

**Update `package.json` scripts:**
```json
{
  "scripts": {
    "start":  "vite",
    "build":  "vite build",
    "preview":"vite preview",
    "test":   "vitest run"
  }
}
```

**Testing migration (optional, separate step):**
- Replace `react-scripts test` (Jest) with `vitest`
- Replace `@testing-library/jest-dom` setup in `setupTests.js` with a Vitest setup file
- This is a separate concern from the Vite migration and should be done independently

### 2.2 react-scripts Removal Strategy

1. Remove `react-scripts` from `dependencies`
2. Remove `eslintConfig` block from `package.json` (CRA-specific ESLint config) — replace with a standalone `.eslintrc.cjs`
3. Remove `browserslist` from `package.json` — move to `.browserslistrc` or keep in `package.json` (Vite reads it)
4. Delete `src/reportWebVitals.js` and its import in `src/index.js`
5. Delete `src/setupTests.js` (or repurpose for Vitest)
6. Move `public/index.html` to the project root (Vite expects `index.html` at root, not in `public/`)
7. Add `<script type="module" src="/src/index.jsx">` to the root `index.html`
8. Remove `%PUBLIC_URL%` references from `index.html` (Vite handles asset paths automatically)

### 2.3 Vite Config Requirements

```js
// vite.config.js (root of frontend/)
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/api':           { target: 'http://localhost:5000', changeOrigin: true },
      '/auth':          { target: 'http://localhost:5000', changeOrigin: true },
      '/projects':      { target: 'http://localhost:5000', changeOrigin: true },
      '/bids':          { target: 'http://localhost:5000', changeOrigin: true },
      '/notifications': { target: 'http://localhost:5000', changeOrigin: true },
      '/files':         { target: 'http://localhost:5000', changeOrigin: true },
      '/uploads':       { target: 'http://localhost:5000', changeOrigin: true },
      '/socket.io':     { target: 'http://localhost:5000', changeOrigin: true, ws: true },
    },
  },
  build: {
    outDir: 'build',          // keep 'build' to match existing Docker COPY path
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor:       ['react', 'react-dom', 'react-router-dom'],
          query:        ['@tanstack/react-query'],
          socket:       ['socket.io-client'],
          sentry:       ['@sentry/react'],
        },
      },
    },
  },
  define: {
    // Shim process.env.NODE_ENV for any third-party libs that use it
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV),
  },
})
```


### 2.4 Environment Variable Migration

Currently only one env var is used in the frontend:

| CRA Name | Vite Name | Used In |
|----------|-----------|---------|
| `REACT_APP_API_URL` | `VITE_API_URL` | `src/lib/api.js` line: `process.env.REACT_APP_API_URL` |

**Migration steps:**
1. Rename `REACT_APP_API_URL` → `VITE_API_URL` in `frontend/.env` and `frontend/.env.example`
2. Update `src/lib/api.js`: `process.env.REACT_APP_API_URL` → `import.meta.env.VITE_API_URL`
3. Update `src/index.js`: `process.env.NODE_ENV` → `import.meta.env.DEV` (boolean in Vite)
4. Update root `.env` and `.env.example` if they contain `REACT_APP_*` vars
5. Update `docker-compose.yml` and `Dockerfile` build args if they pass `REACT_APP_*` at build time

**Important:** Vite env vars are statically replaced at build time (like CRA). They are NOT available at runtime unless explicitly passed. The current `API_BASE_URL` fallback to `window.location.origin` in `api.js` is a good safety net and should be preserved.

### 2.5 Proxy / Dev Server Strategy

CRA uses `"proxy": "http://localhost:5000"` in `package.json` (if set) or a `src/setupProxy.js`. The current project uses `API_BASE_URL` pointing directly to the backend, so there may be no CRA proxy configured. Vite's `server.proxy` config (shown above) should be set up to:
- Proxy all API routes to the backend
- Proxy `/socket.io` with `ws: true` for WebSocket upgrade support
- This eliminates CORS issues in development without changing the backend

### 2.6 Docker Compatibility

The current `Dockerfile` likely runs `npm run build` and copies the `build/` directory. Vite outputs to `build/` by default if `outDir: 'build'` is set (as shown in the config above). No Docker changes are needed if `outDir` is kept as `build`.

**Verify in `Dockerfile`:**
- The `npm run build` command will now invoke `vite build` instead of `react-scripts build`
- Build args that inject `REACT_APP_*` env vars must be renamed to `VITE_*`
- Vite requires Node 18+ — verify the Docker base image version

### 2.7 Socket.IO Compatibility

Socket.IO client (`socket.io-client@^4.8.3`) is framework-agnostic. It has no dependency on CRA or Webpack. The migration to Vite has zero impact on Socket.IO behaviour. The singleton pattern in `src/socket.js` works identically under Vite.

**One consideration:** Vite's dev server proxy must forward WebSocket connections for Socket.IO to work in development without CORS errors. The `ws: true` flag in the `/socket.io` proxy entry handles this.

### 2.8 React Query Compatibility

`@tanstack/react-query@^5.x` is framework-agnostic. No changes needed. The `QueryClientProvider`, all hooks, and `queryClient` singleton work identically under Vite.

### 2.9 Production Build Differences

| Aspect | CRA (Webpack) | Vite (Rollup) |
|--------|--------------|---------------|
| Bundler | Webpack 5 | Rollup |
| Chunk splitting | Single main chunk + lazy chunks | Automatic + manual chunks via `manualChunks` |
| CSS handling | Extracted to separate `.css` files | Same |
| Asset hashing | Content hash in filename | Same |
| Source maps | Optional | Optional (enabled in config above) |
| Tree shaking | Good | Excellent (Rollup is better at this) |
| Build speed | Slow (30–90s for this project) | Fast (5–15s expected) |
| Dev HMR | Slow (full rebundle) | Near-instant (ESM native) |

**Expected bundle size improvements:**
- Rollup's superior tree shaking should reduce the vendor bundle by 10–20%
- Manual chunk splitting (vendor / query / socket / sentry) means users only download what they need per route
- Estimated initial JS reduction: 15–25% after code splitting is also applied

### 2.10 Rollback Strategy

Before starting the Vite migration:
1. Create a git branch `phase-6/vite-migration`
2. Tag the current stable commit as `pre-phase-6`
3. Keep `react-scripts` in `devDependencies` (not removed from `package.json`) until the Vite build is verified in staging
4. The Docker image for the previous release remains available as a rollback target
5. If Vite migration fails, revert the branch and redeploy the tagged image

### 2.11 Likely Breaking Points

| Breaking Point | Likelihood | Mitigation |
|---------------|-----------|-----------|
| `process.env.REACT_APP_*` not replaced | High | Audit all `process.env` usages before migration |
| `public/index.html` path change | High | Move file and update references |
| CRA-specific Jest globals in tests | Medium | Tests use `@testing-library` which is compatible with Vitest |
| `import.meta.env` not available in Node scripts | Low | Only affects build scripts, not app code |
| Sentry DSN env var rename | Medium | Update `src/sentry.js` |
| CSS Modules (if any) | Low | No CSS Modules currently used — plain CSS only |
| SVG imports as React components | Low | No `import { ReactComponent }` pattern found — plain `<img>` or inline SVG used |

### 2.12 Required Testing Checklist After Migration

- [ ] Landing page loads and all sections render
- [ ] Signup flow completes and sets auth cookie
- [ ] Login flow completes, CSRF token is fetched, socket connects
- [ ] `/auth/me` rehydration works on page refresh
- [ ] Silent token refresh works on 401
- [ ] Dashboard loads for both client and developer roles
- [ ] Socket connects and `register` event fires
- [ ] `join_project` emits correctly with `lastSeqId`
- [ ] `submission:created` event updates React Query cache
- [ ] `approval:granted` event updates React Query cache
- [ ] File upload works (XHR with `withCredentials`)
- [ ] CSRF token is sent on all state-changing requests
- [ ] Notifications appear in real time
- [ ] Logout clears session and disconnects socket
- [ ] Production build (`vite build`) completes without errors
- [ ] Docker build completes and serves the app correctly
- [ ] Sentry error reporting works in production build

---

## 3. Workspace Decomposition Plan

> **Do NOT implement yet.** This section is planning only.

### 3.1 Audit: ClientProjectWorkspace (723 lines)

**Current responsibilities:**
1. Socket room join + reconnect handling
2. React Query data fetching (project detail, files)
3. Review/approval form + submission
4. Quick actions (message, request update, urgent, reopen)
5. File display list
6. Deliverables display
7. Progress stage bar
8. Developer panel display
9. Confirm modal
10. Action toast messages
11. New-update banner

### 3.2 Audit: DeveloperProjectWorkspace (743 lines)

**Current responsibilities:**
1. Socket room join + reconnect handling
2. React Query data fetching (project detail, files)
3. File upload via XHR (with progress bar)
4. Drag-and-drop file reorder
5. Deliverable form (repo link, demo link, notes)
6. Submission flow with idempotency key
7. Confirmation modal
8. Tabbed panel (deliverables / files / feedback)
9. Progress stepper
10. Mark-complete flow
11. Notification toasts
12. Quick actions grid


### 3.3 Proposed Subcomponent Breakdown

#### `WorkspaceHeader`

| Attribute | Detail |
|-----------|--------|
| **Responsibility** | Renders project title, status badges, urgent badge, summary strip (budget, due date, submissions, last update, review status), back button, new-update banner |
| **Props** | `project`, `projectDetail`, `reviewStatus`, `isUrgent`, `hasNewUpdate`, `onBack`, `onDismissUpdate` |
| **State ownership** | None — all data passed as props |
| **React Query deps** | None — receives derived data from parent |
| **Socket event deps** | None — parent handles socket; passes `hasNewUpdate` as prop |
| **Memoization** | `React.memo` — only re-renders when project data changes |
| **CSS** | Extract header-specific rules from `ProjectWorkspace.css` into `WorkspaceHeader.css` |

#### `WorkspaceProgressBar` (renamed from inline stage bar)

| Attribute | Detail |
|-----------|--------|
| **Responsibility** | Renders the progress stepper (Not Started → In Progress → Submitted → In Review → Completed) |
| **Props** | `currentStage`, `reviewStatus` |
| **State ownership** | None |
| **React Query deps** | None |
| **Socket event deps** | None |
| **Memoization** | `React.memo` with `areEqual` comparing `currentStage` only |

#### `FileManager`

| Attribute | Detail |
|-----------|--------|
| **Responsibility** | File list display (client view: read-only with download links) OR file upload + reorder + delete (developer view). Controlled by `readonly` prop. |
| **Props** | `projectId`, `files`, `isLoading`, `readonly`, `onUpload`, `onDelete`, `onReorder` |
| **State ownership** | `uploadProgress`, `dragIndex`, `dragOver`, `isDropZoneActive`, `uploadNotice` (developer only) |
| **React Query deps** | `useProjectFiles(projectId)` — or receives `files` as prop (preferred to avoid double-fetch) |
| **Socket event deps** | None — parent invalidates files cache on `project:status_changed` |
| **Memoization** | `React.memo`; file list items should be memoized individually |
| **CSS** | Extract file system rules into `FileManager.css` |

#### `DeliverableForm` (developer only)

| Attribute | Detail |
|-----------|--------|
| **Responsibility** | Repo link input, demo link input, notes textarea, submit button, submission state feedback, idempotency key generation |
| **Props** | `projectId`, `initialValues`, `isLocked`, `submissionCount`, `onSubmitSuccess` |
| **State ownership** | `repoLink`, `demoLink`, `notes`, `submissionState`, `submissionError`, `showConfirm` |
| **React Query deps** | Calls `invalidateProject(projectId)` on success |
| **Socket event deps** | None — parent handles socket events |
| **Memoization** | Not needed — form state changes frequently |

#### `DeliverableDisplay` (client only)

| Attribute | Detail |
|-----------|--------|
| **Responsibility** | Read-only display of repo link, demo link, developer notes, submission timestamp |
| **Props** | `deliverables`, `submittedAt`, `isLoading` |
| **State ownership** | None |
| **React Query deps** | None — receives data as props |
| **Socket event deps** | None |
| **Memoization** | `React.memo` |

#### `ReviewPanel` (client only)

| Attribute | Detail |
|-----------|--------|
| **Responsibility** | Review status indicator, feedback textarea, approve/request-revision buttons, confirm modal trigger, review history list |
| **Props** | `projectId`, `reviewStatus`, `onReviewSubmitted` |
| **State ownership** | `reviewFeedback`, `reviewLoading`, `reviewMessage`, `showApproveConfirm`, `reviewHistory` |
| **React Query deps** | Calls `invalidateProject`, `queryClient.invalidateQueries(projects.list())` on submit |
| **Socket event deps** | None — parent handles socket events |
| **Memoization** | Not needed |

#### `QuickActionsPanel`

| Attribute | Detail |
|-----------|--------|
| **Responsibility** | Renders the quick action buttons. Client version: message, request update, urgent, reopen. Developer version: upload file, update links, view feedback, submit. |
| **Props** | `actions: Array<{key, label, icon, description, onClick, disabled, variant}>`, `actionMessage` |
| **State ownership** | None — action handlers live in parent |
| **React Query deps** | None |
| **Socket event deps** | None |
| **Memoization** | `React.memo` |

#### `ActivityFeed` (replaces inline SubmissionHistory usage)

| Attribute | Detail |
|-----------|--------|
| **Responsibility** | Thin wrapper that renders `<SubmissionHistory>` inside an `<ErrorBoundary>`. Provides the section header. |
| **Props** | `projectId`, `isClient` |
| **State ownership** | None |
| **React Query deps** | Delegated to `SubmissionHistory` |
| **Socket event deps** | Delegated to `SubmissionHistory` |
| **Memoization** | Not needed |

#### `MessagePanel` (replaces ChatPanel duplication)

| Attribute | Detail |
|-----------|--------|
| **Responsibility** | Unified chat panel used by both `ClientMessages` and `DeveloperMessages`. Handles message fetch, send, typing indicators, socket listeners. |
| **Props** | `project`, `currentUser` |
| **State ownership** | `messages`, `body`, `sending`, `typingUsers` |
| **React Query deps** | `useProjectMessages(project.id)` — replaces the manual `apiRequest` fetch inside `ChatPanel` |
| **Socket event deps** | `message:sent`, `typing:started`, `typing:stopped` |
| **Memoization** | Not needed — message state changes frequently |

#### `WorkspaceSidebar` (developer only — right column)

| Attribute | Detail |
|-----------|--------|
| **Responsibility** | Container for the right column: QuickActionsPanel + tabbed panel (DeliverableForm / FileManager / feedback tab) |
| **Props** | `project`, `projectDetail`, `files`, `reviewStatus`, `reviewFeedback`, `activeTab`, `onTabChange`, `...handlers` |
| **State ownership** | `activeTab` (could be lifted to parent) |
| **React Query deps** | None — receives data as props |
| **Socket event deps** | None |
| **Memoization** | Not needed |

#### `MobileWorkspaceNav` (new — mobile only)

| Attribute | Detail |
|-----------|--------|
| **Responsibility** | Bottom tab bar visible only on mobile (`max-width: 768px`). Tabs: Overview, Files, Actions, Activity. Scrolls the workspace to the relevant section. |
| **Props** | `activeSection`, `onSectionChange`, `fileCount`, `hasNewUpdate` |
| **State ownership** | None |
| **React Query deps** | None |
| **Socket event deps** | None |
| **Memoization** | `React.memo` |

### 3.4 Shared Components Between Client and Developer Workspaces

| Component | Currently | After Decomposition |
|-----------|-----------|-------------------|
| `ConnectionStatusBar` | Already shared | Unchanged |
| `SubmissionHistory` | Already shared (via `isClient` prop) | Unchanged |
| `ErrorBoundary` | Already shared | Unchanged |
| `WorkspaceHeader` | Duplicated inline | New shared component |
| `WorkspaceProgressBar` | Duplicated inline | New shared component |
| `FileManager` | Duplicated inline | New shared component with `readonly` prop |
| `QuickActionsPanel` | Duplicated inline | New shared component with `actions` prop |
| `MessagePanel` (ChatPanel) | Duplicated in ClientMessages + DeveloperMessages | New shared component |
| `ProjectPicker` | Duplicated in ClientMessages + DeveloperMessages | New shared component |

### 3.5 Logic to Move Into Custom Hooks

| Logic | Current Location | Proposed Hook |
|-------|-----------------|---------------|
| Socket room join + reconnect handler | Both workspace components | `useProjectRoom(projectId)` — emits `join_project` on mount and on `connect` event |
| `timeAgo()` | 6 files | `src/utils/time.js` — shared utility (not a hook) |
| `FILE_ICONS` + `getFileIcon()` + `formatBytes()` | Both workspace components | `src/utils/files.js` — shared utility |
| File upload via XHR | `DeveloperProjectWorkspace` | `useFileUpload(projectId)` — returns `{ upload, progress, notice }` |
| Drag-and-drop reorder | `DeveloperProjectWorkspace` | `useFileReorder(projectId, files)` — returns `{ dragIndex, dragOver, handleDragStart, handleDrop, handleReorder }` |
| Typing indicator emit | Both message components | `useTypingIndicator(socket, projectId)` — returns `{ handleInputChange, typingUsers }` |
| Clipboard copy with timeout | Both workspace components | `useCopyToClipboard()` — returns `{ copy, copiedField }` |

### 3.6 Logic to Stay Centralised in SocketContext

The following must remain in `SocketContext` and must NOT be moved to individual components:
- Connection state machine (all 6 states)
- seqId deduplication (LRU seen-sets)
- Actor self-skip logic
- All `setQueryData` cache mutations for typed events
- Missed-event replay dispatch (`system:replay_batch`)
- User room registration (`register` emit)
- `joinProject` helper (exposed via `useJoinProject()`)

Moving any of these to individual components would break the deduplication guarantee and could cause double-applied events.


---

## 4. Route-Level Code Splitting Plan

### 4.1 Current Routes

```
/                → Home (all landing page sections)
/signup          → Signup
/login           → Login
/verify-email    → VerifyEmail
/dashboard       → Dashboard → ClientDashboard | DeveloperDashboard
/profile         → Profile
```

### 4.2 Splitting Strategy

| Route | Strategy | Reason |
|-------|----------|--------|
| `/` (Home) | **Eager** | Landing page — must load instantly for SEO and first impression. All home sections (Hero, HowItWorks, Projects, etc.) are lightweight. |
| `/signup` | **Eager** | Auth critical path — users arrive here from marketing. Small component. |
| `/login` | **Eager** | Auth critical path — same reasoning. |
| `/verify-email` | **Lazy** | Only reached via email link. Not on the critical path. |
| `/dashboard` | **Lazy** | Heaviest route. Contains the entire workspace, all dashboard sections, SocketContext consumers. Lazy-loading this alone will have the biggest impact on initial load. |
| `/profile` | **Lazy** | Not on the critical path. |

**Implementation pattern:**
```jsx
// App.js after migration
const Dashboard    = React.lazy(() => import('./pages/Dashboard/Dashboard'));
const Profile      = React.lazy(() => import('./pages/Profile'));
const VerifyEmail  = React.lazy(() => import('./pages/VerifyEmail'));
```

### 4.3 Suspense Boundary Placement

```jsx
// AppContent in App.js
<Suspense fallback={<PageLoadingSkeleton />}>
  <Routes>
    <Route path="/"             element={<Home />} />
    <Route path="/signup"       element={<Signup />} />
    <Route path="/login"        element={<Login />} />
    <Route path="/verify-email" element={<VerifyEmail />} />
    <Route path="/dashboard"    element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
    <Route path="/profile"      element={<ProtectedRoute><Profile /></ProtectedRoute>} />
  </Routes>
</Suspense>
```

A single top-level `Suspense` boundary is sufficient for route-level splitting. The `PageLoadingSkeleton` fallback should be a full-page skeleton that matches the approximate layout of the loading route (dashboard skeleton for `/dashboard`, simple spinner for others).

**Do NOT place Suspense boundaries inside `ProtectedRoute`.** The auth check must happen synchronously before the lazy component loads, otherwise the user sees a flash of the skeleton before being redirected to login.

### 4.4 Components That Should Remain Eager-Loaded

- `NavBar` — visible on landing page, must not flash
- `ProtectedRoute` — auth guard, must be synchronous
- `AuthContext` — session rehydration starts immediately on mount
- `SocketContext` — connects as soon as auth is confirmed; delaying this would delay socket connection
- `QueryClientProvider` — must wrap everything
- `ErrorBoundary` — must be available before any lazy component loads

### 4.5 Estimated Bundle Impact

Current state: single JS bundle (estimated 400–600KB gzipped based on dependencies).

After route splitting:
- **Initial bundle** (landing page): ~120–160KB gzipped (React, React Router, landing page components)
- **Dashboard chunk**: ~200–280KB gzipped (React Query, Socket.IO client, all workspace components)
- **Vendor chunk**: ~80–100KB gzipped (React, React DOM — cached aggressively)
- **Sentry chunk**: ~40–60KB gzipped (loaded async after initial render)

**Estimated initial load reduction: 50–60%** for users who land on the home page.

### 4.6 Largest Route Chunks (After Splitting)

1. `/dashboard` — contains SocketContext, all workspace components, all query hooks, Socket.IO client
2. `/profile` — contains profile form, avatar upload
3. `/verify-email` — small, minimal dependencies

---

## 5. Skeleton Loading Architecture

### 5.1 Design Principles

- All skeletons use a shimmer animation (gradient sweep left-to-right)
- Skeletons match the approximate dimensions of the real content to prevent layout shift (CLS)
- All skeleton elements have `aria-hidden="true"` and the container has `aria-busy="true"` + `aria-label="Loading..."`
- Skeletons are composed from a small set of primitives

### 5.2 Skeleton Primitives

```
SkeletonLine    — single text line (configurable width, height)
SkeletonBlock   — rectangular block (configurable width, height, border-radius)
SkeletonCircle  — circular avatar placeholder
SkeletonCard    — card-shaped container with shimmer background
```

These primitives are combined into page-specific skeletons.

### 5.3 Skeleton Designs Per Component

**`DashboardSkeleton`** (for `/dashboard` Suspense fallback)
- TopBar placeholder (full width, 56px height)
- Sidebar placeholder (240px wide, full height)
- Main content area: 3 card skeletons stacked

**`WorkspaceSkeleton`** (for workspace loading state)
- Header card: title line (60% width) + 3 badge blocks + summary strip (4 chips)
- Progress stepper: 5 circles connected by lines
- Body: left column (3 card skeletons) + right column (2 card skeletons)

**`ActivityFeedSkeleton`** (for SubmissionHistory loading)
- Already implemented as `SkeletonItem` in `SubmissionHistory.jsx` — extract and standardise

**`MessagesSkeleton`**
- Sidebar: 3 project item skeletons
- Chat area: alternating left/right bubble skeletons (5 items)

**`NotificationsSkeleton`**
- 4 notification item skeletons (dot + two lines)

**`ProjectCardSkeleton`**
- Card with: title line, description lines (2), tag chips (3), budget + due date line

**`ProjectFeedSkeleton`**
- StatStrip skeleton (4 stat chips)
- FilterBar skeleton
- Grid of 6 `ProjectCardSkeleton` items

**`TableSkeleton`** (for bids list, ratings)
- Header row + 4 data rows, each with 4 cell skeletons

### 5.4 Shimmer Strategy

```css
/* _skeleton.css — shared shimmer keyframe */
@keyframes skeleton-shimmer {
  0%   { background-position: -200% 0; }
  100% { background-position:  200% 0; }
}

.skeleton-shimmer {
  background: linear-gradient(
    90deg,
    var(--surface-2) 25%,
    var(--surface-3, rgba(255,255,255,0.06)) 50%,
    var(--surface-2) 75%
  );
  background-size: 200% 100%;
  animation: skeleton-shimmer 1.4s ease-in-out infinite;
  border-radius: 6px;
}
```

All skeleton primitives apply `.skeleton-shimmer`. The animation delay (`--sk-delay`) is already used in the existing `SkeletonItem` — standardise this pattern.

### 5.5 Accessibility Considerations

- Skeleton containers: `role="status"` + `aria-label="Loading content"` + `aria-busy="true"`
- Individual skeleton elements: `aria-hidden="true"` (they are decorative)
- When content loads, `aria-busy` is removed and a live region announces completion if appropriate

### 5.6 Layout Shift Prevention

- Skeleton dimensions must match real content dimensions as closely as possible
- Use `min-height` on skeleton containers to reserve space
- The workspace skeleton must reserve the same 2-column grid layout as the real workspace
- Avoid `height: auto` on skeleton containers — use fixed or min heights

---

## 6. Accessibility Refactor Plan

### 6.1 ARIA Labels — Fixes Required

| Component | Element | Fix |
|-----------|---------|-----|
| Both workspaces | Copy buttons (`⎘` / `✓`) | Add `aria-label="Copy to clipboard"` / `aria-label="Copied"` |
| Both workspaces | Download link (`↓`) | Add `aria-label={`Download ${file.file_name}`}` |
| Both workspaces | Icon-only action buttons | Add descriptive `aria-label` to every button that has no visible text |
| `DeveloperProjectWorkspace` | File delete button | `aria-label={`Delete ${file.file_name}`}` |
| `SubmissionHistory` | Edit/delete SVG buttons | Add `aria-label="Edit note"` / `aria-label="Delete note"` |
| Progress steppers | Step circles | Add `aria-current="step"` to the active step |
| `TopBar` | Notification list items | Convert `<li onClick>` to `<li><button>` |
| Messages | Project picker list items | Convert `<li onClick>` to `<li><button>` |

### 6.2 Emoji Handling

All emoji used as decorative icons inside buttons must have `aria-hidden="true"` on the emoji span:

```jsx
// Before
<button className="cpw-action-btn">
  <span className="cpw-action-icon">💬</span>
  <span>Message Developer</span>
</button>

// After
<button className="cpw-action-btn" aria-label="Message Developer">
  <span className="cpw-action-icon" aria-hidden="true">💬</span>
  <span>Message Developer</span>
</button>
```

Emoji used as standalone content (e.g., status indicators like `🚨 URGENT`) should be wrapped:
```jsx
<span aria-label="Urgent">🚨</span>
<span aria-hidden="true"> URGENT</span>
```

### 6.3 Focus Management

**Modal focus trap implementation:**
```jsx
// useModalFocus hook
// On open: move focus to first focusable element inside modal
// On Tab: cycle focus within modal (trap)
// On Shift+Tab: cycle backwards
// On Escape: close modal and return focus to trigger
// Set aria-modal="true" and role="dialog" on modal container
// Set aria-labelledby pointing to modal title
```

This hook must be applied to:
- `ConfirmModal` in `ClientProjectWorkspace`
- Submit confirm modal in `DeveloperProjectWorkspace`
- `CreateProjectModal`
- `BidModal`
- `ProjectBidsModal`

**Dropdown focus management:**
- `TopBar` notification dropdown: on open, move focus to first notification item; arrow keys navigate; Escape closes and returns focus to bell button
- `TopBar` profile dropdown: already has `role="menu"` — add `role="menuitem"` to items, implement arrow key navigation

### 6.4 Keyboard Navigation

| Component | Required Keyboard Behaviour |
|-----------|---------------------------|
| All modals | Tab cycles within modal; Escape closes; Enter confirms default action |
| `TopBar` notification dropdown | Arrow Up/Down navigates items; Escape closes; Enter marks as read |
| `TopBar` profile dropdown | Arrow Up/Down navigates items; Escape closes; Enter activates item |
| Project picker (messages) | Arrow Up/Down navigates projects; Enter selects |
| Workspace tabs | Arrow Left/Right switches tabs (ARIA tab pattern) |
| File drag-and-drop | Keyboard alternative: Up/Down arrows to reorder when file item is focused |

### 6.5 Semantic HTML Fixes

| Current | Fix |
|---------|-----|
| `<li onClick>` in project pickers | `<li><button>` or `<li role="option">` |
| `<li onClick>` in notification list | `<li><button>` |
| `<div className="dd-modal-backdrop">` | `<div role="dialog" aria-modal="true" aria-labelledby="modal-title">` |
| `<div className="cpw-modal">` | Same |
| `<span className="cpw-new-update-banner" onClick>` | `<button>` |

### 6.6 Form Labels

| Component | Input | Fix |
|-----------|-------|-----|
| `DeveloperProjectWorkspace` | Repo link input | Has `<label>` — correct |
| `DeveloperProjectWorkspace` | Demo link input | Has `<label>` — correct |
| `DeveloperProjectWorkspace` | Notes textarea | Has `<label>` — correct |
| `ClientProjectWorkspace` | Review feedback textarea | No `<label>` — add `<label htmlFor="review-feedback">Feedback</label>` |
| `ClientMessages` / `DeveloperMessages` | Message input | No `<label>` — add visually hidden label or `aria-label` |
| `SubmissionHistory` | Add note textarea | No `<label>` — add `aria-label="Progress update"` |

### 6.7 Toast Accessibility

The floating notification (`.dd-notif`) in `DeveloperProjectWorkspace` has `pointer-events: none` and no live region. Fix:

```jsx
// Add a persistent live region to the workspace root
<div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
  {notification?.msg}
</div>
// The visual toast can remain as-is
```

The `ConnectionStatusBar` already uses `role="status"` and `aria-live="polite"` — this is the correct pattern.

### 6.8 Color Contrast Risks

The design uses a dark theme with CSS custom properties. Potential contrast issues:
- `var(--text-3)` (used for secondary labels, timestamps) — likely below 4.5:1 against dark backgrounds. Needs audit with a contrast checker.
- `var(--cyan)` on dark backgrounds — typically passes AA but needs verification
- Disabled button opacity (`opacity: 0.38`) — may cause contrast failures for disabled state text

### 6.9 WCAG Categories Being Addressed

| WCAG Criterion | Level | What We're Fixing |
|---------------|-------|------------------|
| 1.3.1 Info and Relationships | A | Semantic HTML for lists, buttons, dialogs |
| 1.4.1 Use of Color | A | Emoji/icon labels not relying on color alone |
| 2.1.1 Keyboard | A | All interactive elements keyboard accessible |
| 2.1.2 No Keyboard Trap | A | Modal focus traps (properly implemented) |
| 2.4.3 Focus Order | A | Logical focus order in modals and dropdowns |
| 2.4.6 Headings and Labels | AA | Form labels for all inputs |
| 4.1.2 Name, Role, Value | A | ARIA labels on icon buttons, roles on dialogs |
| 4.1.3 Status Messages | AA | Live regions for toasts and connection status |

### 6.10 Reusable Accessibility Utilities

```
src/hooks/useModalFocus.js     — focus trap + aria-modal management
src/hooks/useKeyboardNav.js    — arrow key navigation for lists/menus
src/components/VisuallyHidden.jsx — sr-only text wrapper
src/components/LiveRegion.jsx  — aria-live region for toasts
```


---

## 7. Responsive Workspace Architecture

### 7.1 Breakpoint Strategy

| Breakpoint | Name | Target |
|-----------|------|--------|
| `≥ 1280px` | Desktop | Full 2-column workspace layout |
| `900px – 1279px` | Tablet landscape | Narrower right column (340px) |
| `600px – 899px` | Tablet portrait | Single column, stacked |
| `< 600px` | Mobile | Single column + `MobileWorkspaceNav` bottom bar |

These breakpoints are already partially implemented in `ProjectWorkspace.css`. The gap is the mobile navigation system and the sidebar collapse.

### 7.2 Sidebar Collapse Strategy

**Dashboard sidebars (`ClientSidebar`, `DevSidebar`):**
- On mobile (`< 768px`): sidebar collapses to a hidden drawer, triggered by a hamburger button in `TopBar`
- The drawer overlays the content with a backdrop
- Closing: tap backdrop, tap X button, or navigate to a section
- The `TopBar` needs a `onMenuToggle` prop to communicate with the sidebar

**Workspace right column:**
- Already collapses to single column at `900px` (correct)
- On mobile, the right column (actions, files, deliverables) appears below the left column
- `MobileWorkspaceNav` provides a bottom tab bar to jump between sections without scrolling

### 7.3 Activity Panel Behaviour

- Desktop: `SubmissionHistory` is in the left column, always visible
- Tablet: same
- Mobile: `SubmissionHistory` is accessible via the "Activity" tab in `MobileWorkspaceNav`; it is rendered in the DOM but scrolled to via anchor or section visibility toggle

### 7.4 Message Panel Stacking

`ClientMessages` / `DeveloperMessages` currently use a 2-panel layout (sidebar + chat). On mobile:
- The project picker (`ProjectPicker`) becomes a full-screen overlay or a top-of-page dropdown
- The chat panel takes the full screen
- A back button returns to the project picker

### 7.5 Mobile Navigation System

`MobileWorkspaceNav` is a fixed bottom bar, visible only on mobile:

```
[ Overview ] [ Files ] [ Actions ] [ Activity ]
```

- **Overview**: scrolls to / shows the header + description + developer panel
- **Files**: scrolls to / shows the file manager
- **Actions**: scrolls to / shows the quick actions + deliverables/review panel
- **Activity**: scrolls to / shows the `SubmissionHistory`

Implementation options (in order of preference):
1. **Scroll-to-anchor**: sections have `id` attributes; nav buttons call `element.scrollIntoView()`. Simple, no state needed.
2. **Section visibility toggle**: sections are conditionally rendered based on `activeSection` state. More control but adds complexity.

Recommendation: use scroll-to-anchor for the initial implementation.

### 7.6 Touch Target Sizing

All interactive elements must meet the minimum 44×44px touch target size (WCAG 2.5.5):
- Current quick action buttons: `padding: 10px 8px` — likely below 44px height. Increase to `min-height: 44px`.
- Tab buttons: `padding: 11px 8px` — borderline. Increase to `min-height: 44px`.
- File delete button: `width: 24px; height: 24px` — too small. Increase to `min-width: 44px; min-height: 44px` with negative margin to avoid layout impact.
- Icon buttons (copy, open): `width: 30px; height: 36px` — too small on mobile. Increase to 44×44px on mobile.

### 7.7 Scroll Containment Strategy

- The workspace body (`dd-workspace-body`) should have `overflow-y: auto` on mobile to allow independent scrolling of the content area while the `MobileWorkspaceNav` stays fixed at the bottom.
- The right column's `position: sticky` is already removed at `900px` — correct.
- The `SubmissionHistory` timeline should not have its own scroll container on mobile — it should flow naturally in the document.

### 7.8 Components Needing Redesign for Mobile

| Component | Change Required |
|-----------|----------------|
| `ClientSidebar` / `DevSidebar` | Collapse to drawer on mobile |
| `TopBar` | Add hamburger menu button on mobile |
| `ClientMessages` / `DeveloperMessages` | Stack project picker above chat on mobile |
| `DeveloperProjectWorkspace` | Add `MobileWorkspaceNav` |
| `ClientProjectWorkspace` | Add `MobileWorkspaceNav` |
| `ProjectWorkspace.css` | Add mobile-specific rules for touch targets |

### 7.9 Components That Can Remain Unchanged

| Component | Reason |
|-----------|--------|
| `ConnectionStatusBar` | Already responsive (full-width bar) |
| `SubmissionHistory` | Already single-column, flows naturally |
| `TimelineEventCard` | Already single-column |
| `WorkspaceProgressBar` | Already uses `overflow-x: auto` for small screens |
| `ErrorBoundary` | Layout-agnostic |
| `BidModal` / `CreateProjectModal` | Already use `max-width` + `width: 100%` |
| `ProjectCard` | Already responsive |

---

## 8. File Download UX Improvements

### 8.1 Backend: Content-Disposition Header

Currently, file download links point directly to `${API_BASE_URL}/uploads/${file.file_name}`. The server serves these as static files without a `Content-Disposition` header, so the browser either opens the file inline or downloads it with the server-generated filename (which may include a timestamp prefix like `file_1748000000_originalname.pdf`).

**Required backend change** (in `uploadController.js` or a new `/files/:id/download` route):

```js
// GET /files/:id/download
router.get('/files/:id/download', authenticate, async (req, res) => {
  const file = await db.query('SELECT * FROM project_files WHERE id = $1', [req.params.id]);
  if (!file.rows[0]) return res.status(404).json({ error: 'File not found' });

  // Use original_name if stored, otherwise strip the timestamp prefix
  const originalName = file.rows[0].original_name
    || file.rows[0].file_name.replace(/^.+?_\d{10,}_/, '');

  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${encodeURIComponent(originalName)}"`
  );
  res.setHeader('Content-Type', file.rows[0].mime_type || 'application/octet-stream');

  // Stream from storage (S3 or local disk)
  // ...
});
```

**Database consideration:** The `project_files` table should store `original_name` separately from the server-generated `file_name` (which includes the timestamp). Check migration `005_required_additions.sql` or `007_schema_stabilization.sql` to see if `original_name` is already stored. If not, add it in a new migration.

### 8.2 Frontend: Download Link Update

Replace the current direct static URL download links:

```jsx
// Before (ClientProjectWorkspace)
<a
  className="dd-bid-btn cpw-dl-btn"
  href={`${API_BASE_URL}/uploads/${file.file_name}`}
  download
>
  ↓
</a>

// After
<a
  className="dd-bid-btn cpw-dl-btn"
  href={`${API_BASE_URL}/files/${file.id}/download`}
  aria-label={`Download ${file.original_name || file.file_name}`}
>
  <span aria-hidden="true">↓</span>
</a>
```

The `download` attribute on `<a>` only works for same-origin URLs. Since the API is on a different origin in production, the `Content-Disposition: attachment` header on the server is the reliable mechanism — not the HTML `download` attribute.

### 8.3 Browser Compatibility

- `Content-Disposition: attachment` is supported in all browsers
- The `filename` parameter should use RFC 5987 encoding for non-ASCII filenames: `filename*=UTF-8''${encodeURIComponent(name)}`
- The HTML `download` attribute is supported in all modern browsers but is ignored for cross-origin URLs — rely on the server header instead

### 8.4 Signed URL Implications

If the project migrates to S3 or another object storage (Phase 7+), the download flow changes:
- The `/files/:id/download` endpoint generates a signed URL with a short TTL (e.g., 60 seconds)
- The response is a redirect (`302`) to the signed URL
- The signed URL includes `response-content-disposition=attachment%3B+filename%3D...` as a query parameter
- The frontend link remains the same (`/files/:id/download`) — no frontend change needed

### 8.5 Mobile Download Behaviour

- On iOS Safari, `Content-Disposition: attachment` triggers the share sheet for most file types
- On Android Chrome, files are downloaded to the Downloads folder
- PDF files may open inline on mobile regardless of `Content-Disposition` — this is browser behaviour and cannot be overridden
- The download button should have a clear label (`aria-label="Download {filename}"`) so mobile users understand the action

---

## 9. Risk Analysis

### 9.1 Vite Migration Risk

| Risk | Level | Rollback Strategy |
|------|-------|------------------|
| `process.env.REACT_APP_*` not replaced → blank API URL | **High** | Pre-migration audit of all `process.env` usages; test in staging before merging |
| Socket.IO WebSocket upgrade fails in dev (proxy misconfiguration) | **Medium** | Verify `ws: true` in Vite proxy config; test socket connection in dev before merging |
| Docker build fails due to Node version | **Medium** | Pin Node version in Dockerfile; test Docker build in CI |
| CRA-specific test globals break | **Low** | Tests are not blocking for this phase; can be fixed separately |
| Sentry DSN not injected at build time | **Medium** | Update `sentry.js` to use `import.meta.env.VITE_SENTRY_DSN` |
| **Rollback:** | | Revert to `pre-phase-6` git tag; redeploy previous Docker image |

### 9.2 Socket.IO Reconnection Risk

| Risk | Level | Mitigation |
|------|-------|-----------|
| Component decomposition breaks the `useProjectRoom` pattern → workspace components no longer re-join on reconnect | **High** | Extract `useProjectRoom(projectId)` hook before decomposing workspace components; verify reconnect behaviour in integration test |
| Lazy-loading the dashboard delays socket connection → missed events during load | **Medium** | `SocketContext` is in the provider tree above the lazy boundary; socket connects as soon as auth is confirmed, before the dashboard chunk loads |
| `MobileWorkspaceNav` section switching unmounts/remounts workspace sections → socket listeners re-register | **Medium** | Use scroll-to-anchor approach (no unmounting) rather than conditional rendering |

### 9.3 React Query Hydration Risk

| Risk | Level | Mitigation |
|------|-------|-----------|
| Component decomposition passes stale props instead of reading from cache → cache and UI diverge | **High** | Subcomponents should read from React Query cache directly (via hooks) rather than receiving data as props where possible; only pass data as props for derived/computed values |
| Code splitting causes `queryClient` to be instantiated multiple times | **Low** | `queryClient` is a singleton in `src/lib/queryClient.js`; Vite's module system ensures it is only instantiated once |
| Skeleton loading state causes layout shift that breaks sticky positioning | **Low** | Use `min-height` on skeleton containers to match real content height |

### 9.4 Lazy-Loading + Auth Interaction Risk

| Risk | Level | Mitigation |
|------|-------|-----------|
| User navigates to `/dashboard` while auth rehydration is in-flight → `ProtectedRoute` redirects to login before auth check completes | **Medium** | `AuthContext` exposes `loading` state; `ProtectedRoute` must show a loading skeleton (not redirect) while `loading === true` |
| Lazy chunk fails to load (network error) → blank screen | **Low** | Wrap `Suspense` with `ErrorBoundary`; show a "Failed to load, retry" message |
| Auth cookie expires during a long session → socket disconnects with `auth_expired` → user is on a lazy-loaded route | **Low** | `ConnectionStatusBar` already handles `auth_expired` state; `AuthContext` listens for `auth:expired` event and clears session |

### 9.5 Accessibility Refactor Risk

| Risk | Level | Mitigation |
|------|-------|-----------|
| Focus trap implementation breaks existing keyboard users who rely on Tab to exit modals | **Low** | Standard focus trap pattern (Tab cycles within modal, Escape closes) is the expected behaviour |
| Adding `role="dialog"` to modals causes screen readers to announce modal content twice | **Low** | Use `aria-modal="true"` to suppress background content |
| Changing `<li onClick>` to `<button>` breaks existing CSS | **Medium** | Update CSS selectors alongside the HTML change; test visually |

### 9.6 Migration Sequencing Requirements

The following dependencies must be respected:
1. Vite migration must happen **before** code splitting (code splitting requires Vite's Rollup)
2. Shared utilities (`timeAgo`, `FILE_ICONS`, etc.) must be extracted **before** workspace decomposition (to avoid creating more copies)
3. `useProjectRoom` hook must be created **before** workspace decomposition (workspace components depend on it)
4. `MessagePanel` shared component must be created **before** removing `ChatPanel` from both message components
5. Skeleton system must be designed **before** implementing code splitting (the Suspense fallback needs skeletons)
6. Accessibility fixes (ARIA labels, focus management) can be done **in parallel** with decomposition, applied to each new subcomponent as it is created

---

## 10. Recommended Execution Order

The following order minimises merge conflicts, downtime, frontend breakages, and socket instability. Each step is independently deployable.

### Step 1 — Extract Shared Utilities (No UI Change)
**Risk: Very Low | Estimated effort: 0.5 days**

Create `src/utils/time.js` (timeAgo), `src/utils/files.js` (FILE_ICONS, getFileIcon, formatBytes), `src/utils/format.js` (formatProjectForCard). Update all 6+ files that duplicate `timeAgo`. No visual change, no socket change, no React Query change.

**Verification:** App runs identically. No visual regression.

### Step 2 — Extract Custom Hooks (No UI Change)
**Risk: Low | Estimated effort: 1 day**

Create `useProjectRoom(projectId)`, `useFileUpload(projectId)`, `useFileReorder(projectId, files)`, `useTypingIndicator(socket, projectId)`, `useCopyToClipboard()`. These are pure refactors — extract logic from existing components into hooks, then use the hooks in the same components. No behaviour change.

**Verification:** Socket reconnect works. File upload works. Typing indicators work.

### Step 3 — Vite Migration
**Risk: Medium | Estimated effort: 1 day**

Migrate from CRA to Vite. Rename env vars. Update `index.html`. Update `api.js`. Verify Docker build. Run the full testing checklist from Section 2.12.

**Verification:** Full testing checklist passes. Docker build succeeds. Socket connects. Auth flow works.

### Step 4 — Skeleton Loading System
**Risk: Low | Estimated effort: 1 day**

Create skeleton primitives and page-level skeletons. Replace ad-hoc loading states in `ClientMessages`, `DeveloperMessages`, `ClientActivityFeed`, `ProjectFeed` with the new skeleton components. Standardise the existing `SkeletonItem` in `SubmissionHistory`.

**Verification:** Loading states look consistent. No layout shift. `aria-busy` is set correctly.

### Step 5 — Route-Level Code Splitting
**Risk: Low (after Vite migration) | Estimated effort: 0.5 days**

Add `React.lazy` for `/dashboard`, `/profile`, `/verify-email`. Add `Suspense` boundary in `App.js`. Update `ProtectedRoute` to handle `AuthContext.loading` state.

**Verification:** Initial bundle size reduced. Dashboard loads correctly after lazy import. Auth redirect works. Socket connects before dashboard chunk loads.

### Step 6 — Workspace Decomposition (Client)
**Risk: Medium | Estimated effort: 2 days**

Decompose `ClientProjectWorkspace` into: `WorkspaceHeader`, `WorkspaceProgressBar`, `DeliverableDisplay`, `ReviewPanel`, `QuickActionsPanel`, `FileManager` (readonly), `ActivityFeed`. Apply accessibility fixes to each new component as it is created. Split `ProjectWorkspace.css` into per-component CSS files.

**Verification:** Client workspace renders identically. Review/approval flow works. Socket events update the UI. Mobile layout is correct.

### Step 7 — Workspace Decomposition (Developer)
**Risk: Medium | Estimated effort: 2 days**

Decompose `DeveloperProjectWorkspace` into: `WorkspaceHeader` (reuse), `WorkspaceProgressBar` (reuse), `DeliverableForm`, `FileManager` (upload mode), `WorkspaceSidebar`, `QuickActionsPanel` (reuse). Apply accessibility fixes.

**Verification:** Developer workspace renders identically. File upload works. Submission flow works. Socket events update the UI.

### Step 8 — Shared MessagePanel + ProjectPicker
**Risk: Low | Estimated effort: 1 day**

Extract `ChatPanel` and `ProjectPicker` into shared components. Replace the duplicated implementations in `ClientMessages` and `DeveloperMessages`. Migrate `ChatPanel` to use `useProjectMessages` hook instead of manual `apiRequest` fetch.

**Verification:** Messages load correctly. Typing indicators work. Socket `message:sent` events appear in real time.

### Step 9 — Mobile Responsive Layout
**Risk: Medium | Estimated effort: 2 days**

Add `MobileWorkspaceNav` component. Add sidebar collapse/drawer for `ClientSidebar` and `DevSidebar`. Add hamburger button to `TopBar`. Fix touch target sizes. Fix message panel stacking on mobile.

**Verification:** Test on 375px viewport. All workspace sections are reachable. Sidebar opens and closes. Touch targets are ≥44px.

### Step 10 — Accessibility Fixes (Remaining)
**Risk: Low | Estimated effort: 1 day**

Apply remaining accessibility fixes not covered during decomposition: modal focus traps (`useModalFocus`), dropdown keyboard navigation (`useKeyboardNav`), `LiveRegion` for toasts, `VisuallyHidden` utility, form labels, semantic HTML fixes.

**Verification:** Tab through all modals — focus stays trapped. Escape closes modals. Screen reader announces toast messages.

### Step 11 — File Download UX
**Risk: Low | Estimated effort: 0.5 days**

Add `original_name` column to `project_files` table (new migration). Add `/files/:id/download` route to backend. Update download links in `FileManager` component. Add `aria-label` to download buttons.

**Verification:** Downloaded files have meaningful names. `Content-Disposition: attachment` header is present. Mobile download works.

---

### Summary Timeline

| Step | Task | Risk | Effort |
|------|------|------|--------|
| 1 | Extract shared utilities | Very Low | 0.5d |
| 2 | Extract custom hooks | Low | 1d |
| 3 | Vite migration | Medium | 1d |
| 4 | Skeleton loading system | Low | 1d |
| 5 | Route-level code splitting | Low | 0.5d |
| 6 | Workspace decomposition (Client) | Medium | 2d |
| 7 | Workspace decomposition (Developer) | Medium | 2d |
| 8 | Shared MessagePanel + ProjectPicker | Low | 1d |
| 9 | Mobile responsive layout | Medium | 2d |
| 10 | Accessibility fixes (remaining) | Low | 1d |
| 11 | File download UX | Low | 0.5d |
| **Total** | | | **~12.5 days** |

Each step is independently deployable. Steps 1–5 are pure infrastructure improvements with no visual change. Steps 6–8 are the core decomposition work. Steps 9–11 are the UX improvements.

> **Note on WCAG compliance:** Full WCAG 2.1 AA validation requires manual testing with assistive technologies (NVDA, VoiceOver, JAWS) and expert accessibility review. The fixes planned here address the most critical and clearly identifiable issues found during the code audit. A formal accessibility audit after implementation is strongly recommended.

---

*Document generated: Phase 6 planning. No code has been modified.*
