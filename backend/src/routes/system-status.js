const express = require('express');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const pkg = require('../../package.json');
const { MemoryMonitor } = require('../services/memory-monitor');
const healthMonitor = require('../services/health-monitor');
const { getWorkersStatus } = require('../worker-heartbeat');
const mongodb = require('../mongodb');
const data = require('../data');
const { getScheduledJobWorker } = require('../processor/scheduled-job-worker');
const { getDeliveryWorkerManager } = require('../processor/delivery-worker-manager');
const { assertViewAllowed } = require('../middleware/portal-scope');

const router = express.Router();

const LOG_DIR = path.join(__dirname, '..', '..', 'logs');

function formatStatus(status) {
  if (!status) return 'unknown';
  return String(status).toLowerCase();
}

function getOrgId(req) {
  const raw = req.orgId || req.query.orgId;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function aggregateStatusBreakdown(items = []) {
  return items.reduce((acc, item) => {
    const key = item._id || 'unknown';
    acc[key] = Number(item.count || 0);
    return acc;
  }, {});
}

function summarizeWorkers(workers) {
  const items = Object.values(workers);
  return items.reduce(
    (acc, worker) => {
      if (!worker.enabled) {
        acc.disabled += 1;
      } else if (worker.alive) {
        acc.healthy += 1;
      } else if (worker.running) {
        acc.unhealthy += 1;
      } else {
        acc.stopped += 1;
      }
      acc.total += 1;
      return acc;
    },
    { total: 0, healthy: 0, unhealthy: 0, stopped: 0, disabled: 0 }
  );
}

function deriveWorkerDisplayStatus(worker) {
  if (!worker.enabled) return 'disabled';
  if (worker.alive) return 'healthy';
  if (worker.running && !worker.alive) return 'stale';
  return 'stopped';
}

function summarizeAdapterStatuses(adapters = []) {
  return adapters.reduce(
    (acc, adapter) => {
      const status = formatStatus(adapter.connectionStatus || 'unknown');
      acc.total += 1;
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    },
    { total: 0 }
  );
}

async function readLatestLogFile(prefix) {
  try {
    const files = await fs.readdir(LOG_DIR);
    const matched = files.filter((file) => file.startsWith(`${prefix}-`) && file.endsWith('.log'));
    if (!matched.length) {
      return {
        prefix,
        found: false,
        status: 'missing',
        fileName: null,
        modifiedAt: null,
        ageSeconds: null,
        sizeBytes: null,
      };
    }

    const stats = await Promise.all(
      matched.map(async (fileName) => {
        const fullPath = path.join(LOG_DIR, fileName);
        const stat = await fs.stat(fullPath);
        return { fileName, fullPath, stat };
      })
    );

    stats.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
    const latest = stats[0];
    const ageSeconds = Math.max(0, Math.round((Date.now() - latest.stat.mtimeMs) / 1000));
    return {
      prefix,
      found: true,
      status: ageSeconds > 3600 ? 'stale' : 'fresh',
      fileName: latest.fileName,
      path: latest.fullPath,
      modifiedAt: latest.stat.mtime.toISOString(),
      ageSeconds,
      sizeBytes: latest.stat.size,
    };
  } catch (error) {
    return {
      prefix,
      found: false,
      status: 'error',
      fileName: null,
      modifiedAt: null,
      ageSeconds: null,
      sizeBytes: null,
      error: error.message,
    };
  }
}

async function getBacklogMetrics(db, orgId) {
  const [pendingDeliveries, dlq, scheduledIntegrations] = await Promise.all([
    db.collection('pending_deliveries').aggregate([
      { $match: { orgId } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]).toArray(),
    db.collection('failed_deliveries').aggregate([
      { $match: { orgId } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]).toArray(),
    db.collection('scheduled_integrations').aggregate([
      { $match: { orgId } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]).toArray(),
  ]);

  return {
    pendingDeliveries: aggregateStatusBreakdown(pendingDeliveries),
    dlq: aggregateStatusBreakdown(dlq),
    scheduledIntegrations: aggregateStatusBreakdown(scheduledIntegrations),
  };
}

async function getTrafficMetrics(db, orgId) {
  const now = Date.now();
  const windows = {
    last5m: new Date(now - 5 * 60 * 1000),
    last15m: new Date(now - 15 * 60 * 1000),
    last60m: new Date(now - 60 * 60 * 1000),
    last24h: new Date(now - 24 * 60 * 60 * 1000),
  };

  const [executionCounts, eventCounts, directionMix] = await Promise.all([
    Promise.all(
      Object.entries(windows).map(async ([key, start]) => ({
        key,
        count: await db.collection('execution_logs').countDocuments({ orgId, createdAt: { $gte: start } }),
      }))
    ),
    Promise.all(
      Object.entries(windows).map(async ([key, start]) => ({
        key,
        count: await db.collection('event_audit').countDocuments({ orgId, createdAt: { $gte: start } }),
      }))
    ),
    db.collection('execution_logs').aggregate([
      { $match: { orgId, createdAt: { $gte: windows.last60m } } },
      { $group: { _id: '$direction', count: { $sum: 1 } } },
    ]).toArray(),
  ]);

  return {
    deliveries: executionCounts.reduce((acc, row) => {
      acc[row.key] = row.count;
      return acc;
    }, {}),
    inboundEvents: eventCounts.reduce((acc, row) => {
      acc[row.key] = row.count;
      return acc;
    }, {}),
    directionMixLast60m: aggregateStatusBreakdown(directionMix),
  };
}

async function getScheduledJobMetrics(db, orgId) {
  const worker = getScheduledJobWorker();
  const [jobBreakdown, latestLogs] = await Promise.all([
    db.collection('integration_configs').aggregate([
      { $match: { orgId, direction: 'SCHEDULED' } },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          active: { $sum: { $cond: ['$isActive', 1, 0] } },
          inactive: { $sum: { $cond: ['$isActive', 0, 1] } },
          cron: { $sum: { $cond: [{ $eq: ['$schedule.type', 'CRON'] }, 1, 0] } },
          interval: { $sum: { $cond: [{ $eq: ['$schedule.type', 'INTERVAL'] }, 1, 0] } },
        },
      },
    ]).toArray(),
    db.collection('scheduled_job_logs').find({ orgId }).sort({ startedAt: -1 }).limit(5).toArray(),
  ]);

  const summary = jobBreakdown[0] || { total: 0, active: 0, inactive: 0, cron: 0, interval: 0 };
  return {
    summary,
    worker: {
      running: worker.isRunning,
      loadedTasks: worker.scheduledTasks.size,
    },
    recentExecutions: latestLogs.map((log) => ({
      integrationId: log.integrationId?.toString?.() || String(log.integrationId || ''),
      integrationName: log.integrationName || 'Unknown',
      status: formatStatus(log.status),
      startedAt: log.startedAt ? new Date(log.startedAt).toISOString() : null,
      completedAt: log.completedAt ? new Date(log.completedAt).toISOString() : null,
      durationMs: Number(log.durationMs || 0),
      recordsFetched: Number(log.recordsFetched || 0),
      correlationId: log.correlationId || null,
    })),
  };
}

router.get('/', assertViewAllowed('system_status'), async (req, res) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) {
      return res.status(400).json({
        error: 'orgId is required',
        code: 'ORG_ID_REQUIRED',
      });
    }
    const db = await mongodb.getDbSafe();
    const memoryMonitor = new MemoryMonitor();
    const deliveryWorkerManager = getDeliveryWorkerManager();

    const [healthStatus, backlogMetrics, trafficMetrics, scheduledJobs, appLog, accessLog, adapterStatus] = await Promise.all([
      healthMonitor.getSystemHealth(orgId),
      getBacklogMetrics(db, orgId),
      getTrafficMetrics(db, orgId),
      getScheduledJobMetrics(db, orgId),
      readLatestLogFile('app'),
      readLatestLogFile('access'),
      deliveryWorkerManager.getStatus(),
    ]);

    const workers = getWorkersStatus();
    const workerSummary = summarizeWorkers(workers);
    const mysqlAvailable = data.isMysqlAvailable();
    const memoryStats = memoryMonitor.getMemoryStats();
    const memoryReport = memoryMonitor.getMemoryReport();
    const processStartedAt = new Date(Date.now() - process.uptime() * 1000).toISOString();

    const orgAdapters = adapterStatus.adapters.filter((adapter) => Number(adapter.orgId) === orgId);
    const desiredAdapter = (adapterStatus.desiredConfigs || []).find((entry) => Number(entry.orgId) === orgId) || null;
    const configurationState = desiredAdapter
      ? {
          configured: true,
          sourceType: desiredAdapter.sourceType,
          configOrigin: desiredAdapter.configOrigin,
          state: desiredAdapter.state,
          error: desiredAdapter.error || null,
        }
      : {
          configured: false,
          sourceType: null,
          configOrigin: null,
          state: 'not_configured',
          error: null,
        };

    const response = {
      timestamp: new Date().toISOString(),
      orgId,
      overall: {
        status: formatStatus(healthStatus.status),
        alertCount: healthStatus.alertCount || {
          critical: 0,
          warning: 0,
          total: (healthStatus.alerts || []).length,
        },
        summary: {
          deliveries24h: Number(healthStatus.metrics?.delivery?.total24h || 0),
          successRate24h: Number(healthStatus.metrics?.delivery?.successRate24h || 0),
          failed24h: Number(healthStatus.metrics?.delivery?.failedCount24h || 0),
          pendingCount: Number(healthStatus.metrics?.delivery?.pendingCount || 0),
          retryingCount: Number(healthStatus.metrics?.delivery?.retryingCount || 0),
          p95ResponseTimeMs: Number(healthStatus.metrics?.performance?.p95ResponseTime || 0),
        },
      },
      process: {
        appVersion: pkg.version || 'unknown',
        pid: process.pid,
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
        environment: process.env.NODE_ENV || 'development',
        startedAt: processStartedAt,
        uptime: healthStatus.metrics?.system?.uptime || null,
        memory: {
          stats: memoryStats,
          report: memoryReport,
        },
        host: {
          hostname: os.hostname(),
          loadAverage: os.loadavg(),
          totalMemoryBytes: os.totalmem(),
          freeMemoryBytes: os.freemem(),
        },
        mysql: {
          available: mysqlAvailable,
          status: mysqlAvailable ? 'connected' : 'disconnected',
        },
      },
      workers: {
        summary: workerSummary,
        items: Object.values(workers).map((worker) => ({
          ...worker,
          status: deriveWorkerDisplayStatus(worker),
        })),
      },
      traffic: trafficMetrics,
      backlogs: backlogMetrics,
      scheduledJobs,
      eventSources: {
        manager: {
          adapterCount: adapterStatus.count,
          refreshIntervalMs: adapterStatus.refreshIntervalMs,
          lastSyncStartedAt: adapterStatus.lastSyncStartedAt,
          lastSyncFinishedAt: adapterStatus.lastSyncFinishedAt,
          lastSyncErrorAt: adapterStatus.lastSyncErrorAt,
          lastSyncErrorMessage: adapterStatus.lastSyncErrorMessage,
        },
        configuration: configurationState,
        summary: summarizeAdapterStatuses(orgAdapters),
        orgAdapters,
      },
      logs: {
        directory: LOG_DIR,
        app: appLog,
        access: accessLog,
      },
      alerts: (healthStatus.alerts || []).map((alert) => ({
        ...alert,
        severity: formatStatus(alert.severity),
      })),
      checks: healthStatus.checks || {},
    };

    res.json(response);
  } catch (error) {
    res.status(500).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      error: error.message,
    });
  }
});

module.exports = router;
