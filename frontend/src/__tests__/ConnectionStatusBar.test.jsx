/**
 * Component tests for ConnectionStatusBar.
 *
 * Tests all connection states, accessibility attributes,
 * retry button behaviour, and null/unknown state handling.
 */
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import ConnectionStatusBar from "../components/ConnectionStatusBar";

describe("ConnectionStatusBar", () => {
  // ── Renders nothing when connected ─────────────────────────────────────────
  test("renders nothing when connectionState is 'connected'", () => {
    const { container } = render(
      <ConnectionStatusBar connectionState="connected" />,
    );
    expect(container.firstChild).toBeNull();
  });

  test("renders nothing when connectionState is null", () => {
    const { container } = render(<ConnectionStatusBar connectionState={null} />);
    expect(container.firstChild).toBeNull();
  });

  test("renders nothing when connectionState is undefined", () => {
    const { container } = render(<ConnectionStatusBar />);
    expect(container.firstChild).toBeNull();
  });

  test("renders nothing for unknown state", () => {
    const { container } = render(
      <ConnectionStatusBar connectionState="unknown_state" />,
    );
    expect(container.firstChild).toBeNull();
  });

  // ── Reconnecting state ──────────────────────────────────────────────────────
  test("shows reconnecting message with attempt number", () => {
    render(
      <ConnectionStatusBar connectionState="reconnecting" reconnectAttempt={3} />,
    );
    expect(screen.getByText(/reconnecting/i)).toBeInTheDocument();
    expect(screen.getByText(/attempt 3/i)).toBeInTheDocument();
  });

  test("does NOT show retry button in reconnecting state", () => {
    render(
      <ConnectionStatusBar connectionState="reconnecting" reconnectAttempt={1} />,
    );
    expect(screen.queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
  });

  test("applies reconnecting CSS class", () => {
    const { container } = render(
      <ConnectionStatusBar connectionState="reconnecting" reconnectAttempt={1} />,
    );
    expect(container.firstChild).toHaveClass("csb--reconnecting");
  });

  // ── Degraded state ──────────────────────────────────────────────────────────
  test("shows degraded message", () => {
    render(<ConnectionStatusBar connectionState="degraded" />);
    expect(screen.getByText(/unstable/i)).toBeInTheDocument();
  });

  test("shows retry button in degraded state", () => {
    const onRetry = jest.fn();
    render(<ConnectionStatusBar connectionState="degraded" onRetry={onRetry} />);
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  test("calls onRetry when retry button is clicked in degraded state", () => {
    const onRetry = jest.fn();
    render(<ConnectionStatusBar connectionState="degraded" onRetry={onRetry} />);
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  // ── Disconnected state ──────────────────────────────────────────────────────
  test("shows offline message in disconnected state", () => {
    render(<ConnectionStatusBar connectionState="disconnected" />);
    expect(screen.getByText(/offline/i)).toBeInTheDocument();
  });

  test("shows retry button in disconnected state", () => {
    const onRetry = jest.fn();
    render(<ConnectionStatusBar connectionState="disconnected" onRetry={onRetry} />);
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  test("applies disconnected CSS class", () => {
    const { container } = render(
      <ConnectionStatusBar connectionState="disconnected" />,
    );
    expect(container.firstChild).toHaveClass("csb--disconnected");
  });

  // ── Auth expired state ──────────────────────────────────────────────────────
  test("shows session expired message in auth_expired state", () => {
    render(<ConnectionStatusBar connectionState="auth_expired" />);
    expect(screen.getByText(/session expired/i)).toBeInTheDocument();
  });

  test("does NOT show retry button in auth_expired state", () => {
    const onRetry = jest.fn();
    render(<ConnectionStatusBar connectionState="auth_expired" onRetry={onRetry} />);
    expect(screen.queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
  });

  test("applies auth-expired CSS class", () => {
    const { container } = render(
      <ConnectionStatusBar connectionState="auth_expired" />,
    );
    expect(container.firstChild).toHaveClass("csb--auth-expired");
  });

  // ── Transport fallback state ────────────────────────────────────────────────
  test("shows fallback connection message", () => {
    render(<ConnectionStatusBar connectionState="transport_fallback" />);
    expect(screen.getByText(/fallback/i)).toBeInTheDocument();
  });

  // ── Accessibility ───────────────────────────────────────────────────────────
  test("has role='status' for screen readers", () => {
    render(<ConnectionStatusBar connectionState="disconnected" />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  test("has aria-live='polite' for non-intrusive announcements", () => {
    render(<ConnectionStatusBar connectionState="reconnecting" reconnectAttempt={1} />);
    const statusEl = screen.getByRole("status");
    expect(statusEl).toHaveAttribute("aria-live", "polite");
  });

  test("icon has aria-hidden='true' to avoid duplicate announcements", () => {
    render(<ConnectionStatusBar connectionState="disconnected" />);
    const icon = document.querySelector(".csb__icon");
    expect(icon).toHaveAttribute("aria-hidden", "true");
  });

  // ── Retry button not rendered when onRetry is not provided ─────────────────
  test("does not render retry button when onRetry prop is missing", () => {
    render(<ConnectionStatusBar connectionState="disconnected" />);
    // onRetry not passed — button should not render even though state supports it
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  // ── Default reconnectAttempt ────────────────────────────────────────────────
  test("handles missing reconnectAttempt gracefully (defaults to 0)", () => {
    render(<ConnectionStatusBar connectionState="reconnecting" />);
    expect(screen.getByText(/attempt 0/i)).toBeInTheDocument();
  });
});
