/**
 * MySQL Event Source Adapter (per-org, generic)
 *
 * One instance per org. Knows nothing about the source schema — everything
 * is driven by a columnMapping that maps standard envelope fields to actual
 * column names in whatever table the org uses.
 *
 * Standard event envelope fields (all adapters produce this):
 *   id        — monotonic cursor field (must be auto-increment / sortable)
 *   orgId     — organization identifier used to scope the query
 *   orgUnitId — optional sub-entity identifier
 *   eventType — event type string
 *   payload   — JSON payload object
 *   timestamp — event creation time
 *
 * columnMapping example:
 *   {
 *     id:        "id",
 *     orgId:     "tenant_id",
 *     orgUnitId: "branch_id",
 *     eventType: "event_name",
 *     payload:   "event_data",
 *     timestamp: "created_at"
 *   }
 *
 * Open-source users configure this per-org in event_source_configs:
 *   {
 *     type: "mysql",
 *     config: {
 *       table: "my_events",
 *       columnMapping: {
 *         id:        "event_id",
 *         orgId:     "tenant_id",
 *         eventType: "event_name",
 *         payload:   "event_data"
 *       }
 *     }
 *   }
 */

const { EventSourceAdapter } = require('./EventSourceAdapter');
const mongodb = require('../mongodb');
const { log, logError } = require('../logger');
const { withTimeout } = require('../utils/timeout');
const { updateHeartbeat } = require('../worker-heartbeat');

// Required fields every columnMapping must define.
// There are no hardcoded defaults — each org declares their own schema
// via event_source_configs, configured through the admin UI.
const REQUIRED_MAPPING_FIELDS = ['id', 'orgId', 'eventType', 'payload'];

class MysqlEventSource extends EventSourceAdapter {
  /**
   * @param {Object} config
   * @param {number}  config.orgId            - Required. The org this adapter serves.
   * @param {Object}  config.pool             - mysql2 pool instance.
   * @param {string}  [config.table]          - Table to poll. Default: 'notification_queue'
   * @param {Object}  [config.columnMapping]  - Maps standard fields to actual column names.
   *                                            Merged with DEFAULT_COLUMN_MAPPING.
   * @param {number}  [config.pollIntervalMs] - Poll interval ms. Default: 5000
   * @param {number}  [config.batchSize]      - Rows per poll. Default: 10
   * @param {number}  [config.dbTimeoutMs]    - Query timeout ms. Default: 30000
   */
  constructor(config = {}) {
    super();

    if (!config.orgId) throw new Error('MysqlEventSource: orgId is required');
    if (!config.pool)  throw new Error('MysqlEventSource: pool is required');

    this.orgId          = config.orgId;
    this.pool           = config.pool;
    this.pollIntervalMs = config.pollIntervalMs || 5000;
    this.batchSize      = config.batchSize      || 10;
    this.dbTimeoutMs    = config.dbTimeoutMs    || 30000;

    // columnMapping comes entirely from event_source_configs (set per org via admin UI).
    // No hardcoded fallback — each org must declare their own schema.
    this.table   = config.table;
    this.mapping = config.columnMapping || {};

    this._validateMapping();

    // Stable key for source_checkpoints lookup (table + orgId)
    this.sourceIdentifier = `${this.table}:${this.orgId}`;

    this.timer     = null;
    this.running   = false;
    this.stopped   = false;
    this.pollCount = 0;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  async start(handler) {
    if (this.timer) {
      log('warn', `[MySQL:${this.orgId}] Already started`);
      return;
    }

    this.stopped  = false;
    this.pollCount = 0;

    log('info', `[MySQL:${this.orgId}] Starting`, {
      table: this.table,
      mapping: this.mapping,
      pollIntervalMs: this.pollIntervalMs,
      batchSize: this.batchSize
    });

    this.timer = setInterval(async () => {
      if (this.running || this.stopped) return;

      this.running = true;
      this.pollCount++;
      updateHeartbeat('deliveryWorker');

      try {
        await this._pollCycle(handler);
      } catch (err) {
        logError(err, { scope: `MysqlEventSource[${this.orgId}].pollCycle` });
      } finally {
        this.running = false;
      }
    }, this.pollIntervalMs);

    log('info', `[MySQL:${this.orgId}] Started`);
  }

  async stop() {
    if (!this.timer) return;

    log('info', `[MySQL:${this.orgId}] Stopping...`);
    this.stopped = true;
    clearInterval(this.timer);
    this.timer = null;

    const deadline = Date.now() + 30_000;
    while (this.running && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 100));
    }

    if (this.running) {
      log('warn', `[MySQL:${this.orgId}] Force-stopped while processing`);
    } else {
      log('info', `[MySQL:${this.orgId}] Stopped gracefully`);
    }
  }

  getName() {
    return `MysqlEventSource[org=${this.orgId}, table=${this.table}]`;
  }

  // ---------------------------------------------------------------------------
  // Poll cycle
  // ---------------------------------------------------------------------------

  async _pollCycle(handler) {
    const checkpoint = await withTimeout(
      this._getCheckpoint(),
      this.dbTimeoutMs,
      `getCheckpoint[${this.orgId}]`
    );

    const rows = await withTimeout(
      this._fetchRows(checkpoint),
      this.dbTimeoutMs,
      `fetchRows[${this.orgId}]`
    );

    if (rows.length === 0) return;

    log('info', `[MySQL:${this.orgId}] Poll #${this.pollCount}: ${rows.length} events`, {
      checkpoint, batchSize: this.batchSize
    });

    for (const row of rows) {
      if (this.stopped) break;
      const event = this._normalizeRow(row);
      const ctx   = this._createContext(event);
      await handler(event, ctx);
    }
  }

  // ---------------------------------------------------------------------------
  // MySQL query — built entirely from columnMapping, no hardcoded column names
  // ---------------------------------------------------------------------------

  async _fetchRows(checkpoint) {
    const m = this.mapping;

    // Only select columns that exist in the mapping.
    // Optional fields (orgUnitId, timestamp) are selected only if mapped.
    const selects = [
      `${m.id}        AS _id`,
      `${m.orgId}     AS _orgId`,
      `${m.eventType} AS _eventType`,
      `${m.payload}   AS _payload`,
    ];
    if (m.orgUnitId) selects.push(`${m.orgUnitId} AS _orgUnitId`);
    if (m.timestamp) selects.push(`${m.timestamp} AS _timestamp`);

    // Named params (:checkpoint, :orgId) for compatibility with namedPlaceholders pools.
    // LIMIT is inlined as a trusted integer (comes from our own config, never user input).
    const sql = `
      SELECT ${selects.join(', ')}
      FROM   ${this.table}
      WHERE  ${m.id} > :checkpoint
        AND  ${m.orgId} = :orgId
      ORDER BY ${m.id} ASC
      LIMIT ${this.batchSize}
    `;

    const [rows] = await this.pool.execute(sql, { checkpoint, orgId: this.orgId });
    return rows;
  }

  // ---------------------------------------------------------------------------
  // Row → standard event envelope
  // ---------------------------------------------------------------------------

  _normalizeRow(row) {
    const id        = row._id;
    const orgId     = row._orgId;
    const eventType = row._eventType || '';
    const payload   = this._parsePayload(row._payload);

    return {
      id,
      orgId,
      orgUnitRid:  row._orgUnitId  ?? null,
      event_type:  eventType,
      payload,
      eventId:     `mysql-${orgId}-${eventType}-${id}`,
      source:      'mysql',
      created_at:  row._timestamp  ?? new Date()
    };
  }

  _parsePayload(raw) {
    if (raw === null || raw === undefined) return {};
    if (typeof raw === 'object') return raw;
    try { return JSON.parse(raw); }
    catch { return {}; }
  }

  // ---------------------------------------------------------------------------
  // Per-org checkpoint in source_checkpoints
  // ---------------------------------------------------------------------------

  async _getCheckpoint() {
    const db  = await mongodb.getDbSafe();
    const doc = await db.collection('source_checkpoints').findOne({
      source:           'mysql',
      sourceIdentifier: this.sourceIdentifier,
      orgId:            this.orgId
    });

    if (doc) return doc.lastProcessedId ?? 0;

    // Bootstrap on first run: start from current max so we don't replay history
    const maxId = await this._fetchMaxId();
    await this._setCheckpoint(maxId);
    log('info', `[MySQL:${this.orgId}] Bootstrapped checkpoint at id=${maxId}`);
    return maxId;
  }

  async _setCheckpoint(lastProcessedId) {
    const db = await mongodb.getDbSafe();
    await db.collection('source_checkpoints').updateOne(
      { source: 'mysql', sourceIdentifier: this.sourceIdentifier, orgId: this.orgId },
      {
        $set:         { lastProcessedId, updatedAt: new Date() },
        $setOnInsert: { createdAt: new Date() }
      },
      { upsert: true }
    );
  }

  async _fetchMaxId() {
    const m = this.mapping;
    const sql = `SELECT MAX(${m.id}) AS maxId FROM ${this.table} WHERE ${m.orgId} = :orgId`;
    const [rows] = await this.pool.execute(sql, { orgId: this.orgId });
    return rows[0]?.maxId ?? 0;
  }

  // ---------------------------------------------------------------------------
  // Context (ack / nack)
  // ---------------------------------------------------------------------------

  _createContext(event) {
    return {
      ack: async () => {
        await this._setCheckpoint(event.id);
        log('debug', `[MySQL:${this.orgId}] Acked event id=${event.id}`);
      },

      nack: async (_retryDelayMs = 60000) => {
        // Advance checkpoint anyway — retry handled by execution_logs DLQ worker
        await this._setCheckpoint(event.id);
        log('warn', `[MySQL:${this.orgId}] Nacked event id=${event.id} (retry via DLQ)`);
      }
    };
  }

  // ---------------------------------------------------------------------------
  // Validation
  // ---------------------------------------------------------------------------

  _validateMapping() {
    for (const field of REQUIRED_MAPPING_FIELDS) {
      if (!this.mapping[field]) {
        throw new Error(
          `MysqlEventSource: columnMapping.${field} is required. ` +
          `Got mapping: ${JSON.stringify(this.mapping)}`
        );
      }
    }
  }
}

module.exports = { MysqlEventSource };
