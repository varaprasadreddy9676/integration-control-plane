/**
 * AI Rate Limiter
 * Tracks AI usage per entity and enforces daily limits
 */

const mongodb = require('../../mongodb');
const { log } = require('../../logger');

class AIRateLimiter {
  constructor(config) {
    this.config = config;
    this.collectionName = 'ai_usage';
  }

  /**
   * Check if entity has exceeded daily limit
   * @param {number} entityParentRid - Entity parent ID
   * @returns {Promise<{allowed: boolean, usage: number, limit: number}>}
   */
  async checkLimit(entityParentRid) {
    const db = await mongodb.getDbSafe();
    const collection = db.collection(this.collectionName);

    // Get today's date range (start of day to now)
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Count usage for today
    const usage = await collection.countDocuments({
      entityParentRid,
      createdAt: { $gte: today, $lt: tomorrow }
    });

    const limit = this.config.dailyLimitPerEntity || 100;

    return {
      allowed: usage < limit,
      usage,
      limit,
      remaining: Math.max(0, limit - usage)
    };
  }

  /**
   * Record AI usage
   * @param {number} entityParentRid - Entity parent ID
   * @param {string} operation - Operation type (generate_transformation, analyze_docs, etc.)
   * @param {object} metadata - Additional metadata
   * @returns {Promise<void>}
   */
  async recordUsage(entityParentRid, operation, metadata = {}) {
    const db = await mongodb.getDbSafe();
    const collection = db.collection(this.collectionName);

    await collection.insertOne({
      entityParentRid,
      operation,
      metadata,
      createdAt: new Date()
    });

    log('info', 'AI usage recorded', {
      entityParentRid,
      operation,
      timestamp: new Date()
    });
  }

  /**
   * Get usage statistics for an entity
   * @param {number} entityParentRid - Entity parent ID
   * @param {number} days - Number of days to look back (default: 30)
   * @returns {Promise<object>}
   */
  async getUsageStats(entityParentRid, days = 30) {
    const db = await mongodb.getDbSafe();
    const collection = db.collection(this.collectionName);

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const usageRecords = await collection
      .find({
        entityParentRid,
        createdAt: { $gte: startDate }
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
      period: `${days} days`
    };
  }

  /**
   * Reset usage for an entity (admin function)
   * @param {number} entityParentRid - Entity parent ID
   * @returns {Promise<number>} Number of records deleted
   */
  async resetUsage(entityParentRid) {
    const db = await mongodb.getDbSafe();
    const collection = db.collection(this.collectionName);

    const result = await collection.deleteMany({ entityParentRid });

    log('info', 'AI usage reset', {
      entityParentRid,
      deletedCount: result.deletedCount
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
      createdAt: { $lt: cutoffDate }
    });

    log('info', 'AI usage cleanup completed', {
      retentionDays,
      deletedCount: result.deletedCount
    });

    return result.deletedCount;
  }
}

module.exports = AIRateLimiter;
