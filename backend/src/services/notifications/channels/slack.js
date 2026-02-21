/**
 * Slack Channel Plugin - Example for future implementation
 * This shows how easy it is to add new notification channels
 */

const fetch = require('node-fetch');
const { log } = require('../../../logger');

/**
 * Format notification as Slack message
 * @param {Object} notification - Notification payload
 * @returns {Object} - Slack message blocks
 */
function formatSlackMessage(notification) {
  const { title, message, data, severity } = notification;

  // Color coding based on severity
  const colors = {
    INFO: '#36a64f',      // Green
    WARNING: '#ff9900',   // Orange
    CRITICAL: '#ff0000'   // Red
  };

  const blocks = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `${severity === 'CRITICAL' ? '🚨 ' : severity === 'WARNING' ? '⚠️ ' : 'ℹ️ '}${title}`,
        emoji: true
      }
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: message
      }
    }
  ];

  // Add integration details if available
  if (data.integration) {
    const orgUnitRid = data.integration.orgUnitRid || data.integration.orgId || 'N/A';
    blocks.push({
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `*Integration:*\n${data.integration.name}`
        },
        {
          type: 'mrkdwn',
          text: `*Target URL:*\n${data.integration.targetUrl}`
        },
        {
          type: 'mrkdwn',
          text: `*Event Type:*\n${data.integration.eventType || 'N/A'}`
        },
        {
          type: 'mrkdwn',
          text: `*Org Unit RID:*\n${orgUnitRid}`
        }
      ]
    });
  }

  // Add failure details if available
  if (data.failure) {
    blocks.push({
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `*Consecutive Failures:*\n${data.failure.consecutiveFailures}`
        },
        {
          type: 'mrkdwn',
          text: `*Status:*\n${data.failure.status}`
        }
      ]
    });

    if (data.failure.lastError) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Last Error:*\n\`\`\`${data.failure.lastError}\`\`\``
        }
      });
    }
  }

  // Add dashboard link
  if (data.dashboardLink) {
    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: 'View in Dashboard',
            emoji: true
          },
          url: data.dashboardLink,
          style: severity === 'CRITICAL' ? 'danger' : 'primary'
        }
      ]
    });
  }

  return {
    attachments: [
      {
        color: colors[severity] || colors.INFO,
        blocks
      }
    ]
  };
}

/**
 * Send notification via Slack integration
 * @param {Object} notification - Notification payload
 * @param {Object} config - Channel configuration
 * @param {string} config.integrationUrl - Slack integration URL
 * @param {string} config.channel - Slack channel (optional, override default)
 * @returns {Promise<boolean>} - Success status
 */
async function send(notification, config) {
  const { integrationUrl, channel } = config;

  if (!integrationUrl) {
    log('warn', 'Slack channel: No integration URL configured');
    return false;
  }

  try {
    const slackMessage = formatSlackMessage(notification);

    if (channel) {
      slackMessage.channel = channel;
    }

    log('debug', 'Sending Slack notification', {
      channel,
      type: notification.type,
      severity: notification.severity
    });

    const response = await fetch(integrationUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(slackMessage),
      timeout: 10000
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Slack API returned ${response.status}: ${errorText}`);
    }

    log('info', 'Slack notification sent successfully', {
      channel,
      type: notification.type,
      severity: notification.severity
    });

    return true;
  } catch (error) {
    log('error', 'Failed to send Slack notification', {
      channel,
      type: notification.type,
      error: error.message,
      stack: error.stack
    });
    return false;
  }
}

/**
 * Test Slack channel configuration
 * @param {Object} config - Channel configuration
 * @returns {Promise<Object>} - Test result
 */
async function test(config) {
  try {
    const testNotification = {
      type: 'test',
      severity: 'INFO',
      title: 'Slack Channel Test',
      message: 'This is a test notification from Event Gateway. If you can see this, Slack integration is working! 🎉',
      data: {}
    };

    const success = await send(testNotification, config);

    return {
      success,
      message: success ? 'Test message sent to Slack successfully' : 'Failed to send test message'
    };
  } catch (error) {
    return {
      success: false,
      message: error.message
    };
  }
}

module.exports = {
  send,
  test,
  channelName: 'slack',
  displayName: 'Slack',
  description: 'Send alerts to Slack channels via integration'
};
