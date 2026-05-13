function requireFields(body, fields) {
  const missing = fields.filter((field) => body[field] === undefined || body[field] === null || body[field] === "");
  return missing.length ? `${missing.join(", ")} required` : null;
}

function isPositiveNumber(value) {
  return Number.isFinite(Number(value)) && Number(value) > 0;
}

function isNonEmptyString(value, max = 5000) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}

module.exports = { requireFields, isPositiveNumber, isNonEmptyString };
