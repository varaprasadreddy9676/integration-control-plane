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
const processLifecycle = require('../services/process-lifecycle');

const router = express.Router();

const LOG_DIR = path.join(__dirname, '..', '..', 'logs');
const SENDER_PROFILE_COLLECTION = 'communication_sender_profiles';

function formatStatus(status) {
  if (!status) return 'unknown';
  return String(status).toLowerCase();
}

function getOrgId(req) {
  const raw = req.orgId || req.query.orgId;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function canAccessGlobalStatus(req) {
  if (req.user?.isPortalSession) return false;
  return req.user?.role === 'SUPER_ADMIN' || req.user?.role === 'ADMIN';
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
      const status = worker.status || deriveWorkerDisplayStatus(worker);
      if (status === 'disabled') {
        acc.disabled += 1;
      } else if (status === 'healthy') {
        acc.healthy += 1;
      } else if (status === 'starting' || status === 'stale') {
        acc.stale += 1;
      } else {
        acc.stopped += 1;
      }
      acc.total += 1;
      return acc;
    },
    { total: 0, healthy: 0, stale: 0, stopped: 0, disabled: 0 }
  );
}

function deriveWorkerDisplayStatus(worker) {
  if (worker.status) return worker.status;
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

async function readJsonFileSafe(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

async function readLatestCrashMarker() {
  try {
    const files = await fs.readdir(processLifecycle.paths.crashMarkerDir);
    const matched = files
      .filter((file) => file.startsWith('abrupt-restart-') && file.endsWith('.json'))
      .sort()
      .reverse();

    if (!matched.length) {
      return {
        detected: false,
        detectedAt: null,
        previousPid: null,
        previousStatus: null,
        previousStartedAt: null,
        previousUpdatedAt: null,
        previousReason: null,
      };
    }

    const latest = await readJsonFileSafe(path.join(processLifecycle.paths.crashMarkerDir, matched[0]));
    const previousState = latest?.previousState || {};
    return {
      detected: true,
      detectedAt: latest?.detectedAt || null,
      previousPid: previousState.pid || null,
      previousStatus: formatStatus(previousState.status),
      previousStartedAt: previousState.startedAt || null,
      previousUpdatedAt: previousState.updatedAt || null,
      previousReason: previousState.metadata?.reason || null,
    };
  } catch (error) {
    return {
      detected: false,
      detectedAt: null,
      previousPid: null,
      previousStatus: null,
      previousStartedAt: null,
      previousUpdatedAt: null,
      previousReason: null,
      error: error.message,
    };
  }
}

async function getBacklogMetrics(db, orgId) {
  const matchStage = orgId ? [{ $match: { orgId } }] : [];
  const [pendingDeliveries, dlq, scheduledIntegrations] = await Promise.all([
    db.collection('pending_deliveries').aggregate([
      ...matchStage,
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]).toArray(),
    db.collection('failed_deliveries').aggregate([
      ...matchStage,
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]).toArray(),
    db.collection('scheduled_integrations').aggregate([
      ...matchStage,
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
        count: await db.collection('execution_logs').countDocuments({
          ...(orgId ? { orgId } : {}),
          createdAt: { $gte: start },
        }),
      }))
    ),
    Promise.all(
      Object.entries(windows).map(async ([key, start]) => ({
        key,
        count: await db.collection('event_audit').countDocuments({
          ...(orgId ? { orgId } : {}),
          createdAt: { $gte: start },
        }),
      }))
    ),
    db.collection('execution_logs').aggregate([
      { $match: { ...(orgId ? { orgId } : {}), createdAt: { $gte: windows.last60m } } },
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
  const integrationMatch = orgId ? { orgId, direction: 'SCHEDULED' } : { direction: 'SCHEDULED' };
  const logMatch = orgId ? { orgId } : {};
  const [jobBreakdown, latestLogs] = await Promise.all([
    db.collection('integration_configs').aggregate([
      { $match: integrationMatch },
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
    db.collection('scheduled_job_logs').find(logMatch).sort({ startedAt: -1 }).limit(5).toArray(),
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

function aggregateAlertCounts(items = []) {
  return items.reduce(
    (acc, item) => {
      acc.critical += Number(item?.alertCount?.critical || 0);
      acc.warning += Number(item?.alertCount?.warning || 0);
      acc.total += Number(item?.alertCount?.total || 0);
      return acc;
    },
    { critical: 0, warning: 0, total: 0 }
  );
}

function aggregateHealthSummaries(items = []) {
  const totals = items.reduce(
    (acc, item) => {
      const deliveries = Number(item?.metrics?.delivery?.total24h || 0);
      const failed = Number(item?.metrics?.delivery?.failedCount24h || 0);

      acc.deliveries24h += deliveries;
      acc.failed24h += failed;
      acc.pendingCount += Number(item?.metrics?.delivery?.pendingCount || 0);
      acc.retryingCount += Number(item?.metrics?.delivery?.retryingCount || 0);
      acc.successful24h += Math.max(0, deliveries - failed);
      acc.p95ResponseTimeMs = Math.max(acc.p95ResponseTimeMs, Number(item?.metrics?.performance?.p95ResponseTime || 0));
      return acc;
    },
    {
      deliveries24h: 0,
      failed24h: 0,
      pendingCount: 0,
      retryingCount: 0,
      successful24h: 0,
      p95ResponseTimeMs: 0,
    }
  );

  return {
    deliveries24h: totals.deliveries24h,
    successRate24h: totals.deliveries24h > 0 ? Number(((totals.successful24h / totals.deliveries24h) * 100).toFixed(1)) : 0,
    failed24h: totals.failed24h,
    pendingCount: totals.pendingCount,
    retryingCount: totals.retryingCount,
    p95ResponseTimeMs: totals.p95ResponseTimeMs,
  };
}

function deriveOverallStatus(statuses = []) {
  const normalized = statuses.map((status) => formatStatus(status));
  if (normalized.includes('critical') || normalized.includes('error')) return 'critical';
  if (normalized.includes('warning') || normalized.includes('degraded')) return 'warning';
  if (normalized.includes('healthy') || normalized.includes('ok')) return 'healthy';
  return 'unknown';
}

function buildGlobalAlerts({ orgRows, workers, appLog, accessLog, abruptRestart }) {
  const alerts = [];
  const criticalOrgs = orgRows.filter((row) => row.status === 'critical');
  const warningOrgs = orgRows.filter((row) => row.status === 'warning');
  const stoppedWorkers = workers.filter((worker) => worker.status === 'stopped');
  const staleWorkers = workers.filter((worker) => worker.status === 'stale');

  if (criticalOrgs.length > 0) {
    alerts.push({
      type: 'critical_orgs',
      severity: 'critical',
      message: `${criticalOrgs.length} orgs currently report critical system status`,
    });
  }

  if (warningOrgs.length > 0) {
    alerts.push({
      type: 'warning_orgs',
      severity: 'warning',
      message: `${warningOrgs.length} orgs currently report warning/degraded status`,
    });
  }

  if (stoppedWorkers.length > 0) {
    alerts.push({
      type: 'stopped_workers',
      severity: 'critical',
      message: `${stoppedWorkers.length} background workers are stopped`,
    });
  } else if (staleWorkers.length > 0) {
    alerts.push({
      type: 'stale_workers',
      severity: 'warning',
      message: `${staleWorkers.length} background workers are stale`,
    });
  }

  if (appLog?.status === 'stale' || accessLog?.status === 'stale') {
    alerts.push({
      type: 'stale_logs',
      severity: 'warning',
      message: 'One or more runtime log files are stale',
    });
  }

  if (abruptRestart?.detected) {
    alerts.push({
      type: 'abrupt_restart',
      severity: 'warning',
      message: 'Previous process ended abruptly before the current startup',
    });
  }

  return alerts;
}

function buildGlobalChecks({ orgRows, workers, appLog, accessLog }) {
  return {
    organizations: deriveOverallStatus(orgRows.map((row) => row.status)),
    workers: deriveOverallStatus(workers.map((worker) => worker.status)),
    logs:
      appLog?.status === 'error' || accessLog?.status === 'error'
        ? 'critical'
        : appLog?.status === 'stale' || accessLog?.status === 'stale'
          ? 'warning'
          : 'healthy',
  };
}

function buildProcessPayload({ mysqlAvailable, memoryStats, memoryReport, processStartedAt, uptime = null }) {
  return {
    appVersion: pkg.version || 'unknown',
    pid: process.pid,
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    environment: process.env.NODE_ENV || 'development',
    startedAt: processStartedAt,
    uptime,
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
  };
}

function buildProcessLifecyclePayload({ processState, abruptRestart, processStartedAt }) {
  return {
    current: {
      status: formatStatus(processState?.status || 'running'),
      pid: processState?.pid || process.pid,
      startedAt: processState?.startedAt || processStartedAt,
      updatedAt: processState?.updatedAt || null,
      stoppedAt: processState?.stoppedAt || null,
      reason: processState?.metadata?.reason || null,
      allowNaturalExit: Boolean(processState?.metadata?.allowNaturalExit),
      naturalExitExpected: Boolean(processState?.metadata?.naturalExitExpected),
      error: processState?.error
        ? {
            name: processState.error.name || 'Error',
            message: processState.error.message || null,
          }
        : null,
    },
    abruptRestart,
  };
}

function buildWorkersPayload() {
  const workers = getWorkersStatus();
  return {
    summary: summarizeWorkers(workers),
    items: Object.values(workers).map((worker) => ({
      ...worker,
      status: deriveWorkerDisplayStatus(worker),
    })),
  };
}

function summarizeSenderProfileProviders(items = []) {
  return items.reduce((acc, item) => {
    const key = String(item.provider || 'UNKNOWN').toUpperCase();
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function mapSenderProfileStatus(doc) {
  return {
    id: doc._id?.toString?.() || String(doc._id || ''),
    orgId: Number(doc.orgId || 0),
    key: doc.key || null,
    name: doc.name || doc.key || doc.fromEmail || 'Unknown',
    fromEmail: doc.fromEmail || null,
    aliases: Array.isArray(doc.aliases) ? doc.aliases : [],
    provider: String(doc.provider || 'UNKNOWN').toUpperCase(),
    isDefault: doc.isDefault === true,
    isActive: doc.isActive !== false,
    createdAt: doc.createdAt ? new Date(doc.createdAt).toISOString() : null,
    updatedAt: doc.updatedAt ? new Date(doc.updatedAt).toISOString() : null,
  };
}

async function getSenderProfileMetrics(db, orgId) {
  const match = orgId ? { orgId } : {};
  const projection = {
    orgId: 1,
    key: 1,
    name: 1,
    fromEmail: 1,
    aliases: 1,
    provider: 1,
    isDefault: 1,
    isActive: 1,
    createdAt: 1,
    updatedAt: 1,
  };

  const items = await db.collection(SENDER_PROFILE_COLLECTION).find(match, { projection }).sort({ orgId: 1, isDefault: -1, key: 1 }).toArray();
  const mapped = items.map(mapSenderProfileStatus);

  if (orgId) {
    const defaultProfile = mapped.find((item) => item.isDefault) || null;
    return {
      summary: {
        total: mapped.length,
        active: mapped.filter((item) => item.isActive).length,
        inactive: mapped.filter((item) => !item.isActive).length,
        defaultCount: mapped.filter((item) => item.isDefault).length,
        providers: summarizeSenderProfileProviders(mapped),
      },
      defaultProfile,
      items: mapped,
    };
  }

  const orgIds = new Set(mapped.map((item) => item.orgId));
  return {
    summary: {
      total: mapped.length,
      active: mapped.filter((item) => item.isActive).length,
      inactive: mapped.filter((item) => !item.isActive).length,
      defaultCount: mapped.filter((item) => item.isDefault).length,
      organizationCount: orgIds.size,
      providers: summarizeSenderProfileProviders(mapped),
    },
    defaultProfile: null,
    items: [],
  };
}

router.get('/', assertViewAllowed('system_status'), async (req, res) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId && !canAccessGlobalStatus(req)) {
      return res.status(400).json({
        error: 'orgId is required',
        code: 'ORG_ID_REQUIRED',
      });
    }
    const db = await mongodb.getDbSafe();
    const memoryMonitor = new MemoryMonitor();
    const deliveryWorkerManager = getDeliveryWorkerManager();

    const [appLog, accessLog, adapterStatus, processState, abruptRestart] = await Promise.all([
      readLatestLogFile('app'),
      readLatestLogFile('access'),
      deliveryWorkerManager.getStatus(),
      readJsonFileSafe(processLifecycle.paths.stateFile),
      readLatestCrashMarker(),
    ]);

    const mysqlAvailable = data.isMysqlAvailable();
    const memoryStats = memoryMonitor.getMemoryStats();
    const memoryReport = memoryMonitor.getMemoryReport();
    const processStartedAt = new Date(Date.now() - process.uptime() * 1000).toISOString();

    const response = orgId
      ? await (async () => {
          const [healthStatus, backlogMetrics, trafficMetrics, scheduledJobs] = await Promise.all([
            healthMonitor.getSystemHealth(orgId),
            getBacklogMetrics(db, orgId),
            getTrafficMetrics(db, orgId),
            getScheduledJobMetrics(db, orgId),
          ]);
          const senderProfiles = await getSenderProfileMetrics(db, orgId);

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

          return {
            timestamp: new Date().toISOString(),
            scope: 'org',
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
            process: buildProcessPayload({
              mysqlAvailable,
              memoryStats,
              memoryReport,
              processStartedAt,
              uptime: healthStatus.metrics?.system?.uptime || null,
            }),
            processLifecycle: buildProcessLifecyclePayload({ processState, abruptRestart, processStartedAt }),
            workers: buildWorkersPayload(),
            traffic: trafficMetrics,
            backlogs: backlogMetrics,
            scheduledJobs,
            senderProfiles,
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
        })()
      : await (async () => {
          const [backlogMetrics, trafficMetrics, scheduledJobs, tenantSummaries] = await Promise.all([
            getBacklogMetrics(db, null),
            getTrafficMetrics(db, null),
            getScheduledJobMetrics(db, null),
            data.listTenantSummaries(),
          ]);
          const senderProfiles = await getSenderProfileMetrics(db, null);

          const orgHealthRows = await Promise.all(
            tenantSummaries.map(async (org) => ({
              org,
              health: await healthMonitor.getSystemHealth(Number(org.orgId)),
            }))
          );

          const adapterRows = adapterStatus.adapters || [];
          const desiredByOrg = new Map((adapterStatus.desiredConfigs || []).map((entry) => [Number(entry.orgId), entry]));
          const organizations = orgHealthRows.map(({ org, health }) => {
            const orgIdValue = Number(org.orgId);
            const desired = desiredByOrg.get(orgIdValue) || null;
            const orgAdapters = adapterRows.filter((adapter) => Number(adapter.orgId) === orgIdValue);
            return {
              orgId: orgIdValue,
              name: org.name || `Org ${orgIdValue}`,
              code: org.code || null,
              status: deriveOverallStatus([health.status]),
              alertCount: health.alertCount || { critical: 0, warning: 0, total: 0 },
              summary: {
                deliveries24h: Number(health.metrics?.delivery?.total24h || 0),
                successRate24h: Number(health.metrics?.delivery?.successRate24h || 0),
                failed24h: Number(health.metrics?.delivery?.failedCount24h || 0),
                pendingCount: Number(health.metrics?.delivery?.pendingCount || 0),
                retryingCount: Number(health.metrics?.delivery?.retryingCount || 0),
                p95ResponseTimeMs: Number(health.metrics?.performance?.p95ResponseTime || 0),
              },
              eventSources: {
                configured: Boolean(desired),
                sourceType: desired?.sourceType || null,
                state: desired?.state || 'not_configured',
                adapterStatus: orgAdapters[0]?.connectionStatus || null,
                summary: summarizeAdapterStatuses(orgAdapters),
              },
            };
          });

          const alerts = buildGlobalAlerts({
            orgRows: organizations,
            workers: buildWorkersPayload().items,
            appLog,
            accessLog,
            abruptRestart,
          });
          const checks = buildGlobalChecks({
            orgRows: organizations,
            workers: buildWorkersPayload().items,
            appLog,
            accessLog,
          });
          const alertCount = aggregateAlertCounts(orgHealthRows.map((row) => row.health));
          const organizationStatusCounts = organizations.reduce((acc, org) => {
            acc[org.status] = (acc[org.status] || 0) + 1;
            return acc;
          }, {});
          const configuredOrgCount = organizations.filter((org) => org.eventSources.configured).length;

          return {
            timestamp: new Date().toISOString(),
            scope: 'global',
            orgId: null,
            overall: {
              status: deriveOverallStatus([
                ...organizations.map((org) => org.status),
                checks.workers,
                checks.logs,
              ]),
              alertCount: {
                critical: alertCount.critical + alerts.filter((alert) => alert.severity === 'critical').length,
                warning: alertCount.warning + alerts.filter((alert) => alert.severity === 'warning').length,
                total: alertCount.total + alerts.length,
              },
              summary: aggregateHealthSummaries(orgHealthRows.map((row) => row.health)),
            },
            globalSummary: {
              organizationCount: organizations.length,
              organizationStatusCounts,
              eventSourceConfiguredCount: configuredOrgCount,
              eventSourceNotConfiguredCount: organizations.length - configuredOrgCount,
            },
            organizations,
            process: buildProcessPayload({
              mysqlAvailable,
              memoryStats,
              memoryReport,
              processStartedAt,
              uptime: {
                uptime: process.uptime(),
                formatted: `${Math.floor(process.uptime() / 3600)}h ${Math.floor((process.uptime() % 3600) / 60)}m`,
              },
            }),
            processLifecycle: buildProcessLifecyclePayload({ processState, abruptRestart, processStartedAt }),
            workers: buildWorkersPayload(),
            traffic: trafficMetrics,
            backlogs: backlogMetrics,
            scheduledJobs,
            senderProfiles,
            eventSources: {
              manager: {
                adapterCount: adapterStatus.count,
                refreshIntervalMs: adapterStatus.refreshIntervalMs,
                lastSyncStartedAt: adapterStatus.lastSyncStartedAt,
                lastSyncFinishedAt: adapterStatus.lastSyncFinishedAt,
                lastSyncErrorAt: adapterStatus.lastSyncErrorAt,
                lastSyncErrorMessage: adapterStatus.lastSyncErrorMessage,
              },
              configuration: {
                configured: configuredOrgCount > 0,
                sourceType: null,
                configOrigin: null,
                state: 'global',
                error: null,
              },
              summary: summarizeAdapterStatuses(adapterRows),
              orgAdapters: adapterRows,
            },
            logs: {
              directory: LOG_DIR,
              app: appLog,
              access: accessLog,
            },
            alerts,
            checks,
          };
        })();

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
