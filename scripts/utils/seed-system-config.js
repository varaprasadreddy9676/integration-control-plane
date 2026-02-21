/**
 * seed-system-config.js
 *
 * One-time script to seed the MongoDB `system_config` collection with the
 * runtime-tunable settings that were previously stored in config.json.
 *
 * Safe to run multiple times:
 *   - By default it SKIPS if a document already exists.
 *   - Pass --force to overwrite the existing document.
 *
 * Usage:
 *   node seed-system-config.js            # skip if already seeded
 *   node seed-system-config.js --force    # overwrite existing
 *   node seed-system-config.js --dry-run  # print what would be inserted
 */

'use strict';

const { MongoClient } = require('mongodb');
const config = require('./config.json');

const FORCE = process.argv.includes('--force');
const DRY_RUN = process.argv.includes('--dry-run');

// ---------------------------------------------------------------------------
// Seed data — edit these values to match your deployment
// ---------------------------------------------------------------------------
const SEED = {
  // URLs
  communicationServiceUrl: 'https://medicsprime.in/medics-communication-service/api/sendNotification',
  frontendUrl: 'https://medicsprime.in/event-gateway',

  // Security (runtime-tunable flags only — never put apiKey / jwtSecret here)
  security: {
    enforceHttps: false,
    blockPrivateNetworks: false
  },

  // Event source
  eventSource: {
    type: 'mysql',       // 'mysql' | 'kafka'
    isSequential: true   // gap detection for MySQL ID sequences / Kafka offsets
  },

  // Event audit trail
  eventAudit: {
    enabled: true,
    retentionDays: 30,
    storeFullPayload: true,
    storeSummaryPayload: true,
    maxPayloadSize: 10000000, // 10 MB
    allowedSummaryFields: [
      'patientRid',
      'appointmentId',
      'orgUnitRid',
      'billId',
      'eventType',
      'timestamp'
    ],
    trackSourceMetadata: true,
    enableGapDetection: true,
    watchdogEnabled: true,
    watchdogIntervalMs: 300000, // 5 minutes
    stuckThresholdMs: 300000    // mark PROCESSING events stuck after 5 minutes
  },

  // Kafka (only relevant when eventSource.type === 'kafka')
  kafka: {
    brokers: ['localhost:9092'],
    topic: 'events',
    groupId: 'integration-gateway-group',
    clientId: 'integration-gateway',
    fromBeginning: false,
    sessionTimeout: 30000,
    heartbeatInterval: 3000,
    maxBytesPerPartition: 26214400, // 25 MB
    autoCommit: false
  },

  // Delivery worker
  worker: {
    enabled: true,
    intervalMs: 5000,
    batchSize: 5,
    timeoutMs: 10000,
    multiActionDelayMs: 10000,
    maxEventAgeDays: 1,
    allowedParentsFromWebhooks: true,
    bootstrapCheckpoint: true,
    dbOperationTimeoutMs: 30000,
    retryIntervalMs: 60000,     // retry processor interval
    retryBatchSize: 3,
    maxRetryProcessingTimeMs: 120000
  },

  // Scheduled-job worker
  scheduler: {
    enabled: true,
    intervalMs: 60000,
    batchSize: 10,
    dbOperationTimeoutMs: 30000
  }
};

// ---------------------------------------------------------------------------

async function seed() {
  if (DRY_RUN) {
    console.log('[dry-run] Would upsert the following system_config document:\n');
    console.log(JSON.stringify({ _id: 'main', ...SEED, updatedAt: new Date() }, null, 2));
    return;
  }

  const client = new MongoClient(config.mongodb.uri);

  try {
    await client.connect();
    console.log('Connected to MongoDB:', config.mongodb.database);

    const db = client.db(config.mongodb.database);
    const col = db.collection('system_config');

    const existing = await col.findOne({ _id: 'main' });

    if (existing && !FORCE) {
      console.log(
        'system_config document already exists. Use --force to overwrite.\n' +
        'Current document:\n' +
        JSON.stringify(existing, null, 2)
      );
      return;
    }

    const doc = { _id: 'main', ...SEED, updatedAt: new Date() };

    await col.replaceOne({ _id: 'main' }, doc, { upsert: true });

    console.log(existing ? 'system_config overwritten.' : 'system_config seeded successfully.');
    console.log('\nStored document:\n' + JSON.stringify(doc, null, 2));
  } finally {
    await client.close();
  }
}

seed().catch(err => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
