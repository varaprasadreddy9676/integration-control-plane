const express = require('express');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const readline = require('readline');
const zlib = require('zlib');
const { randomUUID } = require('crypto');
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
const BACKEND_ROOT = path.join(__dirname, '..', '..');
const APP_ROOT = path.join(BACKEND_ROOT, '..');
const LOG_DIR = process.env.SYSTEM_LOG_DIR || path.join(BACKEND_ROOT, 'logs');
const PROCESS_LOG_FILE = process.env.SYSTEM_PROCESS_LOG_FILE || path.join(APP_ROOT, 'nohup.out');
const DEFAULT_LOOKBACK_MS = 24 * 60 * 60 * 1000;
const LOG_SOURCE_VALUES = new Set(['app', 'access', 'all']);
let exportIndexesEnsured = false;

const parseBooleanQuery = (value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return false;
  return ['1', 'true', 'yes', 'y'].includes(value.trim().toLowerCase());
};

const parseInteger = (value, fallback, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, minimum), maximum);
};

const normalizeLogSource = (value) => {
  if (typeof value !== 'string') return 'app';
  const normalized = value.trim().toLowerCase();
  return LOG_SOURCE_VALUES.has(normalized) ? normalized : 'app';
};

const parseSystemLogFilters = (query = {}) => ({
  limit: Math.min(parseInteger(query.limit, 1000, 1, 50000), 50000),
  level: typeof query.level === 'string' ? query.level.trim() : '',
  search: typeof query.search === 'string' ? query.search.trim() : '',
  pollId: typeof query.pollId === 'string' ? query.pollId.trim() : '',
  errorCategory: typeof query.errorCategory === 'string' ? query.errorCategory.trim() : '',
  source: normalizeLogSource(query.source),
});

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
  const sourceSuffix = filters.source && filters.source !== 'app' ? `-${filters.source}` : '';
  const fileName = `system-logs${sourceSuffix}-${now.toISOString().split('T')[0]}-${jobId}.${format}`;
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

const extractPollId = (message) => {
  if (!message) return null;
  const match = message.match(/\[POLL\s*#(\d+)\]/i);
  return match ? match[1] : null;
};

const categorizeError = (message, level, meta) => {
  if (level !== 'error') return null;
  if (!message) return 'unknown';

  if (meta && meta.category) {
    return meta.category;
  }

  const msg = message.toLowerCase();

  if (meta && meta.source === 'browser') {
    return 'browser_error';
  }

  if (
    msg.includes('400') ||
    msg.includes('401') ||
    msg.includes('403') ||
    msg.includes('404') ||
    msg.includes('bad request')
  ) {
    return 'http_4xx';
  }

  if (
    msg.includes('500') ||
    msg.includes('502') ||
    msg.includes('503') ||
    msg.includes('504') ||
    msg.includes('server error')
  ) {
    return 'http_5xx';
  }

  if (
    msg.includes('timeout') ||
    msg.includes('connection') ||
    msg.includes('econnrefused') ||
    msg.includes('network')
  ) {
    return 'network';
  }

  if (msg.includes('transform failed') || msg.includes('transformation')) {
    return 'transform';
  }

  if (msg.includes('rate limit') || msg.includes('429')) {
    return 'ratelimit';
  }

  if (
    msg.includes('mongodb') ||
    msg.includes('mysql') ||
    msg.includes('database') ||
    msg.includes('query') ||
    msg.includes('sequelize')
  ) {
    return 'database';
  }

  if (msg.includes('validation') || msg.includes('invalid') || msg.includes('required field')) {
    return 'validation_error';
  }

  return 'other';
};

const groupLogsByPoll = (logs) => {
  const groups = {};

  logs.forEach((entry) => {
    const pollId = extractPollId(entry.message) || 'NO_POLL';

    if (!groups[pollId]) {
      groups[pollId] = {
        pollId,
        logs: [],
        firstTimestamp: entry.timestamp,
        lastTimestamp: entry.timestamp,
        hasError: false,
        hasWarn: false,
        levels: { error: 0, warn: 0, info: 0, debug: 0 },
        eventsProcessed: 0,
        retriesProcessed: 0,
        totalDurationMs: 0,
      };
    }

    const group = groups[pollId];
    group.logs.push(entry);

    if (entry.timestamp < group.firstTimestamp) group.firstTimestamp = entry.timestamp;
    if (entry.timestamp > group.lastTimestamp) group.lastTimestamp = entry.timestamp;

    if (entry.level === 'error') group.hasError = true;
    if (entry.level === 'warn') group.hasWarn = true;
    if (group.levels[entry.level] !== undefined) {
      group.levels[entry.level] += 1;
    }

    if (entry.meta) {
      if (typeof entry.meta.eventsProcessed === 'number') {
        group.eventsProcessed = Math.max(group.eventsProcessed, entry.meta.eventsProcessed);
      }
      if (typeof entry.meta.retriesProcessed === 'number') {
        group.retriesProcessed = Math.max(group.retriesProcessed, entry.meta.retriesProcessed);
      }
      if (typeof entry.meta.durationMs === 'number') {
        group.totalDurationMs += entry.meta.durationMs;
      }
    }
  });

  Object.values(groups).forEach((group) => {
    group.pollDurationMs = new Date(group.lastTimestamp).getTime() - new Date(group.firstTimestamp).getTime();
    group.logs.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  });

  return Object.values(groups).sort(
    (a, b) => new Date(b.lastTimestamp).getTime() - new Date(a.lastTimestamp).getTime()
  );
};

const getSourceTypes = (source) => {
  if (source === 'all') return ['app', 'access'];
  return [source || 'app'];
};

const getLogFilenamePrefix = (sourceType) => (sourceType === 'access' ? 'access' : 'app');

const matchesRotatedLogName = (fileName, prefix) => {
  const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rotatedPattern = new RegExp(`^${escapedPrefix}-\\d{4}-\\d{2}-\\d{2}\\.log(?:\\.gz)?$`);
  return rotatedPattern.test(fileName) || fileName === `${prefix}.log`;
};

const getRecentLogFiles = async (sourceType) => {
  const prefix = getLogFilenamePrefix(sourceType);
  let entries = [];

  try {
    entries = await fsp.readdir(LOG_DIR, { withFileTypes: true });
  } catch (_error) {
    return [];
  }

  const now = Date.now();
  const files = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!matchesRotatedLogName(entry.name, prefix)) continue;

    const filePath = path.join(LOG_DIR, entry.name);

    try {
      const stat = await fsp.stat(filePath);
      files.push({ filePath, mtimeMs: stat.mtimeMs, size: stat.size, name: entry.name });
    } catch (_error) {}
  }

  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return files.filter((file, index) => index < 3 || now - file.mtimeMs <= 48 * 60 * 60 * 1000);
};

const createReadableStreamForLogFile = (filePath) => {
  const stream = fs.createReadStream(filePath);
  if (filePath.endsWith('.gz')) {
    return stream.pipe(zlib.createGunzip());
  }
  return stream;
};

const readLogFileLines = async (filePath) => {
  const input = createReadableStreamForLogFile(filePath);
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  const lines = [];

  for await (const line of rl) {
    if (line.trim()) {
      lines.push(line);
    }
  }

  return lines;
};

const normalizeAppLogEntry = (entry) => {
  if (!entry || typeof entry !== 'object') return null;
  if (!entry.timestamp || !entry.level || typeof entry.message !== 'string') return null;

  const normalized = {
    timestamp: entry.timestamp,
    level: entry.level,
    message: entry.message,
    meta: entry.meta && typeof entry.meta === 'object' ? entry.meta : {},
    category: entry.category || null,
    source: entry.source || (entry.meta && entry.meta.source) || 'server',
    stream: 'app',
  };

  normalized.errorCategory = categorizeError(normalized.message, normalized.level, normalized.meta);
  return normalized;
};

const ACCESS_LOG_PATTERN = /^(\S+)\s+([A-Z]+)\s+(\S+)\s+(\d{3})\s+(\S+)\s+-\s+([\d.]+)\s+ms$/;

const parseAccessLogLine = (line) => {
  if (!line || typeof line !== 'string') return null;

  const match = line.match(ACCESS_LOG_PATTERN);
  if (!match) {
    const timestampToken = line.split(/\s+/, 1)[0];
    const parsedTime = new Date(timestampToken);
    return {
      timestamp: Number.isNaN(parsedTime.getTime()) ? new Date().toISOString() : parsedTime.toISOString(),
      level: 'info',
      message: line,
      meta: {},
      category: null,
      source: 'server',
      stream: 'access',
      errorCategory: null,
    };
  }

  const [, timestamp, method, url, statusText, contentLengthText, responseTimeText] = match;
  const status = Number.parseInt(statusText, 10);
  const responseTimeMs = Number.parseFloat(responseTimeText);
  const contentLength = contentLengthText === '-' ? null : Number.parseInt(contentLengthText, 10);
  const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';
  const meta = {
    method,
    url,
    status,
    contentLength,
    responseTimeMs,
  };

  return {
    timestamp: new Date(timestamp).toISOString(),
    level,
    message: line,
    meta,
    category: null,
    source: 'server',
    stream: 'access',
    errorCategory: categorizeError(line, level, meta),
  };
};

const parseLogLineForSource = (line, sourceType) => {
  if (sourceType === 'access') {
    return parseAccessLogLine(line);
  }

  try {
    const parsed = JSON.parse(line);
    return normalizeAppLogEntry(parsed);
  } catch (_error) {
    return null;
  }
};

const matchesSearch = (entry, search) => {
  if (!search) return true;
  const haystack = [
    entry.message,
    entry.stream,
    entry.source,
    entry.meta ? JSON.stringify(entry.meta) : '',
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return haystack.includes(search.toLowerCase());
};

const matchesPollId = (entry, pollId) => {
  if (!pollId) return true;
  const logPollId = extractPollId(entry.message);
  const acceptedPollIds = String(pollId)
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (acceptedPollIds.length === 0) return true;
  if (acceptedPollIds.includes('NO_POLL')) {
    if (logPollId === null) return true;
  }
  return logPollId !== null && acceptedPollIds.includes(logPollId);
};

const listSystemLogs = async (filters) => {
  const effectiveFilters = {
    limit: filters.limit || 1000,
    level: filters.level || '',
    search: filters.search || '',
    pollId: filters.pollId || '',
    errorCategory: filters.errorCategory || '',
    source: normalizeLogSource(filters.source),
  };
  const now = Date.now();
  const oneDayAgo = now - DEFAULT_LOOKBACK_MS;
  const sourceTypes = getSourceTypes(effectiveFilters.source);
  const allLogsForStats = [];

  for (const sourceType of sourceTypes) {
    const files = await getRecentLogFiles(sourceType);
    for (const file of files) {
      const lines = await readLogFileLines(file.filePath);
      for (let index = lines.length - 1; index >= 0; index -= 1) {
        const entry = parseLogLineForSource(lines[index], sourceType);
        if (!entry) continue;

        const logTime = new Date(entry.timestamp).getTime();
        if (!Number.isFinite(logTime)) continue;
        if (logTime < oneDayAgo) break;

        allLogsForStats.push(entry);
      }
    }
  }

  allLogsForStats.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  const logs = allLogsForStats.filter((entry) => {
    if (effectiveFilters.level && entry.level !== effectiveFilters.level) return false;
    if (!matchesSearch(entry, effectiveFilters.search)) return false;
    if (!matchesPollId(entry, effectiveFilters.pollId)) return false;
    if (effectiveFilters.errorCategory && entry.errorCategory !== effectiveFilters.errorCategory) return false;
    return true;
  }).slice(0, effectiveFilters.limit);

  const errorLogsAll = allLogsForStats.filter((entry) => entry.level === 'error');
  const stats = {
    total: allLogsForStats.length,
    error: errorLogsAll.length,
    warn: allLogsForStats.filter((entry) => entry.level === 'warn').length,
    info: allLogsForStats.filter((entry) => entry.level === 'info').length,
    debug: allLogsForStats.filter((entry) => entry.level === 'debug').length,
    byStream: {
      app: allLogsForStats.filter((entry) => entry.stream === 'app').length,
      access: allLogsForStats.filter((entry) => entry.stream === 'access').length,
    },
    errorCategories: {
      ui_error: errorLogsAll.filter((entry) => entry.errorCategory === 'ui_error').length,
      api_error: errorLogsAll.filter((entry) => entry.errorCategory === 'api_error').length,
      validation_error: errorLogsAll.filter((entry) => entry.errorCategory === 'validation_error').length,
      business_logic: errorLogsAll.filter((entry) => entry.errorCategory === 'business_logic').length,
      unhandled: errorLogsAll.filter((entry) => entry.errorCategory === 'unhandled').length,
      browser_error: errorLogsAll.filter((entry) => entry.errorCategory === 'browser_error').length,
      http_4xx: errorLogsAll.filter((entry) => entry.errorCategory === 'http_4xx').length,
      http_5xx: errorLogsAll.filter((entry) => entry.errorCategory === 'http_5xx').length,
      network: errorLogsAll.filter((entry) => entry.errorCategory === 'network').length,
      transform: errorLogsAll.filter((entry) => entry.errorCategory === 'transform').length,
      ratelimit: errorLogsAll.filter((entry) => entry.errorCategory === 'ratelimit').length,
      database: errorLogsAll.filter((entry) => entry.errorCategory === 'database').length,
      other: errorLogsAll.filter((entry) => entry.errorCategory === 'other').length,
      unknown: errorLogsAll.filter((entry) => entry.errorCategory === 'unknown').length,
    },
  };

  const pollGroups = groupLogsByPoll(logs.filter((entry) => entry.stream === 'app'));
  const pollStats = {
    total: pollGroups.length,
    withErrors: pollGroups.filter((group) => group.hasError).length,
    withWarnings: pollGroups.filter((group) => group.hasWarn && !group.hasError).length,
    healthy: pollGroups.filter((group) => !group.hasError && !group.hasWarn).length,
  };
  const pollPerformance = pollGroups
    .filter((group) => group.pollId !== 'NO_POLL')
    .slice(0, 10)
    .map((group) => ({
      pollId: group.pollId,
      durationMs: group.pollDurationMs,
      eventsProcessed: group.eventsProcessed,
      retriesProcessed: group.retriesProcessed,
      logCount: group.logs.length,
      hasError: group.hasError,
      hasWarn: group.hasWarn,
    }));

  return {
    logs,
    displayed: logs.length,
    totalInPeriod: allLogsForStats.length,
    limit: effectiveFilters.limit,
    filters: {
      level: effectiveFilters.level || undefined,
      search: effectiveFilters.search || undefined,
      pollId: effectiveFilters.pollId || undefined,
      errorCategory: effectiveFilters.errorCategory || undefined,
      source: effectiveFilters.source,
    },
    stats,
    pollStats,
    pollPerformance,
    pollGroups,
  };
};

const readSystemLogs = async (filters) => {
  const response = await listSystemLogs(filters);
  return response.logs;
};

const getProcessLogTail = async ({ lines = 200, maxBytes = 256 * 1024 } = {}) => {
  const filePath = PROCESS_LOG_FILE;
  const lineLimit = Math.min(Math.max(Number(lines) || 200, 1), 2000);
  const maxReadBytes = Math.min(Math.max(Number(maxBytes) || 256 * 1024, 1024), 2 * 1024 * 1024);

  if (!filePath || !fs.existsSync(filePath)) {
    return {
      fileName: filePath ? path.basename(filePath) : 'nohup.out',
      fileExists: false,
      updatedAt: null,
      sizeBytes: 0,
      totalLines: 0,
      returnedLines: 0,
      truncated: false,
      lines: [],
    };
  }

  const stat = await fsp.stat(filePath);
  const readLength = Math.min(stat.size, maxReadBytes);
  const startPosition = Math.max(0, stat.size - readLength);
  const handle = await fsp.open(filePath, 'r');

  try {
    const buffer = Buffer.alloc(readLength);
    await handle.read(buffer, 0, readLength, startPosition);
    let content = buffer.toString('utf8');

    if (startPosition > 0) {
      const firstNewline = content.indexOf('\n');
      if (firstNewline >= 0) {
        content = content.slice(firstNewline + 1);
      }
    }

    const allLines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
    const visibleLines = allLines.slice(-lineLimit);
    const lineNumberOffset = Math.max(0, allLines.length - visibleLines.length);

    return {
      fileName: path.basename(filePath),
      fileExists: true,
      updatedAt: stat.mtime.toISOString(),
      sizeBytes: stat.size,
      totalLines: allLines.length,
      returnedLines: visibleLines.length,
      truncated: startPosition > 0 || allLines.length > visibleLines.length,
      lines: visibleLines.map((line, index) => ({
        lineNumber: lineNumberOffset + index + 1,
        text: line,
      })),
    };
  } finally {
    await handle.close();
  }
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
      const headers = ['Timestamp', 'Level', 'Stream', 'Message', 'Error Category', 'Metadata'];
      const rows = logs.map((entry) => [
        entry.timestamp,
        entry.level,
        entry.stream || 'app',
        entry.message || '',
        entry.errorCategory || '',
        entry.meta ? JSON.stringify(entry.meta) : '',
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

router.get('/', async (req, res) => {
  try {
    const filters = parseSystemLogFilters(req.query || {});
    const grouped = req.query.grouped === 'true';
    const response = await listSystemLogs(filters);
    if (!grouped) {
      delete response.pollGroups;
    }
    res.json(response);
  } catch (err) {
    res.status(500).json({
      error: 'Failed to read logs',
      message: err.message,
    });
  }
});

router.get('/process-tail', async (req, res) => {
  try {
    const lines = parseInteger(req.query.lines, 200, 1, 2000);
    const payload = await getProcessLogTail({ lines });
    res.json(payload);
  } catch (err) {
    res.status(500).json({
      error: 'Failed to read process log',
      message: err.message,
    });
  }
});

router.get('/export/json', async (req, res) => {
  const filters = parseSystemLogFilters(req.query || {});
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
    const sourceSuffix = filters.source && filters.source !== 'app' ? `-${filters.source}` : '';
    const filename = `system-logs${sourceSuffix}-${new Date().toISOString().split('T')[0]}.json`;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: 'Export failed', message: err.message });
  }
});

router.get('/export/csv', async (req, res) => {
  const filters = parseSystemLogFilters(req.query || {});
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
    const headers = ['Timestamp', 'Level', 'Stream', 'Message', 'Error Category', 'Metadata'];
    const rows = logs.map((entry) => [
      entry.timestamp,
      entry.level,
      entry.stream || 'app',
      entry.message || '',
      entry.errorCategory || '',
      entry.meta ? JSON.stringify(entry.meta) : '',
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

    const sourceSuffix = filters.source && filters.source !== 'app' ? `-${filters.source}` : '';
    const filename = `system-logs${sourceSuffix}-${new Date().toISOString().split('T')[0]}.csv`;
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

router.delete('/clear', async (_req, res) => {
  const archivedFiles = [];

  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const targets = [];

    for (const sourceType of ['app', 'access']) {
      const files = await getRecentLogFiles(sourceType);
      const currentFile = files.find((file) => file.filePath.endsWith('.log'));
      if (currentFile) {
        targets.push(currentFile.filePath);
      }
    }

    for (const filePath of targets) {
      const archiveFile = `${filePath}.${timestamp}.archive`;
      await fsp.copyFile(filePath, archiveFile);
      await fsp.truncate(filePath, 0);
      archivedFiles.push(archiveFile);
    }

    res.json({
      message: 'System logs cleared successfully',
      archived: archivedFiles.join(', '),
    });
  } catch (err) {
    res.status(500).json({
      error: 'Failed to clear logs',
      message: err.message,
    });
  }
});

module.exports = router;
