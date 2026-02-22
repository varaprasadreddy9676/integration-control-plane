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
  PASSWORD_CHANGED: 'password_changed',
  IMPERSONATE: 'impersonate',

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
  ORG_UNIT_CREATED: 'org_unit_created',
  ORG_UNIT_UPDATED: 'org_unit_updated',
  ORG_UNIT_DELETED: 'org_unit_deleted',

  // Integration management
  INTEGRATION_CREATED: 'integration_created',
  INTEGRATION_UPDATED: 'integration_updated',
  INTEGRATION_DELETED: 'integration_deleted',
  INTEGRATION_EXECUTED: 'integration_executed',
  INTEGRATION_DUPLICATED: 'integration_duplicated',
  INTEGRATION_BULK_ENABLED: 'integration_bulk_enabled',
  INTEGRATION_BULK_DISABLED: 'integration_bulk_disabled',
  INTEGRATION_BULK_DELETED: 'integration_bulk_deleted',
  INTEGRATION_SECRET_ROTATED: 'integration_secret_rotated',
  INTEGRATION_SECRET_REMOVED: 'integration_secret_removed',

  // Integration versioning
  INTEGRATION_VERSION_CREATED: 'integration_version_created',
  INTEGRATION_VERSION_UPDATED: 'integration_version_updated',
  INTEGRATION_VERSION_DELETED: 'integration_version_deleted',
  INTEGRATION_VERSION_ROLLBACK: 'integration_version_rollback',
  INTEGRATION_VERSION_STATUS: 'integration_version_status',
  INTEGRATION_DEFAULT_VERSION: 'integration_default_version',

  // Template management
  TEMPLATE_CREATED: 'template_created',
  TEMPLATE_UPDATED: 'template_updated',
  TEMPLATE_DELETED: 'template_deleted',

  // Lookup management
  LOOKUP_CREATED: 'lookup_created',
  LOOKUP_UPDATED: 'lookup_updated',
  LOOKUP_DELETED: 'lookup_deleted',
  LOOKUP_BULK_IMPORTED: 'lookup_bulk_imported',
  LOOKUP_BULK_DELETED: 'lookup_bulk_deleted',

  // Scheduled job management
  SCHEDULED_JOB_CREATED: 'scheduled_job_created',
  SCHEDULED_JOB_UPDATED: 'scheduled_job_updated',
  SCHEDULED_JOB_DELETED: 'scheduled_job_deleted',
  SCHEDULED_JOB_EXECUTED: 'scheduled_job_executed',
  SCHEDULED_JOB_PAUSED: 'scheduled_job_paused',
  SCHEDULED_JOB_RESUMED: 'scheduled_job_resumed',

  // Scheduled integration management
  SCHEDULED_INTEGRATION_CANCELLED: 'scheduled_integration_cancelled',

  // Event source configuration
  EVENT_SOURCE_CONFIGURED: 'event_source_configured',
  EVENT_SOURCE_DELETED: 'event_source_deleted',
  EVENT_SOURCE_TESTED: 'event_source_tested',

  // Configuration
  CONFIG_UPDATED: 'config_updated',
  SETTINGS_CHANGED: 'settings_changed',
  UI_CONFIG_UPDATED: 'ui_config_updated',
  SYSTEM_CONFIG_UPDATED: 'system_config_updated',
  AI_CONFIG_UPDATED: 'ai_config_updated',

  // Rate limits
  RATE_LIMIT_UPDATED: 'rate_limit_updated',
  RATE_LIMIT_RESET: 'rate_limit_reset',
  RATE_LIMIT_BULK_APPLIED: 'rate_limit_bulk_applied',
  RATE_LIMIT_BULK_RESET: 'rate_limit_bulk_reset',

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
  DELETE: 'delete',
};

// Resource types
const RESOURCE_TYPES = {
  USER: 'user',
  ROLE: 'role',
  ORGANIZATION: 'organization',
  ORG_UNIT: 'org_unit',
  INTEGRATION: 'integration',
  INTEGRATION_VERSION: 'integration_version',
  CONFIG: 'config',
  UI_CONFIG: 'ui_config',
  SYSTEM_CONFIG: 'system_config',
  AI_CONFIG: 'ai_config',
  RATE_LIMIT: 'rate_limit',
  API_KEY: 'api_key',
  TEMPLATE: 'template',
  LOOKUP_TABLE: 'lookup_table',
  SCHEDULED_JOB: 'scheduled_job',
  SCHEDULED_INTEGRATION: 'scheduled_integration',
  ALERT: 'alert',
  EVENT_SOURCE: 'event_source',
};

/**
 * Build searchable text from all audit log fields
 * @param {Object} auditLog The audit log object
 * @returns {string} Combined searchable text
 */
function buildSearchableText(auditLog) {
  const searchParts = [];

  // Add all scalar fields
  if (auditLog.action) searchParts.push(auditLog.action);
  if (auditLog.resourceType) searchParts.push(auditLog.resourceType);
  if (auditLog.resourceId) searchParts.push(String(auditLog.resourceId));
  if (auditLog.userEmail) searchParts.push(auditLog.userEmail);
  if (auditLog.userRole) searchParts.push(auditLog.userRole);
  if (auditLog.userId) searchParts.push(String(auditLog.userId));
  if (auditLog.ipAddress) searchParts.push(auditLog.ipAddress);
  if (auditLog.errorMessage) searchParts.push(auditLog.errorMessage);
  if (auditLog.userAgent) searchParts.push(auditLog.userAgent);

  // Add changes (before/after) as searchable JSON strings
  if (auditLog.changes) {
    try {
      if (auditLog.changes.before) {
        searchParts.push(JSON.stringify(auditLog.changes.before));
      }
      if (auditLog.changes.after) {
        searchParts.push(JSON.stringify(auditLog.changes.after));
      }
    } catch (_err) {
      // Ignore JSON stringify errors
    }
  }

  // Add metadata as searchable JSON string
  if (auditLog.metadata && Object.keys(auditLog.metadata).length > 0) {
    try {
      searchParts.push(JSON.stringify(auditLog.metadata));
    } catch (_err) {
      // Ignore JSON stringify errors
    }
  }

  return searchParts.join(' ');
}

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
  errorMessage = null,
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
      changes: changes
        ? {
            before: changes.before || null,
            after: changes.after || null,
          }
        : null,

      // Additional context
      metadata: metadata || {},

      // Request information
      ipAddress,
      userAgent,

      // Status
      success,
      errorMessage,
    };

    // Build searchable text field for fast full-text search
    auditLog.searchableText = buildSearchableText(auditLog);

    await db.collection('audit_logs').insertOne(auditLog);

    // Also log to application logger for critical events
    if (!success || action.includes('delete') || action.includes('failed')) {
      log('info', `Audit: ${action}`, {
        resourceType,
        resourceId,
        userId: auditLog.userId,
        success,
      });
    }
  } catch (error) {
    // Never let audit logging break the main flow
    log('error', 'Failed to write audit log', {
      error: error.message,
      action,
      resourceType,
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

  // Search filter - use MongoDB text search for fast full-text search across all fields
  if (filters.search) {
    // Use $text operator for MongoDB text index search (faster for large datasets)
    // Falls back to regex search if text index not available
    const searchTerm = filters.search.trim();

    // Try text search first (requires text index)
    query.$text = { $search: searchTerm };
  }

  const page = parseInt(filters.page, 10) || 1;
  const limit = parseInt(filters.limit, 10) || 50;
  const skip = (page - 1) * limit;

  // Build sort order - if using text search, include text score
  const sortOrder = filters.search ? { score: { $meta: 'textScore' }, timestamp: -1 } : { timestamp: -1 };

  // If using text search, project the text score for better ranking
  const projection = filters.search ? { score: { $meta: 'textScore' } } : {};

  try {
    const [logs, total] = await Promise.all([
      db.collection('audit_logs').find(query, { projection }).sort(sortOrder).skip(skip).limit(limit).toArray(),
      db.collection('audit_logs').countDocuments(query),
    ]);

    return {
      logs,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  } catch (error) {
    // If text search fails (no index), fall back to regex search
    if (error.code === 27 || error.message?.includes('text index')) {
      log('warn', 'Text index not available, falling back to regex search', {
        search: filters.search,
      });

      // Remove $text and use comprehensive regex search instead
      delete query.$text;
      if (filters.search) {
        const searchTerm = filters.search.trim();
        query.$or = [
          { userEmail: { $regex: searchTerm, $options: 'i' } },
          { action: { $regex: searchTerm, $options: 'i' } },
          { resourceType: { $regex: searchTerm, $options: 'i' } },
          { resourceId: { $regex: searchTerm, $options: 'i' } },
          { errorMessage: { $regex: searchTerm, $options: 'i' } },
          { ipAddress: { $regex: searchTerm, $options: 'i' } },
          { userRole: { $regex: searchTerm, $options: 'i' } },
          { userId: { $regex: searchTerm, $options: 'i' } },
          { searchableText: { $regex: searchTerm, $options: 'i' } },
        ];
      }

      const [logs, total] = await Promise.all([
        db.collection('audit_logs').find(query).sort({ timestamp: -1 }).skip(skip).limit(limit).toArray(),
        db.collection('audit_logs').countDocuments(query),
      ]);

      return {
        logs,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      };
    }
    throw error;
  }
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

  const [totalLogs, failedActions, actionsByType, topUsers] = await Promise.all([
    db.collection('audit_logs').countDocuments(query),
    db.collection('audit_logs').countDocuments({ ...query, success: false }),
    db
      .collection('audit_logs')
      .aggregate([
        { $match: query },
        { $group: { _id: '$action', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
      ])
      .toArray(),
    db
      .collection('audit_logs')
      .aggregate([
        { $match: query },
        { $group: { _id: { userId: '$userId', userEmail: '$userEmail' }, count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
      ])
      .toArray(),
  ]);

  return {
    totalLogs,
    failedActions,
    successRate: totalLogs > 0 ? (((totalLogs - failedActions) / totalLogs) * 100).toFixed(2) : 100,
    actionsByType: actionsByType.map((a) => ({ action: a._id, count: a.count })),
    topUsers: topUsers.map((u) => ({
      userId: u._id.userId,
      userEmail: u._id.userEmail,
      count: u.count,
    })),
  };
}

/**
 * Create indexes on audit_logs collection for better query performance
 */
async function ensureAuditIndexes() {
  try {
    const db = await mongodb.getDbSafe();

    // Create regular indexes for filtering
    await db
      .collection('audit_logs')
      .createIndexes([
        { key: { timestamp: -1 } },
        { key: { userId: 1 } },
        { key: { action: 1 } },
        { key: { resourceType: 1 } },
        { key: { orgId: 1 } },
        { key: { success: 1 } },
      ]);

    // Create text index for full-text search across all searchable content
    // This enables fast searching through all fields including changes and metadata
    try {
      await db.collection('audit_logs').createIndex(
        { searchableText: 'text' },
        {
          name: 'audit_fulltext_search',
          background: true,
          default_language: 'english',
        }
      );
      log('info', 'Audit log indexes created including full-text search index');
    } catch (textIndexError) {
      // Text index might already exist, that's okay
      if (textIndexError.code === 85 || textIndexError.code === 86) {
        log('info', 'Audit log text index already exists');
      } else {
        log('warn', 'Failed to create text index, regex search will be used as fallback', {
          error: textIndexError.message,
        });
      }
    }
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
  RESOURCE_TYPES,
};
