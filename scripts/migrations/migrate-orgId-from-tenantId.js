#!/usr/bin/env node
'use strict';

// Migration: backfill orgId from legacy tenantId where orgId is missing.
// Usage:
//   MONGODB_URI="mongodb://..." DB_NAME="medics" node scripts/migrations/migrate-orgId-from-tenantId.js
//   MONGODB_URI="mongodb://..." DB_NAME="medics" DRY_RUN=1 node scripts/migrations/migrate-orgId-from-tenantId.js

const { MongoClient } = require('mongodb');

const uri = process.env.MONGODB_URI;
const dbName = process.env.DB_NAME;
const dryRun = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';

if (!uri || !dbName) {
  console.error('Missing MONGODB_URI or DB_NAME env vars.');
  process.exit(1);
}

const collections = [
  'integration_configs',
  'integration_templates',
  'execution_logs',
  'delivery_attempts',
  'scheduled_integrations',
  'scheduled_job_logs',
  'lookups',
  'alert_center_logs',
  'processed_events',
  'event_audit',
  'ai_interactions',
  'source_checkpoints',
  'ui_config',
  'system_config'
];

async function migrateCollection(db, name) {
  const col = db.collection(name);
  const filter = {
    orgId: { $exists: false },
    tenantId: { $exists: true, $ne: null }
  };

  const toUpdate = await col.countDocuments(filter);
  if (!toUpdate) {
    console.log(`${name}: no documents to update`);
    return { name, matched: 0, modified: 0 };
  }

  if (dryRun) {
    console.log(`${name}: ${toUpdate} documents would be updated`);
    return { name, matched: toUpdate, modified: 0 };
  }

  const result = await col.updateMany(
    filter,
    [{ $set: { orgId: '$tenantId' } }]
  );
  console.log(`${name}: matched=${result.matchedCount} modified=${result.modifiedCount}`);
  return { name, matched: result.matchedCount, modified: result.modifiedCount };
}

async function main() {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
  try {
    await client.connect();
    const db = client.db(dbName);

    console.log(`Starting orgId backfill${dryRun ? ' (dry run)' : ''}...`);
    for (const name of collections) {
      // eslint-disable-next-line no-await-in-loop
      await migrateCollection(db, name);
    }

    console.log('Done.');
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
