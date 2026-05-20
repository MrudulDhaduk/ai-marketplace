/**
 * ErrorBoundary.jsx — React error boundary for dashboard panels
 *
 * Wraps major sections so a single component crash does not destroy
 * the entire dashboard. Provides:
 *   - Graceful fallback UI in production
 *   - Full error details in development
 *   - Per-panel isolation (one crash ≠ full page down)
 *
 * Usage:
 *   <ErrorBoundary label="Client Workspace">
 *     <ClientProjectWorkspace ... />
 *   </ErrorBoundary>
 *
 *   // With custom fallback:
 *   <ErrorBoundary fallback={<p>Something went wrong</p>}>
 *     <SomePanel />
 *   </ErrorBoundary>
 */
import { Component } from "react";

const isDev = process.env.NODE_ENV === "development";

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, info: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    this.setState({ info });

    // In development, log the full component stack
    if (isDev) {
      console.error(
        `[ErrorBoundary] Caught in "${this.props.label || "unknown"}":\n`,
        error,
        "\nComponent stack:",
        info?.componentStack
      );
    } else {
      // In production, log a minimal message (no stack traces to console)
      console.error(
        `[ErrorBoundary] Panel "${this.props.label || "unknown"}" crashed.`
      );
    }
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, info: null });
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    // Custom fallback takes priority
    if (this.props.fallback) {
      return this.props.fallback;
    }

    const label = this.props.label || "This panel";

    return (
      <div className="error-boundary-fallback" role="alert">
        <div className="error-boundary-inner">
          <span className="error-boundary-icon">⚠️</span>
          <h3 className="error-boundary-title">{label} encountered an error</h3>
          <p className="error-boundary-msg">
            Something went wrong loading this section. Your other panels are
            unaffected.
          </p>

          {/* Show error details only in development */}
          {isDev && this.state.error && (
            <details className="error-boundary-details">
              <summary>Error details (dev only)</summary>
              <pre className="error-boundary-stack">
                {this.state.error.toString()}
                {this.state.info?.componentStack}
              </pre>
            </details>
          )}

          <button
            className="error-boundary-retry"
            onClick={this.handleReset}
            type="button"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }
}
