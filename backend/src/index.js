if (!Object.hasOwn) {
  Object.hasOwn = (obj, prop) => {
    if (obj === null || obj === undefined) {
      throw new TypeError('Cannot convert undefined or null to object');
    }
    return Object.prototype.hasOwnProperty.call(obj, prop);
  };
}

const express = require('express');
const cors = require('cors');

const { requestLogger, log, logError } = require('./logger');
const { closeLogStreams } = require('./logger');
const errorHandler = require('./middleware/error-handler');
const auth = require('./middleware/auth');
const rateLimit = require('./middleware/rate-limit');
const requestIdMiddleware = require('./middleware/request-id');
const data = require('./data');
const config = require('./config');
const db = require('./db');
const mongodb = require('./mongodb');
const { startDeliveryWorker } = require('./processor/worker');
const { startPendingDeliveriesWorker, stopPendingDeliveriesWorker } = require('./processor/pending-deliveries-worker');
const { startSchedulerWorker } = require('./processor/scheduler-worker');
const { getScheduledJobWorker } = require('./processor/scheduled-job-worker');
const { startDLQWorker, stopDLQWorker } = require('./processor/dlq-worker');
const { startFailureEmailReportScheduler } = require('./services/notifications/failure-report');
const emailService = require('./services/email-service');
const dailyReportsScheduler = require('./services/daily-reports-scheduler');

const authRouter = require('./routes/auth');
const usersRouter = require('./routes/users');
const adminRouter = require('./routes/admin');
const rolesRouter = require('./routes/roles');
const auditRouter = require('./routes/audit');
const outboundIntegrationsRouter = require('./routes/outbound-integrations');
const inboundIntegrationsRouter = require('./routes/integrations');
const inboundRuntimePublicRouter = require('./routes/inbound-runtime-public');
const logsRouter = require('./routes/logs');
const systemLogsRouter = require('./routes/system-logs');
const systemStatusRouter = require('./routes/system-status');
const clientErrorsRouter = require('./routes/client-errors');
const dashboardRouter = require('./routes/dashboard');
const tenantRouter = require('./routes/tenant');
const analyticsRouter = require('./routes/analytics');
const templatesRouter = require('./routes/templates');
const bulkRouter = require('./routes/bulk');
const importExportRouter = require('./routes/import-export');
const versionsRouter = require('./routes/versions');
const fieldSchemasRouter = require('./routes/field-schemas');
const configRouter = require('./routes/config');
const scheduledIntegrationsRouter = require('./routes/scheduled-integrations');
const scheduledJobsRouter = require('./routes/scheduled-jobs');
const alertCenterRouter = require('./routes/alert-center');
const aiRouter = require('./routes/ai');
const aiConfigRouter = require('./routes/ai-config');
const lookupsRouter = require('./routes/lookups');
const dailyReportsRouter = require('./routes/daily-reports');
const eventsRouter = require('./routes/events');
const eventSourcesRouter = require('./routes/event-sources');
const executionLogsRouter = require('./routes/execution-logs');
const dlqRouter = require('./routes/dlq');
const portalProfilesRouter = require('./routes/portal-profiles');
const healthMonitor = require('./services/health-monitor');
const { initializeCommunicationAdapters } = require('./services/communication/bootstrap');
const { MemoryMonitor } = require('./services/memory-monitor');
const processLifecycle = require('./services/process-lifecycle');

let server = null;
let memoryMonitor = null;
let stopDeliveryWorker = async () => {};
let stopSchedulerWorker = () => {};
let stopFailureEmailReportScheduler = () => {};
let shutdownState = {
  draining: false,
  reason: null,
  startedAt: null,
};

function normalizeHealthStatus(status) {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'ok') return 'healthy';
  if (normalized === 'degraded') return 'warning';
  if (normalized === 'healthy' || normalized === 'warning' || normalized === 'critical' || normalized === 'error') {
    return normalized;
  }
  return 'unknown';
}

function getWorkerHealthState(worker) {
  if (!worker) {
    return {
      enabled: true,
      state: 'unknown',
      available: false,
      hardFailure: true,
      degraded: false,
    };
  }

  if (worker.enabled === false) {
    return {
      enabled: false,
      state: 'disabled',
      available: true,
      hardFailure: false,
      degraded: false,
    };
  }

  const state = worker.status
    || (worker.alive ? 'healthy' : worker.running ? 'stale' : 'stopped');

  return {
    enabled: true,
    state,
    available: worker.available !== undefined ? Boolean(worker.available) : state !== 'stopped',
    hardFailure: state === 'stopped' || state === 'unknown',
    degraded: state === 'stale' || state === 'starting',
  };
}

async function closeHttpServer() {
  if (!server) return;

  await new Promise((resolve) => {
    try {
      server.close(() => resolve());
      setTimeout(resolve, 5000);
    } catch (_error) {
      resolve();
    }
  });
}

async function initiateGracefulDrain(reason, error = null, options = {}) {
  if (shutdownState.draining) {
    return;
  }

  shutdownState = {
    draining: true,
    reason,
    startedAt: new Date().toISOString(),
  };

  const severity = error ? 'error' : 'warn';
  log(severity, 'Initiating graceful drain', {
    reason,
    error: error?.message || null,
  });

  await processLifecycle.markProcessDraining(reason, error, {
    pid: process.pid,
    allowNaturalExit: true,
  }).catch((markerError) => {
    log('error', 'Failed to write draining process marker', { error: markerError.message, reason });
  });

  if (memoryMonitor) {
    memoryMonitor.stop();
  }

  dailyReportsScheduler.stop();

  await Promise.allSettled([
    Promise.resolve().then(() => stopDeliveryWorker()),
    Promise.resolve().then(() => stopSchedulerWorker()),
    Promise.resolve().then(() => stopPendingDeliveriesWorker()),
    Promise.resolve().then(() => stopDLQWorker()),
    Promise.resolve().then(() => getScheduledJobWorker().stop()),
    Promise.resolve().then(() => stopFailureEmailReportScheduler()),
    Promise.resolve().then(() => closeHttpServer()),
    Promise.resolve().then(() => db.closePool?.()),
    Promise.resolve().then(() => mongodb.close?.()),
  ]);

  await processLifecycle.markProcessStopped(reason, error, {
    pid: process.pid,
    naturalExitExpected: true,
  }).catch((markerError) => {
    log('error', 'Failed to write stopped process marker', { error: markerError.message, reason });
  });

  closeLogStreams();

  if (options.exitCode !== undefined) {
    process.exitCode = options.exitCode;
  }
}

async function bootstrap() {
  const lifecycleInfo = await processLifecycle.markProcessStart({
    status: 'starting',
    pid: process.pid,
    startedAt: new Date().toISOString(),
  });
  if (lifecycleInfo.crashMarker) {
    log('error', 'Detected previous abrupt process stop', {
      markerPath: lifecycleInfo.crashMarker.markerPath,
      previousPid: lifecycleInfo.crashMarker.previousState?.pid || null,
      previousStatus: lifecycleInfo.crashMarker.previousState?.status || null,
      previousStartedAt: lifecycleInfo.crashMarker.previousState?.startedAt || null,
      detectedAt: lifecycleInfo.crashMarker.detectedAt,
    });
  }

  await data.initDataLayer();

  // Initialize communication adapters (email, SMS, WhatsApp, etc.)
  initializeCommunicationAdapters();

  // Initialize audit log indexes
  const { ensureAuditIndexes } = require('./services/audit-logger');
  ensureAuditIndexes();

  // Initialize user activity indexes
  const { ensureActivityIndexes } = require('./services/user-activity-tracker');
  ensureActivityIndexes();

  // Apply runtime system config from MongoDB, overriding config.json defaults in-place
  const { applyRuntimeConfig } = require('./data/system-config');
  await applyRuntimeConfig();

  // Initialize AI collection indexes (unique constraint on ai_configs, TTL on ai_interactions)
  const aiConfigData = require('./data/ai-config');
  await aiConfigData.ensureIndexes().catch((err) => {
    log('warn', 'Failed to ensure ai_configs indexes', { error: err.message });
  });
  const { createIndexes: createAIInteractionIndexes } = require('./services/ai/interaction-logger');
  await createAIInteractionIndexes().catch((err) => {
    log('warn', 'Failed to ensure ai_interactions indexes', { error: err.message });
  });

  // Initialize portal access profile indexes
  const portalProfileData = require('./data/portal-access-profiles');
  await portalProfileData.ensureIndexes().catch((err) => {
    log('warn', 'Failed to ensure portal_access_profiles indexes', { error: err.message });
  });

  // Pre-warm the system prompt cache from DB (non-blocking)
  const { initSystemPromptCache } = require('./services/ai/prompts/system-context');
  initSystemPromptCache().catch(() => {}); // silent — falls back to hardcoded default

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.server?.trustProxy ?? false);
  app.use(
    cors({
      origin: true,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'X-API-Key', 'Authorization'],
      exposedHeaders: ['X-Request-Id', 'X-Total-Count'],
    })
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(requestIdMiddleware); // Add request ID first for tracking
  app.use(requestLogger);
  app.use(rateLimit); // Rate limiting before auth

  // Public inbound runtime endpoint. Uses per-integration inbound auth inside the runtime handler.
  app.use(`${config.api.basePrefix}/public/integrations`, inboundRuntimePublicRouter);

  // Auth routes (no API key required)
  app.use(`${config.api.basePrefix}/auth`, authRouter);
  app.use(`${config.api.basePrefix}/users`, usersRouter); // User management (auth required inside routes)
  // IMPORTANT: Mount more specific routes BEFORE general routes
  app.use(`${config.api.basePrefix}/admin/audit`, auth, auditRouter);
  app.use(`${config.api.basePrefix}/admin/roles`, auth, rolesRouter);
  app.use(`${config.api.basePrefix}/admin`, auth, adminRouter);

  app.get('/health', async (req, res) => {
    try {
      if (shutdownState.draining) {
        return res.status(503).json({
          status: 'draining',
          timestamp: new Date().toISOString(),
          reason: shutdownState.reason,
          startedAt: shutdownState.startedAt,
        });
      }

      const { checkWorkers } = require('./worker-heartbeat');

      // Get orgId from auth middleware if present, otherwise use default
      const orgId = req.orgId || 1;

      const healthStatus = await healthMonitor.getSystemHealth(orgId);
      const workerStatus = checkWorkers();
      const mysqlAvailable = data.isMysqlAvailable();

      const coreWorkers = {
        deliveryWorker: getWorkerHealthState(workerStatus.deliveryWorker),
        schedulerWorker: getWorkerHealthState(workerStatus.schedulerWorker),
      };
      const workerHardFailure = Object.values(coreWorkers).some((worker) => worker.hardFailure);
      const workerDegraded = Object.values(coreWorkers).some((worker) => worker.degraded);

      // Set appropriate HTTP status based on health AND worker status
      let statusCode = 200;
      let overallStatus = normalizeHealthStatus(healthStatus.status);

      // MySQL unavailability is a warning, not a critical failure (API/UI still work)
      if (!mysqlAvailable && overallStatus === 'healthy') {
        overallStatus = 'warning';
      }

      if (workerHardFailure) {
        statusCode = 503; // Service Unavailable - core worker is stopped/unavailable
        overallStatus = 'critical';
      } else if (workerDegraded && overallStatus === 'healthy') {
        overallStatus = 'warning';
      } else if (overallStatus === 'critical') {
        statusCode = 503;
      } else if (overallStatus === 'error') {
        statusCode = 500;
      }

      res.status(statusCode).json({
        ...healthStatus,
        status: overallStatus,
        workers: workerStatus,
        workerSummary: {
          coreWorkers,
          hardFailure: workerHardFailure,
          degraded: workerDegraded,
        },
        mysql: {
          available: mysqlAvailable,
          status: mysqlAvailable ? 'connected' : 'disconnected',
          note: mysqlAvailable ? null : 'Delivery worker disabled until MySQL reconnects',
        },
      });
    } catch (err) {
      logError(err, { scope: 'health endpoint' });
      res.status(500).json({
        status: 'error',
        timestamp: new Date().toISOString(),
        error: 'Health check failed',
      });
    }
  });

  app.use(`${config.api.basePrefix}/outbound-integrations`, auth, outboundIntegrationsRouter);
  app.use(`${config.api.basePrefix}/inbound-integrations`, auth, inboundIntegrationsRouter);
  app.use(`${config.api.basePrefix}/integrations`, auth, inboundIntegrationsRouter); // Runtime proxy endpoint
  app.use(`${config.api.basePrefix}/logs`, auth, logsRouter);
  app.use(`${config.api.basePrefix}/system-status`, auth, systemStatusRouter);
  app.use(`${config.api.basePrefix}/events`, auth, eventsRouter);
  app.use(`${config.api.basePrefix}/event-sources`, auth, eventSourcesRouter);
  app.use(`${config.api.basePrefix}/system-logs`, auth, systemLogsRouter);
  app.use(`${config.api.basePrefix}/client-errors`, auth, clientErrorsRouter);
  app.use(`${config.api.basePrefix}/dashboard`, auth, dashboardRouter);
  app.use(`${config.api.basePrefix}/tenant`, auth, tenantRouter);
  app.use(`${config.api.basePrefix}/analytics`, auth, analyticsRouter);
  app.use(`${config.api.basePrefix}/templates`, auth, templatesRouter);
  app.use(`${config.api.basePrefix}/bulk`, auth, bulkRouter);
  app.use(`${config.api.basePrefix}/import-export`, auth, importExportRouter);
  app.use(`${config.api.basePrefix}/versions`, auth, versionsRouter);
  app.use(`${config.api.basePrefix}/field-schemas`, auth, fieldSchemasRouter);
  app.use(`${config.api.basePrefix}/config`, auth, configRouter);
  app.use(`${config.api.basePrefix}/scheduled-integrations`, auth, scheduledIntegrationsRouter);
  app.use(`${config.api.basePrefix}/scheduled-jobs`, auth, scheduledJobsRouter);
  app.use(`${config.api.basePrefix}/alert-center`, auth, alertCenterRouter);
  app.use(`${config.api.basePrefix}/ai`, auth, aiRouter);
  app.use(`${config.api.basePrefix}/ai-config`, auth, aiConfigRouter);
  app.use(`${config.api.basePrefix}/lookups`, auth, lookupsRouter);
  app.use(`${config.api.basePrefix}/daily-reports`, auth, dailyReportsRouter);
  app.use(`${config.api.basePrefix}/execution-logs`, auth, executionLogsRouter);
  app.use(`${config.api.basePrefix}/dlq`, auth, dlqRouter);
  // Portal Access Profile management (auth inside routes, supports SUPER_ADMIN / ADMIN / ORG_ADMIN)
  app.use(`${config.api.basePrefix}/portal-profiles`, portalProfilesRouter);

  app.use((req, res) => {
    log('warn', 'Route not found', { path: req.path });
    res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
  });

  app.use(errorHandler);

  server = app.listen(config.port, async () => {
    log('info', `Event Gateway API listening on port ${config.port}`);

    // Initialize memory monitor for production stability
    memoryMonitor = new MemoryMonitor({
      heapThresholdMB: config.memory?.heapThresholdMB || undefined, // Auto-detect if not configured
      checkIntervalMs: config.memory?.checkIntervalMs || 60000, // Check every minute
      gracefulShutdown: config.memory?.gracefulShutdown !== false, // Default true
    });
    memoryMonitor.start();

    // Log initial memory stats
    log('info', 'Memory monitor initialized', memoryMonitor.getMemoryReport());
    await processLifecycle.markProcessRunning({
      port: config.port,
      pid: process.pid,
      memoryGracefulShutdownEnabled: config.memory?.gracefulShutdown !== false,
    }).catch((markerError) => {
      log('error', 'Failed to write running process marker', { error: markerError.message });
    });
  });

  stopDeliveryWorker = await startDeliveryWorker();
  stopSchedulerWorker = startSchedulerWorker(); // Start scheduler for delayed/recurring integrations
  startDLQWorker(); // Start DLQ worker for automatic retries
  stopFailureEmailReportScheduler = startFailureEmailReportScheduler(); // Periodic failure report emails
  startPendingDeliveriesWorker(); // Start worker for INBOUND COMMUNICATION jobs

  // Start scheduled job worker for cron-based batch integrations
  const scheduledJobWorker = getScheduledJobWorker();
  await scheduledJobWorker.start();

  // Initialize email service for daily reports
  emailService.initialize();

  // Start daily reports scheduler (11:59 PM by default)
  dailyReportsScheduler.start();

  // Schedule daily cleanup at 2 AM
  scheduleDailyCleanup();
}

function scheduleDailyCleanup() {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(2, 0, 0, 0); // 2:00 AM

  const msUntil2AM = tomorrow.getTime() - now.getTime();

  setTimeout(() => {
    runDailyCleanup();
    // Schedule again for next day
    scheduleDailyCleanup();
  }, msUntil2AM);

  log('info', `Daily cleanup scheduled for ${tomorrow.toISOString()}`);
}

async function runDailyCleanup() {
  try {
    log('info', 'Starting daily data cleanup');
    await data.cleanupOldData();
    log('info', 'Daily data cleanup completed');
  } catch (err) {
    logError(err, { scope: 'dailyCleanup' });
  }
}

bootstrap().catch((err) => {
  logError(err, { scope: 'bootstrap' });
  processLifecycle.markProcessStopped('bootstrap_failed', err, { pid: process.pid }).finally(() => {
    process.exit(1);
  });
});

process.on('unhandledRejection', (reason) => {
  log('error', 'Unhandled promise rejection', { reason });
});

process.on('uncaughtException', (err) => {
  logError(err, { scope: 'uncaughtException' });
  initiateGracefulDrain('uncaughtException', err, { exitCode: 1 }).catch((drainError) => {
    logError(drainError, { scope: 'uncaughtExceptionDrain' });
    process.exitCode = 1;
  });
});

process.on('SIGTERM', () => {
  initiateGracefulDrain('SIGTERM', null, { exitCode: 0 }).catch((err) => {
    logError(err, { scope: 'sigtermDrain' });
  });
});

process.on('SIGINT', () => {
  initiateGracefulDrain('SIGINT', null, { exitCode: 0 }).catch((err) => {
    logError(err, { scope: 'sigintDrain' });
  });
});
