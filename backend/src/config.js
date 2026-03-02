const path = require('path');
const fs = require('fs');
require('dotenv').config();

const parseBoolean = (value, fallback) => {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  return fallback;
};

const parsePositiveNumber = (value, fallback) => {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : fallback;
};

const defaultConfig = {
  port: process.env.PORT || 4000,
  api: { basePrefix: process.env.API_PREFIX || '/api/v1' },
  server: {
    trustProxy: parseBoolean(process.env.TRUST_PROXY, false),
  },
  communicationServiceUrl: process.env.COMMUNICATION_SERVICE_URL || '',
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5174',
  db: {
    host: '',
    port: 3306,
    user: '',
    password: '',
    database: '',
    connectionLimit: 10,
    queueLimit: 50, // Max queued connection requests (prevents memory bloat)
    // Note: mysql2 doesn't support acquireTimeout, idleTimeout, maxIdle
    // Pool limits controlled via connectionLimit + queueLimit only
  },
  mongodb: {
    uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/integration_gateway',
    database: process.env.MONGODB_DATABASE || 'integration_gateway',
    options: {
      maxPoolSize: 100,
      minPoolSize: 10
    }
  },
  security: {
    enforceHttps: true,
    blockPrivateNetworks: true,
    apiKey: process.env.API_KEY || 'mdcs_dev_key_1f4a',
    jwtSecret: process.env.JWT_SECRET || 'change_me_dev_jwt_secret',
    jwtExpiresIn: '12h',
  },
  eventSource: {
    // Optional global default. Leave unset to rely only on per-org
    // configuration from event_source_configs.
    type: undefined,
    // Safety default: do not auto-apply global defaults to every org
    // unless explicitly enabled.
    applyGlobalDefaultToAllOrgs: false,
  },
  kafka: {
    brokers: ['localhost:9092'],
    topic: 'integration-events',
    groupId: 'integration-processor',
    clientId: 'integration-gateway',
    fromBeginning: false,
    sessionTimeout: 30000,
    heartbeatInterval: 3000,
    maxBytesPerPartition: 26214400, // 25MB
    autoCommit: false,
  },
  worker: {
    enabled: true,
    intervalMs: 5000,
    batchSize: 5,
    timeoutMs: 10000,
    multiActionDelayMs: 0,
    maxEventAgeDays: 1,
    allowedParentsFromIntegrations: true,
    bootstrapCheckpoint: true,
    dbOperationTimeoutMs: 30000,
    retryIntervalMs: 60000, // Interval for retry processor (default: 60000ms = 1 minute)
    retryBatchSize: 3,
    maxRetryProcessingTimeMs: 120000,
  },
  scheduler: {
    enabled: true,
    intervalMs: 60000,
    batchSize: 10,
    dbOperationTimeoutMs: 30000,
  },
  eventAudit: {
    enabled: true,
    retentionDays: 30,
    storeFullPayload: false,
    storeSummaryPayload: true,
    maxPayloadSize: 10000000, // 10MB
    allowedSummaryFields: ['patientRid', 'appointmentId', 'orgUnitRid', 'billId', 'eventType', 'timestamp'],
    trackSourceMetadata: true,
    enableGapDetection: true,
    watchdogEnabled: true,
    watchdogIntervalMs: 300000, // 5 minutes
    stuckThresholdMs: 300000, // 5 minutes
  },
  logging: {
    level: process.env.LOG_LEVEL || 'info', // override via LOG_LEVEL env var
    maxSize: '20m',       // rotate when file hits 20 MB
    maxFiles: '14d',      // keep 14 days of rotated files
    compress: true,       // gzip rotated files
  },
  rateLimit: {
    enabled: parseBoolean(process.env.API_RATE_LIMIT_ENABLED, true),
    maxRequests: parsePositiveNumber(process.env.API_RATE_LIMIT_MAX_REQUESTS, 100),
    windowSeconds: parsePositiveNumber(process.env.API_RATE_LIMIT_WINDOW_SECONDS, 60),
  },
  // NOTE: Event types are now managed in MongoDB 'event_types' collection (56 events)
  // Do not specify eventTypes here - use the populate-event-types.js script instead
};

const configPath = path.join(__dirname, '..', 'config.json');
let fileConfig = {};
if (fs.existsSync(configPath)) {
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    fileConfig = JSON.parse(raw);
  } catch (err) {
    console.warn('Failed to read config.json; using defaults', err.message);
  }
} else {
  console.warn('config.json not found; using defaults in src/config.js');
}

// Shallow merge with defaults, with nested object overrides
const merged = {
  ...defaultConfig,
  ...fileConfig,
  api: { ...defaultConfig.api, ...(fileConfig.api || {}) },
  server: { ...defaultConfig.server, ...(fileConfig.server || {}) },
  db: { ...defaultConfig.db, ...(fileConfig.db || {}) },
  mongodb: { ...defaultConfig.mongodb, ...(fileConfig.mongodb || {}) },
  security: { ...defaultConfig.security, ...(fileConfig.security || {}) },
  eventSource: { ...defaultConfig.eventSource, ...(fileConfig.eventSource || {}) },
  kafka: { ...defaultConfig.kafka, ...(fileConfig.kafka || {}) },
  worker: { ...defaultConfig.worker, ...(fileConfig.worker || {}) },
  scheduler: { ...defaultConfig.scheduler, ...(fileConfig.scheduler || {}) },
  eventAudit: { ...defaultConfig.eventAudit, ...(fileConfig.eventAudit || {}) },
  logging: { ...defaultConfig.logging, ...(fileConfig.logging || {}) },
  rateLimit: { ...defaultConfig.rateLimit, ...(fileConfig.rateLimit || {}) },
  // communicationServiceUrl and frontendUrl: file overrides default if present
  communicationServiceUrl: fileConfig.communicationServiceUrl || defaultConfig.communicationServiceUrl,
  frontendUrl: fileConfig.frontendUrl || defaultConfig.frontendUrl,
};

module.exports = merged;
