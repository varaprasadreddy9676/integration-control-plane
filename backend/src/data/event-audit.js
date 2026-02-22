'use strict';
const crypto = require('crypto');
const { log, logError } = require('../logger');
const mongodb = require('../mongodb');
const config = require('../config');
const {
  useMongo,
  normalizeOrgId,
  fallbackDisabledError
} = require('./helpers');

/**
 * Save processed event to MongoDB for duplicate prevention
 * Uses TTL index to auto-expire after 6 hours
 *
 * @param {string} eventKey - Legacy unique event key (for backward compatibility)
 * @param {number|string} mysqlEventId - Event ID from notification_queue
 * @param {string} eventType - Event type
 * @param {number} orgId - Organization ID
 * @param {string} stableEventId - Stable event ID (orgId-eventType-id)
 * @returns {Promise<boolean>} - True if saved successfully, false if duplicate
 */
async function saveProcessedEvent(eventKey, mysqlEventId, eventType, orgId, stableEventId = null) {
  const normalizedOrgId = normalizeOrgId(orgId);
  if (!normalizedOrgId) return true;

  if (!useMongo()) {
    return true; // Skip MongoDB if not enabled
  }

  try {
    const db = await mongodb.getDbSafe();

    const doc = {
      eventKey,
      eventId: stableEventId || eventKey, // Use stable eventId if provided
      mysqlEventId,
      eventType,
      orgId: normalizedOrgId,
      processedAt: new Date(),
      expiresAt: new Date(Date.now() + 6 * 60 * 60 * 1000) // Expires in 6 hours
    };

    await db.collection('processed_events').insertOne(doc);
    return true;
  } catch (err) {
    // Duplicate key error (E11000) is expected if event was already processed
    if (err.code === 11000) {
      log('debug', 'Event already processed (duplicate key)', {
        eventKey,
        eventId: stableEventId
      });
      return false;
    }
    logError(err, { scope: 'saveProcessedEvent', eventKey, eventId: stableEventId });
    return true; // Don't block processing on DB errors
  }
}

/**
 * Check if event has already been processed
 * Checks both legacy eventKey and new stable eventId
 *
 * @param {string} eventKeyOrId - Event key or stable event ID
 * @param {string} stableEventId - Optional stable event ID
 * @returns {Promise<boolean>} - True if already processed, false otherwise
 */
async function isEventAlreadyProcessed(eventKeyOrId, stableEventId = null) {
  if (!useMongo()) {
    return false; // Skip check if MongoDB not enabled
  }

  try {
    const db = await mongodb.getDbSafe();

    // Check both eventKey (legacy) and eventId (new stable ID)
    const query = {
      $or: [
        { eventKey: eventKeyOrId },
        { eventId: eventKeyOrId }
      ]
    };

    // If stable eventId provided, also check that
    if (stableEventId && stableEventId !== eventKeyOrId) {
      query.$or.push({ eventId: stableEventId });
    }

    const doc = await db.collection('processed_events').findOne(query);
    return !!doc;
  } catch (err) {
    logError(err, {
      scope: 'isEventAlreadyProcessed',
      eventKey: eventKeyOrId,
      eventId: stableEventId
    });
    return false; // Don't block processing on DB errors
  }
}

/**
 * Create event audit record (with uniqueness safety)
 */
async function recordEventAudit(auditData) {
  if (!useMongo()) {
    return fallbackDisabledError('recordEventAudit:mongo');
  }

  try {
    const db = await mongodb.getDbSafe();
    const retentionDays = config.eventAudit?.retentionDays || 90;

    const doc = {
      ...auditData,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + retentionDays * 24 * 60 * 60 * 1000)
    };

    const result = await db.collection('event_audit').insertOne(doc);
    return result.insertedId;
  } catch (err) {
    // Handle duplicate key error gracefully
    if (err.code === 11000) {
      log('warn', 'Duplicate event audit record', {
        source: auditData.source,
        sourceId: auditData.sourceId,
        eventKey: auditData.eventKey
      });

      // Return existing record ID
      const db = await mongodb.getDbSafe();
      const hasSourceId = auditData.sourceId !== undefined && auditData.sourceId !== null;
      const existing = hasSourceId
        ? await db.collection('event_audit').findOne({
          source: auditData.source,
          sourceId: auditData.sourceId
        })
        : await db.collection('event_audit').findOne({
          orgId: auditData.orgId,
          eventKey: auditData.eventKey,
          receivedAtBucket: auditData.receivedAtBucket
        });
      return existing?._id;
    }

    logError(err, { scope: 'recordEventAudit', auditData });
    throw err;
  }
}

/**
 * Update event audit record (supports timeline append)
 */
async function updateEventAudit(eventId, updates) {
  if (!useMongo()) {
    return fallbackDisabledError('updateEventAudit:mongo');
  }

  try {
    const db = await mongodb.getDbSafe();

    // Separate timeline updates from field updates
    const { timeline, timelinePush, ...fieldUpdates } = updates;

    const updateDoc = {
      $set: { ...fieldUpdates, updatedAt: new Date() }
    };

    const timelineEntry = timelinePush || timeline;
    if (timelineEntry) {
      updateDoc.$push = {
        timeline: Array.isArray(timelineEntry) ? { $each: timelineEntry } : timelineEntry
      };
    }

    await db.collection('event_audit').updateOne(
      { eventId },
      updateDoc
    );

    return true;
  } catch (err) {
    logError(err, { scope: 'updateEventAudit', eventId, updates });
    throw err;
  }
}

/**
 * List events (audit trail) - MUST use orgId
 */
async function listEventAudit(orgId, filters = {}) {
  if (!useMongo()) {
    return fallbackDisabledError('listEventAudit:mongo');
  }

  try {
    const db = await mongodb.getDbSafe();
    const query = { orgId }; // CRITICAL: tenant scoping

    if (filters.status) query.status = filters.status;
    if (filters.eventType) query.eventType = filters.eventType;
    if (filters.skipCategory) query.skipCategory = filters.skipCategory;
    if (filters.source) query.source = filters.source;

    // Date range
    if (filters.startDate || filters.endDate) {
      query.receivedAt = {};
      if (filters.startDate) query.receivedAt.$gte = new Date(filters.startDate);
      if (filters.endDate) query.receivedAt.$lte = new Date(filters.endDate);
    }

    // Search (event ID, source ID, or payload summary fields)
    if (filters.search) {
      query.$or = [
        { eventId: { $regex: filters.search, $options: 'i' } },
        { sourceId: { $regex: filters.search, $options: 'i' } },
        { 'payloadSummary.patientRid': parseInt(filters.search) || 0 }
      ];
    }

    const limit = filters.limit || 50;
    const page = filters.page || 1;

    const events = await db.collection('event_audit')
      .find(query)
      .sort({ receivedAt: -1 })
      .limit(limit)
      .skip((page - 1) * limit)
      .toArray();

    const total = await db.collection('event_audit').countDocuments(query);

    return {
      events,
      total,
      pages: Math.ceil(total / limit),
      page
    };
  } catch (err) {
    logError(err, { scope: 'listEventAudit', orgId, filters });
    throw err;
  }
}

/**
 * Get event audit by ID (with tenant check)
 */
async function getEventAuditById(orgId, eventId) {
  if (!useMongo()) {
    return fallbackDisabledError('getEventAuditById:mongo');
  }

  try {
    const db = await mongodb.getDbSafe();
    return db.collection('event_audit').findOne({
      orgId, // CRITICAL: prevent cross-tenant access
      eventId
    });
  } catch (err) {
    logError(err, { scope: 'getEventAuditById', orgId, eventId });
    throw err;
  }
}

/**
 * Get event audit statistics (with delivery metrics)
 */
async function getEventAuditStats(orgId, hoursBack = 24) {
  if (!useMongo()) {
    return fallbackDisabledError('getEventAuditStats:mongo');
  }

  try {
    const db = await mongodb.getDbSafe();
    const startDate = new Date(Date.now() - hoursBack * 60 * 60 * 1000);

    const stats = await db.collection('event_audit').aggregate([
      { $match: { orgId, receivedAt: { $gte: startDate } } },
      {
        $group: {
          _id: null,
          totalReceived: { $sum: 1 },
          delivered: {
            $sum: {
              $cond: [{ $eq: ['$status', 'DELIVERED'] }, 1, 0]
            }
          },
          skipped: {
            $sum: {
              $cond: [{ $eq: ['$status', 'SKIPPED'] }, 1, 0]
            }
          },
          failed: {
            $sum: {
              $cond: [{ $eq: ['$status', 'FAILED'] }, 1, 0]
            }
          },
          stuck: {
            $sum: {
              $cond: [{ $eq: ['$status', 'STUCK'] }, 1, 0]
            }
          },
          avgProcessingTimeMs: { $avg: '$processingTimeMs' },
          avgIntegrationsMatched: { $avg: '$deliveryStatus.integrationsMatched' },
          avgDeliveredCount: { $avg: '$deliveryStatus.deliveredCount' },
          avgFailedCount: { $avg: '$deliveryStatus.failedCount' }
        }
      }
    ]).toArray();

    // Get skip reasons breakdown
    const skipReasons = await db.collection('event_audit').aggregate([
      {
        $match: {
          orgId,
          receivedAt: { $gte: startDate },
          status: 'SKIPPED'
        }
      },
      { $group: { _id: '$skipCategory', count: { $sum: 1 } } }
    ]).toArray();

    // Get duplicate type breakdown
    const duplicateTypes = await db.collection('event_audit').aggregate([
      {
        $match: {
          orgId,
          receivedAt: { $gte: startDate },
          skipCategory: 'DUPLICATE'
        }
      },
      { $group: { _id: '$duplicateType', count: { $sum: 1 } } }
    ]).toArray();

    // Get source breakdown
    const bySource = await db.collection('event_audit').aggregate([
      { $match: { orgId, receivedAt: { $gte: startDate } } },
      { $group: { _id: '$source', count: { $sum: 1 } } }
    ]).toArray();

    // Get event type breakdown
    const byEventType = await db.collection('event_audit').aggregate([
      { $match: { orgId, receivedAt: { $gte: startDate } } },
      { $group: { _id: '$eventType', count: { $sum: 1 } } }
    ]).toArray();

    // Calculate processing time percentiles
    const processingTimes = await db.collection('event_audit')
      .find(
        { orgId, receivedAt: { $gte: startDate }, processingTimeMs: { $exists: true } },
        { projection: { processingTimeMs: 1 } }
      )
      .sort({ processingTimeMs: 1 })
      .toArray();

    const p50 = processingTimes[Math.floor(processingTimes.length * 0.5)]?.processingTimeMs || 0;
    const p95 = processingTimes[Math.floor(processingTimes.length * 0.95)]?.processingTimeMs || 0;
    const p99 = processingTimes[Math.floor(processingTimes.length * 0.99)]?.processingTimeMs || 0;

    const result = stats[0] || {
      totalReceived: 0,
      delivered: 0,
      skipped: 0,
      failed: 0,
      stuck: 0,
      avgProcessingTimeMs: 0,
      avgIntegrationsMatched: 0,
      avgDeliveredCount: 0,
      avgFailedCount: 0
    };

    return {
      ...result,
      skipReasons: Object.fromEntries(skipReasons.map(r => [r._id, r.count])),
      duplicateTypes: Object.fromEntries(duplicateTypes.map(r => [r._id, r.count])),
      bySource: Object.fromEntries(bySource.map(r => [r._id, r.count])),
      byEventType: Object.fromEntries(byEventType.map(r => [r._id, r.count])),
      processingMetrics: {
        avgProcessingTimeMs: result.avgProcessingTimeMs || 0,
        p50ProcessingTimeMs: p50,
        p95ProcessingTimeMs: p95,
        p99ProcessingTimeMs: p99
      },
      deliveryMetrics: {
        avgIntegrationsMatched: result.avgIntegrationsMatched || 0,
        avgDeliveredCount: result.avgDeliveredCount || 0,
        avgFailedCount: result.avgFailedCount || 0,
        successRate: result.avgIntegrationsMatched > 0
          ? result.avgDeliveredCount / result.avgIntegrationsMatched
          : 0
      }
    };
  } catch (err) {
    logError(err, { scope: 'getEventAuditStats', orgId, hoursBack });
    throw err;
  }
}

/**
 * Update source checkpoint (for gap detection)
 */
async function updateSourceCheckpoint(checkpointData) {
  if (!useMongo()) {
    return fallbackDisabledError('updateSourceCheckpoint:mongo');
  }

  try {
    const db = await mongodb.getDbSafe();
    const { source, sourceIdentifier, orgId, lastProcessedId, lastProcessedAt } = checkpointData;

    const existing = await db.collection('source_checkpoints').findOne({
      source,
      sourceIdentifier,
      orgId
    });

    // Update or insert checkpoint
    await db.collection('source_checkpoints').updateOne(
      { source, sourceIdentifier, orgId },
      {
        $set: {
          lastProcessedId,
          lastProcessedAt,
          updatedAt: new Date()
        },
        $inc: { eventsProcessedLast5Min: 1 }
      },
      { upsert: true }
    );

    // Detect gaps for sequential sources (MySQL, Kafka offset)
    if (isSequentialSource(source)) {
      const previousId = existing?.lastProcessedId;
      await detectGaps(source, sourceIdentifier, orgId, lastProcessedId, previousId);
    }

    return true;
  } catch (err) {
    logError(err, { scope: 'updateSourceCheckpoint', checkpointData });
    throw err;
  }
}

/**
 * Detect gaps in sequential sources
 */
async function detectGaps(source, sourceIdentifier, orgId, currentId, previousIdOverride) {
  if (!useMongo()) {
    return fallbackDisabledError('detectGaps:mongo');
  }

  try {
    const db = await mongodb.getDbSafe();

    const prevIdRaw = previousIdOverride !== undefined && previousIdOverride !== null
      ? previousIdOverride
      : (await db.collection('source_checkpoints').findOne({
        source,
        sourceIdentifier,
        orgId
      }))?.lastProcessedId;

    if (!prevIdRaw) return;

    const prevId = parseInt(prevIdRaw);
    const currId = parseInt(currentId);

    // Gap detected (difference > 1 for sequential IDs)
    if (currId - prevId > 1) {
      const gap = {
        start: prevId + 1,
        end: currId - 1,
        detectedAt: new Date()
      };

      log('warn', 'Gap detected in event source', {
        source,
        sourceIdentifier,
        orgId,
        gap
      });

      // Store gap
      await db.collection('source_checkpoints').updateOne(
        { source, sourceIdentifier, orgId },
        { $push: { detectedGaps: gap } }
      );
    }

    return true;
  } catch (err) {
    logError(err, { scope: 'detectGaps', source, sourceIdentifier, orgId, currentId });
    throw err;
  }
}

/**
 * Get source checkpoints (for API)
 */
async function getSourceCheckpoints(orgId) {
  if (!useMongo()) {
    return fallbackDisabledError('getSourceCheckpoints:mongo');
  }

  try {
    const db = await mongodb.getDbSafe();

    const checkpoints = await db.collection('source_checkpoints')
      .find({ orgId })
      .toArray();

    // Add health status
    const now = Date.now();
    return checkpoints.map(cp => ({
      ...cp,
      health: {
        eventsProcessedLast5Min: cp.eventsProcessedLast5Min || 0,
        lastHealthCheckAt: cp.updatedAt,
        isHealthy: now - cp.updatedAt.getTime() < 60 * 1000, // Healthy if updated < 1 min ago
        lag: cp.lastProcessedAt ? formatLag(now - cp.lastProcessedAt.getTime()) : 'unknown'
      }
    }));
  } catch (err) {
    logError(err, { scope: 'getSourceCheckpoints', orgId });
    throw err;
  }
}

/**
 * Get gaps for a specific source
 */
async function getSourceGaps(orgId, source, hoursBack = 24) {
  if (!useMongo()) {
    return fallbackDisabledError('getSourceGaps:mongo');
  }

  try {
    const db = await mongodb.getDbSafe();
    const startDate = new Date(Date.now() - hoursBack * 60 * 60 * 1000);

    const checkpoint = await db.collection('source_checkpoints').findOne({
      orgId,
      source
    });

    if (!checkpoint) {
      return {
        source,
        isSequential: false,
        totalGaps: 0,
        gaps: []
      };
    }

    // Filter gaps within time window
    const recentGaps = (checkpoint.detectedGaps || []).filter(
      gap => gap.detectedAt >= startDate
    );

    return {
      source,
      sourceIdentifier: checkpoint.sourceIdentifier,
      isSequential: checkpoint.isSequential !== false,
      totalGaps: recentGaps.length,
      gaps: recentGaps.map(gap => ({
        ...gap,
        count: gap.end - gap.start + 1
      }))
    };
  } catch (err) {
    logError(err, { scope: 'getSourceGaps', orgId, source, hoursBack });
    throw err;
  }
}

// ========================
// Helper Functions
// ========================

/**
 * Check if source has sequential IDs (can detect gaps)
 */
function isSequentialSource(source) {
  return ['mysql', 'kafka'].includes(source);
}

/**
 * Format lag duration in human-readable format
 */
function formatLag(ms) {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return 'unknown';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${Math.floor(ms / 1000)}s`;
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m`;
  return `${Math.floor(ms / 3600000)}h`;
}

/**
 * Hash payload for verification
 */
function hashPayload(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

/**
 * Extract compliance-safe payload fields (allowlist)
 */
function extractSafePayload(payload) {
  const allowedFields = config.eventAudit?.allowedSummaryFields || [
    'patientRid',
    'appointmentId',
    'orgId',
    'orgUnitRid',
    'billId',
    'eventType',
    'timestamp'
  ];

  const safe = {};
  for (const field of allowedFields) {
    if (payload && payload[field] !== undefined) {
      safe[field] = payload[field];
    }
  }
  return safe;
}

/**
 * Bucket timestamp for fallback uniqueness (5-minute buckets)
 */
function getBucketTimestamp(date, minutes = 5) {
  const ms = date.getTime();
  const bucketMs = minutes * 60 * 1000;
  return new Date(Math.floor(ms / bucketMs) * bucketMs);
}

/**
 * Extract source-specific metadata from event
 */
function extractSourceMetadata(event, sourceType) {
  const metadata = {};

  if (sourceType === 'mysql') {
    metadata.table = 'notification_queue';
    if (event.org_unit_rid || event.entity_rid) metadata.orgUnitRid = event.org_unit_rid || event.entity_rid;
    if (event.entity_parent_rid) metadata.orgId = event.entity_parent_rid;
  } else if (sourceType === 'kafka') {
    if (event.topic) metadata.topic = event.topic;
    if (event.partition !== undefined) metadata.partition = event.partition;
    if (event.offset !== undefined) metadata.offset = event.offset;
  } else if (sourceType === 'sqs') {
    if (event.messageId) metadata.messageId = event.messageId;
    if (event.receiptHandle) metadata.receiptHandle = event.receiptHandle;
  }

  return metadata;
}

function resolveOrgIdFromEvent(event) {
  if (!event) return null;
  return normalizeOrgId(
    event.orgId ||
    event.entity_parent_rid
  );
}

/**
 * Get source identifier for checkpoint tracking
 */
function getSourceIdentifier(event, sourceType) {
  const type = sourceType || config.eventSource?.type || 'unknown';

  if (type === 'mysql') {
    return 'notification_queue';
  } else if (type === 'kafka') {
    return event.topic || 'integration-events';
  } else if (type === 'sqs') {
    return event.queueName || 'integration-queue';
  }

  return 'unknown';
}

/**
 * Get event type sample payload from event_types collection
 * @param {string} eventType - Event type identifier
 * @returns {Promise<Object|null>} Sample payload or null if not found
 */
async function getEventTypeSamplePayload(eventType, orgId) {
  try {
    const db = await mongodb.getDbSafe();
    const collection = db.collection('event_types');
    const projection = { projection: { samplePayload: 1 } };

    // Prefer org-specific doc, fall back to global template
    if (orgId) {
      const orgDoc = await collection.findOne(
        { $or: [{ type: eventType, orgId, isActive: true }, { eventType, orgId, isActive: true }] },
        projection
      );
      if (orgDoc?.samplePayload) return orgDoc.samplePayload;
    }

    // Global template fallback (also handles legacy docs without orgId field)
    const globalDoc = await collection.findOne(
      {
        $or: [
          { type: eventType, isActive: true },
          { eventType, isActive: true }
        ]
      },
      projection
    );

    if (globalDoc?.samplePayload) {
      log('debug', 'Event type sample payload retrieved', { eventType, hasSamplePayload: true });
      return globalDoc.samplePayload;
    }

    log('debug', 'Event type sample payload not found', { eventType });
    return null;
  } catch (err) {
    logError(err, { scope: 'getEventTypeSamplePayload', eventType });
    return null;
  }
}

module.exports = {
  saveProcessedEvent,
  isEventAlreadyProcessed,
  recordEventAudit,
  updateEventAudit,
  listEventAudit,
  getEventAuditById,
  getEventAuditStats,
  updateSourceCheckpoint,
  detectGaps,
  getSourceCheckpoints,
  getSourceGaps,
  isSequentialSource,
  formatLag,
  hashPayload,
  extractSafePayload,
  getBucketTimestamp,
  extractSourceMetadata,
  resolveOrgIdFromEvent,
  getSourceIdentifier,
  getEventTypeSamplePayload
};
