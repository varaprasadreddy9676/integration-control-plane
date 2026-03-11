/**
 * MySQL Event Source Adapter
 *
 * Polls MySQL notification_queue table for new events
 * Uses checkpoint-based tracking to prevent reprocessing
 */

const { EventSourceAdapter } = require('./EventSourceAdapter');
const data = require('../data');
const { log } = require('../logger');
const { withTimeout } = require('../utils/timeout');
const { updateHeartbeat } = require('../worker-heartbeat');

class MysqlEventSource extends EventSourceAdapter {
  constructor(config = {}) {
    super();
    this.intervalMs = config.intervalMs || 5000;
    this.batchSize = config.batchSize || 5;
    this.dbTimeout = config.dbOperationTimeoutMs || 30000;
    this.timer = null;
    this.running = false;
    this.stopped = false;
    this.pollCount = 0;
  }

  async start(handler) {
    if (this.timer) {
      log('warn', 'MySQL event source already started');
      return;
    }

    this.stopped = false;
    this.pollCount = 0;

    log('info', 'MySQL event source starting', {
      intervalMs: this.intervalMs,
      batchSize: this.batchSize,
      dbTimeout: this.dbTimeout
    });

    // Start polling loop
    this.timer = setInterval(async () => {
      if (this.running || this.stopped) {
        if (this.running) {
          log('debug', 'Worker still processing previous cycle, skipping this poll');
        }
        return;
      }

      this.running = true;
      this.pollCount++;
      const cycleStart = Date.now();

      try {
        // Check if MySQL is available before polling
        if (!data.isMysqlAvailable()) {
          log('warn', `[POLL #${this.pollCount}] MySQL not available, skipping poll cycle`);
          // Try to reconnect
          await data.attemptMysqlReconnect();
          return;
        }

        // Update heartbeat at start of cycle
        updateHeartbeat('deliveryWorker');

        log('info', `[POLL #${this.pollCount}] Worker cycle started`, {
          intervalMs: this.intervalMs,
          batchSize: this.batchSize,
          nextPollIn: `${this.intervalMs}ms`
        });

        // Get current checkpoint
        const lastCheckpoint = await withTimeout(
          data.getWorkerCheckpoint(),
          this.dbTimeout,
          'getWorkerCheckpoint'
        );
        log('info', `[POLL #${this.pollCount}] Checkpoint position: ${lastCheckpoint}`, {
          checkpoint: lastCheckpoint
        });

        // Fetch pending events
        const events = await withTimeout(
          data.getPendingEvents(this.batchSize),
          this.dbTimeout,
          'getPendingEvents'
        );
        log('info', `[POLL #${this.pollCount}] Fetched ${events.length} pending events`, {
          eventCount: events.length,
          batchSize: this.batchSize,
          hasMore: events.length === this.batchSize
        });

        if (events.length === 0) {
          log('info', `[POLL #${this.pollCount}] No pending events to process`);
        } else {
          // Process each event
          for (const event of events) {
            if (this.stopped) {
              log('info', `[POLL #${this.pollCount}] Stopping, skipping remaining events`);
              break;
            }

            log('info', `[POLL #${this.pollCount}] Processing event`, {
              eventId: event.eventId,
              mysqlId: event.id,
              eventType: event.event_type,
              entityRid: event.tenantId
            });

            // Create context for this event
            const ctx = this.createContext(event);

            // Call handler
            // eslint-disable-next-line no-await-in-loop
            await handler(event, ctx);
          }
        }

        const cycleTime = Date.now() - cycleStart;
        log('info', `[POLL #${this.pollCount}] Worker cycle completed`, {
          durationMs: cycleTime,
          eventsProcessed: events.length,
          nextPollAt: new Date(Date.now() + this.intervalMs).toISOString()
        });

      } catch (error) {
        log('error', `[POLL #${this.pollCount}] MySQL polling error`, {
          error: error.message,
          stack: error.stack
        });
      } finally {
        this.running = false;
      }
    }, this.intervalMs);

    log('info', 'MySQL event source started', {
      intervalMs: this.intervalMs,
      batchSize: this.batchSize
    });
  }

  /**
   * Create context object for event processing
   * Provides ack/nack methods specific to MySQL checkpoint management
   */
  createContext(event) {
    return {
      ack: async () => {
        // MySQL: update checkpoint to this event ID
        await withTimeout(
          data.setWorkerCheckpoint(event.id),
          this.dbTimeout,
          'setWorkerCheckpoint'
        );
        log('debug', 'Event acknowledged', {
          eventId: event.eventId,
          mysqlId: event.id
        });
      },

      nack: async (retryDelayMs = 60000) => {
        // MySQL: move checkpoint forward anyway
        // Retry will be handled via execution_logs retry mechanism
        await withTimeout(
          data.setWorkerCheckpoint(event.id),
          this.dbTimeout,
          'setWorkerCheckpoint'
        );
        log('warn', 'Event nack (will retry via execution_logs)', {
          eventId: event.eventId,
          mysqlId: event.id,
          retryDelayMs
        });
      }
    };
  }

  async stop() {
    if (!this.timer) {
      log('warn', 'MySQL event source not running');
      return;
    }

    log('info', 'MySQL event source stopping...');
    this.stopped = true;

    // Clear interval
    clearInterval(this.timer);
    this.timer = null;

    // Wait for current poll cycle to complete
    const maxWaitMs = 30000; // 30 seconds
    const startWait = Date.now();
    while (this.running && Date.now() - startWait < maxWaitMs) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    if (this.running) {
      log('warn', 'MySQL event source forced stop (processing still running)');
    } else {
      log('info', 'MySQL event source stopped gracefully');
    }
  }
}

module.exports = { MysqlEventSource };
