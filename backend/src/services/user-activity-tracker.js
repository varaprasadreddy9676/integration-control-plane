const mongodb = require('../mongodb');
const { log } = require('../logger');

/**
 * User Activity Tracker
 * Tracks all user actions and interactions for comprehensive audit trail
 * Modular, robust, and performant
 */

// Activity event types - granular user actions
const ACTIVITY_EVENTS = {
  // Authentication & Session
  LOGIN: 'login',
  LOGOUT: 'logout',
  LOGIN_FAILED: 'login_failed',
  SESSION_EXPIRED: 'session_expired',
  PASSWORD_CHANGED: 'password_changed',

  // Navigation & Page Views
  PAGE_VIEW: 'page_view',
  NAVIGATION: 'navigation',
  DASHBOARD_VIEW: 'dashboard_view',

  // Feature Usage
  INTEGRATION_VIEWED: 'integration_viewed',
  INTEGRATION_CREATED: 'integration_created',
  INTEGRATION_EDITED: 'integration_edited',
  INTEGRATION_DELETED: 'integration_deleted',
  INTEGRATION_TESTED: 'integration_tested',
  INTEGRATION_EXECUTED: 'integration_executed',

  // AI Feature Usage
  AI_ASSISTANT_OPENED: 'ai_assistant_opened',
  AI_PROMPT_SENT: 'ai_prompt_sent',
  AI_RESPONSE_RECEIVED: 'ai_response_received',
  AI_CONFIG_VIEWED: 'ai_config_viewed',
  AI_CONFIG_UPDATED: 'ai_config_updated',

  // Data Operations
  DATA_EXPORTED: 'data_exported',
  DATA_IMPORTED: 'data_imported',
  LOGS_VIEWED: 'logs_viewed',
  LOGS_FILTERED: 'logs_filtered',
  REPORT_GENERATED: 'report_generated',
  REPORT_DOWNLOADED: 'report_downloaded',

  // User Management
  USER_PROFILE_VIEWED: 'user_profile_viewed',
  USER_PROFILE_UPDATED: 'user_profile_updated',
  USER_CREATED: 'user_created',
  USER_UPDATED: 'user_updated',
  USER_DELETED: 'user_deleted',
  USER_DISABLED: 'user_disabled',

  // Role & Permission Management
  ROLE_VIEWED: 'role_viewed',
  ROLE_CREATED: 'role_created',
  ROLE_UPDATED: 'role_updated',
  ROLE_DELETED: 'role_deleted',
  PERMISSIONS_VIEWED: 'permissions_viewed',
  PERMISSIONS_UPDATED: 'permissions_updated',

  // Organization Management
  ORG_SWITCHED: 'org_switched',
  ORG_CREATED: 'org_created',
  ORG_UPDATED: 'org_updated',
  ORG_VIEWED: 'org_viewed',

  // Template Operations
  TEMPLATE_VIEWED: 'template_viewed',
  TEMPLATE_CREATED: 'template_created',
  TEMPLATE_UPDATED: 'template_updated',
  TEMPLATE_DELETED: 'template_deleted',

  // Scheduled Jobs
  JOB_CREATED: 'job_created',
  JOB_UPDATED: 'job_updated',
  JOB_DELETED: 'job_deleted',
  JOB_EXECUTED: 'job_executed',

  // Search & Filter
  SEARCH_PERFORMED: 'search_performed',
  FILTER_APPLIED: 'filter_applied',

  // Settings
  SETTINGS_VIEWED: 'settings_viewed',
  SETTINGS_UPDATED: 'settings_updated',

  // API Usage
  API_KEY_CREATED: 'api_key_created',
  API_KEY_DELETED: 'api_key_deleted',

  // Alerts
  ALERT_VIEWED: 'alert_viewed',
  ALERT_CREATED: 'alert_created',
  ALERT_UPDATED: 'alert_updated',

  // Button Clicks & Interactions
  BUTTON_CLICKED: 'button_clicked',
  FORM_SUBMITTED: 'form_submitted',
  MODAL_OPENED: 'modal_opened',
  MODAL_CLOSED: 'modal_closed',

  // Errors & Issues
  ERROR_ENCOUNTERED: 'error_encountered',
  API_ERROR: 'api_error',
};

// Activity categories for grouping
const ACTIVITY_CATEGORIES = {
  AUTHENTICATION: 'authentication',
  NAVIGATION: 'navigation',
  FEATURE_USAGE: 'feature_usage',
  DATA_OPERATION: 'data_operation',
  ADMINISTRATION: 'administration',
  ERROR: 'error',
};

/**
 * Track a user activity event
 * @param {Object} params Activity parameters
 * @param {string} params.event Event type (from ACTIVITY_EVENTS)
 * @param {Object} [params.user] User object
 * @param {string} [params.userId] User ID (if user object not available)
 * @param {number} [params.orgId] Organization ID
 * @param {string} [params.category] Activity category
 * @param {Object} [params.metadata] Additional metadata
 * @param {string} [params.page] Page/route where activity occurred
 * @param {string} [params.feature] Feature being used
 * @param {string} [params.action] Specific action taken
 * @param {any} [params.target] Target of the action (e.g., integration ID)
 * @param {Object} [params.changes] Before/after changes
 * @param {number} [params.duration] Duration in milliseconds
 * @param {string} [params.ipAddress] IP address
 * @param {string} [params.userAgent] User agent
 * @param {boolean} [params.success=true] Whether action succeeded
 * @param {string} [params.errorMessage] Error message if failed
 * @param {Object} [params.context] Additional context
 */
async function trackActivity({
  event,
  user = null,
  userId = null,
  orgId = null,
  category = null,
  metadata = {},
  page = null,
  feature = null,
  action = null,
  target = null,
  changes = null,
  duration = null,
  ipAddress = null,
  userAgent = null,
  success = true,
  errorMessage = null,
  context = {},
}) {
  try {
    const db = await mongodb.getDbSafe();

    // Auto-determine category if not provided
    if (!category) {
      category = getCategoryForEvent(event);
    }

    const activity = {
      timestamp: new Date(),
      event,
      category,

      // User information
      userId: userId || user?.id || user?._id?.toString() || null,
      userEmail: user?.email || null,
      userRole: user?.role || null,

      // Organization context
      orgId: orgId || user?.orgId || null,

      // Activity details
      page,
      feature,
      action,
      target,

      // Changes tracking (for edit operations)
      changes: changes
        ? {
            before: changes.before || null,
            after: changes.after || null,
          }
        : null,

      // Performance tracking
      duration,

      // Request information
      ipAddress,
      userAgent,

      // Status
      success,
      errorMessage,

      // Additional context and metadata
      metadata: {
        ...metadata,
        ...context,
      },

      // Session tracking
      sessionId: context.sessionId || null,

      // Indexing helpers
      date: new Date().toISOString().split('T')[0], // For daily queries
      hour: new Date().getHours(), // For hourly analytics
    };

    await db.collection('user_activities').insertOne(activity);
  } catch (error) {
    // Silent fail - activity tracking should never break the app
    log('error', 'Failed to track user activity', {
      error: error.message,
      event,
    });
  }
}

/**
 * Track multiple activities in batch (for performance)
 * @param {Array<Object>} activities Array of activity objects
 */
async function trackActivitiesBatch(activities) {
  try {
    if (!activities || activities.length === 0) return;

    const db = await mongodb.getDbSafe();

    const docs = activities.map((activity) => {
      const category = activity.category || getCategoryForEvent(activity.event);
      const timestamp = activity.timestamp ? new Date(activity.timestamp) : new Date();
      return {
        ...activity,
        timestamp,
        category,
        date: timestamp.toISOString().split('T')[0],
        hour: timestamp.getHours(),
      };
    });

    await db.collection('user_activities').insertMany(docs);
  } catch (error) {
    log('error', 'Failed to track activities batch', {
      error: error.message,
      count: activities?.length,
    });
  }
}

/**
 * Query user activities
 * @param {Object} filters Query filters
 */
async function queryActivities(filters = {}) {
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

  // Event filter
  if (filters.event) {
    query.event = filters.event;
  }

  // Category filter
  if (filters.category) {
    query.category = filters.category;
  }

  // Organization filter
  if (filters.orgId) {
    query.orgId = filters.orgId;
  }

  // Page name filter (filter by which page the activity occurred on)
  if (filters.pageFilter) {
    query.page = filters.pageFilter;
  }

  // Feature filter
  if (filters.feature) {
    query.feature = filters.feature;
  }

  // Success filter
  if (typeof filters.success === 'boolean') {
    query.success = filters.success;
  }

  // Search filter
  if (filters.search) {
    query.$or = [
      { userEmail: { $regex: filters.search, $options: 'i' } },
      { event: { $regex: filters.search, $options: 'i' } },
      { page: { $regex: filters.search, $options: 'i' } },
      { feature: { $regex: filters.search, $options: 'i' } },
    ];
  }

  const page = parseInt(filters.page, 10) || 1;
  const limit = parseInt(filters.limit, 10) || 100;
  const skip = (page - 1) * limit;

  const [activities, total] = await Promise.all([
    db.collection('user_activities').find(query).sort({ timestamp: -1 }).skip(skip).limit(limit).toArray(),
    db.collection('user_activities').countDocuments(query),
  ]);

  return {
    activities,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

/**
 * Get user activity statistics
 */
async function getActivityStats(filters = {}) {
  const db = await mongodb.getDbSafe();

  const query = {};
  if (filters.startDate || filters.endDate) {
    query.timestamp = {};
    if (filters.startDate) query.timestamp.$gte = new Date(filters.startDate);
    if (filters.endDate) query.timestamp.$lte = new Date(filters.endDate);
  }

  if (filters.userId) query.userId = filters.userId;
  if (filters.orgId) query.orgId = filters.orgId;

  const [totalActivities, uniqueUsers, eventsByType, activitiesByCategory, topPages, topFeatures, hourlyActivity] =
    await Promise.all([
      db.collection('user_activities').countDocuments(query),

      db.collection('user_activities').distinct('userId', query),

      db
        .collection('user_activities')
        .aggregate([
          { $match: query },
          { $group: { _id: '$event', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 20 },
        ])
        .toArray(),

      db
        .collection('user_activities')
        .aggregate([{ $match: query }, { $group: { _id: '$category', count: { $sum: 1 } } }, { $sort: { count: -1 } }])
        .toArray(),

      db
        .collection('user_activities')
        .aggregate([
          { $match: { ...query, page: { $ne: null } } },
          { $group: { _id: '$page', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 10 },
        ])
        .toArray(),

      db
        .collection('user_activities')
        .aggregate([
          { $match: { ...query, feature: { $ne: null } } },
          { $group: { _id: '$feature', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 10 },
        ])
        .toArray(),

      db
        .collection('user_activities')
        .aggregate([{ $match: query }, { $group: { _id: '$hour', count: { $sum: 1 } } }, { $sort: { _id: 1 } }])
        .toArray(),
    ]);

  return {
    totalActivities,
    uniqueUsers: uniqueUsers.length,
    eventsByType: eventsByType.map((e) => ({ event: e._id, count: e.count })),
    activitiesByCategory: activitiesByCategory.map((c) => ({ category: c._id, count: c.count })),
    topPages: topPages.map((p) => ({ page: p._id, count: p.count })),
    topFeatures: topFeatures.map((f) => ({ feature: f._id, count: f.count })),
    hourlyActivity: hourlyActivity.map((h) => ({ hour: h._id, count: h.count })),
  };
}

/**
 * Get user session timeline
 * Groups activities by session for a specific user
 */
async function getUserSessions(userId, filters = {}) {
  const db = await mongodb.getDbSafe();

  const query = { userId };
  if (filters.orgId) {
    query.orgId = filters.orgId;
  }

  if (filters.startDate || filters.endDate) {
    query.timestamp = {};
    if (filters.startDate) query.timestamp.$gte = new Date(filters.startDate);
    if (filters.endDate) query.timestamp.$lte = new Date(filters.endDate);
  }

  const activities = await db.collection('user_activities').find(query).sort({ timestamp: -1 }).limit(500).toArray();

  // Group activities into sessions (30 min gap = new session)
  const sessions = [];
  let currentSession = null;

  activities.forEach((activity) => {
    if (!currentSession || currentSession.lastActivity - activity.timestamp > 30 * 60 * 1000) {
      currentSession = {
        startTime: activity.timestamp,
        lastActivity: activity.timestamp,
        activities: [],
        totalDuration: 0,
      };
      sessions.push(currentSession);
    }

    currentSession.activities.push(activity);
    currentSession.lastActivity = activity.timestamp;
    currentSession.totalDuration = currentSession.startTime - currentSession.lastActivity;
  });

  return sessions;
}

/**
 * Auto-determine category from event type
 */
function getCategoryForEvent(event) {
  if (event.includes('login') || event.includes('logout') || event.includes('password')) {
    return ACTIVITY_CATEGORIES.AUTHENTICATION;
  }
  if (event.includes('page_view') || event.includes('navigation')) {
    return ACTIVITY_CATEGORIES.NAVIGATION;
  }
  if (event.includes('error')) {
    return ACTIVITY_CATEGORIES.ERROR;
  }
  if (event.includes('user') || event.includes('role') || event.includes('org')) {
    return ACTIVITY_CATEGORIES.ADMINISTRATION;
  }
  if (event.includes('export') || event.includes('import') || event.includes('report')) {
    return ACTIVITY_CATEGORIES.DATA_OPERATION;
  }
  return ACTIVITY_CATEGORIES.FEATURE_USAGE;
}

/**
 * Create indexes for performance
 */
async function ensureActivityIndexes() {
  try {
    const db = await mongodb.getDbSafe();
    await db
      .collection('user_activities')
      .createIndexes([
        { key: { timestamp: -1 } },
        { key: { userId: 1, timestamp: -1 } },
        { key: { event: 1 } },
        { key: { category: 1 } },
        { key: { orgId: 1 } },
        { key: { page: 1 } },
        { key: { date: 1 } },
        { key: { sessionId: 1 } },
      ]);
    log('info', 'User activity indexes created');
  } catch (error) {
    log('error', 'Failed to create activity indexes', { error: error.message });
  }
}

module.exports = {
  trackActivity,
  trackActivitiesBatch,
  queryActivities,
  getActivityStats,
  getUserSessions,
  ensureActivityIndexes,
  ACTIVITY_EVENTS,
  ACTIVITY_CATEGORIES,
};
