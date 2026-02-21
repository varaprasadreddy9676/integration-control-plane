const path = require('path');
const fs = require('fs');

const defaultConfig = {
  port: 4000,
  api: { basePrefix: '/api/v1' },
  communicationServiceUrl: process.env.COMMUNICATION_SERVICE_URL || '',
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5174',
  db: {
    host: '',
    port: 3306,
    user: '',
    password: '',
    database: '',
    connectionLimit: 10,
    queueLimit: 50 // Max queued connection requests (prevents memory bloat)
    // Note: mysql2 doesn't support acquireTimeout, idleTimeout, maxIdle
    // Pool limits controlled via connectionLimit + queueLimit only
  },
  security: {
    enforceHttps: true,
    blockPrivateNetworks: true,
    apiKey: 'mdcs_dev_key_1f4a',
    jwtSecret: 'change_me_dev_jwt_secret',
    jwtExpiresIn: '12h'
  },
  eventSource: {
    // Optional global default. Leave unset to rely only on per-org
    // configuration from event_source_configs.
    type: undefined
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
    autoCommit: false
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
    maxRetryProcessingTimeMs: 120000
  },
  scheduler: {
    enabled: true,
    intervalMs: 60000,
    batchSize: 10,
    dbOperationTimeoutMs: 30000
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
    stuckThresholdMs: 300000   // 5 minutes
  }
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
  db: { ...defaultConfig.db, ...(fileConfig.db || {}) },
  security: { ...defaultConfig.security, ...(fileConfig.security || {}) },
  eventSource: { ...defaultConfig.eventSource, ...(fileConfig.eventSource || {}) },
  kafka: { ...defaultConfig.kafka, ...(fileConfig.kafka || {}) },
  worker: { ...defaultConfig.worker, ...(fileConfig.worker || {}) },
  scheduler: { ...defaultConfig.scheduler, ...(fileConfig.scheduler || {}) },
  eventAudit: { ...defaultConfig.eventAudit, ...(fileConfig.eventAudit || {}) },
  // communicationServiceUrl and frontendUrl: file overrides default if present
  communicationServiceUrl: fileConfig.communicationServiceUrl || defaultConfig.communicationServiceUrl,
  frontendUrl: fileConfig.frontendUrl || defaultConfig.frontendUrl
};

module.exports = merged;
