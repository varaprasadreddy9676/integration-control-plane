'use strict';
const { log, logError } = require('../logger');
const mongodb = require('../mongodb');
const {
  useMongo,
  normalizeOrgId,
  scheduledOrgQuery,
  fallbackDisabledError,
  mapScheduledIntegrationFromMongo
} = require('./helpers');

/**
 * Create a scheduled integration
 * @param {Object} data - Scheduled integration data
 * @returns {Promise<Object>} Created scheduled integration
 */
async function createScheduledIntegration(data) {
  if (!useMongo()) {
    throw new Error('MongoDB required for scheduled integrations');
  }

  try {
    const db = await mongodb.getDbSafe();
    const now = new Date();
    const integrationConfigId = data.__KEEP___KEEP_integrationConfig__Id__ || data.integrationConfigId || data.webhookConfigId;
    const integrationName = data.__KEEP_integrationName__ || data.integrationName || data.webhookName;
    const orgId = normalizeOrgId(data.orgId || data.orgUnitRid || data.entityRid);
    if (!orgId) throw new Error('orgId is required for scheduled integration');
    const integrationConfigObjectId = mongodb.toObjectId(integrationConfigId) || integrationConfigId;

    const scheduledForDate = new Date(data.scheduledFor);
    const status = scheduledForDate <= now ? 'OVERDUE' : 'PENDING';

    const scheduledIntegration = {
      __KEEP___KEEP_integrationConfig__Id__: integrationConfigObjectId,
      __KEEP_integrationName__: integrationName,
      integrationConfigId: integrationConfigObjectId,
      integrationName,
      webhookConfigId: integrationConfigObjectId,
      webhookName: integrationName,
      orgId,
      orgUnitRid: data.orgUnitRid || data.entityRid || orgId,
      originalEventId: data.originalEventId,
      eventType: data.eventType,
      scheduledFor: scheduledForDate, // Unix timestamp to Date
      status, // PENDING | SENT | FAILED | CANCELLED | OVERDUE
      payload: data.payload, // Pre-transformed payload ready to send
      originalPayload: data.originalPayload || data.payload, // CRITICAL: Store original payload for recurring integrations
      targetUrl: data.targetUrl,
      httpMethod: data.httpMethod,
      // Cancellation matching metadata
      cancellationInfo: data.cancellationInfo || null, // { patientRid, scheduledDateTime, ... }
      // Recurring integration metadata
      recurringConfig: data.recurringConfig || null, // { interval, count, endDate, occurrenceNumber }
      createdAt: now,
      updatedAt: now
    };

    const result = await db.collection('scheduled_integrations').insertOne(scheduledIntegration);
    scheduledIntegration._id = result.insertedId;

    log('info', 'Scheduled integration created', {
      id: result.insertedId.toString(),
      __KEEP_integrationName__: integrationName,
      scheduledFor: data.scheduledFor,
      eventType: data.eventType
    });

    return {
      id: result.insertedId.toString(),
      ...scheduledIntegration,
      scheduledFor: scheduledIntegration.scheduledFor.toISOString(),
      orgId: scheduledIntegration.orgId,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString()
    };
  } catch (err) {
    logError(err, { scope: 'createScheduledIntegration' });
    throw err;
  }
}

/**
 * List scheduled integrations with filters
 * @param {number} orgId - Entity parent RID
 * @param {Object} filters - Filter options
 * @returns {Promise<Array>} List of scheduled integrations
 */
async function listScheduledIntegrations(orgId, filters = {}) {
  const normalizedOrgId = normalizeOrgId(orgId);
  if (!normalizedOrgId) return [];

  if (useMongo()) {
    try {
      const db = await mongodb.getDbSafe();
      const query = scheduledOrgQuery(normalizedOrgId);

      if (filters.status) {
        query.status = filters.status;
      }
      if (filters.integrationConfigId || filters.__KEEP___KEEP_integrationConfig__Id__ || filters.webhookConfigId) {
        query.__KEEP___KEEP_integrationConfig__Id__ = mongodb.toObjectId(
          filters.integrationConfigId || filters.__KEEP___KEEP_integrationConfig__Id__ || filters.webhookConfigId
        );
      }
      if (filters.eventType) {
        query.eventType = filters.eventType;
      }

      // Add a time-based filter to only show upcoming or recently overdue events
      // Avoids loading the entire collection
      const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
      query.scheduledFor = { $gte: twoDaysAgo };

      const limit = filters.limit || 500;

      const integrations = await db.collection('scheduled_integrations')
        .find(query)
        .sort({ scheduledFor: 1 })
        .limit(limit)
        .toArray();

      return integrations.map(mapScheduledIntegrationFromMongo);
    } catch (err) {
      logError(err, { scope: 'listScheduledIntegrations', orgId, filters });
      throw err;
    }
  }
  return fallbackDisabledError('listScheduledIntegrations:fallback');
}

/**
 * Get pending scheduled integrations ready to be sent
 * @param {number} limit - Max number to fetch
 * @returns {Promise<Array>} Integrations ready to send
 */
async function getPendingScheduledIntegrations(limit = 10) {
  if (!useMongo()) {
    return [];
  }

  try {
    const db = await mongodb.getDbSafe();
    const now = new Date();
    const claimedIntegrations = [];

    // ATOMIC CLAIM: Use findOneAndUpdate to atomically claim each integration
    // This prevents race conditions where multiple worker cycles process the same integration
    for (let i = 0; i < limit; i++) {
      const result = await db.collection('scheduled_integrations')
        .findOneAndUpdate(
          {
            status: { $in: ['PENDING', 'OVERDUE'] },
            scheduledFor: { $lte: now }
          },
          {
            $set: {
              status: 'PROCESSING',
              processingStartedAt: new Date(),
              updatedAt: new Date()
            }
          },
          {
            sort: { scheduledFor: 1 },
            returnDocument: 'after'
          }
        );

      // No more pending integrations found
      // MongoDB findOneAndUpdate returns {value: document} structure
      if (!result || !result.value) {
        break;
      }

      const doc = result.value;
      claimedIntegrations.push({
        id: doc._id.toString(),
        integrationConfigId: doc.integrationConfigId?.toString() || doc.__KEEP___KEEP_integrationConfig__Id__?.toString(),
        webhookConfigId: doc.webhookConfigId?.toString?.() || doc.integrationConfigId?.toString() || doc.__KEEP___KEEP_integrationConfig__Id__?.toString(),
        __KEEP___KEEP_integrationConfig__Id__: doc.__KEEP___KEEP_integrationConfig__Id__?.toString() || doc.integrationConfigId?.toString(),
        integrationName: doc.integrationName || doc.__KEEP_integrationName__,
        webhookName: doc.webhookName || doc.integrationName || doc.__KEEP_integrationName__,
        __KEEP_integrationName__: doc.__KEEP_integrationName__,
        orgId: doc.orgId || doc.entityRid,
        orgUnitRid: doc.orgUnitRid || doc.entityRid || doc.orgId,
        originalEventId: doc.originalEventId,
        eventType: doc.eventType,
        scheduledFor: doc.scheduledFor.toISOString(),
        status: doc.status,
        payload: doc.payload,
        originalPayload: doc.originalPayload,
        targetUrl: doc.targetUrl,
        httpMethod: doc.httpMethod,
        recurringConfig: doc.recurringConfig,
        cancellationInfo: doc.cancellationInfo,
        createdAt: doc.createdAt?.toISOString(),
        attemptCount: doc.attemptCount || 0
      });
    }

    log('debug', `Atomically claimed ${claimedIntegrations.length} scheduled integrations`, {
      claimed: claimedIntegrations.length,
      requestedLimit: limit
    });

    return claimedIntegrations;
  } catch (err) {
    logError(err, { scope: 'getPendingScheduledIntegrations' });
    return [];
  }
}

/**
 * Update scheduled integration status
 * @param {string} id - Scheduled integration ID
 * @param {string} status - New status
 * @param {Object} details - Additional details (errorMessage, deliveredAt)
 * @returns {Promise<boolean>}
 */
async function updateScheduledIntegrationStatus(id, status, details = {}) {
  if (!useMongo()) {
    return false;
  }

  try {
    const db = await mongodb.getDbSafe();
    const updateDoc = {
      status,
      updatedAt: new Date()
    };

    if (details.errorMessage) {
      updateDoc.errorMessage = details.errorMessage;
    }
    if (details.deliveredAt) {
      updateDoc.deliveredAt = new Date(details.deliveredAt);
    }
    if (details.deliveryLogId) {
      updateDoc.deliveryLogId = details.deliveryLogId;
    }
    if (details.attemptCount !== undefined) {
      updateDoc.attemptCount = details.attemptCount;
    }
    // CRITICAL: Update scheduledFor when rescheduling with backoff
    if (details.scheduledFor) {
      updateDoc.scheduledFor = new Date(details.scheduledFor);
      log('debug', 'Rescheduling integration with backoff', {
        id,
        newScheduledFor: details.scheduledFor,
        attemptCount: details.attemptCount
      });
    }

    // SAFETY: Only update if currently in PROCESSING state (or PENDING/OVERDUE for cancellation)
    // This prevents race conditions where multiple workers try to update the same integration
    const query = { _id: mongodb.toObjectId(id) };

    // For SENT/FAILED, require current status to be PROCESSING
    // For CANCELLED, also allow PENDING/OVERDUE (for cancelling before delivery)
    // For PENDING (retry), require PROCESSING (already claimed by this worker)
    if (status === 'SENT' || status === 'FAILED') {
      query.status = 'PROCESSING';
    } else if (status === 'CANCELLED') {
      query.status = { $in: ['PENDING', 'OVERDUE', 'PROCESSING'] };
    } else if (status === 'PENDING' && details.scheduledFor) {
      // Retry case: must be PROCESSING (we own it)
      query.status = 'PROCESSING';
    }

    const result = await db.collection('scheduled_integrations').updateOne(
      query,
      { $set: updateDoc }
    );

    if (result.matchedCount === 0) {
      log('warn', 'Scheduled integration status update failed - integration not in expected state', {
        id,
        newStatus: status,
        details
      });
      return false;
    }

    log('debug', 'Scheduled integration status updated', { id, status });
    return true;
  } catch (err) {
    logError(err, { scope: 'updateScheduledIntegrationStatus', id });
    return false;
  }
}

/**
 * Reset stuck integrations that have been PROCESSING for too long
 * This prevents integrations from getting stuck if worker crashes during processing
 * @param {number} timeoutMinutes - How long a integration can be PROCESSING before reset (default: 10 minutes)
 * @returns {Promise<number>} Number of integrations reset
 */
async function resetStuckProcessingIntegrations(timeoutMinutes = 10) {
  if (!useMongo()) {
    return 0;
  }

  try {
    const db = await mongodb.getDbSafe();
    const timeoutMs = timeoutMinutes * 60 * 1000;
    const stuckThreshold = new Date(Date.now() - timeoutMs);

    const result = await db.collection('scheduled_integrations').updateMany(
      {
        status: 'PROCESSING',
        processingStartedAt: { $lt: stuckThreshold }
      },
      {
        $set: {
          status: 'PENDING',
          updatedAt: new Date()
        },
        $unset: {
          processingStartedAt: ''
        }
      }
    );

    if (result.modifiedCount > 0) {
      log('warn', `Reset ${result.modifiedCount} stuck PROCESSING integrations back to PENDING`, {
        modifiedCount: result.modifiedCount,
        timeoutMinutes,
        stuckThreshold: stuckThreshold.toISOString()
      });
    }

    return result.modifiedCount;
  } catch (err) {
    logError(err, { scope: 'resetStuckProcessingIntegrations' });
    return 0;
  }
}

/**
 * Cancel scheduled integration(s) by cancellation info
 * @param {number} orgId - Organization ID
 * @param {Object} matchCriteria - Match criteria (patientRid, scheduledDateTime range)
 * @returns {Promise<number>} Number of cancelled integrations
 */
async function cancelScheduledIntegrationsByMatch(orgId, matchCriteria) {
  const normalizedOrgId = normalizeOrgId(orgId);
  if (!normalizedOrgId) return 0;

  if (!useMongo()) {
    return 0;
  }

  try {
    const db = await mongodb.getDbSafe();
    const query = {
      ...scheduledOrgQuery(normalizedOrgId),
      status: 'PENDING' // Only cancel pending integrations
    };

    // Match by patientRid
    if (matchCriteria.patientRid) {
      query['cancellationInfo.patientRid'] = matchCriteria.patientRid;
    }

    // Match by scheduled datetime with tolerance (±1 hour)
    if (matchCriteria.scheduledDateTime) {
      const targetTime = new Date(matchCriteria.scheduledDateTime);
      const tolerance = 60 * 60 * 1000; // 1 hour in ms
      query['cancellationInfo.scheduledDateTime'] = {
        $gte: new Date(targetTime.getTime() - tolerance).toISOString(),
        $lte: new Date(targetTime.getTime() + tolerance).toISOString()
      };
    }

    const result = await db.collection('scheduled_integrations').updateMany(
      query,
      {
        $set: {
          status: 'CANCELLED',
          cancelledAt: new Date(),
          cancelReason: matchCriteria.reason || 'Auto-cancelled by matching event',
          updatedAt: new Date()
        }
      }
    );

    log('info', 'Scheduled integrations cancelled by match', {
      orgId: normalizedOrgId,
      matchCriteria,
      cancelledCount: result.modifiedCount
    });

    return result.modifiedCount;
  } catch (err) {
    logError(err, { scope: 'cancelScheduledIntegrationsByMatch' });
    return 0;
  }
}

/**
 * Update a scheduled integration
 * @param {number} orgId - Organization/tenant ID
 * @param {string} id - Scheduled integration ID
 * @param {Object} updates - Fields to update
 * @returns {Promise<boolean>} Success status
 */
async function updateScheduledIntegration(orgId, id, updates) {
  const normalizedOrgId = normalizeOrgId(orgId);

  if (!useMongo()) {
    return false;
  }

  try {
    const db = await mongodb.getDbSafe();

    const query = { _id: mongodb.toObjectId(id) };
    if (normalizedOrgId) {
      query.$or = scheduledOrgQuery(normalizedOrgId).$or;
    }

    // Prepare update document
    const updateDoc = {
      ...updates,
      updatedAt: new Date()
    };

    // If scheduledFor is being updated, recalculate status
    if (updates.scheduledFor) {
      const now = Date.now();
      const scheduledTime = new Date(updates.scheduledFor).getTime();

      // Only update status if currently PENDING or OVERDUE
      const existing = await db.collection('scheduled_integrations').findOne(query);
      if (existing && (existing.status === 'PENDING' || existing.status === 'OVERDUE')) {
        updateDoc.status = scheduledTime <= now ? 'OVERDUE' : 'PENDING';
      }
    }

    const result = await db.collection('scheduled_integrations').updateOne(
      query,
      { $set: updateDoc }
    );

    return result.modifiedCount > 0;
  } catch (err) {
    logError(err, { scope: 'updateScheduledIntegration', id });
    return false;
  }
}

async function deleteScheduledIntegration(orgId, id) {
  if (id === undefined) {
    id = orgId;
    orgId = null;
  }

  const normalizedOrgId = normalizeOrgId(orgId);

  if (!useMongo()) {
    return false;
  }

  try {
    const db = await mongodb.getDbSafe();

    // Soft delete by marking as CANCELLED
    const query = { _id: mongodb.toObjectId(id) };
    if (normalizedOrgId) {
      query.$or = scheduledOrgQuery(normalizedOrgId).$or;
    }

    const result = await db.collection('scheduled_integrations').updateOne(
      query,
      {
        $set: {
          status: 'CANCELLED',
          cancelledAt: new Date(),
          cancelReason: 'Manual cancellation',
          updatedAt: new Date()
        }
      }
    );

    log('info', 'Scheduled integration cancelled', { id, orgId: normalizedOrgId });
    return result.modifiedCount > 0;
  } catch (err) {
    logError(err, { scope: 'deleteScheduledIntegration', id, orgId: normalizedOrgId });
    return false;
  }
}

module.exports = {
  createScheduledIntegration,
  listScheduledIntegrations,
  getPendingScheduledIntegrations,
  updateScheduledIntegrationStatus,
  resetStuckProcessingIntegrations,
  cancelScheduledIntegrationsByMatch,
  updateScheduledIntegration,
  deleteScheduledIntegration
};
