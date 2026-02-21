# Communication Adapters

The Integration Gateway supports sending communications (email, SMS, WhatsApp, Slack, etc.) through a pluggable adapter system. This allows you to send notifications and messages without modifying upstream HIMS systems.

## Architecture

### Key Concepts

- **`direction`**: Determines how a job is **triggered** (INBOUND | OUTBOUND | SCHEDULED)
- **`action.kind`**: Determines how a job is **delivered** (HTTP | COMMUNICATION)
- **Adapter Registry**: Central registry for all communication providers
- **Async Delivery**: INBOUND COMMUNICATION jobs are queued and processed asynchronously by workers

### Flow Diagram

```
Client → Gateway → Transform → Create Job → Return 202 Accepted
                                    ↓
                              Worker picks up job
                                    ↓
                        Adapter Registry → Provider → Deliver
                                    ↓
                              Update job status
```

## Supported Channels

### Email (Implemented)

- **SMTP**: Send emails via any SMTP server (Gmail, Outlook, custom)
- **Gmail OAuth**: *(Future)* Send emails via Gmail OAuth 2.0
- **Outlook OAuth**: *(Future)* Send emails via Outlook OAuth 2.0

### SMS (Future)

- **Twilio**: Send SMS via Twilio
- **AWS SNS**: Send SMS via AWS SNS

### WhatsApp (Future)

- **Twilio**: Send WhatsApp messages via Twilio Business API
- **Meta WhatsApp**: Send WhatsApp messages via Meta Business Platform

### Slack (Future)

- **Webhook**: Send Slack messages via Incoming Webhooks
- **OAuth**: Send Slack messages via Slack App OAuth

## Usage

### 1. Create INBOUND Integration with COMMUNICATION Action

**Example: Send Email via SMTP**

```bash
POST /api/v1/inbound-integrations
Content-Type: application/json
X-API-Key: your-api-key

{
  "name": "Send Patient Visit Email",
  "type": "send-visit-email",
  "direction": "INBOUND",
  "isActive": true,
  "inboundAuthType": "API_KEY",
  "inboundAuthConfig": {
    "headerName": "x-api-key",
    "value": "secure-key-here"
  },
  "requestTransformation": {
    "mode": "SCRIPT",
    "script": "return { to: input.patientEmail, subject: `Appointment Confirmed - ${input.appointmentDate}`, html: `<h1>Dear ${input.patientName}</h1><p>Your appointment is confirmed for ${input.appointmentDate}.</p>` };"
  },
  "actions": [
    {
      "name": "Send Email",
      "kind": "COMMUNICATION",
      "communicationConfig": {
        "channel": "EMAIL",
        "provider": "SMTP",
        "smtp": {
          "host": "smtp.gmail.com",
          "port": 587,
          "username": "noreply@hospital.com",
          "password": "your-app-password",
          "fromEmail": "noreply@hospital.com"
        }
      }
    }
  ]
}
```

**Response:**

```json
{
  "success": true,
  "id": "507f1f77bcf86cd799439011",
  "message": "Inbound integration created successfully"
}
```

### 2. Call Integration Endpoint to Send Email

```bash
POST /api/v1/integrations/send-visit-email?orgId=1
Content-Type: application/json
X-API-Key: secure-key-here

{
  "patientEmail": "patient@example.com",
  "patientName": "John Doe",
  "appointmentDate": "2024-03-15 10:00 AM"
}
```

**Response:**

```json
{
  "success": true,
  "status": "queued",
  "traceId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "jobId": "507f1f77bcf86cd799439012",
  "message": "Communication job created successfully. Check execution logs for status."
}
```

### 3. Check Job Status

```bash
GET /api/v1/logs?traceId=f47ac10b-58cc-4372-a567-0e02b2c3d479
X-API-Key: your-api-key
```

**Response:**

```json
[
  {
    "id": "507f1f77bcf86cd799439013",
    "integrationName": "Send Patient Visit Email - Send Email",
    "eventType": "send-visit-email",
    "direction": "INBOUND",
    "triggerType": "MANUAL",
    "status": "SUCCESS",
    "responseStatus": 200,
    "responseTimeMs": 1250,
    "attemptCount": 1,
    "traceId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    "messageId": "<abc123@smtp.gmail.com>",
    "createdAt": "2024-01-15T10:00:00.000Z"
  }
]
```

## Testing

### Manual Testing

1. **Configure SMTP credentials** in your integration
2. **Run the test script**:

```bash
# Set environment variables
export SMTP_HOST=smtp.gmail.com
export SMTP_PORT=587
export SMTP_USERNAME=your-email@gmail.com
export SMTP_PASSWORD=your-app-password
export SMTP_FROM_EMAIL=your-email@gmail.com
export TEST_TO_EMAIL=recipient@example.com
export API_KEY=your-api-key
export ORG_ID=1

# Run test
node backend/test-communication.js
```

### Using Gmail

To use Gmail as your SMTP provider:

1. Enable 2-factor authentication in your Google account
2. Generate an **App Password** at https://myaccount.google.com/apppasswords
3. Use the app password (not your regular password) in the SMTP config

```json
{
  "smtp": {
    "host": "smtp.gmail.com",
    "port": 587,
    "username": "your-email@gmail.com",
    "password": "your-16-char-app-password",
    "fromEmail": "your-email@gmail.com"
  }
}
```

### Using Outlook

```json
{
  "smtp": {
    "host": "smtp-mail.outlook.com",
    "port": 587,
    "username": "your-email@outlook.com",
    "password": "your-password",
    "fromEmail": "your-email@outlook.com"
  }
}
```

### Using Custom SMTP Server

```json
{
  "smtp": {
    "host": "smtp.yourserver.com",
    "port": 465,
    "secure": true,
    "username": "user@yourserver.com",
    "password": "your-password",
    "fromEmail": "noreply@yourserver.com"
  }
}
```

## Developing New Adapters

### Adapter Interface

All adapters must implement the following interface:

```javascript
class CommunicationAdapter {
  /**
   * Send message via this adapter
   * @param {object} payload - Message payload (channel-specific format)
   * @param {object} config - Provider configuration
   * @returns {Promise<object>} Delivery result with messageId
   */
  async send(payload, config) {
    // Implementation here
    return {
      success: true,
      messageId: 'unique-message-id',
      provider: 'PROVIDER_NAME',
      timestamp: new Date()
    };
  }

  /**
   * Verify provider configuration (optional)
   * @param {object} config - Provider configuration
   * @returns {Promise<object>} Verification result
   */
  async verify(config) {
    // Implementation here
    return {
      success: true,
      message: 'Configuration is valid'
    };
  }
}
```

### Example: SMS Adapter (Twilio)

**File:** `backend/src/services/communication/adapters/sms-twilio.js`

```javascript
const twilio = require('twilio');
const { log } = require('../../../logger');

class TwilioSmsAdapter {
  constructor() {
    this.clients = new Map(); // Cache Twilio clients
  }

  async send(payload, config) {
    const { to, body } = payload;
    const { accountSid, authToken, fromNumber } = config;

    // Validate required fields
    if (!to) throw new Error('Phone number (to) is required');
    if (!body) throw new Error('Message body is required');
    if (!accountSid || !authToken || !fromNumber) {
      throw new Error('Twilio credentials are required');
    }

    // Get or create Twilio client
    const client = this._getOrCreateClient(accountSid, authToken);

    log('info', '[Twilio SMS] Sending message', { to, from: fromNumber });

    // Send SMS
    const message = await client.messages.create({
      to: to,
      from: fromNumber,
      body: body
    });

    log('info', '[Twilio SMS] Message sent successfully', {
      messageSid: message.sid,
      status: message.status
    });

    return {
      success: true,
      messageId: message.sid,
      provider: 'TWILIO',
      timestamp: new Date(),
      status: message.status
    };
  }

  async verify(config) {
    try {
      const { accountSid, authToken } = config;
      const client = twilio(accountSid, authToken);
      await client.api.accounts(accountSid).fetch();

      return { success: true, message: 'Twilio configuration is valid' };
    } catch (error) {
      return {
        success: false,
        message: 'Twilio verification failed',
        error: error.message
      };
    }
  }

  _getOrCreateClient(accountSid, authToken) {
    const cacheKey = `${accountSid}:${authToken.substring(0, 8)}`;

    if (this.clients.has(cacheKey)) {
      return this.clients.get(cacheKey);
    }

    const client = twilio(accountSid, authToken);
    this.clients.set(cacheKey, client);

    return client;
  }

  clearCache() {
    this.clients.clear();
  }
}

// Singleton instance
module.exports = new TwilioSmsAdapter();
```

**Register the adapter:**

```javascript
// backend/src/services/communication/bootstrap.js
const twilioSmsAdapter = require('./adapters/sms-twilio');

function initializeCommunicationAdapters() {
  // Email adapters
  adapterRegistry.register('EMAIL', 'SMTP', smtpAdapter);

  // SMS adapters
  adapterRegistry.register('SMS', 'TWILIO', twilioSmsAdapter);
}
```

### Payload Formats

Each channel has its own payload format:

**Email:**
```javascript
{
  to: "recipient@example.com" | ["r1@example.com", "r2@example.com"],
  subject: "Email Subject",
  html: "<h1>HTML Content</h1>",
  text: "Plain text content (optional)",
  attachments: [  // optional
    {
      filename: "document.pdf",
      content: "base64-encoded-content",
      encoding: "base64",
      contentType: "application/pdf"
    }
  ]
}
```

**SMS:**
```javascript
{
  to: "+1234567890",
  body: "Your OTP is 123456"
}
```

**WhatsApp:**
```javascript
{
  to: "+1234567890",
  body: "Hello from WhatsApp!",
  mediaUrl: "https://example.com/image.jpg" // optional
}
```

**Slack:**
```javascript
{
  channel: "#general",
  text: "Deployment completed successfully",
  attachments: [  // optional
    {
      color: "#36a64f",
      title: "Build #123",
      text: "All tests passed"
    }
  ]
}
```

## Security Considerations

1. **Credentials Storage**: Provider credentials (SMTP passwords, API keys) are stored in MongoDB in **plain text**. Ensure your MongoDB instance is properly secured.

2. **Authentication**: Always use `inboundAuthType` to protect your integration endpoints from unauthorized access.

3. **Rate Limiting**: Configure `rateLimits` to prevent abuse.

4. **Data Validation**: Always validate and sanitize input data in transformation scripts.

5. **Secrets Management**: For production deployments, consider using environment variables or a secrets manager (HashiCorp Vault, AWS Secrets Manager) instead of storing credentials directly in MongoDB.

## Troubleshooting

### Email Not Sending

1. **Check execution logs**: Look for error messages in `/api/v1/logs?traceId=<traceId>`
2. **Verify SMTP credentials**: Ensure username, password, and host are correct
3. **Check firewall**: Ensure your server can connect to the SMTP port (usually 587 or 465)
4. **Gmail App Passwords**: If using Gmail, ensure you're using an app password, not your regular password
5. **Check worker status**: Ensure the `startPendingDeliveriesWorker` is running

### Job Stuck in PENDING

1. **Check worker logs**: Look for errors in the worker processing
2. **Verify integration is active**: `isActive: true`
3. **Check pending_deliveries collection**: Query MongoDB to see job status
4. **Restart workers**: Sometimes workers need to be restarted to pick up new jobs

### Transformation Errors

1. **Test transformation**: Use the `/test` endpoint to validate transformations
2. **Check script syntax**: Ensure your transformation script is valid JavaScript
3. **Log intermediate values**: Add `console.log()` statements in your script for debugging

## Configuration

### Worker Configuration

Add to `backend/config.json`:

```json
{
  "worker": {
    "enabled": true,
    "intervalMs": 5000,
    "inboundJobsIntervalMs": 5000,
    "batchSize": 5
  }
}
```

- `inboundJobsIntervalMs`: Polling interval for `pending_deliveries` collection

## Monitoring

### Metrics to Monitor

1. **Pending Jobs Count**: Number of jobs in `pending_deliveries` with status PENDING
2. **Failed Jobs Count**: Number of jobs with status FAILED
3. **Average Processing Time**: responseTimeMs from execution logs
4. **Success Rate**: Ratio of SUCCESS to total jobs

### Sample Queries

```javascript
// MongoDB queries

// Count pending jobs
db.pending_deliveries.countDocuments({ status: 'PENDING' })

// Count failed jobs (last 24 hours)
db.pending_deliveries.countDocuments({
  status: 'FAILED',
  createdAt: { $gte: new Date(Date.now() - 24*60*60*1000) }
})

// Average processing time for successful emails
db.execution_logs.aggregate([
  { $match: { httpMethod: 'COMMUNICATION', status: 'SUCCESS' } },
  { $group: { _id: null, avgTime: { $avg: '$responseTimeMs' } } }
])
```

## Future Enhancements

- [ ] Gmail OAuth 2.0 adapter
- [ ] Outlook OAuth 2.0 adapter
- [ ] Twilio SMS adapter
- [ ] Twilio WhatsApp adapter
- [ ] Slack Webhook adapter
- [ ] Template management system
- [ ] Bounce handling for emails
- [ ] Delivery receipts for SMS/WhatsApp
- [ ] Attachment storage in S3/blob storage
- [ ] OAuth token refresh for Gmail/Outlook
- [ ] Multi-provider fallback (try Gmail, fallback to SMTP)
