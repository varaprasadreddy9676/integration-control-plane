/**
 * E2E Tests for Scheduling Workflow
 * Tests DELAYED and RECURRING webhook scheduling, script execution, and cancellation
 */

const { MongoClient, ObjectId } = require('mongodb');
const config = require('../../src/config');
const runRealDbSuite = process.env.RUN_REAL_DB_TESTS === '1';
const describeRealDb = runRealDbSuite ? describe : describe.skip;

// Mock MySQL since we can't connect
jest.mock('../../src/db', () => ({
  isConfigured: jest.fn().mockReturnValue(true),
  ping: jest.fn().mockResolvedValue(true),
  query: jest.fn().mockResolvedValue([[]]),
  getConnection: jest.fn().mockResolvedValue({
    execute: jest.fn().mockResolvedValue([[]]),
    release: jest.fn()
  })
}));

// Mock store
jest.mock('../../src/data/store', () => ({
  initStore: jest.fn().mockResolvedValue(),
  getTenant: jest.fn().mockReturnValue({
    entityParentRid: 1,
    entityName: 'Test Clinic'
  })
}));

// Mock fetch for webhook deliveries
global.fetch = jest.fn();

describeRealDb('E2E: Scheduling Workflow', () => {
  let mongoClient;
  let db;
  let data;
  let mongodb;
  let scheduler;

  beforeAll(async () => {
    // Connect to real MongoDB
    mongoClient = new MongoClient(config.mongodb.uri);
    await mongoClient.connect();
    db = mongoClient.db(config.mongodb.database);

    // Load modules
    mongodb = require('../../src/mongodb');
    data = require('../../src/data');
    scheduler = require('../../src/services/scheduler');

    // Initialize data layer with real MongoDB
    await data.initDataLayer();
  });

  afterAll(async () => {
    // Clean up test data
    if (db) {
      await db.collection('integration_configs').deleteMany({
        name: { $regex: /^TEST_SCHED_/ }
      });
      await db.collection('scheduled_integrations').deleteMany({
        webhookName: { $regex: /^TEST_SCHED_/ }
      });
      await db.collection('execution_logs').deleteMany({
        webhookName: { $regex: /^TEST_SCHED_/ }
      });
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

    await new Promise(resolve => setTimeout(resolve, 100));
  }, 10000);

  beforeEach(async () => {
    // Clear mocks
    jest.clearAllMocks();
    global.fetch.mockReset();

    // Clear test data before each test
    await db.collection('integration_configs').deleteMany({
      name: { $regex: /^TEST_SCHED_/ }
    });
    await db.collection('scheduled_integrations').deleteMany({
      webhookName: { $regex: /^TEST_SCHED_/ }
    });
  });

  describe('DELAYED Webhook Scheduling', () => {
    it('should create webhook with DELAYED mode and scheduling script', async () => {
      const webhookData = {
        name: 'TEST_SCHED_DELAYED_APPOINTMENT',
        eventType: 'APPOINTMENT_CREATED',
        targetUrl: 'https://api.example.com/reminders',
        httpMethod: 'POST',
        scope: 'ENTITY_ONLY',
        outgoingAuthType: 'API_KEY',
        outgoingAuthConfig: {
          headerName: 'X-API-Key',
          apiKey: 'test_key_123'
        },
        deliveryMode: 'DELAYED',
        schedulingConfig: {
          script: `
            // Send reminder 24 hours before appointment
            const appointmentTime = parseDate(event.appointmentDateTime);
            const reminderTime = subtractHours(appointmentTime, 24);
            return toTimestamp(reminderTime);
          `,
          timezone: 'UTC',
          description: 'Send reminder 24 hours before appointment'
        },
        transformationMode: 'SIMPLE',
        transformation: {
          mappings: [
            { sourceField: 'patientName', targetField: 'patient', transform: 'trim' },
            { sourceField: 'appointmentDateTime', targetField: 'scheduled_time', transform: 'date' }
          ],
          staticFields: [
            { key: 'reminderType', value: 'appointment' }
          ]
        },
        isActive: true,
        timeoutMs: 5000,
        retryCount: 3
      };

      const webhookId = await data.addWebhook(1, webhookData);
      expect(webhookId).toBeDefined();

      // Verify webhook in MongoDB
      const webhook = await db.collection('integration_configs').findOne({
        _id: new ObjectId(webhookId)
      });

      expect(webhook).toBeDefined();
      expect(webhook.name).toBe('TEST_SCHED_DELAYED_APPOINTMENT');
      expect(webhook.deliveryMode).toBe('DELAYED');
      expect(webhook.schedulingConfig).toBeDefined();
      expect(webhook.schedulingConfig.script).toContain('24 hours before');
      expect(webhook.schedulingConfig.timezone).toBe('UTC');
    });

    it('should execute scheduling script and create scheduled webhook entry', async () => {
      // Create webhook with DELAYED mode
      const webhookId = await data.addWebhook(1, {
        name: 'TEST_SCHED_DELAYED_REMINDER',
        eventType: 'APPOINTMENT_CREATED',
        targetUrl: 'https://api.example.com/reminders',
        httpMethod: 'POST',
        scope: 'ENTITY_ONLY',
        outgoingAuthType: 'NONE',
        deliveryMode: 'DELAYED',
        schedulingConfig: {
          script: `
            const appointmentTime = parseDate(event.appointmentDateTime);
            const reminderTime = subtractHours(appointmentTime, 1);
            return toTimestamp(reminderTime);
          `
        },
        transformationMode: 'NONE',
        isActive: true,
        timeoutMs: 5000,
        retryCount: 3
      });

      const webhook = await data.getWebhook(webhookId);

      // Test event payload
      const eventPayload = {
        patientRid: 12345,
        patientName: 'John Doe',
        appointmentDateTime: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString() // 2 hours from now
      };

      // Execute scheduling script
      const scheduledTime = await scheduler.executeSchedulingScript(
        webhook.schedulingConfig.script,
        eventPayload,
        {
          eventType: 'APPOINTMENT_CREATED',
          entityRid: 1,
          webhookConfig: webhook
        }
      );

      // Should return a timestamp 1 hour from now (2 hours - 1 hour)
      expect(typeof scheduledTime).toBe('number');
      expect(scheduledTime).toBeGreaterThan(Date.now());
      expect(scheduledTime).toBeLessThan(Date.now() + 2 * 60 * 60 * 1000);

      // Create scheduled webhook entry
      const scheduledWebhook = await data.createScheduledWebhook({
        webhookConfigId: webhookId,
        webhookName: webhook.name,
        entityRid: 1,
        originalEventId: 999,
        eventType: 'APPOINTMENT_CREATED',
        scheduledFor: scheduledTime,
        payload: eventPayload,
        targetUrl: webhook.targetUrl,
        httpMethod: webhook.httpMethod,
        cancellationInfo: {
          patientRid: 12345,
          scheduledDateTime: eventPayload.appointmentDateTime
        }
      });

      expect(scheduledWebhook).toBeDefined();
      expect(scheduledWebhook.id).toBeDefined();

      // Verify in scheduled_integrations collection
      const scheduledDoc = await db.collection('scheduled_integrations').findOne({
        _id: new ObjectId(scheduledWebhook.id)
      });

      expect(scheduledDoc).toBeDefined();
      expect(scheduledDoc.status).toBe('PENDING');
      expect(scheduledDoc.webhookName).toBe('TEST_SCHED_DELAYED_REMINDER');
      expect(scheduledDoc.entityRid).toBe(1);
      expect(scheduledDoc.originalEventId).toBe(999);
      expect(scheduledDoc.cancellationInfo).toBeDefined();
      expect(scheduledDoc.cancellationInfo.patientRid).toBe(12345);
    });

    it('should validate scheduled time is in the future', async () => {
      const eventPayload = {
        appointmentDateTime: new Date(Date.now() - 1000).toISOString() // Past time
      };

      const script = `
        const appointmentTime = parseDate(event.appointmentDateTime);
        return toTimestamp(appointmentTime);
      `;

      await expect(scheduler.executeSchedulingScript(
        script,
        eventPayload,
        { eventType: 'APPOINTMENT_CREATED', entityRid: 1 }
      )).rejects.toThrow('Scheduled time must be in the future');
    });

    it('should validate scheduled time is not more than 1 year in future', async () => {
      const eventPayload = {
        appointmentDateTime: new Date(Date.now() + 400 * 24 * 60 * 60 * 1000).toISOString() // 400 days
      };

      const script = `
        const appointmentTime = parseDate(event.appointmentDateTime);
        return toTimestamp(appointmentTime);
      `;

      await expect(scheduler.executeSchedulingScript(
        script,
        eventPayload,
        { eventType: 'APPOINTMENT_CREATED', entityRid: 1 }
      )).rejects.toThrow('Scheduled time cannot be more than 1 year in the future');
    });
  });

  describe('RECURRING Webhook Scheduling', () => {
    it('should create webhook with RECURRING mode', async () => {
      const webhookData = {
        name: 'TEST_SCHED_RECURRING_FOLLOWUP',
        eventType: 'PATIENT_REGISTERED',
        targetUrl: 'https://api.example.com/followups',
        httpMethod: 'POST',
        scope: 'ENTITY_ONLY',
        outgoingAuthType: 'BEARER',
        outgoingAuthConfig: {
          token: 'test_token_123'
        },
        deliveryMode: 'RECURRING',
        schedulingConfig: {
          script: `
            // Send follow-ups at day 1, 7, 14, and 30
            const registrationTime = now();
            const firstFollowup = addDays(registrationTime, 1);

            return {
              firstOccurrence: toTimestamp(firstFollowup),
              intervalMs: 7 * 24 * 60 * 60 * 1000, // 7 days
              maxOccurrences: 4
            };
          `,
          timezone: 'UTC',
          description: 'Follow-up reminders at 1, 7, 14, and 30 days'
        },
        transformationMode: 'NONE',
        isActive: true,
        timeoutMs: 5000,
        retryCount: 3
      };

      const webhookId = await data.addWebhook(1, webhookData);
      expect(webhookId).toBeDefined();

      // Verify webhook
      const webhook = await db.collection('integration_configs').findOne({
        _id: new ObjectId(webhookId)
      });

      expect(webhook.deliveryMode).toBe('RECURRING');
      expect(webhook.schedulingConfig.script).toContain('maxOccurrences');
    });

    it('should execute recurring scheduling script and validate config', async () => {
      const eventPayload = {
        patientRid: 54321,
        patientName: 'Jane Smith',
        registrationDate: new Date().toISOString()
      };

      const script = `
        const firstReminder = addDays(now(), 1);
        return {
          firstOccurrence: toTimestamp(firstReminder),
          intervalMs: 24 * 60 * 60 * 1000, // 1 day
          maxOccurrences: 5
        };
      `;

      const result = await scheduler.executeSchedulingScript(
        script,
        eventPayload,
        { eventType: 'PATIENT_REGISTERED', entityRid: 1 }
      );

      expect(result).toBeDefined();
      expect(result.firstOccurrence).toBeGreaterThan(Date.now());
      expect(result.intervalMs).toBe(24 * 60 * 60 * 1000);
      expect(result.maxOccurrences).toBe(5);
    });

    it('should create scheduled webhook with recurring config', async () => {
      const webhookId = await data.addWebhook(1, {
        name: 'TEST_SCHED_RECURRING_DAILY',
        eventType: 'PATIENT_REGISTERED',
        targetUrl: 'https://api.example.com/daily',
        httpMethod: 'POST',
        scope: 'ENTITY_ONLY',
        outgoingAuthType: 'NONE',
        deliveryMode: 'RECURRING',
        schedulingConfig: {
          script: `
            return {
              firstOccurrence: toTimestamp(addHours(now(), 2)),
              intervalMs: 60 * 60 * 1000, // 1 hour
              maxOccurrences: 3
            };
          `
        },
        transformationMode: 'NONE',
        isActive: true
      });

      const webhook = await data.getWebhook(webhookId);
      const eventPayload = { patientRid: 999 };

      const recurringConfig = await scheduler.executeSchedulingScript(
        webhook.schedulingConfig.script,
        eventPayload,
        { eventType: 'PATIENT_REGISTERED', entityRid: 1 }
      );

      const scheduledWebhook = await data.createScheduledWebhook({
        webhookConfigId: webhookId,
        webhookName: webhook.name,
        entityRid: 1,
        originalEventId: 888,
        eventType: 'PATIENT_REGISTERED',
        scheduledFor: recurringConfig.firstOccurrence,
        payload: eventPayload,
        targetUrl: webhook.targetUrl,
        httpMethod: webhook.httpMethod,
        recurringConfig: {
          intervalMs: recurringConfig.intervalMs,
          maxOccurrences: recurringConfig.maxOccurrences,
          occurrenceNumber: 1
        }
      });

      // Verify scheduled webhook
      const scheduledDoc = await db.collection('scheduled_integrations').findOne({
        _id: new ObjectId(scheduledWebhook.id)
      });

      expect(scheduledDoc.recurringConfig).toBeDefined();
      expect(scheduledDoc.recurringConfig.intervalMs).toBe(60 * 60 * 1000);
      expect(scheduledDoc.recurringConfig.maxOccurrences).toBe(3);
      expect(scheduledDoc.recurringConfig.occurrenceNumber).toBe(1);
    });

    it('should validate recurring config has valid firstOccurrence', async () => {
      const script = `
        return {
          firstOccurrence: Date.now() - 1000, // Past time
          intervalMs: 60000,
          maxOccurrences: 3
        };
      `;

      await expect(scheduler.executeSchedulingScript(
        script,
        {},
        { eventType: 'TEST', entityRid: 1 }
      )).rejects.toThrow('First occurrence must be in the future');
    });

    it('should validate recurring config has valid intervalMs', async () => {
      const script = `
        return {
          firstOccurrence: toTimestamp(addHours(now(), 1)),
          intervalMs: 30000, // Less than 1 minute
          maxOccurrences: 3
        };
      `;

      await expect(scheduler.executeSchedulingScript(
        script,
        {},
        { eventType: 'TEST', entityRid: 1 }
      )).rejects.toThrow('intervalMs must be at least 60000 (1 minute)');
    });

    it('should validate recurring config has end condition', async () => {
      const script = `
        return {
          firstOccurrence: toTimestamp(addHours(now(), 1)),
          intervalMs: 60000
          // Missing maxOccurrences or endDate
        };
      `;

      await expect(scheduler.executeSchedulingScript(
        script,
        {},
        { eventType: 'TEST', entityRid: 1 }
      )).rejects.toThrow('must have either maxOccurrences or endDate');
    });

    it('should calculate next occurrence for recurring webhook', () => {
      const recurringConfig = {
        firstOccurrence: Date.now() + 60000,
        intervalMs: 60000, // 1 minute
        maxOccurrences: 5
      };

      // Calculate occurrence 1 (first)
      const firstOccurrence = scheduler.calculateNextOccurrence(recurringConfig, 1);
      expect(firstOccurrence).toBe(recurringConfig.firstOccurrence);

      // Calculate occurrence 2
      const secondOccurrence = scheduler.calculateNextOccurrence(recurringConfig, 2);
      expect(secondOccurrence).toBe(recurringConfig.firstOccurrence + recurringConfig.intervalMs);

      // Calculate occurrence 3
      const thirdOccurrence = scheduler.calculateNextOccurrence(recurringConfig, 3);
      expect(thirdOccurrence).toBe(recurringConfig.firstOccurrence + (recurringConfig.intervalMs * 2));

      // Calculate occurrence 6 (past max of 5)
      const pastMax = scheduler.calculateNextOccurrence(recurringConfig, 6);
      expect(pastMax).toBeNull();
    });
  });

  describe('Scheduled Webhook Cancellation', () => {
    it('should cancel scheduled webhooks by patient and datetime match', async () => {
      // Create two scheduled webhooks for the same patient/appointment
      const appointmentTime = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

      await data.createScheduledWebhook({
        webhookConfigId: 'wh_123',
        webhookName: 'TEST_SCHED_CANCEL_1',
        entityRid: 1,
        originalEventId: 100,
        eventType: 'APPOINTMENT_CREATED',
        scheduledFor: Date.now() + 23 * 60 * 60 * 1000,
        payload: {},
        targetUrl: 'https://example.com/webhook1',
        httpMethod: 'POST',
        cancellationInfo: {
          patientRid: 12345,
          scheduledDateTime: appointmentTime
        }
      });

      await data.createScheduledWebhook({
        webhookConfigId: 'wh_124',
        webhookName: 'TEST_SCHED_CANCEL_2',
        entityRid: 1,
        originalEventId: 101,
        eventType: 'APPOINTMENT_CREATED',
        scheduledFor: Date.now() + 1 * 60 * 60 * 1000,
        payload: {},
        targetUrl: 'https://example.com/webhook2',
        httpMethod: 'POST',
        cancellationInfo: {
          patientRid: 12345,
          scheduledDateTime: appointmentTime
        }
      });

      // Cancel webhooks matching criteria
      const cancelledCount = await data.cancelScheduledWebhooksByMatch(1, {
        patientRid: 12345,
        scheduledDateTime: appointmentTime,
        reason: 'Appointment rescheduled'
      });

      expect(cancelledCount).toBe(2);

      // Verify webhooks are cancelled
      const cancelledWebhooks = await db.collection('scheduled_integrations')
        .find({
          webhookName: { $regex: /^TEST_SCHED_CANCEL_/ },
          status: 'CANCELLED'
        })
        .toArray();

      expect(cancelledWebhooks).toHaveLength(2);
      expect(cancelledWebhooks[0].cancelReason).toContain('Appointment rescheduled');
      expect(cancelledWebhooks[0].cancelledAt).toBeDefined();
    });

    it('should not cancel already delivered or cancelled webhooks', async () => {
      // Create webhooks with different statuses
      await data.createScheduledWebhook({
        webhookConfigId: 'wh_125',
        webhookName: 'TEST_SCHED_NO_CANCEL_1',
        entityRid: 1,
        originalEventId: 102,
        eventType: 'APPOINTMENT_CREATED',
        scheduledFor: Date.now() + 1 * 60 * 60 * 1000,
        payload: {},
        targetUrl: 'https://example.com/webhook',
        httpMethod: 'POST',
        cancellationInfo: { patientRid: 99999 }
      });

      // Manually mark as delivered
      await db.collection('scheduled_integrations').updateOne(
        { webhookName: 'TEST_SCHED_NO_CANCEL_1' },
        { $set: { status: 'DELIVERED' } }
      );

      // Try to cancel
      const cancelledCount = await data.cancelScheduledWebhooksByMatch(1, {
        patientRid: 99999
      });

      expect(cancelledCount).toBe(0); // Should not cancel DELIVERED webhooks
    });

    it('should extract cancellation info from event payload', () => {
      const eventPayload = {
        patientRid: 12345,
        scheduledDateTime: '2024-12-15T10:00:00Z',
        doctorId: 'D123'
      };

      const cancellationInfo = scheduler.extractCancellationInfo(
        eventPayload,
        'APPOINTMENT_RESCHEDULED'
      );

      expect(cancellationInfo).toBeDefined();
      expect(cancellationInfo.patientRid).toBe(12345);
      expect(cancellationInfo.scheduledDateTime).toBe('2024-12-15T10:00:00Z');
    });

    it('should handle alternate field names for cancellation info', () => {
      const eventPayload = {
        patient_rid: 54321, // Alternate field name
        appointment_date_time: '2024-12-20T14:00:00Z' // Alternate field name
      };

      const cancellationInfo = scheduler.extractCancellationInfo(
        eventPayload,
        'APPOINTMENT_CANCELLED'
      );

      expect(cancellationInfo).toBeDefined();
      expect(cancellationInfo.patientRid).toBe(54321);
      expect(cancellationInfo.scheduledDateTime).toBe('2024-12-20T14:00:00Z');
    });
  });

  describe('Listing Scheduled Webhooks', () => {
    it('should list scheduled webhooks with filters', async () => {
      // Create multiple scheduled webhooks
      await data.createScheduledWebhook({
        webhookConfigId: 'wh_200',
        webhookName: 'TEST_SCHED_LIST_1',
        entityRid: 1,
        originalEventId: 200,
        eventType: 'APPOINTMENT_CREATED',
        scheduledFor: Date.now() + 1 * 60 * 60 * 1000,
        payload: {},
        targetUrl: 'https://example.com/webhook',
        httpMethod: 'POST'
      });

      await data.createScheduledWebhook({
        webhookConfigId: 'wh_201',
        webhookName: 'TEST_SCHED_LIST_2',
        entityRid: 1,
        originalEventId: 201,
        eventType: 'BILL_CREATED',
        scheduledFor: Date.now() + 2 * 60 * 60 * 1000,
        payload: {},
        targetUrl: 'https://example.com/webhook',
        httpMethod: 'POST'
      });

      // List all scheduled webhooks for entity
      const allScheduled = await data.listScheduledWebhooks(1);
      const testWebhooks = allScheduled.filter(w => w.webhookName.startsWith('TEST_SCHED_LIST_'));
      expect(testWebhooks.length).toBeGreaterThanOrEqual(2);

      // Filter by event type
      const appointmentWebhooks = await data.listScheduledWebhooks(1, {
        eventType: 'APPOINTMENT_CREATED'
      });
      const testAppointments = appointmentWebhooks.filter(w => w.webhookName.startsWith('TEST_SCHED_LIST_'));
      expect(testAppointments.length).toBeGreaterThanOrEqual(1);

      // Filter by status
      const pendingWebhooks = await data.listScheduledWebhooks(1, {
        status: 'PENDING'
      });
      expect(pendingWebhooks.length).toBeGreaterThan(0);
    });

    it('should get pending scheduled webhooks ready for delivery', async () => {
      // Create webhook scheduled in the past (ready for delivery)
      await data.createScheduledWebhook({
        webhookConfigId: 'wh_300',
        webhookName: 'TEST_SCHED_READY_1',
        entityRid: 1,
        originalEventId: 300,
        eventType: 'APPOINTMENT_CREATED',
        scheduledFor: Date.now() - 5000, // 5 seconds ago
        payload: { test: 'data' },
        targetUrl: 'https://example.com/webhook',
        httpMethod: 'POST'
      });

      // Create webhook scheduled in the future (not ready)
      await data.createScheduledWebhook({
        webhookConfigId: 'wh_301',
        webhookName: 'TEST_SCHED_FUTURE_1',
        entityRid: 1,
        originalEventId: 301,
        eventType: 'APPOINTMENT_CREATED',
        scheduledFor: Date.now() + 60 * 60 * 1000, // 1 hour from now
        payload: { test: 'data' },
        targetUrl: 'https://example.com/webhook',
        httpMethod: 'POST'
      });

      // Get pending webhooks ready for delivery
      const readyWebhooks = await data.getPendingScheduledWebhooks(10);
      const testReady = readyWebhooks.filter(w => w.webhookName === 'TEST_SCHED_READY_1');

      expect(testReady.length).toBeGreaterThanOrEqual(1);
      expect(testReady[0].status).toBe('PENDING');
      expect(new Date(testReady[0].scheduledFor).getTime()).toBeLessThanOrEqual(Date.now());

      // Future webhook should not be in results
      const testFuture = readyWebhooks.filter(w => w.webhookName === 'TEST_SCHED_FUTURE_1');
      expect(testFuture.length).toBe(0);
    });
  });
});
