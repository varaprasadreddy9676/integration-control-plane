const data = require('../data');
const { log } = require('../logger');
const { applyTransform } = require('../services/transformer');
const { executeSchedulingScript, extractCancellationInfo } = require('../services/scheduler');
const { generateCorrelationId } = require('../utils/event-utils');
const { deliverToIntegration } = require('./delivery-engine');

async function processEvent(evt, pollCount = 0) {
  // Generate correlation ID for distributed tracing
  const correlationId = generateCorrelationId();
  const deliveryResults = [];
  const orgId = data.resolveOrgIdFromEvent(evt);

  try {
    // Note: Duplicate check is now handled by the event source adapter handler
    // This function focuses only on integration matching and delivery

    const integrations = await data.listIntegrationsForDelivery(orgId, evt.event_type);
    log('info', `Processing event`, {
      correlationId,
      eventId: evt.eventId || evt.id,
      eventType: evt.event_type,
      orgId,
      integrationCount: integrations.length,
      integrationIds: integrations.map((w) => w.id),
    });

    if (!integrations.length) {
      // No integrations to process - adapter handler will mark as processed
      await data.markEventComplete(evt.id, 'SKIPPED', 'No matching integration');
      return;
    }

    // Check for cancellation events (e.g., APPOINTMENT_RESCHEDULED, APPOINTMENT_CANCELLATION)
    // and auto-cancel scheduled integrations
    const cancellationEvents = [
      'OPU_RESCHEDULED',
      'ET_RESCHEDULED',
      'APPOINTMENT_RESCHEDULED',
      'APPOINTMENT_CANCELLATION',
      'OPU_CANCELLED',
      'ET_CANCELLED',
      'SURGERY_CANCELLED',
    ];
    if (cancellationEvents.includes(evt.event_type)) {
      const cancellationInfo = extractCancellationInfo(evt.payload, evt.event_type);
      if (cancellationInfo) {
        // eslint-disable-next-line no-await-in-loop
        const cancelledCount = await data.cancelScheduledIntegrationsByMatch(orgId, cancellationInfo);
        log('info', `[POLL #${pollCount}] Auto-cancelled ${cancelledCount} scheduled integrations`, {
          correlationId,
          eventType: evt.event_type,
          cancellationInfo,
        });
      }
    }

    // Split integrations into immediate and scheduled
    const immediateIntegrations = [];
    const scheduledIntegrations = [];

    for (const integration of integrations) {
      if (integration.deliveryMode === 'IMMEDIATE' || !integration.deliveryMode) {
        immediateIntegrations.push(integration);
      } else {
        scheduledIntegrations.push(integration);
      }
    }

    let successCount = 0;
    let failureCount = 0;
    let scheduledCount = 0;

    // Handle scheduled integrations (DELAYED or RECURRING)
    for (const integration of scheduledIntegrations) {
      try {
        log('info', `[POLL #${pollCount}] Creating scheduled integration`, {
          correlationId,
          integrationId: integration.id,
          __KEEP_integrationName__: integration.name,
          deliveryMode: integration.deliveryMode,
        });

        // Apply transformation to get the payload ready for delivery
        // eslint-disable-next-line no-await-in-loop
        const transformed = await applyTransform(integration, evt.payload, {
          eventType: evt.event_type,
          orgId,
        });

        if (transformed === null) {
          log('info', `[POLL #${pollCount}] Skipping scheduled integration: transformation returned null`, {
            correlationId,
            integrationId: integration.id,
            __KEEP_integrationName__: integration.name,
            deliveryMode: integration.deliveryMode,
          });

          // eslint-disable-next-line no-await-in-loop
          const logId = await data.recordLog(orgId, {
            __KEEP___KEEP_integrationConfig__Id__: integration.id,
            __KEEP_integrationName__: integration.name,
            eventId: evt.id || null,
            eventType: evt.event_type,
            status: 'SKIPPED',
            errorCategory: 'TRANSFORMATION_RETURNED_NULL',
            responseStatus: 204,
            responseTimeMs: 0,
            attemptCount: 1,
            originalPayload: evt.payload,
            requestPayload: transformed,
            errorMessage: 'Skipped scheduling: transformation returned null',
            targetUrl: integration.targetUrl,
            httpMethod: integration.httpMethod || 'POST',
            correlationId,
            traceId: correlationId,
            requestHeaders: null,
          });

          deliveryResults.push({ integrationId: integration.id, status: 'SKIPPED', logId });
          continue;
        }

        // Execute scheduling script
        // eslint-disable-next-line no-await-in-loop
        const scheduleResult = await executeSchedulingScript(integration.schedulingConfig?.script, evt.payload, {
          eventType: evt.event_type,
          orgId,
          __KEEP_integrationConfig__: integration,
        });

        // Extract cancellation info for matching
        const cancellationInfo = extractCancellationInfo(evt.payload, evt.event_type);

        if (integration.deliveryMode === 'DELAYED') {
          // DELAYED: scheduleResult is a Unix timestamp
          const scheduledForMs = scheduleResult;
          const now = Date.now();
          const gracePeriodMs = 60000; // 1 minute grace period to account for processing time

          // Skip scheduling if the time is more than grace period in the past
          if (scheduledForMs < now - gracePeriodMs) {
            log('warn', `[POLL #${pollCount}] Skipping delayed integration: scheduled time is in the past`, {
              correlationId,
              integrationId: integration.id,
              __KEEP_integrationName__: integration.name,
              scheduledFor: new Date(scheduledForMs).toISOString(),
              currentTime: new Date(now).toISOString(),
              pastByMs: now - scheduledForMs,
            });

            // Record a log entry showing this was skipped
            // eslint-disable-next-line no-await-in-loop
            const logId = await data.recordLog(orgId, {
              __KEEP___KEEP_integrationConfig__Id__: integration.id,
              __KEEP_integrationName__: integration.name,
              eventId: evt.id || null,
              eventType: evt.event_type,
              status: 'SKIPPED',
              errorCategory: 'SCHEDULED_TIME_PASSED',
              responseStatus: 204,
              responseTimeMs: 0,
              attemptCount: 1,
              originalPayload: evt.payload,
              requestPayload: transformed,
              errorMessage: `Skipped scheduling: reminder time (${new Date(scheduledForMs).toISOString()}) is in the past by ${Math.floor((now - scheduledForMs) / 1000)}s`,
              targetUrl: integration.targetUrl,
              httpMethod: integration.httpMethod || 'POST',
              correlationId,
              traceId: correlationId,
              requestHeaders: null,
            });

            deliveryResults.push({ integrationId: integration.id, status: 'SKIPPED', logId });
            continue;
          }

          // eslint-disable-next-line no-await-in-loop
          await data.createScheduledIntegration({
            __KEEP___KEEP_integrationConfig__Id__: integration.id,
            __KEEP_integrationName__: integration.name,
            orgId,
            originalEventId: evt.id,
            eventType: evt.event_type,
            scheduledFor: scheduleResult, // Unix timestamp in ms
            payload: transformed,
            originalPayload: evt.payload,
            targetUrl: integration.targetUrl,
            httpMethod: integration.httpMethod || 'POST',
            cancellationInfo,
          });

          log('info', `[POLL #${pollCount}] Delayed integration scheduled`, {
            correlationId,
            integrationId: integration.id,
            scheduledFor: new Date(scheduleResult).toISOString(),
            schedulesInMs: scheduleResult - now,
          });

          scheduledCount++;
          deliveryResults.push({ integrationId: integration.id, status: 'SCHEDULED', logId: null });
        } else if (integration.deliveryMode === 'RECURRING') {
          // RECURRING: scheduleResult is a config object
          const firstOccurrenceMs = scheduleResult.firstOccurrence;
          const now = Date.now();
          const gracePeriodMs = 60000; // 1 minute grace period

          // Skip scheduling if the first occurrence is more than grace period in the past
          if (firstOccurrenceMs < now - gracePeriodMs) {
            log('warn', `[POLL #${pollCount}] Skipping recurring integration: first occurrence is in the past`, {
              correlationId,
              integrationId: integration.id,
              __KEEP_integrationName__: integration.name,
              firstOccurrence: new Date(firstOccurrenceMs).toISOString(),
              currentTime: new Date(now).toISOString(),
              pastByMs: now - firstOccurrenceMs,
            });

            // Record a log entry showing this was skipped
            // eslint-disable-next-line no-await-in-loop
            const logId = await data.recordLog(orgId, {
              __KEEP___KEEP_integrationConfig__Id__: integration.id,
              __KEEP_integrationName__: integration.name,
              eventId: evt.id || null,
              eventType: evt.event_type,
              status: 'SKIPPED',
              errorCategory: 'SCHEDULED_TIME_PASSED',
              responseStatus: 204,
              responseTimeMs: 0,
              attemptCount: 1,
              originalPayload: evt.payload,
              requestPayload: transformed,
              errorMessage: `Skipped scheduling: first occurrence (${new Date(firstOccurrenceMs).toISOString()}) is in the past by ${Math.floor((now - firstOccurrenceMs) / 1000)}s`,
              targetUrl: integration.targetUrl,
              httpMethod: integration.httpMethod || 'POST',
              correlationId,
              traceId: correlationId,
              requestHeaders: null,
            });

            deliveryResults.push({ integrationId: integration.id, status: 'SKIPPED', logId });
            continue;
          }

          // eslint-disable-next-line no-await-in-loop
          await data.createScheduledIntegration({
            __KEEP___KEEP_integrationConfig__Id__: integration.id,
            __KEEP_integrationName__: integration.name,
            orgId,
            originalEventId: evt.id,
            eventType: evt.event_type,
            scheduledFor: scheduleResult.firstOccurrence, // Unix timestamp in ms
            payload: transformed,
            originalPayload: evt.payload,
            targetUrl: integration.targetUrl,
            httpMethod: integration.httpMethod || 'POST',
            recurrenceConfig: {
              interval: scheduleResult.interval,
              until: scheduleResult.until || null,
              count: scheduleResult.count || null,
            },
            cancellationInfo,
          });

          log('info', `[POLL #${pollCount}] Recurring integration scheduled`, {
            correlationId,
            integrationId: integration.id,
            firstOccurrence: new Date(scheduleResult.firstOccurrence).toISOString(),
            interval: scheduleResult.interval,
            until: scheduleResult.until,
            count: scheduleResult.count,
          });

          scheduledCount++;
          deliveryResults.push({ integrationId: integration.id, status: 'SCHEDULED', logId: null });
        }
      } catch (err) {
        log('error', `[POLL #${pollCount}] Error creating scheduled integration`, {
          correlationId,
          integrationId: integration.id,
          error: err.message,
          stack: err.stack,
        });
        failureCount++;
        deliveryResults.push({ integrationId: integration.id, status: 'FAILED', logId: null });
      }
    }

    // Handle immediate integrations
    for (const integration of immediateIntegrations) {
      log('info', `[POLL #${pollCount}] Delivering to integration`, {
        correlationId,
        integrationId: integration.id,
        __KEEP_integrationName__: integration.name,
        targetUrl: integration.targetUrl,
      });
      // eslint-disable-next-line no-await-in-loop
      const result = await deliverToIntegration(integration, evt, false, pollCount, null, correlationId, true);
      const status = typeof result === 'string' ? result : result.status;
      const logId = typeof result === 'string' ? null : result.logId;
      const logIds = typeof result === 'string' ? null : result.logIds;
      log('info', `[POLL #${pollCount}] Delivery result`, {
        correlationId,
        integrationId: integration.id,
        result: status,
      });
      deliveryResults.push({
        integrationId: integration.id,
        status,
        logId,
        logIds,
      });
      if (status === 'SUCCESS') {
        successCount++;
      } else {
        failureCount++;
      }
    }

    const finalStatus =
      failureCount === 0 ? 'COMPLETED' : successCount > 0 || scheduledCount > 0 ? 'PARTIAL_SUCCESS' : 'FAILED';

    log('info', `[POLL #${pollCount}] Marking event complete`, {
      correlationId,
      eventId: evt.id,
      finalStatus,
      successCount,
      failureCount,
      scheduledCount,
    });

    // Note: Event persistence (in-memory + MongoDB) is handled by the adapter handler
    // No need to mark as processed here - adapter already does it after processEvent() returns

    await data.markEventComplete(
      evt.id,
      finalStatus,
      `Processed ${integrations.length} integrations: ${successCount} immediate success, ${scheduledCount} scheduled, ${failureCount} failures`
    );

    return {
      correlationId,
      deliveryResults,
      scheduledCount,
      successCount,
      failureCount,
    };
  } catch (error) {
    log('error', `[POLL #${pollCount}] Error in processEvent`, {
      correlationId,
      error: error.message,
      stack: error.stack,
      eventId: evt.id,
    });
    throw error;
  }
}

module.exports = {
  processEvent,
};
