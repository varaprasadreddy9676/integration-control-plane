#!/usr/bin/env node
'use strict';

// Migration: rebuild MongoDB indexes after orgId-only transition.
// Usage:
//   MONGODB_URI="mongodb://..." DB_NAME="medics" node scripts/migrations/rebuild-org-indexes.js
//   MONGODB_URI="mongodb://..." DB_NAME="medics" DRY_RUN=1 node scripts/migrations/rebuild-org-indexes.js

const { MongoClient } = require('mongodb');

const uri = process.env.MONGODB_URI;
const dbName = process.env.DB_NAME;
const dryRun = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';

if (!uri || !dbName) {
  console.error('Missing MONGODB_URI or DB_NAME env vars.');
  process.exit(1);
}

const drops = [
  { collection: 'integration_configs', index: 'entity_event_idx' },
  { collection: 'integration_configs', index: 'entity_active_idx' },
  { collection: 'integration_configs', index: 'tenant_direction_idx' },
  { collection: 'delivery_attempts', index: 'entity_attempted_idx' },
  { collection: 'processed_events', index: 'entity_event_idx' },
  { collection: 'integration_templates', index: 'entity_category_idx' },
  { collection: 'integration_templates', index: 'entity_updated_idx' },
  { collection: 'alert_center_logs', index: 'alert_entity_created_idx' },
  { collection: 'scheduled_job_logs', index: 'entity_started_idx' },
  { collection: 'execution_logs', index: 'entity_created_idx' },
  { collection: 'execution_logs', index: 'entity_direction_idx' },
  { collection: 'execution_logs', index: 'entity_status_idx' }
];

const creates = [
  {
    collection: 'integration_configs',
    indexes: [
      { key: { orgId: 1, type: 1 }, name: 'org_event_idx' },
      { key: { orgId: 1, isActive: 1 }, name: 'org_active_idx' },
      { key: { orgId: 1, direction: 1 }, name: 'org_direction_idx' },
      { key: { isActive: 1 }, name: 'active_idx' },
      { key: { updatedAt: -1 }, name: 'updated_idx' },
      { key: { 'outgoingAuthConfig._tokenExpiresAt': 1 }, name: 'token_expiry_idx', sparse: true }
    ]
  },
  {
    collection: 'delivery_attempts',
    indexes: [
      { key: { deliveryLogId: 1, attemptNumber: 1 }, name: 'log_attempt_idx' },
      { key: { orgId: 1, attemptedAt: -1 }, name: 'org_attempted_idx' },
      { key: { __KEEP___KEEP_integrationConfig__Id__: 1, attemptedAt: -1 }, name: 'integration_attempted_idx' },
      { key: { status: 1, attemptedAt: -1 }, name: 'status_attempted_idx' },
      { key: { attemptedAt: 1 }, expireAfterSeconds: 7776000, name: 'ttl_idx' }
    ]
  },
  {
    collection: 'processed_events',
    indexes: [
      { key: { eventKey: 1 }, unique: true, name: 'event_key_unique_idx' },
      { key: { eventId: 1 }, unique: true, sparse: true, name: 'event_id_unique_idx' },
      { key: { orgId: 1, eventType: 1 }, name: 'org_event_idx' },
      { key: { processedAt: 1 }, expireAfterSeconds: 21600, name: 'ttl_idx' }
    ]
  },
  {
    collection: 'integration_templates',
    indexes: [
      { key: { orgId: 1, category: 1 }, name: 'org_category_idx' },
      { key: { orgId: 1, updatedAt: -1 }, name: 'org_updated_idx' },
      { key: { category: 1 }, name: 'category_idx' },
      { key: { isActive: 1 }, name: 'active_idx' }
    ]
  },
  {
    collection: 'alert_center_logs',
    indexes: [
      { key: { orgId: 1, createdAt: -1 }, name: 'alert_org_created_idx' },
      { key: { status: 1, createdAt: -1 }, name: 'alert_status_created_idx' },
      { key: { channel: 1, createdAt: -1 }, name: 'alert_channel_created_idx' },
      { key: { type: 1, createdAt: -1 }, name: 'alert_type_created_idx' },
      { key: { createdAt: 1 }, expireAfterSeconds: 7776000, name: 'alert_ttl_idx' }
    ]
  },
  {
    collection: 'lookups',
    indexes: [
      {
        key: { orgId: 1, orgUnitRid: 1, type: 1, 'source.id': 1, isActive: 1 },
        name: 'idx_unique_mapping',
        unique: true,
        partialFilterExpression: { isActive: true }
      },
      {
        key: { orgId: 1, orgUnitRid: 1, type: 1, 'source.id': 1, isActive: 1 },
        name: 'idx_lookup'
      },
      {
        key: { orgId: 1, orgUnitRid: 1, type: 1, 'target.id': 1, isActive: 1 },
        name: 'idx_reverse_lookup'
      },
      { key: { orgId: 1, type: 1, category: 1, isActive: 1 }, name: 'idx_list' },
      {
        key: {
          'source.id': 'text',
          'source.name': 'text',
          'target.id': 'text',
          'target.name': 'text'
        },
        name: 'idx_text_search'
      }
    ]
  },
  {
    collection: 'scheduled_job_logs',
    indexes: [
      { key: { orgId: 1, startedAt: -1 }, name: 'org_started_idx' },
      { key: { integrationId: 1, startedAt: -1 }, name: 'job_started_idx' },
      { key: { status: 1, startedAt: -1 }, name: 'status_started_idx' },
      { key: { correlationId: 1 }, name: 'correlation_idx' },
      { key: { startedAt: 1 }, expireAfterSeconds: 7776000, name: 'ttl_idx' }
    ]
  },
  {
    collection: 'execution_logs',
    indexes: [
      { key: { orgId: 1, createdAt: -1 }, name: 'org_created_idx' },
      { key: { orgId: 1, direction: 1, createdAt: -1 }, name: 'org_direction_idx' },
      { key: { orgId: 1, status: 1, createdAt: -1 }, name: 'org_status_idx' },
      { key: { __KEEP___KEEP_integrationConfig__Id__: 1, createdAt: -1 }, name: 'integration_created_idx' },
      { key: { traceId: 1 }, name: 'trace_idx' },
      { key: { createdAt: 1 }, expireAfterSeconds: 7776000, name: 'ttl_idx' }
    ]
  },
  {
    collection: 'ai_interactions',
    indexes: [
      { key: { orgId: 1, createdAt: -1 }, name: 'entity_created_idx' },
      { key: { operation: 1, createdAt: -1 }, name: 'operation_created_idx' },
      { key: { success: 1, createdAt: -1 }, name: 'success_created_idx' },
      { key: { createdAt: 1 }, expireAfterSeconds: 7776000, name: 'ttl_idx' }
    ]
  },
  {
    collection: 'event_audit',
    indexes: [
      {
        key: { source: 1, sourceId: 1 },
        name: 'source_id_unique_idx',
        unique: true,
        partialFilterExpression: { sourceId: { $exists: true, $ne: null } }
      },
      { key: { orgId: 1, eventKey: 1, receivedAtBucket: 1 }, name: 'fallback_unique_idx', unique: true },
      { key: { orgId: 1, receivedAt: -1 }, name: 'parent_received_idx' },
      { key: { orgId: 1, status: 1, receivedAt: -1 }, name: 'parent_status_received_idx' },
      { key: { orgId: 1, eventType: 1, receivedAt: -1 }, name: 'parent_event_received_idx' },
      { key: { orgId: 1, source: 1, receivedAt: -1 }, name: 'parent_source_received_idx' },
      { key: { orgId: 1, skipCategory: 1, receivedAt: -1 }, name: 'parent_skip_received_idx' },
      { key: { status: 1, processingStartedAt: 1 }, name: 'status_processing_idx' },
      { key: { eventId: 1 }, name: 'event_id_idx' },
      { key: { orgId: 1, eventId: 1 }, name: 'parent_event_id_idx' },
      { key: { expiresAt: 1 }, expireAfterSeconds: 0, name: 'ttl_idx' }
    ]
  },
  {
    collection: 'source_checkpoints',
    indexes: [
      { key: { source: 1, sourceIdentifier: 1, orgId: 1 }, name: 'source_entity_unique_idx', unique: true },
      { key: { updatedAt: -1 }, name: 'updated_idx' },
      { key: { orgId: 1, source: 1 }, name: 'entity_source_idx' }
    ]
  },
  {
    collection: 'users',
    indexes: [
      { key: { email: 1 }, name: 'email_unique_idx', unique: true },
      { key: { orgId: 1, role: 1 }, name: 'org_role_idx' },
      { key: { isActive: 1 }, name: 'active_idx' }
    ]
  },
  {
    collection: 'organizations',
    indexes: [
      { key: { orgId: 1 }, name: 'org_id_unique_idx', unique: true },
      { key: { name: 1 }, name: 'org_name_idx' }
    ]
  },
  {
    collection: 'org_units',
    indexes: [
      { key: { rid: 1 }, name: 'unit_rid_unique_idx', unique: true },
      { key: { orgId: 1 }, name: 'unit_org_idx' }
    ]
  }
];

async function dropIndexIfExists(db, entry) {
  const col = db.collection(entry.collection);
  const indexes = await col.indexes();
  const found = indexes.find((idx) => idx.name === entry.index);
  if (!found) {
    console.log(`${entry.collection}: index ${entry.index} not found`);
    return;
  }
  if (dryRun) {
    console.log(`${entry.collection}: would drop index ${entry.index}`);
    return;
  }
  await col.dropIndex(entry.index);
  console.log(`${entry.collection}: dropped index ${entry.index}`);
}

async function dropLegacyIndexes(db, collectionName) {
  const col = db.collection(collectionName);
  const indexes = await col.indexes();
  const candidates = indexes.filter((idx) => {
    if (idx.name === '_id_') return false;
    const key = idx.key || {};
    return Object.prototype.hasOwnProperty.call(key, 'tenantId') ||
      Object.prototype.hasOwnProperty.call(key, 'entityRid') ||
      Object.prototype.hasOwnProperty.call(key, 'entityParentRid');
  });

  if (!candidates.length) return;

  for (const idx of candidates) {
    if (dryRun) {
      console.log(`${collectionName}: would drop legacy index ${idx.name}`);
      continue;
    }
    await col.dropIndex(idx.name);
    console.log(`${collectionName}: dropped legacy index ${idx.name}`);
  }
}

async function createIndexes(db, entry) {
  const col = db.collection(entry.collection);
  if (dryRun) {
    const names = entry.indexes.map((idx) => idx.name).join(', ');
    console.log(`${entry.collection}: would create indexes [${names}]`);
    return;
  }
  await col.createIndexes(entry.indexes);
  console.log(`${entry.collection}: created indexes`);
}

async function main() {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
  try {
    await client.connect();
    const db = client.db(dbName);

    console.log(`Starting index rebuild${dryRun ? ' (dry run)' : ''}...`);
    for (const entry of drops) {
      // eslint-disable-next-line no-await-in-loop
      await dropIndexIfExists(db, entry);
    }
    for (const entry of creates) {
      // eslint-disable-next-line no-await-in-loop
      await dropLegacyIndexes(db, entry.collection);
    }
    for (const entry of creates) {
      // eslint-disable-next-line no-await-in-loop
      await createIndexes(db, entry);
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
