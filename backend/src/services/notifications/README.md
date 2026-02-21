# Notification System - Plugin Architecture

The notification system uses a plugin architecture that makes it easy to add, remove, or configure different notification channels (Email, Slack, SMS, PagerDuty, etc.) without modifying core code.

## Architecture

```
notifications/
├── index.js              # Core notification manager
├── bootstrap.js          # Channel registration
├── channels/             # Channel plugins
│   ├── email.js         # Email via Internal Communication Service
│   ├── slack.js         # Slack webhook integration
│   └── ...              # Add more channels here
└── README.md            # This file
```

## How It Works

1. **Core Manager** (`index.js`): Manages all notification channels and routes notifications
2. **Bootstrap** (`bootstrap.js`): Registers available channels on startup
3. **Channel Plugins** (`channels/*.js`): Individual channel implementations

## Adding a New Channel

### Step 1: Create Channel Plugin

Create a new file in `channels/` directory (e.g., `pagerduty.js`):

```javascript
const fetch = require('node-fetch');
const { log } = require('../../../logger');

/**
 * Send notification via PagerDuty
 */
async function send(notification, config) {
  const { integrationKey } = config;

  if (!integrationKey) {
    log('warn', 'PagerDuty: No integration key configured');
    return false;
  }

  try {
    const payload = {
      routing_key: integrationKey,
      event_action: 'trigger',
      payload: {
        summary: notification.title,
        severity: notification.severity.toLowerCase(),
        source: 'event-gateway',
        custom_details: notification.data
      }
    };

    const response = await fetch('https://events.pagerduty.com/v2/enqueue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      timeout: 10000
    });

    return response.ok;
  } catch (error) {
    log('error', 'PagerDuty send failed', { error: error.message });
    return false;
  }
}

/**
 * Test PagerDuty configuration
 */
async function test(config) {
  const testNotification = {
    type: 'test',
    severity: 'INFO',
    title: 'PagerDuty Test',
    message: 'Test notification from Event Gateway',
    data: {}
  };

  const success = await send(testNotification, config);
  return {
    success,
    message: success ? 'Test sent to PagerDuty' : 'Failed to send test'
  };
}

module.exports = {
  send,
  test,
  channelName: 'pagerduty',
  displayName: 'PagerDuty',
  description: 'Send critical alerts to PagerDuty'
};
```

### Step 2: Register Channel

Edit `bootstrap.js` and add your channel to the `AVAILABLE_CHANNELS` array:

```javascript
const AVAILABLE_CHANNELS = [
  { enabled: true, module: './channels/email' },
  { enabled: true, module: './channels/slack' },
  { enabled: true, module: './channels/pagerduty' }  // Add this line
];
```

### Step 3: Restart Application

```bash
npm restart
```

That's it! Your new channel is now available.

## Removing a Channel

To temporarily disable a channel, set `enabled: false` in `bootstrap.js`:

```javascript
{ enabled: false, module: './channels/slack' }  // Disabled but code still present
```

To permanently remove, delete the channel file and remove from `AVAILABLE_CHANNELS`.

## Channel Plugin Interface

Every channel plugin MUST implement:

### Required Exports

```javascript
module.exports = {
  send,           // Function: async (notification, config) => boolean
  test,           // Function: async (config) => {success: boolean, message: string}
  channelName,    // String: Unique identifier (e.g., 'slack', 'email')
  displayName,    // String: Human-readable name (e.g., 'Slack', 'Email')
  description     // String: Channel description
};
```

### send() Method

```javascript
/**
 * @param {Object} notification - Notification payload
 * @param {string} notification.type - Type (webhook_failure, system_health, etc.)
 * @param {string} notification.severity - Severity (INFO, WARNING, CRITICAL)
 * @param {string} notification.title - Notification title
 * @param {string} notification.message - Notification message
 * @param {Object} notification.data - Additional data
 * @param {Object} config - Channel-specific configuration
 * @returns {Promise<boolean>} - True if sent successfully
 */
async function send(notification, config) {
  // Your implementation here
}
```

### test() Method

```javascript
/**
 * @param {Object} config - Channel-specific configuration
 * @returns {Promise<Object>} - {success: boolean, message: string}
 */
async function test(config) {
  // Send a test notification
  // Return success status and message
}
```

## Notification Types

The system sends these notification types:

| Type | Severity | When Triggered |
|------|----------|----------------|
| `webhook_failure` | WARNING/CRITICAL | After X consecutive failures |
| `webhook_auto_disabled` | CRITICAL | Webhook auto-disabled |
| `circuit_breaker` | CRITICAL/INFO | Circuit breaker state change |
| `system_health` | INFO/WARNING/CRITICAL | System health degradation |

## Configuration Storage

Notification settings are stored per entity in MongoDB:

```javascript
{
  orgUnitRid: 100,
  channels: {
    email: {
      enabled: true,
      recipients: ['admin@example.com'],
      hospitalCode: '7306191',
      corporateEntityCode: '7859621'
    },
    slack: {
      enabled: true,
      webhookUrl: 'https://hooks.slack.com/...',
      channel: '#alerts'
    }
  },
  alertThresholds: {
    consecutiveFailures: 50,
    enableAutoDisable: true
  },
  createdAt: '2025-01-15T10:00:00Z',
  updatedAt: '2025-01-15T10:00:00Z'
}
```

## Usage Example

```javascript
const notificationManager = require('./services/notifications');
const { initializeChannels } = require('./services/notifications/bootstrap');

// Initialize on app startup
initializeChannels();

// Send notification
const notification = {
  type: 'webhook_failure',
  severity: 'CRITICAL',
  title: 'Webhook Failed',
  message: 'Webhook "CRM Sync" has failed 50 times',
  data: {
    webhook: { id: '123', name: 'CRM Sync', targetUrl: 'https://...' },
    failure: { consecutiveFailures: 50, lastError: 'Connection timeout' }
  }
};

const enabledChannels = ['email', 'slack'];
const channelConfigs = {
  email: {
    recipients: ['admin@example.com'],
    hospitalCode: '7306191'
  },
  slack: {
    webhookUrl: 'https://hooks.slack.com/...'
  }
};

await notificationManager.sendNotification(notification, enabledChannels, channelConfigs);
```

## Best Practices

1. **Always validate config** - Check required fields before sending
2. **Timeout requests** - Set reasonable timeouts (5-10 seconds)
3. **Log errors** - Use the logger for debugging
4. **Return boolean** - send() should return true/false, not throw
5. **Handle gracefully** - If one channel fails, others should still work
6. **Test thoroughly** - Implement the test() method properly

## Future Channel Ideas

- **SMS** (Twilio, AWS SNS)
- **Microsoft Teams** (Webhook connector)
- **Discord** (Webhook)
- **Telegram** (Bot API)
- **Webhooks** (Generic HTTP POST for custom integrations)
- **Database** (Store critical alerts in a dedicated table)
- **File** (Write alerts to a log file)

## Contributing

When adding a new channel:
1. Follow the plugin interface exactly
2. Add comprehensive error handling
3. Document configuration requirements
4. Test with real credentials
5. Update this README with channel-specific notes
