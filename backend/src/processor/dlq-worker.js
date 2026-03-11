const cron = require('node-cron');
const axios = require('axios');
const { log } = require('../logger');
const dlqData = require('../data/dlq');
const { getDbSafe } = require('../mongodb');
const executionLogsData = require('../data/execution-logs');
const data = require('../data');
const { buildAuthHeaders } = require('./auth-helper');
const { applyTransform, applyResponseTransform } = require('../services/transformer');
const { fetch, AbortController } = require('../utils/runtime');
const config = require('../config');
const { deliverSingleAction } = require('./delivery-engine');
const { maskSensitiveData } = require('../utils/mask');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const TOKEN_AUTH_TYPES = new Set(['OAUTH2', 'CUSTOM']);
const MAX_LOG_RESPONSE_BODY_CHARS = 250000;

const computeRetryDelayMs = (attempt, baseMs = 1000, capMs = 5000) => {
  const jitter = Math.floor(Math.random() * 250);
  const delay = Math.min(baseMs * 2 ** Math.max(0, attempt - 1), capMs);
  return delay + jitter;
};

const isRetryableStatus = (status) => status === 408 || status === 429 || status >= 500;

const isRetryableError = (error) => {
  const code = error?.code;
  return code === 'ECONNABORTED' || code === 'ETIMEDOUT' || code === 'ENOTFOUND' || code === 'ECONNREFUSED';
};

const resolveHttpMethod = (integration) => String(integration?.httpMethod || 'POST').toUpperCase();

const resolveTimeoutMs = (integration) => {
  const raw = Number(integration?.timeoutMs ?? integration?.timeout);
  if (Number.isFinite(raw) && raw > 0) return raw;
  return 30000;
};

const resolveContentType = (integration) => {
  const raw = integration?.contentType;
  if (!raw || typeof raw !== 'string') return 'application/json';
  return raw;
};

const getByPath = (obj, path) => {
  if (!path || !obj || typeof obj !== 'object') return undefined;
  return path.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
};

const resolveTargetUrlTemplate = (template, context = {}) => {
  if (!template || typeof template !== 'string') return template;
  return template.replace(/\{\{\s*([^}]+)\s*\}\}/g, (_match, rawExpr) => {
    const expr = String(rawExpr || '').trim();
    if (!expr) return '';
    const value = getByPath(context, expr);
    return value === undefined || value === null ? '' : String(value);
  });
};

const readStreamBody = (stream, limit = 5000) =>
  new Promise((resolve) => {
    if (!stream || typeof stream.on !== 'function') {
      resolve(null);
      return;
    }

    const chunks = [];
    let total = 0;

    stream.on('data', (chunk) => {
      if (!chunk || total >= limit) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const remaining = limit - total;
      if (buffer.length > remaining) {
        chunks.push(buffer.slice(0, remaining));
        total = limit;
      } else {
        chunks.push(buffer);
        total += buffer.length;
      }
    });

    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    stream.on('error', () => resolve('[stream read error]'));
  });

async function recordInboundRetryLog(integration, status, details) {
  const requestBody = maskSensitiveData(details?.request?.body || {});
  const transformedBody = maskSensitiveData(details?.request?.transformed || requestBody);
  const responseBody = details?.upstream?.response ?? details?.response?.body ?? null;
  const errorMessage = details?.error?.message || details?.error?.error || null;
  const requestQuery = details?.request?.query && typeof details.request.query === 'object' ? details.request.query : {};

  let responseBodyText = responseBody;
  if (responseBody && typeof responseBody !== 'string') {
    responseBodyText = JSON.stringify(maskSensitiveData(responseBody), null, 2);
  }
  if (typeof responseBodyText === 'string' && responseBodyText.length > MAX_LOG_RESPONSE_BODY_CHARS) {
    const truncatedChars = responseBodyText.length - MAX_LOG_RESPONSE_BODY_CHARS;
    responseBodyText = `${responseBodyText.slice(0, MAX_LOG_RESPONSE_BODY_CHARS)}\n...[truncated ${truncatedChars} chars]`;
  }

  await data.recordLog(integration.orgId, {
    __KEEP___KEEP_integrationConfig__Id__: integration._id,
    __KEEP_integrationName__: integration.name,
    eventType: details?.eventType || integration.type || integration.eventType || 'INBOUND_RETRY',
    integrationType: details?.eventType || integration.type || integration.eventType || 'INBOUND_RETRY',
    direction: 'INBOUND',
    triggerType: 'REPLAY',
    status,
    responseStatus: details?.upstream?.status || details?.response?.status || null,
    responseTimeMs: details?.upstream?.responseTime || details?.response?.responseTime || null,
    attemptCount: Number(details?.attempts || 1),
    originalPayload: requestBody,
    requestPayload: transformedBody,
    responseBody: responseBodyText || null,
    errorMessage,
    targetUrl: details?.upstream?.url || integration.targetUrl,
    httpMethod: details?.upstream?.method || integration.httpMethod || 'POST',
    deliveredAt: status === 'SUCCESS' ? new Date().toISOString() : null,
    correlationId: details?.correlationId || null,
    traceId: details?.correlationId || null,
    requestHeaders: details?.request?.headers || null,
    requestUrl: details?.request?.url || `/api/v1/integrations/${encodeURIComponent(details?.eventType || integration.type || integration.eventType || 'INBOUND_RETRY')}`,
    requestMethod: details?.request?.method || resolveHttpMethod(integration),
    requestQuery,
    shouldRetry: false,
  });
}

async function retryInboundDirectRuntime(dlqEntry, integration) {
  const replayPayload = dlqEntry.payload && typeof dlqEntry.payload === 'object' ? dlqEntry.payload : {};
  const metadata = dlqEntry.metadata || {};
  const requestBody =
    replayPayload.body && typeof replayPayload.body === 'object' && !Array.isArray(replayPayload.body)
      ? replayPayload.body
      : replayPayload.body || {};
  const queryParams =
    replayPayload.query && typeof replayPayload.query === 'object' && !Array.isArray(replayPayload.query)
      ? replayPayload.query
      : replayPayload.query || {};
  const inboundHeaders =
    replayPayload.headers && typeof replayPayload.headers === 'object' && !Array.isArray(replayPayload.headers)
      ? replayPayload.headers
      : {};
  const inboundFile = replayPayload.file || null;
  const eventType = metadata.eventType || integration.type || integration.eventType || 'INBOUND_RETRY';
  const orgId = dlqEntry.orgId || integration.orgId;
  const requestMethod = resolveHttpMethod(integration);
  const timeoutMs = resolveTimeoutMs(integration);
  const contentType = resolveContentType(integration);
  const usesTokenAuth = TOKEN_AUTH_TYPES.has(String(integration.outgoingAuthType || '').toUpperCase());
  const requestContext = {
    body: requestBody,
    query: queryParams,
    headers: inboundHeaders,
    file: inboundFile,
  };
  const resolvedTargetUrl = resolveTargetUrlTemplate(integration.targetUrl, {
    ...requestContext,
    orgId,
    type: eventType,
  });
  const basePayload = requestMethod === 'GET' ? queryParams : requestBody;
  let transformedRequest = basePayload;
  let authHeaders;
  let outboundHeaders;
  let upstreamResponse;
  let lastError = null;
  let attemptsUsed = 0;
  const standardMaxAttempts = Math.max(1, Number(integration.retryCount || 1));

  if (!resolvedTargetUrl || typeof resolvedTargetUrl !== 'string') {
    await recordInboundRetryLog(integration, 'FAILED', {
      eventType,
      correlationId: dlqEntry.traceId,
      attempts: 1,
      request: {
        body: requestBody,
        query: queryParams,
        headers: inboundHeaders,
        transformed: transformedRequest,
        url: metadata.requestUrl || null,
        method: metadata.requestMethod || requestMethod,
      },
      error: {
        error: 'INVALID_TARGET_URL',
        message: 'Resolved target URL is invalid',
      },
    });
    return false;
  }

  try {
    if (integration.requestTransformation?.script) {
      transformedRequest = await applyTransform(
        {
          transformation: integration.requestTransformation,
          transformationMode: 'SCRIPT',
          lookups: integration.lookups || null,
        },
        basePayload,
        {
          eventType,
          orgId,
          ...requestContext,
        }
      );
    }

    authHeaders = await buildAuthHeaders(integration, requestMethod, resolvedTargetUrl);
    outboundHeaders = { ...authHeaders };
    if (requestMethod !== 'GET' && contentType) {
      outboundHeaders['Content-Type'] = contentType;
    }

    if (integration.streamResponse === true) {
      const httpStart = Date.now();
      const streamResponse = await axios({
        method: requestMethod,
        url: resolvedTargetUrl,
        headers: outboundHeaders,
        params: requestMethod === 'GET' ? transformedRequest : undefined,
        data: requestMethod !== 'GET' ? transformedRequest : undefined,
        timeout: timeoutMs,
        responseType: 'stream',
        validateStatus: null,
      });

      const responseTime = Date.now() - httpStart;
      if (streamResponse.status >= 400) {
        const errorBody = await readStreamBody(streamResponse.data, 5000);
        await recordInboundRetryLog(integration, 'FAILED', {
          eventType,
          correlationId: dlqEntry.traceId,
          attempts: 1,
          request: {
            body: requestBody,
            query: queryParams,
            headers: maskSensitiveData(outboundHeaders || inboundHeaders),
            transformed: transformedRequest,
            url: metadata.requestUrl || null,
            method: metadata.requestMethod || requestMethod,
          },
          upstream: {
            url: resolvedTargetUrl,
            method: requestMethod,
            status: streamResponse.status,
            responseTime,
            response: errorBody,
          },
          error: {
            error: 'UPSTREAM_ERROR',
            message: 'External API returned error',
          },
        });
        return false;
      }

      if (streamResponse.data && typeof streamResponse.data.destroy === 'function') {
        streamResponse.data.destroy();
      }

      await recordInboundRetryLog(integration, 'SUCCESS', {
        eventType,
        correlationId: dlqEntry.traceId,
        attempts: 1,
        request: {
          body: requestBody,
          query: queryParams,
          headers: maskSensitiveData(outboundHeaders || inboundHeaders),
          transformed: transformedRequest,
          url: metadata.requestUrl || null,
          method: metadata.requestMethod || requestMethod,
        },
        upstream: {
          url: resolvedTargetUrl,
          method: requestMethod,
          status: streamResponse.status,
          responseTime,
          response: '[STREAMED RETRY]',
        },
        response: {
          status: streamResponse.status,
          body: '[STREAMED RETRY]',
        },
      });
      return true;
    }

    let authRefreshRetryRemaining = usesTokenAuth ? 1 : 0;
    let maxLoopAttempts = standardMaxAttempts + authRefreshRetryRemaining;

    for (let attempt = 1; attempt <= maxLoopAttempts; attempt += 1) {
      const httpStart = Date.now();
      attemptsUsed = attempt;
      try {
        upstreamResponse = await axios({
          method: requestMethod,
          url: resolvedTargetUrl,
          headers: outboundHeaders,
          params: requestMethod === 'GET' ? transformedRequest : undefined,
          data: requestMethod !== 'GET' ? transformedRequest : undefined,
          timeout: timeoutMs,
          validateStatus: null,
        });

        if (upstreamResponse.status === 401 && usesTokenAuth && authRefreshRetryRemaining > 0) {
          authRefreshRetryRemaining -= 1;
          maxLoopAttempts = standardMaxAttempts + authRefreshRetryRemaining;
          if (integration._id) {
            await require('./auth-helper').clearCachedToken(integration._id).catch(() => {});
          }
          authHeaders = await buildAuthHeaders(integration, requestMethod, resolvedTargetUrl);
          outboundHeaders = { ...authHeaders };
          if (requestMethod !== 'GET' && contentType) {
            outboundHeaders['Content-Type'] = contentType;
          }
          continue;
        }

        if (upstreamResponse.status >= 400 && isRetryableStatus(upstreamResponse.status) && attempt < standardMaxAttempts) {
          await sleep(computeRetryDelayMs(attempt));
          continue;
        }

        upstreamResponse.responseTimeMs = Date.now() - httpStart;
        break;
      } catch (error) {
        lastError = error;
        if (isRetryableError(error) && attempt < standardMaxAttempts) {
          await sleep(computeRetryDelayMs(attempt));
          continue;
        }
        throw error;
      }
    }

    if (!upstreamResponse && lastError) {
      throw lastError;
    }

    const responseTime = upstreamResponse?.responseTimeMs || 0;

    if (upstreamResponse.status >= 400) {
      await recordInboundRetryLog(integration, 'FAILED', {
        eventType,
        correlationId: dlqEntry.traceId,
        attempts: attemptsUsed,
        request: {
          body: requestBody,
          query: queryParams,
          headers: maskSensitiveData(outboundHeaders || inboundHeaders),
          transformed: transformedRequest,
          url: metadata.requestUrl || null,
          method: metadata.requestMethod || requestMethod,
        },
        upstream: {
          url: resolvedTargetUrl,
          method: requestMethod,
          status: upstreamResponse.status,
          responseTime,
          response: maskSensitiveData(upstreamResponse.data),
        },
        error: {
          error: 'UPSTREAM_ERROR',
          message: 'External API returned error',
        },
      });
      return false;
    }

    let transformedResponse = upstreamResponse.data;
    if (integration.responseTransformation) {
      transformedResponse = await applyResponseTransform(
        integration,
        {
          data: upstreamResponse.data,
          status: upstreamResponse.status,
          headers: upstreamResponse.headers,
        },
        { orgId }
      );
    }

    await recordInboundRetryLog(integration, 'SUCCESS', {
      eventType,
      correlationId: dlqEntry.traceId,
      attempts: attemptsUsed,
      request: {
        body: requestBody,
        query: queryParams,
        headers: maskSensitiveData(outboundHeaders || inboundHeaders),
        transformed: transformedRequest,
        url: metadata.requestUrl || null,
        method: metadata.requestMethod || requestMethod,
      },
      upstream: {
        url: resolvedTargetUrl,
        method: requestMethod,
        status: upstreamResponse.status,
        responseTime,
        response: maskSensitiveData(upstreamResponse.data),
      },
      response: {
        status: 200,
        body: maskSensitiveData(transformedResponse),
      },
    });
    return true;
  } catch (error) {
    const responseTime = 0;
    const errorCode =
      error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT'
        ? 'UPSTREAM_TIMEOUT'
        : error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED'
          ? 'UPSTREAM_ERROR'
          : error.code === 'TRANSFORMATION_ERROR'
            ? 'TRANSFORMATION_ERROR'
            : error.code === 'AUTHENTICATION_ERROR'
              ? 'AUTHENTICATION_ERROR'
              : 'INTERNAL_ERROR';

    await recordInboundRetryLog(integration, 'FAILED', {
      eventType,
      correlationId: dlqEntry.traceId,
      attempts: attemptsUsed || 1,
      request: {
        body: requestBody,
        query: queryParams,
        headers: maskSensitiveData(outboundHeaders || inboundHeaders),
        transformed: transformedRequest,
        url: metadata.requestUrl || null,
        method: metadata.requestMethod || requestMethod,
      },
      upstream: resolvedTargetUrl
        ? {
            url: resolvedTargetUrl,
            method: requestMethod,
            responseTime,
          }
        : null,
      error: {
        error: errorCode,
        message: error.message,
      },
    });
    return false;
  }
}

/**
 * DLQ Worker - Automatic retry processing for failed deliveries
 *
 * This worker runs every 1 minute and:
 * 1. Finds DLQ entries where nextRetryAt has passed
 * 2. Attempts to re-execute the integration
 * 3. Updates retry count and status based on result
 * 4. Abandons entries that exceed maxRetries
 */

let workerTask = null;
let isProcessing = false;

/**
 * Retry a failed integration delivery
 * @param {Object} dlqEntry - The DLQ entry to retry
 * @returns {Promise<boolean>} Success status
 */
async function retryIntegration(dlqEntry) {
  const db = await getDbSafe();

  // Get the integration configuration
  const integration = await db.collection('integration_configs').findOne({
    _id: dlqEntry.integrationConfigId,
  });

  if (!integration || !integration.isActive) {
    throw new Error('Integration not found or inactive');
  }

  // Based on direction, use the appropriate delivery mechanism
  switch (dlqEntry.direction) {
    case 'OUTBOUND':
      return await retryOutboundIntegration(dlqEntry, integration);
    case 'INBOUND':
      return await retryInboundIntegration(dlqEntry, integration);
    case 'SCHEDULED':
      return await retryScheduledIntegration(dlqEntry, integration);
    default:
      throw new Error(`Unknown direction: ${dlqEntry.direction}`);
  }
}

/**
 * Retry outbound integration
 * Uses the existing replay mechanism from worker.js
 */
async function retryOutboundIntegration(dlqEntry, integration) {
  try {
    // Get the execution log to find the original log ID
    const executionLog = await executionLogsData.getExecutionLog(dlqEntry.traceId, dlqEntry.orgId);

    if (!executionLog) {
      log('error', 'Execution log not found for DLQ retry', {
        dlqId: dlqEntry.dlqId,
        traceId: dlqEntry.traceId,
      });
      return false;
    }

    // Apply transformation
    const eventType = executionLog.eventType || 'DLQ_RETRY';
    const transformed = await applyTransform(integration, dlqEntry.payload, {
      eventType,
      orgId: integration.orgId,
    });

    // Build headers
    const headers = await buildAuthHeaders(integration, integration.httpMethod || 'POST', integration.targetUrl);
    headers['Content-Type'] = 'application/json';
    headers['X-Trace-ID'] = dlqEntry.traceId;
    headers['X-DLQ-Retry'] = 'true';

    // Make HTTP request with timeout
    const controller = new AbortController();
    const timeout = integration.timeoutMs || config.worker?.timeoutMs || 10000;
    const timer = setTimeout(() => controller.abort(), timeout);
    const requestStartedAt = Date.now();

    const resp = await fetch(integration.targetUrl, {
      method: integration.httpMethod || 'POST',
      headers,
      body: JSON.stringify(transformed),
      signal: controller.signal,
    });

    clearTimeout(timer);
    const responseTimeMs = Date.now() - requestStartedAt;

    // Check if successful
    const statusOk = resp.status >= 200 && resp.status < 300;
    const responseBody = await resp
      .text()
      .then((t) => t.slice(0, 5000))
      .catch(() => '');

    // Log the retry attempt
    await data.recordLog(integration.orgId, {
      __KEEP___KEEP_integrationConfig__Id__: integration._id,
      __KEEP_integrationName__: integration.name,
      eventType,
      status: statusOk ? 'SUCCESS' : 'FAILED',
      responseStatus: resp.status,
      responseTimeMs,
      attemptCount: dlqEntry.retryCount + 1,
      originalPayload: dlqEntry.payload,
      requestPayload: transformed,
      responseBody,
      errorMessage: statusOk ? null : `DLQ retry failed: HTTP ${resp.status}`,
      targetUrl: integration.targetUrl,
      httpMethod: integration.httpMethod || 'POST',
      deliveredAt: statusOk ? new Date().toISOString() : null,
      correlationId: dlqEntry.traceId,
      traceId: dlqEntry.traceId,
      requestHeaders: headers,
    });

    return statusOk;
  } catch (error) {
    log('error', 'DLQ retry failed for outbound integration', {
      dlqId: dlqEntry.dlqId,
      integrationId: dlqEntry.integrationConfigId.toString(),
      error: error.message,
      stack: error.stack,
    });
    return false;
  }
}

/**
 * Retry inbound integration
 * Inbound integrations receive data from external sources
 */
async function retryInboundIntegration(dlqEntry, _integration) {
  try {
    if (dlqEntry.metadata?.replayMode === 'INBOUND_RUNTIME') {
      return await retryInboundDirectRuntime(dlqEntry, _integration);
    }

    const integration = {
      id: _integration._id?.toString?.() || _integration._id || _integration.id,
      _id: _integration._id?.toString?.() || _integration._id || _integration.id,
      ..._integration,
    };
    const metadata = dlqEntry.metadata || {};
    const actions = Array.isArray(integration.actions) ? integration.actions : [];

    let actionIndex = Number.isFinite(metadata.actionIndex) ? metadata.actionIndex : null;
    if (!Number.isFinite(actionIndex) && typeof metadata.actionName === 'string' && metadata.actionName.trim()) {
      actionIndex = actions.findIndex((action) => action?.name === metadata.actionName);
      if (actionIndex < 0) {
        actionIndex = null;
      }
    }
    if (!Number.isFinite(actionIndex) && actions.length === 1) {
      actionIndex = 0;
    }

    if (!Number.isFinite(actionIndex) || !actions[actionIndex]) {
      log('warn', 'INBOUND DLQ retry skipped - failed action could not be resolved', {
        dlqId: dlqEntry.dlqId,
        integrationId: integration.id,
        actionIndex: metadata.actionIndex,
        actionName: metadata.actionName,
        actionCount: actions.length,
      });
      return false;
    }

    const evt = {
      id: dlqEntry.messageId || dlqEntry.dlqId,
      eventId: dlqEntry.messageId || dlqEntry.dlqId,
      event_type: metadata.eventType || integration.type || integration.eventType || 'INBOUND_RETRY',
      payload: dlqEntry.payload,
      orgId: dlqEntry.orgId || integration.orgId,
      attempt_count: dlqEntry.retryCount || 0,
    };

    log('info', 'Retrying INBOUND integration from DLQ', {
      dlqId: dlqEntry.dlqId,
      integrationId: integration.id,
      actionIndex,
      actionName: actions[actionIndex]?.name || null,
    });

    const result = await deliverSingleAction(
      integration,
      actions[actionIndex],
      evt,
      0,
      actionIndex,
      dlqEntry.traceId || null,
      null,
      {
        existingLogId: dlqEntry.executionLogId || metadata.logId || dlqEntry.traceId || null,
        triggerType: 'MANUAL',
        retryReason: `DLQ retry ${Number(dlqEntry.retryCount || 0) + 1}`,
      }
    );

    return result?.status === 'SUCCESS' || result?.status === 'SKIPPED';
  } catch (error) {
    log('error', 'DLQ retry failed for inbound integration', {
      dlqId: dlqEntry.dlqId,
      integrationId: dlqEntry.integrationConfigId.toString(),
      error: error.message,
    });
    return false;
  }
}

/**
 * Retry scheduled integration
 * Similar to outbound, but for scheduled jobs
 */
async function retryScheduledIntegration(dlqEntry, integration) {
  try {
    // For SCHEDULED integrations, use similar logic to OUTBOUND
    // The payload typically contains pre-fetched data from a data source

    log('info', 'Retrying SCHEDULED integration from DLQ', {
      dlqId: dlqEntry.dlqId,
      integrationId: dlqEntry.integrationConfigId.toString(),
    });

    // Apply transformation
    const transformed = await applyTransform(integration, dlqEntry.payload, {
      eventType: 'SCHEDULE',
      orgId: integration.orgId,
    });

    // Build headers
    const headers = await buildAuthHeaders(integration, integration.httpMethod || 'POST', integration.targetUrl);
    headers['Content-Type'] = 'application/json';
    headers['X-Trace-ID'] = dlqEntry.traceId;
    headers['X-DLQ-Retry'] = 'true';

    // Make HTTP request with timeout
    const controller = new AbortController();
    const timeout = integration.timeoutMs || config.worker?.timeoutMs || 10000;
    const timer = setTimeout(() => controller.abort(), timeout);
    const requestStartedAt = Date.now();

    const resp = await fetch(integration.targetUrl, {
      method: integration.httpMethod || 'POST',
      headers,
      body: JSON.stringify(transformed),
      signal: controller.signal,
    });

    clearTimeout(timer);
    const responseTimeMs = Date.now() - requestStartedAt;

    // Check if successful
    const statusOk = resp.status >= 200 && resp.status < 300;
    const responseBody = await resp
      .text()
      .then((t) => t.slice(0, 5000))
      .catch(() => '');

    // Log the retry attempt
    await data.recordLog(integration.orgId, {
      __KEEP___KEEP_integrationConfig__Id__: integration._id,
      __KEEP_integrationName__: integration.name,
      eventType: integration.eventType || 'SCHEDULE',
      status: statusOk ? 'SUCCESS' : 'FAILED',
      responseStatus: resp.status,
      responseTimeMs,
      attemptCount: dlqEntry.retryCount + 1,
      originalPayload: dlqEntry.payload,
      requestPayload: transformed,
      responseBody,
      errorMessage: statusOk ? null : `DLQ retry failed: HTTP ${resp.status}`,
      targetUrl: integration.targetUrl,
      httpMethod: integration.httpMethod || 'POST',
      deliveredAt: statusOk ? new Date().toISOString() : null,
      correlationId: dlqEntry.traceId,
      traceId: dlqEntry.traceId,
      requestHeaders: headers,
    });

    return statusOk;
  } catch (error) {
    log('error', 'DLQ retry failed for scheduled integration', {
      dlqId: dlqEntry.dlqId,
      integrationId: dlqEntry.integrationConfigId.toString(),
      error: error.message,
    });
    return false;
  }
}

/**
 * Process DLQ entries that are ready for retry
 */
async function processDLQRetries() {
  if (isProcessing) {
    log('debug', 'DLQ worker already processing, skipping this cycle');
    return;
  }

  isProcessing = true;

  try {
    // Get entries ready for retry (limit to 50 per cycle to avoid overload)
    const entries = await dlqData.getDLQEntriesForRetry(50);

    if (entries.length === 0) {
      log('debug', 'No DLQ entries ready for retry');
      return;
    }

    log('info', 'Processing DLQ retries', { count: entries.length });

    let successCount = 0;
    let failedCount = 0;
    let abandonedCount = 0;

    for (const entry of entries) {
      try {
        // Update status to retrying
        await dlqData.updateDLQEntry(entry.dlqId, entry.orgId, {
          status: 'retrying',
        });

        // Attempt retry
        const success = await retryIntegration(entry);

        if (success) {
          // Record successful retry
          await dlqData.recordRetryAttempt(entry.dlqId, entry.orgId, 'success');
          successCount++;

          log('info', 'DLQ entry resolved via auto-retry', {
            dlqId: entry.dlqId,
            retryCount: entry.retryCount + 1,
          });
        } else {
          // Record failed retry (will schedule next retry or abandon)
          await dlqData.recordRetryAttempt(entry.dlqId, entry.orgId, 'failed');

          if (entry.retryCount + 1 >= entry.maxRetries) {
            abandonedCount++;
          } else {
            failedCount++;
          }
        }
      } catch (error) {
        log('error', 'DLQ retry processing error', {
          dlqId: entry.dlqId,
          error: error.message,
        });

        // Record failed retry
        try {
          await dlqData.recordRetryAttempt(entry.dlqId, entry.orgId, 'failed');
          failedCount++;
        } catch (recordError) {
          log('error', 'Failed to record retry attempt', {
            dlqId: entry.dlqId,
            error: recordError.message,
          });
        }
      }
    }

    log('info', 'DLQ retry cycle completed', {
      processed: entries.length,
      succeeded: successCount,
      failed: failedCount,
      abandoned: abandonedCount,
    });
  } catch (error) {
    log('error', 'DLQ worker error', {
      error: error.message,
      stack: error.stack,
    });
  } finally {
    isProcessing = false;
  }
}

/**
 * Start the DLQ worker
 */
function startDLQWorker() {
  if (workerTask) {
    log('warn', 'DLQ worker already running');
    return;
  }

  // Run every 1 minute
  workerTask = cron.schedule('*/1 * * * *', async () => {
    await processDLQRetries();
  });

  log('info', 'DLQ worker started (runs every 1 minute)');

  // Run immediately on startup
  setTimeout(() => processDLQRetries(), 5000); // Wait 5s after startup
}

/**
 * Stop the DLQ worker
 */
function stopDLQWorker() {
  if (workerTask) {
    workerTask.stop();
    workerTask = null;
    log('info', 'DLQ worker stopped');
  }
}

/**
 * Get worker status
 */
function getDLQWorkerStatus() {
  return {
    running: !!workerTask,
    processing: isProcessing,
  };
}

module.exports = {
  startDLQWorker,
  stopDLQWorker,
  getDLQWorkerStatus,
  processDLQRetries,
};
