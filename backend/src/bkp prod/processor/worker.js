const config = require('../config');
const data = require('../data');
const mongodb = require('../mongodb'); // MongoDB for event audit
const { log } = require('../logger');
const { uuidv4 } = require('../utils/runtime');
const { updateHeartbeat } = require('../worker-heartbeat');
const { MysqlEventSource } = require('../adapters/MysqlEventSource');
const { generateEventKey } = require('../utils/event-utils');
const { cleanupDedupCache, isEventProcessed, markEventProcessed } = require('./event-deduplication');
const { processEvent } = require('./event-processor');
const { processRetries, replayEvent } = require('./retry-handler');
const { startPendingDeliveriesWorker } = require('./pending-deliveries-worker');

/**
 * Start delivery worker using event source adapter pattern
 * Supports multiple event sources (MySQL, Kafka, SQS) via configuration
 */
function startDeliveryWorker() {
  const enabled = config.worker?.enabled ?? true;
  const dbTimeout = config.worker?.dbOperationTimeoutMs || 30000;

  if (!enabled) {
    log('info', 'Delivery worker disabled via config');
    return () => {};
  }

  // Create event source adapter based on configuration
  const sourceType = config.eventSource?.type || 'mysql';
  let eventSource;

  if (sourceType === 'mysql') {
    eventSource = new MysqlEventSource({
      intervalMs: config.worker?.intervalMs || 5000,
      batchSize: config.worker?.batchSize || 5,
      dbOperationTimeoutMs: dbTimeout
    });
  } else {
    throw new Error(`Unsupported event source type: ${sourceType}. Currently only 'mysql' is supported.`);
  }

  log('info', `Starting delivery worker with ${sourceType} event source`);

  // Event handler - processes each event with comprehensive audit tracking
  const handleEvent = async (event, ctx) => {
    const startTime = Date.now();
    const eventKey = generateEventKey(event.event_type, event.payload, event.tenantId);
    const stableEventId = event.eventId || event.id || `${sourceType}-${uuidv4()}-${eventKey}`;
    const payloadSize = JSON.stringify(event.payload).length;
    const maxPayloadSize = config.eventAudit?.maxPayloadSize || 100000;
    const storeSummaryPayload = config.eventAudit?.storeSummaryPayload !== false;
    const storeFullPayload = config.eventAudit?.storeFullPayload === true;
    const canStoreFullPayload = storeFullPayload && payloadSize <= maxPayloadSize;

    try {
      // Extract entity context from event (populated by data layer)
      const orgId = event.orgId;
      if (!orgId) {
        log('warn', 'Skipping event: orgId not found', {
          eventId: stableEventId,
          tenantId: event.tenantId
        });

        // Record audit for missing tenant context
        if (config.eventAudit?.enabled) {
          await data.recordEventAudit({
            eventId: stableEventId,
            source: sourceType,
            sourceId: event.id?.toString(),
            tenantId: event.tenantId,
            orgId: null,
            eventType: event.event_type,
            eventKey,
            receivedAt: new Date(),
            receivedAtBucket: data.getBucketTimestamp(new Date()),
            status: 'SKIPPED',
            skipCategory: 'NO_ENTITY_CONTEXT',
            skipReason: 'Organization ID missing in event',
            payloadHash: data.hashPayload(event.payload),
            ...(storeSummaryPayload ? { payloadSummary: data.extractSafePayload(event.payload) } : {}),
            ...(canStoreFullPayload ? { payload: event.payload } : {}),
            payloadSize,
            sourceMetadata: data.extractSourceMetadata(event, sourceType),
            timeline: [{ ts: new Date(), stage: 'RECEIVED', details: 'Event received but entity context missing' }]
          });
        }

        await ctx.ack();
        return;
      }

      if (payloadSize > maxPayloadSize) {
        log('warn', 'Skipping event: payload too large', {
          eventId: stableEventId,
          payloadSize,
          maxPayloadSize
        });

        // Record audit for oversized payload
        if (config.eventAudit?.enabled) {
          await data.recordEventAudit({
            eventId: stableEventId,
            source: sourceType,
            sourceId: event.id?.toString(),
            tenantId: event.tenantId,
            orgId,
            eventType: event.event_type,
            eventKey,
            receivedAt: new Date(),
            receivedAtBucket: data.getBucketTimestamp(new Date()),
            status: 'SKIPPED',
            skipCategory: 'PAYLOAD_TOO_LARGE',
            skipReason: `Payload size ${payloadSize} exceeds max ${maxPayloadSize}`,
            payloadHash: data.hashPayload(event.payload),
            ...(storeSummaryPayload ? { payloadSummary: data.extractSafePayload(event.payload) } : {}),
            payloadSize,
            sourceMetadata: data.extractSourceMetadata(event, sourceType),
            timeline: [{ ts: new Date(), stage: 'RECEIVED', details: 'Event received but payload too large' }]
          });
        }

        await ctx.ack();
        return;
      }

      // 1. Record RECEIVED status
      if (config.eventAudit?.enabled) {
        await data.recordEventAudit({
          eventId: stableEventId,
          source: sourceType,
          sourceId: event.id?.toString(),
          tenantId: event.tenantId,
          orgId,
          eventType: event.event_type,
          eventKey,
          receivedAt: new Date(),
          receivedAtBucket: data.getBucketTimestamp(new Date()),
          status: 'RECEIVED',
          payloadHash: data.hashPayload(event.payload),
          ...(storeSummaryPayload ? { payloadSummary: data.extractSafePayload(event.payload) } : {}),
          ...(canStoreFullPayload ? { payload: event.payload } : {}),
          payloadSize,
          sourceMetadata: data.extractSourceMetadata(event, sourceType),
          timeline: [{ ts: new Date(), stage: 'RECEIVED', details: 'Event received from source' }]
        });
      }

      // 2. Update source checkpoint for gap detection
      if (config.eventAudit?.enabled && config.eventAudit?.enableGapDetection) {
        const sourceIdentifier = data.getSourceIdentifier(event, sourceType);
        await data.updateSourceCheckpoint({
          source: sourceType,
          sourceIdentifier,
          orgId,
          lastProcessedId: event.id?.toString(),
          lastProcessedAt: new Date()
        });
      }

      // 3. Transition to PROCESSING state
      if (config.eventAudit?.enabled) {
        await data.updateEventAudit(stableEventId, {
          status: 'PROCESSING',
          processingStartedAt: new Date(),
          timeline: { ts: new Date(), stage: 'PROCESSING', details: 'Started processing event' }
        });
      }

      // 4. Check for duplicate events
      const inMemoryDuplicate = isEventProcessed(eventKey);
      const mongoDbDuplicate = await data.isEventAlreadyProcessed(eventKey, stableEventId);

      if (inMemoryDuplicate || mongoDbDuplicate) {
        const duplicateType = mongoDbDuplicate ? 'database' : 'in-memory';

        log('info', 'Skipping duplicate event', {
          eventId: stableEventId,
          eventType: event.event_type,
          eventKey,
          tenantId: event.tenantId,
          duplicateType
        });

        // Update audit with duplicate detection
        if (config.eventAudit?.enabled) {
          await data.updateEventAudit(stableEventId, {
            status: 'SKIPPED',
            skipCategory: 'DUPLICATE',
            skipReason: `Duplicate detected (${duplicateType})`,
            duplicateType,
            processingCompletedAt: new Date(),
            processingTimeMs: Date.now() - startTime,
            timeline: { ts: new Date(), stage: 'SKIPPED', details: `Duplicate event (${duplicateType})` }
          });
        }

        await data.markEventComplete(event.id, 'SKIPPED', `Duplicate event (${duplicateType})`);
        await ctx.ack();
        return;
      }

      // 5. Find matching integrations
      const integrations = await data.listIntegrationsForDelivery(event.tenantId, event.event_type);

      if (!integrations.length) {
        log('info', 'No matching integrations', {
          eventId: stableEventId,
          eventType: event.event_type,
          tenantId: event.tenantId
        });

        // Update audit with no integration status
        if (config.eventAudit?.enabled) {
          await data.updateEventAudit(stableEventId, {
            status: 'SKIPPED',
            skipCategory: 'NO_WEBHOOK',
            skipReason: 'No active integrations matched this event',
            deliveryStatus: {
              integrationsMatched: 0,
              deliveredCount: 0,
              failedCount: 0,
              deliveryLogIds: []
            },
            processingCompletedAt: new Date(),
            processingTimeMs: Date.now() - startTime,
            timeline: { ts: new Date(), stage: 'SKIPPED', details: 'No integrations matched' }
          });
        }

        await data.markEventComplete(event.id, 'SKIPPED', 'No matching integration');
        markEventProcessed(eventKey);
        await data.saveProcessedEvent(eventKey, event.id, event.event_type, event.tenantId, stableEventId);
        await ctx.ack();
        return;
      }

      // 6. Process event and deliver integrations with tracking
      const processResult = await processEvent(event, 0);
      const deliveryResults = processResult?.deliveryResults || [];
      const scheduledCount = processResult?.scheduledCount || 0;
      const deliveryLogIds = deliveryResults.flatMap((r) => {
        if (r.logIds && Array.isArray(r.logIds)) return r.logIds;
        return r.logId ? [r.logId] : [];
      });
      const deliveredCount = deliveryResults.filter(r => r.status === 'SUCCESS').length;
      const failedCount = deliveryResults.filter(r => ['FAILED', 'ABANDONED', 'RETRYING'].includes(r.status)).length;
      const skippedCount = deliveryResults.filter(r => r.status === 'SKIPPED').length;
      const hasSuccess = deliveredCount > 0 || scheduledCount > 0;
      const hasFailure = failedCount > 0;
      let finalStatus;
      if (hasSuccess) {
        finalStatus = 'DELIVERED';
      } else if (hasFailure) {
        finalStatus = 'FAILED';
      } else if (skippedCount > 0) {
        finalStatus = 'SKIPPED';
      } else {
        finalStatus = 'FAILED';
      }

      // 7. Mark as processed
      markEventProcessed(eventKey);
      await data.saveProcessedEvent(eventKey, event.id, event.event_type, event.tenantId, stableEventId);

      // 8. Update audit with final status
      if (config.eventAudit?.enabled) {
        await data.updateEventAudit(stableEventId, {
          status: finalStatus,
          deliveryStatus: {
            integrationsMatched: integrations.length,
            deliveredCount,
            failedCount,
            deliveryLogIds
          },
          processingCompletedAt: new Date(),
          processingTimeMs: Date.now() - startTime,
          skipReason: hasSuccess && failedCount > 0
            ? `Partial success: ${deliveredCount} ok, ${scheduledCount} scheduled, ${failedCount} failed`
            : (finalStatus === 'SKIPPED' ? 'All integrations skipped (transformation returned null)' : null),
          skipCategory: hasSuccess
            ? null
            : (finalStatus === 'SKIPPED' ? 'INTEGRATION_SKIPPED' : 'WORKER_ERROR'),
          timeline: {
            ts: new Date(),
            stage: finalStatus,
            details: `Processed ${integrations.length} integrations: ${deliveredCount} ok, ${scheduledCount} scheduled, ${failedCount} failed, ${skippedCount} skipped`
          }
        });
      }

      await ctx.ack();

    } catch (error) {
      log('error', 'Event processing failed', {
        eventId: stableEventId,
        error: error.message,
        stack: error.stack
      });

      // Update audit with failure
      if (config.eventAudit?.enabled) {
        try {
          await data.updateEventAudit(stableEventId, {
            status: 'FAILED',
            skipCategory: 'WORKER_ERROR',
            skipReason: `Worker error: ${error.message}`,
            errorMessage: error.message,
            errorStack: error.stack,
            processingCompletedAt: new Date(),
            processingTimeMs: Date.now() - startTime,
            timeline: { ts: new Date(), stage: 'FAILED', details: `Worker error: ${error.message}` }
          });
        } catch (auditErr) {
          log('error', 'Failed to update event audit on error', {
            eventId: stableEventId,
            error: auditErr.message
          });
        }
      }

      await ctx.nack(60000);
    }
  };

  // Start event source adapter
  eventSource.start(handleEvent).catch(err => {
    log('error', 'Event source startup failed', {
      source: sourceType,
      error: err.message
    });
  });

  // Start retry processor (separate from event ingestion)
  const retryIntervalMs = config.worker?.retryIntervalMs || 60000; // Default: 60 seconds
  const retryTimer = setInterval(async () => {
    try {
      updateHeartbeat('deliveryWorker');
      const retryCount = await processRetries(0, dbTimeout);
      if (retryCount > 0) {
        log('info', 'Processed retry attempts', { retryCount });
      }
    } catch (error) {
      log('error', 'Retry processing failed', {
        error: error.message
      });
    }
  }, retryIntervalMs);

  // Start watchdog for STUCK events
  let watchdogTimer = null;
  if (config.eventAudit?.enabled && config.eventAudit?.watchdogEnabled) {
    const watchdogIntervalMs = config.eventAudit?.watchdogIntervalMs || 300000; // Default: 5 minutes
    const stuckThresholdMs = config.eventAudit?.stuckThresholdMs || 300000; // Default: 5 minutes

    watchdogTimer = setInterval(async () => {
      try {
        const stuckThreshold = new Date(Date.now() - stuckThresholdMs);
        const dbClient = await mongodb.getDbSafe();

        const stuckEvents = await dbClient.collection('event_audit')
          .find({
            status: 'PROCESSING',
            processingStartedAt: { $lt: stuckThreshold }
          })
          .toArray();

        if (stuckEvents.length > 0) {
          log('warn', 'Detected STUCK events', { count: stuckEvents.length });

          for (const event of stuckEvents) {
            await dbClient.collection('event_audit').updateOne(
              { _id: event._id },
              {
                $set: {
                  status: 'STUCK',
                  skipCategory: 'WORKER_ERROR',
                  skipReason: 'Event stuck in PROCESSING state (worker may have crashed)',
                  errorMessage: `Event stuck in PROCESSING for more than ${stuckThresholdMs / 1000} seconds`,
                  processingCompletedAt: new Date(),
                  processingTimeMs: Date.now() - new Date(event.processingStartedAt).getTime()
                },
                $push: {
                  timeline: {
                    ts: new Date(),
                    stage: 'STUCK',
                    details: `Event stuck in PROCESSING for more than ${stuckThresholdMs / 1000} seconds`
                  }
                }
              }
            );
          }

          log('info', 'Marked STUCK events', { count: stuckEvents.length });
        }
      } catch (error) {
        log('error', 'Watchdog failed', {
          error: error.message
        });
      }
    }, watchdogIntervalMs);

    log('info', `Event audit watchdog started (interval: ${watchdogIntervalMs}ms, threshold: ${stuckThresholdMs}ms)`);
  }

  log('info', `Delivery worker started using ${sourceType} adapter`);

  // Return cleanup function
  return async () => {
    log('info', 'Stopping delivery worker...');
    clearInterval(retryTimer);
    if (watchdogTimer) {
      clearInterval(watchdogTimer);
    }
    await eventSource.stop();
    log('info', 'Delivery worker stopped');
  };
}

// Re-export from extracted modules for backward compatibility
const { replayEvent: replayEventExport } = require('./retry-handler');

module.exports = {
  startDeliveryWorker,
  replayEvent: replayEventExport,
  startPendingDeliveriesWorker
};

// Exported for tests only - re-export from extracted modules
const eventUtils = require('../utils/event-utils');
const eventDedup = require('./event-deduplication');

module.exports.__test = {
  generateEventKey: eventUtils.generateEventKey,
  isEventProcessed: eventDedup.isEventProcessed,
  markEventProcessed: eventDedup.markEventProcessed,
  cleanupDedupCache: eventDedup.cleanupDedupCache,
  _processedEvents: eventDedup.getProcessedEventsMap()
};
