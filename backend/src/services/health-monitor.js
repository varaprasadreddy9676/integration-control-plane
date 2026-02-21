const data = require('../data');
const { log } = require('../logger');
const analyticsAggregator = require('./analytics-aggregator');

class HealthMonitor {
  constructor() {
    this.thresholds = {
      successRateWarning: 90,    // Below 90% is concerning
      successRateCritical: 75,   // Below 75% is critical
      responseTimeWarning: 5000, // Above 5s is concerning
      responseTimeCritical: 10000, // Above 10s is critical
      errorRateWarning: 10,      // Above 10% errors is concerning
      errorRateCritical: 25,     // Above 25% errors is critical
      queueSizeWarning: 100,     // Above 100 items is concerning
      queueSizeCritical: 500     // Above 500 items is critical
    };
  }

  async getSystemHealth(orgId) {
    try {
      const [
        summary,
        integrationMetrics,
        errorTrends,
        memoryUsage,
        uptime
      ] = await Promise.all([
        data.getDashboardSummary(orgId),
        analyticsAggregator.getIntegrationMetrics(orgId, { days: 1 }),
        analyticsAggregator.getErrorTrends(orgId, 1),
        this.getMemoryStats(),
        this.getUptimeStats()
      ]);

      const healthStatus = {
        timestamp: new Date().toISOString(),
        status: 'healthy',
        alerts: [],
        metrics: {
          delivery: {
            total24h: summary.totalDeliveries24h || 0,
            successRate24h: summary.successRate24h || 0,
            failedCount24h: summary.failedCount24h || 0,
            avgResponseTime24h: summary.avgResponseTimeMs24h || 0,
            pendingCount: integrationMetrics.summary.pending || 0,
            retryingCount: integrationMetrics.summary.retrying || 0
          },
          system: {
            uptime: uptime.uptime,
            memoryUsage: memoryUsage.percentage,
            memoryUsed: memoryUsage.used,
            memoryTotal: memoryUsage.total,
            nodeVersion: process.version
          },
          performance: {
            p95ResponseTime: integrationMetrics.performance.p95 || 0,
            p99ResponseTime: integrationMetrics.performance.p99 || 0,
            queueSize: (integrationMetrics.summary.pending + integrationMetrics.summary.retrying) || 0
          }
        },
        checks: {}
      };

      // Perform health checks
      this.checkSuccessRate(healthStatus);
      this.checkResponseTime(healthStatus);
      this.checkErrorRate(healthStatus);
      this.checkQueueSize(healthStatus);
      this.checkMemoryUsage(healthStatus);
      this.checkIntegrationHealth(healthStatus, integrationMetrics.integrations);

      // Determine overall status
      const criticalAlerts = healthStatus.alerts.filter(alert => alert.severity === 'critical');
      const warningAlerts = healthStatus.alerts.filter(alert => alert.severity === 'warning');

      if (criticalAlerts.length > 0) {
        healthStatus.status = 'critical';
      } else if (warningAlerts.length > 0) {
        healthStatus.status = 'warning';
      }

      healthStatus.alertCount = {
        critical: criticalAlerts.length,
        warning: warningAlerts.length,
        total: healthStatus.alerts.length
      };

      return healthStatus;

    } catch (error) {
      log('error', 'System health check failed', {
        orgId,
        error: error.message
      });

      return {
        timestamp: new Date().toISOString(),
        status: 'error',
        error: 'Health check failed',
        metrics: {},
        alerts: [{
          type: 'health_check_failure',
          severity: 'critical',
          message: 'Unable to perform health check',
          timestamp: new Date().toISOString()
        }]
      };
    }
  }

  checkSuccessRate(healthStatus) {
    const successRate = healthStatus.metrics.delivery.successRate24h;

    if (successRate < this.thresholds.successRateCritical) {
      healthStatus.alerts.push({
        type: 'low_success_rate',
        severity: 'critical',
        message: `Success rate critically low: ${successRate.toFixed(1)}%`,
        threshold: this.thresholds.successRateCritical,
        current: successRate,
        timestamp: new Date().toISOString()
      });
      healthStatus.checks.successRate = 'critical';
    } else if (successRate < this.thresholds.successRateWarning) {
      healthStatus.alerts.push({
        type: 'low_success_rate',
        severity: 'warning',
        message: `Success rate below optimal: ${successRate.toFixed(1)}%`,
        threshold: this.thresholds.successRateWarning,
        current: successRate,
        timestamp: new Date().toISOString()
      });
      healthStatus.checks.successRate = 'warning';
    } else {
      healthStatus.checks.successRate = 'healthy';
    }
  }

  checkResponseTime(healthStatus) {
    const p95ResponseTime = healthStatus.metrics.performance.p95ResponseTime;

    if (p95ResponseTime > this.thresholds.responseTimeCritical) {
      healthStatus.alerts.push({
        type: 'high_response_time',
        severity: 'critical',
        message: `95th percentile response time critically high: ${p95ResponseTime}ms`,
        threshold: this.thresholds.responseTimeCritical,
        current: p95ResponseTime,
        timestamp: new Date().toISOString()
      });
      healthStatus.checks.responseTime = 'critical';
    } else if (p95ResponseTime > this.thresholds.responseTimeWarning) {
      healthStatus.alerts.push({
        type: 'high_response_time',
        severity: 'warning',
        message: `95th percentile response time elevated: ${p95ResponseTime}ms`,
        threshold: this.thresholds.responseTimeWarning,
        current: p95ResponseTime,
        timestamp: new Date().toISOString()
      });
      healthStatus.checks.responseTime = 'warning';
    } else {
      healthStatus.checks.responseTime = 'healthy';
    }
  }

  checkErrorRate(healthStatus) {
    const total = healthStatus.metrics.delivery.total24h;
    const failed = healthStatus.metrics.delivery.failedCount24h;

    if (total > 0) {
      const errorRate = (failed / total) * 100;

      if (errorRate > this.thresholds.errorRateCritical) {
        healthStatus.alerts.push({
          type: 'high_error_rate',
          severity: 'critical',
          message: `Error rate critically high: ${errorRate.toFixed(1)}%`,
          threshold: this.thresholds.errorRateCritical,
          current: errorRate,
          timestamp: new Date().toISOString()
        });
        healthStatus.checks.errorRate = 'critical';
      } else if (errorRate > this.thresholds.errorRateWarning) {
        healthStatus.alerts.push({
          type: 'high_error_rate',
          severity: 'warning',
          message: `Error rate elevated: ${errorRate.toFixed(1)}%`,
          threshold: this.thresholds.errorRateWarning,
          current: errorRate,
          timestamp: new Date().toISOString()
        });
        healthStatus.checks.errorRate = 'warning';
      } else {
        healthStatus.checks.errorRate = 'healthy';
      }
    } else {
      healthStatus.checks.errorRate = 'healthy';
    }
  }

  checkQueueSize(healthStatus) {
    const queueSize = healthStatus.metrics.performance.queueSize;

    if (queueSize > this.thresholds.queueSizeCritical) {
      healthStatus.alerts.push({
        type: 'large_queue',
        severity: 'critical',
        message: `Queue size critically large: ${queueSize} items`,
        threshold: this.thresholds.queueSizeCritical,
        current: queueSize,
        timestamp: new Date().toISOString()
      });
      healthStatus.checks.queueSize = 'critical';
    } else if (queueSize > this.thresholds.queueSizeWarning) {
      healthStatus.alerts.push({
        type: 'large_queue',
        severity: 'warning',
        message: `Queue size growing: ${queueSize} items`,
        threshold: this.thresholds.queueSizeWarning,
        current: queueSize,
        timestamp: new Date().toISOString()
      });
      healthStatus.checks.queueSize = 'warning';
    } else {
      healthStatus.checks.queueSize = 'healthy';
    }
  }

  checkMemoryUsage(healthStatus) {
    const memoryUsage = healthStatus.metrics.system.memoryUsage;

    if (memoryUsage > 90) {
      healthStatus.alerts.push({
        type: 'high_memory_usage',
        severity: 'critical',
        message: `Memory usage critically high: ${memoryUsage}%`,
        threshold: 90,
        current: memoryUsage,
        timestamp: new Date().toISOString()
      });
      healthStatus.checks.memory = 'critical';
    } else if (memoryUsage > 80) {
      healthStatus.alerts.push({
        type: 'high_memory_usage',
        severity: 'warning',
        message: `Memory usage elevated: ${memoryUsage}%`,
        threshold: 80,
        current: memoryUsage,
        timestamp: new Date().toISOString()
      });
      healthStatus.checks.memory = 'warning';
    } else {
      healthStatus.checks.memory = 'healthy';
    }
  }

  checkIntegrationHealth(healthStatus, integrations) {
    const unhealthyIntegrations = [];
    const degradedIntegrations = [];

    integrations.forEach(integration => {
      if (integration.total > 0) {
        const integrationSuccessRate = integration.successRate || 0;

        if (integrationSuccessRate < 50) {
          unhealthyIntegrations.push({
            __KEEP_integrationName__: integration.__KEEP_integrationName__,
            successRate: integrationSuccessRate,
            total: integration.total
          });
        } else if (integrationSuccessRate < 80) {
          degradedIntegrations.push({
            __KEEP_integrationName__: integration.__KEEP_integrationName__,
            successRate: integrationSuccessRate,
            total: integration.total
          });
        }
      }
    });

    if (unhealthyIntegrations.length > 0) {
      healthStatus.alerts.push({
        type: 'unhealthy_integrations',
        severity: 'critical',
        message: `${unhealthyIntegrations.length} integrations performing poorly (< 50% success rate)`,
        details: unhealthyIntegrations,
        timestamp: new Date().toISOString()
      });
      healthStatus.checks.integrationHealth = 'critical';
    } else if (degradedIntegrations.length > 0) {
      healthStatus.alerts.push({
        type: 'degraded_integrations',
        severity: 'warning',
        message: `${degradedIntegrations.length} integrations degraded performance (< 80% success rate)`,
        details: degradedIntegrations,
        timestamp: new Date().toISOString()
      });
      healthStatus.checks.integrationHealth = 'warning';
    } else {
      healthStatus.checks.integrationHealth = 'healthy';
    }
  }

  getMemoryStats() {
    const usage = process.memoryUsage();
    const used = Math.round(usage.heapUsed / 1024 / 1024); // MB
    const total = Math.round(usage.heapTotal / 1024 / 1024); // MB
    const percentage = Math.round((usage.heapUsed / usage.heapTotal) * 100);

    return {
      used,
      total,
      percentage,
      external: Math.round(usage.external / 1024 / 1024),
      rss: Math.round(usage.rss / 1024 / 1024)
    };
  }

  getUptimeStats() {
    const uptimeSeconds = process.uptime();
    const uptime = {
      seconds: uptimeSeconds,
      minutes: Math.floor(uptimeSeconds / 60),
      hours: Math.floor(uptimeSeconds / 3600),
      days: Math.floor(uptimeSeconds / 86400),
      uptime: uptimeSeconds
    };

    // Format human readable uptime
    const days = uptime.days;
    const hours = uptime.hours % 24;
    const minutes = uptime.minutes % 60;

    uptime.formatted = days > 0
      ? `${days}d ${hours}h ${minutes}m`
      : hours > 0
        ? `${hours}h ${minutes}m`
        : `${minutes}m`;

    return uptime;
  }

  async getIntegrationHealthHistory(orgId, days = 7) {
    try {
      const metrics = await analyticsAggregator.getIntegrationMetrics(orgId, {
        days,
        includeHourly: true
      });

      return {
        period: metrics.period,
        hourly: metrics.hourly,
        trends: {
          successRateTrend: this.calculateTrend(metrics.hourly, 'successRate'),
          responseTimeTrend: this.calculateTrend(metrics.hourly, 'avgResponseTime'),
          volumeTrend: this.calculateTrend(metrics.hourly, 'total')
        }
      };

    } catch (error) {
      log('error', 'Integration health history failed', {
        orgId,
        error: error.message
      });
      return {
        error: 'Unable to retrieve health history',
        period: null,
        hourly: [],
        trends: {}
      };
    }
  }

  calculateTrend(hourlyData, field) {
    if (hourlyData.length < 2) {
      return { direction: 'stable', change: 0, percentage: 0 };
    }

    const first = hourlyData[0][field] || 0;
    const last = hourlyData[hourlyData.length - 1][field] || 0;
    const change = last - first;
    const percentage = first > 0 ? (change / first) * 100 : 0;

    let direction = 'stable';
    const threshold = 5; // 5% change threshold

    if (Math.abs(percentage) > threshold) {
      direction = percentage > 0 ? 'increasing' : 'decreasing';
    }

    return {
      direction,
      change: Math.round(change * 100) / 100,
      percentage: Math.round(percentage * 100) / 100
    };
  }

  updateThresholds(newThresholds) {
    this.thresholds = { ...this.thresholds, ...newThresholds };
    log('info', 'Health monitoring thresholds updated', { thresholds: this.thresholds });
  }
}

// Singleton instance
const healthMonitor = new HealthMonitor();

module.exports = healthMonitor;
