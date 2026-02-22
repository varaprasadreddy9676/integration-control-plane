/**
 * Notification Channel Bootstrap
 * Register all available notification channels here
 *
 * To add a new channel:
 * 1. Create a new file in ./channels/ (e.g., pagerduty.js)
 * 2. Implement send() and test() methods
 * 3. Export channelName, displayName, description
 * 4. Add to AVAILABLE_CHANNELS array below
 * 5. Run initializeChannels()
 *
 * To remove a channel:
 * 1. Comment out or remove from AVAILABLE_CHANNELS array
 * 2. Restart the application
 */

const notificationManager = require('./index');
const { log } = require('../../logger');

// Available notification channels
// Comment out any channel you don't want to use
const AVAILABLE_CHANNELS = [
  {
    enabled: true, // Set to false to disable without removing code
    module: './channels/email',
  },
  {
    enabled: false, // Slack is disabled by default (not configured yet)
    module: './channels/slack',
  },
  // Add more channels here as needed:
  // {
  //   enabled: true,
  //   module: './channels/pagerduty'
  // },
  // {
  //   enabled: true,
  //   module: './channels/sms'
  // }
];

/**
 * Initialize and register all enabled notification channels
 */
function initializeChannels() {
  log('info', 'Initializing notification channels...');

  let registeredCount = 0;
  let skippedCount = 0;

  for (const channelConfig of AVAILABLE_CHANNELS) {
    if (!channelConfig.enabled) {
      skippedCount++;
      continue;
    }

    try {
      const channel = require(channelConfig.module);

      if (!channel.channelName) {
        log('warn', `Channel module ${channelConfig.module} missing channelName export`);
        continue;
      }

      notificationManager.registerChannel(channel.channelName, channel);
      registeredCount++;

      log('info', `Notification channel enabled: ${channel.displayName || channel.channelName}`, {
        channelName: channel.channelName,
        description: channel.description,
      });
    } catch (error) {
      log('error', `Failed to load notification channel: ${channelConfig.module}`, {
        error: error.message,
        stack: error.stack,
      });
    }
  }

  log('info', `Notification channels initialized: ${registeredCount} registered, ${skippedCount} skipped`);

  return {
    registered: registeredCount,
    skipped: skippedCount,
    channels: notificationManager.getRegisteredChannels(),
  };
}

/**
 * Get all available channels (both enabled and disabled)
 * Useful for UI to show what channels can be configured
 */
function getAvailableChannels() {
  const channels = [];

  for (const channelConfig of AVAILABLE_CHANNELS) {
    try {
      const channel = require(channelConfig.module);
      channels.push({
        channelName: channel.channelName,
        displayName: channel.displayName || channel.channelName,
        description: channel.description || '',
        enabled: channelConfig.enabled,
        registered: notificationManager.getRegisteredChannels().includes(channel.channelName),
      });
    } catch (error) {
      log('warn', `Failed to load channel metadata: ${channelConfig.module}`, {
        error: error.message,
      });
    }
  }

  return channels;
}

module.exports = {
  initializeChannels,
  getAvailableChannels,
  AVAILABLE_CHANNELS,
};
