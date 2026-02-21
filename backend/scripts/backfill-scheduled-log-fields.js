/**
 * Backfill script to populate integrationName and eventType for existing logs
 * that have null values for these fields.
 *
 * This script finds all logs where:
 * - __KEEP_integrationName__ is null OR eventType is null
 * - __KEEP___KEEP_integrationConfig__Id__ exists
 *
 * Then fetches the integration config and updates the log with the missing fields.
 */

const mongodb = require('../src/data/mongodb');
const { log, logError } = require('../src/logger');

async function backfillScheduledLogFields() {
  let updatedCount = 0;
  let failedCount = 0;
  let noConfigCount = 0;

  try {
    const db = await mongodb.getDbSafe();
    const logsCollection = db.collection('execution_logs');
    const integrationsCollection = db.collection('integration_configs');

    log('info', 'Starting backfill of scheduled log fields');

    // Find all logs with missing integrationName or eventType but have integrationConfigId
    const logsToUpdate = await logsCollection.find({
      __KEEP___KEEP_integrationConfig__Id__: { $ne: null, $exists: true },
      $or: [
        { __KEEP_integrationName__: null },
        { __KEEP_integrationName__: { $exists: false } },
        { eventType: null },
        { eventType: { $exists: false } }
      ]
    }).toArray();

    log('info', `Found ${logsToUpdate.length} logs to backfill`);

    // Cache for integration configs
    const integrationCache = new Map();

    for (const logEntry of logsToUpdate) {
      try {
        const configId = logEntry.__KEEP___KEEP_integrationConfig__Id__;

        // Check cache first
        let integration = integrationCache.get(configId.toString());

        if (!integration) {
          // Fetch from database
          integration = await integrationsCollection.findOne({
            _id: configId
          });

          if (integration) {
            integrationCache.set(configId.toString(), integration);
          }
        }

        if (!integration) {
          log('warn', 'Integration config not found for log', {
            logId: logEntry._id.toString(),
            integrationConfigId: configId.toString()
          });
          noConfigCount++;
          continue;
        }

        // Update the log with missing fields
        const updateDoc = {};

        if (!logEntry.__KEEP_integrationName__) {
          updateDoc.__KEEP_integrationName__ = integration.name;
          updateDoc.webhookName = integration.name;
        }

        if (!logEntry.eventType) {
          updateDoc.eventType = integration.eventType;
          updateDoc.integrationType = integration.eventType;
        }

        if (Object.keys(updateDoc).length > 0) {
          await logsCollection.updateOne(
            { _id: logEntry._id },
            { $set: updateDoc }
          );

          updatedCount++;

          if (updatedCount % 100 === 0) {
            log('info', `Backfilled ${updatedCount} logs so far...`);
          }
        }
      } catch (err) {
        logError(err, {
          scope: 'backfill-scheduled-log-fields',
          logId: logEntry._id.toString()
        });
        failedCount++;
      }
    }

    log('info', 'Backfill completed', {
      total: logsToUpdate.length,
      updated: updatedCount,
      failed: failedCount,
      noConfig: noConfigCount
    });

    return {
      total: logsToUpdate.length,
      updated: updatedCount,
      failed: failedCount,
      noConfig: noConfigCount
    };
  } catch (err) {
    logError(err, { scope: 'backfill-scheduled-log-fields' });
    throw err;
  }
}

// Run if called directly
if (require.main === module) {
  backfillScheduledLogFields()
    .then(result => {
      console.log('Backfill completed successfully:', result);
      process.exit(0);
    })
    .catch(err => {
      console.error('Backfill failed:', err);
      process.exit(1);
    });
}

module.exports = { backfillScheduledLogFields };
