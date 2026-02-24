'use strict';

const path = require('path');
const fs = require('fs');
const morgan = require('morgan');
const { createLogger, format, transports } = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');

let db = null;

function setDb(database) {
  db = database;
}

// Ensure logs directory exists
const logDir = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

// Read logging config — loaded lazily to avoid circular-dependency issues
// at module evaluation time. Falls back to safe defaults if config is unavailable.
let loggingCfg = { level: 'info', maxSize: '20m', maxFiles: '14d', compress: true };
try {
  const cfg = require('./config');
  loggingCfg = { ...loggingCfg, ...cfg.logging };
} catch (_) {
  // config not available (e.g. test environment with full mock) — use defaults
}

// LOG_LEVEL env var always wins over config file
const logLevel = process.env.LOG_LEVEL || loggingCfg.level;

// ── Shared format: timestamp + JSON ──────────────────────────────────────────
const jsonFormat = format.combine(
  format.timestamp(),
  format.json(),
);

// ── App logger (app-YYYY-MM-DD.log) ──────────────────────────────────────────
const appFileTransport = new DailyRotateFile({
  dirname: logDir,
  filename: 'app-%DATE%.log',
  datePattern: 'YYYY-MM-DD',
  maxSize: loggingCfg.maxSize,
  maxFiles: loggingCfg.maxFiles,
  zippedArchive: loggingCfg.compress,
  format: jsonFormat,
});

const appLogger = createLogger({
  level: logLevel,
  transports: [appFileTransport],
});

// Console mirror in non-production
if (process.env.NODE_ENV !== 'production') {
  appLogger.add(
    new transports.Console({
      format: format.combine(
        format.timestamp(),
        format.colorize(),
        format.printf(({ timestamp, level, message, meta = {} }) => {
          const correlationId = meta.correlationId || meta.traceId || meta.requestId;
          const prefix = correlationId ? `[${String(correlationId).substring(0, 12)}] ` : '';
          const metaStr = Object.keys(meta).length ? JSON.stringify(meta) : '';
          return `[${timestamp}] ${prefix}[${level}] ${message}${metaStr ? ` ${metaStr}` : ''}`;
        }),
      ),
    }),
  );
}

// ── Access logger (access-YYYY-MM-DD.log) ────────────────────────────────────
const accessFileTransport = new DailyRotateFile({
  dirname: logDir,
  filename: 'access-%DATE%.log',
  datePattern: 'YYYY-MM-DD',
  maxSize: loggingCfg.maxSize,
  maxFiles: loggingCfg.maxFiles,
  zippedArchive: loggingCfg.compress,
  // Write the raw morgan string as-is (no JSON wrapping for access logs)
  format: format.printf(({ message }) => message),
});

const accessLogger = createLogger({
  level: 'http',
  levels: { ...require('winston').config.npm.levels, http: 3 },
  transports: [accessFileTransport],
});

// Morgan writes via accessLogger so rotation applies to access logs too
const requestLogger = morgan(
  ':date[iso] :method :url :status :res[content-length] - :response-time ms',
  { stream: { write: (msg) => accessLogger.http(msg.trim()) } },
);

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Write a structured log entry.
 * Preserves the same shape as before: { timestamp, level, message, meta }.
 */
function log(level, message, meta = {}) {
  appLogger.log({ level, message, meta });
}

/**
 * Log an error to app log AND persist to MongoDB error_logs (30-day TTL).
 */
async function logError(err, context = {}) {
  const message = err.message || 'Unhandled error';

  log('error', message, { ...context, stack: err.stack });

  if (db) {
    try {
      await db.collection('error_logs').insertOne({
        source: 'server',
        level: 'error',
        message,
        stack: err.stack,
        context,
        entityParentRid: context.entityParentRid || null,
        scope: context.scope || 'unknown',
        timestamp: new Date(),
        createdAt: new Date(),
      });
    } catch (dbErr) {
      console.error('Failed to save backend error to MongoDB:', dbErr);
    }
  }
}

/**
 * Graceful shutdown — flush and close all log transports.
 */
function closeLogStreams() {
  try {
    appLogger.end();
    accessLogger.end();
  } catch (_) {
    // Swallow close errors in test/teardown paths
  }
}

module.exports = { log, logError, requestLogger, setDb, closeLogStreams };
