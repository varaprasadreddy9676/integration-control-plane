const express = require('express');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const data = require('../data');
const { log } = require('../logger');
const mongodb = require('../mongodb');
const asyncHandler = require('../utils/async-handler');

const router = express.Router();
const LOG_EXPORT_JOBS_COLLECTION = 'log_export_jobs';
const LOG_EXPORT_TMP_DIR = path.join(os.tmpdir(), 'integration-control-plane-log-exports');
const LOG_EXPORT_ASYNC_THRESHOLD = Math.max(1, Number.parseInt(process.env.LOG_EXPORT_ASYNC_THRESHOLD || '5000', 10));
const LOG_EXPORT_JOB_TTL_MS = Math.max(
  5 * 60 * 1000,
  Number.parseInt(process.env.LOG_EXPORT_JOB_TTL_MS || String(6 * 60 * 60 * 1000), 10)
);
const LOG_EXPORT_PROGRESS_UPDATE_INTERVAL = 100;
let exportIndexesEnsured = false;

const EXPORT_CSV_HEADERS = [
  'Log ID',
  'Timestamp',
  'Integration Name',
  'Event Type',
  'Flow',
  'Status',
  'HTTP Status',
  'Response Time (ms)',
  'Attempt Count',
  'Target URL',
  'HTTP Method',
  'cURL Command',
  'Request Payload (JSON)',
  'Response Body',
  'Error Message',
];

const parseBooleanQuery = (value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return false;
  return ['1', 'true', 'yes', 'y'].includes(value.trim().toLowerCase());
};

const buildExportFiltersFromReq = (req) => ({
  status: req.query.status,
  __KEEP___KEEP_integrationConfig__Id__: req.query.integrationId || req.query.integrationId,
  eventType: req.query.eventType,
  direction: req.query.direction,
  triggerType: req.query.triggerType,
  search: req.query.search,
  startDate: req.query.startDate,
  endDate: req.query.endDate,
});

const getFlowLabel = (logEntry) =>
  logEntry.direction === 'OUTBOUND' && logEntry.triggerType === 'SCHEDULED'
    ? 'SCHEDULED'
    : logEntry.direction || 'OUTBOUND';

const resolveResponseBodyForExport = (logEntry) =>
  logEntry?.response?.body !== undefined ? logEntry.response.body : logEntry.responseBody;

const escapeCsvCell = (cell) => {
  if (cell == null) return '';
  const str = typeof cell === 'object' ? JSON.stringify(cell) : String(cell);
  const sanitized = str.replace(/\r\n/g, ' ').replace(/[\r\n]/g, ' ');
  if (sanitized.includes(',') || sanitized.includes('"')) {
    return `"${sanitized.replace(/"/g, '""')}"`;
  }
  return sanitized;
};

const generateExportCurlCommand = (integration, payload) => {
  if (!integration) return 'N/A';

  let curl = `curl -X ${integration.httpMethod} "${integration.targetUrl}"`;
  curl += ' -H "Content-Type: application/json"';

  if (integration.outgoingAuthType === 'API_KEY' && integration.outgoingAuthConfig) {
    const headerName = integration.outgoingAuthConfig.headerName || 'X-API-Key';
    const value = integration.outgoingAuthConfig.value || '[REDACTED]';
    curl += ` -H "${headerName}: ${value.substring(0, 8)}..."`;
  } else if (integration.outgoingAuthType === 'BEARER' && integration.outgoingAuthConfig) {
    curl += ` -H "Authorization: Bearer ${(integration.outgoingAuthConfig.value || '[REDACTED]').substring(0, 12)}..."`;
  } else if (integration.outgoingAuthType === 'BASIC' && integration.outgoingAuthConfig) {
    curl += ' -H "Authorization: Basic [REDACTED]"';
  }

  const payloadJson = JSON.stringify(payload || {});
  curl += ` -d '${payloadJson.substring(0, 200)}${payloadJson.length > 200 ? '...' : ''}'`;

  return curl;
};

const writeFileChunk = (stream, chunk) =>
  new Promise((resolve, reject) => {
    const onError = (err) => {
      cleanup();
      reject(err);
    };
    const onDrain = () => {
      cleanup();
      resolve();
    };
    const cleanup = () => {
      stream.off('error', onError);
      stream.off('drain', onDrain);
    };

    stream.once('error', onError);
    if (stream.write(chunk)) {
      cleanup();
      resolve();
    } else {
      stream.once('drain', onDrain);
    }
  });

const closeFileStream = (stream) =>
  new Promise((resolve, reject) => {
    stream.once('error', reject);
    stream.end(() => resolve());
  });

const ensureExportJobIndexes = async (db) => {
  if (exportIndexesEnsured) return;
  const collection = db.collection(LOG_EXPORT_JOBS_COLLECTION);
  try {
    await collection.createIndex({ jobId: 1 }, { unique: true });
    await collection.createIndex({ orgId: 1, createdAt: -1 });
    await collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  } catch (error) {
    log('warn', 'Failed to ensure export job indexes', { error: error.message });
  }
  exportIndexesEnsured = true;
};

const toExportJobResponse = (job) => ({
  jobId: job.jobId,
  status: job.status,
  format: job.format,
  totalRecords: job.totalRecords || 0,
  processedRecords: job.processedRecords || 0,
  fileSizeBytes: job.fileSizeBytes || 0,
  fileName: job.fileName || null,
  errorMessage: job.errorMessage || null,
  createdAt: job.createdAt,
  startedAt: job.startedAt || null,
  finishedAt: job.finishedAt || null,
  expiresAt: job.expiresAt || null,
  statusPath: `/api/v1/logs/export/jobs/${encodeURIComponent(job.jobId)}`,
  downloadPath: `/api/v1/logs/export/jobs/${encodeURIComponent(job.jobId)}/download`,
});

const createLogExportJob = async (orgId, format, filters, totalRecords = 0, selectedIds = null) => {
  const db = await mongodb.getDbSafe();
  await ensureExportJobIndexes(db);
  const now = new Date();
  const jobId = `exp_${Date.now()}_${randomUUID().replace(/-/g, '').slice(0, 8)}`;
  const fileName = `integration-delivery-logs-${now.toISOString().split('T')[0]}-${jobId}.${format}`;
  const doc = {
    jobId,
    orgId,
    format,
    filters,
    status: 'QUEUED',
    totalRecords: Number(totalRecords) || 0,
    processedRecords: 0,
    filePath: null,
    fileName,
    fileSizeBytes: 0,
    errorMessage: null,
    selectedIds: Array.isArray(selectedIds) && selectedIds.length ? selectedIds : null,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    finishedAt: null,
    expiresAt: new Date(now.getTime() + LOG_EXPORT_JOB_TTL_MS),
  };
  await db.collection(LOG_EXPORT_JOBS_COLLECTION).insertOne(doc);
  return doc;
};

const getLogExportJob = async (orgId, jobId) => {
  const db = await mongodb.getDbSafe();
  await ensureExportJobIndexes(db);
  return db.collection(LOG_EXPORT_JOBS_COLLECTION).findOne({ orgId, jobId });
};

const processLogExportJob = async (jobId) => {
  const db = await mongodb.getDbSafe();
  await ensureExportJobIndexes(db);
  const jobs = db.collection(LOG_EXPORT_JOBS_COLLECTION);

  const claimed = await jobs.findOneAndUpdate(
    { jobId, status: 'QUEUED' },
    { $set: { status: 'PROCESSING', startedAt: new Date(), updatedAt: new Date() } },
    { returnDocument: 'after' }
  );

  const job = claimed.value;
  if (!job) return;

  await fsp.mkdir(LOG_EXPORT_TMP_DIR, { recursive: true });
  const filePath = path.join(LOG_EXPORT_TMP_DIR, `${job.jobId}.${job.format}`);
  const stream = fs.createWriteStream(filePath, { encoding: 'utf8' });
  let processedRecords = 0;
  const integrationCache = new Map();
  const selectedIds = Array.isArray(job.selectedIds) ? job.selectedIds : null;

  try {
    if (job.format === 'csv') {
      await writeFileChunk(stream, `${EXPORT_CSV_HEADERS.map(escapeCsvCell).join(',')}\r\n`);
    } else {
      await writeFileChunk(stream, '[');
    }

    let isFirst = true;
    const exportLogEntry = async (logEntry) => {
      if (job.format === 'csv') {
        let integration = null;
        if (logEntry.__KEEP___KEEP_integrationConfig__Id__) {
          if (integrationCache.has(logEntry.__KEEP___KEEP_integrationConfig__Id__)) {
            integration = integrationCache.get(logEntry.__KEEP___KEEP_integrationConfig__Id__);
          } else {
            try {
              integration = await data.getIntegrationById(logEntry.__KEEP___KEEP_integrationConfig__Id__);
              if (integration) {
                integrationCache.set(logEntry.__KEEP___KEEP_integrationConfig__Id__, integration);
              }
            } catch (_err) {
              integration = null;
            }
          }
        }

        const row = [
          logEntry.id,
          logEntry.createdAt,
          logEntry.__KEEP_integrationName__,
          logEntry.eventType,
          getFlowLabel(logEntry),
          logEntry.status,
          logEntry.responseStatus ?? 'N/A',
          logEntry.responseTimeMs ?? 'N/A',
          logEntry.attemptCount ?? 0,
          integration?.targetUrl ?? 'N/A',
          integration?.httpMethod ?? 'N/A',
          generateExportCurlCommand(integration, logEntry.requestPayload),
          logEntry.requestPayload,
          resolveResponseBodyForExport(logEntry),
          logEntry.errorMessage ?? '',
        ];
        await writeFileChunk(stream, `${row.map(escapeCsvCell).join(',')}\r\n`);
      } else {
        const { tenantId, ...rest } = logEntry;
        const exportLog = {
          ...rest,
          flow: getFlowLabel(rest),
          responseBody: resolveResponseBodyForExport(logEntry),
        };
        const chunk = `${isFirst ? '' : ','}${JSON.stringify(exportLog)}`;
        isFirst = false;
        await writeFileChunk(stream, chunk);
      }

      processedRecords++;
      if (processedRecords % LOG_EXPORT_PROGRESS_UPDATE_INTERVAL === 0) {
        await jobs.updateOne(
          { jobId },
          { $set: { processedRecords, updatedAt: new Date() } }
        );
        await new Promise((resolve) => setImmediate(resolve));
      }
    };

    if (selectedIds && selectedIds.length > 0) {
      const logPromises = selectedIds.map((id) => data.getLogById(job.orgId, id));
      const logs = (await Promise.all(logPromises)).filter(Boolean);
      if (logs.length === 0) {
        throw new Error('No logs found for selected IDs');
      }
      for (const logEntry of logs) {
        await exportLogEntry(logEntry);
      }
    } else {
      await data.streamLogsForExport(
        job.orgId,
        job.filters || {},
        exportLogEntry,
        { includeFullResponseBody: true }
      );
    }

    if (job.format === 'json') {
      await writeFileChunk(stream, ']');
    }
    await closeFileStream(stream);
    const fileStat = await fsp.stat(filePath);

    await jobs.updateOne(
      { jobId },
      {
        $set: {
          status: 'COMPLETED',
          processedRecords,
          filePath,
          fileSizeBytes: fileStat.size,
          finishedAt: new Date(),
          updatedAt: new Date(),
          expiresAt: new Date(Date.now() + LOG_EXPORT_JOB_TTL_MS),
        },
      }
    );

    log('info', 'Log export job completed', {
      jobId,
      orgId: job.orgId,
      format: job.format,
      processedRecords,
      fileSizeBytes: fileStat.size,
    });
  } catch (error) {
    try {
      stream.destroy();
    } catch (_err) {
      // Ignore stream cleanup failures.
    }
    try {
      await fsp.rm(filePath, { force: true });
    } catch (_err) {
      // Ignore temporary file cleanup failures.
    }

    await jobs.updateOne(
      { jobId },
      {
        $set: {
          status: 'FAILED',
          processedRecords,
          errorMessage: error.message,
          finishedAt: new Date(),
          updatedAt: new Date(),
          expiresAt: new Date(Date.now() + LOG_EXPORT_JOB_TTL_MS),
        },
      }
    );

    log('error', 'Log export job failed', {
      jobId,
      orgId: job.orgId,
      format: job.format,
      error: error.message,
    });
  }
};

const startLogExportJob = async ({ orgId, format, filters, totalRecords, selectedIds }) => {
  const job = await createLogExportJob(orgId, format, filters, totalRecords, selectedIds);
  setImmediate(() => {
    processLogExportJob(job.jobId).catch((error) => {
      log('error', 'Unhandled async export job failure', { jobId: job.jobId, error: error.message });
    });
  });
  return job;
};

const writeWithBackpressure = (req, res, chunk, isAborted) => {
  if (isAborted()) {
    return Promise.resolve(false);
  }

  const ok = res.write(chunk);
  if (ok) {
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    const onDrain = () => cleanup(true);
    const onClose = () => cleanup(false);
    const cleanup = (canContinue) => {
      res.off('drain', onDrain);
      req.off('close', onClose);
      req.off('aborted', onClose);
      resolve(canContinue);
    };

    res.once('drain', onDrain);
    req.once('close', onClose);
    req.once('aborted', onClose);
  });
};

// Bulk operations - Must be defined BEFORE /:id routes to avoid parameter matching
router.post(
  '/bulk/retry',
  asyncHandler(async (req, res) => {
    const { ids } = req.body;

    // Validation
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({
        error: 'ids must be a non-empty array',
        code: 'VALIDATION_ERROR',
      });
    }

    if (ids.length > 100) {
      return res.status(400).json({
        error: 'Cannot retry more than 100 logs at once',
        code: 'VALIDATION_ERROR',
      });
    }

    const result = await data.bulkRetryLogs(req.orgId, ids);

    log('info', 'Bulk log retry', {
      orgId: req.orgId,
      idsCount: ids.length,
      retriedCount: result.retriedCount,
    });

    return res.json({
      message: `Successfully queued ${result.retriedCount} log(s) for retry`,
      retriedCount: result.retriedCount,
      failedIds: result.failedIds,
    });
  })
);

router.delete(
  '/bulk',
  asyncHandler(async (req, res) => {
    const { ids } = req.body;

    // Validation
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({
        error: 'ids must be a non-empty array',
        code: 'VALIDATION_ERROR',
      });
    }

    if (ids.length > 100) {
      return res.status(400).json({
        error: 'Cannot delete more than 100 logs at once',
        code: 'VALIDATION_ERROR',
      });
    }

    const result = await data.bulkDeleteLogs(req.orgId, ids);

    log('info', 'Bulk log delete', {
      orgId: req.orgId,
      idsCount: ids.length,
      deletedCount: result.deletedCount,
    });

    return res.json({
      message: `Successfully deleted ${result.deletedCount} log(s)`,
      deletedCount: result.deletedCount,
      failedIds: result.failedIds,
    });
  })
);

// Cleanup stuck RETRYING logs
router.post(
  '/cleanup/stuck-retrying',
  asyncHandler(async (req, res) => {
    const { hoursThreshold } = req.body;

    // Default to 4 hours if not specified
    const threshold = hoursThreshold && hoursThreshold > 0 ? hoursThreshold : 4;

    // Prevent unreasonably low thresholds
    if (threshold < 1) {
      return res.status(400).json({
        error: 'hoursThreshold must be at least 1 hour',
        code: 'VALIDATION_ERROR',
      });
    }

    const result = await data.cleanupStuckRetryingLogs(threshold);

    log('info', 'Cleaned up stuck RETRYING logs', {
      orgId: req.orgId,
      hoursThreshold: threshold,
      logsUpdated: result.logsUpdated,
    });

    return res.json({
      success: true,
      message: `Successfully marked ${result.logsUpdated} stuck log(s) as ABANDONED`,
      logsUpdated: result.logsUpdated,
      hoursThreshold: result.hoursThreshold,
    });
  })
);

router.get(
  '/stats/summary',
  asyncHandler(async (req, res) => {
    // Use dedicated aggregation function for unbounded stats calculation
    // This does NOT use listLogs() to avoid the 500-row cap
    const filters = {
      __KEEP___KEEP_integrationConfig__Id__: req.query.integrationId || req.query.integrationId,
      eventType: req.query.eventType,
      direction: req.query.direction,
      triggerType: req.query.triggerType,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
    };

    const stats = await data.getLogStatsSummary(req.orgId, filters);
    res.json(stats);
  })
);

router.post(
  '/:id/replay',
  asyncHandler(async (req, res) => {
    try {
      const logEntry = await data.getLogById(req.orgId, req.params.id);
      if (!logEntry) {
        return res.status(404).json({ error: 'Log not found', code: 'NOT_FOUND' });
      }

      if (logEntry.status !== 'FAILED') {
        return res.status(400).json({
          error: 'Can only replay failed deliveries',
          code: 'INVALID_REPLAY',
        });
      }

      // Get integration configuration
      const integration = await data.getIntegrationById(logEntry.__KEEP___KEEP_integrationConfig__Id__);
      if (!integration || !integration.isActive) {
        return res.status(400).json({
          error: 'Integration configuration not found or inactive',
          code: 'WEBHOOK_INACTIVE',
        });
      }

      // Create replay event with marker
      const replayData = {
        id: logEntry.id,
        event_type: logEntry.eventType,
        entity_rid: req.orgId,
        payload: logEntry.requestPayload,
        replayed: true,
        original_log_id: req.params.id,
        replay_reason: req.body.reason || 'Manual replay by user',
      };

      // Process replay using existing delivery logic
      const { replayEvent } = require('../processor/retry-handler');
      const forceReplay = Boolean(req.body?.force);
      await replayEvent(req.params.id, req.orgId, { ...req.body, force: forceReplay });

      log('info', 'Event replayed', {
        originalLogId: req.params.id,
        __KEEP___KEEP_integrationConfig__Id__: logEntry.__KEEP___KEEP_integrationConfig__Id__,
        eventType: logEntry.eventType,
        reason: req.body.reason || 'Manual replay',
        force: forceReplay,
      });

      res.json({
        message: 'Event replay initiated',
        replayId: replayData.id,
        status: 'queued',
      });
    } catch (error) {
      log('error', 'Replay failed', { error: error.message, scope: 'replay-event' });
      res.status(500).json({
        error: 'Replay failed',
        code: 'INTERNAL_ERROR',
      });
    }
  })
);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const filters = {
      status: req.query.status,
      __KEEP___KEEP_integrationConfig__Id__: req.query.integrationId || req.query.integrationId,
      eventType: req.query.eventType,
      direction: req.query.direction,
      triggerType: req.query.triggerType,
      search: req.query.search,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      page: req.query.page,
      limit: req.query.limit,
    };

    // Fetch logs and total count in parallel for pagination
    const [logs, total] = await Promise.all([data.listLogs(req.orgId, filters), data.countLogs(req.orgId, filters)]);

    // Calculate pagination metadata
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(1000, Math.max(1, parseInt(req.query.limit, 10) || 500));
    const totalPages = Math.ceil(total / limit);

    res.json({
      data: logs,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
    });
  })
);

router.get(
  '/export',
  asyncHandler(async (req, res) => {
    let aborted = false;

    try {
      const filters = buildExportFiltersFromReq(req);
      const totalRecords = await data.countLogs(req.orgId, filters);
      const useAsyncExport = parseBooleanQuery(req.query.async) || totalRecords >= LOG_EXPORT_ASYNC_THRESHOLD;
      if (useAsyncExport) {
        const job = await startLogExportJob({
          orgId: req.orgId,
          format: 'csv',
          filters,
          totalRecords,
        });
        return res.status(202).json({
          ...toExportJobResponse(job),
          message: `Large export queued (${totalRecords.toLocaleString()} logs).`,
        });
      }

      const markAborted = () => {
        aborted = true;
      };
      req.on('close', markAborted);
      req.on('aborted', markAborted);

      const isAborted = () => aborted;

      // Set headers for streaming CSV download
      const filename = `integration-delivery-logs-${new Date().toISOString().split('T')[0]}.csv`;
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Transfer-Encoding', 'chunked');

      // Write CSV header row — use \r\n (RFC 4180) so Excel treats it as a row boundary
      const headerWritten = await writeWithBackpressure(
        req,
        res,
        `${EXPORT_CSV_HEADERS.map(escapeCsvCell).join(',')}\r\n`,
        isAborted
      );
      if (!headerWritten) {
        return;
      }

      // Cache for integration configs to avoid duplicate fetches
      const integrationCache = new Map();

      let exportCount = 0;

      // Stream logs using cursor-based iteration
      await data.streamLogsForExport(
        req.orgId,
        filters,
        async (logEntry) => {
          if (isAborted()) {
            return;
          }

          // Fetch integration config if not cached
          let integration = null;
          if (logEntry.__KEEP___KEEP_integrationConfig__Id__) {
            if (integrationCache.has(logEntry.__KEEP___KEEP_integrationConfig__Id__)) {
              integration = integrationCache.get(logEntry.__KEEP___KEEP_integrationConfig__Id__);
            } else {
              try {
                integration = await data.getIntegrationById(logEntry.__KEEP___KEEP_integrationConfig__Id__);
                if (integration) {
                  integrationCache.set(logEntry.__KEEP___KEEP_integrationConfig__Id__, integration);
                }
              } catch (_err) {
                // Integration might be deleted, use null
              }
            }
          }

          // Build CSV row
          const responseBodyForExport = resolveResponseBodyForExport(logEntry);
          const flowLabel = getFlowLabel(logEntry);
          const row = [
            logEntry.id,
            logEntry.createdAt,
            logEntry.__KEEP_integrationName__,
            logEntry.eventType,
            flowLabel,
            logEntry.status,
            logEntry.responseStatus ?? 'N/A',
            logEntry.responseTimeMs ?? 'N/A',
            logEntry.attemptCount ?? 0,
            integration?.targetUrl ?? 'N/A',
            integration?.httpMethod ?? 'N/A',
            generateExportCurlCommand(integration, logEntry.requestPayload),
            logEntry.requestPayload,   // escapeCsvCell serializes objects
            responseBodyForExport,     // Full response.body exported by default
            logEntry.errorMessage ?? '',
          ];

          // Write row to stream with backpressure handling
          const canContinue = await writeWithBackpressure(req, res, `${row.map(escapeCsvCell).join(',')}\r\n`, isAborted);
          if (!canContinue) return;

          exportCount++;

          // Yield control to event loop every 100 rows for better performance
          if (exportCount % 100 === 0) {
            await new Promise((resolve) => setImmediate(resolve));
          }
        },
        { shouldStop: isAborted, includeFullResponseBody: true }
      );

      // End the stream
      if (!isAborted()) {
        res.end();

        log('info', 'CSV export completed', {
          orgId: req.orgId,
          exportCount,
          filters,
        });
      } else {
        log('warn', 'CSV export aborted by client', {
          orgId: req.orgId,
          filters,
        });
      }
    } catch (error) {
      log('error', 'CSV export failed', { error: error.message, aborted });
      // If headers not sent yet, send error response
      if (!res.headersSent) {
        res.status(500).json({ error: 'Export failed', code: 'INTERNAL_ERROR' });
      } else if (!aborted) {
        // If streaming already started but not aborted, end the stream
        res.end();
      }
    }
  })
);

// Export selected logs by IDs (POST for bulk IDs)
router.post(
  '/export/selected',
  asyncHandler(async (req, res) => {
    try {
      const { ids, format = 'json' } = req.body;
      const useAsyncExport = parseBooleanQuery(req.query.async);

      // Validation
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({
          error: 'ids must be a non-empty array',
          code: 'VALIDATION_ERROR',
        });
      }

      if (ids.length > 1000) {
        return res.status(400).json({
          error: 'Cannot export more than 1000 logs at once',
          code: 'VALIDATION_ERROR',
        });
      }

      if (useAsyncExport) {
        const job = await startLogExportJob({
          orgId: req.orgId,
          format,
          filters: {},
          totalRecords: ids.length,
          selectedIds: ids,
        });
        return res.status(202).json({
          ...toExportJobResponse(job),
          message: `Selected export queued (${ids.length.toLocaleString()} logs).`,
        });
      }

      // Fetch logs by IDs
      const logPromises = ids.map((id) => data.getLogById(req.orgId, id));
      const logs = (await Promise.all(logPromises)).filter(Boolean); // Remove nulls

      if (logs.length === 0) {
        return res.status(404).json({
          error: 'No logs found for the provided IDs',
          code: 'NOT_FOUND',
        });
      }

      // Fetch integration configs to enrich log data
      const integrationCache = new Map();
      for (const logEntry of logs) {
        if (
          logEntry.__KEEP___KEEP_integrationConfig__Id__ &&
          !integrationCache.has(logEntry.__KEEP___KEEP_integrationConfig__Id__)
        ) {
          try {
            const integration = await data.getIntegrationById(logEntry.__KEEP___KEEP_integrationConfig__Id__);
            if (integration) {
              integrationCache.set(logEntry.__KEEP___KEEP_integrationConfig__Id__, integration);
            }
          } catch (_err) {
            // Integration might be deleted
          }
        }
      }

      if (format === 'csv') {
        // CSV export
        const headers = [
          'Log ID',
          'Timestamp',
          'Integration Name',
          'Event Type',
          'Flow',
          'Status',
          'HTTP Status',
          'Response Time (ms)',
          'Attempt Count',
          'Target URL',
          'HTTP Method',
          'Request Payload (JSON)',
          'Response Body',
          'Error Message',
        ];

        const escapeCsvCell = (cell) => {
          if (cell == null) return '';
          const str = typeof cell === 'object' ? JSON.stringify(cell) : String(cell);
          const sanitized = str.replace(/\r\n/g, ' ').replace(/[\r\n]/g, ' ');
          if (sanitized.includes(',') || sanitized.includes('"')) {
            return `"${sanitized.replace(/"/g, '""')}"`;
          }
          return sanitized;
        };

        const csvRows = logs.map((logEntry) => {
          const integration = integrationCache.get(logEntry.__KEEP___KEEP_integrationConfig__Id__);
          const flowLabel = getFlowLabel(logEntry);
          const responseBodyForExport = resolveResponseBodyForExport(logEntry);
          return [
            logEntry.id,
            logEntry.createdAt,
            logEntry.__KEEP_integrationName__,
            logEntry.eventType,
            flowLabel,
            logEntry.status,
            logEntry.responseStatus ?? 'N/A',
            logEntry.responseTimeMs ?? 'N/A',
            logEntry.attemptCount ?? 0,
            integration?.targetUrl ?? 'N/A',
            integration?.httpMethod ?? 'N/A',
            logEntry.requestPayload,
            responseBodyForExport,
            logEntry.errorMessage ?? '',
          ];
        });

        const csvContent = [
          headers.map(escapeCsvCell).join(','),
          ...csvRows.map((row) => row.map(escapeCsvCell).join(',')),
        ].join('\r\n');

        const filename = `integration-logs-selected-${logs.length}-${new Date().toISOString().split('T')[0]}.csv`;
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(csvContent);
      } else {
        // JSON export
        const cleanLogs = logs.map(({ tenantId, ...rest }) => {
          const flow = getFlowLabel(rest);
          return { ...rest, responseBody: resolveResponseBodyForExport(rest), flow };
        });
        const filename = `integration-logs-selected-${logs.length}-${new Date().toISOString().split('T')[0]}.json`;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.json(cleanLogs);
      }

      log('info', 'Selected logs exported', {
        orgId: req.orgId,
        count: logs.length,
        format,
      });
    } catch (error) {
      log('error', 'Selected export failed', { error: error.message });
      res.status(500).json({ error: 'Export failed', code: 'INTERNAL_ERROR' });
    }
  })
);

router.get(
  '/export/json',
  asyncHandler(async (req, res) => {
    try {
      const filters = buildExportFiltersFromReq(req);
      const totalRecords = await data.countLogs(req.orgId, filters);
      const useAsyncExport = parseBooleanQuery(req.query.async) || totalRecords >= LOG_EXPORT_ASYNC_THRESHOLD;
      if (useAsyncExport) {
        const job = await startLogExportJob({
          orgId: req.orgId,
          format: 'json',
          filters,
          totalRecords,
        });
        return res.status(202).json({
          ...toExportJobResponse(job),
          message: `Large export queued (${totalRecords.toLocaleString()} logs).`,
        });
      }

      let aborted = false;
      const markAborted = () => {
        aborted = true;
      };
      req.on('close', markAborted);
      req.on('aborted', markAborted);

      const isAborted = () => aborted;

      // Set headers for JSON file download
      const filename = `integration-delivery-logs-${new Date().toISOString().split('T')[0]}.json`;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

      const opened = await writeWithBackpressure(req, res, '[', isAborted);
      if (!opened) {
        return;
      }

      let isFirst = true;
      await data.streamLogsForExport(
        req.orgId,
        filters,
        async (logEntry) => {
          if (isAborted()) {
            return;
          }

          const { tenantId, ...rest } = logEntry;
          const flow =
            rest.direction === 'OUTBOUND' && rest.triggerType === 'SCHEDULED'
              ? 'SCHEDULED'
              : rest.direction || 'OUTBOUND';
          const chunk = (isFirst ? '' : ',') + JSON.stringify({ ...rest, flow });
          isFirst = false;

          const wrote = await writeWithBackpressure(req, res, chunk, isAborted);
          if (!wrote) {
            return;
          }
        },
        { shouldStop: isAborted, includeFullResponseBody: true }
      );

      if (!isAborted()) {
        await writeWithBackpressure(req, res, ']', isAborted);
        res.end();
      }
    } catch (error) {
      log('error', 'JSON export failed', { error: error.message });
      if (res.writableEnded || res.destroyed) {
        return;
      }
      if (res.headersSent) {
        try {
          res.end();
        } catch (_err) {
          // Response might already be closed; ignore.
        }
        return;
      }
      return res.status(500).json({ error: 'Export failed', code: 'INTERNAL_ERROR' });
    }
  })
);

router.get(
  '/export/jobs/:jobId',
  asyncHandler(async (req, res) => {
    const job = await getLogExportJob(req.orgId, req.params.jobId);
    if (!job) {
      return res.status(404).json({ error: 'Export job not found', code: 'NOT_FOUND' });
    }
    return res.json(toExportJobResponse(job));
  })
);

router.get(
  '/export/jobs/:jobId/download',
  asyncHandler(async (req, res) => {
    const job = await getLogExportJob(req.orgId, req.params.jobId);
    if (!job) {
      return res.status(404).json({ error: 'Export job not found', code: 'NOT_FOUND' });
    }
    if (job.status !== 'COMPLETED') {
      return res.status(409).json({
        error: 'Export job is not ready for download',
        code: 'EXPORT_NOT_READY',
        status: job.status,
      });
    }
    if (!job.filePath) {
      return res.status(500).json({
        error: 'Export file path missing',
        code: 'EXPORT_FILE_MISSING',
      });
    }

    try {
      await fsp.access(job.filePath, fs.constants.R_OK);
    } catch (_err) {
      return res.status(410).json({
        error: 'Export file no longer available',
        code: 'EXPORT_FILE_EXPIRED',
      });
    }

    const contentType = job.format === 'csv' ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${job.fileName || path.basename(job.filePath)}"`);

    return new Promise((resolve, reject) => {
      const stream = fs.createReadStream(job.filePath);
      const onClose = () => {
        cleanup();
        resolve();
      };
      const onEnd = () => {
        cleanup();
        resolve();
      };
      const onError = (err) => {
        cleanup();
        if (res.headersSent) {
          resolve();
          return;
        }
        reject(err);
      };
      const cleanup = () => {
        stream.off('error', onError);
        stream.off('end', onEnd);
        res.off('close', onClose);
      };

      stream.on('error', onError);
      stream.on('end', onEnd);
      res.on('close', onClose);
      stream.pipe(res);
    });
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const logEntry = await data.getLogById(req.orgId, req.params.id);
    if (!logEntry) {
      return res.status(404).json({ error: 'Log not found', code: 'NOT_FOUND' });
    }

    // Include integration configuration details for enhanced UI
    let __KEEP_integrationConfig__ = null;
    if (logEntry.__KEEP___KEEP_integrationConfig__Id__) {
      try {
        __KEEP_integrationConfig__ = await data.getIntegrationById(logEntry.__KEEP___KEEP_integrationConfig__Id__);
        // Remove sensitive information from auth config
        if (__KEEP_integrationConfig__?.outgoingAuthConfig) {
          const sanitizedAuth = { ...__KEEP_integrationConfig__.outgoingAuthConfig };
          if (sanitizedAuth.value) {
            sanitizedAuth.value = `${sanitizedAuth.value.substring(0, 8)}...`;
          }
          __KEEP_integrationConfig__.outgoingAuthConfig = sanitizedAuth;
        }
      } catch (_err) {
        // Integration might be deleted, ignore error
      }
    }

    return res.json({
      ...logEntry,
      __KEEP_integrationConfig__,
    });
  })
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const payload = req.body;
    if (!payload.__KEEP___KEEP_integrationConfig__Id__) {
      return res
        .status(400)
        .json({ error: '__KEEP___KEEP_integrationConfig__Id__ is required', code: 'VALIDATION_ERROR' });
    }
    await data.recordLog(req.orgId, payload);
    log('info', 'Log recorded', {
      __KEEP___KEEP_integrationConfig__Id__: payload.__KEEP___KEEP_integrationConfig__Id__,
    });
    return res.status(201).json({ message: 'Logged' });
  })
);

module.exports = router;
