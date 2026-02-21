if (!Object.hasOwn) {
  Object.hasOwn = (obj, prop) => Object.prototype.hasOwnProperty.call(obj, prop);
}

const express = require('express');
const cors = require('cors');

const { requestLogger, log, logError } = require('./logger');
const errorHandler = require('./middleware/error-handler');
const auth = require('./middleware/auth');
const rateLimit = require('./middleware/rate-limit');
const requestIdMiddleware = require('./middleware/request-id');
const data = require('./data');
const config = require('./config');
const { startDeliveryWorker } = require('./processor/worker');
const { startPendingDeliveriesWorker } = require('./processor/pending-deliveries-worker');
const { startSchedulerWorker } = require('./processor/scheduler-worker');
const { getScheduledJobWorker } = require('./processor/scheduled-job-worker');
const { startDLQWorker } = require('./processor/dlq-worker');
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
const logsRouter = require('./routes/logs');
const systemLogsRouter = require('./routes/system-logs');
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
const healthMonitor = require('./services/health-monitor');
const { initializeCommunicationAdapters } = require('./services/communication/bootstrap');
const { MemoryMonitor } = require('./services/memory-monitor');

async function bootstrap() {
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

  // Pre-warm the system prompt cache from DB (non-blocking)
  const { initSystemPromptCache } = require('./services/ai/prompts/system-context');
  initSystemPromptCache().catch(() => {});  // silent — falls back to hardcoded default

  const app = express();
  app.disable('x-powered-by');
  app.use(
    cors({
      origin: true,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'X-API-Key', 'Authorization'],
      exposedHeaders: ['X-Request-Id', 'X-Total-Count']
    })
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(requestIdMiddleware); // Add request ID first for tracking
  app.use(requestLogger);
  app.use(rateLimit); // Rate limiting before auth

  // Auth routes (no API key required)
  app.use(`${config.api.basePrefix}/auth`, authRouter);
  app.use(`${config.api.basePrefix}/users`, usersRouter); // User management (auth required inside routes)
  // IMPORTANT: Mount more specific routes BEFORE general routes
  app.use(`${config.api.basePrefix}/admin/audit`, auth, auditRouter);
  app.use(`${config.api.basePrefix}/admin/roles`, auth, rolesRouter);
  app.use(`${config.api.basePrefix}/admin`, auth, adminRouter);

  app.get('/health', async (req, res) => {
  try {
    const { checkWorkers } = require('./worker-heartbeat');

    // Get orgId from auth middleware if present, otherwise use default
    const orgId = req.orgId || req.entityParentRid || 1;

    const healthStatus = await healthMonitor.getSystemHealth(orgId);
    const workerStatus = checkWorkers();
    const mysqlAvailable = data.isMysqlAvailable();

    // Check if workers are frozen
    const workersAlive = workerStatus.deliveryWorker.alive && workerStatus.schedulerWorker.alive;

    // Set appropriate HTTP status based on health AND worker status
    let statusCode = 200;
    let overallStatus = healthStatus.status;

    // MySQL unavailability is a warning, not a critical failure (API/UI still work)
    if (!mysqlAvailable && overallStatus === 'ok') {
      overallStatus = 'degraded';
    }

    if (!workersAlive) {
      statusCode = 503; // Service Unavailable - workers frozen
      overallStatus = 'critical';
    } else if (healthStatus.status === 'critical') {
      statusCode = 503;
    } else if (healthStatus.status === 'error') {
      statusCode = 500;
    }

    res.status(statusCode).json({
      ...healthStatus,
      status: overallStatus,
      workers: workerStatus,
      mysql: {
        available: mysqlAvailable,
        status: mysqlAvailable ? 'connected' : 'disconnected',
        note: mysqlAvailable ? null : 'Delivery worker disabled until MySQL reconnects'
      }
    });
  } catch (err) {
    logError(err, { scope: 'health endpoint' });
    res.status(500).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      error: 'Health check failed'
    });
  }
});

  app.use(`${config.api.basePrefix}/outbound-integrations`, auth, outboundIntegrationsRouter);
  app.use(`${config.api.basePrefix}/inbound-integrations`, auth, inboundIntegrationsRouter);
  app.use(`${config.api.basePrefix}/integrations`, auth, inboundIntegrationsRouter); // Runtime proxy endpoint
  app.use(`${config.api.basePrefix}/logs`, auth, logsRouter);
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

  app.use((req, res) => {
    log('warn', 'Route not found', { path: req.path });
    res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
  });

  app.use(errorHandler);

  app.listen(config.port, () => {
    log('info', `Event Gateway API listening on port ${config.port}`);

    // Initialize memory monitor for production stability
    const memoryMonitor = new MemoryMonitor({
      heapThresholdMB: config.memory?.heapThresholdMB || undefined, // Auto-detect if not configured
      checkIntervalMs: config.memory?.checkIntervalMs || 60000, // Check every minute
      gracefulShutdown: config.memory?.gracefulShutdown !== false // Default true
    });
    memoryMonitor.start();

    // Log initial memory stats
    log('info', 'Memory monitor initialized', memoryMonitor.getMemoryReport());
  });

  startDeliveryWorker();
  startSchedulerWorker(); // Start scheduler for delayed/recurring integrations
  startDLQWorker(); // Start DLQ worker for automatic retries
  startFailureEmailReportScheduler(); // Periodic failure report emails
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
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  log('error', 'Unhandled promise rejection', { reason });
});

process.on('uncaughtException', (err) => {
  logError(err, { scope: 'uncaughtException' });
  process.exit(1);
});
