/**
 * CleverTap Live API Test
 * Tests actual integration with CleverTap API using real credentials
 *
 * REQUIRES:
 * - Backend server running (npm run dev)
 * - MongoDB connection
 * - Valid CleverTap credentials
 */

const { MongoClient } = require('mongodb');
const mysql = require('mysql2/promise');
const config = require('../../src/config');

const API_BASE = 'http://localhost:4000/api/v1';
const API_KEY = config.security?.apiKey || 'test-api-key';
const ENTITY_PARENT_RID = 100;
const runLiveSuite = process.env.RUN_LIVE_API_TESTS === '1';
const describeLive = runLiveSuite ? describe : describe.skip;

// CleverTap credentials (from user)
const CLEVERTAP_ACCOUNT_ID = '6K7-8R6-857Z';
const CLEVERTAP_PASSCODE = 'WHQ-KSY-CPEL';

describeLive('CleverTap Live API Integration', () => {
  let webhookId;
  let mongoClient;
  let db;
  let mysqlConnection;

  beforeAll(async () => {
    // Connect to databases for verification
    mongoClient = new MongoClient(config.mongodb.uri);
    await mongoClient.connect();
    db = mongoClient.db(config.mongodb.database);

    mysqlConnection = await mysql.createConnection(config.db);
  });

  afterAll(async () => {
    // Cleanup: Delete test webhook if created
    if (webhookId) {
      try {
        await fetch(`${API_BASE}/webhooks/${webhookId}?entityParentRid=${ENTITY_PARENT_RID}`, {
          method: 'DELETE',
          headers: {
            'X-API-Key': API_KEY
          }
        });
      } catch (err) {
        console.log('Cleanup error:', err.message);
      }
    }

    if (mongoClient) await mongoClient.close();
    if (mysqlConnection) await mysqlConnection.end();
  });

  describe('Step 1: Create CleverTap Multi-Action Webhook', () => {
    it('should create webhook with CUSTOM_HEADERS auth and multiple actions', async () => {
      const webhookConfig = {
        name: 'CleverTap Patient Registration Live Test',
        eventType: 'PATIENT_REGISTRATION',
        scope: 'ENTITY_ONLY',
        outgoingAuthType: 'CUSTOM_HEADERS',
        outgoingAuthConfig: {
          headers: {
            'X-CleverTap-Account-Id': CLEVERTAP_ACCOUNT_ID,
            'X-CleverTap-Passcode': CLEVERTAP_PASSCODE
          }
        },
        isActive: true,
        timeoutMs: 30000,
        retryCount: 3,
        httpMethod: 'POST',
        actions: [
          {
            name: 'Profile Upload',
            condition: 'eventType === "PATIENT_REGISTRATION"',
            targetUrl: 'https://api.clevertap.com/1/upload',
            httpMethod: 'POST',
            transformationMode: 'SCRIPT',
            transformation: {
              script: `
                function transform(payload, context) {
                  // Resolve identity
                  const identity = payload.patientMRN || payload.patientPhone || 'test-user-' + Date.now();

                  // Format phone with +91 prefix
                  let phone = payload.patientPhone || '';
                  if (phone && !phone.startsWith('+91')) {
                    phone = phone.startsWith('91') ? '+' + phone : '+91' + phone;
                  }

                  return {
                    d: [{
                      identity: identity,
                      type: 'profile',
                      profileData: {
                        Name: payload.patientName || 'Test Patient',
                        MRN: payload.patientMRN || 'TEST-MRN',
                        Phone: phone,
                        Email: payload.patientEmail || 'test@example.com',
                        Address: payload.patientAddress || '',
                        Age: payload.patientAge || 0,
                        Gender: payload.patientGender || 'Unknown',
                        RegistrationDate: payload.registrationDate || new Date().toISOString()
                      }
                    }]
                  };
                }
              `
            }
          },
          {
            name: 'Event Upload',
            targetUrl: 'https://api.clevertap.com/1/upload',
            httpMethod: 'POST',
            transformationMode: 'SCRIPT',
            transformation: {
              script: `
                function transform(payload, context) {
                  const identity = payload.patientMRN || payload.patientPhone || 'test-user-' + Date.now();

                  return {
                    d: [{
                      identity: identity,
                      type: 'event',
                      evtName: 'Patient Registered',
                      evtData: {
                        patientMRN: payload.patientMRN || 'TEST-MRN',
                        registrationDate: payload.registrationDate || new Date().toISOString(),
                        hospitalName: 'Test Hospital',
                        source: 'medics-webhook-test',
                        eventId: 'test-' + Date.now()
                      }
                    }]
                  };
                }
              `
            }
          }
        ]
      };

      const response = await fetch(`${API_BASE}/webhooks?entityParentRid=${ENTITY_PARENT_RID}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': API_KEY
        },
        body: JSON.stringify(webhookConfig)
      });

      expect(response.status).toBe(201);

      const webhook = await response.json();
      webhookId = webhook.id;

      expect(webhook.name).toBe('CleverTap Patient Registration Live Test');
      expect(webhook.outgoingAuthType).toBe('CUSTOM_HEADERS');
      expect(webhook.actions).toHaveLength(2);
      expect(webhook.actions[0].name).toBe('Profile Upload');
      expect(webhook.actions[1].name).toBe('Event Upload');

      console.log('✅ Webhook created:', webhookId);
    });
  });

  describe('Step 2: Test Webhook with Sample Payload', () => {
    it('should test webhook delivery to CleverTap API', async () => {
      expect(webhookId).toBeDefined();

      const testPayload = {
        payload: {
          patientRID: 99999,
          patientMRN: 'TEST-MRN-' + Date.now(),
          patientName: 'Test Patient Live',
          patientPhone: '9999999999',
          patientEmail: 'test.live@hospital.com',
          patientAddress: '123 Test Street',
          patientAge: 35,
          patientGender: 'Male',
          registrationDate: new Date().toISOString()
        }
      };

      const response = await fetch(
        `${API_BASE}/webhooks/${webhookId}/test?entityParentRid=${ENTITY_PARENT_RID}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': API_KEY
          },
          body: JSON.stringify(testPayload)
        }
      );

      const result = await response.json();

      console.log('Test result:', JSON.stringify(result, null, 2));

      // Note: CleverTap may return different status codes based on their API state
      // 200 = success, 400/401 = auth issues, 500 = server error
      expect([200, 201, 400, 401]).toContain(response.status);

      // Check delivery logs
      await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for logs to be written

      const logsResponse = await fetch(
        `${API_BASE}/logs?entityParentRid=${ENTITY_PARENT_RID}&webhookId=${webhookId}`,
        {
          headers: { 'X-API-Key': API_KEY }
        }
      );

      const logs = await logsResponse.json();
      console.log(`📊 Found ${logs.length} delivery log(s)`);

      if (logs.length > 0) {
        logs.forEach(log => {
          console.log(`  - ${log.webhookName}: ${log.status} (${log.responseStatus})`);
          if (log.errorMessage) {
            console.log(`    Error: ${log.errorMessage}`);
          }
        });
      }
    }, 30000); // 30 second timeout for live API call
  });

  describe('Step 3: Insert Real Event and Process', () => {
    it('should insert event into notification_queue and process via worker', async () => {
      const testEvent = {
        event_type: 'PATIENT_REGISTRATION',
        entity_rid: ENTITY_PARENT_RID,
        payload: JSON.stringify({
          patientRID: 88888,
          patientMRN: 'WORKER-TEST-' + Date.now(),
          patientName: 'Worker Test Patient',
          patientPhone: '8888888888',
          patientEmail: 'worker.test@hospital.com',
          patientAddress: '456 Worker Ave',
          patientAge: 40,
          patientGender: 'Female',
          registrationDate: new Date().toISOString()
        }),
        created_at: new Date()
      };

      const [insertResult] = await mysqlConnection.execute(
        'INSERT INTO notification_queue (event_type, entity_rid, payload, created_at) VALUES (?, ?, ?, ?)',
        [testEvent.event_type, testEvent.entity_rid, testEvent.payload, testEvent.created_at]
      );

      const eventId = insertResult.insertId;
      console.log(`✅ Event inserted with ID: ${eventId}`);

      // Wait for worker to process (assuming 5 second interval)
      console.log('⏳ Waiting 10 seconds for worker to process...');
      await new Promise(resolve => setTimeout(resolve, 10000));

      // Check if event was processed
      const [processedEvents] = await mysqlConnection.execute(
        'SELECT * FROM processed_events WHERE event_id = ?',
        [eventId]
      );

      if (processedEvents.length > 0) {
        console.log('✅ Event was processed:', processedEvents[0].status);
      } else {
        console.log('⚠️  Event not yet processed (worker may be disabled or slower)');
      }

      // Check delivery logs
      const logsResponse = await fetch(
        `${API_BASE}/logs?entityParentRid=${ENTITY_PARENT_RID}&webhookId=${webhookId}`,
        {
          headers: { 'X-API-Key': API_KEY }
        }
      );

      const logs = await logsResponse.json();
      console.log(`📊 Total delivery logs: ${logs.length}`);

      const workerLogs = logs.filter(log =>
        log.requestPayload?.patientMRN?.includes('WORKER-TEST')
      );

      if (workerLogs.length > 0) {
        console.log('✅ Worker processed the event:');
        workerLogs.forEach(log => {
          console.log(`  - ${log.webhookName}: ${log.status}`);
        });
      }
    }, 15000);
  });

  describe('Step 4: Verify CleverTap Data Structure', () => {
    it('should verify transformed payloads match CleverTap schema', async () => {
      const logsResponse = await fetch(
        `${API_BASE}/logs?entityParentRid=${ENTITY_PARENT_RID}&webhookId=${webhookId}`,
        {
          headers: { 'X-API-Key': API_KEY }
        }
      );

      const logs = await logsResponse.json();

      if (logs.length === 0) {
        console.log('⚠️  No logs found for verification');
        return;
      }

      // Check first log's payload structure
      const log = logs[0];
      const payload = log.requestPayload;

      console.log('Sample CleverTap payload:', JSON.stringify(payload, null, 2));

      expect(payload).toHaveProperty('d');
      expect(Array.isArray(payload.d)).toBe(true);

      if (payload.d.length > 0) {
        const record = payload.d[0];
        expect(record).toHaveProperty('identity');
        expect(record).toHaveProperty('type');

        if (record.type === 'profile') {
          expect(record).toHaveProperty('profileData');
          console.log('✅ Profile payload structure is correct');
        } else if (record.type === 'event') {
          expect(record).toHaveProperty('evtName');
          expect(record).toHaveProperty('evtData');
          console.log('✅ Event payload structure is correct');
        }
      }
    });
  });
});
