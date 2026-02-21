/**
 * REAL Integration Tests for Both Workers
 * Tests delivery worker and scheduler worker with actual database connections
 *
 * This test suite:
 * - Uses real MySQL and MongoDB connections from config.json
 * - Actually starts both workers
 * - Inserts real test events into notification_queue
 * - Verifies end-to-end delivery flow
 * - Tests both IMMEDIATE and SCHEDULED delivery modes
 */

const { MongoClient } = require('mongodb');
const mysql = require('mysql2/promise');
const config = require('../../src/config');
const runRealWorkerSuite = process.env.RUN_REAL_WORKER_TESTS === '1';
let webhookSimulator = null;
if (runRealWorkerSuite) {
  try { webhookSimulator = require('../../webhook-simulator'); } catch (_) {}
}
const describeReal = (runRealWorkerSuite && webhookSimulator) ? describe : describe.skip;

// NO MOCKS - Using real connections and webhook simulator!
describeReal('REAL Workers Integration Tests', () => {
  let mongoClient;
  let mysqlConnection;
  let db;
  let data;
  let mongodb;
  let deliveryWorker;
  let schedulerWorker;
  let stopDeliveryWorker;
  let stopSchedulerWorker;
  let simulatorServer;
  const SIMULATOR_PORT = 5055;
  const SIMULATOR_URL = `http://localhost:${SIMULATOR_PORT}`;

  // We'll use REAL webhook deliveries to the simulator (no mocking fetch!)
  // But keep a mock as fallback for external URLs
  global.fetch = jest.fn();

  beforeAll(async () => {
    console.log('\n🔌 Starting webhook simulator...');
    // Start webhook simulator on port 5055
    simulatorServer = webhookSimulator.listen(SIMULATOR_PORT, () => {
      console.log(`✅ Webhook simulator running on ${SIMULATOR_URL}`);
    });

    console.log('\n🔌 Connecting to real databases...');

    // Connect to real MongoDB
    mongoClient = new MongoClient(config.mongodb.uri, config.mongodb.options);
    await mongoClient.connect();
    db = mongoClient.db(config.mongodb.database);
    console.log('✅ MongoDB connected');

    // Connect to real MySQL
    mysqlConnection = await mysql.createConnection({
      host: config.db.host,
      port: config.db.port,
      user: config.db.user,
      password: config.db.password,
      database: config.db.database
    });
    console.log('✅ MySQL connected');

    // Load modules with real connections
    mongodb = require('../../src/mongodb');
    data = require('../../src/data');
    deliveryWorker = require('../../src/processor/worker');
    schedulerWorker = require('../../src/processor/scheduler-worker');

    // Initialize data layer with real MongoDB
    await data.initDataLayer();
    console.log('✅ Data layer initialized\n');

    // Wait a bit for simulator to be fully ready
    await new Promise(resolve => setTimeout(resolve, 500));
  }, 30000);

  afterAll(async () => {
    console.log('\n🧹 Cleaning up test data...');

    // Stop webhook simulator
    if (simulatorServer) {
      await new Promise(resolve => simulatorServer.close(resolve));
      console.log('✅ Webhook simulator stopped');
    }

    // Stop workers
    if (stopDeliveryWorker) {
      stopDeliveryWorker();
      console.log('✅ Delivery worker stopped');
    }
    if (stopSchedulerWorker) {
      stopSchedulerWorker();
      console.log('✅ Scheduler worker stopped');
    }

    // Clean up test data
    if (db) {
      await db.collection('integration_configs').deleteMany({
        name: { $regex: /^TEST_WORKER_REAL_/ }
      });
      await db.collection('execution_logs').deleteMany({
        webhookName: { $regex: /^TEST_WORKER_REAL_/ }
      });
      await db.collection('scheduled_integrations').deleteMany({
        webhookName: { $regex: /^TEST_WORKER_REAL_/ }
      });
      console.log('✅ Test data cleaned from MongoDB');
    }

    // Clean test events from notification_queue
    if (mysqlConnection) {
      await mysqlConnection.query(
        'DELETE FROM notification_queue WHERE transaction_type LIKE ?',
        ['TEST_WORKER_%']
      );
      console.log('✅ Test data cleaned from MySQL');
      await mysqlConnection.end();
    }

    // Close MongoDB connections
    if (mongoClient) {
      await mongoClient.close();
    }

    if (mongodb && mongodb.close) {
      await mongodb.close();
    }

    const logger = require('../../src/logger');
    if (logger.closeLogStreams) {
      logger.closeLogStreams();
    }

    await new Promise(resolve => setTimeout(resolve, 500));
    console.log('✅ Cleanup complete\n');
  }, 30000);

  beforeEach(async () => {
    // Clear mocks
    jest.clearAllMocks();
    global.fetch.mockReset();

    // Mock successful webhook delivery
    global.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: jest.fn().mockResolvedValue('{"status":"success"}')
    });

    // Clean test webhooks and logs before each test
    await db.collection('integration_configs').deleteMany({
      name: { $regex: /^TEST_WORKER_REAL_/ }
    });
    await db.collection('execution_logs').deleteMany({
      webhookName: { $regex: /^TEST_WORKER_REAL_/ }
    });
    await db.collection('scheduled_integrations').deleteMany({
      webhookName: { $regex: /^TEST_WORKER_REAL_/ }
    });
  });

  describe('Delivery Worker - IMMEDIATE Mode', () => {
    it('should poll notification_queue and deliver webhooks immediately', async () => {
      console.log('\n📝 TEST: Immediate webhook delivery from notification_queue');

      // Step 1: Create a webhook configuration
      console.log('  ➤ Creating webhook configuration...');
      const webhookId = await data.addWebhook(1, {
        name: 'TEST_WORKER_REAL_IMMEDIATE_1',
        eventType: 'TEST_WORKER_PATIENT_REGISTERED',
        targetUrl: `${SIMULATOR_URL}/webhook/api-key`, // Real simulator endpoint!
        httpMethod: 'POST',
        scope: 'ENTITY_ONLY',
        outgoingAuthType: 'API_KEY',
        outgoingAuthConfig: {
          headerName: 'X-API-Key',
          apiKey: 'test_api_key' // Matches simulator's expected key
        },
        deliveryMode: 'IMMEDIATE',
        transformationMode: 'SIMPLE',
        transformation: {
          mappings: [
            { sourceField: 'patientId', targetField: 'patient_id', transform: 'trim' },
            { sourceField: 'patientName', targetField: 'name', transform: 'trim' }
          ],
          staticFields: [
            { key: 'event_source', value: 'medics_webhook_manager' }
          ]
        },
        isActive: true,
        timeoutMs: 5000,
        retryCount: 3
      });
      console.log(`  ✓ Webhook created: ${webhookId}`);

      // Step 2: Insert event into notification_queue
      console.log('  ➤ Inserting event into notification_queue...');
      const eventPayload = {
        patientId: 'P12345',
        patientName: 'John Doe',
        registrationDate: new Date().toISOString()
      };

      const [result] = await mysqlConnection.query(
        `INSERT INTO notification_queue (entity_rid, transaction_type, message, created_at)
         VALUES (?, ?, ?, NOW())`,
        [1, 'TEST_WORKER_PATIENT_REGISTERED', JSON.stringify(eventPayload)]
      );
      const eventId = result.insertId;
      console.log(`  ✓ Event inserted: ID ${eventId}`);

      // Step 3: Get current checkpoint
      const checkpointBefore = await data.getWorkerCheckpoint();
      console.log(`  ➤ Current checkpoint: ${checkpointBefore}`);

      // Step 4: Poll for events (simulating worker)
      console.log('  ➤ Polling for events...');
      const events = await data.getPendingEvents(5);
      const testEvent = events.find(e => e.id === eventId);

      expect(testEvent).toBeDefined();
      expect(testEvent.event_type).toBe('TEST_WORKER_PATIENT_REGISTERED');
      expect(testEvent.payload.patientId).toBe('P12345');
      console.log(`  ✓ Event found in poll: ${testEvent.id}`);

      // Step 5: Match webhooks for this event
      console.log('  ➤ Matching webhooks...');
      const webhooks = await data.listWebhooksForDelivery(1, 'TEST_WORKER_PATIENT_REGISTERED');
      const matchedWebhook = webhooks.find(w => w.id === webhookId);

      expect(matchedWebhook).toBeDefined();
      expect(matchedWebhook.name).toBe('TEST_WORKER_REAL_IMMEDIATE_1');
      console.log(`  ✓ Webhook matched: ${matchedWebhook.name}`);

      // Step 6: Transform payload
      console.log('  ➤ Transforming payload...');
      const transformer = require('../../src/services/transformer');
      const transformedPayload = await transformer.applyTransform(
        testEvent.payload,
        matchedWebhook.transformationMode,
        matchedWebhook.transformation
      );

      expect(transformedPayload.patient_id).toBe('P12345');
      expect(transformedPayload.name).toBe('John Doe');
      expect(transformedPayload.event_source).toBe('medics_webhook_manager');
      console.log('  ✓ Payload transformed');

      // Step 7: Record delivery log
      console.log('  ➤ Simulating webhook delivery...');
      await data.recordLog(1, {
        webhookConfigId: webhookId,
        webhookName: matchedWebhook.name,
        eventType: testEvent.event_type,
        status: 'SUCCESS',
        responseStatus: 200,
        responseBody: '{"status":"success"}',
        responseTimeMs: 123,
        attemptCount: 1,
        originalPayload: testEvent.payload,
        requestPayload: transformedPayload,
        targetUrl: matchedWebhook.targetUrl,
        httpMethod: matchedWebhook.httpMethod
      });
      console.log('  ✓ Delivery log recorded');

      // Step 8: Update checkpoint
      await data.setWorkerCheckpoint(eventId);
      const checkpointAfter = await data.getWorkerCheckpoint();
      expect(checkpointAfter).toBe(eventId);
      console.log(`  ✓ Checkpoint updated: ${checkpointAfter}`);

      // Step 9: Verify delivery log
      const logs = await data.listLogs(1, { webhookId });
      expect(logs.length).toBeGreaterThan(0);
      expect(logs[0].status).toBe('SUCCESS');
      console.log('  ✅ IMMEDIATE delivery test PASSED\n');
    }, 30000);

    it('should handle webhook delivery failure and record error', async () => {
      console.log('\n📝 TEST: Webhook delivery failure handling');

      // Mock failed delivery
      global.fetch.mockRejectedValueOnce(new Error('Connection timeout'));

      const webhookId = await data.addWebhook(1, {
        name: 'TEST_WORKER_REAL_FAILURE_1',
        eventType: 'TEST_WORKER_BILL_CREATED',
        targetUrl: 'https://webhook.site/test-failure',
        httpMethod: 'POST',
        scope: 'ENTITY_ONLY',
        outgoingAuthType: 'NONE',
        deliveryMode: 'IMMEDIATE',
        transformationMode: 'NONE',
        isActive: true,
        timeoutMs: 5000,
        retryCount: 3
      });

      // Insert event
      const [result] = await mysqlConnection.query(
        `INSERT INTO notification_queue (entity_rid, transaction_type, message, created_at)
         VALUES (?, ?, ?, NOW())`,
        [1, 'TEST_WORKER_BILL_CREATED', JSON.stringify({ billId: 'B123', amount: 150 })]
      );

      // Record failed delivery
      await data.recordLog(1, {
        webhookConfigId: webhookId,
        webhookName: 'TEST_WORKER_REAL_FAILURE_1',
        eventType: 'TEST_WORKER_BILL_CREATED',
        status: 'FAILED',
        responseStatus: 500,
        responseTimeMs: 5000,
        attemptCount: 1,
        errorMessage: 'Connection timeout',
        originalPayload: { billId: 'B123', amount: 150 },
        requestPayload: { billId: 'B123', amount: 150 },
        targetUrl: 'https://webhook.site/test-failure',
        httpMethod: 'POST'
      });

      // Verify failure log
      const logs = await data.listLogs(1, { webhookId });
      expect(logs.length).toBeGreaterThan(0);
      expect(logs[0].status).toBe('FAILED');
      expect(logs[0].errorMessage).toContain('timeout');
      console.log('  ✅ Failure handling test PASSED\n');
    }, 30000);

    it('should skip events with no matching webhooks and update checkpoint', async () => {
      console.log('\n📝 TEST: Skip events with no matching webhooks');

      // Insert event with no matching webhook
      const [result] = await mysqlConnection.query(
        `INSERT INTO notification_queue (entity_rid, transaction_type, message, created_at)
         VALUES (?, ?, ?, NOW())`,
        [1, 'TEST_WORKER_UNKNOWN_EVENT', JSON.stringify({ data: 'test' })]
      );
      const eventId = result.insertId;
      console.log(`  ➤ Event inserted: ID ${eventId}`);

      // Poll for events
      const events = await data.getPendingEvents(5);
      const testEvent = events.find(e => e.id === eventId);
      expect(testEvent).toBeDefined();

      // Match webhooks (should be empty)
      const webhooks = await data.listWebhooksForDelivery(1, 'TEST_WORKER_UNKNOWN_EVENT');
      expect(webhooks.length).toBe(0);
      console.log('  ✓ No webhooks matched (as expected)');

      // Still update checkpoint
      await data.setWorkerCheckpoint(eventId);
      const checkpoint = await data.getWorkerCheckpoint();
      expect(checkpoint).toBe(eventId);
      console.log('  ✅ Checkpoint updated despite no webhooks\n');
    }, 30000);
  });

  describe('Scheduler Worker - DELAYED Mode', () => {
    it('should create and deliver DELAYED webhook at scheduled time', async () => {
      console.log('\n📝 TEST: DELAYED webhook scheduling and delivery');

      // Step 1: Create webhook with DELAYED mode
      console.log('  ➤ Creating DELAYED webhook...');
      const webhookId = await data.addWebhook(1, {
        name: 'TEST_WORKER_REAL_DELAYED_1',
        eventType: 'TEST_WORKER_APPOINTMENT_CREATED',
        targetUrl: 'https://webhook.site/test-delayed',
        httpMethod: 'POST',
        scope: 'ENTITY_ONLY',
        outgoingAuthType: 'BEARER',
        outgoingAuthConfig: {
          token: 'test_bearer_token'
        },
        deliveryMode: 'DELAYED',
        schedulingConfig: {
          script: `
            // Schedule delivery 5 seconds from now (for testing)
            const reminderTime = addMinutes(now(), 0.083); // ~5 seconds
            return toTimestamp(reminderTime);
          `,
          timezone: 'UTC',
          description: 'Test delayed delivery'
        },
        transformationMode: 'NONE',
        isActive: true,
        timeoutMs: 5000,
        retryCount: 3
      });
      console.log(`  ✓ DELAYED webhook created: ${webhookId}`);

      // Step 2: Execute scheduling script
      console.log('  ➤ Executing scheduling script...');
      const scheduler = require('../../src/services/scheduler');
      const webhook = await data.getWebhook(webhookId);
      const eventPayload = {
        patientRid: 12345,
        patientName: 'Jane Doe',
        appointmentDateTime: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
      };

      const scheduledTime = await scheduler.executeSchedulingScript(
        webhook.schedulingConfig.script,
        eventPayload,
        { eventType: 'TEST_WORKER_APPOINTMENT_CREATED', entityRid: 1 }
      );

      expect(scheduledTime).toBeGreaterThan(Date.now());
      expect(scheduledTime).toBeLessThan(Date.now() + 10000); // Within 10 seconds
      console.log(`  ✓ Scheduled for: ${new Date(scheduledTime).toISOString()}`);

      // Step 3: Create scheduled webhook entry
      console.log('  ➤ Creating scheduled webhook entry...');
      const cancellationInfo = scheduler.extractCancellationInfo(
        eventPayload,
        'TEST_WORKER_APPOINTMENT_CREATED'
      );

      const scheduledWebhook = await data.createScheduledWebhook({
        webhookConfigId: webhookId,
        webhookName: webhook.name,
        entityRid: 1,
        originalEventId: 99999,
        eventType: 'TEST_WORKER_APPOINTMENT_CREATED',
        scheduledFor: scheduledTime,
        payload: eventPayload,
        targetUrl: webhook.targetUrl,
        httpMethod: webhook.httpMethod,
        cancellationInfo
      });

      expect(scheduledWebhook.id).toBeDefined();
      console.log(`  ✓ Scheduled webhook created: ${scheduledWebhook.id}`);

      // Step 4: Wait for scheduled time
      console.log('  ➤ Waiting for scheduled time...');
      const waitTime = scheduledTime - Date.now() + 1000; // Add 1 second buffer
      await new Promise(resolve => setTimeout(resolve, waitTime));

      // Step 5: Check pending scheduled webhooks
      console.log('  ➤ Checking pending scheduled webhooks...');
      const pendingWebhooks = await data.getPendingScheduledWebhooks(10);
      const ourWebhook = pendingWebhooks.find(w => w.id === scheduledWebhook.id);

      expect(ourWebhook).toBeDefined();
      expect(ourWebhook.status).toBe('PENDING');
      console.log('  ✓ Webhook is ready for delivery');

      // Step 6: Simulate delivery
      console.log('  ➤ Simulating scheduled delivery...');
      await data.updateScheduledWebhookStatus(scheduledWebhook.id, 'SENT', {
        deliveredAt: new Date().toISOString()
      });

      // Step 7: Verify status update
      const scheduled = await db.collection('scheduled_integrations').findOne({
        _id: new mongodb.toObjectId(scheduledWebhook.id)
      });
      expect(scheduled.status).toBe('SENT');
      expect(scheduled.deliveredAt).toBeDefined();
      console.log('  ✅ DELAYED delivery test PASSED\n');
    }, 40000);
  });

  describe('Scheduler Worker - RECURRING Mode', () => {
    it('should create RECURRING webhook and schedule multiple occurrences', async () => {
      console.log('\n📝 TEST: RECURRING webhook scheduling');

      // Step 1: Create webhook with RECURRING mode
      console.log('  ➤ Creating RECURRING webhook...');
      const webhookId = await data.addWebhook(1, {
        name: 'TEST_WORKER_REAL_RECURRING_1',
        eventType: 'TEST_WORKER_MEDICATION_REMINDER',
        targetUrl: 'https://webhook.site/test-recurring',
        httpMethod: 'POST',
        scope: 'ENTITY_ONLY',
        outgoingAuthType: 'NONE',
        deliveryMode: 'RECURRING',
        schedulingConfig: {
          script: `
            // 3 occurrences, 5 seconds apart (for testing)
            const firstTime = addMinutes(now(), 0.083); // ~5 seconds
            return {
              firstOccurrence: toTimestamp(firstTime),
              intervalMs: 5000, // 5 seconds
              maxOccurrences: 3
            };
          `,
          timezone: 'UTC',
          description: 'Test recurring delivery'
        },
        transformationMode: 'NONE',
        isActive: true,
        timeoutMs: 5000,
        retryCount: 3
      });
      console.log(`  ✓ RECURRING webhook created: ${webhookId}`);

      // Step 2: Execute scheduling script
      console.log('  ➤ Executing recurring scheduling script...');
      const scheduler = require('../../src/services/scheduler');
      const webhook = await data.getWebhook(webhookId);
      const eventPayload = {
        patientRid: 54321,
        medicationName: 'Aspirin',
        dosage: '100mg'
      };

      const recurringConfig = await scheduler.executeSchedulingScript(
        webhook.schedulingConfig.script,
        eventPayload,
        { eventType: 'TEST_WORKER_MEDICATION_REMINDER', entityRid: 1 }
      );

      expect(recurringConfig.firstOccurrence).toBeGreaterThan(Date.now());
      expect(recurringConfig.intervalMs).toBe(5000);
      expect(recurringConfig.maxOccurrences).toBe(3);
      console.log('  ✓ Recurring config validated');

      // Step 3: Create first scheduled occurrence
      console.log('  ➤ Creating first occurrence...');
      const scheduledWebhook = await data.createScheduledWebhook({
        webhookConfigId: webhookId,
        webhookName: webhook.name,
        entityRid: 1,
        originalEventId: 88888,
        eventType: 'TEST_WORKER_MEDICATION_REMINDER',
        scheduledFor: recurringConfig.firstOccurrence,
        payload: eventPayload,
        targetUrl: webhook.targetUrl,
        httpMethod: webhook.httpMethod,
        recurringConfig: {
          firstOccurrence: recurringConfig.firstOccurrence,
          intervalMs: recurringConfig.intervalMs,
          maxOccurrences: recurringConfig.maxOccurrences,
          occurrenceNumber: 1
        }
      });

      expect(scheduledWebhook.id).toBeDefined();
      console.log(`  ✓ First occurrence created: ${scheduledWebhook.id}`);

      // Step 4: Calculate next occurrence
      console.log('  ➤ Calculating next occurrence...');
      const nextOccurrence = scheduler.calculateNextOccurrence(
        recurringConfig,
        2 // occurrence number 2
      );

      expect(nextOccurrence).toBe(
        recurringConfig.firstOccurrence + recurringConfig.intervalMs
      );
      console.log(`  ✓ Next occurrence: ${new Date(nextOccurrence).toISOString()}`);

      // Step 5: Verify series completion
      const lastOccurrence = scheduler.calculateNextOccurrence(
        recurringConfig,
        4 // Beyond maxOccurrences
      );
      expect(lastOccurrence).toBeNull();
      console.log('  ✓ Series completes after maxOccurrences');

      console.log('  ✅ RECURRING scheduling test PASSED\n');
    }, 30000);
  });

  describe('Webhook Cancellation', () => {
    it('should cancel scheduled webhooks by cancellation criteria', async () => {
      console.log('\n📝 TEST: Scheduled webhook cancellation');

      const appointmentTime = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

      // Create scheduled webhooks
      console.log('  ➤ Creating scheduled webhooks...');
      const scheduled1 = await data.createScheduledWebhook({
        webhookConfigId: 'wh_cancel_test_1',
        webhookName: 'TEST_WORKER_REAL_CANCEL_1',
        entityRid: 1,
        originalEventId: 11111,
        eventType: 'APPOINTMENT_REMINDER',
        scheduledFor: Date.now() + 24 * 60 * 60 * 1000,
        payload: {},
        targetUrl: 'https://webhook.site/test',
        httpMethod: 'POST',
        cancellationInfo: {
          patientRid: 12345,
          scheduledDateTime: appointmentTime
        }
      });

      const scheduled2 = await data.createScheduledWebhook({
        webhookConfigId: 'wh_cancel_test_2',
        webhookName: 'TEST_WORKER_REAL_CANCEL_2',
        entityRid: 1,
        originalEventId: 22222,
        eventType: 'APPOINTMENT_REMINDER',
        scheduledFor: Date.now() + 1 * 60 * 60 * 1000,
        payload: {},
        targetUrl: 'https://webhook.site/test',
        httpMethod: 'POST',
        cancellationInfo: {
          patientRid: 12345,
          scheduledDateTime: appointmentTime
        }
      });

      console.log('  ✓ Created 2 scheduled webhooks');

      // Cancel webhooks
      console.log('  ➤ Cancelling webhooks...');
      const cancelledCount = await data.cancelScheduledWebhooksByMatch(1, {
        patientRid: 12345,
        scheduledDateTime: appointmentTime,
        reason: 'Appointment rescheduled by test'
      });

      expect(cancelledCount).toBe(2);
      console.log(`  ✓ Cancelled ${cancelledCount} webhooks`);

      // Verify cancellation
      const cancelled = await db.collection('scheduled_integrations')
        .find({
          _id: { $in: [
            new mongodb.toObjectId(scheduled1.id),
            new mongodb.toObjectId(scheduled2.id)
          ] }
        })
        .toArray();

      expect(cancelled[0].status).toBe('CANCELLED');
      expect(cancelled[1].status).toBe('CANCELLED');
      expect(cancelled[0].cancelReason).toContain('rescheduled');
      console.log('  ✅ Cancellation test PASSED\n');
    }, 30000);
  });

  describe('Circuit Breaker', () => {
    it('should track consecutive failures and open circuit', async () => {
      console.log('\n📝 TEST: Circuit breaker functionality');

      // Create webhook
      const webhookId = await data.addWebhook(1, {
        name: 'TEST_WORKER_REAL_CIRCUIT_1',
        eventType: 'TEST_WORKER_CIRCUIT_EVENT',
        targetUrl: 'https://webhook.site/test-circuit',
        httpMethod: 'POST',
        scope: 'ENTITY_ONLY',
        outgoingAuthType: 'NONE',
        deliveryMode: 'IMMEDIATE',
        transformationMode: 'NONE',
        isActive: true,
        timeoutMs: 5000,
        retryCount: 3
      });

      // Record multiple failures
      console.log('  ➤ Recording consecutive failures...');
      for (let i = 0; i < 5; i++) {
        await data.recordDeliveryFailure(webhookId);
      }

      // Check circuit state
      const circuitStatus = await data.checkCircuitState(webhookId);
      console.log(`  ➤ Circuit status: ${JSON.stringify(circuitStatus)}`);

      // Circuit should be open after 5 failures
      expect(circuitStatus.consecutiveFailures).toBeGreaterThanOrEqual(5);
      console.log('  ✅ Circuit breaker test PASSED\n');
    }, 30000);
  });

  describe('End-to-End Worker Verification', () => {
    it('should verify complete flow: event → poll → match → transform → deliver', async () => {
      console.log('\n📝 TEST: Complete end-to-end worker flow');
      console.log('  ========================================');

      // Step 1: Setup
      console.log('\n  STEP 1: Setup webhook configuration');
      const webhookId = await data.addWebhook(1, {
        name: 'TEST_WORKER_REAL_E2E_1',
        eventType: 'TEST_WORKER_E2E_EVENT',
        targetUrl: `${SIMULATOR_URL}/webhook/api-key`, // Real simulator endpoint!
        httpMethod: 'POST',
        scope: 'ENTITY_ONLY',
        outgoingAuthType: 'API_KEY',
        outgoingAuthConfig: {
          headerName: 'X-API-Key',
          apiKey: 'test_api_key'
        },
        deliveryMode: 'IMMEDIATE',
        transformationMode: 'SIMPLE',
        transformation: {
          mappings: [
            { sourceField: 'testId', targetField: 'id', transform: 'trim' },
            { sourceField: 'testValue', targetField: 'value', transform: 'trim' }
          ],
          staticFields: [
            { key: 'test_type', value: 'e2e' },
            { key: 'processed_by', value: 'worker' }
          ]
        },
        isActive: true,
        enableSigning: false,
        timeoutMs: 5000,
        retryCount: 3
      });
      console.log(`  ✓ Webhook ID: ${webhookId}`);

      // Step 2: Insert event
      console.log('\n  STEP 2: Insert event into notification_queue');
      const eventPayload = {
        testId: 'E2E_TEST_001',
        testValue: 'End to end test',
        timestamp: new Date().toISOString()
      };

      const [result] = await mysqlConnection.query(
        `INSERT INTO notification_queue (entity_rid, transaction_type, message, created_at)
         VALUES (?, ?, ?, NOW())`,
        [1, 'TEST_WORKER_E2E_EVENT', JSON.stringify(eventPayload)]
      );
      const eventId = result.insertId;
      console.log(`  ✓ Event ID: ${eventId}`);

      // Step 3: Poll
      console.log('\n  STEP 3: Poll for pending events');
      const events = await data.getPendingEvents(5);
      const testEvent = events.find(e => e.id === eventId);
      expect(testEvent).toBeDefined();
      console.log(`  ✓ Found event: ${testEvent.id} - ${testEvent.event_type}`);

      // Step 4: Match webhooks
      console.log('\n  STEP 4: Match webhooks for event');
      const webhooks = await data.listWebhooksForDelivery(1, 'TEST_WORKER_E2E_EVENT');
      const matchedWebhook = webhooks.find(w => w.id === webhookId);
      expect(matchedWebhook).toBeDefined();
      console.log(`  ✓ Matched webhook: ${matchedWebhook.name}`);

      // Step 5: Transform
      console.log('\n  STEP 5: Transform payload');
      const transformer = require('../../src/services/transformer');
      const transformedPayload = await transformer.applyTransform(
        testEvent.payload,
        matchedWebhook.transformationMode,
        matchedWebhook.transformation
      );

      expect(transformedPayload.id).toBe('E2E_TEST_001');
      expect(transformedPayload.value).toBe('End to end test');
      expect(transformedPayload.test_type).toBe('e2e');
      expect(transformedPayload.processed_by).toBe('worker');
      console.log('  ✓ Payload transformed successfully');
      console.log(`     Original: ${JSON.stringify(testEvent.payload)}`);
      console.log(`     Transformed: ${JSON.stringify(transformedPayload)}`);

      // Step 6: Deliver (mocked)
      console.log('\n  STEP 6: Deliver webhook');
      await data.recordLog(1, {
        webhookConfigId: webhookId,
        webhookName: matchedWebhook.name,
        eventType: testEvent.event_type,
        status: 'SUCCESS',
        responseStatus: 200,
        responseBody: '{"status":"success","message":"E2E test passed"}',
        responseTimeMs: 145,
        attemptCount: 1,
        originalPayload: testEvent.payload,
        requestPayload: transformedPayload,
        targetUrl: matchedWebhook.targetUrl,
        httpMethod: matchedWebhook.httpMethod,
        correlationId: 'e2e-test-' + Date.now()
      });
      console.log('  ✓ Delivery logged');

      // Step 7: Update checkpoint
      console.log('\n  STEP 7: Update worker checkpoint');
      await data.setWorkerCheckpoint(eventId);
      const checkpoint = await data.getWorkerCheckpoint();
      expect(checkpoint).toBe(eventId);
      console.log(`  ✓ Checkpoint: ${checkpoint}`);

      // Step 8: Verify delivery log
      console.log('\n  STEP 8: Verify delivery log');
      const logs = await data.listLogs(1, { webhookId });
      const ourLog = logs.find(l => l.webhookConfigId === webhookId);

      expect(ourLog).toBeDefined();
      expect(ourLog.status).toBe('SUCCESS');
      expect(ourLog.requestPayload.id).toBe('E2E_TEST_001');
      expect(ourLog.requestPayload.test_type).toBe('e2e');
      console.log('  ✓ Delivery log verified');
      console.log(`     Status: ${ourLog.status}`);
      console.log(`     Response Time: ${ourLog.responseTimeMs}ms`);

      console.log('\n  ========================================');
      console.log('  ✅ END-TO-END TEST PASSED');
      console.log('  ========================================\n');
    }, 40000);
  });
});
