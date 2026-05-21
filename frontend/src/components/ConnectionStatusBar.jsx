/**
 * ConnectionStatusBar.jsx
 *
 * Renders a non-intrusive status bar when the socket is not fully connected.
 * Hidden entirely when state is "connected".
 *
 * Props:
 *   connectionState  — from useConnectionState()
 *   reconnectAttempt — current attempt number
 *   onRetry          — callback to manually trigger socket.connect()
 */
import React from "react";
import "./ConnectionStatusBar.css";

const STATE_CONFIG = {
  reconnecting: {
    cls:   "csb--reconnecting",
    icon:  "⟳",
    label: (attempt) => `Reconnecting… (attempt ${attempt})`,
    showRetry: false,
  },
  degraded: {
    cls:   "csb--degraded",
    icon:  "⚠",
    label: () => "Connection unstable — some updates may be delayed",
    showRetry: true,
  },
  disconnected: {
    cls:   "csb--disconnected",
    icon:  "✕",
    label: () => "You are offline — changes will sync when reconnected",
    showRetry: true,
  },
  auth_expired: {
    cls:   "csb--auth-expired",
    icon:  "🔒",
    label: () => "Session expired — please log in again",
    showRetry: false,
  },
  transport_fallback: {
    cls:   "csb--fallback",
    icon:  "↕",
    label: () => "Using fallback connection",
    showRetry: false,
  },
};

export default function ConnectionStatusBar({ connectionState, reconnectAttempt = 0, onRetry }) {
  if (!connectionState || connectionState === "connected") return null;

  const cfg = STATE_CONFIG[connectionState];
  if (!cfg) return null;

  return (
    <div className={`csb ${cfg.cls}`} role="status" aria-live="polite">
      <span className="csb__icon" aria-hidden="true">{cfg.icon}</span>
      <span className="csb__label">{cfg.label(reconnectAttempt)}</span>
      {cfg.showRetry && onRetry && (
        <button className="csb__retry" onClick={onRetry} type="button">
          Retry now
        </button>
      )}
    </div>
  );
}
