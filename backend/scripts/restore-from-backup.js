/**
 * Restore event_types collection from a backup
 *
 * Usage:
 *   node scripts/restore-from-backup.js <backup-collection-name>
 *
 * Example:
 *   node scripts/restore-from-backup.js event_types_backup_2026-02-02_14-30-25
 */

const { MongoClient } = require('mongodb');
const config = require('../src/config');

async function restoreFromBackup() {
  const backupName = process.argv[2];

  if (!backupName) {
    console.error('\n❌ Error: Backup collection name required\n');
    console.log('Usage:');
    console.log('  node scripts/restore-from-backup.js <backup-collection-name>\n');
    console.log('Example:');
    console.log('  node scripts/restore-from-backup.js event_types_backup_2026-02-02_14-30-25\n');
    console.log('To list available backups:');
    console.log('  mongosh webhook_manager --eval "db.getCollectionNames().filter(n => n.startsWith(\'event_types_backup_\'))"\n');
    process.exit(1);
  }

  let mongoClient;

  try {
    console.log('\n🔄 Event Types Restore Script');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Connect to MongoDB
    console.log('📦 Connecting to MongoDB...');
    mongoClient = new MongoClient(config.mongodb.uri, config.mongodb.options || {});
    await mongoClient.connect();
    const db = mongoClient.db(config.mongodb.database);
    console.log('✅ Connected\n');

    // Check if backup exists
    const collections = await db.listCollections({ name: backupName }).toArray();
    if (collections.length === 0) {
      console.error(`❌ Error: Backup collection "${backupName}" not found\n`);
      console.log('Available backups:');
      const allCollections = await db.listCollections().toArray();
      const backups = allCollections
        .filter(c => c.name.startsWith('event_types_backup_'))
        .map(c => c.name);

      if (backups.length === 0) {
        console.log('  (none)\n');
      } else {
        backups.forEach(b => console.log(`  • ${b}`));
        console.log('');
      }

      process.exit(1);
    }

    // Get backup info
    const backupCollection = db.collection(backupName);
    const backupCount = await backupCollection.countDocuments();

    console.log(`📋 Backup Information:`);
    console.log(`   Collection: ${backupName}`);
    console.log(`   Documents: ${backupCount}\n`);

    if (backupCount === 0) {
      console.error('❌ Error: Backup collection is empty!\n');
      process.exit(1);
    }

    // Get current event_types info (if exists)
    const eventTypesCollection = db.collection('event_types');
    let currentCount = 0;
    try {
      currentCount = await eventTypesCollection.countDocuments();
    } catch (error) {
      // Collection might not exist
    }

    console.log(`📋 Current State:`);
    console.log(`   Collection: event_types`);
    console.log(`   Documents: ${currentCount}\n`);

    // Confirm
    console.log('⚠️  WARNING: This will:');
    console.log(`   1. Delete all ${currentCount} document(s) from event_types`);
    console.log(`   2. Copy all ${backupCount} document(s) from ${backupName}`);
    console.log(`   3. Cannot be undone (unless you have another backup)\n`);

    // Auto-proceed (for scripting, add --confirm flag check if needed)
    console.log('🔄 Starting restore...\n');

    // Create safety backup of current state (if exists)
    if (currentCount > 0) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T').join('_').slice(0, -5);
      const safetyBackupName = `event_types_before_restore_${timestamp}`;

      console.log(`💾 Creating safety backup: ${safetyBackupName}`);
      const currentDocs = await eventTypesCollection.find({}).toArray();
      await db.collection(safetyBackupName).insertMany(currentDocs);
      console.log(`   ✅ Safety backup created (${currentDocs.length} documents)\n`);
    }

    // Drop current collection
    console.log('🗑️  Dropping current event_types collection...');
    await eventTypesCollection.drop().catch(() => {
      // Collection might not exist, that's ok
    });
    console.log('   ✅ Dropped\n');

    // Restore from backup
    console.log(`📥 Restoring from ${backupName}...`);
    const backupDocs = await backupCollection.find({}).toArray();
    if (backupDocs.length > 0) {
      await eventTypesCollection.insertMany(backupDocs);
    }
    console.log(`   ✅ Restored ${backupDocs.length} document(s)\n`);

    // Verify
    const restoredCount = await eventTypesCollection.countDocuments();
    console.log('✅ Verification:');
    console.log(`   event_types now has: ${restoredCount} document(s)`);
    console.log(`   Backup had: ${backupCount} document(s)`);

    if (restoredCount === backupCount) {
      console.log(`   ✅ Counts match - restore successful!\n`);
    } else {
      console.log(`   ⚠️  Warning: Counts don't match!\n`);
    }

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ Restore completed successfully!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  } catch (error) {
    console.error('\n❌ Fatal error:', error);
    throw error;
  } finally {
    if (mongoClient) {
      await mongoClient.close();
      console.log('🔌 MongoDB connection closed\n');
    }
  }
}

// Run the script
if (require.main === module) {
  restoreFromBackup()
    .then(() => {
      console.log('✨ Done!\n');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Fatal error:', error);
      process.exit(1);
    });
}

module.exports = { restoreFromBackup };
