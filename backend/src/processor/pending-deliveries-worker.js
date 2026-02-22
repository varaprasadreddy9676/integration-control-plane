const config = require('../config');
const mongodb = require('../mongodb');
const { log } = require('../logger');
const { deliverSingleAction } = require('./delivery-engine');

/**
 * Process pending INBOUND COMMUNICATION jobs
 * Polls pending_deliveries collection and processes jobs asynchronously
 */
async function processPendingDeliveries() {
  try {
    const db = await mongodb.getDbSafe();
    const batchSize = 10;
    let processedCount = 0;

    // Process jobs one at a time with atomic claiming to avoid race conditions
    for (let i = 0; i < batchSize; i++) {
      // Atomically claim a single job by updating status to PROCESSING
      const result = await db.collection('pending_deliveries').findOneAndUpdate(
        { status: 'PENDING' },
        {
          $set: {
            status: 'PROCESSING',
            processedAt: new Date(),
          },
        },
        {
          sort: { createdAt: 1 }, // Process oldest first
          returnDocument: 'after', // Return the updated document
        }
      );

      // No more pending jobs
      if (!result.value) {
        break;
      }

      const job = result.value;
      processedCount++;

      try {
        // Fetch integration config
        const jobOrgId = job.orgId;
        const integration = await db.collection('integration_configs').findOne({
          _id: job.integrationConfigId,
          orgId: jobOrgId,
          direction: 'INBOUND',
          isActive: true,
        });

        if (!integration) {
          log('warn', 'Integration not found for pending job', {
            jobId: job._id.toString(),
            integrationConfigId: job.integrationConfigId.toString(),
          });

          await db
            .collection('pending_deliveries')
            .updateOne(
              { _id: job._id },
              { $set: { status: 'FAILED', completedAt: new Date(), error: 'Integration not found or inactive' } }
            );
          continue;
        }

        // Process each action in the integration
        const actions = integration.actions || [];
        const integrationMapped = {
          id: integration._id.toString(),
          _id: integration._id.toString(),
          ...integration,
        };

        const evt = {
          id: job._id.toString(),
          eventId: job._id.toString(),
          event_type: job.eventType,
          payload: job.payload,
          orgId: jobOrgId,
          attempt_count: job.retryCount || 0,
        };

        let allActionsSucceeded = true;
        const actionResults = [];

        for (let i = 0; i < actions.length; i++) {
          const action = actions[i];

          try {
            const result = await deliverSingleAction(
              integrationMapped,
              action,
              evt,
              0, // pollCount
              i, // actionIndex
              job.traceId, // correlationId
              null, // executionLogger
              // Reuse the existing trace execution log to avoid duplicate rows per request
              { triggerType: 'MANUAL', existingLogId: job.traceId || null }
            );

            actionResults.push({
              actionIndex: i,
              actionName: action.name,
              status: result.status,
              logId: result.logId,
            });

            if (result.status !== 'SUCCESS') {
              allActionsSucceeded = false;
            }
          } catch (error) {
            log('error', 'Action delivery failed for pending job', {
              jobId: job._id.toString(),
              actionIndex: i,
              actionName: action.name,
              error: error.message,
            });

            actionResults.push({
              actionIndex: i,
              actionName: action.name,
              status: 'FAILED',
              error: error.message,
            });

            allActionsSucceeded = false;
          }
        }

        // Update job status
        if (allActionsSucceeded) {
          await db.collection('pending_deliveries').updateOne(
            { _id: job._id },
            {
              $set: {
                status: 'COMPLETED',
                completedAt: new Date(),
                actionResults,
              },
            }
          );

          log('info', 'INBOUND COMMUNICATION job completed successfully', {
            jobId: job._id.toString(),
            traceId: job.traceId,
            actionCount: actions.length,
          });
        } else {
          // Increment retry count and set back to PENDING (or FAILED if max retries reached)
          const newRetryCount = (job.retryCount || 0) + 1;
          const maxRetries = job.maxRetries || 3;
          const newStatus = newRetryCount >= maxRetries ? 'FAILED' : 'PENDING';

          await db.collection('pending_deliveries').updateOne(
            { _id: job._id },
            {
              $set: {
                status: newStatus,
                retryCount: newRetryCount,
                lastAttemptAt: new Date(),
                ...(newStatus === 'FAILED' ? { completedAt: new Date(), failedAt: new Date() } : {}),
                actionResults,
              },
            }
          );

          log('warn', `INBOUND COMMUNICATION job ${newStatus === 'FAILED' ? 'failed permanently' : 'will retry'}`, {
            jobId: job._id.toString(),
            traceId: job.traceId,
            retryCount: newRetryCount,
            maxRetries,
          });
        }
      } catch (error) {
        log('error', 'Failed to process pending job', {
          jobId: job._id.toString(),
          error: error.message,
          stack: error.stack,
        });

        // Mark job as PENDING for retry (unless max retries reached)
        try {
          const newRetryCount = (job.retryCount || 0) + 1;
          const maxRetries = job.maxRetries || 3;
          const newStatus = newRetryCount >= maxRetries ? 'FAILED' : 'PENDING';

          await db.collection('pending_deliveries').updateOne(
            { _id: job._id },
            {
              $set: {
                status: newStatus,
                retryCount: newRetryCount,
                lastAttemptAt: new Date(),
                error: error.message,
                ...(newStatus === 'FAILED' ? { completedAt: new Date(), failedAt: new Date() } : {}),
              },
            }
          );
        } catch (updateError) {
          log('error', 'Failed to update job status after error', {
            jobId: job._id.toString(),
            updateError: updateError.message,
          });
        }
      }
    }

    if (processedCount > 0) {
      log('info', `Processed ${processedCount} INBOUND COMMUNICATION job(s)`);
    }
  } catch (error) {
    log('error', 'Failed to process pending deliveries', {
      error: error.message,
      stack: error.stack,
    });
  }
}

/**
 * Start polling for pending INBOUND COMMUNICATION jobs
 */
function startPendingDeliveriesWorker() {
  const enabled = config.worker?.enabled ?? true;
  const intervalMs = config.worker?.inboundJobsIntervalMs || 5000;

  if (!enabled) {
    log('info', 'Pending deliveries worker disabled via config');
    return;
  }

  log('info', `Starting pending deliveries worker (interval: ${intervalMs}ms)`);

  setInterval(async () => {
    try {
      await processPendingDeliveries();
    } catch (error) {
      log('error', 'Pending deliveries worker error', {
        error: error.message,
      });
    }
  }, intervalMs);

  // Process immediately on startup
  processPendingDeliveries().catch((error) => {
    log('error', 'Initial pending deliveries processing failed', {
      error: error.message,
    });
  });
}

module.exports = {
  processPendingDeliveries,
  startPendingDeliveriesWorker,
};
