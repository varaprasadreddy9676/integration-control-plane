const { MongoClient, ObjectId } = require('mongodb');
const config = require('./config');
const { log } = require('./logger');

let client;
let db;

async function connect(retries = 3) {
  if (db) return db;

  const mongoConfig = config.mongodb || {
    uri: 'mongodb://localhost:27017',
    database: 'integration_gateway'
  };

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      client = new MongoClient(mongoConfig.uri, {
        ...mongoConfig.options,
        useNewUrlParser: true,
        useUnifiedTopology: true,
        serverSelectionTimeoutMS: 5000
      });

      await client.connect();
      db = client.db(mongoConfig.database);

      log('info', 'Connected to MongoDB', {
        database: mongoConfig.database,
        uri: mongoConfig.uri.replace(/\/\/([^:]+):([^@]+)@/, '//$1:***@'), // Hide password in logs
        attempt: attempt + 1
      });

      // Create indexes
      await createIndexes();

      return db;
    } catch (error) {
      const isLastAttempt = attempt === retries;

      if (!isLastAttempt) {
        const delayMs = Math.min(2000 * Math.pow(2, attempt), 10000); // Max 10s
        log('warn', 'MongoDB connection failed, retrying', {
          attempt: attempt + 1,
          maxRetries: retries + 1,
          error: error.message,
          delayMs
        });
        await new Promise(resolve => setTimeout(resolve, delayMs));
      } else {
        log('error', 'MongoDB connection failed after all retries', {
          error: error.message,
          attempts: retries + 1
        });
        throw error;
      }
    }
  }
}

async function createIndexes() {
  try {
    // Integration configs indexes
    await db.collection('integration_configs').createIndexes([
      { key: { orgId: 1, type: 1 }, name: 'org_event_idx' },
      { key: { orgId: 1, isActive: 1 }, name: 'org_active_idx' },
      { key: { orgId: 1, direction: 1 }, name: 'org_direction_idx' },
      { key: { isActive: 1 }, name: 'active_idx' },
      { key: { updatedAt: -1 }, name: 'updated_idx' },
      // Token expiration index - sparse index for OAuth2/Custom auth token management
      { key: { 'outgoingAuthConfig._tokenExpiresAt': 1 }, name: 'token_expiry_idx', sparse: true }
    ]);

    // Users indexes
    await db.collection('users').createIndexes([
      { key: { email: 1 }, name: 'email_unique_idx', unique: true },
      { key: { orgId: 1, role: 1 }, name: 'org_role_idx' },
      { key: { isActive: 1 }, name: 'active_idx' }
    ]);

    // Organizations indexes
    await db.collection('organizations').createIndexes([
      { key: { orgId: 1 }, name: 'org_id_unique_idx', unique: true },
      { key: { name: 1 }, name: 'org_name_idx' }
    ]);

    // Organization units indexes
    await db.collection('org_units').createIndexes([
      { key: { rid: 1 }, name: 'unit_rid_unique_idx', unique: true },
      { key: { orgId: 1 }, name: 'unit_org_idx' }
    ]);

    // Delivery logs collection removed - now using unified execution_logs

    // Delivery attempts indexes - for detailed retry tracking
    await db.collection('delivery_attempts').createIndexes([
      { key: { deliveryLogId: 1, attemptNumber: 1 }, name: 'log_attempt_idx' },
      { key: { orgId: 1, attemptedAt: -1 }, name: 'org_attempted_idx' },
      { key: { __KEEP___KEEP_integrationConfig__Id__: 1, attemptedAt: -1 }, name: 'integration_attempted_idx' },
      { key: { status: 1, attemptedAt: -1 }, name: 'status_attempted_idx' },
      // TTL index - auto-delete attempt details after 90 days
      {
        key: { attemptedAt: 1 },
        expireAfterSeconds: 7776000,
        name: 'ttl_idx'
      }
    ]);

    // Worker checkpoint
    await db.collection('worker_checkpoint').createIndex(
      { workerId: 1 },
      { unique: true, name: 'worker_id_unique_idx' }
    );

    // Processed events - deduplication
    // Migration: Drop old TTL index if it exists with different TTL value
    try {
      const existingIndexes = await db.collection('processed_events').indexes();
      const oldTtlIndex = existingIndexes.find(idx => idx.name === 'ttl_idx');

      if (oldTtlIndex && oldTtlIndex.expireAfterSeconds !== 21600) {
        log('info', 'Migrating processed_events TTL index from 1h to 6h', {
          oldTTL: oldTtlIndex.expireAfterSeconds,
          newTTL: 21600
        });
        await db.collection('processed_events').dropIndex('ttl_idx');
        log('info', 'Old TTL index dropped, will recreate with new TTL');
      }
    } catch (err) {
      // Index might not exist yet, that's fine
      if (err.code !== 27) { // 27 = IndexNotFound
        log('warn', 'TTL index migration check failed', { error: err.message });
      }
    }

    await db.collection('processed_events').createIndexes([
      { key: { eventKey: 1 }, unique: true, name: 'event_key_unique_idx' },
      { key: { eventId: 1 }, unique: true, sparse: true, name: 'event_id_unique_idx' },
      { key: { orgId: 1, eventType: 1 }, name: 'org_event_idx' },
      // Auto-cleanup after 6 hours (matches retry window + buffer)
      {
        key: { processedAt: 1 },
        expireAfterSeconds: 21600,
        name: 'ttl_idx'
      }
    ]);

    // Integration templates indexes
    await db.collection('integration_templates').createIndexes([
      { key: { orgId: 1, category: 1 }, name: 'org_category_idx' },
      { key: { orgId: 1, updatedAt: -1 }, name: 'org_updated_idx' },
      { key: { category: 1 }, name: 'category_idx' },
      { key: { isActive: 1 }, name: 'active_idx' }
    ]);

    // Alert center logs indexes
    await db.collection('alert_center_logs').createIndexes([
      { key: { orgId: 1, createdAt: -1 }, name: 'alert_org_created_idx' },
      { key: { status: 1, createdAt: -1 }, name: 'alert_status_created_idx' },
      { key: { channel: 1, createdAt: -1 }, name: 'alert_channel_created_idx' },
      { key: { type: 1, createdAt: -1 }, name: 'alert_type_created_idx' },
      {
        key: { createdAt: 1 },
        expireAfterSeconds: 7776000,
        name: 'alert_ttl_idx'
      }
    ]);

    // AI interactions indexes - for debugging and auditing
    await db.collection('ai_interactions').createIndexes([
      { key: { orgId: 1, createdAt: -1 }, name: 'entity_created_idx' },
      { key: { operation: 1, createdAt: -1 }, name: 'operation_created_idx' },
      { key: { success: 1, createdAt: -1 }, name: 'success_created_idx' },
      // Auto-cleanup after 90 days
      {
        key: { createdAt: 1 },
        expireAfterSeconds: 7776000,
        name: 'ttl_idx'
      }
    ]);

    // Event audit indexes - comprehensive event tracking
    await db.collection('event_audit').createIndexes([
      // Composite uniqueness: source + sourceId (when available)
      {
        key: { source: 1, sourceId: 1 },
        name: 'source_id_unique_idx',
        unique: true,
        partialFilterExpression: { sourceId: { $exists: true, $ne: null } }
      },
      // Fallback uniqueness: orgId + eventKey + receivedAtBucket
      {
        key: { orgId: 1, eventKey: 1, receivedAtBucket: 1 },
        name: 'fallback_unique_idx',
        unique: true
      },
      // Query performance indexes (all include orgId for tenant scoping)
      { key: { orgId: 1, receivedAt: -1 }, name: 'parent_received_idx' },
      { key: { orgId: 1, status: 1, receivedAt: -1 }, name: 'parent_status_received_idx' },
      { key: { orgId: 1, eventType: 1, receivedAt: -1 }, name: 'parent_event_received_idx' },
      { key: { orgId: 1, source: 1, receivedAt: -1 }, name: 'parent_source_received_idx' },
      { key: { orgId: 1, skipCategory: 1, receivedAt: -1 }, name: 'parent_skip_received_idx' },
      // Watchdog queries (find stuck events)
      { key: { status: 1, processingStartedAt: 1 }, name: 'status_processing_idx' },
      // Event ID lookup
      { key: { eventId: 1 }, name: 'event_id_idx' },
      // Tenant-scoped event ID lookup
      { key: { orgId: 1, eventId: 1 }, name: 'parent_event_id_idx' },
      // TTL cleanup (90 days default, configurable)
      {
        key: { expiresAt: 1 },
        expireAfterSeconds: 0,
        name: 'ttl_idx'
      }
    ]);

    // Source checkpoints indexes - for gap detection and negative proof
    await db.collection('source_checkpoints').createIndexes([
      // Unique per source + entity
      {
        key: { source: 1, sourceIdentifier: 1, orgId: 1 },
        name: 'source_entity_unique_idx',
        unique: true
      },
      // Health check queries
      { key: { updatedAt: -1 }, name: 'updated_idx' },
      { key: { orgId: 1, source: 1 }, name: 'entity_source_idx' }
    ]);

    // Lookups indexes - for code mapping system
    await db.collection('lookups').createIndexes([
      // UNIQUE constraint - Prevent duplicate active mappings for the same key
      {
        key: {
          orgId: 1,
          orgUnitRid: 1,
          type: 1,
          'source.id': 1,
          isActive: 1
        },
        name: 'idx_unique_mapping',
        unique: true,
        partialFilterExpression: { isActive: true }
      },
      // Primary lookup index (optimized for hierarchy resolution)
      {
        key: {
          orgId: 1,
          orgUnitRid: 1,
          type: 1,
          'source.id': 1,
          isActive: 1
        },
        name: 'idx_lookup'
      },
      // Reverse lookup index (with orgUnitRid for hierarchy support)
      {
        key: {
          orgId: 1,
          orgUnitRid: 1,
          type: 1,
          'target.id': 1,
          isActive: 1
        },
        name: 'idx_reverse_lookup'
      },
      // List/filter index
      {
        key: { orgId: 1, type: 1, category: 1, isActive: 1 },
        name: 'idx_list'
      },
      // Text search index
      {
        key: {
          'source.id': 'text',
          'source.name': 'text',
          'target.id': 'text',
          'target.name': 'text'
        },
        name: 'idx_text_search'
      }
    ]);

    // Scheduled job logs indexes - for execution history and monitoring
    await db.collection('scheduled_job_logs').createIndexes([
      { key: { orgId: 1, startedAt: -1 }, name: 'org_started_idx' },
      { key: { integrationId: 1, startedAt: -1 }, name: 'job_started_idx' },
      { key: { status: 1, startedAt: -1 }, name: 'status_started_idx' },
      { key: { correlationId: 1 }, name: 'correlation_idx' },
      // TTL index - auto-delete logs after 90 days
      {
        key: { startedAt: 1 },
        expireAfterSeconds: 7776000,
        name: 'ttl_idx'
      }
    ]);

    // Unified execution logs indexes - direction-agnostic logging for all integrations
    await db.collection('execution_logs').createIndexes([
      // Primary queries - tenant scoped (using createdAt for consistency with UI)
      { key: { orgId: 1, createdAt: -1 }, name: 'org_created_idx' },
      { key: { orgId: 1, status: 1, createdAt: -1 }, name: 'org_status_created_idx' },
      { key: { orgId: 1, direction: 1, createdAt: -1 }, name: 'org_direction_created_idx' },
      { key: { orgId: 1, triggerType: 1, createdAt: -1 }, name: 'org_trigger_created_idx' },

      // Integration/Integration-specific queries (__KEEP___KEEP_integrationConfig__Id__ for backward compatibility)
      { key: { __KEEP___KEEP_integrationConfig__Id__: 1, createdAt: -1 }, name: 'integration_created_idx' },
      { key: { __KEEP___KEEP_integrationConfig__Id__: 1, status: 1, createdAt: -1 }, name: 'integration_status_created_idx' },
      { key: { integrationConfigId: 1, createdAt: -1 }, name: 'integration_created_idx' },
      { key: { integrationConfigId: 1, status: 1, createdAt: -1 }, name: 'integration_status_created_idx' },

      // Event type filtering (for OUTBOUND integrations)
      { key: { eventType: 1, createdAt: -1 }, name: 'event_created_idx' },
      { key: { orgId: 1, eventType: 1, createdAt: -1 }, name: 'org_event_created_idx' },

      // Retry query optimization - for finding retrying logs by lastAttemptAt
      { key: { status: 1, lastAttemptAt: -1 }, name: 'status_last_attempt_idx' },
      { key: { status: 1, shouldRetry: 1, lastAttemptAt: -1 }, name: 'status_retry_last_attempt_idx' },

      // Trace lookup indexes (non-unique - multi-action integrations + retries can reuse traceId)
      { key: { traceId: 1 }, name: 'trace_id_idx' },
      { key: { messageId: 1 }, name: 'message_id_idx', sparse: true },
      { key: { correlationId: 1 }, name: 'correlation_id_idx', sparse: true },

      // Performance monitoring
      { key: { status: 1, durationMs: -1 }, name: 'status_duration_idx' },
      { key: { status: 1, responseTimeMs: -1 }, name: 'status_response_time_idx' },

      // Error analysis
      { key: { status: 1, 'error.code': 1, createdAt: -1 }, name: 'status_error_created_idx' },
      { key: { status: 1, errorMessage: 1, createdAt: -1 }, name: 'status_error_msg_created_idx' },

      // TTL index - auto-delete logs after 90 days (configurable)
      {
        key: { createdAt: 1 },
        expireAfterSeconds: 7776000, // 90 days
        name: 'ttl_idx'
      }
    ]);

    // Text index for fast full-text search across execution logs
    // Weights: higher number = more relevance in search results
    await db.collection('execution_logs').createIndex(
      {
        __KEEP_integrationName__: 'text',
        eventType: 'text',
        searchableText: 'text',  // Patient MRN, name, phone (denormalized)
        errorMessage: 'text',
        targetUrl: 'text',
        'response.body': 'text'
      },
      {
        name: 'search_text_idx',
        weights: {
          __KEEP_integrationName__: 10,      // Highest priority
          eventType: 10,        // Highest priority
          searchableText: 8,    // High priority (patient data)
          errorMessage: 5,      // Medium priority
          targetUrl: 3,         // Lower priority
          'response.body': 1    // Lowest priority (can be verbose)
        },
        default_language: 'english'
      }
    );

    // Failed deliveries (Dead Letter Queue) indexes
    await db.collection('failed_deliveries').createIndexes([
      // Primary queries
      { key: { orgId: 1, failedAt: -1 }, name: 'org_failed_idx' },
      { key: { orgId: 1, status: 1, failedAt: -1 }, name: 'org_status_failed_idx' },
      { key: { integrationConfigId: 1, status: 1, failedAt: -1 }, name: 'integration_status_failed_idx' },

      // Trace correlation
      { key: { traceId: 1 }, name: 'trace_id_idx' },
      { key: { messageId: 1 }, name: 'message_id_idx', sparse: true },
      { key: { executionLogId: 1 }, name: 'execution_log_idx' },

      // Retry processing
      { key: { status: 1, nextRetryAt: 1 }, name: 'status_next_retry_idx' },
      { key: { status: 1, retryCount: 1 }, name: 'status_retry_count_idx' },

      // Error categorization
      { key: { 'error.code': 1, failedAt: -1 }, name: 'error_code_failed_idx' },
      { key: { 'error.category': 1, status: 1 }, name: 'error_category_status_idx' },

      // TTL index - auto-delete resolved/abandoned DLQ entries after 90 days
      {
        key: { resolvedAt: 1 },
        expireAfterSeconds: 7776000,
        name: 'resolved_ttl_idx',
        partialFilterExpression: { resolvedAt: { $exists: true } }
      }
    ]);

    // Rate limiting state indexes
    await db.collection('rate_limits').createIndexes([
      // Primary lookup by integration
      { key: { integrationConfigId: 1, windowStart: -1 }, name: 'integration_window_idx' },
      { key: { orgId: 1, integrationConfigId: 1 }, name: 'org_integration_idx' },

      // Cleanup old windows
      {
        key: { windowStart: 1 },
        expireAfterSeconds: 3600, // Clean up after 1 hour
        name: 'window_ttl_idx'
      }
    ]);

    // event_source_configs — per-org adapter configuration
    await db.collection('event_source_configs').createIndexes([
      { key: { orgId: 1 }, name: 'org_unique_idx', unique: true },
      { key: { type: 1, isActive: 1 }, name: 'type_active_idx' }
    ]);

    // pending_events — HTTP push queue (TTL: 7 days for unprocessed events)
    await db.collection('pending_events').createIndexes([
      { key: { orgId: 1, status: 1, createdAt: 1 }, name: 'org_status_created_idx' },
      { key: { status: 1, createdAt: 1 }, name: 'status_created_idx' },
      {
        key: { createdAt: 1 },
        expireAfterSeconds: 7 * 24 * 60 * 60, // 7 days
        name: 'ttl_idx',
        partialFilterExpression: { status: { $in: ['done', 'failed'] } }
      }
    ]);

    log('info', 'MongoDB indexes created/verified');
  } catch (error) {
    log('warn', 'MongoDB index creation warning', { error: error.message });
    // Don't fail on index creation errors, indexes might already exist
  }
}

function getDb() {
  if (!db) {
    throw new Error('MongoDB not connected. Call connect() first.');
  }
  return db;
}

/**
 * Get MongoDB database instance with automatic reconnection
 * Use this instead of getDb() for resilient database access
 */
async function getDbSafe() {
  const connected = await ensureConnection();
  if (!connected || !db) {
    throw new Error('MongoDB connection unavailable after reconnection attempt');
  }
  return db;
}

function isConnected() {
  return !!db;
}

async function close() {
  if (client) {
    await client.close();
    db = null;
    client = null;
    log('info', 'MongoDB connection closed');
  }
}

async function ping() {
  try {
    if (!db) return false;
    await db.admin().ping();
    return true;
  } catch (error) {
    log('error', 'MongoDB ping failed', { error: error.message });
    return false;
  }
}

// Promise memoization to prevent concurrent reconnection attempts
let reconnectPromise = null;

/**
 * Ensure MongoDB connection is alive, reconnect if needed
 * Call this before critical database operations
 * Thread-safe: concurrent calls will wait for same reconnection promise
 */
async function ensureConnection() {
  try {
    // If reconnection is in progress, wait for it
    if (reconnectPromise) {
      log('debug', 'Waiting for ongoing MongoDB reconnection...');
      return reconnectPromise;
    }

    if (!db) {
      log('warn', 'MongoDB not connected, attempting to connect...');
      reconnectPromise = connect()
        .then(() => {
          reconnectPromise = null;
          return true;
        })
        .catch((err) => {
          reconnectPromise = null;
          log('error', 'MongoDB reconnection failed', { error: err.message });
          return false;
        });
      return reconnectPromise;
    }

    // Quick ping to verify connection
    const isAlive = await ping();
    if (!isAlive) {
      log('warn', 'MongoDB connection lost, attempting to reconnect...');

      reconnectPromise = (async () => {
        // Close old connection
        if (client) {
          try {
            await client.close();
          } catch (err) {
            // Ignore close errors
          }
          client = null;
          db = null;
        }
        // Reconnect
        await connect();
        return true;
      })()
        .finally(() => {
          reconnectPromise = null;
        });

      return reconnectPromise;
    }

    return true;
  } catch (error) {
    log('error', 'Failed to ensure MongoDB connection', { error: error.message });
    reconnectPromise = null;
    return false;
  }
}

// Helper to convert string ID to ObjectId
function toObjectId(id) {
  if (!id) return null;
  if (id instanceof ObjectId) return id;
  try {
    return new ObjectId(id);
  } catch (error) {
    return null;
  }
}

module.exports = {
  connect,
  getDb,
  getDbSafe,
  close,
  ping,
  isConnected,
  ensureConnection,
  toObjectId,
  ObjectId
};
