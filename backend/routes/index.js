const express = require("express");
const { authenticateUser, requireSelfParam, optionalAuth } = require("../middleware/auth");
const { authLimiter, uploadLimiter } = require("../middleware/security");
const validation = require("../middleware/validation");

const authController         = require("../controllers/authController");
const profileController      = require("../controllers/profileController");
const projectController      = require("../controllers/projectController");
const bidController          = require("../controllers/bidController");
const submissionController   = require("../controllers/submissionController");
const uploadController       = require("../controllers/uploadController");
const notificationController = require("../controllers/notificationController");
const messageController      = require("../controllers/messageController");
const statsController        = require("../controllers/statsController");

module.exports = function createRoutes(io) {
  const router = express.Router();

  // Attach io to every request so controllers can emit events
  router.use((req, _res, next) => {
    req.io = io;
    next();
  });

  // ── Health ──────────────────────────────────────────────────────────────────
  router.get("/health", projectController.healthCheck);

  // ── Auth ────────────────────────────────────────────────────────────────────
  router.post("/auth/signup", authLimiter, validation.validateSignup, authController.signup);
  router.post("/auth/login",  authLimiter, validation.validateLogin,  authController.login);

  // ── Profile ─────────────────────────────────────────────────────────────────
  router.get("/profile/:id",         optionalAuth,                                                  profileController.getProfile);
  router.put("/profile/:id",         authenticateUser, requireSelfParam("id"),                      profileController.updateProfile);
  router.get("/profile/:id/skills",  authenticateUser,                                              profileController.getSkills);
  router.post("/profile/:id/skills", authenticateUser, requireSelfParam("id"), validation.validateSkill, profileController.addSkill);
  router.delete("/profile/:id/skills", authenticateUser, requireSelfParam("id"), validation.validateSkill, profileController.removeSkill);

  // ── Projects ─────────────────────────────────────────────────────────────────
  router.post("/api/projects",          authenticateUser, validation.validateProject, projectController.createProject);
  router.get("/api/projects",           authenticateUser,                             projectController.getClientProjects);
  router.get("/api/projects/:id",       authenticateUser,                             projectController.getProject);
  router.get("/projects",                                                              projectController.listPublicProjects);
  router.get("/projects/discover/:id",  authenticateUser, requireSelfParam("id"),     projectController.discoverProjects);
  router.get("/projects/assigned/:id",  authenticateUser, requireSelfParam("id"),     projectController.getAssignedProjects);
  router.put("/projects/:id/complete",  authenticateUser,                             projectController.completeProject);
  router.put("/projects/:id/review",    authenticateUser, validation.validateProjectReview, projectController.reviewProject);
  router.post("/projects/:id/request-update", authenticateUser, validation.validateProjectReview, projectController.requestUpdate);

  // ── Bids ─────────────────────────────────────────────────────────────────────
  router.post("/projects/:id/bid",                    authenticateUser, validation.validateBid, bidController.placeBid);
  router.get("/api/projects/:projectId/bids",         authenticateUser,                         bidController.getProjectBids);
  router.post("/api/projects/:projectId/accept-bid/:bidId", authenticateUser,                   bidController.acceptBid);
  router.get("/bids/developer/:id",                   authenticateUser, requireSelfParam("id"),  bidController.getDeveloperBids);

  // ── Submissions ───────────────────────────────────────────────────────────────
  router.post("/projects/:id/submit",                  authenticateUser, validation.validateSubmission,     submissionController.submitProject);
  router.get("/projects/:id/submissions",              authenticateUser,                                     submissionController.getSubmissions);
  router.post("/projects/:projectId/submissions",      authenticateUser, validation.validateSubmissionNote, submissionController.addSubmissionNote);
  router.put("/projects/:projectId/submissions/:id",   authenticateUser, validation.validateSubmissionNote, submissionController.updateSubmission);
  router.delete("/projects/:projectId/submissions/:id", authenticateUser,                                   submissionController.deleteSubmission);

  // ── File uploads ──────────────────────────────────────────────────────────────
  router.post("/projects/:id/upload",  authenticateUser, uploadLimiter, uploadController.uploadFiles);
  router.get("/projects/:id/files",    authenticateUser,                uploadController.getProjectFiles);
  router.delete("/files/:id",          authenticateUser,                uploadController.deleteFile);
  router.put("/files/reorder",         authenticateUser, validation.validateFileReorder, uploadController.reorderFiles);

  // ── Notifications ─────────────────────────────────────────────────────────────
  router.get("/notifications",              authenticateUser, notificationController.getNotifications);
  router.put("/notifications/read-all",     authenticateUser, notificationController.markAllRead);
  router.put("/notifications/:id/read",     authenticateUser, notificationController.markRead);

  // ── Messages ──────────────────────────────────────────────────────────────────
  router.get("/projects/:id/messages",      authenticateUser, messageController.getMessages);
  router.post("/projects/:id/messages",     authenticateUser, messageController.sendMessage);
  router.get("/api/messages/unread-count",  authenticateUser, messageController.getUnreadCount);

  // ── Stats & Activity ──────────────────────────────────────────────────────────
  router.get("/api/stats/client",           authenticateUser, statsController.getClientStats);
  router.get("/api/stats/developer",        authenticateUser, statsController.getDeveloperStats);
  router.get("/api/activity/client",        authenticateUser, statsController.getClientActivity);
  router.get("/api/activity/developer",     authenticateUser, statsController.getDeveloperActivity);

  return router;
};
