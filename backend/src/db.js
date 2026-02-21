const mysql = require('mysql2/promise');
const config = require('./config');
const { log } = require('./logger');
const { sanitizePoolConfig } = require('./utils/mysql-safety');

let pool;
let poolRecreating = false;
let poolRecreationPromise = null;

const isConfigured = () => Boolean(config.db?.host && config.db?.user && config.db?.database);

/**
 * Recreate MySQL pool after fatal error
 * Thread-safe: concurrent calls will wait for same recreation promise
 */
async function recreatePool() {
  // If recreation is already in progress, wait for it
  if (poolRecreationPromise) {
    log('debug', 'Waiting for ongoing pool recreation...');
    return poolRecreationPromise;
  }

  if (poolRecreating) {
    log('debug', 'Pool recreation flag set but no promise - skipping');
    return;
  }

  poolRecreating = true;
  log('warn', 'Recreating MySQL connection pool due to fatal error');

  poolRecreationPromise = (async () => {
    try {
      // Close old pool gracefully
      if (pool) {
        try {
          await pool.end();
          log('info', 'Old MySQL pool closed');
        } catch (err) {
          log('warn', 'Error closing old pool', { error: err.message });
        }
      }

      // Create new pool
      pool = null;
      pool = createPoolWithHandlers();

      // Test connection
      await pool.execute('SELECT 1 as ok');
      log('info', 'MySQL pool recreated and tested successfully');
    } catch (err) {
      log('error', 'Failed to recreate MySQL pool', { error: err.message });
      pool = null;
      throw err;
    }
  })()
    .finally(() => {
      poolRecreating = false;
      poolRecreationPromise = null;
    });

  return poolRecreationPromise;
}

/**
 * Create pool with error handlers
 */
function createPoolWithHandlers() {
  const dbConfig = config.db || {};
  const safePoolConfig = sanitizePoolConfig(dbConfig, 'shared');

  const newPool = mysql.createPool({
    host: dbConfig.host,
    port: dbConfig.port,
    user: dbConfig.user,
    password: dbConfig.password,
    database: dbConfig.database,
    waitForConnections: true,
    connectionLimit: safePoolConfig.connectionLimit,
    queueLimit: safePoolConfig.queueLimit, // Hard-capped queue to prevent memory bloat
    namedPlaceholders: true,
    // Connection health settings
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000
    // Note: acquireTimeout, idleTimeout, maxIdle not supported in mysql2
    // Connection limits controlled via connectionLimit + queueLimit only
  });

  // Handle pool errors
  newPool.on('error', (err) => {
    log('error', 'MySQL pool error', {
      error: err.message,
      code: err.code,
      fatal: err.fatal
    });

    // Recreate pool on fatal errors
    if (err.fatal || err.code === 'PROTOCOL_CONNECTION_LOST') {
      recreatePool().catch(recreateErr => {
        log('error', 'Pool recreation failed', { error: recreateErr.message });
      });
    }
  });

  log('info', 'MySQL pool created with error handlers', {
    host: dbConfig.host,
    db: dbConfig.database,
    connectionLimit: safePoolConfig.connectionLimit,
    queueLimit: safePoolConfig.queueLimit
  });

  return newPool;
}

function getPool() {
  if (!isConfigured()) return undefined;
  if (!pool) {
    pool = createPoolWithHandlers();
  }
  return pool;
}

/**
 * Execute query with retry logic for transient errors
 * Waits for pool recreation if in progress
 */
async function query(sql, params = {}, retries = 2) {
  // Wait for pool recreation if in progress
  if (poolRecreationPromise) {
    log('debug', 'Waiting for pool recreation before executing query');
    await poolRecreationPromise.catch(() => {
      // Ignore recreation errors, we'll handle them in the query retry logic
    });
  }

  const conn = getPool();
  if (!conn) throw new Error('Database is not configured');

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await conn.execute(sql, params);
    } catch (err) {
      const isLastAttempt = attempt === retries;
      const isTransientError = err.code === 'PROTOCOL_CONNECTION_LOST' ||
                               err.code === 'ECONNRESET' ||
                               err.code === 'ETIMEDOUT' ||
                               err.errno === 'ENOTFOUND';

      if (isTransientError && !isLastAttempt) {
        const delayMs = Math.min(1000 * Math.pow(2, attempt), 5000); // Max 5s
        log('warn', 'MySQL query failed, retrying', {
          attempt: attempt + 1,
          maxRetries: retries,
          error: err.message,
          code: err.code,
          delayMs
        });
        await new Promise(resolve => setTimeout(resolve, delayMs));

        // Wait for pool recreation if it started during retry delay
        if (poolRecreationPromise) {
          await poolRecreationPromise.catch(() => {});
        }
      } else {
        if (isLastAttempt) {
          log('error', 'MySQL query failed after retries', {
            error: err.message,
            code: err.code,
            attempts: retries + 1
          });
        }
        throw err;
      }
    }
  }
}

async function ping() {
  if (!isConfigured()) return false;
  try {
    await query('SELECT 1 as ok');
    return true;
  } catch (err) {
    log('error', 'DB ping failed', { error: err.message });
    return false;
  }
}

/**
 * Get a connection from the pool with retry logic
 * Waits for pool recreation if in progress
 */
async function getConnection(retries = 2) {
  // Wait for pool recreation if in progress
  if (poolRecreationPromise) {
    log('debug', 'Waiting for pool recreation before getting connection');
    await poolRecreationPromise.catch(() => {});
  }

  const conn = getPool();
  if (!conn) throw new Error('Database is not configured');

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await conn.getConnection();
    } catch (err) {
      const isLastAttempt = attempt === retries;
      const isTransientError = err.code === 'PROTOCOL_CONNECTION_LOST' ||
                               err.code === 'ECONNRESET' ||
                               err.code === 'ETIMEDOUT';

      if (isTransientError && !isLastAttempt) {
        const delayMs = Math.min(1000 * Math.pow(2, attempt), 5000);
        log('warn', 'Failed to get MySQL connection, retrying', {
          attempt: attempt + 1,
          maxRetries: retries,
          error: err.message,
          delayMs
        });
        await new Promise(resolve => setTimeout(resolve, delayMs));

        // Wait for pool recreation if it started during retry delay
        if (poolRecreationPromise) {
          await poolRecreationPromise.catch(() => {});
        }
      } else {
        throw err;
      }
    }
  }
}

module.exports = { query, ping, isConfigured, getConnection, getPool };
