const { fetch, AbortController, uuidv4 } = require('../utils/runtime');
const config = require('../config');
const data = require('../data');
const { log, logError } = require('../logger');
const { buildAuthHeaders } = require('./auth-helper');
const { generateSignatureHeaders } = require('../services/integration-signing');
const { calculateNextOccurrence } = require('../services/scheduler');
const { applyTransform } = require('../services/transformer');
const { validateTargetUrl } = require('../utils/url-check');
const { withTimeout } = require('../utils/timeout');
const { updateHeartbeat } = require('../worker-heartbeat');
const { createExecutionLogger } = require('../utils/execution-logger');
const { checkRateLimit } = require('../middleware/rate-limiter');

/**
 * Generate a correlation ID (trace ID) for distributed tracing
 */
function generateCorrelationId() {
  return uuidv4();
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function resolveMultiActionDelayMs(orgId) {
  const defaultDelay = config.scheduler?.multiActionDelayMs ?? config.worker?.multiActionDelayMs ?? 0;

  if (!orgId) {
    return defaultDelay;
  }

  try {
    const uiConfig = await data.getUiConfigForEntity(orgId);
    const overrideDelay = uiConfig?.worker?.multiActionDelayMs;
    if (Number.isFinite(overrideDelay)) {
      return overrideDelay;
    }
  } catch (err) {
    log('warn', 'Failed to read ui_config for multi-action delay; using config.json value', {
      orgId,
      error: err.message
    });
  }

  return defaultDelay;
}

/**
 * Start the scheduler worker that processes scheduled integrations
 */
function startSchedulerWorker() {
  const intervalMs = config.scheduler?.intervalMs || 60000;
  const batchSize = config.scheduler?.batchSize || 10;
  const enabled = config.scheduler?.enabled ?? true;
  const dbTimeout = config.scheduler?.dbOperationTimeoutMs || 30000;

  if (!enabled) {
    log('info', 'Scheduler worker disabled via config');
    return () => {};
  }

  let running = false;
  let pollCount = 0;

  const timer = setInterval(async () => {
    if (running) {
      log('debug', 'Scheduler still processing previous cycle, skipping this poll');
      return;
    }

    running = true;
    pollCount++;
    const cycleStart = Date.now();

    try {
      // Update heartbeat at start of cycle
      updateHeartbeat('schedulerWorker');

      log('info', `[SCHEDULER #${pollCount}] Cycle started`, {
        intervalMs,
        batchSize
      });

      // CRITICAL: Reset any integrations stuck in PROCESSING state (e.g., from worker crashes)
      // This prevents integrations from being stuck forever if processing failed
      try {
        const resetCount = await withTimeout(
          data.resetStuckProcessingIntegrations(10), // Reset integrations processing for > 10 minutes
          dbTimeout,
          'resetStuckProcessingIntegrations'
        );
        if (resetCount > 0) {
          log('warn', `[SCHEDULER #${pollCount}] Reset ${resetCount} stuck integrations from PROCESSING to PENDING`);
        }
      } catch (err) {
        log('error', `[SCHEDULER #${pollCount}] Failed to reset stuck integrations: ${err.message}`);
      }

      // Fetch pending scheduled integrations (now with atomic claiming)
      const scheduledIntegrations = await withTimeout(
        data.getPendingScheduledIntegrations(batchSize),
        dbTimeout,
        'getPendingScheduledIntegrations'
      );

      log('info', `[SCHEDULER #${pollCount}] Fetched ${scheduledIntegrations.length} pending scheduled integrations`, {
        count: scheduledIntegrations.length
      });

      let sentCount = 0;
      let failedCount = 0;
      let recurringCreatedCount = 0;

      for (const scheduled of scheduledIntegrations) {
        const correlationId = generateCorrelationId();
        const orgId = scheduled.orgId;

        try {
          log('info', `[SCHEDULER #${pollCount}] Processing scheduled integration`, {
            correlationId,
            id: scheduled.id,
            orgId,
            __KEEP_integrationName__: scheduled.__KEEP_integrationName__,
            scheduledFor: scheduled.scheduledFor,
            eventType: scheduled.eventType,
            status: scheduled.status,
            attemptCount: scheduled.attemptCount || 0,
            isRecurring: !!scheduled.recurringConfig,
            occurrenceNumber: scheduled.recurringConfig?.occurrenceNumber
          });

          // Fetch integration configuration for auth and circuit breaker
          // eslint-disable-next-line no-await-in-loop
          const integration = await withTimeout(
            data.getIntegration(scheduled.__KEEP___KEEP_integrationConfig__Id__),
            dbTimeout,
            'getIntegration'
          );

          if (!integration) {
            log('warn', `[SCHEDULER #${pollCount}] Integration config not found`, {
              correlationId,
              scheduledId: scheduled.id,
              __KEEP___KEEP_integrationConfig__Id__: scheduled.__KEEP___KEEP_integrationConfig__Id__
            });
            // eslint-disable-next-line no-await-in-loop
            await withTimeout(
              data.updateScheduledIntegrationStatus(scheduled.id, 'FAILED', {
                errorMessage: 'Integration configuration not found'
              }),
              dbTimeout,
              'updateScheduledIntegrationStatus'
            ).catch(err => {
              log('warn', `Failed to update scheduled integration status: ${err.message}`, { scheduledId: scheduled.id });
            });
            failedCount++;
            continue;
          }

          // Check if integration is still active
          if (!integration.isActive) {
            log('info', `[SCHEDULER #${pollCount}] Integration is inactive, skipping`, {
              correlationId,
              scheduledId: scheduled.id,
              integrationId: integration.id
            });
            // eslint-disable-next-line no-await-in-loop
            await withTimeout(
              data.updateScheduledIntegrationStatus(scheduled.id, 'CANCELLED', {
                errorMessage: 'Integration configuration is inactive'
              }),
              dbTimeout,
              'updateScheduledIntegrationStatus'
            ).catch(err => {
              log('warn', `Failed to update scheduled integration status: ${err.message}`, { scheduledId: scheduled.id });
            });
            continue;
          }

          // Check circuit breaker
          // eslint-disable-next-line no-await-in-loop
          const circuitStatus = await withTimeout(
            data.checkCircuitState(integration.id),
            dbTimeout,
            'checkCircuitState'
          );
          if (circuitStatus.isOpen) {
            log('warn', `[SCHEDULER #${pollCount}] Circuit breaker is OPEN, skipping`, {
              correlationId,
              scheduledId: scheduled.id,
              integrationId: integration.id,
              circuitState: circuitStatus.state
            });
            // eslint-disable-next-line no-await-in-loop
            await withTimeout(
              data.updateScheduledIntegrationStatus(scheduled.id, 'FAILED', {
                errorMessage: `Circuit breaker OPEN: ${circuitStatus.reason}`
              }),
              dbTimeout,
              'updateScheduledIntegrationStatus'
            ).catch(err => {
              log('warn', `Failed to update scheduled integration status: ${err.message}`, { scheduledId: scheduled.id });
            });
            failedCount++;
            continue;
          }

          // Deliver the scheduled integration
          // eslint-disable-next-line no-await-in-loop
          const deliveryResult = await deliverScheduledIntegration(
            scheduled,
            integration,
            pollCount,
            correlationId
          );

          if (deliveryResult.status === 'SUCCESS') {
            log('info', `[SCHEDULER #${pollCount}] Scheduled integration delivered successfully`, {
              correlationId,
              scheduledId: scheduled.id,
              responseStatus: deliveryResult.responseStatus
            });

            // Update status - CRITICAL: Check if update succeeded
            // eslint-disable-next-line no-await-in-loop
            const statusUpdateSuccess = await data.updateScheduledIntegrationStatus(scheduled.id, 'SENT', {
              deliveredAt: new Date().toISOString(),
              deliveryLogId: deliveryResult.logId,
              attemptCount: deliveryResult.attemptCount
            });

            if (!statusUpdateSuccess) {
              log('error', `[SCHEDULER #${pollCount}] CRITICAL: Failed to update scheduled integration status to SENT!`, {
                correlationId,
                scheduledId: scheduled.id,
                orgId,
                currentStatus: scheduled.status
              });
              // Don't continue to create next occurrence if we couldn't mark current one as SENT
              failedCount++;
              continue;
            }

            // CIRCUIT BREAKER: Record success
            // eslint-disable-next-line no-await-in-loop
            await data.recordDeliverySuccess(integration.id);

            sentCount++;

            // For recurring integrations, create the next occurrence
            if (scheduled.recurringConfig) {
              const nextOccurrence = calculateNextOccurrence(
                scheduled.recurringConfig,
                scheduled.recurringConfig.occurrenceNumber + 1
              );

              if (nextOccurrence) {
                // eslint-disable-next-line no-await-in-loop
                await data.createScheduledIntegration({
                  __KEEP___KEEP_integrationConfig__Id__: scheduled.__KEEP___KEEP_integrationConfig__Id__,
                  __KEEP_integrationName__: scheduled.__KEEP_integrationName__,
                  orgId,
                  originalEventId: scheduled.originalEventId,
                  eventType: scheduled.eventType,
                  scheduledFor: nextOccurrence,
                  payload: scheduled.payload,
                  originalPayload: scheduled.originalPayload || scheduled.payload,
                  targetUrl: scheduled.targetUrl,
                  httpMethod: scheduled.httpMethod,
                  cancellationInfo: scheduled.cancellationInfo,
                  recurringConfig: {
                    ...scheduled.recurringConfig,
                    occurrenceNumber: scheduled.recurringConfig.occurrenceNumber + 1
                  }
                });

                log('info', `[SCHEDULER #${pollCount}] Next occurrence scheduled`, {
                  correlationId,
                  scheduledId: scheduled.id,
                  nextOccurrence: new Date(nextOccurrence).toISOString(),
                  occurrenceNumber: scheduled.recurringConfig.occurrenceNumber + 1
                });

                recurringCreatedCount++;
              } else {
                log('info', `[SCHEDULER #${pollCount}] Recurring series completed`, {
                  correlationId,
                  scheduledId: scheduled.id,
                  totalOccurrences: scheduled.recurringConfig.occurrenceNumber
                });
              }
            }
          } else if (deliveryResult.status === 'RETRYING') {
            log('warn', `[SCHEDULER #${pollCount}] Scheduled integration retrying`, {
              correlationId,
              scheduledId: scheduled.id,
              nextAttemptAt: deliveryResult.nextAttemptAt,
              error: deliveryResult.errorMessage
            });

            // Reschedule with backoff
            // eslint-disable-next-line no-await-in-loop
            await data.updateScheduledIntegrationStatus(scheduled.id, 'PENDING', {
              errorMessage: deliveryResult.errorMessage,
              scheduledFor: deliveryResult.nextAttemptAt,
              attemptCount: deliveryResult.attemptCount
            });
          } else {
            log('error', `[SCHEDULER #${pollCount}] Scheduled integration delivery failed`, {
              correlationId,
              scheduledId: scheduled.id,
              error: deliveryResult.errorMessage
            });

            // Update status - Check if update succeeded
            // eslint-disable-next-line no-await-in-loop
            const failedUpdateSuccess = await data.updateScheduledIntegrationStatus(scheduled.id, 'FAILED', {
              errorMessage: deliveryResult.errorMessage,
              attemptCount: deliveryResult.attemptCount
            });

            if (!failedUpdateSuccess) {
              log('warn', `[SCHEDULER #${pollCount}] Failed to update scheduled integration status to FAILED`, {
                correlationId,
                scheduledId: scheduled.id,
                orgId
              });
            }

            // CIRCUIT BREAKER: Record failure
            // eslint-disable-next-line no-await-in-loop
            await data.recordDeliveryFailure(integration.id);

            failedCount++;
          }
        } catch (err) {
          logError(err, {
            scope: 'scheduler-worker:processScheduled',
            scheduledId: scheduled.id,
            correlationId
          });

          // Update status
          // eslint-disable-next-line no-await-in-loop
          await data.updateScheduledIntegrationStatus(scheduled.id, 'FAILED', {
            errorMessage: err.message
          });

          failedCount++;
        }
      }

      const cycleTime = Date.now() - cycleStart;
      log('info', `[SCHEDULER #${pollCount}] Cycle completed`, {
        durationMs: cycleTime,
        sent: sentCount,
        failed: failedCount,
        recurringCreated: recurringCreatedCount
      });
    } catch (err) {
      logError(err, {
        scope: 'scheduler-worker:cycle',
        pollCount
      });
    } finally {
      running = false;
    }
  }, intervalMs);

  log('info', `Scheduler worker started (interval ${intervalMs}ms, batch ${batchSize})`);
  return () => clearInterval(timer);
}

/**
 * Deliver a scheduled integration
 */
function computeRetryDelaySeconds(attemptCount) {
  let delaySeconds = 10 * Math.pow(2, attemptCount - 1);
  delaySeconds = Math.min(delaySeconds, 240);
  const jitter = Math.random() * 2;
  return Math.floor(delaySeconds + jitter);
}

async function safeRead(resp) {
  try {
    const text = await resp.text();
    return text.slice(0, 5000);
  } catch (err) {
    return `Unable to read response: ${err.message}`;
  }
}

async function deliverScheduledAction(action, actionIndex, payload, scheduled, integration, pollCount, traceId, attemptCount, executionLogger = null) {
  const prefix = pollCount > 0 ? `[SCHEDULER #${pollCount}] ` : '';
  const actionName = action.name || `Action ${actionIndex + 1}`;
  const start = Date.now();
  const targetUrl = action.targetUrl || integration.targetUrl;
  const orgId = scheduled.orgId || integration.orgId;

  const urlCheck = validateTargetUrl(targetUrl, config.security);
  if (!urlCheck.valid) {
    if (executionLogger) {
      await executionLogger.addStep('action_url_validation', {
        status: 'failed',
        durationMs: 0,
        metadata: { actionName, actionIndex, url: targetUrl },
        error: { message: urlCheck.reason }
      }).catch(() => {});
    }

    await data.recordLog(orgId, {
      __KEEP___KEEP_integrationConfig__Id__: integration.id,
      __KEEP_integrationName__: `${integration.name} - ${actionName}`,
      eventType: scheduled.eventType,
      direction: 'OUTBOUND',
      triggerType: 'SCHEDULED',
      actionName,
      actionIndex,
      status: 'FAILED',
      responseStatus: 400,
      responseTimeMs: 0,
      attemptCount,
      originalPayload: payload,
      requestPayload: payload,
      errorMessage: `${prefix}${urlCheck.reason}`,
      targetUrl,
      httpMethod: action.httpMethod || integration.httpMethod || 'POST',
      correlationId: traceId,
      traceId: traceId,
      requestHeaders: null
    });
    return { status: 'FAILED', responseStatus: 400, errorMessage: urlCheck.reason, shouldRetry: false };
  }

  let transformed = payload;
  const transformStart = Date.now();
  try {
    if (action.transformation || action.transformationMode) {
      const actionAsIntegration = {
        ...integration,
        transformation: action.transformation,
        transformationMode: action.transformationMode
      };
      transformed = await applyTransform(actionAsIntegration, payload, {
        eventType: scheduled.eventType,
        orgId
      });
    } else {
      transformed = await applyTransform(integration, payload, {
        eventType: scheduled.eventType,
        orgId
      });
    }

    const transformedIsNull = transformed === null;
    if (executionLogger) {
      await executionLogger.addStep('action_transformation', {
        status: transformedIsNull ? 'warning' : 'success',
        durationMs: Date.now() - transformStart,
        metadata: { actionName, actionIndex, result: transformedIsNull ? 'skipped' : 'transformed' }
      }).catch(() => {});
    }

    if (transformedIsNull) {
      const skipMessage = `${prefix}Skipping scheduled delivery for ${actionName}: transformation returned null`;
      log('info', skipMessage, {
        integrationId: integration.id,
        actionName
      });

      await data.recordLog(orgId, {
        __KEEP___KEEP_integrationConfig__Id__: integration.id,
        __KEEP_integrationName__: `${integration.name} - ${actionName}`,
        eventType: scheduled.eventType,
        direction: 'OUTBOUND',
        triggerType: 'SCHEDULED',
        actionName,
        actionIndex,
        status: 'SKIPPED',
        responseStatus: 204,
        responseTimeMs: Date.now() - start,
        attemptCount,
        originalPayload: payload,
        requestPayload: transformed,
        errorMessage: skipMessage,
        targetUrl,
        httpMethod: action.httpMethod || integration.httpMethod || 'POST',
        correlationId: traceId,
        traceId: traceId,
        requestHeaders: null
      });

      await data.recordDeliverySuccess(integration.id);
      if (executionLogger) {
        await executionLogger.updateStatus('skipped').catch(() => {});
      }

      return { status: 'SKIPPED', responseStatus: 204, errorMessage: skipMessage, shouldRetry: false };
    }
  } catch (err) {
    const errorMessage = `${prefix}Transform failed for ${actionName}: ${err.message}`;

    if (executionLogger) {
      await executionLogger.addStep('action_transformation', {
        status: 'failed',
        durationMs: Date.now() - transformStart,
        metadata: { actionName, actionIndex },
        error: { message: err.message, stack: err.stack }
      }).catch(() => {});
    }

    await data.recordLog(orgId, {
      __KEEP___KEEP_integrationConfig__Id__: integration.id,
      __KEEP_integrationName__: `${integration.name} - ${actionName}`,
      eventType: scheduled.eventType,
      direction: 'OUTBOUND',
      triggerType: 'SCHEDULED',
      actionName,
      actionIndex,
      status: 'FAILED',
      responseStatus: 500,
      responseTimeMs: Date.now() - start,
      attemptCount,
      originalPayload: payload,
      requestPayload: transformed,
      errorMessage,
      targetUrl,
      httpMethod: action.httpMethod || integration.httpMethod || 'POST',
      correlationId: traceId,
      traceId: traceId,
      requestHeaders: null
    });
    return { status: 'FAILED', responseStatus: 500, errorMessage, shouldRetry: false };
  }

  if (integration.rateLimits && integration.rateLimits.enabled) {
    const rateStart = Date.now();
    try {
      const rateResult = await checkRateLimit(integration.id, orgId, integration.rateLimits);
      const durationMs = Date.now() - rateStart;
      const maxRequests = integration.rateLimits.maxRequests || 100;
      const windowSeconds = integration.rateLimits.windowSeconds || 60;

      if (executionLogger) {
        await executionLogger.addStep('rate_limit', {
          status: rateResult.allowed ? 'success' : 'failed',
          durationMs,
          metadata: {
            actionName,
            actionIndex,
            remaining: rateResult.remaining,
            resetAt: rateResult.resetAt,
            maxRequests,
            windowSeconds
          },
          error: rateResult.allowed ? null : { message: 'Rate limit exceeded' }
        }).catch(() => {});
      }

      if (!rateResult.allowed) {
        const retryAfter = rateResult.retryAfter ? `, retry after ${rateResult.retryAfter}s` : '';
        const errorMessage = `${prefix}Rate limit exceeded${retryAfter}`;

        await data.recordLog(orgId, {
          __KEEP___KEEP_integrationConfig__Id__: integration.id,
          __KEEP_integrationName__: `${integration.name} - ${actionName}`,
          eventType: scheduled.eventType,
          direction: 'OUTBOUND',
          triggerType: 'SCHEDULED',
          actionName,
          actionIndex,
          status: 'RETRYING',
          responseStatus: 429,
          responseTimeMs: 0,
          attemptCount,
          originalPayload: payload,
          requestPayload: transformed,
          errorMessage,
          shouldRetry: true,
          targetUrl,
          httpMethod: action.httpMethod || integration.httpMethod || 'POST',
          correlationId: traceId,
          traceId: traceId,
          requestHeaders: null
        });

        if (executionLogger) {
          await executionLogger.updateStatus('retrying').catch(() => {});
        }

        return { status: 'RETRYING', responseStatus: 429, errorMessage, shouldRetry: true };
      }
    } catch (error) {
      log('warn', 'Rate limit check failed', {
        integrationId: integration.id,
        actionName,
        error: error.message
      });
    }
  }

  let headers = null;
  let messageId = null;
  let timestamp = null;
  let signatureHeaders = null;

  try {
    const controller = new AbortController();
    const timeout = integration.timeoutMs || config.worker?.timeoutMs || 10000;
    const timer = setTimeout(() => controller.abort(), timeout);

    const httpMethod = action.httpMethod || integration.httpMethod || 'POST';
    headers = await buildAuthHeaders(integration, httpMethod, targetUrl);
    headers['Content-Type'] = 'application/json';
    headers['X-Correlation-ID'] = traceId;
    headers['X-Trace-ID'] = traceId;
    headers['X-Scheduled-Integration-ID'] = scheduled.id;

    if (integration.enableSigning && integration.signingSecrets && integration.signingSecrets.length > 0) {
      try {
        messageId = uuidv4();
        timestamp = Math.floor(Date.now() / 1000);
        const payloadString = JSON.stringify(transformed);
        signatureHeaders = generateSignatureHeaders(
          integration.signingSecrets,
          messageId,
          timestamp,
          payloadString
        );
        Object.assign(headers, signatureHeaders);
      } catch (signError) {
        log('warn', `${prefix}Failed to generate integration signature`, {
          error: signError.message,
          scheduledId: scheduled.id
        });
      }
    }

    const resp = await fetch(targetUrl, {
      method: action.httpMethod || integration.httpMethod || 'POST',
      headers,
      body: JSON.stringify(transformed),
      signal: controller.signal
    });

    clearTimeout(timer);
    const responseTimeMs = Date.now() - start;
    const statusOk = resp.status >= 200 && resp.status < 300;
    let shouldRetry = false;
    let errorMessage = statusOk ? null : 'Non-2xx response';

    if (!statusOk) {
      if (resp.status >= 500) {
        shouldRetry = true;
        errorMessage = `Server error: ${resp.status}`;
      } else if (resp.status === 429) {
        shouldRetry = true;
        errorMessage = 'Rate limited';
      } else if (resp.status >= 400 && resp.status < 500) {
        shouldRetry = false;
        errorMessage = `Client error: ${resp.status}`;
      }
    }

    if (executionLogger) {
      await executionLogger.addStep('action_http_request', {
        status: statusOk ? 'success' : 'failed',
        durationMs: responseTimeMs,
        metadata: {
          actionName,
          actionIndex,
          statusCode: resp.status,
          method: action.httpMethod || integration.httpMethod || 'POST',
          url: targetUrl
        },
        error: statusOk ? null : { message: errorMessage || `HTTP ${resp.status}` }
      }).catch(() => {});
    }

    await data.recordLog(orgId, {
      __KEEP___KEEP_integrationConfig__Id__: integration.id,
      __KEEP_integrationName__: `${integration.name} - ${actionName}`,
      eventType: scheduled.eventType,
      direction: 'OUTBOUND',
      triggerType: 'SCHEDULED',
      actionName,
      actionIndex,
      status: statusOk ? 'SUCCESS' : 'FAILED',
      responseStatus: resp.status,
      responseTimeMs,
      attemptCount,
      originalPayload: payload,
      requestPayload: transformed,
      responseBody: await safeRead(resp),
      errorMessage,
      targetUrl,
      httpMethod: action.httpMethod || integration.httpMethod || 'POST',
      correlationId: traceId,
      traceId: traceId,
      requestHeaders: headers,
      messageId,
      timestamp,
      signature: signatureHeaders ? signatureHeaders['X-Integration-Signature'] : null,
      signatureHeaders
    });

    return {
      status: statusOk ? 'SUCCESS' : 'FAILED',
      responseStatus: resp.status,
      errorMessage,
      shouldRetry
    };
  } catch (err) {
    const errorMessage = err.name === 'AbortError'
      ? `Request timeout after ${integration.timeoutMs || config.worker?.timeoutMs || 10000}ms`
      : err.message;

    if (executionLogger) {
      await executionLogger.addStep('action_http_request', {
        status: 'failed',
        durationMs: Date.now() - start,
        metadata: { actionName, actionIndex },
        error: { message: errorMessage, stack: err.stack, code: err.code }
      }).catch(() => {});
    }

    await data.recordLog(orgId, {
      __KEEP___KEEP_integrationConfig__Id__: integration.id,
      __KEEP_integrationName__: `${integration.name} - ${actionName}`,
      eventType: scheduled.eventType,
      direction: 'OUTBOUND',
      triggerType: 'SCHEDULED',
      actionName,
      actionIndex,
      status: 'FAILED',
      responseStatus: 500,
      responseTimeMs: Date.now() - start,
      attemptCount,
      originalPayload: payload,
      requestPayload: transformed,
      errorMessage,
      targetUrl,
      httpMethod: action.httpMethod || integration.httpMethod || 'POST',
      correlationId: traceId,
      traceId: traceId,
      requestHeaders: headers
    });

    return { status: 'FAILED', responseStatus: 500, errorMessage, shouldRetry: true };
  }
}

async function deliverScheduledMultiAction(
  scheduled,
  integration,
  pollCount = 0,
  correlationId = null,
  attemptCount = 1,
  payload = {},
  executionLogger = null
) {
  const traceId = correlationId || generateCorrelationId();
  const orgId = scheduled.orgId || integration.orgId;
  const multiActionDelayMs = await resolveMultiActionDelayMs(orgId);

  let successCount = 0;
  let failureCount = 0;
  let skippedCount = 0;
  let retryable = false;
  let lastError = null;

  for (let i = 0; i < (integration.actions || []).length; i++) {
    // eslint-disable-next-line no-await-in-loop
    const result = await deliverScheduledAction(
      integration.actions[i],
      i,
      payload,
      scheduled,
      integration,
      pollCount,
      traceId,
      attemptCount,
      executionLogger
    );
    if (result.status === 'SUCCESS') {
      successCount++;
    } else if (result.status === 'SKIPPED') {
      skippedCount++;
    } else {
      failureCount++;
      lastError = result.errorMessage || lastError;
      if (result.shouldRetry) {
        retryable = true;
      }
    }

    if (multiActionDelayMs > 0 && i < (integration.actions || []).length - 1) {
      // eslint-disable-next-line no-await-in-loop
      await sleep(multiActionDelayMs);
    }
  }

  let result;
  if (failureCount === 0 && successCount > 0) {
    result = { status: 'SUCCESS', responseStatus: 200, errorMessage: null, attemptCount };
  } else if (failureCount === 0 && successCount === 0 && skippedCount > 0) {
    result = { status: 'SKIPPED', responseStatus: 204, errorMessage: 'All actions skipped', attemptCount };
  } else {
    const maxRetries = integration.retryCount || 3;
    if (retryable && attemptCount < maxRetries) {
      const delaySeconds = computeRetryDelaySeconds(attemptCount);
      result = {
        status: 'RETRYING',
        responseStatus: 500,
        errorMessage: lastError || 'Retrying scheduled integration',
        nextAttemptAt: new Date(Date.now() + delaySeconds * 1000).toISOString(),
        attemptCount
      };
    } else {
      result = {
        status: 'FAILED',
        responseStatus: 500,
        errorMessage: lastError || 'Scheduled integration failed',
        attemptCount
      };
    }
  }

  if (executionLogger) {
    if (result.status === 'SUCCESS') {
      await executionLogger.success({
        response: {
          statusCode: 200,
          body: { successCount, failureCount, skippedCount }
        },
        metadata: { successCount, failureCount, skippedCount }
      }).catch(() => {});
    } else if (result.status === 'SKIPPED') {
      await executionLogger.updateStatus('skipped').catch(() => {});
    } else if (result.status === 'RETRYING') {
      await executionLogger.updateStatus('retrying').catch(() => {});
    } else {
      const error = new Error(result.errorMessage || 'Scheduled integration failed');
      error.code = failureCount > 0 && successCount > 0 ? 'PARTIAL_FAILURE' : 'ACTION_FAILURE';
      await executionLogger.fail(error, {
        createDLQ: false,
        response: {
          statusCode: result.responseStatus || 500,
          body: { successCount, failureCount, skippedCount }
        }
      }).catch(() => {});
    }
  }

  return result;
}

async function deliverScheduledIntegration(scheduled, integration, pollCount = 0, correlationId = null) {
  const prefix = pollCount > 0 ? `[SCHEDULER #${pollCount}] ` : '';
  const traceId = correlationId || generateCorrelationId();
  const start = Date.now();
  const attemptCount = (scheduled.attemptCount || 0) + 1;
  const payload = scheduled.payload || scheduled.originalPayload || {};
  const orgId = scheduled.orgId || integration.orgId;

  // Create execution logger for scheduled integrations
  const executionLogger = createExecutionLogger({
    traceId,
    direction: 'SCHEDULED',
    triggerType: 'SCHEDULE',
    integrationConfigId: integration.id,
    integrationName: integration.name,
    // Prefer scheduled's original event type, but fall back to integration config's eventType
    // so the Delivery Logs UI doesn't show a blank Event column for scheduled runs.
    eventType: scheduled.eventType || integration.eventType || null,
    eventId: scheduled.originalEventId || null,
    orgId,
    messageId: scheduled.id || null,
    request: {
      url: scheduled.targetUrl,
      method: scheduled.httpMethod,
      headers: {},
      body: payload
    }
  });

  // Start execution logging
  await executionLogger.start().catch(err => {
    log('warn', 'Failed to start execution logger', { error: err.message, traceId });
  });

  if (integration.actions && Array.isArray(integration.actions) && integration.actions.length > 0) {
    return deliverScheduledMultiAction(
      scheduled,
      integration,
      pollCount,
      traceId,
      attemptCount,
      payload,
      executionLogger
    );
  }

  try {
    const urlCheck = validateTargetUrl(scheduled.targetUrl, config.security);
    if (!urlCheck.valid) {
      // Log validation failure
      await executionLogger.addStep('url_validation', {
        status: 'failed',
        durationMs: 0,
        error: { message: urlCheck.reason }
      }).catch(() => {});

      await data.recordLog(orgId, {
        __KEEP___KEEP_integrationConfig__Id__: integration.id,
        __KEEP_integrationName__: integration.name,
        eventType: scheduled.eventType,
        direction: 'OUTBOUND',
        triggerType: 'SCHEDULED',
        status: 'FAILED',
        responseStatus: 400,
        responseTimeMs: 0,
        attemptCount,
        originalPayload: scheduled.originalPayload || payload,
        requestPayload: payload,
        errorMessage: `${prefix}${urlCheck.reason}`,
        targetUrl: scheduled.targetUrl,
        httpMethod: scheduled.httpMethod,
        correlationId: traceId,
        traceId: traceId,
        requestHeaders: null
      });

      // Mark execution as failed
      const error = new Error(urlCheck.reason);
      error.code = 'INVALID_URL';
      await executionLogger.fail(error, {
        payload,
        statusCode: 400
      }).catch(() => {});

      return { status: 'FAILED', responseStatus: 400, errorMessage: urlCheck.reason, attemptCount };
    }

    // Log successful validation
    await executionLogger.addStep('url_validation', {
      status: 'success',
      durationMs: 0
    }).catch(() => {});

  if (integration.rateLimits && integration.rateLimits.enabled) {
    const rateStart = Date.now();
    try {
      const rateResult = await checkRateLimit(integration.id, orgId, integration.rateLimits);
      const durationMs = Date.now() - rateStart;
      const maxRequests = integration.rateLimits.maxRequests || 100;
      const windowSeconds = integration.rateLimits.windowSeconds || 60;

      await executionLogger.addStep('rate_limit', {
        status: rateResult.allowed ? 'success' : 'failed',
        durationMs,
        metadata: {
          remaining: rateResult.remaining,
          resetAt: rateResult.resetAt,
          maxRequests,
          windowSeconds
        },
        error: rateResult.allowed ? null : { message: 'Rate limit exceeded' }
      }).catch(() => {});

        if (!rateResult.allowed) {
          const retryAfter = rateResult.retryAfter ? `, retry after ${rateResult.retryAfter}s` : '';
          const errorMessage = `${prefix}Rate limit exceeded${retryAfter}`;

          await data.recordLog(orgId, {
            __KEEP___KEEP_integrationConfig__Id__: integration.id,
            __KEEP_integrationName__: integration.name,
            eventType: scheduled.eventType,
            direction: 'OUTBOUND',
            triggerType: 'SCHEDULED',
            status: 'RETRYING',
            responseStatus: 429,
            responseTimeMs: 0,
            attemptCount,
            originalPayload: scheduled.originalPayload || payload,
            requestPayload: payload,
            errorMessage,
            shouldRetry: true,
            targetUrl: scheduled.targetUrl,
            httpMethod: scheduled.httpMethod,
            correlationId: traceId,
            traceId: traceId,
            requestHeaders: null
          });

          await executionLogger.updateStatus('retrying').catch(() => {});

          const delaySeconds = computeRetryDelaySeconds(attemptCount);
          return {
            status: 'RETRYING',
            responseStatus: 429,
            errorMessage,
            nextAttemptAt: new Date(Date.now() + delaySeconds * 1000).toISOString(),
            attemptCount
          };
        }
      } catch (error) {
        log('warn', 'Rate limit check failed', {
          integrationId: integration.id,
          error: error.message
        });
      }
    }

    // Build HTTP request
    const controller = new AbortController();
    const timeout = integration.timeoutMs || config.worker?.timeoutMs || 10000;
    const timer = setTimeout(() => controller.abort(), timeout);

    const headers = await buildAuthHeaders(integration, scheduled.httpMethod, scheduled.targetUrl);
    headers['Content-Type'] = 'application/json';
    headers['X-Correlation-ID'] = traceId;
    headers['X-Trace-ID'] = traceId;
    headers['X-Scheduled-Integration-ID'] = scheduled.id;

    // WEBHOOK SIGNING: Generate signature
    let messageId = null;
    let timestamp = null;
    let signatureHeaders = null;

    if (integration.enableSigning && integration.signingSecrets && integration.signingSecrets.length > 0) {
      try {
        messageId = uuidv4();
        timestamp = Math.floor(Date.now() / 1000);
        const payloadString = JSON.stringify(payload);

        signatureHeaders = generateSignatureHeaders(
          integration.signingSecrets,
          messageId,
          timestamp,
          payloadString
        );

        Object.assign(headers, signatureHeaders);

        log('debug', `${prefix}Integration signature generated`, {
          messageId,
          timestamp,
          scheduledId: scheduled.id
        });
      } catch (signError) {
        log('warn', `${prefix}Failed to generate integration signature`, {
          error: signError.message,
          scheduledId: scheduled.id
        });
      }
    }

    // Make HTTP request
    const httpStart = Date.now();
    const resp = await fetch(scheduled.targetUrl, {
      method: scheduled.httpMethod,
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    clearTimeout(timer);
    const responseTimeMs = Date.now() - start;
    const httpDuration = Date.now() - httpStart;

    // Read response body
    const responseBody = await safeRead(resp);

    // Determine status
    let deliveryStatus = 'FAILED';
    let errorMessage = null;
    let shouldRetry = false;

    if (resp.status >= 200 && resp.status < 300) {
      deliveryStatus = 'SUCCESS';
    } else if (resp.status >= 500) {
      errorMessage = `Server error: ${resp.status}`;
      shouldRetry = true;
    } else if (resp.status === 429) {
      errorMessage = 'Rate limited';
      shouldRetry = true;
    } else if (resp.status >= 400) {
      errorMessage = `Client error: ${resp.status}`;
      shouldRetry = false;
    }

    // Log HTTP request step
    await executionLogger.addStep('http_request', {
      status: deliveryStatus === 'SUCCESS' ? 'success' : 'failed',
      durationMs: httpDuration,
      metadata: {
        statusCode: resp.status,
        method: scheduled.httpMethod,
        url: scheduled.targetUrl
      },
      error: deliveryStatus === 'SUCCESS' ? null : { message: errorMessage }
    }).catch(() => {});

    // Record delivery log
    await data.recordLog(orgId, {
      __KEEP___KEEP_integrationConfig__Id__: integration.id,
      __KEEP_integrationName__: integration.name,
      eventType: scheduled.eventType,
      direction: 'OUTBOUND',
      triggerType: 'SCHEDULED',
      status: deliveryStatus,
      responseStatus: resp.status,
      responseBody,
      responseTimeMs,
      attemptCount,
      originalPayload: scheduled.originalPayload || payload,
      requestPayload: payload,
      errorMessage,
      targetUrl: scheduled.targetUrl,
      httpMethod: scheduled.httpMethod,
      correlationId: traceId,
      traceId: traceId,
      requestHeaders: headers,
      messageId,
      timestamp,
      signature: signatureHeaders ? signatureHeaders['X-Integration-Signature'] : null,
      signatureHeaders
    });

    const maxRetries = integration.retryCount || 3;
    if (deliveryStatus !== 'SUCCESS' && shouldRetry && attemptCount < maxRetries) {
      const delaySeconds = computeRetryDelaySeconds(attemptCount);

      // Update status to retrying (don't create DLQ yet)
      await executionLogger.updateStatus('retrying').catch(() => {});

      return {
        status: 'RETRYING',
        responseStatus: resp.status,
        errorMessage,
        nextAttemptAt: new Date(Date.now() + delaySeconds * 1000).toISOString(),
        attemptCount
      };
    }

    // Mark execution as success or failure
    if (deliveryStatus === 'SUCCESS') {
      await executionLogger.success({
        response: {
          statusCode: resp.status,
          body: responseBody
        }
      }).catch(() => {});
    } else {
      const error = new Error(errorMessage || `HTTP ${resp.status}`);
      error.code = resp.status === 429 ? 'RATE_LIMIT' : resp.status >= 500 ? 'SERVER_ERROR' : 'CLIENT_ERROR';
      error.statusCode = resp.status;
      await executionLogger.fail(error, {
        payload,
        statusCode: resp.status,
        response: { statusCode: resp.status, body: responseBody }
      }).catch(() => {});
    }

    return {
      status: deliveryStatus,
      responseStatus: resp.status,
      errorMessage,
      attemptCount,
      logId: null // Would need to capture log ID from recordLog
    };
  } catch (err) {
    const timeoutMs = integration.timeoutMs || config.worker?.timeoutMs || 10000;
    const responseTimeMs = Date.now() - start;
    const errorMessage = err.name === 'AbortError'
      ? `Request timeout after ${timeoutMs}ms`
      : err.message;

    // Log HTTP request failure
    await executionLogger.addStep('http_request', {
      status: 'failed',
      durationMs: responseTimeMs,
      error: { message: err.message, stack: err.stack, code: err.code }
    }).catch(() => {});

    // Record failure
    await data.recordLog(orgId, {
      __KEEP___KEEP_integrationConfig__Id__: integration.id,
      __KEEP_integrationName__: integration.name,
      eventType: scheduled.eventType,
      direction: 'OUTBOUND',
      triggerType: 'SCHEDULED',
      status: 'FAILED',
      responseStatus: 500,
      responseTimeMs,
      attemptCount,
      originalPayload: scheduled.originalPayload || payload,
      requestPayload: payload,
      errorMessage,
      targetUrl: scheduled.targetUrl,
      httpMethod: scheduled.httpMethod,
      correlationId: traceId,
      traceId: traceId,
      requestHeaders: null
    });

    const maxRetries = integration.retryCount || 3;
    if (attemptCount < maxRetries) {
      const delaySeconds = computeRetryDelaySeconds(attemptCount);

      // Update status to retrying (don't create DLQ yet)
      await executionLogger.updateStatus('retrying').catch(() => {});

      return {
        status: 'RETRYING',
        responseStatus: 500,
        errorMessage,
        nextAttemptAt: new Date(Date.now() + delaySeconds * 1000).toISOString(),
        attemptCount
      };
    }

    // Mark execution as failed with DLQ entry
    const error = new Error(err.message);
    error.code = err.code || (err.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_ERROR');
    error.stack = err.stack;
    error.statusCode = 500;
    await executionLogger.fail(error, {
      payload,
      statusCode: 500
    }).catch(() => {});

    return {
      status: 'FAILED',
      responseStatus: 500,
      errorMessage,
      attemptCount,
      logId: null
    };
  }
}

module.exports = {
  startSchedulerWorker
};
