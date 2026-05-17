# NeuralForge Backend

Express + Socket.IO + PostgreSQL API server.

## Quick Start

```bash
# Install dependencies (from repo root)
npm install

# Copy and fill in environment variables
cp .env.example .env

# Run all database migrations (requires DATABASE_URL in .env)
npm run migrate

# Start development server (auto-restarts on change)
npm run dev

# Start production server
npm start
```

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Prod | Full PostgreSQL connection string |
| `DB_HOST` / `DB_PORT` / `DB_NAME` / `DB_USER` / `DB_PASSWORD` | Dev | Individual DB params (used if DATABASE_URL not set) |
| `JWT_SECRET` | Yes | 64+ char random secret |
| `JWT_EXPIRES_IN` | No | Token TTL, default `1d` |
| `CORS_ORIGINS` | Yes | Comma-separated allowed origins e.g. `https://app.yourdomain.com` |
| `PORT` | No | Server port, default `5000` |
| `UPLOAD_DIR` | No | Upload directory, default `uploads` |
| `UPLOAD_MAX_BYTES` | No | Max file size bytes, default `5242880` (5MB) |
| `NODE_ENV` | Prod | Set to `production` |

## Database Migrations

Run in order — all are idempotent (safe to re-run):

```bash
npm run migrate:001   # Security indexes + constraints
npm run migrate:002   # Notifications table
npm run migrate:003   # Messages table
npm run migrate:004   # Project events table

# Or run all at once:
npm run migrate
```

## API Routes

### Auth
- `POST /auth/signup` — register
- `POST /auth/login` — login, returns JWT

### Profile
- `GET /profile/:id` — public profile (self gets extra fields)
- `GET /profile/:id/skills` — list skills (auth)
- `POST /profile/:id/skills` — add skill (self only)
- `DELETE /profile/:id/skills` — remove skill (self only)

### Projects
- `POST /api/projects` — create project (client)
- `GET /api/projects` — client's own projects (paginated)
- `GET /api/projects/:id` — single project
- `GET /projects` — public marketplace listing
- `GET /projects/discover/:id` — developer feed (SQL skill-matched)
- `GET /projects/assigned/:id` — developer's assigned projects
- `PUT /projects/:id/complete` — mark complete
- `PUT /projects/:id/review` — approve or request revision

### Bids
- `POST /projects/:id/bid` — place bid
- `GET /api/projects/:projectId/bids` — list bids (client)
- `POST /api/projects/:projectId/accept-bid/:bidId` — accept bid
- `GET /bids/developer/:id` — developer's bids

### Submissions
- `POST /projects/:id/submit` — submit deliverables
- `GET /projects/:id/submissions` — submission history
- `POST /projects/:projectId/submissions` — add note
- `PUT /projects/:projectId/submissions/:id` — update note
- `DELETE /projects/:projectId/submissions/:id` — delete

### Files
- `POST /projects/:id/upload` — upload files (multipart)
- `GET /projects/:id/files` — list files
- `DELETE /files/:id` — delete file
- `PUT /files/reorder` — reorder files

### Messages
- `GET /projects/:id/messages` — paginated chat history
- `POST /projects/:id/messages` — send message
- `GET /api/messages/unread-count` — unread count

### Notifications
- `GET /notifications` — paginated notifications
- `PUT /notifications/read-all` — mark all read
- `PUT /notifications/:id/read` — mark one read

### Stats & Activity
- `GET /api/stats/client` — client dashboard stats
- `GET /api/activity/client` — client activity feed

## Socket.IO Events

### Server → Client
| Event | Room | Description |
|---|---|---|
| `notification` | `user_{id}` | Persisted notification (all types) |
| `new_bid` | `user_{clientId}` | Legacy bid notification |
| `bid_accepted` | `user_{devId}` | Legacy bid accepted |
| `project_submitted` | `project_{id}` | Developer submitted work |
| `project_reviewed` | `project_{id}` | Client reviewed submission |
| `submission_history_updated` | `project_{id}` | History changed |
| `new_message` | `project_{id}` | New chat message |
| `typing` | `project_{id}` | Typing indicator |

### Client → Server
| Event | Payload | Description |
|---|---|---|
| `register` | `userId` | Join personal room |
| `join_project` | `projectId` | Join project room (validated) |
| `leave_project` | `projectId` | Leave project room |
| `typing` | `{ projectId, typing }` | Broadcast typing state |

## Storage

Files are stored locally in `uploads/`. The `storageService.js` abstraction makes migration to S3/R2 straightforward — swap the provider object without touching controllers.
