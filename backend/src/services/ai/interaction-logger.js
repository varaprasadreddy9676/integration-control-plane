/**
 * AI Interaction Logger
 * Logs all AI requests and responses to MongoDB for debugging and auditing
 */

const mongodb = require('../../mongodb');
const { log } = require('../../logger');
const { parsePositiveInt } = require('../../utils/org-context');

/**
 * Log an AI interaction (request + response)
 * @param {object} data - Interaction data
 * @param {number} data.orgId - Organization ID
 * @param {string} data.operation - Operation type (generate_transformation, suggest_mappings, etc.)
 * @param {object} data.request - Request data
 * @param {object} data.response - Response data
 * @param {string} data.provider - AI provider name
 * @param {object} [data.metadata] - Additional metadata
 * @param {boolean} [data.success] - Whether the operation was successful
 * @param {string} [data.error] - Error message if failed
 */
async function logInteraction(data) {
  try {
    if (!mongodb.isConnected()) {
      log('warn', 'Cannot log AI interaction: MongoDB not connected');
      return;
    }

    const db = await mongodb.getDbSafe();
    const collection = db.collection('ai_interactions');

    const orgId = parsePositiveInt(data.orgId || data.entityParentRid);

    const interaction = {
      orgId,
      operation: data.operation,
      provider: data.provider,

      // Request details
      request: {
        timestamp: new Date(),
        data: data.request.data || {},
        prompt: data.request.prompt || null, // Full prompt sent to AI
        systemPrompt: data.request.systemPrompt || null,
      },

      // Response details
      response: {
        timestamp: new Date(),
        data: data.response.data || {},
        raw: data.response.raw || null, // Raw AI response
        parsed: data.response.parsed || null, // Parsed/processed response
        tokenUsage: data.response.tokenUsage || null,
      },

      // Metadata
      metadata: {
        latencyMs: data.metadata?.latencyMs || 0,
        modelName: data.metadata?.modelName || null,
        temperature: data.metadata?.temperature || null,
        maxTokens: data.metadata?.maxTokens || null,
        ...data.metadata,
      },

      // Status
      success: data.success !== undefined ? data.success : true,
      error: data.error || null,

      // Timestamps
      createdAt: new Date(),
    };

    await collection.insertOne(interaction);

    log('debug', 'AI interaction logged', {
      operation: data.operation,
      orgId,
      success: interaction.success,
    });
  } catch (error) {
    log('error', 'Failed to log AI interaction', {
      error: error.message,
      operation: data.operation,
    });
    // Don't throw - logging failures shouldn't break AI operations
  }
}

/**
 * Get AI interactions for an org
 * @param {number} orgId - Organization ID
 * @param {object} [options] - Query options
 * @param {number} [options.limit=50] - Max results
 * @param {string} [options.operation] - Filter by operation type
 * @param {Date} [options.since] - Filter by date
 * @returns {Promise<Array>}
 */
async function getInteractions(orgId, options = {}) {
  if (!mongodb.isConnected()) {
    return [];
  }

  const db = await mongodb.getDbSafe();
  const collection = db.collection('ai_interactions');

  const normalizedOrgId = parsePositiveInt(orgId);
  if (!normalizedOrgId) return [];

  const query = {
    $or: [{ orgId: normalizedOrgId }, { entityParentRid: normalizedOrgId }],
  };

  if (options.operation) {
    query.operation = options.operation;
  }

  if (options.since) {
    query.createdAt = { $gte: options.since };
  }

  const cursor = collection
    .find(query)
    .sort({ createdAt: -1 })
    .limit(options.limit || 50);

  return await cursor.toArray();
}

/**
 * Get statistics about AI interactions
 * @param {number} orgId - Organization ID
 * @param {number} days - Days to look back
 * @returns {Promise<object>}
 */
async function getStats(orgId, days = 7) {
  if (!mongodb.isConnected()) {
    return null;
  }

  const db = await mongodb.getDbSafe();
  const collection = db.collection('ai_interactions');

  const normalizedOrgId = parsePositiveInt(orgId);
  if (!normalizedOrgId) {
    return {
      totalRequests: 0,
      totalSuccess: 0,
      byOperation: {},
    };
  }

  const since = new Date();
  since.setDate(since.getDate() - days);

  const pipeline = [
    {
      $match: {
        $or: [{ orgId: normalizedOrgId }, { entityParentRid: normalizedOrgId }],
        createdAt: { $gte: since },
      },
    },
    {
      $group: {
        _id: '$operation',
        count: { $sum: 1 },
        successCount: {
          $sum: { $cond: ['$success', 1, 0] },
        },
        avgLatencyMs: { $avg: '$metadata.latencyMs' },
        totalTokens: { $sum: '$response.tokenUsage.totalTokens' },
      },
    },
  ];

  const results = await collection.aggregate(pipeline).toArray();

  return {
    totalRequests: results.reduce((sum, r) => sum + r.count, 0),
    totalSuccess: results.reduce((sum, r) => sum + r.successCount, 0),
    byOperation: results.reduce((acc, r) => {
      acc[r._id] = {
        count: r.count,
        successRate: r.count > 0 ? (r.successCount / r.count) * 100 : 0,
        avgLatencyMs: Math.round(r.avgLatencyMs || 0),
        totalTokens: r.totalTokens || 0,
      };
      return acc;
    }, {}),
  };
}

/**
 * Create indexes for ai_interactions collection
 */
async function createIndexes() {
  if (!mongodb.isConnected()) {
    return;
  }

  const db = await mongodb.getDbSafe();
  const collection = db.collection('ai_interactions');

  await collection.createIndex({ orgId: 1, createdAt: -1 });
  await collection.createIndex({ operation: 1, createdAt: -1 });
  await collection.createIndex({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 }); // 90 days TTL

  log('info', 'AI interaction indexes created');
}

module.exports = {
  logInteraction,
  getInteractions,
  getStats,
  createIndexes,
};
