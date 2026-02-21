const fs = require('fs');
const path = require('path');
const morgan = require('morgan');

let db = null;

// Set database instance (called after MongoDB connects)
function setDb(database) {
  db = database;
}

const logDir = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

const accessLogStream = fs.createWriteStream(path.join(logDir, 'access.log'), { flags: 'a' });
const appLogStream = fs.createWriteStream(path.join(logDir, 'app.log'), { flags: 'a' });

function write(line) {
  appLogStream.write(`${line}\n`);
}

function closeLogStreams() {
  try {
    accessLogStream.end();
    appLogStream.end();
  } catch (err) {
    // Swallow close errors in test/teardown paths
  }
}

function log(level, message, meta = {}) {
  const payload = {
    timestamp: new Date().toISOString(),
    level,
    message,
    meta
  };

  // Extract correlation ID or request ID if present in meta for better visibility
  const correlationId = meta.correlationId || meta.traceId || meta.requestId;

  const line = JSON.stringify(payload);
  write(line);
  if (process.env.NODE_ENV !== 'production') {
    // Mirror to console in dev for faster feedback, include correlation/request ID if present
    const prefix = correlationId ? `[${correlationId.substring(0, 12)}]` : '';
    console.log(`[${payload.timestamp}] ${prefix} [${level}] ${message}`, Object.keys(meta).length ? meta : '');
  }
}

async function logError(err, context = {}) {
  const message = err.message || 'Unhandled error';

  // Log to app.log (24 hours)
  log('error', message, {
    ...context,
    stack: err.stack
  });

  // Also save to MongoDB (30 days) if available
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
        createdAt: new Date()
      });
    } catch (dbErr) {
      console.error('Failed to save backend error to MongoDB:', dbErr);
    }
  }
}

const requestLogger = morgan(':date[iso] :method :url :status :res[content-length] - :response-time ms', {
  stream: accessLogStream
});

module.exports = { log, logError, requestLogger, setDb, closeLogStreams };
