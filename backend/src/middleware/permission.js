/**
 * Permission Middleware
 *
 * Checks if user has required permissions to access routes
 */

const { userHasPermission } = require('../rbac/permissions');
const { ForbiddenError, UnauthorizedError } = require('../utils/errors');
const { log } = require('../logger');

/**
 * Middleware to check if user has required permission(s)
 * @param {string|string[]} requiredPermissions - Single permission or array of permissions
 * @param {Object} options - Options { requireAll: boolean }
 * @returns {Function} Express middleware
 *
 * Examples:
 *   requirePermission('integrations:view')
 *   requirePermission(['integrations:view', 'integrations:edit'])
 *   requirePermission(['integrations:view', 'integrations:edit'], { requireAll: true })
 */
function requirePermission(requiredPermissions, options = {}) {
  const permissions = Array.isArray(requiredPermissions)
    ? requiredPermissions
    : [requiredPermissions];

  const { requireAll = false } = options;

  return (req, res, next) => {
    if (!req.user) {
      log('warn', 'Permission check failed: No user context', {
        path: req.path,
        requiredPermissions: permissions
      });
      return next(new UnauthorizedError('Authentication required'));
    }

    // Check if user has the required permission(s)
    let hasAccess = false;

    if (requireAll) {
      // User must have ALL permissions
      hasAccess = permissions.every(permission =>
        userHasPermission(req.user, permission)
      );
    } else {
      // User must have AT LEAST ONE permission
      hasAccess = permissions.some(permission =>
        userHasPermission(req.user, permission)
      );
    }

    if (!hasAccess) {
      log('warn', 'Permission check failed: Insufficient permissions', {
        userId: req.user.id,
        userRole: req.user.role,
        requiredPermissions: permissions,
        requireAll,
        path: req.path
      });

      return next(new ForbiddenError(
        requireAll
          ? 'You do not have all the required permissions'
          : 'You do not have permission to access this resource'
      ));
    }

    // Access granted
    next();
  };
}

/**
 * Middleware to check if user is Super Admin
 */
function requireSuperAdmin(req, res, next) {
  if (!req.user) {
    return next(new UnauthorizedError('Authentication required'));
  }

  if (req.user.role !== 'SUPER_ADMIN') {
    log('warn', 'Super Admin required', {
      userId: req.user.id,
      userRole: req.user.role,
      path: req.path
    });
    return next(new ForbiddenError('Super Admin access required'));
  }

  next();
}

/**
 * Middleware to check if user is Admin (SUPER_ADMIN or ADMIN)
 */
function requireAdmin(req, res, next) {
  if (!req.user) {
    return next(new UnauthorizedError('Authentication required'));
  }

  if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'ADMIN') {
    log('warn', 'Admin required', {
      userId: req.user.id,
      userRole: req.user.role,
      path: req.path
    });
    return next(new ForbiddenError('Admin access required'));
  }

  next();
}

/**
 * Middleware to attach user permissions to request
 * Useful for frontend to know what user can do
 */
const { getUserPermissions } = require('../rbac/permissions');

function attachPermissions(req, res, next) {
  if (req.user) {
    req.userPermissions = getUserPermissions(req.user);
  }
  next();
}

module.exports = {
  requirePermission,
  requireSuperAdmin,
  requireAdmin,
  attachPermissions
};
