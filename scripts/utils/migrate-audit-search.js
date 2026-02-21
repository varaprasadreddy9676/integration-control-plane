/**
 * Migration Script: Add searchableText field to existing audit logs
 *
 * This script backfills the searchableText field for all existing audit logs
 * to enable full-text search on historical data.
 *
 * Usage: node migrate-audit-search.js
 */

const { getDb } = require('./src/mongodb');
const { log } = require('./src/logger');

/**
 * Build searchable text from audit log fields
 */
function buildSearchableText(auditLog) {
  const searchParts = [];

  // Add all scalar fields
  if (auditLog.action) searchParts.push(auditLog.action);
  if (auditLog.resourceType) searchParts.push(auditLog.resourceType);
  if (auditLog.resourceId) searchParts.push(String(auditLog.resourceId));
  if (auditLog.userEmail) searchParts.push(auditLog.userEmail);
  if (auditLog.userRole) searchParts.push(auditLog.userRole);
  if (auditLog.userId) searchParts.push(String(auditLog.userId));
  if (auditLog.ipAddress) searchParts.push(auditLog.ipAddress);
  if (auditLog.errorMessage) searchParts.push(auditLog.errorMessage);
  if (auditLog.userAgent) searchParts.push(auditLog.userAgent);

  // Add changes (before/after) as searchable JSON strings
  if (auditLog.changes) {
    try {
      if (auditLog.changes.before) {
        searchParts.push(JSON.stringify(auditLog.changes.before));
      }
      if (auditLog.changes.after) {
        searchParts.push(JSON.stringify(auditLog.changes.after));
      }
    } catch (err) {
      // Ignore JSON stringify errors
    }
  }

  // Add metadata as searchable JSON string
  if (auditLog.metadata && Object.keys(auditLog.metadata).length > 0) {
    try {
      searchParts.push(JSON.stringify(auditLog.metadata));
    } catch (err) {
      // Ignore JSON stringify errors
    }
  }

  return searchParts.join(' ');
}

async function migrateAuditLogs() {
  console.log('Starting audit log migration...');
  const startTime = Date.now();

  try {
    const db = await getDb();
    const collection = db.collection('audit_logs');

    // Find all audit logs without searchableText field
    const totalCount = await collection.countDocuments({ searchableText: { $exists: false } });
    console.log(`Found ${totalCount} audit logs to migrate`);

    if (totalCount === 0) {
      console.log('✓ All audit logs already have searchableText field');
      return;
    }

    // Process in batches to avoid memory issues
    const batchSize = 1000;
    let processed = 0;
    let updated = 0;

    while (processed < totalCount) {
      const logs = await collection
        .find({ searchableText: { $exists: false } })
        .limit(batchSize)
        .toArray();

      if (logs.length === 0) break;

      // Build bulk operations
      const bulkOps = logs.map(log => ({
        updateOne: {
          filter: { _id: log._id },
          update: {
            $set: {
              searchableText: buildSearchableText(log)
            }
          }
        }
      }));

      // Execute bulk update
      const result = await collection.bulkWrite(bulkOps, { ordered: false });
      updated += result.modifiedCount;
      processed += logs.length;

      console.log(`Processed ${processed}/${totalCount} (${Math.round(processed / totalCount * 100)}%)`);
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`\n✓ Migration completed successfully`);
    console.log(`  - Total processed: ${processed}`);
    console.log(`  - Total updated: ${updated}`);
    console.log(`  - Duration: ${duration}s`);

    // Create text index if it doesn't exist
    console.log('\nCreating text index on searchableText field...');
    try {
      await collection.createIndex(
        { searchableText: 'text' },
        {
          name: 'audit_fulltext_search',
          background: true,
          default_language: 'english'
        }
      );
      console.log('✓ Text index created successfully');
    } catch (indexError) {
      if (indexError.code === 85 || indexError.code === 86) {
        console.log('✓ Text index already exists');
      } else {
        console.error('✗ Failed to create text index:', indexError.message);
      }
    }

    console.log('\n✓ Migration complete! Full-text search is now available on all audit logs.');
    process.exit(0);
  } catch (error) {
    console.error('✗ Migration failed:', error);
    log('error', 'Audit log migration failed', { error: error.message, stack: error.stack });
    process.exit(1);
  }
}

// Run migration
migrateAuditLogs();
