/**
 * Feature-Based Permission Middleware
 *
 * Simple permission checks based on features and operations
 */

const { hasFeatureAccess, isGlobalRole } = require('../rbac/features');
const { ForbiddenError, UnauthorizedError } = require('../utils/errors');
const { log } = require('../logger');

/**
 * Require access to a feature with specific operation(s)
 * @param {string} feature - Feature name (from FEATURES)
 * @param {string|string[]} operations - Operation(s) required (read, write, delete, etc.)
 * @param {object} options - { requireAll: boolean } - if multiple operations, require all or any
 */
function requireFeature(feature, operations, options = {}) {
  const ops = Array.isArray(operations) ? operations : [operations];
  const { requireAll = false } = options;

  return async (req, _res, next) => {
    if (!req.user) {
      log('warn', 'Feature access denied: No user context', {
        path: req.path,
        feature,
        operations: ops,
      });
      return next(new UnauthorizedError('Authentication required'));
    }

    let hasAccess = false;

    try {
      if (requireAll) {
        // User must have ALL operations
        const accessChecks = await Promise.all(ops.map((op) => hasFeatureAccess(req.user, feature, op)));
        hasAccess = accessChecks.every((check) => check);
      } else {
        // User must have AT LEAST ONE operation
        const accessChecks = await Promise.all(ops.map((op) => hasFeatureAccess(req.user, feature, op)));
        hasAccess = accessChecks.some((check) => check);
      }

      if (!hasAccess) {
        log('warn', 'Feature access denied: Insufficient permissions', {
          userId: req.user.id,
          userRole: req.user.role,
          feature,
          requiredOperations: ops,
          requireAll,
          path: req.path,
        });

        return next(new ForbiddenError(`You do not have permission to ${ops.join('/')} ${feature}`));
      }

      // Access granted
      next();
    } catch (error) {
      log('error', 'Feature access check failed', {
        error: error.message,
        userId: req.user.id,
        feature,
        operations: ops,
      });
      return next(new ForbiddenError('Permission check failed'));
    }
  };
}

/**
 * Require SUPER_ADMIN role
 */
function requireSuperAdmin(req, _res, next) {
  if (!req.user) {
    return next(new UnauthorizedError('Authentication required'));
  }

  if (req.user.role !== 'SUPER_ADMIN') {
    log('warn', 'Super Admin required', {
      userId: req.user.id,
      userRole: req.user.role,
      path: req.path,
    });
    return next(new ForbiddenError('Super Admin access required'));
  }

  next();
}

/**
 * Require ADMIN or SUPER_ADMIN role
 */
function requireAdmin(req, _res, next) {
  if (!req.user) {
    return next(new UnauthorizedError('Authentication required'));
  }

  if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'ADMIN') {
    log('warn', 'Admin required', {
      userId: req.user.id,
      userRole: req.user.role,
      path: req.path,
    });
    return next(new ForbiddenError('Admin access required'));
  }

  next();
}

/**
 * Require global scope (SUPER_ADMIN or ADMIN)
 */
function requireGlobalScope(req, _res, next) {
  if (!req.user) {
    return next(new UnauthorizedError('Authentication required'));
  }

  if (!isGlobalRole(req.user.role)) {
    log('warn', 'Global scope required', {
      userId: req.user.id,
      userRole: req.user.role,
      path: req.path,
    });
    return next(new ForbiddenError('Global access required'));
  }

  next();
}

/**
 * Attach user features to request (for frontend)
 */
const { getUserFeatures } = require('../rbac/features');

async function attachFeatures(req, _res, next) {
  if (req.user) {
    try {
      req.userFeatures = await getUserFeatures(req.user);
    } catch (error) {
      log('error', 'Failed to attach user features', {
        error: error.message,
        userId: req.user.id,
      });
      // Continue anyway with empty features
      req.userFeatures = {};
    }
  }
  next();
}

module.exports = {
  requireFeature,
  requireSuperAdmin,
  requireAdmin,
  requireGlobalScope,
  attachFeatures,
};
