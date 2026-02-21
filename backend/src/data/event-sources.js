/**
 * Event Source Data Layer
 *
 * MongoDB operations for:
 *   - event_source_configs: per-org event source configuration
 *   - pending_events: queue for HTTP push events
 */

const mongodb = require('../mongodb');
const { log } = require('../logger');

const CONFIGS_COLLECTION = 'event_source_configs';
const PENDING_COLLECTION = 'pending_events';

// ---------------------------------------------------------------------------
// event_source_configs
// ---------------------------------------------------------------------------

/**
 * List all active event source configs.
 * @returns {Promise<Array>}
 */
async function listActiveConfigs() {
  const db = await mongodb.getDbSafe();
  return db.collection(CONFIGS_COLLECTION).find({ isActive: true }).toArray();
}

/**
 * Get config for a specific org.
 * @param {number} orgId
 * @returns {Promise<Object|null>}
 */
async function getConfigForOrg(orgId) {
  const db = await mongodb.getDbSafe();
  return db.collection(CONFIGS_COLLECTION).findOne({ orgId, isActive: true });
}

/**
 * Upsert an event source config for an org.
 * @param {number} orgId
 * @param {Object} config - { type, config: {...} }
 * @returns {Promise<Object>}
 */
async function upsertConfig(orgId, { type, config: sourceConfig = {} }) {
  const db = await mongodb.getDbSafe();
  const now = new Date();
  const result = await db.collection(CONFIGS_COLLECTION).findOneAndUpdate(
    { orgId },
    {
      $set: { type, config: sourceConfig, isActive: true, updatedAt: now },
      $setOnInsert: { orgId, createdAt: now }
    },
    { upsert: true, returnDocument: 'after' }
  );
  return result;
}

/**
 * Deactivate (soft-delete) an event source config for an org.
 * @param {number} orgId
 */
async function deactivateConfig(orgId) {
  const db = await mongodb.getDbSafe();
  await db.collection(CONFIGS_COLLECTION).updateOne(
    { orgId },
    { $set: { isActive: false, updatedAt: new Date() } }
  );
}

// ---------------------------------------------------------------------------
// pending_events  (HTTP Push queue)
// ---------------------------------------------------------------------------

/**
 * Enqueue a push event.
 * @param {Object} event - { orgId, eventType, payload, source }
 * @returns {Promise<string>} eventId
 */
async function enqueuePushEvent(event) {
  const db = await mongodb.getDbSafe();
  const doc = {
    orgId: event.orgId,
    eventId: event.eventId,
    event_type: event.eventType,
    payload: event.payload,
    source: event.source || 'http_push',
    status: 'pending',
    createdAt: new Date()
  };
  const result = await db.collection(PENDING_COLLECTION).insertOne(doc);
  log('debug', 'Enqueued push event', { eventId: event.eventId, orgId: event.orgId });
  return result.insertedId.toString();
}

/**
 * Claim a batch of pending events for an org (atomic).
 * Marks claimed events as 'processing' to prevent double-processing.
 * @param {number} orgId
 * @param {number} batchSize
 * @returns {Promise<Array>}
 */
async function claimPendingEvents(orgId, batchSize = 10) {
  const db = await mongodb.getDbSafe();
  const now = new Date();
  const claimed = [];

  // Claim one at a time to avoid race conditions without transactions
  for (let i = 0; i < batchSize; i++) {
    const doc = await db.collection(PENDING_COLLECTION).findOneAndUpdate(
      { orgId, status: 'pending' },
      { $set: { status: 'processing', claimedAt: now } },
      { sort: { createdAt: 1 }, returnDocument: 'after' }
    );
    if (!doc) break;
    claimed.push(doc);
  }

  return claimed;
}

/**
 * Mark a pending event as done.
 * @param {import('mongodb').ObjectId|string} id - MongoDB _id
 */
async function markPendingEventDone(id) {
  const db = await mongodb.getDbSafe();
  await db.collection(PENDING_COLLECTION).updateOne(
    { _id: mongodb.toObjectId(id) },
    { $set: { status: 'done', completedAt: new Date() } }
  );
}

/**
 * Mark a pending event as failed (so it can be retried or inspected).
 * @param {import('mongodb').ObjectId|string} id
 * @param {string} errorMessage
 */
async function markPendingEventFailed(id, errorMessage) {
  const db = await mongodb.getDbSafe();
  await db.collection(PENDING_COLLECTION).updateOne(
    { _id: mongodb.toObjectId(id) },
    { $set: { status: 'failed', failedAt: new Date(), errorMessage } }
  );
}

/**
 * Reset stale 'processing' events back to 'pending' (crash recovery).
 * Events stuck in 'processing' for > staleAfterMs are reset.
 * @param {number} staleAfterMs - default 5 minutes
 */
async function resetStalePendingEvents(staleAfterMs = 5 * 60 * 1000) {
  const db = await mongodb.getDbSafe();
  const staleThreshold = new Date(Date.now() - staleAfterMs);
  const result = await db.collection(PENDING_COLLECTION).updateMany(
    { status: 'processing', claimedAt: { $lt: staleThreshold } },
    { $set: { status: 'pending', claimedAt: null } }
  );
  if (result.modifiedCount > 0) {
    log('info', 'Reset stale pending events', { count: result.modifiedCount });
  }
  return result.modifiedCount;
}

module.exports = {
  // event_source_configs
  listActiveConfigs,
  getConfigForOrg,
  upsertConfig,
  deactivateConfig,

  // pending_events
  enqueuePushEvent,
  claimPendingEvents,
  markPendingEventDone,
  markPendingEventFailed,
  resetStalePendingEvents,
};
