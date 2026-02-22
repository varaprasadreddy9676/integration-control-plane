/**
 * Notification Manager - Plugin Architecture
 * Supports multiple notification channels (email, Slack, SMS, etc.)
 */

const { log } = require('../../logger');
const config = require('../../config');
const channels = new Map();

/**
 * Register a notification channel plugin
 * @param {string} channelName - Unique channel identifier (e.g., 'email', 'slack')
 * @param {Object} channelPlugin - Channel implementation with send() method
 */
function registerChannel(channelName, channelPlugin) {
  if (!channelPlugin.send || typeof channelPlugin.send !== 'function') {
    throw new Error(`Channel plugin "${channelName}" must implement send() method`);
  }

  channels.set(channelName, channelPlugin);
  log('info', `Notification channel registered: ${channelName}`);
}

/**
 * Unregister a notification channel
 * @param {string} channelName - Channel identifier to remove
 */
function unregisterChannel(channelName) {
  channels.delete(channelName);
  log('info', `Notification channel unregistered: ${channelName}`);
}

/**
 * Get list of registered channels
 * @returns {Array<string>} - Array of channel names
 */
function getRegisteredChannels() {
  return Array.from(channels.keys());
}

/**
 * Send notification via specified channels
 * @param {Object} notification - Notification payload
 * @param {string} notification.type - Notification type (integration_failure, system_health, etc.)
 * @param {string} notification.severity - Severity level (INFO, WARNING, CRITICAL)
 * @param {string} notification.title - Notification title
 * @param {string} notification.message - Notification message
 * @param {Object} notification.data - Additional data
 * @param {Array<string>} enabledChannels - List of channels to use (e.g., ['email', 'slack'])
 * @param {Object} channelConfigs - Configuration per channel
 * @returns {Promise<Object>} - Results per channel { channelName: { success: boolean, error?: string } }
 */
async function sendNotification(notification, enabledChannels = [], channelConfigs = {}) {
  const results = {};

  // Validate notification payload
  if (!notification.type || !notification.severity || !notification.title || !notification.message) {
    throw new Error('Notification must include type, severity, title, and message');
  }

  log('debug', 'Sending notification via channels', {
    type: notification.type,
    severity: notification.severity,
    channels: enabledChannels,
  });

  // Send via each enabled channel
  for (const channelName of enabledChannels) {
    const channel = channels.get(channelName);

    if (!channel) {
      log('warn', `Channel not registered: ${channelName}`);
      results[channelName] = {
        success: false,
        error: 'Channel not registered',
      };
      continue;
    }

    const config = channelConfigs[channelName] || {};

    try {
      const success = await channel.send(notification, config);
      results[channelName] = { success };

      if (success) {
        log('info', `Notification sent via ${channelName}`, {
          type: notification.type,
          severity: notification.severity,
        });
      }
    } catch (error) {
      log('error', `Failed to send notification via ${channelName}`, {
        type: notification.type,
        severity: notification.severity,
        error: error.message,
      });
      results[channelName] = {
        success: false,
        error: error.message,
      };
    }
  }

  return results;
}

/**
 * Send integration failure alert
 * @param {Object} integration - Integration configuration
 * @param {Object} failureDetails - Failure details
 * @param {Array<string>} enabledChannels - Channels to use
 * @param {Object} channelConfigs - Configuration per channel
 */
async function sendIntegrationFailureAlert(integration, failureDetails, enabledChannels, channelConfigs) {
  const notification = {
    type: 'integration_failure',
    severity: failureDetails.autoDisabled ? 'CRITICAL' : 'WARNING',
    title: `Integration Failure: ${integration.name}`,
    message: `Integration "${integration.name}" has ${failureDetails.consecutiveFailures} consecutive failures`,
    data: {
      integration: {
        id: integration.id,
        name: integration.name,
        targetUrl: integration.targetUrl,
        eventType: integration.type,
        orgId: integration.orgId,
      },
      failure: failureDetails,
      dashboardLink: `${config.frontendUrl || process.env.FRONTEND_URL || 'http://localhost:5174'}/integrations/${integration.id}`,
    },
  };

  return sendNotification(notification, enabledChannels, channelConfigs);
}

/**
 * Send circuit breaker alert
 * @param {Object} integration - Integration configuration
 * @param {string} circuitState - Circuit state (OPEN/CLOSED)
 * @param {Array<string>} enabledChannels - Channels to use
 * @param {Object} channelConfigs - Configuration per channel
 */
async function sendCircuitBreakerAlert(integration, circuitState, enabledChannels, channelConfigs) {
  const notification = {
    type: 'circuit_breaker',
    severity: circuitState === 'OPEN' ? 'CRITICAL' : 'INFO',
    title: `Circuit Breaker ${circuitState}: ${integration.name}`,
    message: `Circuit breaker is now ${circuitState} for integration "${integration.name}"`,
    data: {
      integration: {
        id: integration.id,
        name: integration.name,
        targetUrl: integration.targetUrl,
        orgId: integration.orgId,
      },
      circuitState,
      dashboardLink: `${config.frontendUrl || process.env.FRONTEND_URL || 'http://localhost:5174'}/integrations/${integration.id}`,
    },
  };

  return sendNotification(notification, enabledChannels, channelConfigs);
}

/**
 * Send system health alert
 * @param {Object} healthStatus - System health status
 * @param {Array<string>} enabledChannels - Channels to use
 * @param {Object} channelConfigs - Configuration per channel
 */
async function sendSystemHealthAlert(healthStatus, enabledChannels, channelConfigs) {
  const notification = {
    type: 'system_health',
    severity: healthStatus.severity,
    title: `System Health Alert: ${healthStatus.severity}`,
    message: `System health is at ${healthStatus.severity} level`,
    data: {
      health: healthStatus,
      dashboardLink: `${config.frontendUrl || process.env.FRONTEND_URL || 'http://localhost:5174'}/dashboard`,
    },
  };

  return sendNotification(notification, enabledChannels, channelConfigs);
}

/**
 * Send integration auto-disabled alert
 * @param {Object} integration - Integration configuration
 * @param {number} consecutiveFailures - Number of consecutive failures
 * @param {Array<string>} enabledChannels - Channels to use
 * @param {Object} channelConfigs - Configuration per channel
 */
async function sendIntegrationAutoDisabledAlert(integration, consecutiveFailures, enabledChannels, channelConfigs) {
  const notification = {
    type: 'integration_auto_disabled',
    severity: 'CRITICAL',
    title: `Integration Auto-Disabled: ${integration.name}`,
    message: `Integration "${integration.name}" has been automatically disabled after ${consecutiveFailures} consecutive failures`,
    data: {
      integration: {
        id: integration.id,
        name: integration.name,
        targetUrl: integration.targetUrl,
        eventType: integration.type,
        orgId: integration.orgId,
      },
      consecutiveFailures,
      dashboardLink: `${config.frontendUrl || process.env.FRONTEND_URL || 'http://localhost:5174'}/integrations/${integration.id}`,
    },
  };

  return sendNotification(notification, enabledChannels, channelConfigs);
}

module.exports = {
  registerChannel,
  unregisterChannel,
  getRegisteredChannels,
  sendNotification,
  sendIntegrationFailureAlert,
  sendCircuitBreakerAlert,
  sendSystemHealthAlert,
  sendIntegrationAutoDisabledAlert,
};
