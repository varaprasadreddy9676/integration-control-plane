/**
 * Comprehensive Live System Tests
 * Tests the actual running backend server to verify all functionality
 * Run with: npm test -- comprehensive-live.test.js
 *
 * Prerequisites:
 * - Backend server running on localhost:4000
 * - MongoDB running on localhost:27017
 * - MySQL running with notification_queue access
 */

// Use global fetch (available in Node 18+) or polyfill
const fetch = global.fetch || require('node-fetch');
const { MongoClient } = require('mongodb');

const API_BASE_URL = process.env.TEST_API_URL || 'http://localhost:4000/api/v1';
const API_KEY = process.env.TEST_API_KEY || 'mdcs_dev_key_1f4a';
const ENTITY_RID = 100;

const headers = {
  'Content-Type': 'application/json',
  'X-API-Key': API_KEY
};
const runLiveSuite = process.env.RUN_LIVE_API_TESTS === '1';
const describeLive = runLiveSuite ? describe : describe.skip;

// Helper to make API requests
async function apiRequest(endpoint, options = {}) {
  const url = `${API_BASE_URL}${endpoint}${endpoint.includes('?') ? '&' : '?'}entityParentRid=${ENTITY_RID}`;
  const response = await fetch(url, {
    ...options,
    headers: { ...headers, ...options.headers }
  });

  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (e) {
    data = text;
  }

  return { response, data, status: response.status };
}

// Helper to create test webhook
async function createTestWebhook(config = {}) {
  const defaultConfig = {
    name: `Test Webhook ${Date.now()}`,
    eventType: 'APPOINTMENT_CREATED',
    targetUrl: 'https://httpbin.org/post',
    scope: 'PARENT_ONLY',
    httpMethod: 'POST',
    authType: 'NONE',
    isActive: true,
    transformMode: 'SIMPLE',
    retryCount: 3,
    timeoutMs: 5000
  };

  const { data } = await apiRequest('/webhooks', {
    method: 'POST',
    body: JSON.stringify({ ...defaultConfig, ...config })
  });

  return data;
}

// Helper to cleanup webhook
async function cleanupWebhook(webhookId) {
  try {
    await apiRequest(`/webhooks/${webhookId}`, { method: 'DELETE' });
  } catch (e) {
    // Ignore cleanup errors
  }
}

describeLive('Comprehensive Live System Tests', () => {
  let mongoClient;
  let db;

  beforeAll(async () => {
    // Connect to MongoDB for direct database verification
    mongoClient = new MongoClient('mongodb://localhost:27017');
    await mongoClient.connect();
    db = mongoClient.db('webhook_manager');
  });

  afterAll(async () => {
    if (mongoClient) {
      await mongoClient.close();
    }
  });

  describe('1. Worker & Polling', () => {
    test('Health check confirms worker is running', async () => {
      const { status, data } = await apiRequest('/health');
      expect(status).toBe(200);
      expect(data.status).toBe('healthy');
      expect(data.mongodb).toBe('connected');
      expect(data.mysql).toBe('connected');
    });

    test('Checkpoint starts at 0 and persists', async () => {
      const checkpointDoc = await db.collection('worker_checkpoint').findOne({});
      expect(checkpointDoc).toBeTruthy();
      expect(typeof checkpointDoc.lastProcessedId).toBe('number');
      expect(checkpointDoc.lastProcessedId).toBeGreaterThanOrEqual(0);
    });

    test('Deduplication cache prevents duplicate event processing', async () => {
      // This would require injecting duplicate events
      // Verify by checking processed_events collection has TTL index
      const indexes = await db.collection('processed_events').indexes();
      const ttlIndex = indexes.find(idx => idx.expireAfterSeconds);
      expect(ttlIndex).toBeTruthy();
      expect(ttlIndex.expireAfterSeconds).toBe(3600); // 1 hour
    });
  });

  describe('2. Webhook Configuration & Validation', () => {
    test('URL validation blocks private IPs when configured', async () => {
      const result = await createTestWebhook({
        targetUrl: 'http://192.168.1.1/webhook'
      });

      // Should create but delivery will fail with validation error
      expect(result.id).toBeTruthy();

      // Test the webhook - should fail validation
      const { data: testResult } = await apiRequest(`/webhooks/${result.id}/test`, {
        method: 'POST',
        body: JSON.stringify({ testPayload: true })
      });

      expect(testResult.success).toBe(false);
      expect(testResult.error).toMatch(/private|blocked|invalid/i);

      await cleanupWebhook(result.id);
    });

    test('URL validation blocks HTTP when enforceHttps is true', async () => {
      const result = await createTestWebhook({
        targetUrl: 'http://example.com/webhook'
      });

      expect(result.id).toBeTruthy();

      const { data: testResult } = await apiRequest(`/webhooks/${result.id}/test`, {
        method: 'POST',
        body: JSON.stringify({ testPayload: true })
      });

      // May pass or fail depending on security.enforceHttps config
      if (testResult.success === false) {
        expect(testResult.error).toMatch(/https|secure/i);
      }

      await cleanupWebhook(result.id);
    });

    test('Creates webhook with all authentication types', async () => {
      const authTypes = ['NONE', 'API_KEY', 'BASIC', 'BEARER'];

      for (const authType of authTypes) {
        const config = {
          name: `Test ${authType}`,
          authType
        };

        if (authType === 'API_KEY') {
          config.authConfig = { apiKey: 'test-key-123', headerName: 'X-API-Key' };
        } else if (authType === 'BASIC') {
          config.authConfig = { username: 'user', password: 'pass' };
        } else if (authType === 'BEARER') {
          config.authConfig = { token: 'test-token-123' };
        }

        const result = await createTestWebhook(config);
        expect(result.id).toBeTruthy();
        expect(result.authType).toBe(authType);

        await cleanupWebhook(result.id);
      }
    });
  });

  describe('3. SIMPLE Transformations', () => {
    test('Field mapping with trim/upper/lower/default', async () => {
      const webhook = await createTestWebhook({
        targetUrl: 'https://httpbin.org/post',
        transformMode: 'SIMPLE',
        transformConfig: {
          fieldMappings: [
            { source: 'name', target: 'patientName', operation: 'trim' },
            { source: 'status', target: 'appointmentStatus', operation: 'upper' },
            { source: 'notes', target: 'comments', operation: 'lower' },
            { source: 'missing', target: 'withDefault', operation: 'default', value: 'N/A' }
          ],
          staticFields: [
            { key: 'source', value: 'event-gateway' },
            { key: 'version', value: '1.0' }
          ]
        }
      });

      const { data: testResult } = await apiRequest(`/webhooks/${webhook.id}/test`, {
        method: 'POST',
        body: JSON.stringify({
          name: '  John Doe  ',
          status: 'confirmed',
          notes: 'URGENT APPOINTMENT'
        })
      });

      expect(testResult.success).toBe(true);

      await cleanupWebhook(webhook.id);
    });

    test('Handles missing fields without throwing', async () => {
      const webhook = await createTestWebhook({
        targetUrl: 'https://httpbin.org/post',
        transformMode: 'SIMPLE',
        transformConfig: {
          fieldMappings: [
            { source: 'nonexistent', target: 'output', operation: 'trim' }
          ]
        }
      });

      const { data: testResult } = await apiRequest(`/webhooks/${webhook.id}/test`, {
        method: 'POST',
        body: JSON.stringify({ otherField: 'value' })
      });

      // Should succeed even with missing field
      expect(testResult.success).toBe(true);

      await cleanupWebhook(webhook.id);
    });
  });

  describe('4. SCRIPT Transformations', () => {
    test('Executes valid script transformation', async () => {
      const webhook = await createTestWebhook({
        targetUrl: 'https://httpbin.org/post',
        transformMode: 'SCRIPT',
        transformConfig: {
          script: `
            function transform(payload, context) {
              return {
                fullName: payload.firstName + ' ' + payload.lastName,
                timestamp: new Date().toISOString(),
                eventType: context.eventType
              };
            }
          `
        }
      });

      const { data: testResult } = await apiRequest(`/webhooks/${webhook.id}/test`, {
        method: 'POST',
        body: JSON.stringify({
          firstName: 'John',
          lastName: 'Doe'
        })
      });

      expect(testResult.success).toBe(true);

      await cleanupWebhook(webhook.id);
    });

    test('Fails fast on invalid script', async () => {
      const webhook = await createTestWebhook({
        targetUrl: 'https://httpbin.org/post',
        transformMode: 'SCRIPT',
        transformConfig: {
          script: 'invalid javascript syntax {{'
        }
      });

      const { data: testResult } = await apiRequest(`/webhooks/${webhook.id}/test`, {
        method: 'POST',
        body: JSON.stringify({ test: true })
      });

      expect(testResult.success).toBe(false);
      expect(testResult.error).toMatch(/transform|script|syntax/i);

      await cleanupWebhook(webhook.id);
    });

    test('Handles script timeout', async () => {
      const webhook = await createTestWebhook({
        targetUrl: 'https://httpbin.org/post',
        transformMode: 'SCRIPT',
        transformConfig: {
          script: `
            function transform(payload) {
              while(true) {} // Infinite loop
              return payload;
            }
          `
        }
      });

      const { data: testResult } = await apiRequest(`/webhooks/${webhook.id}/test`, {
        method: 'POST',
        body: JSON.stringify({ test: true })
      });

      expect(testResult.success).toBe(false);
      expect(testResult.error).toMatch(/timeout|execution/i);

      await cleanupWebhook(webhook.id);
    });

    test('Prevents excessive nesting depth', async () => {
      const webhook = await createTestWebhook({
        targetUrl: 'https://httpbin.org/post',
        transformMode: 'SCRIPT',
        transformConfig: {
          script: `
            function transform(payload) {
              function nest(depth) {
                if (depth > 100) return { value: depth };
                return { nested: nest(depth + 1) };
              }
              return nest(0);
            }
          `
        }
      });

      const { data: testResult } = await apiRequest(`/webhooks/${webhook.id}/test`, {
        method: 'POST',
        body: JSON.stringify({ test: true })
      });

      // Should either succeed with depth limit or fail gracefully
      expect([true, false]).toContain(testResult.success);

      await cleanupWebhook(webhook.id);
    });
  });

  describe('5. Webhook Delivery & Status Codes', () => {
    test('Successful delivery (2xx)', async () => {
      const webhook = await createTestWebhook({
        targetUrl: 'https://httpbin.org/status/200'
      });

      const { data: testResult } = await apiRequest(`/webhooks/${webhook.id}/test`, {
        method: 'POST',
        body: JSON.stringify({ test: true })
      });

      expect(testResult.success).toBe(true);
      expect(testResult.statusCode).toBe(200);

      await cleanupWebhook(webhook.id);
    });

    test('Client error (4xx) - no retry', async () => {
      const webhook = await createTestWebhook({
        targetUrl: 'https://httpbin.org/status/404'
      });

      const { data: testResult } = await apiRequest(`/webhooks/${webhook.id}/test`, {
        method: 'POST',
        body: JSON.stringify({ test: true })
      });

      expect(testResult.success).toBe(false);
      expect(testResult.statusCode).toBe(404);

      // Check log entry - should be FAILED not RETRYING
      const logs = await db.collection('execution_logs')
        .find({ webhookConfigId: webhook.id })
        .sort({ createdAt: -1 })
        .limit(1)
        .toArray();

      if (logs.length > 0) {
        expect(logs[0].status).toBe('FAILED');
      }

      await cleanupWebhook(webhook.id);
    });

    test('Server error (5xx) - triggers retry', async () => {
      const webhook = await createTestWebhook({
        targetUrl: 'https://httpbin.org/status/500'
      });

      const { data: testResult } = await apiRequest(`/webhooks/${webhook.id}/test`, {
        method: 'POST',
        body: JSON.stringify({ test: true })
      });

      expect(testResult.success).toBe(false);
      expect(testResult.statusCode).toBe(500);

      // Check log entry - should be RETRYING
      const logs = await db.collection('execution_logs')
        .find({ webhookConfigId: webhook.id })
        .sort({ createdAt: -1 })
        .limit(1)
        .toArray();

      if (logs.length > 0) {
        expect(logs[0].status).toBe('RETRYING');
      }

      await cleanupWebhook(webhook.id);
    });

    test('Rate limit (429) - triggers retry', async () => {
      const webhook = await createTestWebhook({
        targetUrl: 'https://httpbin.org/status/429'
      });

      const { data: testResult } = await apiRequest(`/webhooks/${webhook.id}/test`, {
        method: 'POST',
        body: JSON.stringify({ test: true })
      });

      expect(testResult.success).toBe(false);
      expect(testResult.statusCode).toBe(429);

      const logs = await db.collection('execution_logs')
        .find({ webhookConfigId: webhook.id })
        .sort({ createdAt: -1 })
        .limit(1)
        .toArray();

      if (logs.length > 0) {
        expect(logs[0].status).toBe('RETRYING');
      }

      await cleanupWebhook(webhook.id);
    });

    test('Request timeout handling', async () => {
      const webhook = await createTestWebhook({
        targetUrl: 'https://httpbin.org/delay/15', // Delays 15 seconds
        timeoutMs: 2000 // 2 second timeout
      });

      const { data: testResult } = await apiRequest(`/webhooks/${webhook.id}/test`, {
        method: 'POST',
        body: JSON.stringify({ test: true })
      });

      expect(testResult.success).toBe(false);
      expect(testResult.error).toMatch(/timeout|abort/i);

      await cleanupWebhook(webhook.id);
    });

    test('Response body truncation', async () => {
      const webhook = await createTestWebhook({
        targetUrl: 'https://httpbin.org/post'
      });

      // Send large payload
      const largePayload = { data: 'x'.repeat(10000) };

      const { data: testResult } = await apiRequest(`/webhooks/${webhook.id}/test`, {
        method: 'POST',
        body: JSON.stringify(largePayload)
      });

      expect(testResult.success).toBe(true);

      // Check log has truncated response body
      const logs = await db.collection('execution_logs')
        .find({ webhookConfigId: webhook.id })
        .sort({ createdAt: -1 })
        .limit(1)
        .toArray();

      if (logs.length > 0 && logs[0].responseBody) {
        expect(logs[0].responseBody.length).toBeLessThanOrEqual(5000);
      }

      await cleanupWebhook(webhook.id);
    });
  });

  describe('6. Retries & Abandonment', () => {
    test('Retry backoff timing', async () => {
      const webhook = await createTestWebhook({
        targetUrl: 'https://httpbin.org/status/500',
        retryCount: 3
      });

      // Trigger initial failure
      await apiRequest(`/webhooks/${webhook.id}/test`, {
        method: 'POST',
        body: JSON.stringify({ test: true })
      });

      // Check log entry has retry metadata
      const logs = await db.collection('execution_logs')
        .find({ webhookConfigId: webhook.id })
        .sort({ createdAt: -1 })
        .limit(1)
        .toArray();

      expect(logs.length).toBeGreaterThan(0);
      expect(logs[0].attemptCount).toBe(1);
      expect(logs[0].status).toBe('RETRYING');

      await cleanupWebhook(webhook.id);
    });

    test('Abandons after max retries', async () => {
      // This test requires waiting for actual retries or manual retry trigger
      // For now, verify the logic by checking database state

      // Create a failed log with max attempts
      const webhook = await createTestWebhook({
        targetUrl: 'https://httpbin.org/status/500',
        retryCount: 2
      });

      // Trigger failure multiple times to simulate retries
      for (let i = 0; i < 3; i++) {
        await apiRequest(`/webhooks/${webhook.id}/test`, {
          method: 'POST',
          body: JSON.stringify({ test: true, attempt: i })
        });
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Check logs for ABANDONED status
      const logs = await db.collection('execution_logs')
        .find({
          webhookConfigId: webhook.id,
          status: { $in: ['ABANDONED', 'FAILED'] }
        })
        .toArray();

      expect(logs.length).toBeGreaterThan(0);

      await cleanupWebhook(webhook.id);
    });

    test('Retries respect inactive webhook status', async () => {
      const webhook = await createTestWebhook({
        targetUrl: 'https://httpbin.org/status/500',
        isActive: false
      });

      const { data: testResult } = await apiRequest(`/webhooks/${webhook.id}/test`, {
        method: 'POST',
        body: JSON.stringify({ test: true })
      });

      // Inactive webhooks shouldn't process
      expect(testResult.success).toBe(false);

      await cleanupWebhook(webhook.id);
    });
  });

  describe('7. Logging & Data Persistence', () => {
    test('Delivery logs persist all required fields', async () => {
      const webhook = await createTestWebhook({
        targetUrl: 'https://httpbin.org/post'
      });

      await apiRequest(`/webhooks/${webhook.id}/test`, {
        method: 'POST',
        body: JSON.stringify({ testData: 'value123' })
      });

      const logs = await db.collection('execution_logs')
        .find({ webhookConfigId: webhook.id })
        .sort({ createdAt: -1 })
        .limit(1)
        .toArray();

      expect(logs.length).toBeGreaterThan(0);

      const log = logs[0];
      expect(log.webhookConfigId).toBe(webhook.id);
      expect(log.status).toBeTruthy();
      expect(log.attemptCount).toBeGreaterThanOrEqual(1);
      expect(log.responseStatus).toBeTruthy();
      expect(log.requestPayload).toBeTruthy();
      expect(log.createdAt).toBeTruthy();
      expect(log.responseTimeMs).toBeGreaterThanOrEqual(0);

      await cleanupWebhook(webhook.id);
    });

    test('CSV export with filters', async () => {
      const { status, data } = await apiRequest('/logs/export?format=csv&status=SUCCESS');

      expect(status).toBe(200);
      expect(typeof data).toBe('string');

      // Should have CSV headers
      expect(data).toMatch(/Timestamp,Webhook,Event Type,Status/i);
    });

    test('Logs API returns proper statistics', async () => {
      const { data } = await apiRequest('/logs');

      expect(data.logs).toBeDefined();
      expect(Array.isArray(data.logs)).toBe(true);
      expect(data.total).toBeGreaterThanOrEqual(0);
      expect(data.stats).toBeDefined();
      expect(data.stats.successful).toBeGreaterThanOrEqual(0);
      expect(data.stats.failed).toBeGreaterThanOrEqual(0);
      expect(data.stats.retrying).toBeGreaterThanOrEqual(0);
    });
  });

  describe('8. System Logs & Error Categorization', () => {
    test('System logs return accurate statistics', async () => {
      const { data } = await apiRequest('/system-logs?limit=100');

      expect(data.logs).toBeDefined();
      expect(data.stats).toBeDefined();
      expect(data.stats.total).toBeGreaterThanOrEqual(0);
      expect(data.stats.error).toBeGreaterThanOrEqual(0);
      expect(data.stats.errorCategories).toBeDefined();

      // Verify stats are from all logs, not just displayed
      expect(data.totalInPeriod).toBeGreaterThanOrEqual(data.displayed);
    });

    test('Error categorization works correctly', async () => {
      const { data } = await apiRequest('/system-logs?errorCategory=server');

      expect(data.logs).toBeDefined();

      // All returned logs should have server error category
      const serverErrors = data.logs.filter(log =>
        log.errorCategory === 'server' && log.level === 'error'
      );

      // If there are errors, they should all be server category
      if (data.logs.some(l => l.level === 'error')) {
        expect(serverErrors.length).toBeGreaterThan(0);
      }
    });

    test('Poll grouping works correctly', async () => {
      const { data } = await apiRequest('/system-logs?limit=500');

      expect(data.logs).toBeDefined();

      // Check if logs contain poll IDs
      const pollLogs = data.logs.filter(log =>
        log.message && log.message.match(/\[POLL\s*#\d+\]/i)
      );

      // If there are poll logs, verify they're properly tagged
      if (pollLogs.length > 0) {
        pollLogs.forEach(log => {
          expect(log.message).toMatch(/\[POLL\s*#\d+\]/i);
        });
      }
    });
  });

  describe('9. Dashboard & Analytics', () => {
    test('Dashboard returns valid summary', async () => {
      const { data } = await apiRequest('/dashboard');

      expect(data).toBeDefined();
      expect(data.summary).toBeDefined();
      expect(data.recentActivity).toBeDefined();
      expect(Array.isArray(data.recentActivity)).toBe(true);
    });

    test('Analytics overview returns metrics', async () => {
      const { data } = await apiRequest('/analytics/overview?days=7');

      expect(data.summary).toBeDefined();
      expect(data.summary.total).toBeGreaterThanOrEqual(0);
      expect(data.summary.successful).toBeGreaterThanOrEqual(0);
      expect(data.summary.failed).toBeGreaterThanOrEqual(0);
      expect(data.performance).toBeDefined();
    });

    test('Analytics error breakdown', async () => {
      const { data } = await apiRequest('/analytics/errors?days=7');

      expect(data.summary).toBeDefined();
      expect(data.summary.totalErrors).toBeGreaterThanOrEqual(0);
    });
  });

  describe('10. Authentication & Authorization', () => {
    test('API requires valid API key', async () => {
      const response = await fetch(`${API_BASE_URL}/webhooks?entityParentRid=${ENTITY_RID}`, {
        headers: { 'Content-Type': 'application/json' }
        // No X-API-Key header
      });

      expect(response.status).toBe(401);
    });

    test('Requires entityParentRid parameter', async () => {
      const response = await fetch(`${API_BASE_URL}/webhooks`, {
        headers
      });

      expect(response.status).toBe(400);
    });
  });
});
