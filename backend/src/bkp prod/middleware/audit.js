const { logAudit, ACTION_TYPES, RESOURCE_TYPES } = require('../services/audit-logger');

/**
 * Audit middleware - automatically logs API actions
 * Add this to routes that need audit logging
 */

/**
 * Helper to extract IP address from request
 */
function getIpAddress(req) {
  return req.headers['x-forwarded-for']?.split(',')[0] ||
    req.headers['x-real-ip'] ||
    req.connection?.remoteAddress ||
    req.socket?.remoteAddress ||
    null;
}

/**
 * Helper to determine action type from HTTP method
 */
function getActionFromMethod(method) {
  const methodMap = {
    'POST': ACTION_TYPES.CREATE,
    'PUT': ACTION_TYPES.UPDATE,
    'PATCH': ACTION_TYPES.UPDATE,
    'DELETE': ACTION_TYPES.DELETE,
    'GET': ACTION_TYPES.READ
  };
  return methodMap[method] || ACTION_TYPES.READ;
}

/**
 * Helper to determine resource type from URL
 */
function getResourceTypeFromUrl(url) {
  if (url.includes('/users')) return RESOURCE_TYPES.USER;
  if (url.includes('/roles')) return RESOURCE_TYPES.ROLE;
  if (url.includes('/orgs')) return RESOURCE_TYPES.ORGANIZATION;
  if (url.includes('/integrations')) return RESOURCE_TYPES.INTEGRATION;
  if (url.includes('/templates')) return RESOURCE_TYPES.TEMPLATE;
  if (url.includes('/lookups')) return RESOURCE_TYPES.LOOKUP_TABLE;
  if (url.includes('/scheduled-jobs')) return RESOURCE_TYPES.SCHEDULED_JOB;
  if (url.includes('/alert')) return RESOURCE_TYPES.ALERT;
  if (url.includes('/config')) return RESOURCE_TYPES.CONFIG;
  if (url.includes('/api-key')) return RESOURCE_TYPES.API_KEY;
  return null;
}

/**
 * Create audit middleware with custom options
 * @param {Object} options
 * @param {string} options.action Override action type
 * @param {string} options.resourceType Override resource type
 * @param {Function} options.getResourceId Function to extract resource ID from req
 * @param {Function} options.getChanges Function to extract changes from req/res
 * @param {Function} options.getMetadata Function to extract metadata from req/res
 */
function auditMiddleware(options = {}) {
  return async (req, res, next) => {
    // Store original end function
    const originalEnd = res.end;

    // Override res.end to capture the response
    res.end = function(...args) {
      // Restore original end
      res.end = originalEnd;

      // Log the audit entry asynchronously (don't wait)
      setImmediate(async () => {
        try {
          const action = options.action || getActionFromMethod(req.method);
          const resourceType = options.resourceType || getResourceTypeFromUrl(req.path);

          // Skip audit for GET requests unless specifically requested
          if (req.method === 'GET' && !options.auditReads) {
            return;
          }

          // Extract resource ID
          let resourceId = null;
          if (options.getResourceId) {
            resourceId = options.getResourceId(req, res);
          } else if (req.params?.id) {
            resourceId = req.params.id;
          } else if (req.params?.role) {
            resourceId = req.params.role;
          } else if (req.params?.orgId) {
            resourceId = req.params.orgId;
          }

          // Extract changes
          let changes = null;
          if (options.getChanges) {
            changes = options.getChanges(req, res);
          }

          // Extract metadata
          let metadata = {};
          if (options.getMetadata) {
            metadata = options.getMetadata(req, res);
          }

          await logAudit({
            action,
            resourceType,
            resourceId,
            user: req.user,
            orgId: req.entityParentRid || req.user?.orgId,
            changes,
            metadata,
            ipAddress: getIpAddress(req),
            userAgent: req.headers['user-agent'],
            success: res.statusCode < 400,
            errorMessage: res.statusCode >= 400 ? res.statusMessage : null
          });
        } catch (error) {
          // Silent fail - audit logging should never break the app
          console.error('Audit logging error:', error);
        }
      });

      // Call original end
      return originalEnd.apply(res, args);
    };

    next();
  };
}

/**
 * Specific audit helpers for common operations
 */

const auditAuth = {
  login: (success, user, errorMessage = null) => {
    return async (req, res) => {
      await logAudit({
        action: success ? ACTION_TYPES.LOGIN : ACTION_TYPES.LOGIN_FAILED,
        resourceType: RESOURCE_TYPES.USER,
        resourceId: user?.id || user?._id,
        user: success ? user : null,
        ipAddress: getIpAddress(req),
        userAgent: req.headers['user-agent'],
        success,
        errorMessage
      });
    };
  },

  logout: async (req) => {
    await logAudit({
      action: ACTION_TYPES.LOGOUT,
      resourceType: RESOURCE_TYPES.USER,
      resourceId: req.user?.id,
      user: req.user,
      ipAddress: getIpAddress(req),
      userAgent: req.headers['user-agent'],
      success: true
    });
  }
};

const auditUser = {
  created: async (req, newUser) => {
    await logAudit({
      action: ACTION_TYPES.USER_CREATED,
      resourceType: RESOURCE_TYPES.USER,
      resourceId: newUser.id || newUser._id,
      user: req.user,
      orgId: newUser.orgId,
      metadata: {
        newUserEmail: newUser.email,
        newUserRole: newUser.role
      },
      ipAddress: getIpAddress(req),
      userAgent: req.headers['user-agent'],
      success: true
    });
  },

  updated: async (req, userId, changes) => {
    await logAudit({
      action: ACTION_TYPES.USER_UPDATED,
      resourceType: RESOURCE_TYPES.USER,
      resourceId: userId,
      user: req.user,
      changes,
      ipAddress: getIpAddress(req),
      userAgent: req.headers['user-agent'],
      success: true
    });
  },

  deleted: async (req, userId) => {
    await logAudit({
      action: ACTION_TYPES.USER_DELETED,
      resourceType: RESOURCE_TYPES.USER,
      resourceId: userId,
      user: req.user,
      ipAddress: getIpAddress(req),
      userAgent: req.headers['user-agent'],
      success: true
    });
  }
};

const auditRole = {
  created: async (req, newRole) => {
    await logAudit({
      action: ACTION_TYPES.ROLE_CREATED,
      resourceType: RESOURCE_TYPES.ROLE,
      resourceId: newRole.role,
      user: req.user,
      metadata: {
        roleName: newRole.name,
        scope: newRole.scope
      },
      ipAddress: getIpAddress(req),
      userAgent: req.headers['user-agent'],
      success: true
    });
  },

  updated: async (req, role, changes) => {
    await logAudit({
      action: ACTION_TYPES.ROLE_UPDATED,
      resourceType: RESOURCE_TYPES.ROLE,
      resourceId: role,
      user: req.user,
      changes,
      ipAddress: getIpAddress(req),
      userAgent: req.headers['user-agent'],
      success: true
    });
  },

  deleted: async (req, role) => {
    await logAudit({
      action: ACTION_TYPES.ROLE_DELETED,
      resourceType: RESOURCE_TYPES.ROLE,
      resourceId: role,
      user: req.user,
      ipAddress: getIpAddress(req),
      userAgent: req.headers['user-agent'],
      success: true
    });
  }
};

module.exports = {
  auditMiddleware,
  auditAuth,
  auditUser,
  auditRole,
  logAudit
};
