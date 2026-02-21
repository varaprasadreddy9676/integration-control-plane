# Event Schema Discovery Script

Automatically syncs event schemas from production MySQL `notification_queue` to MongoDB `event_types` collection.

## Quick Reference

```bash
# Interactive menu (easiest)
./scripts/sync-schemas.sh

# Preview changes (safe, no updates)
./scripts/sync-schemas.sh preview

# Apply changes (with confirmation & backup)
./scripts/sync-schemas.sh apply

# List backups
./scripts/sync-schemas.sh list-backups

# Restore from backup
./scripts/sync-schemas.sh restore

# Or use npm
npm run sync:schemas:interactive
```

## What It Does

1. **Connects to production MySQL** and reads recent events from `notification_queue`
2. **Analyzes last N events** per event type (configurable, default: 100)
3. **Extracts all field paths** from JSON payloads (e.g., `patient.mrn.documentNumber`, `visit.sealed`)
4. **Filters fields** that appear in X% of events (configurable threshold, default: 60%)
5. **Shows diff** of changes (added/removed/kept fields)
6. **Updates MongoDB** `event_types` collection with accurate schemas (with --apply flag)
7. **Auto-creates new event types** if discovered in production (with --create-missing flag)

## Key Features

✅ **Interactive shell script** - Easy-to-use menu interface
✅ **Dry-run by default** - Preview changes before applying
✅ **Automatic backups** - Creates timestamped backup before any changes
✅ **Diff mode** - Shows added/removed/kept fields
✅ **Preserves descriptions** - Keeps your custom field descriptions
✅ **Smart array handling** - Analyzes up to 20 array elements (not just first)
✅ **Null tracking** - Properly handles null values
✅ **Event filtering** - Process specific event types only
✅ **Production-safe** - Read-only MySQL access
✅ **Performance optimized** - Scans recent events only, not full table
✅ **One-command restore** - Easy backup restoration

## Shell Script Features

The `sync-schemas.sh` script provides a user-friendly interface:

- **Interactive Menu** - No need to remember commands
- **Safety Confirmations** - Prompts before applying changes
- **Color-coded Output** - Easy to read status messages
- **Preview-first Workflow** - Always shows changes before applying
- **Integrated Backup Management** - List and restore backups easily

**Interactive Menu:**
```
Event Schema Sync - Interactive Menu
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

What would you like to do?

  1. Preview changes (dry-run, safe)
  2. Apply changes (updates MongoDB with backup)
  3. Restore from backup
  4. List available backups
  5. Custom options (advanced)
  6. Exit

Enter choice [1-6]:
```

## Usage

### Quick Start (Shell Script - Recommended)

**Interactive menu:**
```bash
cd backend
./scripts/sync-schemas.sh
```

**Direct commands:**
```bash
# Preview changes (safe, dry-run)
./scripts/sync-schemas.sh preview

# Apply changes (with confirmation)
./scripts/sync-schemas.sh apply

# Restore from backup
./scripts/sync-schemas.sh restore

# List available backups
./scripts/sync-schemas.sh list-backups
```

### Manual Usage (Node.js)

**Preview changes without modifying MongoDB:**

```bash
cd backend
node scripts/sync-event-schemas.js
```

**Apply changes (update MongoDB):**

```bash
node scripts/sync-event-schemas.js --apply
```

### Advanced Usage

**With shell script:**
```bash
# Sample 500 events per type with 80% threshold
./scripts/sync-schemas.sh apply --limit 500 --threshold 0.8

# Process specific event types only
./scripts/sync-schemas.sh preview --event-types OP_VISIT_CREATED,APPOINTMENT_CONFIRMATION

# Create new event types automatically
./scripts/sync-schemas.sh apply --create-missing

# Restore specific backup
./scripts/sync-schemas.sh restore event_types_backup_2026-02-02_14-30-25
```

**Direct with Node.js:**
```bash
# Sample 500 events per type with 80% threshold
node scripts/sync-event-schemas.js --limit 500 --threshold 0.8 --apply

# Process specific event types only
node scripts/sync-event-schemas.js --event-types OP_VISIT_CREATED,APPOINTMENT_CONFIRMATION --apply

# Create new event types automatically
node scripts/sync-event-schemas.js --create-missing --apply

# Increase array sample size to 50 elements
node scripts/sync-event-schemas.js --array-sample 50 --apply

# Combined: specific events, higher threshold, create missing
node scripts/sync-event-schemas.js \
  --event-types OP_VISIT_CREATED,APPOINTMENT_CONFIRMATION \
  --limit 200 \
  --threshold 0.7 \
  --create-missing \
  --apply
```

### NPM Scripts

**Interactive shell script (recommended):**
```bash
npm run sync:schemas:interactive
```

**Direct sync commands:**
```bash
# Dry-run preview
npm run sync:schemas

# Apply with arguments
npm run sync:schemas -- --apply
npm run sync:schemas -- --event-types OP_VISIT_CREATED --apply
```

**Restore from backup:**
```bash
npm run restore:schemas event_types_backup_2026-02-02_14-30-25
```

## CLI Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `--apply` | flag | false | Actually update MongoDB (default: dry-run) |
| `--limit N` | number | 100 | Number of events to sample per type |
| `--threshold N` | float | 0.6 | Inclusion threshold (0-1). Field must appear in N% of events |
| `--event-types TYPE1,TYPE2` | string | all | Comma-separated list of event types to process |
| `--create-missing` | flag | false | Auto-create new event types discovered in production |
| `--array-sample N` | number | 20 | Max array elements to analyze per field |
| `--skip-backup` | flag | false | Skip automatic backup (NOT RECOMMENDED) |

## Output Example

```
🔍 Event Schema Discovery Script
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Configuration:
  • Sample size: 100 events per type
  • Inclusion threshold: 60%
  • Array sample size: 20 elements
  • Mode: 🟡 DRY-RUN (no changes)
  • Create missing: No

📦 Connecting to MySQL (notification_queue)...
✅ MySQL connected

📦 Connecting to MongoDB...
✅ MongoDB connected

🔎 Discovering event types from notification_queue...
📊 Found 25 event type(s):

   • APPOINTMENT_CANCELLATION
   • APPOINTMENT_CONFIRMATION
   • APPOINTMENT_RESCHEDULED
   • OP_VISIT_CREATED
   ...

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 Processing: OP_VISIT_CREATED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

   📥 Sampled 100 event(s)
   🔍 Discovered 32 field(s) above threshold
   📊 Changes:
      • Added: 3
      • Removed: 5
      • Kept: 29

   ➕ New fields:
      • patient.confidential (boolean) - 95/100 coverage - example: false
      • visit.patientAgeInDays (number) - 100/100 coverage - example: 0
      • visit.freeRemainingCount (number) - 88/100 coverage - example: 0

   ➖ Removed fields (below threshold):
      • visit.oldFieldName
      • patient.deprecatedField

   🟡 DRY-RUN: Would update in MongoDB (use --apply to execute)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 Summary
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  • Total event types: 25
  • Updated: 0
  • Created: 0
  • Skipped: 0
  • Errors: 0

  🟡 DRY-RUN MODE: No changes were made to MongoDB
  ℹ️  Run with --apply to update MongoDB

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🔌 MySQL connection closed
🔌 MongoDB connection closed

✨ Done!
```

## When to Run

- **After production event changes** - When you know event structures have changed
- **New event types added** - Script will auto-discover and create them (with --create-missing)
- **Before major releases** - Ensure schemas are up-to-date
- **Weekly/monthly maintenance** - Keep schemas fresh
- **After deployment** - Verify production events match expected schemas

## Automatic Backup & Restore

### Automatic Backup

**Every time you run with `--apply`, the script automatically:**

1. ✅ Creates timestamped backup collection (e.g., `event_types_backup_2026-02-02_14-30-25`)
2. ✅ Copies all documents from `event_types` to backup
3. ✅ Keeps last 5 backups (auto-deletes older ones)
4. ✅ Shows backup name in summary output

```bash
node scripts/sync-event-schemas.js --apply

# Output:
💾 Creating backup: event_types_backup_2026-02-02_14-30-25
   ✅ Backed up 25 document(s) to event_types_backup_2026-02-02_14-30-25
```

### List Backups

```bash
# MongoDB shell
mongosh webhook_manager

# List all backups
db.getCollectionNames().filter(name => name.startsWith('event_types_backup_'))

# Example output:
[
  'event_types_backup_2026-02-02_14-30-25',
  'event_types_backup_2026-02-01_10-15-30',
  'event_types_backup_2026-01-31_16-45-10'
]
```

### Restore from Backup

If you need to rollback changes:

#### Option 1: Manual Restore (Recommended)

```bash
# MongoDB shell
mongosh webhook_manager

# 1. Drop current event_types (if corrupted)
db.event_types.drop()

# 2. Copy backup to event_types
db.event_types_backup_2026-02-02_14-30-25.find().forEach(doc => {
  db.event_types.insertOne(doc)
})

# 3. Verify restore
db.event_types.countDocuments()  // Should match backup count
```

#### Option 2: Rename Collection (Faster)

```bash
mongosh webhook_manager

# 1. Rename current to old (backup)
db.event_types.renameCollection('event_types_corrupted_2026-02-02')

# 2. Rename backup to current
db.event_types_backup_2026-02-02_14-30-25.renameCollection('event_types')

# 3. Verify
db.event_types.countDocuments()
```

#### Option 3: Restore Script (Easiest)

Use the provided restore script:

```bash
# List available backups
mongosh webhook_manager --eval "db.getCollectionNames().filter(n => n.startsWith('event_types_backup_'))"

# Restore from specific backup
node scripts/restore-from-backup.js event_types_backup_2026-02-02_14-30-25
```

**What the script does:**
- ✅ Validates backup exists
- ✅ Shows backup info (document count)
- ✅ Creates safety backup of current state before restoring
- ✅ Drops current `event_types`
- ✅ Restores from backup
- ✅ Verifies restoration succeeded

### Skip Backup (NOT RECOMMENDED)

```bash
# Only for testing or if you have external backups
node scripts/sync-event-schemas.js --apply --skip-backup
```

**⚠️ Warning:** Skipping backup means no easy rollback if something goes wrong!

### Backup Retention

- **Automatic cleanup:** Keeps last 5 backups, deletes older ones
- **Manual cleanup:** Delete old backups in MongoDB shell

```bash
mongosh webhook_manager

# Delete specific backup
db.event_types_backup_2026-01-15_10-30-45.drop()

# Delete all backups older than 30 days
db.getCollectionNames()
  .filter(name => name.startsWith('event_types_backup_'))
  .forEach(name => {
    const dateStr = name.replace('event_types_backup_', '');
    // Parse and check age, then drop if old
  })
```

## Important Notes

### Safety Features

1. **Automatic backups** - Creates timestamped backup collection before ANY changes (e.g., `event_types_backup_2026-02-02_14-30-25`)
2. **Dry-run by default** - Script previews changes and requires `--apply` to actually update MongoDB
3. **Preserves custom descriptions** - Your manually written field descriptions are kept, only new fields get auto-generated descriptions
4. **Read-only MySQL** - Script only reads from `notification_queue`, never writes to MySQL
5. **Diff output** - Shows exactly what will change before applying
6. **Event type filtering** - Can target specific event types to avoid touching others
7. **Backup retention** - Automatically keeps last 5 backups, deletes older ones

### Field Handling

1. **Array handling** - Analyzes up to 20 elements per array (configurable with `--array-sample`), not just the first element
2. **Null tracking** - Properly tracks null values and includes them in coverage calculations
3. **Type inference** - Detects string, number, boolean, object, array, null, or mixed types
4. **Coverage tracking** - Shows how many events contain each field (e.g., "95/100 coverage")

### Auto-discovered Event Types

1. **Requires `--create-missing` flag** - New event types are only created when explicitly enabled
2. **eventTypeId set to null** - You must manually assign IDs after creation
3. **Marked with `isAutoDiscovered: true`** - Easy to identify in MongoDB
4. **Category set to "Auto-discovered"** - Can be manually updated later

## Troubleshooting

### MySQL connection error

```
Error: connect ECONNREFUSED 127.0.0.1:3306
```

**Solution:**
- Check `backend/config.json` has correct MySQL credentials
- Verify MySQL server is running
- Check host, port, user, password, database settings

### MongoDB connection error

```
Error: connect ECONNREFUSED 127.0.0.1:27017
```

**Solution:**
- Check `backend/config.json` has correct MongoDB URI
- Verify MongoDB is running
- Test connection: `mongosh <your-mongodb-uri>`

### No events found

```
⚠️  No events found, skipping...
```

**Solution:**
- Check `notification_queue` table has data: `SELECT COUNT(*) FROM notification_queue WHERE transaction_type = 'OP_VISIT_CREATED';`
- Verify `transaction_type` column is populated (not NULL or empty)
- Check if event type name is correct (case-sensitive)

### Fields missing from discovery

```
Expected field not discovered
```

**Solution:**
- Check if field appears in less than 60% of sampled events
- Lower threshold: `--threshold 0.4` (40%)
- Increase sample size: `--limit 500`
- Check if field value is always null (might be filtered out)

### Parse errors

```
⚠️  Failed to parse event: Unexpected token...
```

**Solution:**
- Check if `message` column contains valid JSON
- Verify JSON encoding in MySQL (should be utf8mb3 or utf8mb4)
- Check for truncated JSON in database

## Schema Details

### MySQL Table: `notification_queue`

The script reads from these columns:
- `transaction_type` (varchar) - Event type identifier
- `message` (json) - Event payload as JSON

### MongoDB Collection: `event_types`

The script updates/creates these fields:
```javascript
{
  eventType: "OP_VISIT_CREATED",           // Matches transaction_type
  eventTypeId: 1,                          // Manual assignment needed for new types
  label: "Op Visit Created",               // Auto-generated from eventType
  description: "...",                      // Manual or auto-generated
  category: "Visit Management",            // Manual or "Auto-discovered"
  implementationClass: "...",              // Usually null for auto-discovered
  fields: [                                // ✅ Updated by script
    {
      path: "visit.sealed",
      type: "boolean",
      description: "Visit sealed status",  // Preserved if exists, generated if new
      example: false
    },
    // ... more fields
  ],
  samplePayload: { ... },                  // ✅ Updated by script - latest event sample
  lastSyncedAt: ISODate("..."),            // ✅ Updated by script - last sync timestamp
  syncedEventCount: 100,                   // ✅ Updated by script - number of events analyzed
  isAutoDiscovered: true                   // Set for new event types
}
```

## Performance Optimization

The script is optimized for large production tables:

### Event Type Discovery (Fast)

Instead of `SELECT DISTINCT transaction_type FROM notification_queue` (slow on millions of rows), the script:

1. **Scans recent events only** - Last N×10 rows (e.g., 1000 rows for --limit 100)
   ```sql
   SELECT DISTINCT transaction_type
   FROM (
     SELECT transaction_type FROM notification_queue
     ORDER BY id DESC LIMIT 1000
   ) AS recent
   ```

2. **Merges with MongoDB known types** - Fast lookup of existing event types
3. **Result**: Milliseconds instead of seconds, even with millions of rows

### Why This Works

- Recent events contain active event types
- Inactive/historical types are already in MongoDB
- Combined approach catches both new and existing types
- **10x faster** than full table DISTINCT

### If You Need Full Discovery

Add dedicated index (run once):
```sql
CREATE INDEX idx_transaction_type ON notification_queue(transaction_type);
```

Then increase scan window:
```bash
node scripts/sync-event-schemas.js --limit 1000  # Scans last 10K events
```

## Best Practices

1. **Run dry-run first** - Always preview changes before applying
   ```bash
   node scripts/sync-event-schemas.js
   ```

2. **Test with specific event types** - Validate one event type before processing all
   ```bash
   node scripts/sync-event-schemas.js --event-types OP_VISIT_CREATED
   ```

3. **Use higher sample size in production** - 100-500 events gives better coverage
   ```bash
   node scripts/sync-event-schemas.js --limit 500 --apply
   ```

4. **Review diffs carefully** - Check removed fields aren't still in use

5. **Manual review for new event types** - Verify auto-generated labels, categories, and assign eventTypeId

6. **Keep custom descriptions** - Script preserves them automatically

7. **Run after schema changes** - Don't wait for monthly maintenance if you know events changed

## Comparison with Manual Approach

| Aspect | Manual Approach | Schema Discovery Script |
|--------|----------------|-------------------------|
| Accuracy | ❌ Prone to human error | ✅ 100% accurate to production |
| Speed | ❌ Hours of work | ✅ Seconds |
| Coverage | ❌ Might miss fields | ✅ Finds all fields above threshold |
| New events | ❌ Easy to miss | ✅ Auto-detects |
| Field changes | ❌ Hard to track | ✅ Shows clear diff |
| Safety | ⚠️ Direct edits risky | ✅ Dry-run + automatic backups |
| Rollback | ❌ Manual restoration | ✅ One-command restore from backup |
| Maintenance | ❌ Recurring manual work | ✅ One command |
