const express = require("express");
const { authenticateUser, requireRole, requireSelfParam, optionalAuth } = require("../middleware/auth");
const { authLimiter, uploadLimiter, resendLimiter, doubleCsrfProtection, generateCsrfToken } = require("../middleware/security");
const validation = require("../middleware/validation");
const { idempotency } = require("../middleware/idempotency");

const authController         = require("../controllers/authController");
const profileController      = require("../controllers/profileController");
const projectController      = require("../controllers/projectController");
const bidController          = require("../controllers/bidController");
const submissionController   = require("../controllers/submissionController");
const uploadController       = require("../controllers/uploadController");
const notificationController = require("../controllers/notificationController");
const messageController      = require("../controllers/messageController");
const statsController        = require("../controllers/statsController");
const activityController     = require("../controllers/activityController");

module.exports = function createRoutes(io) {
  const router = express.Router();

  // Attach io to every request so controllers can emit events
  router.use((req, _res, next) => {
    req.io = io;
    next();
  });

  // ── Health ──────────────────────────────────────────────────────────────────
  // NOTE: intentionally kept public for load-balancer health checks.
  // Sensitive fields (DB pool stats, env name) have been removed — see healthCheck controller.
  router.get("/health", projectController.healthCheck);

  // ── CSRF token ──────────────────────────────────────────────────────────────
  // Frontend fetches this on app load and attaches the value to all
  // state-changing requests via the x-csrf-token header.
  router.get("/auth/csrf-token", (req, res) => {
    const token = generateCsrfToken(req, res);
    res.json({ csrfToken: token });
  });

  // ── Auth ────────────────────────────────────────────────────────────────────
  // Signup and login are exempt from CSRF (they establish the session).
  // /auth/refresh is exempt — the httpOnly refresh cookie IS the proof of identity.
  // All other state-changing auth routes require a valid CSRF token.
  router.post("/auth/signup",                authLimiter, validation.validateSignup,  authController.signup);
  router.post("/auth/login",                 authLimiter, validation.validateLogin,   authController.login);
  router.post("/auth/refresh",               authLimiter,                             authController.refresh);
  router.post("/auth/logout",                doubleCsrfProtection,                   authController.logout);
  router.get("/auth/me",                     authenticateUser,                        authController.getMe);
  router.get("/auth/verify-email",           authController.verifyEmail);
  router.post("/auth/resend-verification",   authLimiter, resendLimiter,              authController.resendVerification);

  // ── Profile ─────────────────────────────────────────────────────────────────
  router.get("/profile/:id",         optionalAuth,                                                                          profileController.getProfile);
  router.put("/profile/:id",         authenticateUser, requireSelfParam("id"), doubleCsrfProtection,                       profileController.updateProfile);
  router.get("/profile/:id/skills",  authenticateUser,                                                                     profileController.getSkills);
  router.post("/profile/:id/skills", authenticateUser, requireSelfParam("id"), doubleCsrfProtection, validation.validateSkill, profileController.addSkill);
  router.delete("/profile/:id/skills", authenticateUser, requireSelfParam("id"), doubleCsrfProtection, validation.validateSkill, profileController.removeSkill);

  // ── Projects ─────────────────────────────────────────────────────────────────
  router.post("/api/projects",          authenticateUser, requireRole("client"), doubleCsrfProtection, validation.validateProject, projectController.createProject);
  router.get("/api/projects",           authenticateUser, requireRole("client"),                                                   projectController.getClientProjects);
  router.get("/api/projects/:id",       authenticateUser,                                                                          projectController.getProject);
  router.get("/projects",                                                                                    projectController.listPublicProjects);
  router.get("/projects/discover/:id",  authenticateUser, requireSelfParam("id"),                           projectController.discoverProjects);
  router.get("/projects/assigned/:id",  authenticateUser, requireSelfParam("id"),                           projectController.getAssignedProjects);
  router.put("/projects/:id/complete",  authenticateUser, doubleCsrfProtection,                             projectController.completeProject);
  router.put("/projects/:id/review",    authenticateUser, doubleCsrfProtection, validation.validateProjectReview, projectController.reviewProject);
  router.post("/projects/:id/request-update", authenticateUser, doubleCsrfProtection,                      projectController.requestUpdate);
  router.patch("/projects/:id/urgent",  authenticateUser, doubleCsrfProtection,                             projectController.setUrgent);

  // ── Bids ─────────────────────────────────────────────────────────────────────
  router.post("/projects/:id/bid",                    authenticateUser, doubleCsrfProtection, idempotency(), validation.validateBid, bidController.placeBid);
  router.get("/api/projects/:projectId/bids",         authenticateUser,                                               bidController.getProjectBids);
  router.post("/api/projects/:projectId/accept-bid/:bidId", authenticateUser, doubleCsrfProtection, idempotency(),   bidController.acceptBid);
  router.get("/bids/developer/:id",                   authenticateUser, requireSelfParam("id"),                       bidController.getDeveloperBids);

  // ── Submissions ───────────────────────────────────────────────────────────────
  router.post("/projects/:id/submit",                  authenticateUser, doubleCsrfProtection, idempotency(), validation.validateSubmission,     submissionController.submitProject);
  router.get("/projects/:id/submissions",              authenticateUser,                                                           submissionController.getSubmissions);
  router.post("/projects/:projectId/submissions",      authenticateUser, doubleCsrfProtection, idempotency(), validation.validateSubmissionNote, submissionController.addSubmissionNote);
  router.put("/projects/:projectId/submissions/:id",   authenticateUser, doubleCsrfProtection, validation.validateSubmissionNote, submissionController.updateSubmission);
  router.delete("/projects/:projectId/submissions/:id", authenticateUser, doubleCsrfProtection,                                   submissionController.deleteSubmission);

  // ── File uploads ──────────────────────────────────────────────────────────────
  // CSRF is intentionally skipped on multipart upload — the doubleCsrf middleware
  // does not parse multipart bodies. The route is protected by authenticateUser
  // + uploadLimiter + project-level ownership check inside the controller.
  router.post("/projects/:id/upload",  authenticateUser, uploadLimiter, uploadController.uploadFiles);
  router.get("/projects/:id/files",    authenticateUser,                uploadController.getProjectFiles);
  router.delete("/files/:id",          authenticateUser, doubleCsrfProtection, uploadController.deleteFile);
  router.put("/files/reorder",         authenticateUser, doubleCsrfProtection, validation.validateFileReorder, uploadController.reorderFiles);
  router.get("/files/:id/url",         authenticateUser,                uploadController.getFileUrl);

  // ── Notifications ─────────────────────────────────────────────────────────────
  router.get("/notifications",              authenticateUser, notificationController.getNotifications);
  router.put("/notifications/read-all",     authenticateUser, doubleCsrfProtection, notificationController.markAllRead);
  router.put("/notifications/:id/read",     authenticateUser, doubleCsrfProtection, notificationController.markRead);

  // ── Messages ──────────────────────────────────────────────────────────────────
  router.get("/projects/:id/messages",      authenticateUser, messageController.getMessages);
  router.post("/projects/:id/messages",     authenticateUser, doubleCsrfProtection, messageController.sendMessage);
  router.get("/api/messages/unread-count",  authenticateUser, messageController.getUnreadCount);

  // ── Stats & Activity ──────────────────────────────────────────────────────────
  router.get("/api/stats/client",       authenticateUser, requireRole("client"),    statsController.getClientStats);
  router.get("/api/stats/developer",    authenticateUser, requireRole("developer"), statsController.getDeveloperStats);
  router.get("/api/activity/client",    authenticateUser, requireRole("client"),    statsController.getClientActivity);
  router.get("/api/activity/developer", authenticateUser, requireRole("developer"), statsController.getDeveloperActivity);

  // ── Workspace Activity Engine ─────────────────────────────────────────────────
  router.get("/projects/:id/activity",                                    authenticateUser, activityController.getActivity);
  router.post("/projects/:id/activity/:eventId/approve",                  authenticateUser, doubleCsrfProtection, activityController.approveEntry);
  router.post("/projects/:id/activity/:eventId/revision",                 authenticateUser, doubleCsrfProtection, activityController.requestRevisionOnEntry);
  router.post("/projects/:id/activity/:eventId/resolve",                  authenticateUser, doubleCsrfProtection, activityController.resolveEntry);
  router.get("/projects/:id/activity/:eventId/comments",                  authenticateUser, activityController.getComments);
  router.post("/projects/:id/activity/:eventId/comments",                 authenticateUser, doubleCsrfProtection, activityController.addComment);

  return router;
};
