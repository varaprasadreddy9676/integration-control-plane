const { getDbSafe, ObjectId, toObjectId } = require('../mongodb');
const { log } = require('../logger');
const { uuidv4 } = require('../utils/runtime');

/**
 * Dead Letter Queue (DLQ) Data Access Layer
 * Manages failed deliveries with retry and resolution tracking
 */

/**
 * Create a DLQ entry for a failed delivery
 * @param {Object} failureData - The failure data
 * @returns {Promise<string>} The DLQ entry ID
 */
async function createDLQEntry(failureData) {
  const db = await getDbSafe();

  const now = new Date();
  const dlqId = `dlq_${uuidv4().replace(/-/g, '')}`;

  const entry = {
    dlqId,
    traceId: failureData.traceId,
    messageId: failureData.messageId || null,
    executionLogId: failureData.executionLogId || null,

    // Integration info
    integrationConfigId: toObjectId(failureData.integrationConfigId),
    orgId: failureData.orgId,
    direction: failureData.direction, // 'OUTBOUND' | 'INBOUND' | 'SCHEDULED'

    // Original payload
    payload: failureData.payload,

    // Error details
    error: {
      message: failureData.error?.message || 'Unknown error',
      stack: failureData.error?.stack || null,
      code: failureData.error?.code || 'UNKNOWN_ERROR',
      category: categorizeError(failureData.error),
      statusCode: failureData.error?.statusCode || null
    },

    // Retry tracking
    status: 'pending', // 'pending' | 'retrying' | 'resolved' | 'abandoned'
    retryCount: 0,
    maxRetries: failureData.maxRetries || 5,
    nextRetryAt: calculateNextRetry(0, failureData.retryStrategy),
    retryStrategy: failureData.retryStrategy || 'exponential', // 'exponential' | 'linear' | 'fixed'

    // Resolution tracking
    resolvedAt: null,
    resolvedBy: null, // user ID or 'system'
    resolutionMethod: null, // 'manual_retry' | 'auto_retry' | 'abandoned' | 'fixed'
    resolutionNotes: null,

    // Metadata
    metadata: failureData.metadata || {},

    // Timestamps
    failedAt: now,
    createdAt: now,
    updatedAt: now
  };

  await db.collection('failed_deliveries').insertOne(entry);

  log('info', 'DLQ entry created', {
    dlqId,
    traceId: failureData.traceId,
    orgId: failureData.orgId,
    errorCode: entry.error.code
  });

  return dlqId;
}

/**
 * Categorize error for analytics
 * @param {Object} error - Error object
 * @returns {string} Error category
 */
function categorizeError(error) {
  if (!error) return 'UNKNOWN';

  const code = error.code || '';
  const message = error.message || '';
  const statusCode = error.statusCode;

  // Network errors
  if (code.includes('TIMEOUT') || code.includes('ETIMEDOUT')) return 'TIMEOUT';
  if (code.includes('ECONNREFUSED') || code.includes('ENOTFOUND')) return 'NETWORK';

  // HTTP errors
  if (statusCode >= 500) return 'SERVER_ERROR';
  if (statusCode === 429) return 'RATE_LIMIT';
  if (statusCode >= 400 && statusCode < 500) return 'CLIENT_ERROR';

  // Auth errors
  if (statusCode === 401 || statusCode === 403) return 'AUTH_ERROR';

  // Data errors
  if (message.includes('parse') || message.includes('JSON')) return 'DATA_ERROR';
  if (message.includes('validation') || message.includes('invalid')) return 'VALIDATION_ERROR';

  return 'UNKNOWN';
}

/**
 * Calculate next retry time based on strategy
 * @param {number} retryCount - Current retry count
 * @param {string} strategy - Retry strategy
 * @returns {Date} Next retry time
 */
function calculateNextRetry(retryCount, strategy = 'exponential') {
  const now = new Date();
  let delayMs;

  switch (strategy) {
    case 'exponential':
      // 1min, 2min, 4min, 8min, 16min, ...
      delayMs = Math.min(Math.pow(2, retryCount) * 60 * 1000, 60 * 60 * 1000); // Max 1 hour
      break;
    case 'linear':
      // 5min, 10min, 15min, 20min, ...
      delayMs = (retryCount + 1) * 5 * 60 * 1000;
      break;
    case 'fixed':
      // Always 10 minutes
      delayMs = 10 * 60 * 1000;
      break;
    default:
      delayMs = 5 * 60 * 1000; // Default 5 minutes
  }

  return new Date(now.getTime() + delayMs);
}

/**
 * Get DLQ entry by ID
 * @param {string} dlqId - The DLQ entry ID
 * @param {number} orgId - Organization ID for security
 * @returns {Promise<Object|null>}
 */
async function getDLQEntry(dlqId, orgId) {
  const db = await getDbSafe();

  return await db.collection('failed_deliveries').findOne({
    dlqId,
    orgId
  });
}

/**
 * List DLQ entries with filters and pagination
 * @param {number} orgId - Organization ID
 * @param {Object} filters - Filter options
 * @param {Object} pagination - Pagination options
 * @returns {Promise<Object>} { entries, total, hasMore }
 */
async function listDLQEntries(orgId, filters = {}, pagination = {}) {
  const db = await getDbSafe();

  const query = { orgId };

  // Apply filters
  if (filters.status) {
    query.status = filters.status;
  }
  if (filters.integrationConfigId) {
    query.integrationConfigId = toObjectId(filters.integrationConfigId);
  }
  if (filters.errorCategory) {
    query['error.category'] = filters.errorCategory;
  }
  if (filters.errorCode) {
    query['error.code'] = filters.errorCode;
  }
  if (filters.direction) {
    query.direction = filters.direction;
  }
  if (filters.startDate || filters.endDate) {
    query.failedAt = {};
    if (filters.startDate) {
      query.failedAt.$gte = new Date(filters.startDate);
    }
    if (filters.endDate) {
      query.failedAt.$lte = new Date(filters.endDate);
    }
  }

  const limit = Math.min(pagination.limit || 50, 500);
  const offset = pagination.offset || 0;

  const [entries, total] = await Promise.all([
    db.collection('failed_deliveries')
      .find(query)
      .sort({ failedAt: -1 })
      .skip(offset)
      .limit(limit)
      .toArray(),
    db.collection('failed_deliveries').countDocuments(query)
  ]);

  return {
    entries,
    total,
    hasMore: offset + entries.length < total,
    limit,
    offset
  };
}

/**
 * Update DLQ entry status
 * @param {string} dlqId - The DLQ entry ID
 * @param {number} orgId - Organization ID
 * @param {Object} updates - Fields to update
 */
async function updateDLQEntry(dlqId, orgId, updates) {
  const db = await getDbSafe();

  const updateDoc = {
    ...updates,
    updatedAt: new Date()
  };

  await db.collection('failed_deliveries').updateOne(
    { dlqId, orgId },
    { $set: updateDoc }
  );
}

/**
 * Delete a DLQ entry
 * @param {string} dlqId - The DLQ entry ID
 * @param {number} orgId - Organization ID
 */
async function deleteDLQEntry(dlqId, orgId) {
  const db = await getDbSafe();

  const result = await db.collection('failed_deliveries').deleteOne({ dlqId, orgId });

  if (result.deletedCount === 0) {
    throw new Error('DLQ entry not found');
  }

  return result.deletedCount;
}

/**
 * Increment retry count and update next retry time
 * @param {string} dlqId - The DLQ entry ID
 * @param {number} orgId - Organization ID
 * @param {string} result - 'success' | 'failed'
 */
async function recordRetryAttempt(dlqId, orgId, result) {
  const db = await getDbSafe();

  const entry = await getDLQEntry(dlqId, orgId);
  if (!entry) {
    throw new Error(`DLQ entry not found: ${dlqId}`);
  }

  const newRetryCount = entry.retryCount + 1;

  if (result === 'success') {
    // Mark as resolved
    await db.collection('failed_deliveries').updateOne(
      { dlqId, orgId },
      {
        $set: {
          status: 'resolved',
          resolvedAt: new Date(),
          resolvedBy: 'system',
          resolutionMethod: 'auto_retry',
          updatedAt: new Date()
        },
        $inc: { retryCount: 1 }
      }
    );

    log('info', 'DLQ entry resolved via retry', { dlqId, retryCount: newRetryCount });
  } else {
    // Check if max retries reached
    if (newRetryCount >= entry.maxRetries) {
      await db.collection('failed_deliveries').updateOne(
        { dlqId, orgId },
        {
          $set: {
            status: 'abandoned',
            resolvedAt: new Date(),
            resolvedBy: 'system',
            resolutionMethod: 'max_retries_exceeded',
            updatedAt: new Date()
          },
          $inc: { retryCount: 1 }
        }
      );

      log('warn', 'DLQ entry abandoned - max retries exceeded', {
        dlqId,
        retryCount: newRetryCount,
        maxRetries: entry.maxRetries
      });
    } else {
      // Schedule next retry
      const nextRetryAt = calculateNextRetry(newRetryCount, entry.retryStrategy);

      await db.collection('failed_deliveries').updateOne(
        { dlqId, orgId },
        {
          $set: {
            status: 'pending',
            nextRetryAt,
            updatedAt: new Date()
          },
          $inc: { retryCount: 1 }
        }
      );

      log('info', 'DLQ retry failed, rescheduled', {
        dlqId,
        retryCount: newRetryCount,
        nextRetryAt
      });
    }
  }
}

/**
 * Manual retry of a DLQ entry
 * @param {string} dlqId - The DLQ entry ID
 * @param {number} orgId - Organization ID
 * @param {string} userId - User performing the retry
 * @returns {Promise<Object>} The DLQ entry
 */
async function manualRetryDLQ(dlqId, orgId, userId) {
  const db = await getDbSafe();

  const entry = await getDLQEntry(dlqId, orgId);
  if (!entry) {
    throw new Error(`DLQ entry not found: ${dlqId}`);
  }

  if (entry.status === 'resolved') {
    throw new Error('Cannot retry already resolved entry');
  }

  // Mark as retrying
  await db.collection('failed_deliveries').updateOne(
    { dlqId, orgId },
    {
      $set: {
        status: 'retrying',
        updatedAt: new Date()
      }
    }
  );

  log('info', 'Manual DLQ retry initiated', { dlqId, userId, orgId });

  return entry;
}

/**
 * Abandon a DLQ entry
 * @param {string} dlqId - The DLQ entry ID
 * @param {number} orgId - Organization ID
 * @param {string} userId - User performing the action
 * @param {string} notes - Abandonment notes
 */
async function abandonDLQEntry(dlqId, orgId, userId, notes) {
  const db = await getDbSafe();

  await db.collection('failed_deliveries').updateOne(
    { dlqId, orgId },
    {
      $set: {
        status: 'abandoned',
        resolvedAt: new Date(),
        resolvedBy: userId,
        resolutionMethod: 'manual_abandon',
        resolutionNotes: notes,
        updatedAt: new Date()
      }
    }
  );

  log('info', 'DLQ entry abandoned manually', { dlqId, userId, notes });
}

/**
 * Get DLQ entries ready for retry
 * @param {number} limit - Maximum number of entries to return
 * @returns {Promise<Array>} DLQ entries ready for retry
 */
async function getDLQEntriesForRetry(limit = 100) {
  const db = await getDbSafe();

  const now = new Date();

  return await db.collection('failed_deliveries')
    .find({
      status: 'pending',
      nextRetryAt: { $lte: now }
    })
    .sort({ nextRetryAt: 1 })
    .limit(limit)
    .toArray();
}

/**
 * Get DLQ statistics
 * @param {number} orgId - Organization ID
 * @param {Object} filters - Filter options
 * @returns {Promise<Object>} Statistics object
 */
async function getDLQStats(orgId, filters = {}) {
  const db = await getDbSafe();

  const matchStage = { orgId };

  if (filters.integrationConfigId) {
    matchStage.integrationConfigId = toObjectId(filters.integrationConfigId);
  }
  if (filters.startDate || filters.endDate) {
    matchStage.failedAt = {};
    if (filters.startDate) matchStage.failedAt.$gte = new Date(filters.startDate);
    if (filters.endDate) matchStage.failedAt.$lte = new Date(filters.endDate);
  }

  const stats = await db.collection('failed_deliveries').aggregate([
    { $match: matchStage },
    {
      $facet: {
        statusBreakdown: [
          { $group: { _id: '$status', count: { $sum: 1 } } }
        ],
        categoryBreakdown: [
          { $group: { _id: '$error.category', count: { $sum: 1 } } },
          { $sort: { count: -1 } }
        ],
        topErrors: [
          { $group: { _id: '$error.code', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 10 }
        ],
        retryStats: [
          {
            $group: {
              _id: null,
              avgRetries: { $avg: '$retryCount' },
              maxRetries: { $max: '$retryCount' }
            }
          }
        ]
      }
    }
  ]).toArray();

  const result = stats[0];

  return {
    statusBreakdown: result.statusBreakdown.reduce((acc, item) => {
      acc[item._id] = item.count;
      return acc;
    }, {}),
    categoryBreakdown: result.categoryBreakdown,
    topErrors: result.topErrors,
    retryStats: result.retryStats[0] || { avgRetries: 0, maxRetries: 0 }
  };
}

module.exports = {
  createDLQEntry,
  getDLQEntry,
  listDLQEntries,
  updateDLQEntry,
  deleteDLQEntry,
  recordRetryAttempt,
  manualRetryDLQ,
  abandonDLQEntry,
  getDLQEntriesForRetry,
  getDLQStats,
  categorizeError,
  calculateNextRetry
};
