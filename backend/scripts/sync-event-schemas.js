/**
 * Event Schema Discovery Script
 *
 * Automatically discovers event schemas from production notification_queue
 * and updates MongoDB event_types collection.
 *
 * Usage:
 *   node scripts/sync-event-schemas.js [options]
 *
 * Options:
 *   --apply               Actually update MongoDB (default: dry-run only)
 *   --limit N             Number of events to sample per type (default: 100)
 *   --threshold N         Inclusion threshold 0-1 (default: 0.6 = 60%)
 *   --event-types TYPE1,TYPE2  Only process specific event types (comma-separated)
 *   --create-missing      Auto-create new event types (default: false)
 *   --array-sample N      Max array elements to analyze (default: 20)
 *   --skip-backup         Skip automatic backup (NOT RECOMMENDED)
 *
 * Examples:
 *   node scripts/sync-event-schemas.js
 *   node scripts/sync-event-schemas.js --apply
 *   node scripts/sync-event-schemas.js --limit 500 --threshold 0.8 --apply
 *   node scripts/sync-event-schemas.js --event-types OP_VISIT_CREATED,APPOINTMENT_CONFIRMATION --apply
 */

const mysql = require('mysql2/promise');
const { MongoClient } = require('mongodb');
const config = require('../src/config');

// Parse CLI arguments
const args = process.argv.slice(2);
const getArg = (name, defaultValue) => {
  const index = args.indexOf(name);
  if (index === -1) return defaultValue;
  const value = args[index + 1];
  return value !== undefined ? value : defaultValue;
};
const hasFlag = (name) => args.includes(name);

const APPLY_CHANGES = hasFlag('--apply');
const SAMPLE_SIZE = parseInt(getArg('--limit', '100'), 10);
let INCLUSION_THRESHOLD = parseFloat(getArg('--threshold', '0.6'));
const FILTER_EVENT_TYPES = getArg('--event-types', null)?.split(',').map(t => t.trim());
const CREATE_MISSING = hasFlag('--create-missing');
const ARRAY_SAMPLE_SIZE = parseInt(getArg('--array-sample', '20'), 10);
const SKIP_BACKUP = hasFlag('--skip-backup'); // Allow skipping backup (not recommended)

// Validate threshold (must be between 0 and 1)
if (isNaN(INCLUSION_THRESHOLD) || INCLUSION_THRESHOLD < 0 || INCLUSION_THRESHOLD > 1) {
  console.error(`Error: --threshold must be between 0 and 1, got: ${getArg('--threshold', '0.6')}`);
  process.exit(1);
}

/**
 * Track field statistics per event (not per occurrence)
 */
class FieldTracker {
  constructor() {
    this.fields = new Map();
  }

  /**
   * Track a field for a specific event
   * @param {number} eventId - Unique event identifier
   * @param {string} path - Field path (e.g., "patient.mrn.documentNumber")
   * @param {*} value - Field value
   */
  track(eventId, path, value) {
    if (!this.fields.has(path)) {
      this.fields.set(path, {
        types: new Set(),
        examples: [],
        eventIds: new Set(), // Track which events contain this field
        nullEventIds: new Set() // Track which events have null value
      });
    }

    const field = this.fields.get(path);
    field.eventIds.add(eventId); // Mark that this event contains the field

    if (value === null || value === undefined) {
      field.nullEventIds.add(eventId);
      field.types.add('null');
    } else {
      const type = Array.isArray(value) ? 'array' : typeof value;
      field.types.add(type);
      if (field.examples.length < 5) { // Keep max 5 examples
        field.examples.push(value);
      }
    }
  }

  /**
   * Get fields that appear in at least threshold% of events
   * @param {number} totalEvents - Total number of events analyzed
   * @param {number} threshold - Inclusion threshold (0-1)
   * @returns {Array} Fields above threshold
   */
  getFields(totalEvents, threshold) {
    const result = [];
    const minEventCount = Math.ceil(totalEvents * threshold);

    for (const [path, data] of this.fields.entries()) {
      const eventCount = data.eventIds.size; // Number of events containing this field

      if (eventCount >= minEventCount) {
        // Infer best type
        const types = Array.from(data.types).filter(t => t !== 'null');
        let type = 'string'; // default

        if (types.length === 0) {
          type = 'null';
        } else if (types.length === 1) {
          type = types[0];
        } else {
          type = 'mixed';
        }

        // Get best example (prefer non-null)
        const nonNullExamples = data.examples.filter(e => e !== null && e !== undefined);
        const example = nonNullExamples.length > 0 ? nonNullExamples[0] : null;

        result.push({
          path,
          type,
          example,
          coverage: `${eventCount}/${totalEvents}`, // Now tracks events, not occurrences
          coveragePercent: Math.round((eventCount / totalEvents) * 100),
          nullCount: data.nullEventIds.size
        });
      }
    }

    return result;
  }
}

/**
 * Recursively extract all field paths from a JSON object
 * @param {*} obj - Object to extract fields from
 * @param {string} parentPath - Parent path (for recursion)
 * @param {FieldTracker} tracker - Field tracker instance
 * @param {number} eventId - Event ID (for per-event tracking)
 * @param {Set} seenPaths - Paths already seen in this event (to avoid double-counting)
 */
function extractFieldPaths(obj, parentPath, tracker, eventId, seenPaths = new Set()) {
  if (obj === null || obj === undefined) {
    if (parentPath && !seenPaths.has(parentPath)) {
      tracker.track(eventId, parentPath, obj);
      seenPaths.add(parentPath);
    }
    return;
  }

  if (Array.isArray(obj)) {
    // Analyze multiple array elements (capped)
    const sampleSize = Math.min(obj.length, ARRAY_SAMPLE_SIZE);
    for (let i = 0; i < sampleSize; i++) {
      const element = obj[i];
      if (element !== null && element !== undefined && typeof element === 'object') {
        extractFieldPaths(element, `${parentPath}[]`, tracker, eventId, seenPaths);
      } else {
        if (!seenPaths.has(`${parentPath}[]`)) {
          tracker.track(eventId, `${parentPath}[]`, element);
          seenPaths.add(`${parentPath}[]`);
        }
      }
    }
    return;
  }

  if (typeof obj === 'object') {
    for (const [key, value] of Object.entries(obj)) {
      const currentPath = parentPath ? `${parentPath}.${key}` : key;

      if (value === null || value === undefined) {
        if (!seenPaths.has(currentPath)) {
          tracker.track(eventId, currentPath, value);
          seenPaths.add(currentPath);
        }
      } else if (Array.isArray(value)) {
        extractFieldPaths(value, currentPath, tracker, eventId, seenPaths);
      } else if (typeof value === 'object') {
        extractFieldPaths(value, currentPath, tracker, eventId, seenPaths);
      } else {
        if (!seenPaths.has(currentPath)) {
          tracker.track(eventId, currentPath, value);
          seenPaths.add(currentPath);
        }
      }
    }
  } else {
    // Primitive at root level
    if (!seenPaths.has(parentPath)) {
      tracker.track(eventId, parentPath, obj);
      seenPaths.add(parentPath);
    }
  }
}

/**
 * Generate human-readable description from field path
 */
function generateDescription(path) {
  const parts = path.split('.').filter(p => p !== '[]');
  const fieldName = parts[parts.length - 1];

  // Convert camelCase/snake_case to words
  const words = fieldName
    .replace(/([A-Z])/g, ' $1')
    .replace(/_/g, ' ')
    .trim()
    .toLowerCase();

  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Compare old and new field schemas
 */
function diffFields(oldFields, newFields) {
  const oldPaths = new Set(oldFields.map(f => f.path));
  const newPaths = new Set(newFields.map(f => f.path));

  const added = newFields.filter(f => !oldPaths.has(f.path));
  const removed = oldFields.filter(f => !newPaths.has(f.path));
  const kept = newFields.filter(f => oldPaths.has(f.path));

  return { added, removed, kept };
}

/**
 * Create backup of event_types collection before making changes
 * @param {Object} db - MongoDB database instance
 * @returns {string} - Backup collection name
 */
async function createBackup(db) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T').join('_').slice(0, -5);
  const backupCollectionName = `event_types_backup_${timestamp}`;

  console.log(`\n💾 Creating backup: ${backupCollectionName}`);

  const eventTypesCollection = db.collection('event_types');
  const backupCollection = db.collection(backupCollectionName);

  // Copy all documents
  const allDocs = await eventTypesCollection.find({}).toArray();

  if (allDocs.length === 0) {
    console.log(`   ⚠️  No documents to backup (event_types is empty)`);
    return backupCollectionName;
  }

  await backupCollection.insertMany(allDocs);

  console.log(`   ✅ Backed up ${allDocs.length} document(s) to ${backupCollectionName}`);
  console.log(`   💡 To restore: mongorestore or manual copy from this collection\n`);

  return backupCollectionName;
}

/**
 * Clean up old backup collections (keep last N)
 * @param {Object} db - MongoDB database instance
 * @param {number} keepLast - Number of recent backups to keep
 */
async function cleanupOldBackups(db, keepLast = 5) {
  const collections = await db.listCollections().toArray();
  const backupCollections = collections
    .filter(c => c.name.startsWith('event_types_backup_'))
    .map(c => c.name)
    .sort()
    .reverse(); // Newest first

  if (backupCollections.length <= keepLast) {
    return; // Nothing to clean up
  }

  const toDelete = backupCollections.slice(keepLast);

  console.log(`\n🧹 Cleaning up old backups (keeping last ${keepLast})...`);

  for (const collectionName of toDelete) {
    await db.collection(collectionName).drop();
    console.log(`   🗑️  Deleted: ${collectionName}`);
  }

  console.log(`   ✅ Cleanup complete\n`);
}

/**
 * Main discovery function
 */
async function discoverSchemas() {
  let mysqlConnection;
  let mongoClient;

  try {
    console.log('🔍 Event Schema Discovery Script');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('Configuration:');
    console.log(`  • Sample size: ${SAMPLE_SIZE} events per type`);
    console.log(`  • Inclusion threshold: ${Math.round(INCLUSION_THRESHOLD * 100)}%`);
    console.log(`  • Array sample size: ${ARRAY_SAMPLE_SIZE} elements`);
    console.log(`  • Mode: ${APPLY_CHANGES ? '🔴 APPLY (will update MongoDB)' : '🟡 DRY-RUN (no changes)'}`);
    if (FILTER_EVENT_TYPES) {
      console.log(`  • Filtered event types: ${FILTER_EVENT_TYPES.join(', ')}`);
    }
    console.log(`  • Create missing: ${CREATE_MISSING ? 'Yes' : 'No'}`);
    console.log(`  • Backup: ${APPLY_CHANGES && !SKIP_BACKUP ? 'Yes (automatic)' : SKIP_BACKUP ? 'No (--skip-backup)' : 'N/A (dry-run)'}`);
    console.log('');

    // Connect to MySQL
    console.log('📦 Connecting to MySQL (notification_queue)...');
    mysqlConnection = await mysql.createConnection({
      host: config.db.host,
      user: config.db.user,
      password: config.db.password,
      database: config.db.database,
      port: config.db.port
    });
    console.log('✅ MySQL connected\n');

    // Connect to MongoDB
    console.log('📦 Connecting to MongoDB...');
    mongoClient = new MongoClient(config.mongodb.uri, config.mongodb.options || {});
    await mongoClient.connect();
    const db = mongoClient.db(config.mongodb.database);
    const eventTypesCollection = db.collection('event_types');
    console.log('✅ MongoDB connected\n');

    // Create backup before making any changes
    let backupCollectionName = null;
    if (APPLY_CHANGES && !SKIP_BACKUP) {
      backupCollectionName = await createBackup(db);
      // Clean up old backups (keep last 5)
      await cleanupOldBackups(db, 5);
    }

    // Get distinct event types
    console.log('🔎 Discovering event types...');

    let eventTypes;

    if (FILTER_EVENT_TYPES) {
      // User specified event types - validate they exist
      console.log(`   Using filtered event types: ${FILTER_EVENT_TYPES.join(', ')}`);
      eventTypes = FILTER_EVENT_TYPES.map(type => ({ transaction_type: type }));
    } else {
      // Discover from recent events (much faster than DISTINCT on full table)
      console.log(`   Scanning last ${SAMPLE_SIZE * 10} events for event types...`);

      const [recentEvents] = await mysqlConnection.query(`
        SELECT DISTINCT transaction_type
        FROM (
          SELECT transaction_type
          FROM notification_queue
          WHERE transaction_type IS NOT NULL
            AND transaction_type != ''
          ORDER BY id DESC
          LIMIT ?
        ) AS recent
        ORDER BY transaction_type
      `, [SAMPLE_SIZE * 10]); // Sample 10x the limit for better coverage

      eventTypes = recentEvents;

      // Also check MongoDB for known event types (fast)
      const knownEventTypes = await eventTypesCollection.distinct('eventType');

      // Merge: use MongoDB known types + recently seen types
      const recentTypes = new Set(recentEvents.map(e => e.transaction_type));
      for (const knownType of knownEventTypes) {
        if (!recentTypes.has(knownType)) {
          // Add known type even if not in recent events (might be inactive but should be synced)
          eventTypes.push({ transaction_type: knownType });
        }
      }

      // Sort
      eventTypes.sort((a, b) => a.transaction_type.localeCompare(b.transaction_type));

      console.log(`   Found ${recentTypes.size} recent event type(s) + ${knownEventTypes.length - recentTypes.size} known type(s) = ${eventTypes.length} total`);
    }

    console.log(`📊 Found ${eventTypes.length} event type(s):\n`);
    eventTypes.forEach(et => console.log(`   • ${et.transaction_type}`));
    console.log('');

    const summary = {
      total: eventTypes.length,
      updated: 0,
      created: 0,
      skipped: 0,
      errors: 0
    };

    // Process each event type
    for (const { transaction_type } of eventTypes) {
      console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.log(`📋 Processing: ${transaction_type}`);
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

      try {
        // Get last N events of this type
        const [events] = await mysqlConnection.query(`
          SELECT message
          FROM notification_queue
          WHERE transaction_type = ?
          ORDER BY id DESC
          LIMIT ?
        `, [transaction_type, SAMPLE_SIZE]);

        console.log(`   📥 Sampled ${events.length} event(s)`);

        if (events.length === 0) {
          console.log(`   ⚠️  No events found, skipping...\n`);
          summary.skipped++;
          continue;
        }

        // Extract fields from all events
        const tracker = new FieldTracker();
        let samplePayload = null;

        for (let eventIndex = 0; eventIndex < events.length; eventIndex++) {
          const event = events[eventIndex];
          try {
            const payload = typeof event.message === 'string'
              ? JSON.parse(event.message)
              : event.message;

            if (!samplePayload) {
              samplePayload = payload; // Keep first payload as sample
            }

            // Extract fields with eventId for per-event tracking
            extractFieldPaths(payload, '', tracker, eventIndex);
          } catch (error) {
            console.log(`   ⚠️  Failed to parse event: ${error.message}`);
          }
        }

        // Get fields above threshold
        const discoveredFields = tracker.getFields(events.length, INCLUSION_THRESHOLD);

        console.log(`   🔍 Discovered ${discoveredFields.length} field(s) above threshold`);

        // Check if event type exists in MongoDB
        const existingEventType = await eventTypesCollection.findOne({ eventType: transaction_type });

        if (existingEventType) {
          // Show diff
          const oldFields = existingEventType.fields || [];
          const { added, removed, kept } = diffFields(oldFields, discoveredFields);

          console.log(`   📊 Changes:`);
          console.log(`      • Added: ${added.length}`);
          console.log(`      • Removed: ${removed.length}`);
          console.log(`      • Kept: ${kept.length}`);

          if (added.length > 0) {
            console.log(`\n   ➕ New fields:`);
            added.slice(0, 10).forEach(f => {
              const exampleStr = typeof f.example === 'string'
                ? `"${f.example}"`
                : JSON.stringify(f.example);
              console.log(`      • ${f.path} (${f.type}) - ${f.coverage} events (${f.coveragePercent}%) - example: ${exampleStr}`);
            });
            if (added.length > 10) {
              console.log(`      ... and ${added.length - 10} more`);
            }
          }

          if (removed.length > 0) {
            console.log(`\n   ➖ Removed fields (below threshold):`);
            removed.slice(0, 5).forEach(f => {
              console.log(`      • ${f.path}`);
            });
            if (removed.length > 5) {
              console.log(`      ... and ${removed.length - 5} more`);
            }
          }

          // Build final field list (preserve existing descriptions)
          const finalFields = discoveredFields.map(newField => {
            const existing = oldFields.find(f => f.path === newField.path);
            return {
              path: newField.path,
              type: newField.type,
              description: existing?.description || generateDescription(newField.path),
              example: newField.example
            };
          });

          // Sort fields alphabetically
          finalFields.sort((a, b) => a.path.localeCompare(b.path));

          if (APPLY_CHANGES) {
            await eventTypesCollection.updateOne(
              { eventType: transaction_type },
              {
                $set: {
                  fields: finalFields,
                  samplePayload: samplePayload,
                  lastSyncedAt: new Date(),
                  syncedEventCount: events.length
                }
              }
            );
            console.log(`\n   💾 Updated in MongoDB`);
            summary.updated++;
          } else {
            console.log(`\n   🟡 DRY-RUN: Would update in MongoDB (use --apply to execute)`);
          }

        } else {
          // New event type
          console.log(`   ✨ New event type discovered!`);

          if (!CREATE_MISSING && !APPLY_CHANGES) {
            console.log(`   🟡 DRY-RUN: Would create in MongoDB (use --create-missing --apply)`);
            summary.skipped++;
            continue;
          }

          if (!CREATE_MISSING) {
            console.log(`   ⚠️  Skipping creation (use --create-missing to enable)`);
            summary.skipped++;
            continue;
          }

          // Build field list with generated descriptions
          const finalFields = discoveredFields.map(f => ({
            path: f.path,
            type: f.type,
            description: generateDescription(f.path),
            example: f.example
          }));

          finalFields.sort((a, b) => a.path.localeCompare(b.path));

          const newEventType = {
            eventType: transaction_type,
            eventTypeId: null, // Needs manual assignment
            label: transaction_type.split('_').map(w => w.charAt(0) + w.slice(1).toLowerCase()).join(' '),
            description: `Auto-discovered: ${transaction_type}`,
            category: 'Auto-discovered',
            implementationClass: null,
            fields: finalFields,
            samplePayload: samplePayload,
            lastSyncedAt: new Date(),
            syncedEventCount: events.length,
            isAutoDiscovered: true
          };

          if (APPLY_CHANGES) {
            await eventTypesCollection.insertOne(newEventType);
            console.log(`   💾 Created in MongoDB`);
            console.log(`   ⚠️  Note: eventTypeId needs manual assignment`);
            summary.created++;
          } else {
            console.log(`   🟡 DRY-RUN: Would create in MongoDB (use --apply)`);
          }
        }

      } catch (error) {
        console.error(`   ❌ Error processing ${transaction_type}:`, error.message);
        summary.errors++;
      }
    }

    console.log('\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📊 Summary');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log(`  • Total event types: ${summary.total}`);
    console.log(`  • Updated: ${summary.updated}`);
    console.log(`  • Created: ${summary.created}`);
    console.log(`  • Skipped: ${summary.skipped}`);
    console.log(`  • Errors: ${summary.errors}`);

    if (!APPLY_CHANGES) {
      console.log('\n  🟡 DRY-RUN MODE: No changes were made to MongoDB');
      console.log('  ℹ️  Run with --apply to update MongoDB');
    } else {
      console.log('\n  ✅ Changes applied to MongoDB');
      if (backupCollectionName) {
        console.log(`  💾 Backup created: ${backupCollectionName}`);
        console.log(`  ℹ️  To restore: see backup/restore instructions in README`);
      }
    }

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  } catch (error) {
    console.error('\n❌ Fatal error:', error);
    throw error;
  } finally {
    // Cleanup
    if (mysqlConnection) {
      await mysqlConnection.end();
      console.log('🔌 MySQL connection closed');
    }
    if (mongoClient) {
      await mongoClient.close();
      console.log('🔌 MongoDB connection closed');
    }
  }
}

// Run the script
if (require.main === module) {
  discoverSchemas()
    .then(() => {
      console.log('\n✨ Done!\n');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Fatal error:', error);
      process.exit(1);
    });
}

module.exports = { discoverSchemas };
