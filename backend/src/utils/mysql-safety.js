'use strict';

const POOL_LIMITS = Object.freeze({
  shared: Object.freeze({
    minConnectionLimit: 1,
    maxConnectionLimit: 20,
    defaultConnectionLimit: 10,
    minQueueLimit: 0,
    maxQueueLimit: 200,
    defaultQueueLimit: 50
  }),
  dedicated: Object.freeze({
    minConnectionLimit: 1,
    maxConnectionLimit: 5,
    defaultConnectionLimit: 3,
    minQueueLimit: 0,
    maxQueueLimit: 50,
    defaultQueueLimit: 20
  })
});

const SOURCE_LIMITS = Object.freeze({
  minPollIntervalMs: 1000,
  maxPollIntervalMs: 300000,
  defaultPollIntervalMs: 5000,
  minBatchSize: 1,
  maxBatchSize: 100,
  defaultBatchSize: 10,
  minDbTimeoutMs: 1000,
  maxDbTimeoutMs: 120000,
  defaultDbTimeoutMs: 30000
});

function toInt(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return Math.trunc(num);
}

function clampInt(value, min, max, fallback) {
  const parsed = toInt(value);
  if (parsed === null) return fallback;
  if (parsed < min) return min;
  if (parsed > max) return max;
  return parsed;
}

function clampOptionalInt(value, min, max, fallback) {
  if (value === undefined || value === null || value === '') return undefined;
  return clampInt(value, min, max, fallback);
}

function sanitizePoolConfig(input = {}, mode = 'shared') {
  const limits = mode === 'dedicated' ? POOL_LIMITS.dedicated : POOL_LIMITS.shared;
  return {
    connectionLimit: clampInt(
      input.connectionLimit,
      limits.minConnectionLimit,
      limits.maxConnectionLimit,
      limits.defaultConnectionLimit
    ),
    queueLimit: clampInt(
      input.queueLimit,
      limits.minQueueLimit,
      limits.maxQueueLimit,
      limits.defaultQueueLimit
    )
  };
}

function sanitizeMysqlSourceConfig(sourceConfig = {}) {
  const sharedPool = sourceConfig.useSharedPool !== false;
  const dedicatedPool = sanitizePoolConfig(sourceConfig, 'dedicated');
  const pollIntervalMs = clampOptionalInt(
    sourceConfig.pollIntervalMs,
    SOURCE_LIMITS.minPollIntervalMs,
    SOURCE_LIMITS.maxPollIntervalMs,
    SOURCE_LIMITS.defaultPollIntervalMs
  );
  const batchSize = clampOptionalInt(
    sourceConfig.batchSize,
    SOURCE_LIMITS.minBatchSize,
    SOURCE_LIMITS.maxBatchSize,
    SOURCE_LIMITS.defaultBatchSize
  );
  const dbTimeoutMs = clampOptionalInt(
    sourceConfig.dbTimeoutMs,
    SOURCE_LIMITS.minDbTimeoutMs,
    SOURCE_LIMITS.maxDbTimeoutMs,
    SOURCE_LIMITS.defaultDbTimeoutMs
  );

  return {
    ...sourceConfig,
    useSharedPool: sharedPool,
    port: clampInt(sourceConfig.port, 1, 65535, 3306),
    connectionLimit: dedicatedPool.connectionLimit,
    queueLimit: dedicatedPool.queueLimit,
    ...(pollIntervalMs !== undefined ? { pollIntervalMs } : {}),
    ...(batchSize !== undefined ? { batchSize } : {}),
    ...(dbTimeoutMs !== undefined ? { dbTimeoutMs } : {})
  };
}

module.exports = {
  POOL_LIMITS,
  SOURCE_LIMITS,
  sanitizePoolConfig,
  sanitizeMysqlSourceConfig
};
