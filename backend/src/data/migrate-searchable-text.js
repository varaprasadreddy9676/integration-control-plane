/**
 * Migration script to backfill searchableText field in execution_logs
 * This extracts patient data from requestPayload and stores it in a denormalized field
 * for fast full-text search performance
 *
 * Run this once after deploying the search optimization changes:
 * node src/data/migrate-searchable-text.js
 */

const mongodb = require('../mongodb');
const { log } = require('../logger');

async function migrateSearchableText() {
  try {
    await mongodb.connect();
    const db = await mongodb.getDbSafe();
    const collection = db.collection('execution_logs');

    log('info', 'Starting searchableText migration...');

    // Get all logs without searchableText field
    const logsToUpdate = await collection
      .find({
        searchableText: { $exists: false },
      })
      .toArray();

    log('info', `Found ${logsToUpdate.length} logs to update`);

    let updated = 0;
    let skipped = 0;

    // Update in batches of 100
    for (let i = 0; i < logsToUpdate.length; i += 100) {
      const batch = logsToUpdate.slice(i, i + 100);
      const bulkOps = [];

      for (const logDoc of batch) {
        const requestPayload = logDoc.requestPayload || {};
        const payloadData = requestPayload.d?.[0] || {};
        const profileData = payloadData.profileData || {};
        const evtData = payloadData.evtData || {};

        const searchableText = [
          payloadData.identity,
          profileData.Name,
          profileData.Phone,
          profileData.MRN,
          evtData['Patient Name'],
          evtData.MRN,
        ]
          .filter(Boolean)
          .join(' ');

        if (searchableText) {
          bulkOps.push({
            updateOne: {
              filter: { _id: logDoc._id },
              update: { $set: { searchableText } },
            },
          });
        } else {
          skipped++;
        }
      }

      if (bulkOps.length > 0) {
        const result = await collection.bulkWrite(bulkOps);
        updated += result.modifiedCount;
        log(
          'info',
          `Progress: ${Math.min(i + 100, logsToUpdate.length)}/${logsToUpdate.length} processed, ${updated} updated`
        );
      }
    }

    log('info', 'Migration complete!', {
      totalProcessed: logsToUpdate.length,
      updated,
      skipped,
      reason: skipped > 0 ? 'No patient data found in requestPayload' : null,
    });

    await mongodb.close();
    process.exit(0);
  } catch (error) {
    log('error', 'Migration failed', { error: error.message, stack: error.stack });
    process.exit(1);
  }
}

migrateSearchableText();
