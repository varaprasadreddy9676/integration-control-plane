/**
 * Kafka Event Source Adapter (per-org)
 *
 * One instance per org. Consumes events from a Kafka topic using a
 * per-org consumer group so different orgs progress independently.
 *
 * Requires kafkajs: npm install kafkajs
 *
 * Expected message format (JSON in message.value):
 *   {
 *     eventType: string,          // or event_type / transaction_type / type
 *     payload:   object,          // or data
 *     orgId:     number,          // or org_id / entity_parent_rid
 *     orgUnitId: number,          // optional; or entity_rid / org_unit_rid
 *     eventId:   string           // optional; stable idempotency key
 *   }
 *
 * The Kafka message key should be the orgId (string) for ordered per-org delivery.
 */

const { Kafka } = require('kafkajs');
const { EventSourceAdapter } = require('./EventSourceAdapter');
const { log, logError } = require('../logger');

class KafkaEventSource extends EventSourceAdapter {
  /**
   * @param {Object} config
   * @param {number}   config.orgId             - Required. The org this adapter serves.
   * @param {string[]} config.brokers           - Kafka brokers. Default: ['localhost:9092']
   * @param {string}   config.topic             - Topic to consume. Default: 'integration-events'
   * @param {string}   [config.groupId]         - Consumer group. Default: 'ig-org-{orgId}'
   * @param {string}   [config.clientId]        - Kafka client ID. Default: 'integration-gateway'
   * @param {boolean}  [config.fromBeginning]   - Consume from beginning. Default: false
   * @param {number}   [config.sessionTimeout]  - ms. Default: 30000
   * @param {number}   [config.heartbeatInterval] - ms. Default: 3000
   */
  constructor(config = {}) {
    super();

    if (!config.orgId) throw new Error('KafkaEventSource: orgId is required');

    this.orgId             = config.orgId;
    this.brokers           = config.brokers    || ['localhost:9092'];
    this.topic             = config.topic      || 'integration-events';
    this.groupId           = config.groupId    || `ig-org-${config.orgId}`;
    this.clientId          = config.clientId   || 'integration-gateway';
    this.fromBeginning     = config.fromBeginning ?? false;
    this.sessionTimeout    = config.sessionTimeout    || 30_000;
    this.heartbeatInterval = config.heartbeatInterval || 3_000;

    this.stopped      = false;
    this.reconnecting = false;
    this.consumer     = null;
    this.handler      = null;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  async start(handler) {
    this.handler = handler;
    log('info', `[Kafka:${this.orgId}] Starting`, { brokers: this.brokers, topic: this.topic, groupId: this.groupId });
    await this._connect();
  }

  async stop() {
    log('info', `[Kafka:${this.orgId}] Stopping`);
    this.stopped = true;

    if (this.consumer) {
      try {
        await this.consumer.disconnect();
        log('info', `[Kafka:${this.orgId}] Disconnected gracefully`);
      } catch (err) {
        logError(err, { scope: `KafkaEventSource[${this.orgId}].stop` });
      }
      this.consumer = null;
    }
  }

  getName() {
    return `KafkaEventSource[org=${this.orgId}]`;
  }

  // ---------------------------------------------------------------------------
  // Connection & consumption
  // ---------------------------------------------------------------------------

  async _connect() {
    if (this.stopped) return;

    try {
      const kafka = new Kafka({
        clientId:          this.clientId,
        brokers:           this.brokers,
        logLevel:          2, // INFO
        retry:             { initialRetryTime: 100, retries: 8, maxRetryTime: 30_000, multiplier: 2 },
        connectionTimeout: 10_000,
        requestTimeout:    30_000
      });

      this.consumer = kafka.consumer({
        groupId:           this.groupId,
        sessionTimeout:    this.sessionTimeout,
        heartbeatInterval: this.heartbeatInterval,
        retry:             { retries: 5, initialRetryTime: 300 }
      });

      this._setupErrorHandlers();

      await this.consumer.connect();
      await this.consumer.subscribe({ topic: this.topic, fromBeginning: this.fromBeginning });

      log('info', `[Kafka:${this.orgId}] Connected and subscribed`, { topic: this.topic });

      await this.consumer.run({
        autoCommit: false, // Manual commit for at-least-once delivery
        eachMessage: async ({ topic, partition, message }) => {
          await this._handleMessage(topic, partition, message);
        }
      });

      this.reconnecting = false;

    } catch (err) {
      logError(err, { scope: `KafkaEventSource[${this.orgId}].connect` });

      if (!this.stopped) {
        log('warn', `[Kafka:${this.orgId}] Connection failed, retrying in 10s`);
        setTimeout(() => this._connect(), 10_000);
      }
    }
  }

  _setupErrorHandlers() {
    this.consumer.on('consumer.crash', ({ error }) => {
      logError(error, { scope: `KafkaEventSource[${this.orgId}].crash` });
      if (!this.stopped && !this.reconnecting) {
        this.reconnecting = true;
        log('warn', `[Kafka:${this.orgId}] Crashed, reconnecting in 5s`);
        setTimeout(() => this._connect(), 5_000);
      }
    });

    this.consumer.on('consumer.disconnect', () => {
      log('warn', `[Kafka:${this.orgId}] Disconnected`);
      if (!this.stopped && !this.reconnecting) {
        this.reconnecting = true;
        setTimeout(() => this._connect(), 5_000);
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Message processing
  // ---------------------------------------------------------------------------

  async _handleMessage(topic, partition, message) {
    if (this.stopped) return;

    let event = null;
    try {
      event = this._parseMessage(message);

      log('info', `[Kafka:${this.orgId}] Received message`, {
        topic, partition, offset: message.offset,
        eventId: event.eventId, eventType: event.event_type
      });

      const ctx = this._createContext(topic, partition, message.offset);
      await this.handler(event, ctx);

    } catch (err) {
      logError(err, {
        scope:     `KafkaEventSource[${this.orgId}].handleMessage`,
        topic, partition,
        offset:    message.offset,
        eventId:   event?.eventId,
        eventType: event?.event_type
      });
      // Not committing offset → message redelivered on next restart/rebalance
    }
  }

  _parseMessage(message) {
    const raw = JSON.parse(message.value.toString());

    // Resolve orgId: prefer explicit field, fall back to message key
    const orgId = raw.orgId ?? raw.org_id ?? raw.entity_parent_rid ?? raw.entityParentRid
      ?? (message.key ? parseInt(message.key.toString(), 10) : null)
      ?? this.orgId; // final fallback — this adapter is already scoped to orgId

    const eventType = raw.eventType ?? raw.event_type ?? raw.transaction_type ?? raw.type ?? '';
    const payload   = raw.payload   ?? raw.data ?? raw;
    const id        = raw.id        ?? `kafka-${message.offset}`;
    const eventId   = raw.eventId   ?? `kafka-${orgId}-${eventType}-${message.offset}`;

    return {
      id,
      orgId,
      orgUnitRid:  raw.orgUnitId ?? raw.org_unit_rid ?? raw.orgUnitRid ?? raw.entity_rid ?? null,
      event_type:  eventType,
      payload,
      eventId,
      source:      'kafka',
      created_at:  raw.createdAt ?? raw.created_at ?? new Date().toISOString()
    };
  }

  // ---------------------------------------------------------------------------
  // Context (ack / nack)
  // ---------------------------------------------------------------------------

  _createContext(topic, partition, offset) {
    return {
      ack: async () => {
        try {
          await this.consumer.commitOffsets([
            { topic, partition, offset: (parseInt(offset, 10) + 1).toString() }
          ]);
          log('debug', `[Kafka:${this.orgId}] Committed offset`, { partition, offset });
        } catch (err) {
          logError(err, { scope: `KafkaEventSource[${this.orgId}].ack`, partition, offset });
          // Non-fatal: offset will be recommitted on next successful ack
        }
      },

      nack: async (_retryDelayMs = 0) => {
        // Not committing offset → redelivered on next restart/rebalance
        log('warn', `[Kafka:${this.orgId}] Nacked offset`, { partition, offset });
      }
    };
  }
}

module.exports = { KafkaEventSource };
