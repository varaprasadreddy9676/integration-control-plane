/**
 * Email Service for Daily Reports
 * Uses existing notification service (same as alerting system)
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');
const config = require('../config');
const { log, logError } = require('../logger');

// Communication service URL from config
const COMMUNICATION_SERVICE_URL =
  config.communicationServiceUrl || 'https://notification.example.com/notification-service/api/sendNotification';

class EmailService {
  constructor() {
    this.isConfigured = false;
  }

  /**
   * Initialize email service - validates configuration
   */
  initialize() {
    if (!COMMUNICATION_SERVICE_URL) {
      log('warn', '[EmailService] Communication service URL not configured');
      return;
    }

    this.isConfigured = true;
    log('info', '[EmailService] Email service initialized (using notification service)');
  }

  /**
   * Send JSON payload to communication service
   */
  async _sendToCommunicationService(payload, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      const parsed = new URL(COMMUNICATION_SERVICE_URL);
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
   * Send email via communication service
   * @param {Object} options - Email options
   * @param {string|string[]} options.to - Recipient email(s)
   * @param {string} options.subject - Email subject
   * @param {string} options.html - HTML content
   * @param {string} options.hospitalCode - Hospital code (optional)
   * @param {string} options.corporateEntityCode - Corporate entity code (optional)
   * @param {Buffer} options.attachment - PDF attachment buffer (optional)
   * @param {string} options.attachmentName - Attachment filename (optional)
   * @returns {Promise<Object>} Send result
   */
  async sendEmail({ to, subject, html, hospitalCode, corporateEntityCode, attachment, attachmentName }) {
    if (!this.isConfigured) {
      log('warn', '[EmailService] Email service not configured - skipping email send');
      return { success: false, reason: 'Email service not configured' };
    }

    try {
      const recipients = Array.isArray(to) ? to : [to];

      // Communication service payload format
      // Per integration guide: use 'content' for HTML (works on both Gmail and Outlook)
      const payload = {
        payload: {
          messageType: 'email',
          subject,
          content: html, // Use 'content' field for HTML (works on both Gmail/Outlook)
          to: recipients,
          hospitalCode: hospitalCode || 'integration-gateway',
          corporateEntityCode: corporateEntityCode || 'integration-gateway',
          source: 'integrationGateway',
        },
      };

      // Add attachment if provided (Gmail format: single base64 attachment)
      if (attachment && attachmentName) {
        payload.payload.attachment = attachment.toString('base64');
        payload.payload.attachmentName = attachmentName;
        log('info', `[EmailService] Including attachment: ${attachmentName}`);
      }

      log('info', `[EmailService] Sending email via communication service to ${recipients.join(', ')}`);

      const response = await this._sendToCommunicationService(payload, 15000);

      log('info', '[EmailService] Communication service response', {
        status: response.status,
        recipients: recipients.length,
      });

      if (response.status < 200 || response.status >= 300) {
        throw new Error(`Communication service returned ${response.status}: ${response.body}`);
      }

      let parsed = null;
      try {
        parsed = JSON.parse(response.body);
      } catch (_e) {
        /* non-JSON response is acceptable */
      }

      if (parsed && parsed.success === false) {
        throw new Error(`Communication service rejected request: ${JSON.stringify(parsed)}`);
      }

      log('info', `[EmailService] Email sent successfully to ${recipients.join(', ')}`);

      return {
        success: true,
        messageId: parsed?.messageId || `comm-service-${Date.now()}`,
        recipients,
      };
    } catch (error) {
      await logError(error, { scope: 'EmailService', action: 'sendEmail' });
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Send daily dashboard report email
   * @param {Object} options
   * @param {string|string[]} options.to - Recipient email(s)
   * @param {number} options.orgId - Org ID
   * @param {string} options.entityName - Org name
   * @param {string} options.dashboardUrl - URL to dashboard
   * @param {Object} options.summary - Dashboard summary stats
   * @param {string} options.hospitalCode - Hospital code (optional)
   * @param {string} options.corporateEntityCode - Corporate entity code (optional)
   * @param {Buffer} options.pdfBuffer - PDF attachment buffer (optional)
   * @returns {Promise<Object>} Send result
   */
  async sendDailyReport({
    to,
    orgId,
    entityName,
    dashboardUrl,
    summary = {},
    hospitalCode,
    corporateEntityCode,
    pdfBuffer,
  }) {
    const date = new Date().toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    const subject = `Daily Dashboard Report - ${entityName} - ${date}`;

    const html = this._generateDailyReportHtml({
      entityName,
      date,
      dashboardUrl,
      summary,
    });

    return this.sendEmail({
      to,
      subject,
      html,
      hospitalCode,
      corporateEntityCode,
      attachment: pdfBuffer,
      attachmentName: pdfBuffer ? `Dashboard-${entityName}-${date}.pdf` : undefined,
    });
  }

  /**
   * Generate premium HTML template for daily report
   */
  _generateDailyReportHtml({ entityName, date, dashboardUrl, summary }) {
    const {
      totalDeliveries = 0,
      successfulDeliveries = 0,
      failedDeliveries = 0,
      successRate = 0,
      avgLatency = 0,
    } = summary;

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Daily Dashboard Report</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Helvetica', 'Arial', sans-serif;
      line-height: 1.6;
      color: #333;
      margin: 0;
      padding: 0;
      background-color: #f5f5f5;
    }
    .container {
      max-width: 600px;
      margin: 40px auto;
      background: white;
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
    }
    .header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 32px 24px;
      text-align: center;
    }
    .header h1 {
      margin: 0 0 8px 0;
      font-size: 24px;
      font-weight: 700;
    }
    .header p {
      margin: 0;
      opacity: 0.95;
      font-size: 14px;
    }
    .content {
      padding: 32px 24px;
    }
    .greeting {
      font-size: 16px;
      margin-bottom: 24px;
      color: #555;
    }
    .stats {
      display: table;
      width: 100%;
      margin: 24px 0;
      border-collapse: separate;
      border-spacing: 0 12px;
    }
    .stat-row {
      display: table-row;
    }
    .stat-label {
      display: table-cell;
      padding: 12px 16px;
      background: #f8f9fa;
      border-radius: 8px 0 0 8px;
      font-weight: 600;
      color: #555;
      width: 60%;
    }
    .stat-value {
      display: table-cell;
      padding: 12px 16px;
      background: #f8f9fa;
      border-radius: 0 8px 8px 0;
      text-align: right;
      font-weight: 700;
      color: #333;
    }
    .stat-value.success {
      color: #10b981;
    }
    .stat-value.error {
      color: #ef4444;
    }
    .stat-value.info {
      color: #3b82f6;
    }
    .cta-button {
      display: inline-block;
      margin: 24px 0;
      padding: 14px 32px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      text-decoration: none;
      border-radius: 8px;
      font-weight: 600;
      text-align: center;
      transition: transform 0.2s;
    }
    .cta-button:hover {
      transform: translateY(-2px);
    }
    .info-note {
      margin-top: 24px;
      padding: 16px;
      background: #f0f9ff;
      border-left: 4px solid #3b82f6;
      border-radius: 4px;
      font-size: 14px;
      color: #1e3a8a;
    }
    .footer {
      padding: 24px;
      text-align: center;
      font-size: 12px;
      color: #888;
      background: #f8f9fa;
      border-top: 1px solid #e5e7eb;
    }
    .footer a {
      color: #667eea;
      text-decoration: none;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>📊 Daily Dashboard Report</h1>
      <p>${entityName}</p>
    </div>

    <div class="content">
      <p class="greeting">
        Good evening! Here's your daily dashboard summary for <strong>${date}</strong>.
      </p>

      <div class="stats">
        <div class="stat-row">
          <div class="stat-label">Total Deliveries</div>
          <div class="stat-value">${totalDeliveries.toLocaleString()}</div>
        </div>
        <div class="stat-row">
          <div class="stat-label">Successful Deliveries</div>
          <div class="stat-value success">${successfulDeliveries.toLocaleString()}</div>
        </div>
        <div class="stat-row">
          <div class="stat-label">Failed Deliveries</div>
          <div class="stat-value error">${failedDeliveries.toLocaleString()}</div>
        </div>
        <div class="stat-row">
          <div class="stat-label">Success Rate</div>
          <div class="stat-value success">${successRate.toFixed(1)}%</div>
        </div>
        <div class="stat-row">
          <div class="stat-label">Average Latency</div>
          <div class="stat-value info">${avgLatency} ms</div>
        </div>
      </div>

      <div style="text-align: center;">
        <a href="${dashboardUrl}" class="cta-button">
          View Full Dashboard →
        </a>
      </div>

      <div class="info-note">
        💡 <strong>View detailed charts and analytics:</strong> Click the button above to see complete delivery trends, event distributions, error analysis, and performance metrics for today.
      </div>
    </div>

    <div class="footer">
      <p>
        This is an automated daily report from Integration Gateway.<br>
        <a href="${dashboardUrl}">View Dashboard</a>
      </p>
      <p style="margin-top: 12px; color: #aaa;">
        © ${new Date().getFullYear()} Integration Gateway. All rights reserved.
      </p>
    </div>
  </div>
</body>
</html>
    `;
  }

  /**
   * Verify email configuration
   */
  async verify() {
    if (!this.isConfigured) {
      return { success: false, reason: 'Email service not configured' };
    }

    try {
      log('info', '[EmailService] Email configuration verified successfully');
      return { success: true };
    } catch (error) {
      await logError(error, { scope: 'EmailService', action: 'verify' });
      return { success: false, error: error.message };
    }
  }
}

// Singleton instance
const emailService = new EmailService();

module.exports = emailService;
