/**
 * Email Channel Plugin - Uses Internal notification service
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');
const config = require('../../../config');
const { log } = require('../../../logger');

// Communication service URL
const COMMUNICATION_SERVICE_URL =
  config.communicationServiceUrl || 'https://notification.example.com/notification-service/api/sendNotification';

function postJson(url, payload, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const body = JSON.stringify(payload);
    const isHttps = parsed.protocol === 'https:';

    const req = (isHttps ? https : http).request(
      {
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: `${parsed.pathname}${parsed.search}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: timeoutMs,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          resolve({ status: res.statusCode || 0, body: data });
        });
      }
    );

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy(new Error('Request timed out'));
    });
    req.write(body);
    req.end();
  });
}

/**
 * Format notification as email body
 * @param {Object} notification - Notification payload
 * @returns {string} - Formatted email body
 */
function formatEmailBody(notification) {
  const { title, message, data, severity } = notification;

  let body = `${severity === 'CRITICAL' ? '⚠️ ' : ''}${title}\n\n`;
  body += `${message}\n\n`;

  // Add integration details if available
  if (data.integration) {
    const orgUnitRid = data.integration.orgUnitRid || data.integration.orgId || 'N/A';
    body += `Integration Details:\n`;
    body += `- Name: ${data.integration.name}\n`;
    body += `- Target URL: ${data.integration.targetUrl}\n`;
    if (data.integration.eventType) {
      body += `- Event Type: ${data.integration.eventType}\n`;
    }
    body += `- Org Unit RID: ${orgUnitRid}\n\n`;
  }

  // Add failure details if available
  if (data.failure) {
    body += `Failure Information:\n`;
    body += `- Consecutive Failures: ${data.failure.consecutiveFailures}\n`;
    if (data.failure.lastError) {
      body += `- Last Error: ${data.failure.lastError}\n`;
    }
    if (data.failure.failedAt) {
      body += `- Failed At: ${new Date(data.failure.failedAt).toLocaleString()}\n`;
    }
    body += `- Status: ${data.failure.status}\n\n`;

    if (data.failure.autoDisabled) {
      body += `⚠️ WEBHOOK HAS BEEN AUTO-DISABLED due to repeated failures.\n\n`;
    }
  }

  // Add circuit breaker state if available
  if (data.circuitState) {
    body += `Circuit State: ${data.circuitState}\n\n`;

    if (data.circuitState === 'OPEN') {
      body += `⚠️ Circuit breaker is OPEN - deliveries are blocked to prevent cascading failures.\n`;
      body += `The system will automatically attempt recovery after a cooldown period.\n\n`;
    } else {
      body += `✓ Circuit breaker is CLOSED - normal operations resumed.\n\n`;
    }
  }

  // Add health metrics if available
  if (data.health) {
    body += `System Metrics:\n`;
    if (data.health.successRate24h !== undefined) {
      body += `- Success Rate (24h): ${data.health.successRate24h}%\n`;
    }
    if (data.health.failedCount24h !== undefined) {
      body += `- Failed Deliveries (24h): ${data.health.failedCount24h}\n`;
    }
    if (data.health.avgResponseTimeMs24h !== undefined) {
      body += `- Average Response Time: ${data.health.avgResponseTimeMs24h}ms\n`;
    }
    if (data.health.queueSize !== undefined) {
      body += `- Queue Size: ${data.health.queueSize}\n`;
    }
    body += `\n`;

    if (data.health.alerts && data.health.alerts.length > 0) {
      body += `Active Alerts:\n`;
      data.health.alerts.forEach((alert) => {
        body += `- ${alert.severity}: ${alert.message}\n`;
      });
      body += `\n`;
    }
  }

  // Add action steps based on notification type
  if (notification.type === 'integration_failure' || notification.type === 'integration_auto_disabled') {
    body += `Action Required:\n`;
    body += `1. Check the target endpoint\n`;
    body += `2. Review error logs in the dashboard\n`;
    body += `3. Verify authentication credentials\n`;
    body += `4. Test integration connectivity\n`;
    if (notification.type === 'integration_auto_disabled') {
      body += `5. Re-enable integration after fixing the issue\n`;
    }
    body += `\n`;
  }

  // Add dashboard link
  if (data.dashboardLink) {
    body += `Dashboard Link: ${data.dashboardLink}\n\n`;
  }

  body += `Best regards,\nEvent Gateway Alert System`;

  return body;
}

/**
 * Send notification via email using internal communication service
 * @param {Object} notification - Notification payload
 * @param {Object} config - Channel configuration
 * @param {Array<string>} config.recipients - Email recipients
 * @param {string} config.hospitalCode - Hospital code for the entity
 * @param {string} config.corporateEntityCode - Corporate entity code
 * @returns {Promise<boolean>} - Success status
 */
async function send(notification, config) {
  const { recipients, hospitalCode, corporateEntityCode } = config;

  if (!recipients || recipients.length === 0) {
    log('warn', 'Email channel: No recipients configured');
    return false;
  }

  try {
    const subject = `[${notification.severity}] ${notification.title}`;
    const body = formatEmailBody(notification);

    const payload = {
      payload: {
        messageType: 'email',
        subject,
        body,
        to: recipients,
        hospitalCode: hospitalCode || 'integration-gateway',
        corporateEntityCode: corporateEntityCode || 'integration-gateway',
        source: 'integration-gateway-alerts',
      },
    };

    log('debug', 'Sending email via communication service', {
      to: recipients,
      subject,
      type: notification.type,
      severity: notification.severity,
    });

    const response = await postJson(COMMUNICATION_SERVICE_URL, payload, 10000);

    log('info', 'Communication service response', {
      status: response.status,
      body: response.body,
      to: recipients,
      type: notification.type,
    });

    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Communication service returned ${response.status}: ${response.body}`);
    }

    let parsed = null;
    try {
      parsed = JSON.parse(response.body);
    } catch (_e) {
      /* non-JSON is fine */
    }
    if (parsed && parsed.success === false) {
      throw new Error(`Communication service accepted request but did not send: ${JSON.stringify(parsed)}`);
    }

    log('info', 'Email notification sent successfully', {
      to: recipients,
      type: notification.type,
      severity: notification.severity,
      responseStatus: response.status,
    });

    return true;
  } catch (error) {
    log('error', 'Failed to send email notification', {
      recipients,
      type: notification.type,
      error: error.message,
      stack: error.stack,
    });
    return false;
  }
}

/**
 * Test email channel configuration
 * @param {Object} config - Channel configuration
 * @returns {Promise<Object>} - Test result
 */
async function test(config) {
  try {
    const testNotification = {
      type: 'test',
      severity: 'INFO',
      title: 'Email Channel Test',
      message: 'This is a test notification from Event Gateway.',
      data: {},
    };

    const success = await send(testNotification, config);

    return {
      success,
      message: success ? 'Test email sent successfully' : 'Failed to send test email',
    };
  } catch (error) {
    return {
      success: false,
      message: error.message,
    };
  }
}

module.exports = {
  send,
  test,
  channelName: 'email',
  displayName: 'Email (Internal Communication Service)',
  description: 'Send alerts via notification service',
};
