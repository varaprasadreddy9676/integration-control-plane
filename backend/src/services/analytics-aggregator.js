const data = require('../data');
const { log } = require('../logger');

class AnalyticsAggregator {
  constructor() {
    this.cache = new Map();
    this.cacheTimeoutMs = 5 * 60 * 1000; // 5 minutes cache
  }

  getCacheKey(orgId, type, params) {
    return `${orgId}:${type}:${JSON.stringify(params)}`;
  }

  getFromCache(key) {
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.timestamp < this.cacheTimeoutMs) {
      return cached.data;
    }
    if (cached) {
      this.cache.delete(key);
    }
    return null;
  }

  setCache(key, data) {
    this.cache.set(key, { data, timestamp: Date.now() });

    // Prevent memory leaks - limit cache size
    if (this.cache.size > 100) {
      const oldestKey = this.cache.keys().next().value;
      this.cache.delete(oldestKey);
    }
  }

  async getIntegrationMetrics(orgId, options = {}) {
    const { days = 30, integrationId, eventTypes = [], includeHourly = false } = options;

    const cacheKey = this.getCacheKey(orgId, 'integrationMetrics', options);
    const cached = this.getFromCache(cacheKey);
    if (cached) return cached;

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    try {
      const filters = {
        startDate: startDate.toISOString(),
        endDate: new Date().toISOString(),
        // Use high limit to avoid capping analytics aggregation data
        // TODO: Refactor to use MongoDB aggregation for better performance
        limit: 100000,
      };

      if (integrationId) {
        filters.__KEEP___KEEP_integrationConfig__Id__ = integrationId;
      }

      const logs = await data.listLogs(orgId, filters);

      // Filter by event types if specified
      const filteredLogs = eventTypes.length > 0 ? logs.filter((log) => eventTypes.includes(log.eventType)) : logs;

      // Calculate metrics
      const metrics = this.calculateMetrics(filteredLogs, days, includeHourly);

      this.setCache(cacheKey, metrics);
      return metrics;
    } catch (error) {
      log('error', 'Integration metrics calculation failed', {
        orgId,
        error: error.message,
        options,
      });
      throw error;
    }
  }

  calculateMetrics(logs, days, includeHourly = false) {
    const total = logs.length;
    const successful = logs.filter((l) => l.status === 'SUCCESS').length;
    const failed = logs.filter((l) => l.status === 'FAILED').length;
    const retrying = logs.filter((l) => l.status === 'RETRYING').length;
    const pending = logs.filter((l) => l.status === 'PENDING').length;

    const successRate = total > 0 ? (successful / total) * 100 : 0;

    // Response time calculations
    const responseTimes = logs
      .filter((l) => l.status === 'SUCCESS' && l.responseTimeMs > 0)
      .map((l) => l.responseTimeMs)
      .sort((a, b) => a - b);

    const responseTimeStats = this.calculateResponseTimeStats(responseTimes);

    // Event type breakdown
    const eventTypeBreakdown = {};
    logs.forEach((log) => {
      if (!eventTypeBreakdown[log.eventType]) {
        eventTypeBreakdown[log.eventType] = {
          total: 0,
          successful: 0,
          failed: 0,
          avgResponseTime: 0,
          responseTimeSum: 0,
          responseTimeCount: 0,
        };
      }

      const stats = eventTypeBreakdown[log.eventType];
      stats.total++;

      if (log.status === 'SUCCESS') {
        stats.successful++;
        stats.responseTimeSum += log.responseTimeMs || 0;
        stats.responseTimeCount += log.responseTimeMs > 0 ? 1 : 0;
      } else if (log.status === 'FAILED') {
        stats.failed++;
      }
    });

    // Calculate averages for each event type
    Object.values(eventTypeBreakdown).forEach((stats) => {
      stats.successRate = stats.total > 0 ? (stats.successful / stats.total) * 100 : 0;
      stats.avgResponseTime =
        stats.responseTimeCount > 0 ? Math.round(stats.responseTimeSum / stats.responseTimeCount) : 0;

      // Clean up internal calculations
      delete stats.responseTimeSum;
      delete stats.responseTimeCount;
    });

    // Integration breakdown
    const integrationBreakdown = {};
    logs.forEach((log) => {
      const integrationKey = log.__KEEP___KEEP_integrationConfig__Id__;
      if (!integrationBreakdown[integrationKey]) {
        integrationBreakdown[integrationKey] = {
          __KEEP_integrationName__: log.__KEEP_integrationName__,
          __KEEP___KEEP_integrationConfig__Id__: log.__KEEP___KEEP_integrationConfig__Id__,
          total: 0,
          successful: 0,
          failed: 0,
          avgResponseTime: 0,
          responseTimeSum: 0,
          responseTimeCount: 0,
          lastSuccess: null,
          lastFailure: null,
        };
      }

      const integration = integrationBreakdown[integrationKey];
      integration.total++;

      if (log.status === 'SUCCESS') {
        integration.successful++;
        integration.responseTimeSum += log.responseTimeMs || 0;
        integration.responseTimeCount += log.responseTimeMs > 0 ? 1 : 0;
        integration.lastSuccess = log.createdAt;
      } else if (log.status === 'FAILED') {
        integration.failed++;
        if (!integration.lastFailure || new Date(log.createdAt) > new Date(integration.lastFailure)) {
          integration.lastFailure = log.createdAt;
        }
      }
    });

    // Calculate integration averages
    Object.values(integrationBreakdown).forEach((integration) => {
      integration.successRate = integration.total > 0 ? (integration.successful / integration.total) * 100 : 0;
      integration.avgResponseTime =
        integration.responseTimeCount > 0 ? Math.round(integration.responseTimeSum / integration.responseTimeCount) : 0;

      delete integration.responseTimeSum;
      delete integration.responseTimeCount;
    });

    const metrics = {
      period: {
        days,
        startDate: new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString(),
        endDate: new Date().toISOString(),
      },
      summary: {
        total,
        successful,
        failed,
        retrying,
        pending,
        successRate: Math.round(successRate * 100) / 100,
      },
      performance: responseTimeStats,
      eventTypes: eventTypeBreakdown,
      integrations: Object.values(integrationBreakdown).sort((a, b) => b.total - a.total),
    };

    if (includeHourly) {
      metrics.hourly = this.calculateHourlyBreakdown(logs);
    }

    return metrics;
  }

  calculateResponseTimeStats(responseTimes) {
    if (responseTimes.length === 0) {
      return {
        count: 0,
        min: 0,
        max: 0,
        avg: 0,
        p50: 0,
        p75: 0,
        p90: 0,
        p95: 0,
        p99: 0,
      };
    }

    const getPercentile = (arr, p) => {
      const index = Math.ceil((arr.length * p) / 100) - 1;
      return arr[Math.max(0, Math.min(index, arr.length - 1))];
    };

    return {
      count: responseTimes.length,
      min: responseTimes[0],
      max: responseTimes[responseTimes.length - 1],
      avg: Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length),
      p50: getPercentile(responseTimes, 50),
      p75: getPercentile(responseTimes, 75),
      p90: getPercentile(responseTimes, 90),
      p95: getPercentile(responseTimes, 95),
      p99: getPercentile(responseTimes, 99),
    };
  }

  calculateHourlyBreakdown(logs) {
    const hourly = {};

    // Initialize hourly buckets for the last 24 hours
    for (let i = 23; i >= 0; i--) {
      const hour = new Date();
      hour.setHours(hour.getHours() - i, 0, 0, 0);
      const key = hour.toISOString();
      hourly[key] = {
        timestamp: key,
        hour: hour.getHours(),
        total: 0,
        successful: 0,
        failed: 0,
        avgResponseTime: 0,
        responseTimeSum: 0,
        responseTimeCount: 0,
      };
    }

    // Populate hourly data
    logs.forEach((log) => {
      const logDate = new Date(log.createdAt);
      const hourKey = new Date(
        logDate.getFullYear(),
        logDate.getMonth(),
        logDate.getDate(),
        logDate.getHours(),
        0,
        0,
        0
      ).toISOString();

      if (hourly[hourKey]) {
        const hour = hourly[hourKey];
        hour.total++;

        if (log.status === 'SUCCESS') {
          hour.successful++;
          if (log.responseTimeMs > 0) {
            hour.responseTimeSum += log.responseTimeMs;
            hour.responseTimeCount++;
          }
        } else if (log.status === 'FAILED') {
          hour.failed++;
        }
      }
    });

    // Calculate averages and clean up
    Object.values(hourly).forEach((hour) => {
      hour.avgResponseTime = hour.responseTimeCount > 0 ? Math.round(hour.responseTimeSum / hour.responseTimeCount) : 0;
      hour.successRate = hour.total > 0 ? (hour.successful / hour.total) * 100 : 0;

      delete hour.responseTimeSum;
      delete hour.responseTimeCount;
    });

    return Object.values(hourly);
  }

  async getErrorTrends(orgId, days = 7) {
    const cacheKey = this.getCacheKey(orgId, 'errorTrends', { days });
    const cached = this.getFromCache(cacheKey);
    if (cached) return cached;

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    try {
      const filters = {
        status: 'FAILED',
        startDate: startDate.toISOString(),
        endDate: new Date().toISOString(),
        // Use high limit to avoid capping error trends data
        // TODO: Refactor to use MongoDB aggregation for better performance
        limit: 100000,
      };

      const logs = await data.listLogs(orgId, filters);

      // Group errors by day and error type
      const errorTrends = {};

      logs.forEach((log) => {
        const day = new Date(log.createdAt).toISOString().split('T')[0];
        const errorType = this.categorizeError(log);

        if (!errorTrends[day]) {
          errorTrends[day] = {
            date: day,
            total: 0,
            byType: {},
            byIntegration: {},
          };
        }

        errorTrends[day].total++;

        // Count by error type
        if (!errorTrends[day].byType[errorType]) {
          errorTrends[day].byType[errorType] = 0;
        }
        errorTrends[day].byType[errorType]++;

        // Count by integration
        const integrationKey = log.__KEEP_integrationName__ || log.__KEEP___KEEP_integrationConfig__Id__;
        if (!errorTrends[day].byIntegration[integrationKey]) {
          errorTrends[day].byIntegration[integrationKey] = 0;
        }
        errorTrends[day].byIntegration[integrationKey]++;
      });

      const trends = Object.values(errorTrends).sort((a, b) => a.date.localeCompare(b.date));

      this.setCache(cacheKey, trends);
      return trends;
    } catch (error) {
      log('error', 'Error trends calculation failed', {
        orgId,
        error: error.message,
      });
      throw error;
    }
  }

  categorizeError(log) {
    // HTTP status code based categorization
    if (log.responseStatus) {
      if (log.responseStatus >= 500) return 'Server Error';
      if (log.responseStatus === 429) return 'Rate Limited';
      if (log.responseStatus >= 400) return 'Client Error';
      if (log.responseStatus === 0) return 'Network/Connection';
    }

    // Error message based categorization
    const message = (log.errorMessage || '').toLowerCase();
    if (message.includes('timeout')) return 'Timeout';
    if (message.includes('network') || message.includes('connection')) return 'Network/Connection';
    if (message.includes('dns') || message.includes('resolve')) return 'DNS';
    if (message.includes('ssl') || message.includes('tls') || message.includes('certificate')) return 'SSL/TLS';
    if (message.includes('transform') || message.includes('script')) return 'Transformation';
    if (message.includes('auth')) return 'Authentication';
    if (message.includes('rate') || message.includes('limit')) return 'Rate Limited';

    return 'Other';
  }

  clearCache() {
    this.cache.clear();
  }
}

// Singleton instance
const analyticsAggregator = new AnalyticsAggregator();

module.exports = analyticsAggregator;
