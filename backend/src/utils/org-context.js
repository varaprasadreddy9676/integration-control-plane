function parsePositiveInt(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function getOrgIdFromQuery(query = {}) {
  return parsePositiveInt(query.orgId);
}

function getOrgIdFromRequest(req = {}) {
  return parsePositiveInt(req.orgId) || getOrgIdFromQuery(req.query);
}

module.exports = {
  parsePositiveInt,
  getOrgIdFromQuery,
  getOrgIdFromRequest,
};
