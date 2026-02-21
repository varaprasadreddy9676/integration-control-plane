const express = require('express');
const { log } = require('../logger');
const auth = require('../middleware/auth');
const asyncHandler = require('../utils/async-handler');
const { ValidationError } = require('../utils/errors');
const { getDbSafe } = require('../mongodb');
const { queryAuditLogs, getAuditStats, ACTION_TYPES, RESOURCE_TYPES } = require('../services/audit-logger');
const {
  trackActivitiesBatch,
  queryActivities,
  getActivityStats,
  getUserSessions,
  ACTIVITY_EVENTS,
  ACTIVITY_CATEGORIES
} = require('../services/user-activity-tracker');

const router = express.Router();

const MAX_BATCH_SIZE = 100;
const ACTIVITY_RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const ACTIVITY_RATE_LIMIT_MAX_REQUESTS = 100; // 100 requests per minute per user
const ACTIVITY_RATE_LIMIT_COLLECTION = 'activity_rate_limits';
let activityRateLimitIndexesEnsured = false;

async function ensureActivityRateLimitIndexes() {
  if (activityRateLimitIndexesEnsured) return;
  const db = await getDbSafe();
  await db.collection(ACTIVITY_RATE_LIMIT_COLLECTION).createIndexes([
    { key: { key: 1, windowStart: 1 }, unique: true },
    { key: { expiresAt: 1 }, expireAfterSeconds: 0 }
  ]);
  activityRateLimitIndexesEnsured = true;
}

function getActivityRateLimitKey(req) {
  if (req.user?.id) {
    return `user:${req.user.id}`;
  }
  return `ip:${req.ip || req.connection?.remoteAddress || 'unknown'}`;
}

async function activityBatchRateLimit(req, res, next) {
  try {
    await ensureActivityRateLimitIndexes();

    const db = await getDbSafe();
    const key = getActivityRateLimitKey(req);
    const nowMs = Date.now();
    const windowStartMs = Math.floor(nowMs / ACTIVITY_RATE_LIMIT_WINDOW_MS) * ACTIVITY_RATE_LIMIT_WINDOW_MS;
    const windowStart = new Date(windowStartMs);
    const windowEnd = new Date(windowStartMs + ACTIVITY_RATE_LIMIT_WINDOW_MS);

    const rateLimitEntry = await db.collection(ACTIVITY_RATE_LIMIT_COLLECTION).findOneAndUpdate(
      { key, windowStart },
      {
        $inc: { count: 1 },
        $set: {
          updatedAt: new Date(),
          windowEnd,
          expiresAt: windowEnd
        },
        $setOnInsert: {
          key,
          windowStart,
          createdAt: new Date()
        }
      },
      { upsert: true, returnDocument: 'after' }
    );

    const count = rateLimitEntry?.value?.count || 1;
    if (count > ACTIVITY_RATE_LIMIT_MAX_REQUESTS) {
      return res.status(429).json({
        error: 'Too many activity tracking requests',
        code: 'RATE_LIMIT_EXCEEDED',
        retryAfter: Math.ceil((windowEnd.getTime() - nowMs) / 1000)
      });
    }

    const remaining = ACTIVITY_RATE_LIMIT_MAX_REQUESTS - count;
    const resetTime = Math.ceil((windowEnd.getTime() - nowMs) / 1000);
    res.set({
      'X-RateLimit-Limit': ACTIVITY_RATE_LIMIT_MAX_REQUESTS,
      'X-RateLimit-Remaining': remaining,
      'X-RateLimit-Reset': resetTime
    });

    next();
  } catch (error) {
    log('error', 'Activity batch rate limiter failed', {
      error: error.message,
      userId: req.user?.id || null
    });
    // Fail-open to avoid blocking activity tracking on limiter/storage issues.
    next();
  }
}

// ============================================
// PUBLIC ACTIVITY TRACKING ENDPOINTS
// (Available to ALL authenticated users)
// ============================================

/**
 * POST /api/v1/admin/audit/activities/batch
 * Receive batched user activities from frontend
 * NOTE: This endpoint is available to ALL authenticated users (not just admins)
 */
router.post('/activities/batch', auth, activityBatchRateLimit, asyncHandler(async (req, res) => {
  const { activities } = req.body;

  if (!activities || !Array.isArray(activities)) {
    throw new ValidationError('activities array is required');
  }

  if (activities.length > MAX_BATCH_SIZE) {
    throw new ValidationError(`Batch size cannot exceed ${MAX_BATCH_SIZE} activities`);
  }

  if (activities.length === 0) {
    return res.json({ success: true, count: 0 });
  }

  // Enrich activities with user information from the authenticated request
  const enrichedActivities = activities.map(activity => ({
    ...activity,
    userId: req.user?.id,
    userEmail: req.user?.email,
    userRole: req.user?.role,
    // Always use authenticated user's org to prevent cross-org activity injection.
    orgId: req.user?.orgId,
    ipAddress: req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress,
    userAgent: req.headers['user-agent']
  }));

  await trackActivitiesBatch(enrichedActivities);

  res.json({
    success: true,
    count: enrichedActivities.length
  });
}));

// ============================================
// AUDIT ROUTES
// All routes below require SUPER_ADMIN, ADMIN, or ORG_ADMIN role
// ORG_ADMIN users can only see their organization's data (scoped below)
// ============================================

router.use(auth.requireRole(['SUPER_ADMIN', 'ADMIN', 'ORG_ADMIN']));

/**
 * GET /api/v1/admin/audit/logs
 * Query audit logs with filters
 */
router.get('/logs', asyncHandler(async (req, res) => {
  const {
    startDate,
    endDate,
    userId,
    action,
    resourceType,
    orgId,
    success,
    search,
    page,
    limit
  } = req.query;

  const filters = {};

  if (startDate) filters.startDate = startDate;
  if (endDate) filters.endDate = endDate;
  if (userId) filters.userId = userId;
  if (action) filters.action = action;
  if (resourceType) filters.resourceType = resourceType;
  if (orgId) filters.orgId = parseInt(orgId);
  if (success !== undefined) filters.success = success === 'true';
  if (search) filters.search = search;
  if (page) filters.page = parseInt(page);
  if (limit) filters.limit = parseInt(limit);

  // Organization-scoped users can only see their org's logs
  if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'ADMIN') {
    filters.orgId = req.user.orgId;
  }

  const result = await queryAuditLogs(filters);

  res.json(result);
}));

/**
 * GET /api/v1/admin/audit/stats
 * Get audit log statistics
 */
router.get('/stats', asyncHandler(async (req, res) => {
  const { startDate, endDate } = req.query;

  const filters = {};
  if (startDate) filters.startDate = startDate;
  if (endDate) filters.endDate = endDate;

  // Organization-scoped users can only see their org's stats
  if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'ADMIN') {
    filters.orgId = req.user.orgId;
  }

  const stats = await getAuditStats(filters);

  res.json(stats);
}));

/**
 * GET /api/v1/admin/audit/action-types
 * Get available action types
 */
router.get('/action-types', asyncHandler(async (req, res) => {
  res.json({
    actionTypes: Object.values(ACTION_TYPES)
  });
}));

/**
 * GET /api/v1/admin/audit/resource-types
 * Get available resource types
 */
router.get('/resource-types', asyncHandler(async (req, res) => {
  res.json({
    resourceTypes: Object.values(RESOURCE_TYPES)
  });
}));

/**
 * POST /api/v1/admin/audit/export
 * Export audit logs (CSV or JSON)
 */
router.post('/export', asyncHandler(async (req, res) => {
  const { format = 'json', ...filters } = req.body;

  if (!['json', 'csv'].includes(format)) {
    throw new ValidationError('Format must be json or csv');
  }

  // Organization-scoped users can only export their org's logs
  if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'ADMIN') {
    filters.orgId = req.user.orgId;
  }

  // Get all logs without pagination for export
  filters.limit = 10000; // Max export limit
  const result = await queryAuditLogs(filters);

  if (format === 'csv') {
    // Convert to CSV
    const headers = [
      'Timestamp',
      'Action',
      'Resource Type',
      'Resource ID',
      'User Email',
      'User Role',
      'Org ID',
      'IP Address',
      'Success',
      'Error Message'
    ];

    const rows = result.logs.map(log => [
      log.timestamp,
      log.action,
      log.resourceType,
      log.resourceId || '',
      log.userEmail || '',
      log.userRole || '',
      log.orgId || '',
      log.ipAddress || '',
      log.success,
      log.errorMessage || ''
    ]);

    const csv = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="audit-logs-${new Date().toISOString()}.csv"`);
    res.send(csv);
  } else {
    // JSON export
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="audit-logs-${new Date().toISOString()}.json"`);
    res.json(result.logs);
  }

  log('info', 'Audit logs exported', {
    userId: req.user?.id,
    format,
    count: result.logs.length
  });
}));

/**
 * GET /api/v1/admin/audit/activities
 * Query user activities with filters
 */
router.get('/activities', asyncHandler(async (req, res) => {
  const {
    startDate,
    endDate,
    userId,
    event,
    category,
    orgId,
    page,
    pageFilter,  // Optional filter by page name (e.g. "/dashboard")
    feature,
    success,
    search,
    limit
  } = req.query;

  const filters = {};

  if (startDate) filters.startDate = startDate;
  if (endDate) filters.endDate = endDate;
  if (userId) filters.userId = userId;
  if (event) filters.event = event;
  if (category) filters.category = category;
  if (orgId) filters.orgId = parseInt(orgId);
  if (page) filters.page = parseInt(page);  // Used for pagination in queryActivities
  if (pageFilter) filters.pageFilter = pageFilter;  // Filter by page name (e.g. "/dashboard")
  if (feature) filters.feature = feature;
  if (success !== undefined) filters.success = success === 'true';
  if (search) filters.search = search;
  if (limit) filters.limit = parseInt(limit);

  // Organization-scoped admins can only see their org's activities
  if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'ADMIN') {
    filters.orgId = req.user.orgId;
  }

  const result = await queryActivities(filters);

  res.json(result);
}));

/**
 * GET /api/v1/admin/audit/activities/stats
 * Get user activity statistics
 */
router.get('/activities/stats', asyncHandler(async (req, res) => {
  const { startDate, endDate, userId, orgId } = req.query;

  const filters = {};
  if (startDate) filters.startDate = startDate;
  if (endDate) filters.endDate = endDate;
  if (userId) filters.userId = userId;
  if (orgId) filters.orgId = parseInt(orgId);

  // Organization-scoped admins can only see their org's stats
  if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'ADMIN') {
    filters.orgId = req.user.orgId;
  }

  const stats = await getActivityStats(filters);

  res.json(stats);
}));

/**
 * GET /api/v1/admin/audit/activities/sessions/:userId
 * Get user session timeline (activities grouped by session)
 */
router.get('/activities/sessions/:userId', asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const { startDate, endDate } = req.query;

  const filters = {};
  if (startDate) filters.startDate = startDate;
  if (endDate) filters.endDate = endDate;
  if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'ADMIN') {
    filters.orgId = req.user.orgId;
  }

  const sessions = await getUserSessions(userId, filters);

  res.json({
    userId,
    sessions,
    totalSessions: sessions.length
  });
}));

/**
 * GET /api/v1/admin/audit/activity-events
 * Get available activity event types
 */
router.get('/activity-events', asyncHandler(async (req, res) => {
  res.json({
    events: Object.values(ACTIVITY_EVENTS)
  });
}));

/**
 * GET /api/v1/admin/audit/activity-categories
 * Get available activity categories
 */
router.get('/activity-categories', asyncHandler(async (req, res) => {
  res.json({
    categories: Object.values(ACTIVITY_CATEGORIES)
  });
}));

module.exports = router;
