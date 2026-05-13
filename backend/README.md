# Backend Architecture Notes

The backend has been moved from a root-level prototype server into a production-oriented layout:

- `config/`: environment and database configuration
- `middleware/`: authentication and security middleware
- `routes/`: HTTP route registration, preserving existing API paths
- `services/`: reusable business/security services such as upload handling
- `sockets/`: authenticated Socket.IO setup
- `db/migrations/`: migration-ready SQL hardening scripts
- `utils/`: reusable validation helpers

Current compatibility note: route handlers are registered through `routes/index.js` to preserve exact frontend behavior and minimize regression risk. The next safe refactor step is moving each route group into controller modules without changing route signatures.
