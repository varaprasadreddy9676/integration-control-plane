const cron = require('node-cron');
const { log } = require('../logger');
const dlqData = require('../data/dlq');
const { getDbSafe } = require('../mongodb');
const executionLogsData = require('../data/execution-logs');
const data = require('../data');
const { buildAuthHeaders } = require('./auth-helper');
const { applyTransform } = require('../services/transformer');
const { fetch, AbortController } = require('../utils/runtime');
const config = require('../config');

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
    const executionLog = await executionLogsData.getExecutionLog(dlqEntry.traceId);

    if (!executionLog) {
      log('error', 'Execution log not found for DLQ retry', {
        dlqId: dlqEntry.dlqId,
        traceId: dlqEntry.traceId,
      });
      return false;
    }

    // Apply transformation
    const transformed = await applyTransform(integration, dlqEntry.payload, {
      eventType: executionLog.triggerType || 'REPLAY',
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

    const resp = await fetch(integration.targetUrl, {
      method: integration.httpMethod || 'POST',
      headers,
      body: JSON.stringify(transformed),
      signal: controller.signal,
    });

    clearTimeout(timer);

    // Check if successful
    const statusOk = resp.status >= 200 && resp.status < 300;

    // Log the retry attempt
    await data.recordLog(integration.orgId, {
      __KEEP___KEEP_integrationConfig__Id__: integration._id,
      __KEEP_integrationName__: integration.name,
      eventType: executionLog.triggerType || 'DLQ_RETRY',
      status: statusOk ? 'SUCCESS' : 'FAILED',
      responseStatus: resp.status,
      responseTimeMs: 0,
      attemptCount: dlqEntry.retryCount + 1,
      originalPayload: dlqEntry.payload,
      requestPayload: transformed,
      responseBody: await resp
        .text()
        .then((t) => t.slice(0, 5000))
        .catch(() => ''),
      errorMessage: statusOk ? null : `DLQ retry failed: HTTP ${resp.status}`,
      targetUrl: integration.targetUrl,
      httpMethod: integration.httpMethod || 'POST',
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
    // For INBOUND integrations, we would need to re-process the received data
    // This typically involves calling the internal data processing pipeline
    // NOTE: Implementation depends on your inbound integration architecture

    log('info', 'Retrying INBOUND integration from DLQ', {
      dlqId: dlqEntry.dlqId,
      integrationId: dlqEntry.integrationConfigId.toString(),
    });

    // TODO: Implement inbound retry logic based on your inbound integration architecture
    // Example: Re-process the payload through your data transformation and storage pipeline

    log('warn', 'DLQ retry for INBOUND integrations not yet fully implemented', {
      dlqId: dlqEntry.dlqId,
    });

    return false;
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

    const resp = await fetch(integration.targetUrl, {
      method: integration.httpMethod || 'POST',
      headers,
      body: JSON.stringify(transformed),
      signal: controller.signal,
    });

    clearTimeout(timer);

    // Check if successful
    const statusOk = resp.status >= 200 && resp.status < 300;

    // Log the retry attempt
    await data.recordLog(integration.orgId, {
      __KEEP___KEEP_integrationConfig__Id__: integration._id,
      __KEEP_integrationName__: integration.name,
      eventType: 'SCHEDULE',
      status: statusOk ? 'SUCCESS' : 'FAILED',
      responseStatus: resp.status,
      responseTimeMs: 0,
      attemptCount: dlqEntry.retryCount + 1,
      originalPayload: dlqEntry.payload,
      requestPayload: transformed,
      responseBody: await resp
        .text()
        .then((t) => t.slice(0, 5000))
        .catch(() => ''),
      errorMessage: statusOk ? null : `DLQ retry failed: HTTP ${resp.status}`,
      targetUrl: integration.targetUrl,
      httpMethod: integration.httpMethod || 'POST',
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
