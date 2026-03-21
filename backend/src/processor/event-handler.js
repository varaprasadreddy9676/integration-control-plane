/**
 * Event Handler - Shared processing logic for all event source adapters
 *
 * Used by DeliveryWorkerManager to create per-org event handlers.
 * Every adapter (MySQL, Kafka, HTTP Push) calls the same pipeline:
 *   receive → validate → dedup → audit → processEvent → ack/nack
 */

const config = require('../config');
const data = require('../data');
const { log } = require('../logger');
const { generateEventKey } = require('../utils/event-utils');
const { isEventProcessed, markEventProcessed } = require('./event-deduplication');
const { processEvent } = require('./event-processor');
const { normalizeEventSubject } = require('./event-normalizer');

/**
 * Create a bound event handler for a specific source type.
 *
 * @param {string} sourceType - 'mysql' | 'kafka' | 'http_push'
 * @returns {Function} async (event, ctx) => void
 */
function createEventHandler(sourceType) {
  return async function handleEvent(event, ctx) {
    const startTime = Date.now();
    const orgId = data.resolveOrgIdFromEvent(event);
    const eventKey = generateEventKey(event.event_type, event.payload, orgId);
    const stableEventId = event.eventId || `${sourceType}-${eventKey}`;
    const payloadSize = JSON.stringify(event.payload).length;
    const maxPayloadSize = config.eventAudit?.maxPayloadSize || 100000;
    const storeSummaryPayload = config.eventAudit?.storeSummaryPayload !== false;
    const storeFullPayload = config.eventAudit?.storeFullPayload === true;
    const canStoreFullPayload = storeFullPayload && payloadSize <= maxPayloadSize;

    try {
      // --- Guard: orgId required ---
      if (!orgId) {
        log('warn', 'Skipping event: orgId not found', { eventId: stableEventId, sourceType });

        if (config.eventAudit?.enabled) {
          await data.recordEventAudit({
            eventId: stableEventId,
            source: sourceType,
            sourceId: event.id?.toString(),
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
            payloadSize,
            sourceMetadata: data.extractSourceMetadata(event, sourceType),
            timeline: [{ ts: new Date(), stage: 'RECEIVED', details: 'Event received but entity context missing' }],
          });
        }

        await ctx.ack();
        return;
      }

      // --- Guard: payload size ---
      if (payloadSize > maxPayloadSize) {
        log('warn', 'Skipping event: payload too large', { eventId: stableEventId, payloadSize, maxPayloadSize });

        if (config.eventAudit?.enabled) {
          await data.recordEventAudit({
            eventId: stableEventId,
            source: sourceType,
            sourceId: event.id?.toString(),
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
            timeline: [{ ts: new Date(), stage: 'RECEIVED', details: 'Event received but payload too large' }],
          });
        }

        await ctx.ack();
        return;
      }

      // --- Audit: RECEIVED ---
      if (config.eventAudit?.enabled) {
        await data.recordEventAudit({
          eventId: stableEventId,
          source: sourceType,
          sourceId: event.id?.toString(),
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
          timeline: [{ ts: new Date(), stage: 'RECEIVED', details: 'Event received from source' }],
        });
      }

      // --- Audit: source checkpoint for gap detection ---
      if (config.eventAudit?.enabled && config.eventAudit?.enableGapDetection) {
        const sourceIdentifier = data.getSourceIdentifier(event, sourceType);
        await data.updateSourceCheckpoint({
          source: sourceType,
          sourceIdentifier,
          orgId,
          lastProcessedId: event.id?.toString(),
          lastProcessedAt: new Date(),
        });
      }

      // --- Audit: PROCESSING ---
      if (config.eventAudit?.enabled) {
        await data.updateEventAudit(stableEventId, {
          status: 'PROCESSING',
          processingStartedAt: new Date(),
          timeline: { ts: new Date(), stage: 'PROCESSING', details: 'Started processing event' },
        });
      }

      // --- Dedup ---
      const inMemoryDuplicate = isEventProcessed(eventKey);
      const mongoDbDuplicate = await data.isEventAlreadyProcessed(eventKey, stableEventId);

      if (inMemoryDuplicate || mongoDbDuplicate) {
        const duplicateType = mongoDbDuplicate ? 'database' : 'in-memory';
        log('info', 'Skipping duplicate event', { eventId: stableEventId, eventKey, orgId, duplicateType });

        if (config.eventAudit?.enabled) {
          await data.updateEventAudit(stableEventId, {
            status: 'SKIPPED',
            skipCategory: 'DUPLICATE',
            skipReason: `Duplicate detected (${duplicateType})`,
            duplicateType,
            processingCompletedAt: new Date(),
            processingTimeMs: Date.now() - startTime,
            timeline: { ts: new Date(), stage: 'SKIPPED', details: `Duplicate event (${duplicateType})` },
          });
        }

        await data.markEventComplete(event.id, 'SKIPPED', `Duplicate event (${duplicateType})`);
        await ctx.ack();
        return;
      }

      // --- Lifecycle invalidation ---
      // Runs unconditionally before the integration check so scheduled-integration
      // cleanup happens even when no outbound delivery config exists for this event type.
      const invalidationProfiles = await data.listInvalidationProfiles(orgId, event.event_type);
      let cancelledCount = 0;

      for (const profile of invalidationProfiles) {
        try {
          // eslint-disable-next-line no-await-in-loop
          const subject = await normalizeEventSubject(event.event_type, event.payload, {
            subjectType: profile.subjectType,
            subjectExtraction: profile.subjectExtraction,
          });

          if (!subject?.data) {
            continue;
          }

          // eslint-disable-next-line no-await-in-loop
          cancelledCount += await data.cancelScheduledIntegrationsByMatch(orgId, {
            eventType: event.event_type,
            integrationConfigId: profile.integrationId,
            subject,
            lifecycleRule: profile.lifecycleRule,
            subjectExtraction: profile.subjectExtraction,
          });
        } catch (error) {
          log('warn', 'Lifecycle invalidation profile failed', {
            eventType: event.event_type,
            orgId,
            integrationId: profile.integrationId,
            error: error.message,
          });
        }
      }

      if (invalidationProfiles.length > 0) {
        log('info', 'Lifecycle invalidation: auto-cancelled scheduled integrations', {
          eventType: event.event_type,
          cancelledCount,
          orgId,
          profileCount: invalidationProfiles.length,
        });
      }

      // --- Condition-based hold/release/discard ---
      const conditionProfiles = await data.listConditionProfiles(orgId, event.event_type);
      const conditionStats = {
        releasedCount: 0,
        discardedCount: 0,
        failedCount: 0,
        profileCount: conditionProfiles.length,
      };

      for (const profile of conditionProfiles) {
        try {
          // eslint-disable-next-line no-await-in-loop
          const subject = await normalizeEventSubject(event.event_type, event.payload, {
            subjectType: profile.subjectType,
            subjectExtraction: profile.subjectExtraction,
          });

          if (!subject?.data) {
            continue;
          }

          if (profile.action === 'RELEASE_HELD') {
            // eslint-disable-next-line no-await-in-loop
            const result = await data.releaseHeldDeliveriesByMatch(orgId, {
              eventType: event.event_type,
              integrationConfigId: profile.integrationId,
              integration: profile.integration,
              subject,
              conditionRule: profile.conditionRule,
              conditionConfig: profile.integration?.conditionConfig,
              subjectExtraction: profile.subjectExtraction,
            });
            conditionStats.releasedCount += result.releasedCount;
            conditionStats.failedCount += result.failedCount;
          } else if (profile.action === 'DISCARD_HELD') {
            // eslint-disable-next-line no-await-in-loop
            conditionStats.discardedCount += await data.discardHeldDeliveriesByMatch(orgId, {
              eventType: event.event_type,
              integrationConfigId: profile.integrationId,
              subject,
              conditionRule: profile.conditionRule,
              conditionConfig: profile.integration?.conditionConfig,
              subjectExtraction: profile.subjectExtraction,
            });
          }
        } catch (error) {
          conditionStats.failedCount += 1;
          log('warn', 'Condition profile failed', {
            eventType: event.event_type,
            orgId,
            integrationId: profile.integrationId,
            error: error.message,
          });
        }
      }

      // --- Integration matching check ---
      const integrations = await data.listIntegrationsForProcessing(orgId, event.event_type);

      if (!integrations.length) {
        const conditionHandled =
          conditionStats.releasedCount > 0 || conditionStats.discardedCount > 0 || conditionStats.failedCount > 0;

        if (conditionHandled) {
          const finalStatus =
            conditionStats.releasedCount > 0
              ? 'DELIVERED'
              : conditionStats.failedCount > 0 && conditionStats.discardedCount === 0
                ? 'FAILED'
                : 'SKIPPED';

          if (config.eventAudit?.enabled) {
            await data.updateEventAudit(stableEventId, {
              status: finalStatus,
              deliveryStatus: {
                integrationsMatched: 0,
                deliveredCount: conditionStats.releasedCount,
                failedCount: conditionStats.failedCount,
                deliveryLogIds: [],
              },
              processingCompletedAt: new Date(),
              processingTimeMs: Date.now() - startTime,
              skipReason:
                finalStatus === 'SKIPPED'
                  ? `Condition rules discarded ${conditionStats.discardedCount} held delivery(s)`
                  : `Condition rules released ${conditionStats.releasedCount} held delivery(s)`,
              timeline: {
                ts: new Date(),
                stage: finalStatus,
                details: `Condition rules handled held deliveries (released=${conditionStats.releasedCount}, discarded=${conditionStats.discardedCount}, failed=${conditionStats.failedCount})`,
              },
            });
          }

          await data.markEventComplete(
            event.id,
            finalStatus,
            `Condition rules handled held deliveries (released=${conditionStats.releasedCount}, discarded=${conditionStats.discardedCount}, failed=${conditionStats.failedCount})`
          );
          markEventProcessed(eventKey);
          await data.saveProcessedEvent(eventKey, event.id, event.event_type, orgId, stableEventId);
          await ctx.ack();
          return;
        }

        log('info', 'No matching integrations', { eventId: stableEventId, eventType: event.event_type, orgId });

        if (config.eventAudit?.enabled) {
          await data.updateEventAudit(stableEventId, {
            status: 'SKIPPED',
            skipCategory: 'NO_WEBHOOK',
            skipReason: 'No active integrations matched this event',
            deliveryStatus: { integrationsMatched: 0, deliveredCount: 0, failedCount: 0, deliveryLogIds: [] },
            processingCompletedAt: new Date(),
            processingTimeMs: Date.now() - startTime,
            timeline: { ts: new Date(), stage: 'SKIPPED', details: 'No integrations matched' },
          });
        }

        await data.markEventComplete(event.id, 'SKIPPED', 'No matching integration');
        markEventProcessed(eventKey);
        await data.saveProcessedEvent(eventKey, event.id, event.event_type, orgId, stableEventId);
        await ctx.ack();
        return;
      }

      // --- Process and deliver ---
      const processResult = await processEvent(event, 0);
      const deliveryResults = processResult?.deliveryResults || [];
      const scheduledCount = processResult?.scheduledCount || 0;
      const heldCount = processResult?.heldCount || 0;
      const deliveryLogIds = deliveryResults.flatMap((r) => {
        if (r.logIds && Array.isArray(r.logIds)) return r.logIds;
        return r.logId ? [r.logId] : [];
      });
      const deliveredCount = deliveryResults.filter((r) => r.status === 'SUCCESS').length;
      const failedCount = deliveryResults.filter((r) => ['FAILED', 'ABANDONED', 'RETRYING'].includes(r.status)).length;
      const skippedCount = deliveryResults.filter((r) => r.status === 'SKIPPED').length;
      const hasSuccess = deliveredCount > 0 || scheduledCount > 0 || heldCount > 0;
      const hasFailure = failedCount > 0;

      const finalStatus = hasSuccess ? 'DELIVERED' : hasFailure ? 'FAILED' : skippedCount > 0 ? 'SKIPPED' : 'FAILED';

      markEventProcessed(eventKey);
      await data.saveProcessedEvent(eventKey, event.id, event.event_type, orgId, stableEventId);

      if (config.eventAudit?.enabled) {
        await data.updateEventAudit(stableEventId, {
          status: finalStatus,
          deliveryStatus: { integrationsMatched: integrations.length, deliveredCount, failedCount, deliveryLogIds },
          processingCompletedAt: new Date(),
          processingTimeMs: Date.now() - startTime,
          skipReason:
            hasSuccess && failedCount > 0
              ? `Partial success: ${deliveredCount} ok, ${scheduledCount} scheduled, ${failedCount} failed`
              : finalStatus === 'SKIPPED'
                ? 'All integrations skipped (transformation returned null)'
                : null,
          skipCategory: hasSuccess ? null : finalStatus === 'SKIPPED' ? 'INTEGRATION_SKIPPED' : 'WORKER_ERROR',
          timeline: {
            ts: new Date(),
            stage: finalStatus,
            details: `Processed ${integrations.length} integrations: ${deliveredCount} ok, ${scheduledCount} scheduled, ${failedCount} failed, ${skippedCount} skipped`,
          },
        });
      }

      await ctx.ack();
    } catch (error) {
      log('error', 'Event processing failed', { eventId: stableEventId, error: error.message, stack: error.stack });

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
            timeline: { ts: new Date(), stage: 'FAILED', details: `Worker error: ${error.message}` },
          });
        } catch (auditErr) {
          log('error', 'Failed to update event audit on error', { eventId: stableEventId, error: auditErr.message });
        }
      }

      await ctx.nack(60000);
    }
  };
}

module.exports = { createEventHandler };
