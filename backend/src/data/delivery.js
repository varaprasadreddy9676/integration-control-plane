'use strict';
const { log, logError } = require('../logger');
const mongodb = require('../mongodb');
const { useMongo, fallbackDisabledError } = require('./helpers');
const { getIntegration } = require('./integrations');

// New functions for retry logic
async function getFailedLogsForRetry(batchSize = 3) {
  try {
    if (useMongo()) {
      const db = await mongodb.getDbSafe();
      const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000);

      const logs = await db
        .collection('execution_logs')
        .find({
          status: 'RETRYING', // Only retry logs explicitly marked as RETRYING
          triggerType: { $ne: 'SCHEDULED' },
          $or: [
            { lastAttemptAt: { $gt: fourHoursAgo } }, // New logs with lastAttemptAt
            { lastAttemptAt: { $exists: false }, updatedAt: { $gt: fourHoursAgo } }, // Backward compat: old logs without lastAttemptAt
            { lastAttemptAt: { $exists: false }, updatedAt: { $exists: false }, createdAt: { $gt: fourHoursAgo } }, // Very old logs
          ],
        })
        .sort({ lastAttemptAt: -1, updatedAt: -1, createdAt: 1 })
        .limit(batchSize)
        .toArray();

      // Filter logs where attemptCount < integration's retryCount
      const { mapLogFromMongo } = require('./helpers');
      const logsWithIntegrations = [];
      for (const logDoc of logs) {
        const integrationId = logDoc.__KEEP___KEEP_integrationConfig__Id__ || logDoc.integrationConfigId;
        const integration = await getIntegration(integrationId);
        if (integration && logDoc.attemptCount <= integration.retryCount) {
          logsWithIntegrations.push(mapLogFromMongo(logDoc));
        }
      }
      return logsWithIntegrations;
    }
    return fallbackDisabledError('getFailedLogsForRetry:fallback');
  } catch (err) {
    logError(err, { scope: 'getFailedLogsForRetry' });
    throw err;
  }
}

async function markLogAsAbandoned(logId) {
  try {
    if (useMongo()) {
      const db = await mongodb.getDbSafe();
      await db
        .collection('execution_logs')
        .updateOne(
          { _id: mongodb.toObjectId(logId) },
          { $set: { status: 'ABANDONED', shouldRetry: false, updatedAt: new Date() } }
        );
    } else {
      return fallbackDisabledError('markLogAsAbandoned:fallback');
    }
    log('info', 'Log marked as abandoned', { logId });
  } catch (err) {
    logError(err, { scope: 'markLogAsAbandoned', logId });
    throw err;
  }
}

// Simple data cleanup function
async function cleanupOldData() {
  try {
    if (useMongo()) {
      // MongoDB handles cleanup automatically with TTL indexes
      // execution_logs: 90 days (7776000 seconds)
      // processed_events: 1 hour (3600 seconds)
      log('info', 'Data cleanup handled by MongoDB TTL indexes');
      return;
    }
    return fallbackDisabledError('cleanupOldData:fallback');
  } catch (err) {
    logError(err, { scope: 'cleanupOldData' });
    throw err;
  }
}

// Cleanup stuck RETRYING logs that are older than the retry window
async function cleanupStuckRetryingLogs(hoursThreshold = 4) {
  try {
    if (useMongo()) {
      const db = await mongodb.getDbSafe();
      const thresholdTime = new Date(Date.now() - hoursThreshold * 60 * 60 * 1000);

      // Find logs stuck in RETRYING status beyond the retry window
      const result = await db.collection('execution_logs').updateMany(
        {
          status: 'RETRYING',
          $or: [
            // Old logs with lastAttemptAt field
            { lastAttemptAt: { $lt: thresholdTime } },
            // Legacy logs without lastAttemptAt but with updatedAt
            { lastAttemptAt: { $exists: false }, updatedAt: { $lt: thresholdTime } },
            // Very old logs without either field
            { lastAttemptAt: { $exists: false }, updatedAt: { $exists: false }, createdAt: { $lt: thresholdTime } },
          ],
        },
        {
          $set: {
            status: 'ABANDONED',
            shouldRetry: false,
            errorMessage: `Exceeded ${hoursThreshold}-hour retry window - automatically abandoned`,
            updatedAt: new Date(),
          },
        }
      );

      log('info', 'Cleaned up stuck RETRYING logs', {
        hoursThreshold,
        logsUpdated: result.modifiedCount,
      });

      return {
        success: true,
        logsUpdated: result.modifiedCount,
        hoursThreshold,
      };
    }
    return fallbackDisabledError('cleanupStuckRetryingLogs:fallback');
  } catch (err) {
    logError(err, { scope: 'cleanupStuckRetryingLogs' });
    throw err;
  }
}

/**
 * Check circuit breaker state for a integration
 * @param {string} integrationId - Integration configuration ID
 * @returns {Promise<{isOpen: boolean, state: string, reason: string}>}
 */
async function checkCircuitState(integrationId) {
  if (!useMongo()) {
    return { isOpen: false, state: 'CLOSED', reason: null };
  }

  try {
    const db = await mongodb.getDbSafe();
    const integration = await db.collection('integration_configs').findOne({ _id: mongodb.toObjectId(integrationId) });

    if (!integration) {
      return { isOpen: false, state: 'CLOSED', reason: 'Integration not found' };
    }

    const circuitState = integration.circuitState || 'CLOSED';
    const consecutiveFailures = integration.consecutiveFailures || 0;
    const circuitBreakerThreshold = integration.circuitBreakerThreshold || 10;
    const circuitRecoveryTimeMs = integration.circuitRecoveryTimeMs || 5 * 60 * 1000; // 5 minutes
    const circuitOpenedAt = integration.circuitOpenedAt;

    // If circuit is OPEN, check if recovery time has passed
    if (circuitState === 'OPEN' && circuitOpenedAt) {
      const now = new Date();
      const timeSinceOpen = now - new Date(circuitOpenedAt);

      if (timeSinceOpen >= circuitRecoveryTimeMs) {
        // Try HALF_OPEN - allow one test request
        await db.collection('integration_configs').updateOne(
          { _id: mongodb.toObjectId(integrationId) },
          {
            $set: {
              circuitState: 'HALF_OPEN',
              updatedAt: now,
            },
          }
        );
        log('info', 'Circuit breaker moved to HALF_OPEN', {
          integrationId,
          __KEEP_integrationName__: integration.name,
          timeSinceOpen: `${Math.round(timeSinceOpen / 1000)}s`,
        });
        return { isOpen: false, state: 'HALF_OPEN', reason: 'Testing recovery' };
      }

      return {
        isOpen: true,
        state: 'OPEN',
        reason: `Circuit open after ${consecutiveFailures} consecutive failures. Retry in ${Math.round((circuitRecoveryTimeMs - timeSinceOpen) / 1000)}s`,
      };
    }

    // Circuit is CLOSED or HALF_OPEN - allow delivery
    return { isOpen: false, state: circuitState, reason: null };
  } catch (err) {
    logError(err, { scope: 'checkCircuitState', integrationId });
    // On error, allow delivery (fail open)
    return { isOpen: false, state: 'UNKNOWN', reason: 'Circuit check failed' };
  }
}

/**
 * Record successful delivery - reset circuit breaker
 * @param {string} integrationId - Integration configuration ID
 */
async function recordDeliverySuccess(integrationId) {
  if (!useMongo()) return;

  try {
    const db = await mongodb.getDbSafe();
    const now = new Date();

    await db.collection('integration_configs').updateOne(
      { _id: mongodb.toObjectId(integrationId) },
      {
        $set: {
          circuitState: 'CLOSED',
          consecutiveFailures: 0,
          lastSuccessAt: now,
          circuitOpenedAt: null,
          updatedAt: now,
        },
      }
    );

    log('debug', 'Circuit breaker reset to CLOSED', { integrationId });
  } catch (err) {
    logError(err, { scope: 'recordDeliverySuccess', integrationId });
  }
}

/**
 * Record failed delivery - increment circuit breaker counter
 * @param {string} integrationId - Integration configuration ID
 * @param {Object} options - Options for failure recording
 * @param {boolean} options.shouldTripCircuit - Whether this failure should count toward circuit breaker (default: true for backward compatibility)
 */
async function recordDeliveryFailure(integrationId, options = {}) {
  if (!useMongo()) return;

  const { shouldTripCircuit = true } = options;

  // If this is a business logic failure (validation, transformation, 4xx), don't trip circuit breaker
  if (!shouldTripCircuit) {
    log('debug', 'Failure recorded but not counting toward circuit breaker (business logic failure)', {
      integrationId,
    });
    return;
  }

  try {
    const db = await mongodb.getDbSafe();
    const integration = await db.collection('integration_configs').findOne({ _id: mongodb.toObjectId(integrationId) });

    if (!integration) return;

    const now = new Date();
    const currentFailures = integration.consecutiveFailures || 0;
    const newFailures = currentFailures + 1;
    const circuitBreakerThreshold = integration.circuitBreakerThreshold || 10;
    const currentState = integration.circuitState || 'CLOSED';

    // Determine new circuit state
    let newState = currentState;
    let circuitOpenedAt = integration.circuitOpenedAt;

    if (currentState === 'HALF_OPEN') {
      // Failed during HALF_OPEN test - reopen circuit
      newState = 'OPEN';
      circuitOpenedAt = now;
      log('warn', 'Circuit breaker reopened after HALF_OPEN test failure', {
        integrationId,
        __KEEP_integrationName__: integration.name,
        consecutiveFailures: newFailures,
      });
    } else if (newFailures >= circuitBreakerThreshold && currentState === 'CLOSED') {
      // Threshold reached - open circuit
      newState = 'OPEN';
      circuitOpenedAt = now;
      log('warn', 'Circuit breaker OPENED', {
        integrationId,
        __KEEP_integrationName__: integration.name,
        consecutiveFailures: newFailures,
        threshold: circuitBreakerThreshold,
      });
    }

    await db.collection('integration_configs').updateOne(
      { _id: mongodb.toObjectId(integrationId) },
      {
        $set: {
          circuitState: newState,
          consecutiveFailures: newFailures,
          lastFailureAt: now,
          circuitOpenedAt,
          updatedAt: now,
        },
      }
    );

    log('debug', 'Circuit breaker failure recorded', {
      integrationId,
      __KEEP_integrationName__: integration.name,
      consecutiveFailures: newFailures,
      circuitState: newState,
    });
  } catch (err) {
    logError(err, { scope: 'recordDeliveryFailure', integrationId });
  }
}

module.exports = {
  getFailedLogsForRetry,
  markLogAsAbandoned,
  cleanupOldData,
  cleanupStuckRetryingLogs,
  checkCircuitState,
  recordDeliverySuccess,
  recordDeliveryFailure,
};
