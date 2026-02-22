const config = require('../config');
const data = require('../data');
const { log } = require('../logger');
const { withTimeout } = require('../utils/timeout');
const dlqData = require('../data/dlq');
const { generateCorrelationId } = require('../utils/event-utils');
const { deliverSingleAction, deliverToIntegration } = require('./delivery-engine');

async function processRetries(pollCount = 0, dbTimeout = 30000) {
  const retryBatchSize = config.worker?.retryBatchSize || 3;
  const maxRetryProcessingTime = config.worker?.maxRetryProcessingTimeMs || 120000;
  const startTime = Date.now();

  try {
    const retryLogs = await withTimeout(data.getFailedLogsForRetry(retryBatchSize), dbTimeout, 'getFailedLogsForRetry');
    let retryCount = 0;

    if (!retryLogs || !Array.isArray(retryLogs) || retryLogs.length === 0) {
      return 0; // No retries to process
    }

    for (const logEntry of retryLogs) {
      // Safety check: Don't process retries for too long
      if (Date.now() - startTime > maxRetryProcessingTime) {
        const prefix = pollCount > 0 ? `[POLL #${pollCount}] ` : '';
        log('warn', `${prefix}Retry processing timeout reached, stopping early`, {
          processedCount: retryCount,
          totalRetries: retryLogs.length,
          timeSpentMs: Date.now() - startTime,
        });
        break; // Exit loop gracefully
      }

      try {
        // Validate logEntry has required fields
        if (!logEntry || !logEntry.id || !logEntry.__KEEP___KEEP_integrationConfig__Id__) {
          log('warn', 'Invalid retry log entry, skipping', { logEntry });
          continue;
        }

        const integration = await withTimeout(
          data.getIntegrationById(logEntry.__KEEP___KEEP_integrationConfig__Id__),
          dbTimeout,
          'getIntegrationById'
        );

        if (!integration || !integration.isActive) {
          await withTimeout(data.markLogAsAbandoned(logEntry.id), dbTimeout, 'markLogAsAbandoned').catch((err) => {
            log('warn', `Failed to mark log as abandoned: ${err.message}`, { logId: logEntry.id });
          });
          continue;
        }

        const maxRetries = integration.retryCount || 3;
        // logEntry.attemptCount is the LAST attempt number
        // If it's >= maxRetries, we've already tried the max number of times
        if (logEntry.attemptCount >= maxRetries) {
          await withTimeout(data.markLogAsAbandoned(logEntry.id), dbTimeout, 'markLogAsAbandoned').catch((err) => {
            log('warn', `Failed to mark log as abandoned: ${err.message}`, { logId: logEntry.id });
          });
          const prefix = pollCount > 0 ? `[POLL #${pollCount}] ` : '';
          log('info', `${prefix}Integration delivery abandoned after max retries`, {
            integrationId: integration.id,
            attemptCount: logEntry.attemptCount,
            maxRetries,
            pollCount,
          });
          continue;
        }

        // Industry-standard retry: 10s, 30s, 60s, 120s, 240s, capped at 4min
        let delaySeconds = 10 * 2 ** (logEntry.attemptCount - 1);
        delaySeconds = Math.min(delaySeconds, 240); // Cap at 4 minutes

        // Add jitter to prevent thundering herd
        const jitter = Math.random() * 2000; // 0-2 seconds jitter
        delaySeconds += jitter / 1000;

        // Use lastAttemptAt for accurate backoff, fallback to updatedAt or createdAt
        const lastAttempt = logEntry.lastAttemptAt || logEntry.updatedAt || logEntry.createdAt;
        const nextAttemptTime = new Date(lastAttempt);
        nextAttemptTime.setSeconds(nextAttemptTime.getSeconds() + Math.floor(delaySeconds));

        if (new Date() < nextAttemptTime) {
          log('debug', 'Retry not ready yet', {
            logId: logEntry.id,
            nextAttemptTime: nextAttemptTime.toISOString(),
            remainingSeconds: Math.floor((nextAttemptTime - Date.now()) / 1000),
          });
          continue; // Not time to retry yet
        }

        // Retry the delivery
        const orgId = logEntry.orgId || integration.orgId;
        const orgUnitRid = logEntry.orgUnitRid || integration.orgUnitRid || orgId;
        const retryEvent = {
          id: logEntry.id,
          event_type: logEntry.eventType,
          payload: logEntry.originalPayload || logEntry.requestPayload,
          attempt_count: logEntry.attemptCount,
          orgId,
          orgUnitRid,
        };

        const prefix = pollCount > 0 ? `[POLL #${pollCount}] ` : '';
        const traceId = logEntry.correlationId || generateCorrelationId();
        const hasActionIndex = Number.isFinite(logEntry.actionIndex);
        const action =
          hasActionIndex && Array.isArray(integration.actions) ? integration.actions[logEntry.actionIndex] : null;

        if (hasActionIndex && !action) {
          log('warn', `${prefix}Retry skipped - action index not found`, {
            logId: logEntry.id,
            integrationId: integration.id,
            actionIndex: logEntry.actionIndex,
          });
          await withTimeout(data.markLogAsAbandoned(logEntry.id), dbTimeout, 'markLogAsAbandoned').catch((err) => {
            log('warn', `Failed to mark log as abandoned: ${err.message}`, { logId: logEntry.id });
          });

          await dlqData
            .createDLQEntry({
              traceId,
              messageId: logEntry.eventId || logEntry.id,
              integrationConfigId: integration.id,
              orgId: integration.orgId,
              direction: 'OUTBOUND',
              payload: retryEvent.payload,
              error: {
                message: 'Action index not found for retry',
                code: 'ACTION_NOT_FOUND',
              },
              metadata: {
                logId: logEntry.id,
                actionIndex: logEntry.actionIndex,
                eventType: logEntry.eventType,
                __KEEP_integrationName__: integration.name,
              },
            })
            .catch((err) => {
              log('warn', 'Failed to create DLQ entry for missing action', {
                logId: logEntry.id,
                error: err.message,
              });
            });
          continue;
        }

        log('info', `${prefix}Retrying integration delivery`, {
          logId: logEntry.id,
          integrationId: integration.id,
          attemptCount: logEntry.attemptCount + 1,
          actionIndex: hasActionIndex ? logEntry.actionIndex : undefined,
          pollCount,
        });

        if (action) {
          // eslint-disable-next-line no-await-in-loop
          await deliverSingleAction(integration, action, retryEvent, pollCount, logEntry.actionIndex, traceId, null, {
            existingLogId: logEntry.id,
            triggerType: logEntry.triggerType || 'EVENT',
          });
        } else {
          // eslint-disable-next-line no-await-in-loop
          await deliverToIntegration(integration, retryEvent, false, pollCount, logEntry.id, traceId);
        }
        retryCount++;
      } catch (err) {
        const prefix = pollCount > 0 ? `[POLL #${pollCount}] ` : '';
        log('error', `${prefix}Failed to process retry`, {
          logId: logEntry.id,
          error: err.message,
          stack: err.stack,
          pollCount,
        });
      }
    }

    return retryCount;
  } catch (err) {
    const prefix = pollCount > 0 ? `[POLL #${pollCount}] ` : '';
    log('error', `${prefix}processRetries failed completely`, {
      error: err.message,
      stack: err.stack,
      pollCount,
    });
    return 0; // Return 0 on failure, don't crash the worker
  }
}

// Replay a specific event or events from logs
async function replayEvent(logId, orgId, options = {}) {
  try {
    log('info', 'Starting event replay', { logId, orgId, options });

    // Get original log entry
    const originalLog = await data.getLogById(orgId, logId);
    if (!originalLog) {
      throw new Error(`Log entry not found: ${logId}`);
    }

    // Get integration configuration
    const integration = await data.getIntegrationById(originalLog.__KEEP___KEEP_integrationConfig__Id__);
    if (!integration) {
      throw new Error(`Integration configuration not found: ${originalLog.__KEEP___KEEP_integrationConfig__Id__}`);
    }

    if (!integration.isActive) {
      throw new Error(`Integration is not active: ${integration.name}`);
    }

    // Prepare replay event
    const resolvedOrgId = originalLog.orgId || orgId;
    const resolvedOrgUnitRid = originalLog.orgUnitRid || integration.orgUnitRid || resolvedOrgId;
    const replayEvent = {
      id: `replay_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      event_type: originalLog.eventType,
      payload: originalLog.originalPayload || originalLog.requestPayload,
      attempt_count: originalLog.attemptCount || 0,
      isReplay: true,
      originalLogId: logId,
      orgId: resolvedOrgId,
      orgUnitRid: resolvedOrgUnitRid,
    };

    // Override options if provided
    if (options.payload) {
      replayEvent.payload = options.payload;
    }

    if (options.eventType) {
      replayEvent.event_type = options.eventType;
    }

    if (options.targetUrl) {
      // Temporarily override integration target URL
      integration.targetUrl = options.targetUrl;
    }

    const forceDelivery = Boolean(
      options.force || options.forceDelivery || options.ignoreCircuit || options.bypassCircuit
    );

    // Deliver replayed event (replays are outside poll context, pollCount = 0)
    const replayCorrelationId = generateCorrelationId();
    const actionIndex = Number.isFinite(originalLog.actionIndex) ? originalLog.actionIndex : null;
    const action = actionIndex !== null && Array.isArray(integration.actions) ? integration.actions[actionIndex] : null;

    const manualReason = options.reason || options.retryReason || 'Manual replay';
    let result;
    if (actionIndex !== null) {
      if (!action) {
        throw new Error(`Action index ${actionIndex} not found for integration ${integration.id}`);
      }
      result = await deliverSingleAction(integration, action, replayEvent, 0, actionIndex, replayCorrelationId, null, {
        existingLogId: logId,
        triggerType: 'REPLAY',
        retryReason: manualReason,
      });
    } else {
      result = await deliverToIntegration(integration, replayEvent, true, 0, logId, replayCorrelationId, false, {
        forceDelivery,
        retryReason: manualReason,
      });
    }

    log('info', 'Event replay completed', {
      logId,
      integrationId: integration.id,
      __KEEP_integrationName__: integration.name,
      eventType: replayEvent.event_type,
      result: typeof result === 'string' ? result : result?.status,
      actionIndex,
    });

    return {
      success: (typeof result === 'string' ? result : result?.status) === 'SUCCESS',
      logId,
      integrationId: integration.id,
      __KEEP_integrationName__: integration.name,
      eventType: replayEvent.event_type,
      result: typeof result === 'string' ? result : result?.status,
    };
  } catch (error) {
    log('error', 'Event replay failed', {
      logId,
      error: error.message,
      stack: error.stack,
    });

    // Record failed replay
    try {
      const failureCorrelationId = generateCorrelationId();
      await data.recordLog(options.orgId || 1, {
        __KEEP___KEEP_integrationConfig__Id__: options.integrationId || 'unknown',
        __KEEP_integrationName__: options.__KEEP_integrationName__ || 'unknown',
        eventType: options.eventType || 'REPLAY_FAILED',
        status: 'FAILED',
        responseStatus: 500,
        responseTimeMs: 0,
        attemptCount: 1,
        originalPayload: options.payload || {},
        requestPayload: options.payload || {},
        responseBody: null,
        errorMessage: error.message,
        targetUrl: options.targetUrl || null,
        httpMethod: options.httpMethod || 'POST',
        // Distributed tracing
        correlationId: failureCorrelationId,
        traceId: failureCorrelationId,
        // Request details (not available for failed replay)
        requestHeaders: null,
        // Replay metadata
        isReplay: true,
        originalLogId: logId,
      });
    } catch (logError) {
      log('error', 'Failed to record replay error log', {
        logId,
        logError: logError.message,
      });
    }

    throw error;
  }
}

module.exports = {
  processRetries,
  replayEvent,
};
