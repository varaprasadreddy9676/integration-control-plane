/**
 * Delivery Worker
 *
 * Thin entry point — delegates all per-org adapter management to
 * DeliveryWorkerManager. The retry processor and watchdog run here
 * once (not per-org) since they operate on MongoDB execution_logs.
 */

const config = require('../config');
const data = require('../data');
const mongodb = require('../mongodb');
const { log, logError } = require('../logger');
const { updateHeartbeat } = require('../worker-heartbeat');
const { getDeliveryWorkerManager } = require('./delivery-worker-manager');
const { processRetries } = require('./retry-handler');

// Re-export for backward compatibility
const { startPendingDeliveriesWorker } = require('./pending-deliveries-worker');
const { replayEvent } = require('./retry-handler');

function startDeliveryWorker() {
  const enabled = config.worker?.enabled ?? true;

  if (!enabled) {
    log('info', 'Delivery worker disabled via config');
    return async () => {};
  }

  // Start per-org adapter manager (MySQL / Kafka / HTTP Push)
  const manager = getDeliveryWorkerManager();
  manager.start().catch(err => {
    logError(err, { scope: 'DeliveryWorkerManager.start' });
  });

  // Retry processor — runs once, processes all orgs' failed deliveries
  const retryIntervalMs = config.worker?.retryIntervalMs || 60_000;
  const dbTimeout = config.worker?.dbOperationTimeoutMs || 30_000;

  const retryTimer = setInterval(async () => {
    try {
      updateHeartbeat('deliveryWorker');
      const retryCount = await processRetries(0, dbTimeout);
      if (retryCount > 0) {
        log('info', 'Processed retry attempts', { retryCount });
      }
    } catch (err) {
      log('error', 'Retry processing failed', { error: err.message });
    }
  }, retryIntervalMs);

  // Watchdog — marks STUCK events (stuck in PROCESSING state)
  let watchdogTimer = null;
  if (config.eventAudit?.enabled && config.eventAudit?.watchdogEnabled) {
    const watchdogIntervalMs = config.eventAudit?.watchdogIntervalMs || 300_000;
    const stuckThresholdMs   = config.eventAudit?.stuckThresholdMs   || 300_000;

    watchdogTimer = setInterval(async () => {
      try {
        const stuckThreshold = new Date(Date.now() - stuckThresholdMs);
        const dbClient = await mongodb.getDbSafe();

        const stuckEvents = await dbClient.collection('event_audit')
          .find({ status: 'PROCESSING', processingStartedAt: { $lt: stuckThreshold } })
          .toArray();

        if (stuckEvents.length === 0) return;

        log('warn', 'Detected STUCK events', { count: stuckEvents.length });

        for (const event of stuckEvents) {
          await dbClient.collection('event_audit').updateOne(
            { _id: event._id },
            {
              $set: {
                status: 'STUCK',
                skipCategory: 'WORKER_ERROR',
                skipReason: `Stuck in PROCESSING for more than ${stuckThresholdMs / 1000}s`,
                errorMessage: `Stuck in PROCESSING for more than ${stuckThresholdMs / 1000} seconds`,
                processingCompletedAt: new Date(),
                processingTimeMs: Date.now() - new Date(event.processingStartedAt).getTime()
              },
              $push: {
                timeline: {
                  ts: new Date(), stage: 'STUCK',
                  details: `Stuck in PROCESSING for more than ${stuckThresholdMs / 1000} seconds`
                }
              }
            }
          );
        }

        log('info', 'Marked STUCK events', { count: stuckEvents.length });
      } catch (err) {
        log('error', 'Watchdog failed', { error: err.message });
      }
    }, watchdogIntervalMs);

    log('info', `Watchdog started (interval: ${watchdogIntervalMs}ms, threshold: ${stuckThresholdMs}ms)`);
  }

  log('info', 'Delivery worker started');

  return async () => {
    log('info', 'Stopping delivery worker...');
    clearInterval(retryTimer);
    if (watchdogTimer) clearInterval(watchdogTimer);
    await manager.stop();
    log('info', 'Delivery worker stopped');
  };
}

module.exports = {
  startDeliveryWorker,
  replayEvent,
  startPendingDeliveriesWorker
};

// Exported for tests only
const eventUtils = require('../utils/event-utils');
const eventDedup = require('./event-deduplication');

module.exports.__test = {
  generateEventKey: eventUtils.generateEventKey,
  isEventProcessed: eventDedup.isEventProcessed,
  markEventProcessed: eventDedup.markEventProcessed,
  cleanupDedupCache: eventDedup.cleanupDedupCache,
  _processedEvents: eventDedup.getProcessedEventsMap()
};
