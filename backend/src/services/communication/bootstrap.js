/**
 * Communication Adapter Bootstrap
 * Registers all available communication adapters on startup
 */

const adapterRegistry = require('./adapter-registry');
const smtpAdapter = require('./adapters/email-smtp');

/**
 * Initialize all communication adapters
 * Called on application startup
 */
function initializeCommunicationAdapters() {
  console.log('[Communication] Initializing adapters...');

  // ============================================
  // Email Adapters
  // ============================================
  adapterRegistry.register('EMAIL', 'SMTP', smtpAdapter);

  // Future: Gmail OAuth adapter
  // const gmailAdapter = require('./adapters/email-gmail');
  // adapterRegistry.register('EMAIL', 'GMAIL_OAUTH', gmailAdapter);

  // Future: Outlook OAuth adapter
  // const outlookAdapter = require('./adapters/email-outlook');
  // adapterRegistry.register('EMAIL', 'OUTLOOK_OAUTH', outlookAdapter);

  // ============================================
  // Future: SMS Adapters
  // ============================================
  // const twilioSmsAdapter = require('./adapters/sms-twilio');
  // adapterRegistry.register('SMS', 'TWILIO', twilioSmsAdapter);

  // ============================================
  // Future: WhatsApp Adapters
  // ============================================
  // const twilioWhatsappAdapter = require('./adapters/whatsapp-twilio');
  // adapterRegistry.register('WHATSAPP', 'TWILIO', twilioWhatsappAdapter);

  // ============================================
  // Future: Slack Adapters
  // ============================================
  // const slackAdapter = require('./adapters/slack-webhook');
  // adapterRegistry.register('SLACK', 'WEBHOOK', slackAdapter);

  // List all registered adapters
  const adapters = adapterRegistry.listAdapters();
  console.log('[Communication] Registered adapters:', adapters);
  console.log('[Communication] Initialization complete');
}

module.exports = {
  initializeCommunicationAdapters,
};
