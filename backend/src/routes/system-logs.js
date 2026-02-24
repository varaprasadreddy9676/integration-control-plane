const express = require('express');
const fs = require('fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('path');
const readline = require('readline');
const { randomUUID } = require('node:crypto');
const { log } = require('../logger');
const mongodb = require('../mongodb');

const router = express.Router();
const SYSTEM_LOG_EXPORT_JOBS_COLLECTION = 'system_log_export_jobs';
const SYSTEM_LOG_EXPORT_TMP_DIR = path.join(os.tmpdir(), 'integration-control-plane-system-log-exports');
const SYSTEM_LOG_EXPORT_ASYNC_THRESHOLD = Math.max(
  1,
  Number.parseInt(process.env.SYSTEM_LOG_EXPORT_ASYNC_THRESHOLD || '5000', 10)
);
const SYSTEM_LOG_EXPORT_JOB_TTL_MS = Math.max(
  5 * 60 * 1000,
  Number.parseInt(process.env.SYSTEM_LOG_EXPORT_JOB_TTL_MS || String(6 * 60 * 60 * 1000), 10)
);
let exportIndexesEnsured = false;

const parseBooleanQuery = (value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return false;
  return ['1', 'true', 'yes', 'y'].includes(value.trim().toLowerCase());
};

const ensureExportJobIndexes = async (db) => {
  if (exportIndexesEnsured) return;
  const collection = db.collection(SYSTEM_LOG_EXPORT_JOBS_COLLECTION);
  try {
    await collection.createIndex({ jobId: 1 }, { unique: true });
    await collection.createIndex({ createdAt: -1 });
    await collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  } catch (error) {
    log('warn', 'Failed to ensure system-log export indexes', { error: error.message });
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
  statusPath: `/api/v1/system-logs/export/jobs/${encodeURIComponent(job.jobId)}`,
  downloadPath: `/api/v1/system-logs/export/jobs/${encodeURIComponent(job.jobId)}/download`,
});

const createExportJob = async (format, filters, totalRecords = 0) => {
  const db = await mongodb.getDbSafe();
  await ensureExportJobIndexes(db);
  const now = new Date();
  const jobId = `slexp_${Date.now()}_${randomUUID().replace(/-/g, '').slice(0, 8)}`;
  const fileName = `system-logs-${now.toISOString().split('T')[0]}-${jobId}.${format}`;
  const doc = {
    jobId,
    format,
    filters,
    status: 'QUEUED',
    totalRecords: Number(totalRecords) || 0,
    processedRecords: 0,
    filePath: null,
    fileName,
    fileSizeBytes: 0,
    errorMessage: null,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    finishedAt: null,
    expiresAt: new Date(now.getTime() + SYSTEM_LOG_EXPORT_JOB_TTL_MS),
  };
  await db.collection(SYSTEM_LOG_EXPORT_JOBS_COLLECTION).insertOne(doc);
  return doc;
};

const getExportJob = async (jobId) => {
  const db = await mongodb.getDbSafe();
  await ensureExportJobIndexes(db);
  return db.collection(SYSTEM_LOG_EXPORT_JOBS_COLLECTION).findOne({ jobId });
};

const readSystemLogs = async (filters) => {
  const limit = Math.min(parseInt(filters.limit, 10) || 5000, 50000);
  const level = filters.level;
  const search = filters.search;
  const errorCategory = filters.errorCategory;
  const logFile = path.join(__dirname, '..', '..', 'logs', 'app.log');

  if (!fs.existsSync(logFile)) {
    return [];
  }

  const logs = [];
  const now = Date.now();
  const oneDayAgo = now - 24 * 60 * 60 * 1000;

  const fileStream = fs.createReadStream(logFile);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  const allLines = [];
  for await (const line of rl) {
    if (line.trim()) allLines.push(line);
  }

  for (let i = allLines.length - 1; i >= 0 && logs.length < limit; i--) {
    const line = allLines[i];
    try {
      const logEntry = JSON.parse(line);
      const logTime = new Date(logEntry.timestamp).getTime();

      if (logTime < oneDayAgo) continue;
      if (level && logEntry.level !== level) continue;
      if (search && !logEntry.message.toLowerCase().includes(search.toLowerCase())) continue;

      logEntry.errorCategory = categorizeError(logEntry.message, logEntry.level, logEntry.meta);
      if (errorCategory && logEntry.errorCategory !== errorCategory) continue;

      logs.push(logEntry);
    } catch (_err) {}
  }

  return logs;
};

const processExportJob = async (jobId) => {
  const db = await mongodb.getDbSafe();
  await ensureExportJobIndexes(db);
  const jobs = db.collection(SYSTEM_LOG_EXPORT_JOBS_COLLECTION);

  const claimed = await jobs.findOneAndUpdate(
    { jobId, status: 'QUEUED' },
    { $set: { status: 'PROCESSING', startedAt: new Date(), updatedAt: new Date() } },
    { returnDocument: 'after' }
  );
  const job = claimed.value;
  if (!job) return;

  await fsp.mkdir(SYSTEM_LOG_EXPORT_TMP_DIR, { recursive: true });
  const filePath = path.join(SYSTEM_LOG_EXPORT_TMP_DIR, `${job.jobId}.${job.format}`);

  try {
    const logs = await readSystemLogs(job.filters || {});
    if (job.format === 'json') {
      await fsp.writeFile(filePath, JSON.stringify(logs), 'utf8');
    } else {
      const headers = ['Timestamp', 'Level', 'Message', 'Error Category', 'Metadata'];
      const rows = logs.map((log) => [
        log.timestamp,
        log.level,
        log.message || '',
        log.errorCategory || '',
        log.meta ? JSON.stringify(log.meta) : '',
      ]);
      const csvContent = [
        headers.join(','),
        ...rows.map((row) =>
          row
            .map((cell) => {
              const str = String(cell);
              if (str.includes(',') || str.includes('\n') || str.includes('"')) {
                return `"${str.replace(/"/g, '""')}"`;
              }
              return str;
            })
            .join(',')
        ),
      ].join('\n');
      await fsp.writeFile(filePath, csvContent, 'utf8');
    }
    const stat = await fsp.stat(filePath);
    await jobs.updateOne(
      { jobId },
      {
        $set: {
          status: 'COMPLETED',
          processedRecords: logs.length,
          filePath,
          fileSizeBytes: stat.size,
          finishedAt: new Date(),
          updatedAt: new Date(),
          expiresAt: new Date(Date.now() + SYSTEM_LOG_EXPORT_JOB_TTL_MS),
        },
      }
    );
  } catch (error) {
    try {
      await fsp.rm(filePath, { force: true });
    } catch (_err) {}
    await jobs.updateOne(
      { jobId },
      {
        $set: {
          status: 'FAILED',
          processedRecords: 0,
          errorMessage: error.message,
          finishedAt: new Date(),
          updatedAt: new Date(),
          expiresAt: new Date(Date.now() + SYSTEM_LOG_EXPORT_JOB_TTL_MS),
        },
      }
    );
  }
};

const startExportJob = async (format, filters, totalRecords) => {
  const job = await createExportJob(format, filters, totalRecords);
  setImmediate(() => {
    processExportJob(job.jobId).catch((error) => {
      log('error', 'Unhandled system-log export job failure', { jobId: job.jobId, error: error.message });
    });
  });
  return job;
};

// Helper: Extract poll ID from message
const extractPollId = (message) => {
  if (!message) return null;
  const match = message.match(/\[POLL\s*#(\d+)\]/i);
  return match ? match[1] : null;
};

// Helper: Categorize error type
const categorizeError = (message, level, meta) => {
  if (level !== 'error') return null;
  if (!message) return 'unknown';

  // PRIORITY 1: Use explicit category from meta if it exists (from frontend error logger or other sources)
  if (meta?.category) {
    // Frontend sends: ui_error, api_error, validation_error, business_logic, unhandled, unknown
    // Use these directly - they are more accurate than inference
    return meta.category;
  }

  // PRIORITY 2: Infer category from message patterns (fallback for logs without explicit category)
  const msg = message.toLowerCase();

  // Browser/UI errors (from frontend source marker)
  if (meta?.source === 'browser') {
    return 'browser_error';
  }

  // HTTP 4xx client errors
  if (
    msg.includes('400') ||
    msg.includes('401') ||
    msg.includes('403') ||
    msg.includes('404') ||
    msg.includes('bad request')
  ) {
    return 'http_4xx';
  }

  // HTTP 5xx server errors
  if (
    msg.includes('500') ||
    msg.includes('502') ||
    msg.includes('503') ||
    msg.includes('504') ||
    msg.includes('server error')
  ) {
    return 'http_5xx';
  }

  // Network/Connection errors
  if (
    msg.includes('timeout') ||
    msg.includes('connection') ||
    msg.includes('econnrefused') ||
    msg.includes('network')
  ) {
    return 'network';
  }

  // Transform errors
  if (msg.includes('transform failed') || msg.includes('transformation')) {
    return 'transform';
  }

  // Rate limiting
  if (msg.includes('rate limit') || msg.includes('429')) {
    return 'ratelimit';
  }

  // Database errors
  if (
    msg.includes('mongodb') ||
    msg.includes('mysql') ||
    msg.includes('database') ||
    msg.includes('query') ||
    msg.includes('sequelize')
  ) {
    return 'database';
  }

  // Validation errors
  if (msg.includes('validation') || msg.includes('invalid') || msg.includes('required field')) {
    return 'validation_error';
  }

  return 'other';
};

// Helper: Group logs by poll ID
const groupLogsByPoll = (logs) => {
  const groups = {};

  logs.forEach((log) => {
    const pollId = extractPollId(log.message) || 'NO_POLL';

    if (!groups[pollId]) {
      groups[pollId] = {
        pollId,
        logs: [],
        firstTimestamp: log.timestamp,
        lastTimestamp: log.timestamp,
        hasError: false,
        hasWarn: false,
        levels: { error: 0, warn: 0, info: 0, debug: 0 },
        eventsProcessed: 0,
        retriesProcessed: 0,
        totalDurationMs: 0,
      };
    }

    const group = groups[pollId];
    group.logs.push(log);

    // Update timestamps
    if (log.timestamp < group.firstTimestamp) {
      group.firstTimestamp = log.timestamp;
    }
    if (log.timestamp > group.lastTimestamp) {
      group.lastTimestamp = log.timestamp;
    }

    // Update flags
    if (log.level === 'error') group.hasError = true;
    if (log.level === 'warn') group.hasWarn = true;

    // Count levels
    if (group.levels[log.level] !== undefined) {
      group.levels[log.level]++;
    }

    // Extract metadata
    if (log.meta) {
      if (typeof log.meta.eventsProcessed === 'number') {
        group.eventsProcessed = Math.max(group.eventsProcessed, log.meta.eventsProcessed);
      }
      if (typeof log.meta.retriesProcessed === 'number') {
        group.retriesProcessed = Math.max(group.retriesProcessed, log.meta.retriesProcessed);
      }
      if (typeof log.meta.durationMs === 'number') {
        group.totalDurationMs += log.meta.durationMs;
      }
    }
  });

  // Calculate poll durations and sort logs
  Object.values(groups).forEach((group) => {
    const startTime = new Date(group.firstTimestamp).getTime();
    const endTime = new Date(group.lastTimestamp).getTime();
    group.pollDurationMs = endTime - startTime;

    // Sort logs chronologically
    group.logs.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  });

  return Object.values(groups).sort(
    (a, b) => new Date(b.lastTimestamp).getTime() - new Date(a.lastTimestamp).getTime()
  );
};

// Get system logs (last 24 hours)
router.get('/', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 1000, 10000); // Increased to 10000 for high-volume systems
  const level = req.query.level; // Filter by level: info, error, debug, warn
  const search = req.query.search; // Search in message
  const pollId = req.query.pollId; // Filter by specific poll ID
  const errorCategory = req.query.errorCategory; // Filter by error category
  const grouped = req.query.grouped === 'true'; // Return grouped by poll cycles

  const logFile = path.join(__dirname, '..', '..', 'logs', 'app.log');

  if (!fs.existsSync(logFile)) {
    return res.json({
      logs: [],
      total: 0,
      pollGroups: [],
      stats: { total: 0, error: 0, warn: 0, info: 0, debug: 0 },
      pollStats: { total: 0, withErrors: 0, withWarnings: 0, healthy: 0 },
    });
  }

  const logs = [];
  const now = Date.now();
  const oneDayAgo = now - 24 * 60 * 60 * 1000;

  try {
    // Read file line by line from the end (most recent first)
    const fileStream = fs.createReadStream(logFile);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });

    const allLines = [];
    const allLogsForStats = []; // For calculating accurate statistics
    for await (const line of rl) {
      if (line.trim()) {
        allLines.push(line);
      }
    }

    // First pass: collect ALL logs within 24 hours for accurate statistics
    for (let i = allLines.length - 1; i >= 0; i--) {
      const line = allLines[i];
      try {
        const logEntry = JSON.parse(line);
        const logTime = new Date(logEntry.timestamp).getTime();

        // Skip logs older than 24 hours
        if (logTime < oneDayAgo) continue;

        // Add error category
        logEntry.errorCategory = categorizeError(logEntry.message, logEntry.level, logEntry.meta);

        // Add to stats array (no filters applied for accurate counts)
        allLogsForStats.push(logEntry);
      } catch (_err) {}
    }

    // Second pass: apply filters and limit for display
    for (let i = allLines.length - 1; i >= 0 && logs.length < limit; i--) {
      const line = allLines[i];
      try {
        const logEntry = JSON.parse(line);
        const logTime = new Date(logEntry.timestamp).getTime();

        // Skip logs older than 24 hours
        if (logTime < oneDayAgo) continue;

        // Filter by level if specified
        if (level && logEntry.level !== level) continue;

        // Filter by search term if specified
        if (search && !logEntry.message.toLowerCase().includes(search.toLowerCase())) {
          continue;
        }

        // Filter by poll ID if specified
        if (pollId) {
          const logPollId = extractPollId(logEntry.message);
          if (pollId === 'NO_POLL' && logPollId !== null) continue;
          if (pollId !== 'NO_POLL' && logPollId !== pollId) continue;
        }

        // Add error category
        logEntry.errorCategory = categorizeError(logEntry.message, logEntry.level, logEntry.meta);

        // Filter by error category if specified
        if (errorCategory && logEntry.errorCategory !== errorCategory) continue;

        logs.push(logEntry);
      } catch (_err) {}
    }

    // Calculate statistics from ALL logs (not just filtered/limited display logs)
    const errorLogsAll = allLogsForStats.filter((l) => l.level === 'error');
    const stats = {
      total: allLogsForStats.length,
      error: errorLogsAll.length,
      warn: allLogsForStats.filter((l) => l.level === 'warn').length,
      info: allLogsForStats.filter((l) => l.level === 'info').length,
      debug: allLogsForStats.filter((l) => l.level === 'debug').length,
      errorCategories: {
        // Frontend-sent categories (explicit)
        ui_error: errorLogsAll.filter((l) => l.errorCategory === 'ui_error').length,
        api_error: errorLogsAll.filter((l) => l.errorCategory === 'api_error').length,
        validation_error: errorLogsAll.filter((l) => l.errorCategory === 'validation_error').length,
        business_logic: errorLogsAll.filter((l) => l.errorCategory === 'business_logic').length,
        unhandled: errorLogsAll.filter((l) => l.errorCategory === 'unhandled').length,

        // Inferred categories (fallback)
        browser_error: errorLogsAll.filter((l) => l.errorCategory === 'browser_error').length,
        http_4xx: errorLogsAll.filter((l) => l.errorCategory === 'http_4xx').length,
        http_5xx: errorLogsAll.filter((l) => l.errorCategory === 'http_5xx').length,
        network: errorLogsAll.filter((l) => l.errorCategory === 'network').length,
        transform: errorLogsAll.filter((l) => l.errorCategory === 'transform').length,
        ratelimit: errorLogsAll.filter((l) => l.errorCategory === 'ratelimit').length,
        database: errorLogsAll.filter((l) => l.errorCategory === 'database').length,

        // Catch-all
        other: errorLogsAll.filter((l) => l.errorCategory === 'other').length,
        unknown: errorLogsAll.filter((l) => l.errorCategory === 'unknown').length,
      },
    };

    // Group by poll cycles
    const pollGroups = groupLogsByPoll(logs);

    const pollStats = {
      total: pollGroups.length,
      withErrors: pollGroups.filter((g) => g.hasError).length,
      withWarnings: pollGroups.filter((g) => g.hasWarn && !g.hasError).length,
      healthy: pollGroups.filter((g) => !g.hasError && !g.hasWarn).length,
    };

    // Performance insights
    const pollPerformance = pollGroups
      .filter((g) => g.pollId !== 'NO_POLL')
      .slice(0, 10)
      .map((g) => ({
        pollId: g.pollId,
        durationMs: g.pollDurationMs,
        eventsProcessed: g.eventsProcessed,
        retriesProcessed: g.retriesProcessed,
        logCount: g.logs.length,
        hasError: g.hasError,
        hasWarn: g.hasWarn,
      }));

    const response = {
      logs,
      displayed: logs.length, // Number of logs returned (with filters & limit)
      totalInPeriod: allLogsForStats.length, // Total logs in 24h period (for accurate stats)
      limit,
      filters: { level, search, pollId, errorCategory },
      stats, // Stats calculated from ALL logs in period, not just displayed
      pollStats,
      pollPerformance,
    };

    // Optionally include full poll groups
    if (grouped) {
      response.pollGroups = pollGroups;
    }

    res.json(response);
  } catch (err) {
    res.status(500).json({
      error: 'Failed to read logs',
      message: err.message,
    });
  }
});

// Export system logs as JSON
router.get('/export/json', async (req, res) => {
  const filters = {
    limit: Math.min(parseInt(req.query.limit, 10) || 5000, 50000),
    level: req.query.level,
    search: req.query.search,
    errorCategory: req.query.errorCategory,
  };
  const useAsyncExport =
    parseBooleanQuery(req.query.async) || (filters.limit && filters.limit >= SYSTEM_LOG_EXPORT_ASYNC_THRESHOLD);
  if (useAsyncExport) {
    const job = await startExportJob('json', filters, filters.limit || 0);
    return res.status(202).json({
      ...toExportJobResponse(job),
      message: 'System log export queued.',
    });
  }

  try {
    const logs = await readSystemLogs(filters);
    const filename = `system-logs-${new Date().toISOString().split('T')[0]}.json`;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: 'Export failed', message: err.message });
  }
});

// Export system logs as CSV
router.get('/export/csv', async (req, res) => {
  const filters = {
    limit: Math.min(parseInt(req.query.limit, 10) || 5000, 50000),
    level: req.query.level,
    search: req.query.search,
    errorCategory: req.query.errorCategory,
  };
  const useAsyncExport =
    parseBooleanQuery(req.query.async) || (filters.limit && filters.limit >= SYSTEM_LOG_EXPORT_ASYNC_THRESHOLD);
  if (useAsyncExport) {
    const job = await startExportJob('csv', filters, filters.limit || 0);
    return res.status(202).json({
      ...toExportJobResponse(job),
      message: 'System log export queued.',
    });
  }

  try {
    const logs = await readSystemLogs(filters);
    const headers = ['Timestamp', 'Level', 'Message', 'Error Category', 'Metadata'];
    const rows = logs.map((log) => [
      log.timestamp,
      log.level,
      log.message || '',
      log.errorCategory || '',
      log.meta ? JSON.stringify(log.meta) : '',
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map((row) =>
        row
          .map((cell) => {
            const str = String(cell);
            if (str.includes(',') || str.includes('\n') || str.includes('"')) {
              return `"${str.replace(/"/g, '""')}"`;
            }
            return str;
          })
          .join(',')
      ),
    ].join('\n');

    const filename = `system-logs-${new Date().toISOString().split('T')[0]}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csvContent);
  } catch (err) {
    res.status(500).json({ error: 'Export failed', message: err.message });
  }
});

router.get('/export/jobs/:jobId', async (req, res) => {
  const job = await getExportJob(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: 'Export job not found', code: 'NOT_FOUND' });
  }
  return res.json(toExportJobResponse(job));
});

router.get('/export/jobs/:jobId/download', async (req, res) => {
  const job = await getExportJob(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: 'Export job not found', code: 'NOT_FOUND' });
  }
  if (job.status !== 'COMPLETED') {
    return res.status(409).json({ error: 'Export job is not ready', code: 'EXPORT_NOT_READY' });
  }
  if (!job.filePath) {
    return res.status(500).json({ error: 'Export file path missing', code: 'EXPORT_FILE_MISSING' });
  }

  try {
    await fsp.access(job.filePath, fs.constants.R_OK);
  } catch (_err) {
    return res.status(410).json({ error: 'Export file expired', code: 'EXPORT_FILE_EXPIRED' });
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
});

// Clear all system logs (truncate file)
router.delete('/clear', async (_req, res) => {
  const logFile = path.join(__dirname, '..', '..', 'logs', 'app.log');

  try {
    // Archive current logs before clearing
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const archiveFile = path.join(__dirname, '..', '..', 'logs', `app.log.${timestamp}.archive`);

    if (fs.existsSync(logFile)) {
      fs.copyFileSync(logFile, archiveFile);
      fs.truncateSync(logFile, 0);
    }

    res.json({
      message: 'System logs cleared successfully',
      archived: archiveFile,
    });
  } catch (err) {
    res.status(500).json({
      error: 'Failed to clear logs',
      message: err.message,
    });
  }
});

module.exports = router;
