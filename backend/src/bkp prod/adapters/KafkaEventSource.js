/**
 * ⚠️ NOT READY FOR USE ⚠️
 *
 * This adapter requires the 'kafkajs' package which is NOT in package.json.
 * Before using this adapter:
 * 1. Run: npm install kafkajs
 * 2. Uncomment the export in adapters/index.js
 * 3. Update worker.js to handle 'kafka' event source type
 */

const { Kafka } = require('kafkajs');
const { EventSourceAdapter } = require('./EventSourceAdapter');
const { log, logError } = require('../logger');

/**
 * KafkaEventSource - Kafka consumer adapter for event processing
 * Uses kafkajs (modern Kafka client)
 */
class KafkaEventSource extends EventSourceAdapter {
  constructor(config = {}) {
    super();

    // Kafka configuration
    this.brokers = config.brokers || ['localhost:9092'];
    this.topic = config.topic || 'integration-events';
    this.groupId = config.groupId || 'integration-processor';
    this.clientId = config.clientId || 'integration-gateway';
    this.fromBeginning = config.fromBeginning || false;

    // Advanced configuration
    this.sessionTimeout = config.sessionTimeout || 30000; // 30 seconds
    this.heartbeatInterval = config.heartbeatInterval || 3000; // 3 seconds
    this.maxBytesPerPartition = config.maxBytesPerPartition || 25 * 1024 * 1024; // 25MB (match notification consumer)
    this.autoCommit = config.autoCommit !== undefined ? config.autoCommit : false; // Manual commit for better control

    // Processing state
    this.stopped = false;
    this.kafka = null;
    this.consumer = null;
    this.reconnecting = false;
    this.handler = null;
  }

  async start(handler) {
    this.handler = handler;

    log('info', 'Kafka event source starting', {
      brokers: this.brokers,
      topic: this.topic,
      groupId: this.groupId,
      clientId: this.clientId
    });

    await this.connect();
  }

  async connect() {
    try {
      // Initialize Kafka client
      this.kafka = new Kafka({
        clientId: this.clientId,
        brokers: this.brokers,
        logLevel: 2, // INFO level (maps to winston info)
        retry: {
          initialRetryTime: 100,
          retries: 8,
          maxRetryTime: 30000,
          multiplier: 2
        },
        connectionTimeout: 10000,
        requestTimeout: 30000
      });

      // Create consumer with configuration matching notification consumer patterns
      this.consumer = this.kafka.consumer({
        groupId: this.groupId,
        sessionTimeout: this.sessionTimeout,
        heartbeatInterval: this.heartbeatInterval,
        maxBytesPerPartition: this.maxBytesPerPartition,
        retry: {
          retries: 5,
          initialRetryTime: 300
        }
      });

      // Setup error handlers
      this.setupErrorHandlers();

      // Connect to Kafka
      log('info', 'Connecting to Kafka brokers', { brokers: this.brokers });
      await this.consumer.connect();
      log('info', 'Connected to Kafka brokers');

      // Subscribe to topic
      await this.consumer.subscribe({
        topic: this.topic,
        fromBeginning: this.fromBeginning
      });

      log('info', 'Kafka consumer subscribed to topic', { topic: this.topic });

      // Run consumer with message handler
      await this.consumer.run({
        autoCommit: this.autoCommit,
        eachMessage: async ({ topic, partition, message }) => {
          await this.handleMessage(topic, partition, message);
        }
      });

      log('info', 'Kafka event source started successfully', {
        groupId: this.groupId,
        topic: this.topic,
        autoCommit: this.autoCommit
      });

      this.reconnecting = false;

    } catch (error) {
      logError(error, {
        scope: 'KafkaEventSource.connect',
        brokers: this.brokers,
        topic: this.topic
      });

      // Retry connection after delay
      if (!this.stopped) {
        log('warn', 'Kafka connection failed, retrying in 10 seconds');
        setTimeout(() => this.connect(), 10000);
      }
    }
  }

  async handleMessage(topic, partition, message) {
    if (this.stopped) return;

    const startTime = Date.now();
    let event = null;

    try {
      // Parse Kafka message (similar to notification consumer pattern)
      event = this.parseKafkaMessage(message);

      // Log received message (redact large fields like notification consumer)
      const loggableEvent = this.redactLargeFields(event);
      log('info', `Received Kafka message for topic ${topic}`, {
        topic,
        partition,
        offset: message.offset,
        eventId: event.eventId,
        eventType: event.event_type,
        entityRid: event.entity_rid,
        event: loggableEvent
      });

      // Create context with Kafka-specific ack/nack
      const ctx = this.createContext(topic, partition, message.offset);

      // Call handler (business logic from worker)
      await this.handler(event, ctx);

      // Log completion (like notification consumer)
      const duration = Date.now() - startTime;
      log('info', 'Processing of Kafka message complete', {
        eventId: event.eventId,
        duration: `${duration}ms`,
        offset: message.offset
      });

    } catch (error) {
      logError(error, {
        scope: 'KafkaEventSource.handleMessage',
        topic,
        partition,
        offset: message.offset,
        eventId: event?.eventId,
        eventType: event?.event_type
      });

      // Don't commit offset - message will be redelivered
      // TODO: Consider implementing DLQ after N failed attempts
    }
  }

  setupErrorHandlers() {
    // Handle consumer errors (like notification consumer error handling)
    this.consumer.on('consumer.crash', async ({ error, payload }) => {
      logError(error, {
        scope: 'KafkaEventSource.consumer.crash',
        payload
      });

      // Attempt reconnection
      if (!this.stopped && !this.reconnecting) {
        this.reconnecting = true;
        log('warn', 'Kafka consumer crashed, attempting reconnection in 5 seconds');
        setTimeout(() => this.connect(), 5000);
      }
    });

    this.consumer.on('consumer.disconnect', () => {
      log('warn', 'Kafka consumer disconnected');

      // Attempt reconnection if not intentionally stopped
      if (!this.stopped && !this.reconnecting) {
        this.reconnecting = true;
        log('info', 'Attempting to reconnect to Kafka in 5 seconds');
        setTimeout(() => this.connect(), 5000);
      }
    });

    this.consumer.on('consumer.connect', () => {
      log('info', 'Kafka consumer connected');
    });

    this.consumer.on('consumer.rebalancing', () => {
      log('info', 'Kafka consumer rebalancing partitions');
    });
  }

  async stop() {
    log('info', 'Kafka event source stopping');
    this.stopped = true;

    if (this.consumer) {
      try {
        // Disconnect gracefully
        await this.consumer.disconnect();
        log('info', 'Kafka consumer disconnected gracefully');
      } catch (error) {
        logError(error, { scope: 'KafkaEventSource.stop' });
      }
    }

    log('info', 'Kafka event source stopped');
  }

  createContext(topic, partition, offset) {
    return {
      ack: async () => {
        try {
          // Commit offset to mark message as processed
          await this.consumer.commitOffsets([
            {
              topic,
              partition,
              offset: (parseInt(offset) + 1).toString() // Kafka expects next offset
            }
          ]);

          log('debug', 'Kafka offset committed', { topic, partition, offset });
        } catch (error) {
          logError(error, {
            scope: 'KafkaEventSource.ack',
            topic,
            partition,
            offset
          });
          // Don't throw - offset commit failure shouldn't crash processing
        }
      },

      nack: async (retryDelayMs = 0) => {
        // For Kafka, nack means NOT committing offset
        // Message will be redelivered on next consumer restart/rebalance
        log('warn', 'Kafka message nacked (will retry on next poll)', {
          topic,
          partition,
          offset,
          retryDelayMs
        });

        // TODO: For production, consider:
        // 1. Send to retry topic with delay
        // 2. Implement exponential backoff
        // 3. Send to DLQ after max retries
      }
    };
  }

  parseKafkaMessage(message) {
    // Parse message value (JSON) - similar to notification consumer
    const rawValue = message.value.toString();
    const payload = JSON.parse(rawValue);

    // Message key should be entityParentRid for partition ordering
    const key = message.key ? message.key.toString() : null;

    // Extract event fields from Kafka message
    // Support both notification_queue structure and direct event structure
    const event = {
      // Use MySQL ID if coming from CDC/bridge, else use Kafka offset
      id: payload.id || `kafka-${message.offset}`,

      // Stable idempotency key (already generated by producer or generate here)
      eventId: payload.eventId || this.generateEventId(payload),

      // Entity identifiers
      entity_rid: payload.entity_rid || payload.entityRid,
      entity_parent_rid: payload.entity_parent_rid || payload.entityParentRid || parseInt(key),

      // Event type
      event_type: payload.event_type || payload.eventType || payload.transaction_type || payload.type,

      // Timestamp
      created_at: payload.created_at || payload.createdAt || new Date().toISOString(),

      // Full payload (support both wrapper and direct formats)
      payload: payload.data || payload.payload || payload
    };

    return event;
  }

  generateEventId(payload) {
    // Fallback eventId generation if not provided by producer
    const entityParentRid = payload.entity_parent_rid || payload.entityParentRid;
    const eventType = payload.event_type || payload.eventType || payload.type;
    const id = payload.id || Date.now();

    return `${entityParentRid}-${eventType}-${id}`;
  }

  redactLargeFields(event) {
    // Redact large base64 fields for cleaner logs (like notification consumer)
    const loggable = JSON.parse(JSON.stringify(event));

    function redact(obj) {
      if (!obj || typeof obj !== 'object') return;

      for (const key in obj) {
        if (
          key === 'base64Content' ||
          key === 'Base64Print' ||
          key === 'billPrintPdf' ||
          key === 'base64Print' ||
          key === 'billPrintBase64' ||
          key === 'attachmentURL' ||
          key === 'attachment'
        ) {
          obj[key] = '...omitted...';
        } else if (typeof obj[key] === 'object') {
          redact(obj[key]);
        }
      }
    }

    redact(loggable);
    return loggable;
  }

  getName() {
    return 'KafkaEventSource';
  }
}

module.exports = { KafkaEventSource };
