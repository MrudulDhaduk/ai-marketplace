/**
 * sentry.js — Sentry initialisation for the React frontend
 *
 * Import this at the very top of index.js (before React renders).
 * No-ops silently when REACT_APP_SENTRY_DSN is not set.
 */
import * as Sentry from "@sentry/react";

const DSN = process.env.REACT_APP_SENTRY_DSN;

if (DSN) {
  Sentry.init({
    dsn: DSN,
    environment: process.env.REACT_APP_ENV || process.env.NODE_ENV || "development",
    release: process.env.REACT_APP_VERSION || undefined,

    // Capture 100% of transactions in dev, 10% in production
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,

    // Don't send PII
    sendDefaultPii: false,
  });
}

export { Sentry };
