function parsePositiveInt(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function getOrgIdFromQuery(query = {}) {
  return parsePositiveInt(query.orgId || query.entityParentRid || query.entityparentrid);
}

function getOrgIdFromRequest(req = {}) {
  return parsePositiveInt(req.orgId) || parsePositiveInt(req.entityParentRid) || getOrgIdFromQuery(req.query);
}

function legacyOrgQuery(orgId) {
  return { $or: [{ orgId }, { entityParentRid: orgId }] };
}

module.exports = {
  parsePositiveInt,
  getOrgIdFromQuery,
  getOrgIdFromRequest,
  legacyOrgQuery,
};
