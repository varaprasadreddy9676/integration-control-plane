'use strict';

/**
 * Portal Scope Enforcement Middleware
 *
 * Enforces allowedIntegrationIds and allowedTags restrictions for portal sessions
 * (JWTs with `isPortalSession: true` and `type: 'portal_access'`).
 *
 * Usage in routes:
 *   const { filterIntegrationScope, assertViewAllowed } = require('../middleware/portal-scope');
 *
 *   // Filter a list of integrations to only those the portal profile can see:
 *   router.get('/', asyncHandler(async (req, res) => {
 *     let integrations = await data.listIntegrations(req.orgId);
 *     integrations = filterIntegrationScope(req, integrations);
 *     res.json(integrations);
 *   }));
 *
 *   // Block access to a single integration if it's out of scope:
 *   router.get('/:id', assertViewAllowed('dashboard'), asyncHandler(...))
 *
 * Non-portal requests pass through unchanged.
 */

const { ForbiddenError } = require('../utils/errors');

/**
 * Returns true when the current request is a scoped portal session
 * (i.e. uses the new profile-based token, not the legacy one).
 */
function isPortalScopedSession(req) {
  return !!(req.user?.isPortalSession && req.portalScope);
}

/**
 * Tests whether a single integration is within the portal's scope.
 *
 * Scope rules:
 *   1. If allowedIntegrationIds is non-empty, the integration ID must be in the list.
 *   2. If allowedTags is non-empty, the integration must have at least one matching tag.
 *   3. If both lists are empty, ALL integrations in the org are visible.
 *
 * An integration passes if it satisfies rule 1 OR rule 2 (when both are set).
 * If only one restriction is set, that one governs.
 */
function integrationInScope(scope, integration) {
  if (!scope) return true;

  const { allowedIntegrationIds, allowedTags } = scope;
  const hasIdFilter = Array.isArray(allowedIntegrationIds) && allowedIntegrationIds.length > 0;
  const hasTagFilter = Array.isArray(allowedTags) && allowedTags.length > 0;

  // No restrictions — all integrations are visible
  if (!hasIdFilter && !hasTagFilter) return true;

  const integrationId = String(
    integration._id || integration.id || integration.configId || ''
  );
  const integrationTags = Array.isArray(integration.tags) ? integration.tags : [];

  if (hasIdFilter && allowedIntegrationIds.includes(integrationId)) return true;
  if (hasTagFilter && integrationTags.some((t) => allowedTags.includes(t))) return true;

  return false;
}

/**
 * Filter a list of integrations to only those permitted by the portal scope.
 * Non-portal requests return the list unchanged.
 */
function filterIntegrationScope(req, integrations) {
  if (!isPortalScopedSession(req)) return integrations;
  if (!Array.isArray(integrations)) return integrations;
  return integrations.filter((i) => integrationInScope(req.portalScope, i));
}

/**
 * Express middleware that short-circuits with 404 (not 403, to avoid leaking info)
 * if a specific integration is out of scope.
 *
 * Usage: place AFTER the integration is loaded onto req, or pass as a helper.
 * More commonly used as a helper function called inside route handlers.
 */
function assertIntegrationInScope(req, integration) {
  if (!isPortalScopedSession(req)) return;
  if (!integration) return;
  if (!integrationInScope(req.portalScope, integration)) {
    // Return 404 rather than 403 to avoid leaking the existence of integrations
    const { NotFoundError } = require('../utils/errors');
    throw new NotFoundError('Integration not found');
  }
}

/**
 * Middleware factory: asserts that the requested view (e.g. 'dashboard' or 'logs')
 * is in the portal's allowedViews list.
 * Non-portal requests pass through.
 *
 * Usage: router.get('/dashboard', assertViewAllowed('dashboard'), asyncHandler(...))
 */
function assertViewAllowed(viewName) {
  return (req, _res, next) => {
    if (!isPortalScopedSession(req)) return next();
    const allowed = req.portalScope?.allowedViews ?? ['dashboard', 'logs'];
    if (!allowed.includes(viewName)) {
      return next(new ForbiddenError(`This portal profile does not have access to the '${viewName}' view`));
    }
    return next();
  };
}

/**
 * Middleware that blocks mutating requests (POST/PUT/PATCH/DELETE) for
 * portal sessions with VIEWER role.
 * INTEGRATION_EDITOR portal sessions may perform writes on in-scope integrations.
 *
 * Usage: router.post('/', assertPortalNotReadOnly, asyncHandler(...))
 */
function assertPortalNotReadOnly(req, _res, next) {
  if (!isPortalScopedSession(req)) return next();
  const role = req.user?.role;
  if (role === 'VIEWER') {
    return next(new ForbiddenError('Portal viewer sessions cannot perform write operations'));
  }
  return next();
}

module.exports = {
  isPortalScopedSession,
  integrationInScope,
  filterIntegrationScope,
  assertIntegrationInScope,
  assertViewAllowed,
  assertPortalNotReadOnly,
};
