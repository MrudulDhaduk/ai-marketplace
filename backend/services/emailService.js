/**
 * emailService.js — Transactional email delivery
 *
 * Uses nodemailer with SMTP transport. When SMTP_HOST is not configured
 * (local dev / CI), verification URLs are logged to stdout instead of
 * being sent — no silent failures, no test emails hitting real inboxes.
 *
 * Required env vars for production:
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, EMAIL_FROM, APP_URL
 */

const nodemailer = require("nodemailer");
const config = require("../config/env");
const logger = require("../utils/logger");

// Build transporter lazily so missing SMTP config doesn't crash startup
let _transporter = null;

function getTransporter() {
  if (_transporter) return _transporter;

  if (!config.email.host) {
    // Dev mode: log emails instead of sending them
    return null;
  }

  _transporter = nodemailer.createTransport({
    host: config.email.host,
    port: config.email.port,
    secure: config.email.secure,
    auth: {
      user: config.email.user,
      pass: config.email.pass,
    },
  });

  return _transporter;
}

/**
 * Send an email verification link to a newly registered user.
 * @param {string} toEmail  - recipient email address
 * @param {string} token    - 32-byte hex verification token
 */
async function sendVerificationEmail(toEmail, token) {
  const verifyUrl = `${config.email.appUrl}/verify-email?token=${token}`;

  const transporter = getTransporter();

  if (!transporter) {
    // Dev fallback — log the URL so developers can verify manually
    logger.info("EMAIL_VERIFICATION (dev mode — no SMTP configured)", {
      to: toEmail,
      verifyUrl,
    });
    return;
  }

  await transporter.sendMail({
    from: `"NeuralForge" <${config.email.from}>`,
    to: toEmail,
    subject: "Verify your NeuralForge account",
    text: `Welcome to NeuralForge!\n\nPlease verify your email address by visiting:\n${verifyUrl}\n\nThis link expires in 24 hours.\n\nIf you did not create an account, you can safely ignore this email.`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#0f0f13;color:#e2e8f0;border-radius:12px;">
        <h1 style="font-size:22px;margin-bottom:8px;color:#fff;">Verify your email</h1>
        <p style="color:#94a3b8;margin-bottom:24px;">Click the button below to verify your NeuralForge account. This link expires in 24 hours.</p>
        <a href="${verifyUrl}"
           style="display:inline-block;padding:12px 28px;background:linear-gradient(135deg,#4f8ef7,#7c5cfc);color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:15px;">
          Verify Email Address
        </a>
        <p style="margin-top:24px;font-size:13px;color:#64748b;">
          Or copy this URL into your browser:<br/>
          <a href="${verifyUrl}" style="color:#4f8ef7;word-break:break-all;">${verifyUrl}</a>
        </p>
        <p style="margin-top:32px;font-size:12px;color:#475569;">If you did not create an account, you can safely ignore this email.</p>
      </div>
    `,
  });

  logger.info("Verification email sent", { to: toEmail });
}

module.exports = { sendVerificationEmail };
