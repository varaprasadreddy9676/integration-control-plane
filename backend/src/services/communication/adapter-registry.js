/**
 * Communication Adapter Registry
 * Central registry for all communication adapters (email, SMS, WhatsApp, Slack, etc.)
 */

const { log } = require('../../logger');

class AdapterRegistry {
  constructor() {
    this.adapters = new Map();
  }

  /**
   * Register a communication adapter
   * @param {string} channel - Channel type (EMAIL, SMS, WHATSAPP, SLACK)
   * @param {string} provider - Provider name (SMTP, GMAIL_OAUTH, TWILIO, etc.)
   * @param {object} adapter - Adapter instance with send() method
   */
  register(channel, provider, adapter) {
    const key = `${channel}:${provider}`;

    // Validate adapter has required methods
    if (typeof adapter.send !== 'function') {
      throw new Error(`Adapter ${key} must implement send() method`);
    }

    this.adapters.set(key, adapter);
    log('info', `[AdapterRegistry] Registered ${key}`);
  }

  /**
   * Get adapter for channel + provider
   * @param {string} channel - Channel type
   * @param {string} provider - Provider name
   * @returns {object} Adapter instance
   */
  getAdapter(channel, provider) {
    const key = `${channel}:${provider}`;
    const adapter = this.adapters.get(key);

    if (!adapter) {
      throw new Error(`No adapter registered for ${key}`);
    }

    return adapter;
  }

  /**
   * Send message via appropriate adapter
   * @param {string} channel - Channel type
   * @param {string} provider - Provider name
   * @param {object} payload - Message payload (channel-specific format)
   * @param {object} config - Provider configuration
   * @returns {Promise<object>} Delivery result
   */
  async send(channel, provider, payload, config) {
    const adapter = this.getAdapter(channel, provider);

    log('info', '[AdapterRegistry] Sending message', {
      channel,
      provider,
      to: payload.to
    });

    try {
      const result = await adapter.send(payload, config);

      log('info', '[AdapterRegistry] Message sent successfully', {
        channel,
        provider,
        messageId: result.messageId
      });

      return result;
    } catch (error) {
      log('error', '[AdapterRegistry] Send failed', {
        channel,
        provider,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * List all registered adapters
   * @returns {Array<{channel: string, provider: string}>}
   */
  listAdapters() {
    return Array.from(this.adapters.keys()).map(key => {
      const [channel, provider] = key.split(':');
      return { channel, provider };
    });
  }
}

// Singleton instance
const registry = new AdapterRegistry();

module.exports = registry;
