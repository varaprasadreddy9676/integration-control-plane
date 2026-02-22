const { fetch, AbortController } = require('../utils/runtime');
const config = require('../config');
const data = require('../data');
const _mongodb = require('../mongodb');
const { log } = require('../logger');
const { applyTransform } = require('../services/transformer');
const { validateTargetUrl } = require('../utils/url-check');
const { buildAuthHeaders } = require('./auth-helper');
const { generateSignatureHeaders } = require('../services/integration-signing');
const { withTimeout } = require('../utils/timeout');
const { createExecutionLogger } = require('../utils/execution-logger');
const { checkRateLimit } = require('../middleware/rate-limiter');
const dlqData = require('../data/dlq');
const { evaluateCondition } = require('./condition-evaluator');
const { generateCorrelationId, sleep, isTestEvent, safeRead } = require('../utils/event-utils');

// Move dynamic require to top-level (was inside deliverSingleAction)
const adapterRegistry = require('../services/communication/adapter-registry');

async function resolveMultiActionDelayMs(orgId) {
  const defaultDelay = config.worker?.multiActionDelayMs || 0;

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
      error: err.message,
    });
  }

  return defaultDelay;
}

async function deliverSingleAction(
  integration,
  action,
  evt,
  pollCount = 0,
  actionIndex = 0,
  correlationId = null,
  executionLogger = null,
  options = {}
) {
  const prefix = pollCount > 0 ? `[POLL #${pollCount}] ` : '';
  const traceId = correlationId || generateCorrelationId();
  const actionName = action.name || `Action ${actionIndex + 1}`;
  const start = Date.now();
  const attemptCount = (evt.attempt_count || 0) + 1;
  const isTest = isTestEvent(evt);
  const triggerType = options.triggerType || 'EVENT';
  const existingLogId = options.existingLogId || null;
  const manualReason = options.retryReason || options.reason || null;
  const orgId = evt.orgId || integration.orgId;

  const maybeCreateActionDLQ = async ({ logId, errorMessage, errorCode, responseStatus, responseBody }) => {
    if (isTest) return;
    if (!errorMessage && !errorCode) return;

    try {
      await dlqData.createDLQEntry({
        traceId: traceId,
        messageId: evt.eventId || evt.id || null,
        integrationConfigId: integration.id,
        orgId,
        direction: integration.direction || 'OUTBOUND', // FIX: Use integration's direction
        payload: evt.payload,
        error: {
          message: errorMessage || 'Action delivery failed',
          code: errorCode || 'ACTION_FAILURE',
          statusCode: responseStatus || null,
        },
        metadata: {
          logId,
          actionName,
          actionIndex,
          eventType: evt.event_type,
          __KEEP_integrationName__: integration.name,
          targetUrl: action.targetUrl || integration.targetUrl,
          httpMethod:
            action.httpMethod || integration.httpMethod || (action.kind === 'COMMUNICATION' ? 'COMMUNICATION' : 'POST'),
          responseBody,
        },
      });
    } catch (err) {
      log('warn', 'Failed to create DLQ entry for action failure', {
        integrationId: integration.id,
        actionName,
        error: err.message,
      });
    }
  };

  // ============================================
  // EARLY CHECK: Handle COMMUNICATION actions first (skip URL validation)
  // ============================================
  const isCommunicationAction = action.kind === 'COMMUNICATION';
  const targetUrl = action.targetUrl || integration.targetUrl;

  // Validate target URL for HTTP actions only
  if (!isCommunicationAction) {
    const urlCheck = validateTargetUrl(targetUrl, config.security);
    if (!urlCheck.valid) {
      if (executionLogger) {
        await executionLogger
          .addStep('action_url_validation', {
            status: 'failed',
            durationMs: 0,
            metadata: { actionName, actionIndex, url: targetUrl },
            error: { message: urlCheck.reason },
          })
          .catch(() => {});
      }

      const logId = await data.recordLog(orgId, {
        id: existingLogId,
        __KEEP___KEEP_integrationConfig__Id__: integration.id,
        __KEEP_integrationName__: `${integration.name} - ${actionName}`,
        eventId: evt.id || null,
        eventType: evt.event_type,
        direction: integration.direction || 'OUTBOUND',
        triggerType,
        actionName,
        actionIndex,
        status: 'FAILED',
        responseStatus: 400,
        responseTimeMs: 0,
        attemptCount,
        originalPayload: evt.payload,
        requestPayload: evt.payload,
        errorMessage: `${prefix}${urlCheck.reason}`,
        targetUrl,
        httpMethod: action.httpMethod || integration.httpMethod || 'POST',
        // Distributed tracing
        correlationId: traceId,
        traceId: traceId,
        // Request details (not available yet at URL validation stage)
        requestHeaders: null,
      });
      await maybeCreateActionDLQ({
        logId,
        errorMessage: `${prefix}${urlCheck.reason}`,
        errorCode: 'INVALID_URL',
        responseStatus: 400,
      });
      return { status: 'FAILED', logId };
    }
  }

  // Apply action-specific or integration-level transformation
  let transformed = evt.payload;
  const transformStart = Date.now();
  try {
    if (action.transformation || action.transformationMode) {
      // Action has its own transformation
      const actionAsIntegration = {
        ...integration,
        transformation: action.transformation,
        transformationMode: action.transformationMode,
      };
      transformed = await applyTransform(actionAsIntegration, evt.payload, {
        eventType: evt.event_type,
        orgId,
      });
    } else {
      // Use integration-level transformation
      transformed = await applyTransform(integration, evt.payload, {
        eventType: evt.event_type,
        orgId,
      });
    }

    const transformedIsNull = transformed === null;
    if (executionLogger) {
      await executionLogger
        .addStep('action_transformation', {
          status: transformedIsNull ? 'warning' : 'success',
          durationMs: Date.now() - transformStart,
          metadata: { actionName, actionIndex, result: transformedIsNull ? 'skipped' : 'transformed' },
        })
        .catch(() => {});
    }

    if (transformedIsNull) {
      const skipMessage = `${prefix}Skipping delivery for ${actionName}: transformation returned null`;
      log('info', skipMessage, {
        integrationId: integration.id,
        actionName,
      });

      const logId = await data.recordLog(orgId, {
        id: existingLogId,
        __KEEP___KEEP_integrationConfig__Id__: integration.id,
        __KEEP_integrationName__: `${integration.name} - ${actionName}`,
        eventId: evt.id || null,
        eventType: evt.event_type,
        direction: integration.direction || 'OUTBOUND',
        triggerType,
        actionName,
        actionIndex,
        status: 'SKIPPED',
        responseStatus: 204,
        responseTimeMs: Date.now() - start,
        attemptCount,
        originalPayload: evt.payload,
        requestPayload: transformed,
        errorMessage: skipMessage,
        targetUrl,
        httpMethod: action.httpMethod || integration.httpMethod || 'POST',
        correlationId: traceId,
        traceId: traceId,
        requestHeaders: null,
      });

      await data.recordDeliverySuccess(integration.id);
      if (executionLogger) {
        await executionLogger.updateStatus('skipped').catch(() => {});
      }

      return { status: 'SKIPPED', logId };
    }
  } catch (err) {
    const errorMessage = `${prefix}Transform failed for ${actionName}: ${err.message}`;
    log('error', errorMessage, {
      integrationId: integration.id,
      actionName,
      stack: err.stack,
    });

    if (executionLogger) {
      await executionLogger
        .addStep('action_transformation', {
          status: 'failed',
          durationMs: Date.now() - transformStart,
          metadata: { actionName, actionIndex },
          error: { message: err.message, stack: err.stack },
        })
        .catch(() => {});
    }
    const logId = await data.recordLog(orgId, {
      id: existingLogId,
      __KEEP___KEEP_integrationConfig__Id__: integration.id,
      __KEEP_integrationName__: `${integration.name} - ${actionName}`,
      eventId: evt.id || null,
      eventType: evt.event_type,
      direction: integration.direction || 'OUTBOUND',
      triggerType,
      actionName,
      actionIndex,
      status: 'FAILED',
      responseStatus: 500,
      responseTimeMs: Date.now() - start,
      attemptCount,
      originalPayload: evt.payload,
      requestPayload: transformed,
      errorMessage,
      targetUrl,
      httpMethod: action.httpMethod || integration.httpMethod || 'POST',
      // Distributed tracing
      correlationId: traceId,
      traceId: traceId,
      // Request details (not available yet at transformation stage)
      requestHeaders: null,
    });
    await maybeCreateActionDLQ({
      logId,
      errorMessage,
      errorCode: 'TRANSFORMATION_ERROR',
      responseStatus: 500,
    });
    return { status: 'FAILED', logId };
  }

  // Rate limit check (per integration)
  if (integration.rateLimits?.enabled) {
    const rateStart = Date.now();
    try {
      const rateResult = await checkRateLimit(integration.id, orgId, integration.rateLimits);
      const durationMs = Date.now() - rateStart;
      const maxRequests = integration.rateLimits.maxRequests || 100;
      const windowSeconds = integration.rateLimits.windowSeconds || 60;

      if (executionLogger) {
        await executionLogger
          .addStep('rate_limit', {
            status: rateResult.allowed ? 'success' : 'failed',
            durationMs,
            metadata: {
              actionName,
              actionIndex,
              remaining: rateResult.remaining,
              resetAt: rateResult.resetAt,
              maxRequests,
              windowSeconds,
            },
            error: rateResult.allowed ? null : { message: 'Rate limit exceeded' },
          })
          .catch(() => {});
      }

      if (!rateResult.allowed) {
        const retryAfter = rateResult.retryAfter ? `, retry after ${rateResult.retryAfter}s` : '';
        const errorMessage = `${prefix}Rate limit exceeded${retryAfter}`;

        const logId = await data.recordLog(orgId, {
          id: existingLogId,
          __KEEP___KEEP_integrationConfig__Id__: integration.id,
          __KEEP_integrationName__: `${integration.name} - ${actionName}`,
          eventId: evt.id || null,
          eventType: evt.event_type,
          direction: integration.direction || 'OUTBOUND',
          triggerType,
          actionName,
          actionIndex,
          status: 'RETRYING',
          responseStatus: 429,
          responseTimeMs: 0,
          attemptCount,
          originalPayload: evt.payload,
          requestPayload: transformed,
          errorMessage,
          shouldRetry: true,
          targetUrl,
          httpMethod: action.httpMethod || integration.httpMethod || 'POST',
          correlationId: traceId,
          traceId: traceId,
          requestHeaders: null,
        });

        if (executionLogger) {
          await executionLogger.updateStatus('retrying').catch(() => {});
        }

        return { status: 'RETRYING', logId };
      }
    } catch (error) {
      log('warn', 'Rate limit check failed', {
        integrationId: integration.id,
        actionName,
        error: error.message,
      });
    }
  }

  // ============================================
  // NEW: Handle COMMUNICATION actions
  // ============================================
  if (action.kind === 'COMMUNICATION') {
    const communicationStart = Date.now();
    try {
      const { channel, provider, ...providerConfig } = action.communicationConfig;

      log('info', `${prefix}Delivering COMMUNICATION action via ${channel}:${provider}`, {
        integrationId: integration.id,
        actionName,
        channel,
        provider,
      });

      if (executionLogger) {
        await executionLogger
          .addStep('communication_delivery', {
            status: 'running',
            durationMs: 0,
            metadata: { actionName, actionIndex, channel, provider },
          })
          .catch(() => {});
      }

      // Normalize provider name to config key
      // SMTP → smtp, GMAIL_OAUTH → gmail, OUTLOOK_OAUTH → outlook, TWILIO → twilio
      const normalizeProviderKey = (providerName) => {
        const normalized = providerName.split('_')[0].toLowerCase(); // Take first part before underscore
        return normalized;
      };

      const providerKey = normalizeProviderKey(provider);

      // Send via communication adapter
      // Try provider-specific config first (e.g., "smtp", "gmail"), then fall back to entire config
      const adapterConfig = providerConfig[providerKey] || providerConfig;

      const result = await adapterRegistry.send(
        channel,
        provider,
        transformed, // Already transformed (should contain: to, subject, html, etc.)
        adapterConfig
      );

      const communicationTimeMs = Date.now() - communicationStart;

      if (executionLogger) {
        await executionLogger
          .addStep('communication_delivery', {
            status: 'success',
            durationMs: communicationTimeMs,
            metadata: {
              actionName,
              actionIndex,
              channel,
              provider,
              messageId: result.messageId,
            },
          })
          .catch(() => {});
      }

      // Record successful delivery log
      const logId = await data.recordLog(orgId, {
        id: existingLogId,
        __KEEP___KEEP_integrationConfig__Id__: integration.id,
        __KEEP_integrationName__: `${integration.name} - ${actionName}`,
        eventId: evt.id || null,
        eventType: evt.event_type,
        direction: 'COMMUNICATION', // Use COMMUNICATION direction for filtering
        triggerType,
        actionName,
        actionIndex,
        status: 'SUCCESS',
        responseStatus: 200,
        responseTimeMs: communicationTimeMs,
        attemptCount,
        originalPayload: evt.payload,
        requestPayload: transformed,
        responseBody: JSON.stringify(result, null, 2),
        targetUrl: `${channel}:${provider}`,
        httpMethod: 'COMMUNICATION',
        correlationId: traceId,
        traceId: traceId,
        messageId: result.messageId,
        requestHeaders: { channel, provider },
      });

      await data.recordDeliverySuccess(integration.id);

      if (executionLogger) {
        await executionLogger.updateStatus('success').catch(() => {});
      }

      log('info', `${prefix}COMMUNICATION action delivered successfully`, {
        integrationId: integration.id,
        actionName,
        messageId: result.messageId,
        responseTimeMs: communicationTimeMs,
      });

      return { status: 'SUCCESS', logId };
    } catch (error) {
      const errorMessage = `${prefix}COMMUNICATION delivery failed for ${actionName}: ${error.message}`;
      log('error', errorMessage, {
        integrationId: integration.id,
        actionName,
        error: error.message,
        stack: error.stack,
      });

      if (executionLogger) {
        await executionLogger
          .addStep('communication_delivery', {
            status: 'failed',
            durationMs: Date.now() - communicationStart,
            metadata: { actionName, actionIndex },
            error: { message: error.message, stack: error.stack },
          })
          .catch(() => {});
      }

      const logId = await data.recordLog(orgId, {
        id: existingLogId,
        __KEEP___KEEP_integrationConfig__Id__: integration.id,
        __KEEP_integrationName__: `${integration.name} - ${actionName}`,
        eventId: evt.id || null,
        eventType: evt.event_type,
        direction: 'COMMUNICATION', // Use COMMUNICATION direction for filtering
        triggerType,
        actionName,
        actionIndex,
        status: 'FAILED',
        responseStatus: 500,
        responseTimeMs: Date.now() - communicationStart,
        attemptCount,
        originalPayload: evt.payload,
        requestPayload: transformed,
        errorMessage,
        errorCode: 'COMMUNICATION_ERROR',
        targetUrl: action.communicationConfig
          ? `${action.communicationConfig.channel}:${action.communicationConfig.provider}`
          : 'unknown',
        httpMethod: 'COMMUNICATION',
        correlationId: traceId,
        traceId: traceId,
        requestHeaders: null,
      });

      await maybeCreateActionDLQ({
        logId,
        errorMessage,
        errorCode: 'COMMUNICATION_ERROR',
        responseStatus: 500,
      });

      if (executionLogger) {
        await executionLogger.updateStatus('failed').catch(() => {});
      }

      return { status: 'FAILED', logId };
    }
  }

  // ============================================
  // Existing: Handle HTTP actions
  // ============================================
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
    // DISTRIBUTED TRACING: Add correlation ID header
    headers['X-Correlation-ID'] = traceId;
    headers['X-Trace-ID'] = traceId;

    // WEBHOOK SIGNING: Generate signature for payload authentication
    if (integration.enableSigning && integration.signingSecrets && integration.signingSecrets.length > 0) {
      try {
        messageId = uuidv4(); // Unique message identifier
        timestamp = Math.floor(Date.now() / 1000); // Unix timestamp in seconds
        const payloadString = JSON.stringify(transformed); // Payload as string

        // Generate signature headers (supports multiple secrets for rotation)
        signatureHeaders = generateSignatureHeaders(integration.signingSecrets, messageId, timestamp, payloadString);

        // Add signature headers to request
        Object.assign(headers, signatureHeaders);

        log('debug', `${pollCount > 0 ? `[POLL #${pollCount}] ` : ''}Integration signature generated`, {
          messageId,
          timestamp,
          integrationId: integration.id,
          actionName,
          secretCount: integration.signingSecrets.length,
        });
      } catch (signError) {
        log('warn', `${pollCount > 0 ? `[POLL #${pollCount}] ` : ''}Failed to generate integration signature`, {
          error: signError.message,
          integrationId: integration.id,
          actionName,
        });
        // Continue delivery even if signing fails (graceful degradation)
      }
    }

    const resp = await fetch(targetUrl, {
      method: httpMethod,
      headers,
      body: JSON.stringify(transformed),
      signal: controller.signal,
    });

    clearTimeout(timer);
    const responseTimeMs = Date.now() - start;
    const statusOk = resp.status >= 200 && resp.status < 300;

    if (executionLogger) {
      await executionLogger
        .addStep('action_http_request', {
          status: statusOk ? 'success' : 'failed',
          durationMs: responseTimeMs,
          metadata: {
            actionName,
            actionIndex,
            statusCode: resp.status,
            method: httpMethod,
            url: targetUrl,
          },
          error: statusOk ? null : { message: `HTTP ${resp.status}` },
        })
        .catch(() => {});
    }

    // Check for token expiration in 200 OK responses (for multi-action)
    let tokenExpiredInBody = false;
    if (statusOk && integration.outgoingAuthConfig?.tokenExpirationDetection?.enabled) {
      try {
        const { extractValueByPath } = require('./auth-helper');
        const responseBody = await safeRead(resp);
        const detection = integration.outgoingAuthConfig.tokenExpirationDetection;

        const extractedValue = extractValueByPath(responseBody, detection.responseBodyPath || 'error');
        if (extractedValue && detection.expirationValues && detection.expirationValues.length > 0) {
          const valueStr = String(extractedValue).toLowerCase();
          const isExpired = detection.expirationValues.some((expVal) =>
            valueStr.includes(String(expVal).toLowerCase())
          );

          if (isExpired) {
            tokenExpiredInBody = true;
            log('info', 'Token expiration detected in 200 OK response (action)', {
              integrationId: integration._id?.toString(),
              actionName,
              extractedValue,
            });
          }
        }
      } catch (err) {
        log('warn', 'Failed to check token expiration in response body (action)', {
          error: err.message,
        });
      }
    }

    let shouldRetry = false;
    let errorMessage = statusOk ? null : 'Non-2xx response';

    // Handle token expiration detected in 200 OK response body
    if (tokenExpiredInBody) {
      shouldRetry = true;
      errorMessage = `${prefix}Token expired (detected in response body)`;

      if (integration.outgoingAuthType === 'OAUTH2' || integration.outgoingAuthType === 'CUSTOM') {
        const { clearCachedToken } = require('./auth-helper');
        clearCachedToken(integration._id).catch((err) => {
          log('warn', 'Failed to clear cached token after body expiration (action)', {
            integrationId: integration._id?.toString(),
            error: err.message,
          });
        });
        log('info', 'Cleared cached token after detecting expiration in response body (action)', {
          integrationId: integration._id?.toString(),
          actionName,
        });
      }
    } else if (!statusOk) {
      if (resp.status >= 500) {
        shouldRetry = true;
        errorMessage = `${prefix}Server error: ${resp.status}`;
      } else if (resp.status === 429) {
        shouldRetry = true;
        errorMessage = `${prefix}Rate limited`;
      } else if (resp.status === 401 || resp.status === 403) {
        // Authentication/authorization errors - clear cached token and retry
        shouldRetry = true;
        errorMessage = `${prefix}Auth error: ${resp.status} - Token may be expired`;

        // Clear cached token for OAuth2/Custom auth (async, don't wait)
        if (integration.outgoingAuthType === 'OAUTH2' || integration.outgoingAuthType === 'CUSTOM') {
          const { clearCachedToken } = require('./auth-helper');
          clearCachedToken(integration._id).catch((err) => {
            log('warn', 'Failed to clear cached token after auth error (action)', {
              integrationId: integration._id?.toString(),
              status: resp.status,
              error: err.message,
            });
          });
          log('info', 'Cleared cached token after auth error (action)', {
            integrationId: integration._id?.toString(),
            status: resp.status,
            authType: integration.outgoingAuthType,
            actionName,
          });
        }
      } else if (resp.status >= 400 && resp.status < 500) {
        shouldRetry = false;
        errorMessage = `${prefix}Client error: ${resp.status}`;
      }
    }
    if (isTest && !statusOk) {
      shouldRetry = false;
      errorMessage = `${prefix}Test event - not retrying`;
    }

    // Check if we've reached max retries and mark as ABANDONED
    // Note: attemptCount is already incremented (current attempt)
    // maxRetries is the TOTAL number of attempts allowed
    // So if maxRetries=3, we allow attempts 1, 2, 3 (stop at 4)
    const maxRetries = integration.retryCount || 3;
    let finalStatus = statusOk ? 'SUCCESS' : shouldRetry ? 'RETRYING' : 'FAILED';
    if (shouldRetry && attemptCount > maxRetries) {
      finalStatus = 'ABANDONED';
      errorMessage = `${errorMessage} - Max retries (${maxRetries}) reached`;
    }

    const responseBody = await safeRead(resp);
    const attemptDetails =
      attemptCount > 1
        ? {
            attemptNumber: attemptCount,
            requestHeaders: headers,
            targetUrl,
            httpMethod,
            retryReason: manualReason || (shouldRetry ? errorMessage : null),
          }
        : null;

    const logId = await data.recordLog(orgId, {
      id: existingLogId,
      __KEEP___KEEP_integrationConfig__Id__: integration.id,
      __KEEP_integrationName__: `${integration.name} - ${actionName}`,
      eventId: evt.id || null,
      eventType: evt.event_type,
      direction: 'OUTBOUND',
      triggerType,
      actionName,
      actionIndex,
      status: finalStatus,
      responseStatus: resp.status,
      responseTimeMs,
      attemptCount,
      originalPayload: evt.payload, // Store original payload from notification_queue
      requestPayload: transformed, // Store transformed payload actually sent
      responseBody,
      errorMessage,
      shouldRetry: shouldRetry && attemptCount <= maxRetries, // Don't retry if exceeded max
      targetUrl,
      httpMethod,
      // Distributed tracing
      correlationId: traceId,
      traceId: traceId,
      // Request details for debugging
      requestHeaders: headers,
      attemptDetails,
      // Integration signing audit trail
      messageId,
      timestamp,
      signature: signatureHeaders ? signatureHeaders['X-Integration-Signature'] : null,
      signatureHeaders,
    });

    // CIRCUIT BREAKER: Record success or failure
    if (finalStatus === 'SUCCESS') {
      await data.recordDeliverySuccess(integration.id);
    } else {
      // Only trip circuit breaker on infrastructure failures (5xx errors), not business logic failures (4xx errors)
      const shouldTripCircuit = resp.status >= 500 || resp.status === 429; // 5xx or rate limit
      await data.recordDeliveryFailure(integration.id, { shouldTripCircuit });
    }

    if (finalStatus === 'FAILED' || finalStatus === 'ABANDONED') {
      const errorCode =
        resp.status === 429
          ? 'RATE_LIMIT'
          : resp.status >= 500
            ? 'SERVER_ERROR'
            : resp.status >= 400
              ? 'CLIENT_ERROR'
              : 'HTTP_ERROR';
      await maybeCreateActionDLQ({
        logId,
        errorMessage,
        errorCode,
        responseStatus: resp.status,
        responseBody,
      });
    }

    return { status: finalStatus, logId };
  } catch (err) {
    const catchErrorMessage = `${prefix}${actionName} delivery failed: ${err.message}`;
    log('error', catchErrorMessage, {
      integrationId: integration.id,
      actionName,
      stack: err.stack,
    });

    if (executionLogger) {
      await executionLogger
        .addStep('action_http_request', {
          status: 'failed',
          durationMs: Date.now() - start,
          metadata: { actionName, actionIndex },
          error: { message: err.message, stack: err.stack, code: err.code },
        })
        .catch(() => {});
    }

    // Network/connection errors should be retried (timeout, DNS, connection refused, etc.)
    const maxRetries = integration.retryCount || 3;
    // attemptCount > maxRetries means we've exceeded the limit
    const finalStatus = isTest ? 'FAILED' : attemptCount > maxRetries ? 'ABANDONED' : 'RETRYING';
    const finalErrorMessage = isTest
      ? `${catchErrorMessage} - Test event (no retry)`
      : attemptCount > maxRetries
        ? `${catchErrorMessage} - Max retries (${maxRetries}) reached`
        : catchErrorMessage;

    const logId = await data.recordLog(orgId, {
      id: existingLogId,
      __KEEP___KEEP_integrationConfig__Id__: integration.id,
      __KEEP_integrationName__: `${integration.name} - ${actionName}`,
      eventId: evt.id || null,
      eventType: evt.event_type,
      direction: 'OUTBOUND',
      triggerType,
      actionName,
      actionIndex,
      status: finalStatus,
      responseStatus: 500,
      responseTimeMs: Date.now() - start,
      attemptCount,
      originalPayload: evt.payload,
      requestPayload: transformed,
      errorMessage: finalErrorMessage,
      targetUrl,
      httpMethod: action.httpMethod || integration.httpMethod || 'POST',
      // Distributed tracing
      correlationId: traceId,
      traceId: traceId,
      // Request details for debugging
      requestHeaders: headers || null,
      attemptDetails:
        attemptCount > 1
          ? {
              attemptNumber: attemptCount,
              requestHeaders: headers || null,
              targetUrl,
              httpMethod: action.httpMethod || integration.httpMethod || 'POST',
              retryReason: manualReason || (finalStatus === 'RETRYING' ? finalErrorMessage : null),
            }
          : null,
      // Integration signing audit trail
      messageId,
      timestamp,
      signature: signatureHeaders ? signatureHeaders['X-Integration-Signature'] : null,
      signatureHeaders,
    });

    // CIRCUIT BREAKER: Always record failure on exceptions
    await data.recordDeliveryFailure(integration.id);

    if (finalStatus === 'FAILED' || finalStatus === 'ABANDONED') {
      const errorCode =
        err.code === 'ETIMEDOUT' || err.code === 'ECONNABORTED'
          ? 'TIMEOUT'
          : err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND'
            ? 'NETWORK_ERROR'
            : 'NETWORK_ERROR';
      await maybeCreateActionDLQ({
        logId,
        errorMessage: finalErrorMessage,
        errorCode,
        responseStatus: 500,
      });
    }

    return { status: finalStatus, logId };
  }
}

/**
 * Process multi-action integration - execute multiple actions sequentially
 */

async function deliverMultiActionIntegration(
  integration,
  evt,
  pollCount = 0,
  correlationId = null,
  executionLogger = null
) {
  const prefix = pollCount > 0 ? `[POLL #${pollCount}] ` : '';
  const traceId = correlationId || generateCorrelationId();
  const actions = integration.actions || [];
  const orgId = evt.orgId || integration.orgId;
  const multiActionDelayMs = await resolveMultiActionDelayMs(orgId);

  log('info', `${prefix}Processing multi-action integration`, {
    correlationId: traceId,
    integrationId: integration.id,
    __KEEP_integrationName__: integration.name,
    actionCount: actions.length,
  });

  const results = [];
  const logIds = [];
  let successCount = 0;
  let failureCount = 0;
  let skippedCount = 0;

  for (let i = 0; i < actions.length; i++) {
    const action = actions[i];
    const actionName = action.name || `Action ${i + 1}`;

    // Evaluate condition if present
    const conditionContext = {
      eventType: evt.event_type,
      orgId,
      payload: evt.payload,
    };

    const shouldExecute = evaluateCondition(action.condition, conditionContext);

    if (!shouldExecute) {
      if (executionLogger) {
        await executionLogger
          .addStep('action_condition', {
            status: 'warning',
            durationMs: 0,
            metadata: {
              actionName,
              actionIndex: i,
              result: 'skipped',
            },
          })
          .catch(() => {});
      }

      log('info', `${prefix}Skipping action due to condition`, {
        actionName,
        condition: action.condition,
      });
      results.push({ action: actionName, status: 'SKIPPED' });
      continue;
    }

    if (executionLogger) {
      await executionLogger
        .addStep('action_condition', {
          status: 'success',
          durationMs: 0,
          metadata: {
            actionName,
            actionIndex: i,
            result: 'executed',
          },
        })
        .catch(() => {});
    }

    log('info', `${prefix}Executing action`, {
      actionName,
      targetUrl: action.targetUrl || integration.targetUrl,
    });

    // eslint-disable-next-line no-await-in-loop
    const result = await deliverSingleAction(integration, action, evt, pollCount, i, traceId, executionLogger, {
      triggerType: 'EVENT',
    });
    const actionStatus = result?.status || 'FAILED';
    results.push({ action: actionName, status: actionStatus });
    if (result?.logId) {
      logIds.push(result.logId);
    }

    if (actionStatus === 'SUCCESS') {
      successCount++;
    } else if (actionStatus === 'SKIPPED') {
      skippedCount++;
    } else {
      failureCount++;
    }

    if (multiActionDelayMs > 0 && i < actions.length - 1) {
      // eslint-disable-next-line no-await-in-loop
      await sleep(multiActionDelayMs);
    }
  }

  log('info', `${prefix}Multi-action integration completed`, {
    integrationId: integration.id,
    successCount,
    failureCount,
    skippedCount,
    results,
  });

  // Return overall status and record circuit breaker state
  let overallStatus;
  if (failureCount === 0 && successCount > 0) {
    overallStatus = 'SUCCESS';
    // CIRCUIT BREAKER: All actions succeeded - reset circuit
    await data.recordDeliverySuccess(integration.id);
  } else if (successCount > 0 && failureCount > 0) {
    overallStatus = 'PARTIAL_SUCCESS';
    // CIRCUIT BREAKER: Partial failure - treat as failure
    await data.recordDeliveryFailure(integration.id);
  } else if (failureCount === 0 && successCount === 0 && skippedCount > 0) {
    overallStatus = 'SKIPPED';
    // CIRCUIT BREAKER: Skipped actions should not count as failure
    await data.recordDeliverySuccess(integration.id);
  } else {
    overallStatus = 'FAILED';
    // CIRCUIT BREAKER: All actions failed - record failure
    await data.recordDeliveryFailure(integration.id);
  }

  if (executionLogger) {
    const hasRetrying = results.some((result) => result.status === 'RETRYING');
    if (overallStatus === 'SUCCESS') {
      await executionLogger
        .success({
          response: {
            statusCode: 200,
            body: { results },
          },
          metadata: { successCount, failureCount, skippedCount },
        })
        .catch(() => {});
    } else if (overallStatus === 'SKIPPED') {
      await executionLogger.updateStatus('skipped').catch(() => {});
    } else if (hasRetrying) {
      await executionLogger.updateStatus('retrying').catch(() => {});
    } else {
      const error = new Error(
        overallStatus === 'PARTIAL_SUCCESS' ? 'One or more actions failed' : 'All actions failed'
      );
      error.code = overallStatus === 'PARTIAL_SUCCESS' ? 'PARTIAL_FAILURE' : 'ACTION_FAILURE';
      await executionLogger
        .fail(error, {
          createDLQ: false,
          response: {
            statusCode: 500,
            body: { results },
          },
          metadata: { successCount, failureCount, skippedCount },
        })
        .catch(() => {});
    }
  }

  return { status: overallStatus, logIds };
}

async function deliverToIntegration(
  integration,
  evt,
  isReplay = false,
  pollCount = 0,
  existingLogId = null,
  correlationId = null,
  returnLogId = false,
  options = {}
) {
  const prefix = pollCount > 0 ? `[POLL #${pollCount}] ` : '';
  const traceId = correlationId || generateCorrelationId();
  const buildResult = (status, logId = null, logIds = null) => (returnLogId ? { status, logId, logIds } : status);
  const forceDelivery = Boolean(options.forceDelivery || options.force || options.ignoreCircuit || evt?.forceDelivery);
  const allowBypassCircuit = forceDelivery && isReplay;
  const retryReason = options.retryReason || options.reason || null;
  const orgId = evt.orgId || integration.orgId;
  const buildAttemptDetails = (requestHeaders, targetUrl, httpMethod) => {
    if (!existingLogId) return null;
    return {
      attemptNumber: (evt.attempt_count || 0) + 1,
      requestHeaders: requestHeaders || null,
      targetUrl,
      httpMethod: httpMethod || 'POST',
      retryReason,
    };
  };

  // Create execution logger for new DLQ + trace viewer system
  const executionLogger = createExecutionLogger({
    traceId,
    direction: 'OUTBOUND',
    triggerType: isReplay ? 'REPLAY' : 'EVENT',
    integrationConfigId: integration.id,
    integrationName: integration.name,
    eventType: evt.event_type,
    eventId: evt.id || evt.eventId || null,
    orgId,
    messageId: evt.eventId || evt.id || null,
    request: {
      url: integration.targetUrl,
      method: integration.httpMethod || 'POST',
      headers: {},
      body: evt.payload,
    },
  });

  // Check if this is a multi-action integration (check early to avoid creating parent log)
  const isMultiAction = integration.actions && Array.isArray(integration.actions) && integration.actions.length > 0;

  // Start execution logging (non-blocking - failures won't stop delivery)
  // Skip creating parent log for multi-action integrations - each action will create its own log
  const executionLogId = !isMultiAction
    ? await executionLogger.start().catch((err) => {
        log('warn', 'Failed to start execution logger', { error: err.message, traceId });
        return null;
      })
    : null;

  // Use execution log ID for updates instead of creating new logs
  const logIdForUpdates = executionLogId || existingLogId;

  // CIRCUIT BREAKER: Check if circuit is open before attempting delivery
  const circuitStatus = await data.checkCircuitState(integration.id);
  if (circuitStatus.isOpen && !allowBypassCircuit) {
    log('warn', `${prefix}Circuit breaker is OPEN - skipping delivery`, {
      correlationId: traceId,
      integrationId: integration.id,
      __KEEP_integrationName__: integration.name,
      circuitState: circuitStatus.state,
      reason: circuitStatus.reason,
    });
    const logId = await data.recordLog(orgId, {
      id: logIdForUpdates,
      __KEEP___KEEP_integrationConfig__Id__: integration.id,
      __KEEP_integrationName__: integration.name,
      eventId: evt.id || null,
      eventType: evt.event_type,
      status: 'FAILED',
      responseStatus: 503,
      responseTimeMs: 0,
      attemptCount: (evt.attempt_count || 0) + 1,
      originalPayload: evt.payload,
      requestPayload: evt.payload,
      errorMessage: `${prefix}Circuit breaker OPEN: ${circuitStatus.reason}`,
      targetUrl: integration.targetUrl || integration.actions?.[0]?.targetUrl,
      httpMethod: integration.httpMethod || 'POST',
      attemptDetails: buildAttemptDetails(
        null,
        integration.targetUrl || integration.actions?.[0]?.targetUrl,
        integration.httpMethod || 'POST'
      ),
      // Distributed tracing
      correlationId: traceId,
      traceId: traceId,
      // Request details (not attempted due to circuit breaker)
      requestHeaders: null,
    });
    return buildResult('FAILED', logId);
  }

  if (circuitStatus.isOpen && allowBypassCircuit) {
    log('warn', `${prefix}Force retry requested - bypassing OPEN circuit`, {
      correlationId: traceId,
      integrationId: integration.id,
      __KEEP_integrationName__: integration.name,
      circuitState: circuitStatus.state,
      reason: circuitStatus.reason,
    });
  }

  log('debug', `${prefix}Circuit breaker check passed`, {
    correlationId: traceId,
    integrationId: integration.id,
    circuitState: circuitStatus.state,
  });

  // Handle multi-action integration (each action creates its own log, no parent log needed)
  if (isMultiAction) {
    const result = await deliverMultiActionIntegration(integration, evt, pollCount, traceId, executionLogger);
    if (typeof result === 'string') {
      return buildResult(result, null, null);
    }
    return buildResult(result.status, null, result.logIds || null);
  }

  // Legacy single-action integration delivery
  const urlCheck = validateTargetUrl(integration.targetUrl, config.security);
  if (!urlCheck.valid) {
    // Log validation step failure
    await executionLogger
      .addStep('url_validation', {
        status: 'failed',
        durationMs: 0,
        error: { message: urlCheck.reason },
      })
      .catch(() => {});

    const logId = await data.recordLog(orgId, {
      id: logIdForUpdates,
      __KEEP___KEEP_integrationConfig__Id__: integration.id,
      __KEEP_integrationName__: integration.name,
      eventId: evt.id || null,
      eventType: evt.event_type,
      status: 'FAILED',
      responseStatus: 400,
      responseTimeMs: 0,
      attemptCount: (evt.attempt_count || 0) + 1,
      originalPayload: evt.payload,
      requestPayload: evt.payload,
      errorMessage: `${prefix}${urlCheck.reason}`,
      targetUrl: integration.targetUrl,
      httpMethod: integration.httpMethod || 'POST',
      attemptDetails: buildAttemptDetails(logIdForUpdates, integration.targetUrl, integration.httpMethod || 'POST'),
      // Distributed tracing
      correlationId: traceId,
      traceId: traceId,
      // Request details (not available yet at URL validation stage)
      requestHeaders: null,
    });
    // CIRCUIT BREAKER: Don't trip circuit for URL validation errors (business logic failure)
    await data.recordDeliveryFailure(integration.id, { shouldTripCircuit: false });

    // Mark execution as failed with DLQ entry
    const error = new Error(urlCheck.reason);
    error.code = 'INVALID_URL';
    await executionLogger
      .fail(error, {
        payload: evt.payload,
        statusCode: 400,
      })
      .catch(() => {});

    return buildResult('FAILED', logId);
  }

  // Log successful URL validation
  await executionLogger
    .addStep('url_validation', {
      status: 'success',
      durationMs: 0,
    })
    .catch(() => {});

  const start = Date.now();
  let transformed = evt.payload;
  let errorMessage;
  const transformStart = Date.now();
  try {
    transformed = await applyTransform(integration, evt.payload, {
      eventType: evt.event_type,
      orgId,
    });
    const transformedIsNull = transformed === null;
    // Log transformation (success or skipped)
    await executionLogger
      .addStep('transformation', {
        status: transformedIsNull ? 'warning' : 'success',
        durationMs: Date.now() - transformStart,
        metadata: { result: transformedIsNull ? 'skipped' : 'transformed' },
      })
      .catch(() => {});
  } catch (err) {
    errorMessage = `${prefix}Transform failed: ${err.message}`;
    log('error', errorMessage, {
      integrationId: integration.id,
      __KEEP_integrationName__: integration.name,
      eventType: evt.event_type,
      pollCount,
      stack: err.stack,
    });

    // Log transformation failure
    await executionLogger
      .addStep('transformation', {
        status: 'failed',
        durationMs: Date.now() - transformStart,
        error: { message: err.message, stack: err.stack },
      })
      .catch(() => {});
  }

  if (errorMessage) {
    const logId = await data.recordLog(orgId, {
      id: logIdForUpdates,
      __KEEP___KEEP_integrationConfig__Id__: integration.id,
      __KEEP_integrationName__: integration.name,
      eventId: evt.id || null,
      eventType: evt.event_type,
      status: 'FAILED',
      responseStatus: 500,
      responseTimeMs: Date.now() - start,
      attemptCount: (evt.attempt_count || 0) + 1,
      originalPayload: evt.payload,
      requestPayload: transformed,
      errorMessage,
      targetUrl: integration.targetUrl,
      httpMethod: integration.httpMethod || 'POST',
      attemptDetails: buildAttemptDetails(logIdForUpdates, integration.targetUrl, integration.httpMethod || 'POST'),
      // Distributed tracing
      correlationId: traceId,
      traceId: traceId,
      // Request details (not available yet at transformation stage)
      requestHeaders: null,
    });
    // CIRCUIT BREAKER: Don't trip circuit for transformation errors (business logic failure)
    await data.recordDeliveryFailure(integration.id, { shouldTripCircuit: false });

    // Mark execution as failed with DLQ entry
    const error = new Error(errorMessage);
    error.code = 'TRANSFORMATION_ERROR';
    await executionLogger
      .fail(error, {
        payload: evt.payload,
        statusCode: 500,
      })
      .catch(() => {});

    return buildResult('FAILED', logId);
  }

  if (transformed === null) {
    const skipMessage = `${prefix}Skipping delivery: transformation returned null`;
    log('info', skipMessage, {
      integrationId: integration.id,
      __KEEP_integrationName__: integration.name,
      eventType: evt.event_type,
    });

    const logId = await data.recordLog(orgId, {
      id: logIdForUpdates,
      __KEEP___KEEP_integrationConfig__Id__: integration.id,
      __KEEP_integrationName__: integration.name,
      eventId: evt.id || null,
      eventType: evt.event_type,
      status: 'SKIPPED',
      responseStatus: 204,
      responseTimeMs: Date.now() - start,
      attemptCount: (evt.attempt_count || 0) + 1,
      originalPayload: evt.payload,
      requestPayload: transformed,
      errorMessage: skipMessage,
      targetUrl: integration.targetUrl,
      httpMethod: integration.httpMethod || 'POST',
      attemptDetails: buildAttemptDetails(logIdForUpdates, integration.targetUrl, integration.httpMethod || 'POST'),
      correlationId: traceId,
      traceId: traceId,
      requestHeaders: null,
    });

    await data.recordDeliverySuccess(integration.id);
    await executionLogger.updateStatus('skipped').catch(() => {});

    return buildResult('SKIPPED', logId);
  }

  // Rate limit check (per integration)
  if (integration.rateLimits?.enabled) {
    const rateStart = Date.now();
    try {
      const rateResult = await checkRateLimit(integration.id, orgId, integration.rateLimits);
      const durationMs = Date.now() - rateStart;
      const maxRequests = integration.rateLimits.maxRequests || 100;
      const windowSeconds = integration.rateLimits.windowSeconds || 60;

      await executionLogger
        .addStep('rate_limit', {
          status: rateResult.allowed ? 'success' : 'failed',
          durationMs,
          metadata: {
            remaining: rateResult.remaining,
            resetAt: rateResult.resetAt,
            maxRequests,
            windowSeconds,
          },
          error: rateResult.allowed ? null : { message: 'Rate limit exceeded' },
        })
        .catch(() => {});

      if (!rateResult.allowed) {
        const attemptCount = (evt.attempt_count || 0) + 1;
        const retryAfter = rateResult.retryAfter ? `, retry after ${rateResult.retryAfter}s` : '';
        const errorMessage = `${prefix}Rate limit exceeded${retryAfter}`;

        const logId = await data.recordLog(orgId, {
          id: existingLogId,
          __KEEP___KEEP_integrationConfig__Id__: integration.id,
          __KEEP_integrationName__: integration.name,
          eventId: evt.id || null,
          eventType: evt.event_type,
          status: 'RETRYING',
          responseStatus: 429,
          responseTimeMs: 0,
          attemptCount,
          originalPayload: evt.payload,
          requestPayload: transformed,
          errorMessage,
          shouldRetry: true,
          targetUrl: integration.targetUrl,
          httpMethod: integration.httpMethod || 'POST',
          attemptDetails: buildAttemptDetails(null, integration.targetUrl, integration.httpMethod || 'POST'),
          correlationId: traceId,
          traceId: traceId,
          requestHeaders: null,
        });

        await executionLogger.updateStatus('retrying').catch(() => {});
        return buildResult('RETRYING', logId);
      }
    } catch (error) {
      log('warn', 'Rate limit check failed', {
        integrationId: integration.id,
        error: error.message,
      });
    }
  }

  // Declare variables before try block for catch block access
  let headers = null;
  let messageId = null;
  let timestamp = null;
  let signatureHeaders = null;
  const isTest = isTestEvent(evt);

  try {
    const controller = new AbortController();
    const timeout = integration.timeoutMs || config.worker?.timeoutMs || 10000;
    const timer = setTimeout(() => controller.abort(), timeout);

    // Build headers with authentication
    const httpMethod = integration.httpMethod || 'POST';
    headers = await buildAuthHeaders(integration, httpMethod, integration.targetUrl);
    headers['Content-Type'] = 'application/json';
    // DISTRIBUTED TRACING: Add correlation ID header
    headers['X-Correlation-ID'] = traceId;
    headers['X-Trace-ID'] = traceId;

    // WEBHOOK SIGNING: Generate signature for payload authentication

    if (integration.enableSigning && integration.signingSecrets && integration.signingSecrets.length > 0) {
      try {
        messageId = uuidv4(); // Unique message identifier
        timestamp = Math.floor(Date.now() / 1000); // Unix timestamp in seconds
        const payloadString = JSON.stringify(transformed); // Payload as string

        // Generate signature headers (supports multiple secrets for rotation)
        signatureHeaders = generateSignatureHeaders(integration.signingSecrets, messageId, timestamp, payloadString);

        // Add signature headers to request
        Object.assign(headers, signatureHeaders);

        log('debug', `${prefix}Integration signature generated`, {
          messageId,
          timestamp,
          integrationId: integration.id,
          __KEEP_integrationName__: integration.name,
          secretCount: integration.signingSecrets.length,
        });
      } catch (signError) {
        log('warn', `${prefix}Failed to generate integration signature`, {
          error: signError.message,
          integrationId: integration.id,
          __KEEP_integrationName__: integration.name,
        });
        // Continue delivery even if signing fails (graceful degradation)
      }
    }

    const httpStart = Date.now();
    const resp = await fetch(integration.targetUrl, {
      method: httpMethod,
      headers,
      body: JSON.stringify(transformed),
      signal: controller.signal,
    });
    clearTimeout(timer);
    const responseTimeMs = Date.now() - start;
    const httpDuration = Date.now() - httpStart;
    const statusOk = resp.status >= 200 && resp.status < 300;
    const attemptCount = (evt.attempt_count || 0) + 1;

    // Log HTTP request step
    await executionLogger
      .addStep('http_request', {
        status: statusOk ? 'success' : 'failed',
        durationMs: httpDuration,
        metadata: {
          statusCode: resp.status,
          method: httpMethod,
          url: integration.targetUrl,
        },
        error: statusOk ? null : { message: `HTTP ${resp.status}` },
      })
      .catch(() => {});

    // Check for token expiration in 200 OK responses (some APIs return errors in response body)
    let tokenExpiredInBody = false;
    if (statusOk && integration.outgoingAuthConfig?.tokenExpirationDetection?.enabled) {
      try {
        const { extractValueByPath } = require('./auth-helper');
        const responseBody = await safeRead(resp);
        const detection = integration.outgoingAuthConfig.tokenExpirationDetection;

        // Extract value from response using configured path
        const extractedValue = extractValueByPath(responseBody, detection.responseBodyPath || 'error');

        // Check if extracted value matches any configured expiration values
        if (extractedValue && detection.expirationValues && detection.expirationValues.length > 0) {
          const valueStr = String(extractedValue).toLowerCase();
          const isExpired = detection.expirationValues.some((expVal) =>
            valueStr.includes(String(expVal).toLowerCase())
          );

          if (isExpired) {
            tokenExpiredInBody = true;
            log('info', 'Token expiration detected in 200 OK response body', {
              integrationId: integration._id?.toString(),
              extractedValue,
              bodyPath: detection.responseBodyPath,
              expirationValues: detection.expirationValues,
            });
          }
        }
      } catch (err) {
        log('warn', 'Failed to check token expiration in response body', {
          integrationId: integration._id?.toString(),
          error: err.message,
        });
      }
    }

    // Industry-standard status code intelligence
    let shouldRetry = false;
    let errorMessage = statusOk ? null : 'Non-2xx response';

    // Handle token expiration detected in 200 OK response body
    if (tokenExpiredInBody) {
      shouldRetry = true;
      errorMessage = `${prefix}Token expired (detected in response body)`;

      // Clear cached token for OAuth2/Custom auth (async, don't wait)
      if (integration.outgoingAuthType === 'OAUTH2' || integration.outgoingAuthType === 'CUSTOM') {
        const { clearCachedToken } = require('./auth-helper');
        clearCachedToken(integration._id).catch((err) => {
          log('warn', 'Failed to clear cached token after body expiration detection', {
            integrationId: integration._id?.toString(),
            error: err.message,
          });
        });
        log('info', 'Cleared cached token after detecting expiration in response body', {
          integrationId: integration._id?.toString(),
          authType: integration.outgoingAuthType,
        });
      }
    } else if (!statusOk) {
      if (resp.status >= 500) {
        shouldRetry = true; // Server errors - retry
        errorMessage = `${prefix}Server error: ${resp.status}`;
      } else if (resp.status === 429) {
        shouldRetry = true; // Rate limit - retry with longer delay
        errorMessage = `${prefix}Rate limited`;
      } else if (resp.status === 401 || resp.status === 403) {
        // Authentication/authorization errors - clear cached token and retry
        shouldRetry = true;
        errorMessage = `${prefix}Auth error: ${resp.status} - Token may be expired`;

        // Clear cached token for OAuth2/Custom auth (async, don't wait)
        if (integration.outgoingAuthType === 'OAUTH2' || integration.outgoingAuthType === 'CUSTOM') {
          const { clearCachedToken } = require('./auth-helper');
          clearCachedToken(integration._id).catch((err) => {
            log('warn', 'Failed to clear cached token after auth error', {
              integrationId: integration._id?.toString(),
              status: resp.status,
              error: err.message,
            });
          });
          log('info', 'Cleared cached token after auth error', {
            integrationId: integration._id?.toString(),
            status: resp.status,
            authType: integration.outgoingAuthType,
          });
        }
      } else if (resp.status >= 400 && resp.status < 500) {
        shouldRetry = false; // Client errors - don't retry
        errorMessage = `${prefix}Client error: ${resp.status}`;
      }
    }
    if (isTest && !statusOk) {
      shouldRetry = false;
      errorMessage = `${prefix}Test event - not retrying`;
    }

    // Check if we've reached max retries and mark as ABANDONED
    // Note: attemptCount is already incremented (current attempt)
    // maxRetries is the TOTAL number of attempts allowed
    // So if maxRetries=3, we allow attempts 1, 2, 3 (stop at 4)
    const maxRetries = integration.retryCount || 3;
    let finalStatus = statusOk ? 'SUCCESS' : shouldRetry ? 'RETRYING' : 'FAILED';
    if (shouldRetry && attemptCount > maxRetries) {
      finalStatus = 'ABANDONED';
      errorMessage = `${errorMessage} - Max retries (${maxRetries}) reached`;
    }

    const logId = await data.recordLog(orgId, {
      id: logIdForUpdates,
      __KEEP___KEEP_integrationConfig__Id__: integration.id,
      __KEEP_integrationName__: integration.name,
      eventId: evt.id || null,
      eventType: evt.event_type,
      status: finalStatus,
      responseStatus: resp.status,
      responseTimeMs,
      attemptCount,
      originalPayload: evt.payload,
      requestPayload: transformed,
      responseBody: await safeRead(resp),
      errorMessage: errorMessage,
      shouldRetry: shouldRetry && attemptCount <= maxRetries, // Don't retry if exceeded max
      targetUrl: integration.targetUrl,
      httpMethod: integration.httpMethod || 'POST',
      attemptDetails: buildAttemptDetails(logIdForUpdates, integration.targetUrl, httpMethod),
      // Distributed tracing
      correlationId: traceId,
      traceId: traceId,
      // Request details for debugging
      requestHeaders: headers,
      // Integration signing audit trail
      messageId,
      timestamp,
      signature: signatureHeaders ? signatureHeaders['X-Integration-Signature'] : null,
      signatureHeaders,
    });

    // CIRCUIT BREAKER: Record success or failure based on final status
    if (statusOk) {
      await data.recordDeliverySuccess(integration.id);

      // Mark execution as successful
      await executionLogger
        .success({
          response: {
            statusCode: resp.status,
            body: await safeRead(resp),
          },
        })
        .catch(() => {});

      return buildResult('SUCCESS', logId);
    } else {
      // Only trip circuit breaker on infrastructure failures (5xx errors), not business logic failures (4xx errors)
      const shouldTripCircuit = resp.status >= 500 || resp.status === 429; // 5xx or rate limit
      await data.recordDeliveryFailure(integration.id, { shouldTripCircuit });

      // Mark execution as failed with DLQ entry (only if not retrying or already at max retries)
      if (!shouldRetry || attemptCount > maxRetries) {
        const error = new Error(errorMessage || `HTTP ${resp.status}`);
        error.code = resp.status === 429 ? 'RATE_LIMIT' : resp.status >= 500 ? 'SERVER_ERROR' : 'CLIENT_ERROR';
        error.statusCode = resp.status;
        await executionLogger
          .fail(error, {
            payload: evt.payload,
            statusCode: resp.status,
            response: { statusCode: resp.status, body: await safeRead(resp) },
          })
          .catch(() => {});
      } else {
        // For retrying status, update execution log but don't create DLQ yet
        await executionLogger.updateStatus('retrying').catch(() => {});
      }

      if (shouldRetry) {
        return buildResult('RETRYING', logId);
      } else {
        return buildResult('FAILED', logId);
      }
    }
  } catch (err) {
    const catchErrorMessage = `${prefix}${err.message}`;
    log('error', catchErrorMessage, {
      integrationId: integration.id,
      __KEEP_integrationName__: integration.name,
      eventType: evt.event_type,
      pollCount,
      stack: err.stack,
    });

    // Log HTTP request failure
    await executionLogger
      .addStep('http_request', {
        status: 'failed',
        durationMs: Date.now() - start,
        error: { message: err.message, stack: err.stack, code: err.code },
      })
      .catch(() => {});

    // Network/connection errors should be retried (timeout, DNS, connection refused, etc.)
    // These are transient errors, not permanent failures like 4xx client errors
    const attemptCount = (evt.attempt_count || 0) + 1;
    const maxRetries = integration.retryCount || 3;
    // isTest is already defined earlier in the try block
    const finalStatus = isTest ? 'FAILED' : attemptCount > maxRetries ? 'ABANDONED' : 'RETRYING';
    const finalErrorMessage = isTest
      ? `${catchErrorMessage} - Test event (no retry)`
      : attemptCount > maxRetries
        ? `${catchErrorMessage} - Max retries (${maxRetries}) reached`
        : catchErrorMessage;

    const logId = await data.recordLog(orgId, {
      id: logIdForUpdates,
      __KEEP___KEEP_integrationConfig__Id__: integration.id,
      __KEEP_integrationName__: integration.name,
      eventId: evt.id || null,
      eventType: evt.event_type,
      status: finalStatus,
      responseStatus: 500,
      responseTimeMs: Date.now() - start,
      attemptCount,
      originalPayload: evt.payload,
      requestPayload: transformed,
      errorMessage: finalErrorMessage,
      targetUrl: integration.targetUrl,
      httpMethod: integration.httpMethod || 'POST',
      attemptDetails: buildAttemptDetails(logIdForUpdates, integration.targetUrl, integration.httpMethod || 'POST'),
      // Distributed tracing
      correlationId: traceId,
      traceId: traceId,
      // Request details
      requestHeaders: headers || null,
      // Integration signing audit trail
      messageId,
      timestamp,
      signature: signatureHeaders ? signatureHeaders['X-Integration-Signature'] : null,
      signatureHeaders,
    });

    // CIRCUIT BREAKER: Always record failure on exceptions
    await data.recordDeliveryFailure(integration.id);

    // Mark execution as failed with DLQ entry (only if not retrying or already at max retries)
    if (finalStatus !== 'RETRYING') {
      const error = new Error(err.message);
      error.code = err.code || (err.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_ERROR');
      error.stack = err.stack;
      error.statusCode = 500;
      await executionLogger
        .fail(error, {
          payload: evt.payload,
          statusCode: 500,
        })
        .catch(() => {});
    } else {
      // For retrying status, update execution log but don't create DLQ yet
      await executionLogger.updateStatus('retrying').catch(() => {});
    }

    return buildResult(finalStatus, logId);
  }
}

module.exports = {
  resolveMultiActionDelayMs,
  deliverSingleAction,
  deliverMultiActionIntegration,
  deliverToIntegration,
};
