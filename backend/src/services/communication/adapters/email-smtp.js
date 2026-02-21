/**
 * SMTP Email Adapter
 * Sends emails via SMTP (supports Gmail, Outlook, or any SMTP server)
 */

const nodemailer = require('nodemailer');
const { log } = require('../../../logger');

class SmtpAdapter {
  constructor() {
    // Cache transporters per configuration (avoid recreating on every send)
    this.transporters = new Map();
  }

  /**
   * Send email via SMTP
   * @param {object} payload - Email payload
   * @param {string|string[]} payload.to - Recipient email(s)
   * @param {string} payload.subject - Email subject
   * @param {string} payload.html - HTML content
   * @param {string} payload.text - Plain text content (optional)
   * @param {Array} payload.attachments - Attachments (optional)
   * @param {object} config - SMTP configuration
   * @param {string} config.host - SMTP host
   * @param {number} config.port - SMTP port
   * @param {string} config.username - SMTP username
   * @param {string} config.password - SMTP password
   * @param {string} config.fromEmail - From email address
   * @param {boolean} config.secure - Use TLS (optional, default: port === 465)
   * @returns {Promise<object>} Send result
   */
  async send(payload, config) {
    const { to, subject, html, text, attachments } = payload;
    const { host, port, username, password, fromEmail, secure } = config;

    // Validate required fields
    if (!to) throw new Error('Email recipient (to) is required');
    if (!subject && !html && !text) throw new Error('Email must have subject or content');
    if (!host || !port) throw new Error('SMTP host and port are required');
    if (!fromEmail) throw new Error('From email address is required');

    // Get or create transporter
    const transporter = this._getOrCreateTransporter(config);

    // Prepare mail options
    const mailOptions = {
      from: fromEmail,
      to: Array.isArray(to) ? to.join(', ') : to,
      subject: subject || '(No Subject)',
      text: text,
      html: html
    };

    // Add attachments if provided
    if (attachments && Array.isArray(attachments) && attachments.length > 0) {
      mailOptions.attachments = attachments.map(att => ({
        filename: att.filename,
        content: att.content,
        encoding: att.encoding || 'base64',
        contentType: att.contentType
      }));
    }

    log('info', '[SMTP] Sending email', {
      to: mailOptions.to,
      subject: mailOptions.subject,
      hasAttachments: !!(attachments && attachments.length > 0),
      attachmentCount: attachments ? attachments.length : 0
    });

    // Send email
    const info = await transporter.sendMail(mailOptions);

    log('info', '[SMTP] Email sent successfully', {
      messageId: info.messageId,
      accepted: info.accepted,
      rejected: info.rejected,
      response: info.response
    });

    return {
      success: true,
      messageId: info.messageId,
      accepted: info.accepted,
      rejected: info.rejected,
      provider: 'SMTP',
      timestamp: new Date()
    };
  }

  /**
   * Verify SMTP configuration
   * @param {object} config - SMTP configuration
   * @returns {Promise<object>} Verification result
   */
  async verify(config) {
    try {
      const transporter = this._createTransporter(config);
      await transporter.verify();

      log('info', '[SMTP] Configuration verified successfully', {
        host: config.host,
        port: config.port
      });

      return { success: true, message: 'SMTP configuration is valid' };
    } catch (error) {
      log('error', '[SMTP] Configuration verification failed', {
        error: error.message,
        host: config.host,
        port: config.port
      });

      return {
        success: false,
        message: 'SMTP verification failed',
        error: error.message
      };
    }
  }

  /**
   * Get or create transporter (with caching)
   * @private
   */
  _getOrCreateTransporter(config) {
    const cacheKey = `${config.host}:${config.port}:${config.username}`;

    // Return cached transporter if exists
    if (this.transporters.has(cacheKey)) {
      return this.transporters.get(cacheKey);
    }

    // Create new transporter
    const transporter = this._createTransporter(config);

    // Cache it
    this.transporters.set(cacheKey, transporter);

    // Clear cache after 1 hour to avoid stale connections
    setTimeout(() => {
      this.transporters.delete(cacheKey);
      log('debug', '[SMTP] Transporter cache cleared', { cacheKey });
    }, 3600000);

    return transporter;
  }

  /**
   * Create nodemailer transporter
   * @private
   */
  _createTransporter(config) {
    const { host, port, username, password, secure } = config;

    return nodemailer.createTransport({
      host,
      port,
      secure: secure !== undefined ? secure : port === 465, // Auto-detect TLS
      auth: username && password ? {
        user: username,
        pass: password
      } : undefined
    });
  }

  /**
   * Clear all cached transporters
   */
  clearCache() {
    this.transporters.clear();
    log('info', '[SMTP] All transporter caches cleared');
  }
}

// Singleton instance
module.exports = new SmtpAdapter();
