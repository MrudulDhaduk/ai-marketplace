/**
 * VerifyEmail.jsx — Email verification landing page
 *
 * Handles GET /verify-email?token=... links sent in verification emails.
 * Calls the backend, shows success/error state, and redirects to login.
 */
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { apiRequest } from "../lib/api";
import "../auth.css";

export default function VerifyEmail() {
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState("loading"); // loading | success | expired | error
  const [message, setMessage] = useState("");
  const [resendEmail, setResendEmail] = useState("");
  const [resendSent, setResendSent] = useState(false);

  useEffect(() => {
    const token = searchParams.get("token");
    if (!token) {
      setStatus("error");
      setMessage("No verification token found in the URL.");
      return;
    }

    apiRequest(`/auth/verify-email?token=${encodeURIComponent(token)}`)
      .then(async (res) => {
        const data = await res.json();
        if (res.ok) {
          setStatus("success");
          setMessage(data.message || "Email verified successfully.");
        } else if (data?.code === "TOKEN_EXPIRED") {
          setStatus("expired");
          setMessage(data.message || "Verification link has expired.");
        } else {
          setStatus("error");
          setMessage(data?.message || "Verification failed.");
        }
      })
      .catch(() => {
        setStatus("error");
        setMessage("Network error. Please try again.");
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleResend = async (e) => {
    e.preventDefault();
    if (!resendEmail) return;
    try {
      await apiRequest("/auth/resend-verification", {
        method: "POST",
        body: JSON.stringify({ email: resendEmail }),
      });
      setResendSent(true);
    } catch {
      setMessage("Failed to resend. Please try again.");
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-bg">
        <div className="auth-orb auth-orb--1" />
        <div className="auth-orb auth-orb--2" />
        <div className="auth-grid" />
      </div>

      <div className="auth-right" style={{ width: "100%", justifyContent: "center" }}>
        <div className="auth-card" style={{ textAlign: "center", maxWidth: 440 }}>

          {status === "loading" && (
            <>
              <div style={{ fontSize: 40, marginBottom: 16 }}>⏳</div>
              <h2>Verifying your email…</h2>
              <p style={{ color: "#94a3b8" }}>Please wait a moment.</p>
            </>
          )}

          {status === "success" && (
            <>
              <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
              <h2>Email verified</h2>
              <p style={{ color: "#94a3b8", marginBottom: 24 }}>{message}</p>
              <Link to="/login" className="auth-submit-btn" style={{ display: "inline-block", textDecoration: "none" }}>
                Sign in →
              </Link>
            </>
          )}

          {status === "expired" && (
            <>
              <div style={{ fontSize: 48, marginBottom: 16 }}>⏰</div>
              <h2>Link expired</h2>
              <p style={{ color: "#94a3b8", marginBottom: 24 }}>{message}</p>
              {resendSent ? (
                <p style={{ color: "#4ade80" }}>New verification email sent. Check your inbox.</p>
              ) : (
                <form onSubmit={handleResend} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <input
                    type="email"
                    className="auth-input"
                    placeholder="Enter your email to resend"
                    value={resendEmail}
                    onChange={(e) => setResendEmail(e.target.value)}
                    required
                    aria-label="Email address"
                  />
                  <button type="submit" className="auth-submit-btn">Resend verification email</button>
                </form>
              )}
            </>
          )}

          {status === "error" && (
            <>
              <div style={{ fontSize: 48, marginBottom: 16 }}>❌</div>
              <h2>Verification failed</h2>
              <p style={{ color: "#94a3b8", marginBottom: 24 }}>{message}</p>
              <Link to="/login" className="auth-link">Back to login</Link>
            </>
          )}

        </div>
      </div>
    </div>
  );
}
