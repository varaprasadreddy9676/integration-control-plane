const mongodb = require('../mongodb');
const { log } = require('../logger');

/**
 * Enterprise Audit Logger
 * Tracks all important system actions for compliance and security
 */

// Action types
const ACTION_TYPES = {
  // Authentication
  LOGIN: 'login',
  LOGOUT: 'logout',
  LOGIN_FAILED: 'login_failed',
  PASSWORD_RESET: 'password_reset',

  // User management
  USER_CREATED: 'user_created',
  USER_UPDATED: 'user_updated',
  USER_DELETED: 'user_deleted',
  USER_DISABLED: 'user_disabled',
  USER_ENABLED: 'user_enabled',

  // Role & Permission management
  ROLE_CREATED: 'role_created',
  ROLE_UPDATED: 'role_updated',
  ROLE_DELETED: 'role_deleted',
  PERMISSION_CHANGED: 'permission_changed',

  // Organization management
  ORG_CREATED: 'org_created',
  ORG_UPDATED: 'org_updated',
  ORG_DELETED: 'org_deleted',

  // Integration management
  INTEGRATION_CREATED: 'integration_created',
  INTEGRATION_UPDATED: 'integration_updated',
  INTEGRATION_DELETED: 'integration_deleted',
  INTEGRATION_EXECUTED: 'integration_executed',

  // Configuration
  CONFIG_UPDATED: 'config_updated',
  SETTINGS_CHANGED: 'settings_changed',

  // Data access
  DATA_EXPORTED: 'data_exported',
  DATA_IMPORTED: 'data_imported',

  // API access
  API_KEY_CREATED: 'api_key_created',
  API_KEY_DELETED: 'api_key_deleted',

  // General
  READ: 'read',
  CREATE: 'create',
  UPDATE: 'update',
  DELETE: 'delete'
};

// Resource types
const RESOURCE_TYPES = {
  USER: 'user',
  ROLE: 'role',
  ORGANIZATION: 'organization',
  INTEGRATION: 'integration',
  CONFIG: 'config',
  API_KEY: 'api_key',
  TEMPLATE: 'template',
  LOOKUP_TABLE: 'lookup_table',
  SCHEDULED_JOB: 'scheduled_job',
  ALERT: 'alert'
};

/**
 * Log an audit event
 * @param {Object} params Audit log parameters
 * @param {string} params.action Action type (from ACTION_TYPES)
 * @param {string} params.resourceType Resource type (from RESOURCE_TYPES)
 * @param {string|number} [params.resourceId] ID of the resource affected
 * @param {Object} [params.user] User who performed the action
 * @param {number} [params.orgId] Organization ID
 * @param {Object} [params.changes] Before/after changes
 * @param {Object} [params.metadata] Additional metadata
 * @param {string} [params.ipAddress] IP address
 * @param {string} [params.userAgent] User agent
 * @param {boolean} [params.success=true] Whether the action succeeded
 * @param {string} [params.errorMessage] Error message if failed
 */
async function logAudit({
  action,
  resourceType,
  resourceId = null,
  user = null,
  orgId = null,
  changes = null,
  metadata = null,
  ipAddress = null,
  userAgent = null,
  success = true,
  errorMessage = null
}) {
  try {
    const db = await mongodb.getDbSafe();

    const auditLog = {
      timestamp: new Date(),
      action,
      resourceType,
      resourceId,

      // User information
      userId: user?.id || user?._id || null,
      userEmail: user?.email || null,
      userRole: user?.role || null,

      // Organization context
      orgId: orgId || user?.orgId || null,

      // Changes tracking
      changes: changes ? {
        before: changes.before || null,
        after: changes.after || null
      } : null,

      // Additional context
      metadata: metadata || {},

      // Request information
      ipAddress,
      userAgent,

      // Status
      success,
      errorMessage
    };

    await db.collection('audit_logs').insertOne(auditLog);

    // Also log to application logger for critical events
    if (!success || action.includes('delete') || action.includes('failed')) {
      log('info', `Audit: ${action}`, {
        resourceType,
        resourceId,
        userId: auditLog.userId,
        success
      });
    }
  } catch (error) {
    // Never let audit logging break the main flow
    log('error', 'Failed to write audit log', {
      error: error.message,
      action,
      resourceType
    });
  }
}

/**
 * Query audit logs
 * @param {Object} filters Query filters
 * @param {Date} [filters.startDate] Start date
 * @param {Date} [filters.endDate] End date
 * @param {string} [filters.userId] User ID
 * @param {string} [filters.action] Action type
 * @param {string} [filters.resourceType] Resource type
 * @param {number} [filters.orgId] Organization ID
 * @param {boolean} [filters.success] Success status
 * @param {number} [filters.page=1] Page number
 * @param {number} [filters.limit=50] Results per page
 */
async function queryAuditLogs(filters = {}) {
  const db = await mongodb.getDbSafe();

  const query = {};

  // Date range filter
  if (filters.startDate || filters.endDate) {
    query.timestamp = {};
    if (filters.startDate) query.timestamp.$gte = new Date(filters.startDate);
    if (filters.endDate) query.timestamp.$lte = new Date(filters.endDate);
  }

  // User filter
  if (filters.userId) {
    query.userId = filters.userId;
  }

  // Action filter
  if (filters.action) {
    query.action = filters.action;
  }

  // Resource type filter
  if (filters.resourceType) {
    query.resourceType = filters.resourceType;
  }

  // Organization filter
  if (filters.orgId) {
    query.orgId = filters.orgId;
  }

  // Success filter
  if (typeof filters.success === 'boolean') {
    query.success = filters.success;
  }

  // Search filter (search in userEmail, resourceType, action)
  if (filters.search) {
    query.$or = [
      { userEmail: { $regex: filters.search, $options: 'i' } },
      { action: { $regex: filters.search, $options: 'i' } },
      { resourceType: { $regex: filters.search, $options: 'i' } }
    ];
  }

  const page = parseInt(filters.page) || 1;
  const limit = parseInt(filters.limit) || 50;
  const skip = (page - 1) * limit;

  const [logs, total] = await Promise.all([
    db.collection('audit_logs')
      .find(query)
      .sort({ timestamp: -1 })
      .skip(skip)
      .limit(limit)
      .toArray(),
    db.collection('audit_logs').countDocuments(query)
  ]);

  return {
    logs,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit)
    }
  };
}

/**
 * Get audit log statistics
 * @param {Object} filters Optional filters
 */
async function getAuditStats(filters = {}) {
  const db = await mongodb.getDbSafe();

  const query = {};
  if (filters.startDate || filters.endDate) {
    query.timestamp = {};
    if (filters.startDate) query.timestamp.$gte = new Date(filters.startDate);
    if (filters.endDate) query.timestamp.$lte = new Date(filters.endDate);
  }
  if (filters.orgId) {
    query.orgId = filters.orgId;
  }

  const [
    totalLogs,
    failedActions,
    actionsByType,
    topUsers
  ] = await Promise.all([
    db.collection('audit_logs').countDocuments(query),
    db.collection('audit_logs').countDocuments({ ...query, success: false }),
    db.collection('audit_logs').aggregate([
      { $match: query },
      { $group: { _id: '$action', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 }
    ]).toArray(),
    db.collection('audit_logs').aggregate([
      { $match: query },
      { $group: { _id: { userId: '$userId', userEmail: '$userEmail' }, count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 }
    ]).toArray()
  ]);

  return {
    totalLogs,
    failedActions,
    successRate: totalLogs > 0 ? ((totalLogs - failedActions) / totalLogs * 100).toFixed(2) : 100,
    actionsByType: actionsByType.map(a => ({ action: a._id, count: a.count })),
    topUsers: topUsers.map(u => ({
      userId: u._id.userId,
      userEmail: u._id.userEmail,
      count: u.count
    }))
  };
}

/**
 * Create an index on audit_logs collection for better query performance
 */
async function ensureAuditIndexes() {
  try {
    const db = await mongodb.getDbSafe();
    await db.collection('audit_logs').createIndexes([
      { key: { timestamp: -1 } },
      { key: { userId: 1 } },
      { key: { action: 1 } },
      { key: { resourceType: 1 } },
      { key: { orgId: 1 } },
      { key: { success: 1 } }
    ]);
    log('info', 'Audit log indexes created');
  } catch (error) {
    log('error', 'Failed to create audit indexes', { error: error.message });
  }
}

module.exports = {
  logAudit,
  queryAuditLogs,
  getAuditStats,
  ensureAuditIndexes,
  ACTION_TYPES,
  RESOURCE_TYPES
};
