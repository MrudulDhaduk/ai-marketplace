const validators = require("../utils/validation");

function validateBody(validator) {
  return (req, res, next) => {
    const error = validator(req.body || {});
    if (error) return res.status(400).json({ message: error });
    return next();
  };
}

function validateProjectReview({ action, feedback }) {
  if (!action || !["approve", "revision"].includes(action)) {
    return "Invalid action. Must be 'approve' or 'revision'";
  }
  if (feedback !== undefined && feedback !== null && typeof feedback !== "string") {
    return "Feedback must be a string";
  }
  if (feedback && feedback.length > 2000) return "Feedback must be 2000 characters or less";
  return null;
}

function validateSubmissionNote({ notes }) {
  if (!validators.isNonEmptyString(notes, 2000)) {
    return "Notes must be a non-empty string (max 2000 chars)";
  }
  return null;
}

function validateSkill({ skill }) {
  if (!validators.isNonEmptyString(skill, 60)) {
    return "Skill must be a non-empty string (max 60 chars)";
  }
  return null;
}

function validateFileReorder(body) {
  if (!Array.isArray(body)) return "Invalid reorder payload: expected array";
  for (const item of body) {
    if (!Number.isInteger(item?.id) || !Number.isInteger(item?.position) || item.position < 1) {
      return "Each item must have positive integer id and position";
    }
  }
  return null;
}

module.exports = {
  validateBody,
  validateSignup: validateBody(validators.validateSignup),
  validateLogin: validateBody(validators.validateLogin),
  validateProject: validateBody(validators.validateProject),
  validateBid: validateBody(validators.validateBid),
  validateSubmission: validateBody(validators.validateSubmission),
  validateProjectReview: validateBody(validateProjectReview),
  validateSubmissionNote: validateBody(validateSubmissionNote),
  validateSkill: validateBody(validateSkill),
  validateFileReorder: validateBody(validateFileReorder),
};
