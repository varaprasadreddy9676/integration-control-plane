/**
 * Event Source Adapter - Base class for event ingestion adapters
 *
 * Provides a unified interface for consuming events from different sources:
 * - MySQL (polling-based)
 * - Kafka (consumer group)
 * - SQS (long polling)
 * - HTTP API (integrations)
 *
 * Each adapter handles source-specific details (checkpoints, acks, retries)
 * while providing a consistent handler interface to the worker.
 */

class EventSourceAdapter {
  /**
   * Start consuming events from the source
   *
   * @param {Function} handler - Event handler: async (event, ctx) => void
   *   - event: {
   *       id: number|string,           // Source-specific ID (MySQL ID, Kafka offset, etc.)
   *       eventId: string,              // Stable idempotency key
   *       org_unit_rid: number,
   *       org_id: number,
   *       event_type: string,
   *       payload: object,
   *       created_at: Date|string
   *     }
   *   - ctx: {
   *       ack: async () => void,        // Acknowledge successful processing
   *       nack: async (retryDelayMs) => void  // Reject and retry later
   *     }
   *
   * @returns {Promise<void>}
   */
  async start(handler) {
    throw new Error('EventSourceAdapter.start() must be implemented by subclass');
  }

  /**
   * Stop consuming events gracefully
   * Wait for in-flight events to complete before shutdown
   *
   * @returns {Promise<void>}
   */
  async stop() {
    throw new Error('EventSourceAdapter.stop() must be implemented by subclass');
  }

  /**
   * Get adapter name for logging
   *
   * @returns {string}
   */
  getName() {
    return this.constructor.name;
  }
}

module.exports = { EventSourceAdapter };
