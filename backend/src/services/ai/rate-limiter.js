/**
 * AI Rate Limiter
 * Tracks AI usage per org and enforces daily limits
 */

const mongodb = require('../../mongodb');
const { log } = require('../../logger');
const { parsePositiveInt } = require('../../utils/org-context');

class AIRateLimiter {
  constructor() {
    this.collectionName = 'ai_usage';
  }

  /**
   * Check if organization has exceeded daily limit
   * @param {number} orgId - Organization ID
   * @returns {Promise<{allowed: boolean, usage: number, limit: number}>}
   */
  async checkLimit(orgId) {
    const normalizedOrgId = parsePositiveInt(orgId);
    if (!normalizedOrgId) {
      return { allowed: false, usage: 0, limit: 0, remaining: 0 };
    }

    const db = await mongodb.getDbSafe();
    const collection = db.collection(this.collectionName);

    // Get today's date range (start of day to now)
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Count usage for today
    const usage = await collection.countDocuments({
      $or: [{ orgId: normalizedOrgId }, { entityParentRid: normalizedOrgId }],
      createdAt: { $gte: today, $lt: tomorrow },
    });

    // Read daily limit from entity's DB config; 0 means unlimited; default 100
    let limit = 100;
    try {
      const aiConfigData = require('../../data/ai-config');
      const entityConfig = await aiConfigData.getAIConfig(normalizedOrgId);
      if (entityConfig && typeof entityConfig.dailyLimit === 'number') {
        limit = entityConfig.dailyLimit === 0 ? Infinity : entityConfig.dailyLimit;
      }
    } catch (_err) {
      /* non-fatal — use default */
    }

    const displayLimit = limit === Infinity ? 0 : limit; // 0 = unlimited for API clients
    return {
      allowed: usage < limit,
      usage,
      limit: displayLimit,
      remaining: limit === Infinity ? null : Math.max(0, limit - usage),
    };
  }

  /**
   * Record AI usage
   * @param {number} orgId - Organization ID
   * @param {string} operation - Operation type (generate_transformation, analyze_docs, etc.)
   * @param {object} metadata - Additional metadata
   * @returns {Promise<void>}
   */
  async recordUsage(orgId, operation, metadata = {}) {
    const normalizedOrgId = parsePositiveInt(orgId);
    if (!normalizedOrgId) return;

    const db = await mongodb.getDbSafe();
    const collection = db.collection(this.collectionName);

    await collection.insertOne({
      orgId: normalizedOrgId,
      operation,
      metadata,
      createdAt: new Date(),
    });

    log('info', 'AI usage recorded', {
      orgId: normalizedOrgId,
      operation,
      timestamp: new Date(),
    });
  }

  /**
   * Get usage statistics for an organization
   * @param {number} orgId - Organization ID
   * @param {number} days - Number of days to look back (default: 30)
   * @returns {Promise<object>}
   */
  async getUsageStats(orgId, days = 30) {
    const normalizedOrgId = parsePositiveInt(orgId);
    if (!normalizedOrgId) {
      return {
        totalUsage: 0,
        byOperation: {},
        byDay: {},
        period: `${days} days`,
      };
    }

    const db = await mongodb.getDbSafe();
    const collection = db.collection(this.collectionName);

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const usageRecords = await collection
      .find({
        $or: [{ orgId: normalizedOrgId }, { entityParentRid: normalizedOrgId }],
        createdAt: { $gte: startDate },
      })
      .toArray();

    // Group by operation
    const byOperation = {};
    usageRecords.forEach((record) => {
      const op = record.operation;
      byOperation[op] = (byOperation[op] || 0) + 1;
    });

    // Group by day
    const byDay = {};
    usageRecords.forEach((record) => {
      const day = record.createdAt.toISOString().split('T')[0];
      byDay[day] = (byDay[day] || 0) + 1;
    });

    return {
      totalUsage: usageRecords.length,
      byOperation,
      byDay,
      period: `${days} days`,
    };
  }

  /**
   * Reset usage for an organization (admin function)
   * @param {number} orgId - Organization ID
   * @returns {Promise<number>} Number of records deleted
   */
  async resetUsage(orgId) {
    const normalizedOrgId = parsePositiveInt(orgId);
    if (!normalizedOrgId) return 0;

    const db = await mongodb.getDbSafe();
    const collection = db.collection(this.collectionName);

    const result = await collection.deleteMany({
      $or: [{ orgId: normalizedOrgId }, { entityParentRid: normalizedOrgId }],
    });

    log('info', 'AI usage reset', {
      orgId: normalizedOrgId,
      deletedCount: result.deletedCount,
    });

    return result.deletedCount;
  }

  /**
   * Cleanup old usage records (run via cron)
   * Deletes records older than retention period
   * @param {number} retentionDays - Days to retain (default: 90)
   * @returns {Promise<number>} Number of records deleted
   */
  async cleanupOldRecords(retentionDays = 90) {
    const db = await mongodb.getDbSafe();
    const collection = db.collection(this.collectionName);

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    const result = await collection.deleteMany({
      createdAt: { $lt: cutoffDate },
    });

    log('info', 'AI usage cleanup completed', {
      retentionDays,
      deletedCount: result.deletedCount,
    });

    return result.deletedCount;
  }
}

module.exports = AIRateLimiter;
