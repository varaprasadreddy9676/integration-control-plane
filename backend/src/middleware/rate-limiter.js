const { getDbSafe, toObjectId } = require('../mongodb');
const { log } = require('../logger');

/**
 * Rate Limiting Middleware for Integrations
 * Implements per-integration rate limiting with sliding window
 */

/**
 * Check and enforce rate limit for an integration
 * @param {string} integrationConfigId - Integration configuration ID
 * @param {number} orgId - Organization ID
 * @param {Object} limits - Rate limit configuration
 * @returns {Promise<Object>} { allowed: boolean, remaining: number, resetAt: Date }
 */
async function checkRateLimit(integrationConfigId, orgId, limits) {
  if (!limits || !limits.enabled) {
    return { allowed: true, remaining: Infinity, resetAt: null };
  }

  const db = await getDbSafe();
  const now = new Date();

  // Window duration in milliseconds
  const windowMs = (limits.windowSeconds || 60) * 1000;
  const maxRequests = limits.maxRequests || 100;

  // Calculate window start (round down to nearest window)
  const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs);
  const windowEnd = new Date(windowStart.getTime() + windowMs);

  const integrationObjId = toObjectId(integrationConfigId);

  // Atomic increment (upsert) for this window
  const rateLimitEntry = await db.collection('rate_limits').findOneAndUpdate(
    {
      integrationConfigId: integrationObjId,
      orgId,
      windowStart
    },
    {
      $inc: { requestCount: 1 },
      $set: { updatedAt: now, windowEnd },
      $setOnInsert: {
        integrationConfigId: integrationObjId,
        orgId,
        windowStart,
        createdAt: now
      }
    },
    { upsert: true, returnDocument: 'after' }
  );

  const requestCount = rateLimitEntry?.value?.requestCount || 1;

  // Check if limit exceeded
  if (requestCount > maxRequests) {
    log('warn', 'Rate limit exceeded', {
      integrationConfigId,
      orgId,
      requestCount,
      maxRequests,
      windowStart
    });

    return {
      allowed: false,
      remaining: 0,
      resetAt: windowEnd,
      retryAfter: Math.ceil((windowEnd - now) / 1000) // seconds
    };
  }

  return {
    allowed: true,
    remaining: Math.max(0, maxRequests - requestCount),
    resetAt: windowEnd
  };
}

/**
 * Express middleware factory for rate limiting
 * @param {Object} options - Middleware options
 * @returns {Function} Express middleware
 */
function rateLimitMiddleware(options = {}) {
  return async (req, res, next) => {
    try {
      const integrationConfigId = req.params.id || req.body.integrationConfigId;
      const orgId = req.orgId;

      if (!integrationConfigId || !orgId) {
        return next(); // Skip if missing required data
      }

      // Get integration configuration to check if rate limiting is enabled
      const db = await getDbSafe();
      const integration = await db.collection('integration_configs').findOne({
        _id: toObjectId(integrationConfigId),
        orgId
      });

      if (!integration || !integration.rateLimits || !integration.rateLimits.enabled) {
        return next(); // No rate limiting configured
      }

      // Check rate limit
      const result = await checkRateLimit(integrationConfigId, orgId, integration.rateLimits);

      // Add rate limit headers
      res.set({
        'X-RateLimit-Limit': integration.rateLimits.maxRequests,
        'X-RateLimit-Remaining': result.remaining,
        'X-RateLimit-Reset': result.resetAt ? Math.floor(result.resetAt.getTime() / 1000) : ''
      });

      if (!result.allowed) {
        res.set('Retry-After', result.retryAfter);

        return res.status(429).json({
          error: 'Rate limit exceeded',
          code: 'RATE_LIMIT_EXCEEDED',
          message: `Too many requests for this integration. Please try again in ${result.retryAfter} seconds.`,
          retryAfter: result.retryAfter,
          resetAt: result.resetAt
        });
      }

      next();
    } catch (error) {
      log('error', 'Rate limit middleware error', {
        error: error.message,
        integrationConfigId: req.params.id,
        orgId: req.orgId
      });

      // Don't block requests on rate limiter errors
      next();
    }
  };
}

/**
 * Get current rate limit status for an integration
 * @param {string} integrationConfigId - Integration configuration ID
 * @param {number} orgId - Organization ID
 * @returns {Promise<Object>} Current rate limit status
 */
async function getRateLimitStatus(integrationConfigId, orgId) {
  const db = await getDbSafe();
  const now = new Date();

  // Get integration configuration
  const integration = await db.collection('integration_configs').findOne({
    _id: toObjectId(integrationConfigId),
    orgId
  });

  if (!integration || !integration.rateLimits || !integration.rateLimits.enabled) {
    return {
      enabled: false,
      current: 0,
      limit: null,
      remaining: Infinity,
      resetAt: null
    };
  }

  const windowMs = (integration.rateLimits.windowSeconds || 60) * 1000;
  const maxRequests = integration.rateLimits.maxRequests || 100;
  const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs);
  const windowEnd = new Date(windowStart.getTime() + windowMs);

  const rateLimitEntry = await db.collection('rate_limits').findOne({
    integrationConfigId: toObjectId(integrationConfigId),
    orgId,
    windowStart
  });

  const current = rateLimitEntry ? rateLimitEntry.requestCount : 0;

  return {
    enabled: true,
    current,
    limit: maxRequests,
    remaining: Math.max(0, maxRequests - current),
    resetAt: windowEnd,
    windowSeconds: integration.rateLimits.windowSeconds
  };
}

/**
 * Reset rate limit for an integration (admin function)
 * @param {string} integrationConfigId - Integration configuration ID
 * @param {number} orgId - Organization ID
 */
async function resetRateLimit(integrationConfigId, orgId) {
  const db = await getDbSafe();

  const result = await db.collection('rate_limits').deleteMany({
    integrationConfigId: toObjectId(integrationConfigId),
    orgId
  });

  log('info', 'Rate limit reset', {
    integrationConfigId,
    orgId,
    deletedCount: result.deletedCount
  });

  return { success: true, deletedCount: result.deletedCount };
}

/**
 * Get rate limit statistics for an integration
 * @param {string} integrationConfigId - Integration configuration ID
 * @param {number} orgId - Organization ID
 * @param {number} hours - Hours to look back
 * @returns {Promise<Object>} Rate limit statistics
 */
async function getRateLimitStats(integrationConfigId, orgId, hours = 24) {
  const db = await getDbSafe();

  const cutoff = new Date();
  cutoff.setHours(cutoff.getHours() - hours);

  const stats = await db.collection('rate_limits').aggregate([
    {
      $match: {
        integrationConfigId: toObjectId(integrationConfigId),
        orgId,
        windowStart: { $gte: cutoff }
      }
    },
    {
      $group: {
        _id: null,
        totalRequests: { $sum: '$requestCount' },
        peakRequests: { $max: '$requestCount' },
        avgRequests: { $avg: '$requestCount' },
        windowCount: { $sum: 1 }
      }
    }
  ]).toArray();

  if (stats.length === 0) {
    return {
      totalRequests: 0,
      peakRequests: 0,
      avgRequests: 0,
      windowCount: 0,
      hoursAnalyzed: hours
    };
  }

  return {
    ...stats[0],
    hoursAnalyzed: hours
  };
}

module.exports = {
  checkRateLimit,
  rateLimitMiddleware,
  getRateLimitStatus,
  resetRateLimit,
  getRateLimitStats
};
