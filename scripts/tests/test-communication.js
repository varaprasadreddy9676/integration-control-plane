/**
 * Test script for COMMUNICATION adapters
 *
 * This script demonstrates how to:
 * 1. Create an INBOUND integration with COMMUNICATION action
 * 2. Send a test email via the integration endpoint
 * 3. Verify the job is processed by the worker
 *
 * Prerequisites:
 * - Backend server must be running
 * - Valid SMTP credentials configured in the integration
 * - MongoDB and MySQL databases running
 *
 * Usage:
 *   node test-communication.js
 */

const axios = require('axios');

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000/api/v1';
const API_KEY = process.env.API_KEY || 'your-api-key-here';
const ORG_ID = process.env.ORG_ID || '1';

// SMTP configuration - UPDATE WITH YOUR CREDENTIALS
const SMTP_CONFIG = {
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '587'),
  username: process.env.SMTP_USERNAME || 'your-email@gmail.com',
  password: process.env.SMTP_PASSWORD || 'your-app-password',
  fromEmail: process.env.SMTP_FROM_EMAIL || 'your-email@gmail.com'
};

const TEST_EMAIL_CONFIG = {
  to: process.env.TEST_TO_EMAIL || 'recipient@example.com',
  subject: 'Test Email from Integration Gateway',
  body: '<h1>Hello from Integration Gateway!</h1><p>This is a test email sent via SMTP adapter.</p>'
};

async function createTestIntegration() {
  console.log('Creating INBOUND integration with COMMUNICATION action...');

  const integration = {
    name: 'Test Email Communication',
    type: 'send-test-email',
    direction: 'INBOUND',
    isActive: true,
    inboundAuthType: 'NONE',
    requestTransformation: {
      mode: 'SCRIPT',
      script: `
        // Transform incoming request to email format
        return {
          to: input.to || '${TEST_EMAIL_CONFIG.to}',
          subject: input.subject || 'Test Email',
          html: input.html || input.body || '<p>Test email</p>',
          text: input.text || null
        };
      `
    },
    actions: [
      {
        name: 'Send Email via SMTP',
        kind: 'COMMUNICATION',
        communicationConfig: {
          channel: 'EMAIL',
          provider: 'SMTP',
          smtp: SMTP_CONFIG
        }
      }
    ]
  };

  try {
    const response = await axios.post(
      `${API_BASE_URL}/inbound-integrations`,
      integration,
      {
        headers: {
          'X-API-Key': API_KEY,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log('✅ Integration created successfully:');
    console.log(`   ID: ${response.data.id}`);
    console.log(`   Name: ${integration.name}`);
    console.log(`   Type: ${integration.type}`);
    return response.data.id;
  } catch (error) {
    console.error('❌ Failed to create integration:');
    console.error(`   Error: ${error.response?.data?.error || error.message}`);
    throw error;
  }
}

async function sendTestEmail() {
  console.log('\nSending test email...');

  const emailPayload = {
    to: TEST_EMAIL_CONFIG.to,
    subject: TEST_EMAIL_CONFIG.subject,
    html: TEST_EMAIL_CONFIG.body
  };

  try {
    const response = await axios.post(
      `${API_BASE_URL}/integrations/send-test-email?orgId=${ORG_ID}`,
      emailPayload,
      {
        headers: {
          'X-API-Key': API_KEY,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log('✅ Email job created successfully:');
    console.log(`   Status: ${response.data.status}`);
    console.log(`   Trace ID: ${response.data.traceId}`);
    console.log(`   Job ID: ${response.data.jobId}`);
    console.log('\n📧 Email will be sent asynchronously by the worker.');
    console.log('   Check execution logs for delivery status.');

    return response.data;
  } catch (error) {
    console.error('❌ Failed to send email:');
    console.error(`   Error: ${error.response?.data?.error || error.message}`);
    if (error.response?.data?.details) {
      console.error(`   Details: ${JSON.stringify(error.response.data.details)}`);
    }
    throw error;
  }
}

async function checkJobStatus(traceId) {
  console.log(`\nChecking job status (traceId: ${traceId})...`);

  try {
    const response = await axios.get(
      `${API_BASE_URL}/logs?traceId=${traceId}`,
      {
        headers: {
          'X-API-Key': API_KEY
        }
      }
    );

    const logs = response.data;
    if (logs.length === 0) {
      console.log('⏳ No logs found yet. Job may still be processing...');
      return null;
    }

    const latestLog = logs[0];
    console.log('✅ Job status:');
    console.log(`   Status: ${latestLog.status}`);
    console.log(`   Response Status: ${latestLog.responseStatus}`);
    console.log(`   Response Time: ${latestLog.responseTimeMs}ms`);
    console.log(`   Attempt Count: ${latestLog.attemptCount}`);

    if (latestLog.status === 'SUCCESS') {
      console.log('   ✅ Email sent successfully!');
    } else if (latestLog.status === 'FAILED') {
      console.log(`   ❌ Email delivery failed: ${latestLog.errorMessage}`);
    } else if (latestLog.status === 'PENDING') {
      console.log('   ⏳ Email is still pending...');
    }

    return latestLog;
  } catch (error) {
    console.error('❌ Failed to check job status:');
    console.error(`   Error: ${error.response?.data?.error || error.message}`);
    return null;
  }
}

async function cleanup(integrationId) {
  if (!integrationId) return;

  console.log(`\nCleaning up test integration (${integrationId})...`);

  try {
    await axios.delete(
      `${API_BASE_URL}/inbound-integrations/${integrationId}`,
      {
        headers: {
          'X-API-Key': API_KEY
        }
      }
    );
    console.log('✅ Test integration deleted');
  } catch (error) {
    console.error('❌ Failed to delete integration:');
    console.error(`   Error: ${error.response?.data?.error || error.message}`);
  }
}

async function main() {
  console.log('='.repeat(60));
  console.log('COMMUNICATION ADAPTER TEST');
  console.log('='.repeat(60));

  let integrationId = null;

  try {
    // Step 1: Create integration
    integrationId = await createTestIntegration();

    // Step 2: Send test email
    const result = await sendTestEmail();

    // Step 3: Wait for worker to process (give it 5 seconds)
    console.log('\nWaiting 5 seconds for worker to process job...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Step 4: Check job status
    await checkJobStatus(result.traceId);

    // Step 5: Cleanup
    const shouldCleanup = process.env.CLEANUP !== 'false';
    if (shouldCleanup) {
      await cleanup(integrationId);
    } else {
      console.log('\n⚠️  Cleanup skipped. Integration will remain in database.');
      console.log(`   Integration ID: ${integrationId}`);
    }

    console.log('\n' + '='.repeat(60));
    console.log('TEST COMPLETED');
    console.log('='.repeat(60));

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);

    // Cleanup on error
    if (integrationId) {
      await cleanup(integrationId);
    }

    process.exit(1);
  }
}

// Run test if executed directly
if (require.main === module) {
  main().catch(error => {
    console.error('Unhandled error:', error);
    process.exit(1);
  });
}

module.exports = { createTestIntegration, sendTestEmail, checkJobStatus };
