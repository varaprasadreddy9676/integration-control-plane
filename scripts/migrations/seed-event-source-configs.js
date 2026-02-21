/**
 * Migration: Seed event_source_configs for existing orgs
 *
 * Run once to create per-org event source configs for all existing
 * organizations. New orgs should configure their own via the admin UI:
 *   PUT /api/v1/event-sources/:orgId
 *
 * Usage:
 *   node scripts/migrations/seed-event-source-configs.js
 *
 * For a different MySQL schema, edit columnMapping before running.
 */

const { MongoClient } = require('mongodb');
const configFile = require('../../backend/config.json');

const MONGODB_URI = configFile.mongodb?.uri || 'mongodb://localhost:27017/integration_gateway';
const DB_NAME     = configFile.mongodb?.database || 'integration_gateway';

// Edit this block to match the MySQL schema used by your existing orgs
const MYSQL_SOURCE_CONFIG = {
  useSharedPool: true,          // use the shared MySQL pool from config.json
  table: 'notification_queue',
  columnMapping: {
    id:        'id',
    orgId:     'entity_parent_rid',
    orgUnitId: 'entity_rid',
    eventType: 'transaction_type',
    payload:   'message',
    timestamp: 'created_at'
  }
};

async function run() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db(DB_NAME);

  const orgs = await db.collection('organizations').find({}, { projection: { orgId: 1 } }).toArray();
  console.log(`Found ${orgs.length} organizations`);

  let created = 0;
  let skipped = 0;

  for (const org of orgs) {
    const orgId = org.orgId;
    if (!orgId) continue;

    const existing = await db.collection('event_source_configs').findOne({ orgId });
    if (existing) {
      console.log(`  org ${orgId}: already has config (${existing.type}), skipping`);
      skipped++;
      continue;
    }

    await db.collection('event_source_configs').insertOne({
      orgId,
      type:     'mysql',
      config:   MYSQL_SOURCE_CONFIG,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    console.log(`  org ${orgId}: created mysql config`);
    created++;
  }

  console.log(`\nDone. Created: ${created}, Skipped: ${skipped}`);
  await client.close();
}

run().catch(err => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
