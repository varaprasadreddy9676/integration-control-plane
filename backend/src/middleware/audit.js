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
  if (url.includes('/event-sources')) return RESOURCE_TYPES.EVENT_SOURCE;
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

/**
 * Audit helpers for organization and org unit operations
 */
const auditOrg = {
  created: async (req, newOrg) => {
    await logAudit({
      action: ACTION_TYPES.ORG_CREATED,
      resourceType: RESOURCE_TYPES.ORGANIZATION,
      resourceId: newOrg.rid || newOrg._id,
      user: req.user,
      metadata: { orgName: newOrg.name },
      ipAddress: getIpAddress(req),
      userAgent: req.headers['user-agent'],
      success: true
    });
  },

  updated: async (req, orgId, changes) => {
    await logAudit({
      action: ACTION_TYPES.ORG_UPDATED,
      resourceType: RESOURCE_TYPES.ORGANIZATION,
      resourceId: orgId,
      user: req.user,
      changes,
      ipAddress: getIpAddress(req),
      userAgent: req.headers['user-agent'],
      success: true
    });
  },

  deleted: async (req, orgId, beforeOrg) => {
    await logAudit({
      action: ACTION_TYPES.ORG_DELETED,
      resourceType: RESOURCE_TYPES.ORGANIZATION,
      resourceId: orgId,
      user: req.user,
      changes: { before: beforeOrg, after: null },
      ipAddress: getIpAddress(req),
      userAgent: req.headers['user-agent'],
      success: true
    });
  },

  unitCreated: async (req, orgId, newUnit) => {
    await logAudit({
      action: ACTION_TYPES.ORG_UNIT_CREATED,
      resourceType: RESOURCE_TYPES.ORG_UNIT,
      resourceId: newUnit.rid || newUnit._id,
      user: req.user,
      orgId,
      metadata: { unitName: newUnit.name, orgId },
      ipAddress: getIpAddress(req),
      userAgent: req.headers['user-agent'],
      success: true
    });
  },

  unitUpdated: async (req, orgId, unitRid, changes) => {
    await logAudit({
      action: ACTION_TYPES.ORG_UNIT_UPDATED,
      resourceType: RESOURCE_TYPES.ORG_UNIT,
      resourceId: unitRid,
      user: req.user,
      orgId,
      changes,
      ipAddress: getIpAddress(req),
      userAgent: req.headers['user-agent'],
      success: true
    });
  },

  unitDeleted: async (req, orgId, unitRid, beforeUnit) => {
    await logAudit({
      action: ACTION_TYPES.ORG_UNIT_DELETED,
      resourceType: RESOURCE_TYPES.ORG_UNIT,
      resourceId: unitRid,
      user: req.user,
      orgId,
      changes: { before: beforeUnit, after: null },
      ipAddress: getIpAddress(req),
      userAgent: req.headers['user-agent'],
      success: true
    });
  }
};

/**
 * Audit helpers for integration operations
 */
const auditIntegration = {
  created: async (req, newIntegration) => {
    await logAudit({
      action: ACTION_TYPES.INTEGRATION_CREATED,
      resourceType: RESOURCE_TYPES.INTEGRATION,
      resourceId: newIntegration._id || newIntegration.id,
      user: req.user,
      orgId: req.entityParentRid || req.orgId,
      metadata: { name: newIntegration.name, eventType: newIntegration.eventType },
      ipAddress: getIpAddress(req),
      userAgent: req.headers['user-agent'],
      success: true
    });
  },

  updated: async (req, integrationId, changes) => {
    await logAudit({
      action: ACTION_TYPES.INTEGRATION_UPDATED,
      resourceType: RESOURCE_TYPES.INTEGRATION,
      resourceId: integrationId,
      user: req.user,
      orgId: req.entityParentRid || req.orgId,
      changes,
      ipAddress: getIpAddress(req),
      userAgent: req.headers['user-agent'],
      success: true
    });
  },

  deleted: async (req, integrationId, beforeIntegration) => {
    await logAudit({
      action: ACTION_TYPES.INTEGRATION_DELETED,
      resourceType: RESOURCE_TYPES.INTEGRATION,
      resourceId: integrationId,
      user: req.user,
      orgId: req.entityParentRid || req.orgId,
      changes: { before: beforeIntegration, after: null },
      ipAddress: getIpAddress(req),
      userAgent: req.headers['user-agent'],
      success: true
    });
  },

  duplicated: async (req, originalId, newIntegration) => {
    await logAudit({
      action: ACTION_TYPES.INTEGRATION_DUPLICATED,
      resourceType: RESOURCE_TYPES.INTEGRATION,
      resourceId: newIntegration._id || newIntegration.id,
      user: req.user,
      orgId: req.entityParentRid || req.orgId,
      metadata: { originalId, newName: newIntegration.name },
      ipAddress: getIpAddress(req),
      userAgent: req.headers['user-agent'],
      success: true
    });
  },

  bulkEnabled: async (req, ids) => {
    await logAudit({
      action: ACTION_TYPES.INTEGRATION_BULK_ENABLED,
      resourceType: RESOURCE_TYPES.INTEGRATION,
      user: req.user,
      orgId: req.entityParentRid || req.orgId,
      metadata: { ids, count: ids.length },
      ipAddress: getIpAddress(req),
      userAgent: req.headers['user-agent'],
      success: true
    });
  },

  bulkDisabled: async (req, ids) => {
    await logAudit({
      action: ACTION_TYPES.INTEGRATION_BULK_DISABLED,
      resourceType: RESOURCE_TYPES.INTEGRATION,
      user: req.user,
      orgId: req.entityParentRid || req.orgId,
      metadata: { ids, count: ids.length },
      ipAddress: getIpAddress(req),
      userAgent: req.headers['user-agent'],
      success: true
    });
  },

  bulkDeleted: async (req, ids) => {
    await logAudit({
      action: ACTION_TYPES.INTEGRATION_BULK_DELETED,
      resourceType: RESOURCE_TYPES.INTEGRATION,
      user: req.user,
      orgId: req.entityParentRid || req.orgId,
      metadata: { ids, count: ids.length },
      ipAddress: getIpAddress(req),
      userAgent: req.headers['user-agent'],
      success: true
    });
  },

  secretRotated: async (req, integrationId) => {
    await logAudit({
      action: ACTION_TYPES.INTEGRATION_SECRET_ROTATED,
      resourceType: RESOURCE_TYPES.INTEGRATION,
      resourceId: integrationId,
      user: req.user,
      orgId: req.entityParentRid || req.orgId,
      ipAddress: getIpAddress(req),
      userAgent: req.headers['user-agent'],
      success: true
    });
  },

  secretRemoved: async (req, integrationId) => {
    await logAudit({
      action: ACTION_TYPES.INTEGRATION_SECRET_REMOVED,
      resourceType: RESOURCE_TYPES.INTEGRATION,
      resourceId: integrationId,
      user: req.user,
      orgId: req.entityParentRid || req.orgId,
      ipAddress: getIpAddress(req),
      userAgent: req.headers['user-agent'],
      success: true
    });
  }
};

/**
 * Audit helpers for integration version operations
 */
const auditVersion = {
  created: async (req, integrationName, version) => {
    await logAudit({
      action: ACTION_TYPES.INTEGRATION_VERSION_CREATED,
      resourceType: RESOURCE_TYPES.INTEGRATION_VERSION,
      resourceId: `${integrationName}@${version}`,
      user: req.user,
      orgId: req.entityParentRid || req.orgId,
      metadata: { integrationName, version },
      ipAddress: getIpAddress(req),
      userAgent: req.headers['user-agent'],
      success: true
    });
  },

  updated: async (req, integrationName, version, changes) => {
    await logAudit({
      action: ACTION_TYPES.INTEGRATION_VERSION_UPDATED,
      resourceType: RESOURCE_TYPES.INTEGRATION_VERSION,
      resourceId: `${integrationName}@${version}`,
      user: req.user,
      orgId: req.entityParentRid || req.orgId,
      changes,
      metadata: { integrationName, version },
      ipAddress: getIpAddress(req),
      userAgent: req.headers['user-agent'],
      success: true
    });
  },

  deleted: async (req, integrationName, version, beforeVersion) => {
    await logAudit({
      action: ACTION_TYPES.INTEGRATION_VERSION_DELETED,
      resourceType: RESOURCE_TYPES.INTEGRATION_VERSION,
      resourceId: `${integrationName}@${version}`,
      user: req.user,
      orgId: req.entityParentRid || req.orgId,
      changes: { before: beforeVersion, after: null },
      metadata: { integrationName, version },
      ipAddress: getIpAddress(req),
      userAgent: req.headers['user-agent'],
      success: true
    });
  },

  statusChanged: async (req, integrationName, version, changes) => {
    await logAudit({
      action: ACTION_TYPES.INTEGRATION_VERSION_STATUS,
      resourceType: RESOURCE_TYPES.INTEGRATION_VERSION,
      resourceId: `${integrationName}@${version}`,
      user: req.user,
      orgId: req.entityParentRid || req.orgId,
      changes,
      metadata: { integrationName, version },
      ipAddress: getIpAddress(req),
      userAgent: req.headers['user-agent'],
      success: true
    });
  },

  defaultSet: async (req, integrationName, version, changes) => {
    await logAudit({
      action: ACTION_TYPES.INTEGRATION_DEFAULT_VERSION,
      resourceType: RESOURCE_TYPES.INTEGRATION_VERSION,
      resourceId: `${integrationName}@${version}`,
      user: req.user,
      orgId: req.entityParentRid || req.orgId,
      changes,
      metadata: { integrationName, version },
      ipAddress: getIpAddress(req),
      userAgent: req.headers['user-agent'],
      success: true
    });
  },

  rolledBack: async (req, integrationName, targetVersion, currentVersion) => {
    await logAudit({
      action: ACTION_TYPES.INTEGRATION_VERSION_ROLLBACK,
      resourceType: RESOURCE_TYPES.INTEGRATION_VERSION,
      resourceId: `${integrationName}@${targetVersion}`,
      user: req.user,
      orgId: req.entityParentRid || req.orgId,
      metadata: { integrationName, targetVersion, fromVersion: currentVersion },
      ipAddress: getIpAddress(req),
      userAgent: req.headers['user-agent'],
      success: true
    });
  }
};

/**
 * Audit helpers for template operations
 */
const auditTemplate = {
  created: async (req, newTemplate) => {
    await logAudit({
      action: ACTION_TYPES.TEMPLATE_CREATED,
      resourceType: RESOURCE_TYPES.TEMPLATE,
      resourceId: newTemplate._id || newTemplate.id,
      user: req.user,
      orgId: req.entityParentRid || req.orgId,
      metadata: { name: newTemplate.name, type: newTemplate.type },
      ipAddress: getIpAddress(req),
      userAgent: req.headers['user-agent'],
      success: true
    });
  },

  updated: async (req, templateId, changes) => {
    await logAudit({
      action: ACTION_TYPES.TEMPLATE_UPDATED,
      resourceType: RESOURCE_TYPES.TEMPLATE,
      resourceId: templateId,
      user: req.user,
      orgId: req.entityParentRid || req.orgId,
      changes,
      ipAddress: getIpAddress(req),
      userAgent: req.headers['user-agent'],
      success: true
    });
  },

  deleted: async (req, templateId, beforeTemplate) => {
    await logAudit({
      action: ACTION_TYPES.TEMPLATE_DELETED,
      resourceType: RESOURCE_TYPES.TEMPLATE,
      resourceId: templateId,
      user: req.user,
      orgId: req.entityParentRid || req.orgId,
      changes: { before: beforeTemplate, after: null },
      ipAddress: getIpAddress(req),
      userAgent: req.headers['user-agent'],
      success: true
    });
  }
};

/**
 * Audit helpers for lookup table operations
 */
const auditLookup = {
  created: async (req, newLookup) => {
    await logAudit({
      action: ACTION_TYPES.LOOKUP_CREATED,
      resourceType: RESOURCE_TYPES.LOOKUP_TABLE,
      resourceId: newLookup._id || newLookup.id || newLookup.name,
      user: req.user,
      orgId: req.entityParentRid || req.orgId,
      metadata: { name: newLookup.name },
      ipAddress: getIpAddress(req),
      userAgent: req.headers['user-agent'],
      success: true
    });
  },

  updated: async (req, lookupId, changes) => {
    await logAudit({
      action: ACTION_TYPES.LOOKUP_UPDATED,
      resourceType: RESOURCE_TYPES.LOOKUP_TABLE,
      resourceId: lookupId,
      user: req.user,
      orgId: req.entityParentRid || req.orgId,
      changes,
      ipAddress: getIpAddress(req),
      userAgent: req.headers['user-agent'],
      success: true
    });
  },

  deleted: async (req, lookupId, beforeLookup) => {
    await logAudit({
      action: ACTION_TYPES.LOOKUP_DELETED,
      resourceType: RESOURCE_TYPES.LOOKUP_TABLE,
      resourceId: lookupId,
      user: req.user,
      orgId: req.entityParentRid || req.orgId,
      changes: { before: beforeLookup, after: null },
      ipAddress: getIpAddress(req),
      userAgent: req.headers['user-agent'],
      success: true
    });
  },

  bulkImported: async (req, tableName, rowCount) => {
    await logAudit({
      action: ACTION_TYPES.LOOKUP_BULK_IMPORTED,
      resourceType: RESOURCE_TYPES.LOOKUP_TABLE,
      resourceId: tableName,
      user: req.user,
      orgId: req.entityParentRid || req.orgId,
      metadata: { tableName, rowCount },
      ipAddress: getIpAddress(req),
      userAgent: req.headers['user-agent'],
      success: true
    });
  },

  bulkDeleted: async (req, tableName, deletedCount) => {
    await logAudit({
      action: ACTION_TYPES.LOOKUP_BULK_DELETED,
      resourceType: RESOURCE_TYPES.LOOKUP_TABLE,
      resourceId: tableName,
      user: req.user,
      orgId: req.entityParentRid || req.orgId,
      metadata: { tableName, deletedCount },
      ipAddress: getIpAddress(req),
      userAgent: req.headers['user-agent'],
      success: true
    });
  }
};

/**
 * Audit helpers for scheduled job operations
 */
const auditScheduledJob = {
  created: async (req, newJob) => {
    await logAudit({
      action: ACTION_TYPES.SCHEDULED_JOB_CREATED,
      resourceType: RESOURCE_TYPES.SCHEDULED_JOB,
      resourceId: newJob._id || newJob.id,
      user: req.user,
      orgId: req.entityParentRid || req.orgId,
      metadata: { name: newJob.name, cron: newJob.cron },
      ipAddress: getIpAddress(req),
      userAgent: req.headers['user-agent'],
      success: true
    });
  },

  updated: async (req, jobId, changes) => {
    await logAudit({
      action: ACTION_TYPES.SCHEDULED_JOB_UPDATED,
      resourceType: RESOURCE_TYPES.SCHEDULED_JOB,
      resourceId: jobId,
      user: req.user,
      orgId: req.entityParentRid || req.orgId,
      changes,
      ipAddress: getIpAddress(req),
      userAgent: req.headers['user-agent'],
      success: true
    });
  },

  deleted: async (req, jobId, beforeJob) => {
    await logAudit({
      action: ACTION_TYPES.SCHEDULED_JOB_DELETED,
      resourceType: RESOURCE_TYPES.SCHEDULED_JOB,
      resourceId: jobId,
      user: req.user,
      orgId: req.entityParentRid || req.orgId,
      changes: { before: beforeJob, after: null },
      ipAddress: getIpAddress(req),
      userAgent: req.headers['user-agent'],
      success: true
    });
  },

  executed: async (req, jobId) => {
    await logAudit({
      action: ACTION_TYPES.SCHEDULED_JOB_EXECUTED,
      resourceType: RESOURCE_TYPES.SCHEDULED_JOB,
      resourceId: jobId,
      user: req.user,
      orgId: req.entityParentRid || req.orgId,
      ipAddress: getIpAddress(req),
      userAgent: req.headers['user-agent'],
      success: true
    });
  },

  paused: async (req, jobId, beforeJob) => {
    await logAudit({
      action: ACTION_TYPES.SCHEDULED_JOB_PAUSED,
      resourceType: RESOURCE_TYPES.SCHEDULED_JOB,
      resourceId: jobId,
      user: req.user,
      orgId: req.entityParentRid || req.orgId,
      changes: { before: beforeJob, after: { ...beforeJob, active: false } },
      ipAddress: getIpAddress(req),
      userAgent: req.headers['user-agent'],
      success: true
    });
  },

  resumed: async (req, jobId, beforeJob) => {
    await logAudit({
      action: ACTION_TYPES.SCHEDULED_JOB_RESUMED,
      resourceType: RESOURCE_TYPES.SCHEDULED_JOB,
      resourceId: jobId,
      user: req.user,
      orgId: req.entityParentRid || req.orgId,
      changes: { before: beforeJob, after: { ...beforeJob, active: true } },
      ipAddress: getIpAddress(req),
      userAgent: req.headers['user-agent'],
      success: true
    });
  }
};

/**
 * Audit helpers for scheduled integration operations
 */
const auditScheduledIntegration = {
  cancelled: async (req, scheduledIntegrationId) => {
    await logAudit({
      action: ACTION_TYPES.SCHEDULED_INTEGRATION_CANCELLED,
      resourceType: RESOURCE_TYPES.SCHEDULED_INTEGRATION,
      resourceId: scheduledIntegrationId,
      user: req.user,
      orgId: req.entityParentRid || req.orgId,
      ipAddress: getIpAddress(req),
      userAgent: req.headers['user-agent'],
      success: true
    });
  },

  bulkCancelled: async (req, ids) => {
    await logAudit({
      action: ACTION_TYPES.SCHEDULED_INTEGRATION_CANCELLED,
      resourceType: RESOURCE_TYPES.SCHEDULED_INTEGRATION,
      user: req.user,
      orgId: req.entityParentRid || req.orgId,
      metadata: { ids, count: ids.length },
      ipAddress: getIpAddress(req),
      userAgent: req.headers['user-agent'],
      success: true
    });
  }
};

/**
 * Audit helpers for config/settings operations
 */
const auditConfig = {
  uiConfigUpdated: async (req, changes) => {
    await logAudit({
      action: ACTION_TYPES.UI_CONFIG_UPDATED,
      resourceType: RESOURCE_TYPES.UI_CONFIG,
      user: req.user,
      orgId: req.entityParentRid || req.orgId,
      changes,
      ipAddress: getIpAddress(req),
      userAgent: req.headers['user-agent'],
      success: true
    });
  },

  systemConfigUpdated: async (req, changes) => {
    await logAudit({
      action: ACTION_TYPES.SYSTEM_CONFIG_UPDATED,
      resourceType: RESOURCE_TYPES.SYSTEM_CONFIG,
      user: req.user,
      orgId: req.entityParentRid || req.orgId,
      changes,
      ipAddress: getIpAddress(req),
      userAgent: req.headers['user-agent'],
      success: true
    });
  },

  aiConfigUpdated: async (req, orgId, changes) => {
    await logAudit({
      action: ACTION_TYPES.AI_CONFIG_UPDATED,
      resourceType: RESOURCE_TYPES.AI_CONFIG,
      resourceId: orgId,
      user: req.user,
      orgId,
      changes,
      ipAddress: getIpAddress(req),
      userAgent: req.headers['user-agent'],
      success: true
    });
  },

  rateLimitUpdated: async (req, integrationId, changes) => {
    await logAudit({
      action: ACTION_TYPES.RATE_LIMIT_UPDATED,
      resourceType: RESOURCE_TYPES.RATE_LIMIT,
      resourceId: integrationId,
      user: req.user,
      orgId: req.entityParentRid || req.orgId,
      changes,
      ipAddress: getIpAddress(req),
      userAgent: req.headers['user-agent'],
      success: true
    });
  },

  rateLimitReset: async (req, integrationId) => {
    await logAudit({
      action: ACTION_TYPES.RATE_LIMIT_RESET,
      resourceType: RESOURCE_TYPES.RATE_LIMIT,
      resourceId: integrationId,
      user: req.user,
      orgId: req.entityParentRid || req.orgId,
      ipAddress: getIpAddress(req),
      userAgent: req.headers['user-agent'],
      success: true
    });
  },

  rateLimitBulkApplied: async (req, integrationIds, limitConfig) => {
    await logAudit({
      action: ACTION_TYPES.RATE_LIMIT_BULK_APPLIED,
      resourceType: RESOURCE_TYPES.RATE_LIMIT,
      user: req.user,
      orgId: req.entityParentRid || req.orgId,
      metadata: { integrationIds, count: integrationIds.length, limitConfig },
      ipAddress: getIpAddress(req),
      userAgent: req.headers['user-agent'],
      success: true
    });
  },

  rateLimitBulkReset: async (req, integrationIds) => {
    await logAudit({
      action: ACTION_TYPES.RATE_LIMIT_BULK_RESET,
      resourceType: RESOURCE_TYPES.RATE_LIMIT,
      user: req.user,
      orgId: req.entityParentRid || req.orgId,
      metadata: { integrationIds, count: integrationIds.length },
      ipAddress: getIpAddress(req),
      userAgent: req.headers['user-agent'],
      success: true
    });
  }
};

/**
 * Audit helpers for admin user password operations
 */
const auditAdmin = {
  passwordReset: async (req, userId) => {
    await logAudit({
      action: ACTION_TYPES.PASSWORD_RESET,
      resourceType: RESOURCE_TYPES.USER,
      resourceId: userId,
      user: req.user,
      ipAddress: getIpAddress(req),
      userAgent: req.headers['user-agent'],
      success: true
    });
  },

  passwordChanged: async (req, userId) => {
    await logAudit({
      action: ACTION_TYPES.PASSWORD_CHANGED,
      resourceType: RESOURCE_TYPES.USER,
      resourceId: userId,
      user: req.user,
      ipAddress: getIpAddress(req),
      userAgent: req.headers['user-agent'],
      success: true
    });
  },

  impersonated: async (req, targetUser) => {
    await logAudit({
      action: ACTION_TYPES.IMPERSONATE,
      resourceType: RESOURCE_TYPES.USER,
      resourceId: targetUser?.id || targetUser?._id,
      user: req.user,
      metadata: { targetEmail: targetUser?.email, targetRole: targetUser?.role },
      ipAddress: getIpAddress(req),
      userAgent: req.headers['user-agent'],
      success: true
    });
  },

  userDisabled: async (req, userId, beforeUser) => {
    await logAudit({
      action: ACTION_TYPES.USER_DISABLED,
      resourceType: RESOURCE_TYPES.USER,
      resourceId: userId,
      user: req.user,
      changes: { before: beforeUser, after: { ...beforeUser, disabled: true } },
      ipAddress: getIpAddress(req),
      userAgent: req.headers['user-agent'],
      success: true
    });
  },

  userEnabled: async (req, userId, beforeUser) => {
    await logAudit({
      action: ACTION_TYPES.USER_ENABLED,
      resourceType: RESOURCE_TYPES.USER,
      resourceId: userId,
      user: req.user,
      changes: { before: beforeUser, after: { ...beforeUser, disabled: false } },
      ipAddress: getIpAddress(req),
      userAgent: req.headers['user-agent'],
      success: true
    });
  }
};

/**
 * Audit helpers for event source configuration operations
 */
const auditEventSource = {
  configured: async (req, orgId, type, before, after) => {
    await logAudit({
      action:       ACTION_TYPES.EVENT_SOURCE_CONFIGURED,
      resourceType: RESOURCE_TYPES.EVENT_SOURCE,
      resourceId:   String(orgId),
      user:         req.user,
      orgId,
      changes:      { before, after },
      metadata:     { sourceType: type },
      ipAddress:    getIpAddress(req),
      userAgent:    req.headers['user-agent'],
      success:      true
    });
  },

  deleted: async (req, orgId, before) => {
    await logAudit({
      action:       ACTION_TYPES.EVENT_SOURCE_DELETED,
      resourceType: RESOURCE_TYPES.EVENT_SOURCE,
      resourceId:   String(orgId),
      user:         req.user,
      orgId,
      changes:      { before, after: null },
      ipAddress:    getIpAddress(req),
      userAgent:    req.headers['user-agent'],
      success:      true
    });
  },

  tested: async (req, type, success, errorCode) => {
    await logAudit({
      action:       ACTION_TYPES.EVENT_SOURCE_TESTED,
      resourceType: RESOURCE_TYPES.EVENT_SOURCE,
      user:         req.user,
      orgId:        req.entityParentRid || req.user?.orgId,
      metadata:     { sourceType: type, success, errorCode: errorCode || null },
      ipAddress:    getIpAddress(req),
      userAgent:    req.headers['user-agent'],
      success
    });
  }
};

/**
 * Audit helpers for data import/export operations
 */
const auditData = {
  imported: async (req, resourceType, metadata) => {
    await logAudit({
      action: ACTION_TYPES.DATA_IMPORTED,
      resourceType,
      user: req.user,
      orgId: req.entityParentRid || req.orgId,
      metadata,
      ipAddress: getIpAddress(req),
      userAgent: req.headers['user-agent'],
      success: true
    });
  },

  exported: async (req, resourceType, metadata) => {
    await logAudit({
      action: ACTION_TYPES.DATA_EXPORTED,
      resourceType,
      user: req.user,
      orgId: req.entityParentRid || req.orgId,
      metadata,
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
  auditOrg,
  auditIntegration,
  auditVersion,
  auditTemplate,
  auditLookup,
  auditScheduledJob,
  auditScheduledIntegration,
  auditConfig,
  auditEventSource,
  auditAdmin,
  auditData,
  logAudit
};
