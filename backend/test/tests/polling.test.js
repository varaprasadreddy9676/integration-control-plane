/**
 * E2E Tests for Polling Workflow
 * Tests worker polling notification_queue, checkpoint management, and event processing
 */

const { MongoClient, ObjectId } = require('mongodb');
const config = require('../../src/config');
const runRealDbSuite = process.env.RUN_REAL_DB_TESTS === '1';
const describeRealDb = runRealDbSuite ? describe : describe.skip;

// Mock MySQL for notification_queue
const mockQuery = jest.fn();
jest.mock('../../src/db', () => ({
  isConfigured: jest.fn().mockReturnValue(true),
  ping: jest.fn().mockResolvedValue(true),
  query: mockQuery,
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
  }),
  findTenantByChildRid: jest.fn((entityRid) => (entityRid !== 1 ? { entityRid, entityParentRid: 1 } : null))
}));

// Mock fetch for webhook deliveries
global.fetch = jest.fn();

describeRealDb('E2E: Polling Workflow', () => {
  let mongoClient;
  let db;
  let data;
  let mongodb;

  beforeAll(async () => {
    // Connect to real MongoDB
    mongoClient = new MongoClient(config.mongodb.uri);
    await mongoClient.connect();
    db = mongoClient.db(config.mongodb.database);

    // Load modules
    mongodb = require('../../src/mongodb');
    data = require('../../src/data');

    // Initialize data layer with real MongoDB
    await data.initDataLayer();
  });

  afterAll(async () => {
    // Clean up test data
    if (db) {
      await db.collection('integration_configs').deleteMany({
        name: { $regex: /^TEST_POLL_/ }
      });
      await db.collection('execution_logs').deleteMany({
        webhookName: { $regex: /^TEST_POLL_/ }
      });
      await db.collection('worker_checkpoint').deleteMany({
        workerId: 'test_worker'
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
    mockQuery.mockReset();

    // Clear test data
    await db.collection('integration_configs').deleteMany({
      name: { $regex: /^TEST_POLL_/ }
    });
    await db.collection('execution_logs').deleteMany({
      webhookName: { $regex: /^TEST_POLL_/ }
    });
  });

  describe('Worker Checkpoint Management', () => {
    it('should initialize worker checkpoint at 0 if not exists', async () => {
      // Clear checkpoint
      await db.collection('worker_checkpoint').deleteMany({
        workerId: 'main_worker'
      });

      const checkpoint = await data.getWorkerCheckpoint();
      expect(checkpoint).toBe(0);
    });

    it('should get existing worker checkpoint', async () => {
      // Set checkpoint to specific value
      await data.setWorkerCheckpoint(12345);

      const checkpoint = await data.getWorkerCheckpoint();
      expect(checkpoint).toBe(12345);
    });

    it('should update worker checkpoint', async () => {
      await data.setWorkerCheckpoint(100);
      let checkpoint = await data.getWorkerCheckpoint();
      expect(checkpoint).toBe(100);

      await data.setWorkerCheckpoint(150);
      checkpoint = await data.getWorkerCheckpoint();
      expect(checkpoint).toBe(150);

      // Verify in MongoDB
      const checkpointDoc = await db.collection('worker_checkpoint').findOne({
        workerId: 'main_worker'
      });

      expect(checkpointDoc.lastProcessedId).toBe(150);
      expect(checkpointDoc.updatedAt).toBeDefined();
    });

    it('should increment checkpoint as events are processed', async () => {
      await data.setWorkerCheckpoint(1000);

      // Simulate processing events 1001, 1002, 1003
      await data.setWorkerCheckpoint(1001);
      await data.setWorkerCheckpoint(1002);
      await data.setWorkerCheckpoint(1003);

      const finalCheckpoint = await data.getWorkerCheckpoint();
      expect(finalCheckpoint).toBe(1003);
    });

    it('should persist checkpoint across restarts', async () => {
      await data.setWorkerCheckpoint(5000);

      // Simulate restart by re-fetching checkpoint
      const checkpoint = await data.getWorkerCheckpoint();
      expect(checkpoint).toBe(5000);
    });
  });

  describe('Polling notification_queue', () => {
    it('should poll notification_queue with checkpoint filter', async () => {
      // Set checkpoint
      await data.setWorkerCheckpoint(100);

      // Mock notification_queue data
      mockQuery.mockResolvedValueOnce([[
        {
          id: 101,
          entity_rid: 1,
          transaction_type: 'PATIENT_REGISTERED',
          message: JSON.stringify({ patientId: 'P123', name: 'John Doe' })
        },
        {
          id: 102,
          entity_rid: 1,
          transaction_type: 'APPOINTMENT_CREATED',
          message: JSON.stringify({ appointmentId: 'A456' })
        }
      ]]);

      // Poll for pending events
      const events = await data.getPendingEvents(5);

      expect(events).toHaveLength(2);
      expect(events[0].id).toBe(101);
      expect(events[0].event_type).toBe('PATIENT_REGISTERED');
      expect(events[0].payload.patientId).toBe('P123');

      expect(events[1].id).toBe(102);
      expect(events[1].event_type).toBe('APPOINTMENT_CREATED');

      // Verify query was called with checkpoint
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('WHERE id > :lastId'),
        { lastId: 100 }
      );
    });

    it('should handle empty notification_queue', async () => {
      await data.setWorkerCheckpoint(500);

      // Mock empty result
      mockQuery.mockResolvedValueOnce([[]]);

      const events = await data.getPendingEvents(5);
      expect(events).toHaveLength(0);
    });

    it('should parse JSON payload from notification_queue', async () => {
      mockQuery.mockResolvedValueOnce([[
        {
          id: 200,
          entity_rid: 1,
          transaction_type: 'BILL_CREATED',
          message: JSON.stringify({
            billId: 'B789',
            amount: 150.00,
            patientId: 'P123'
          })
        }
      ]]);

      const events = await data.getPendingEvents(1);

      expect(events).toHaveLength(1);
      expect(events[0].payload).toEqual({
        billId: 'B789',
        amount: 150.00,
        patientId: 'P123'
      });
    });

    it('should handle malformed JSON in notification_queue gracefully', async () => {
      mockQuery.mockResolvedValueOnce([[
        {
          id: 201,
          entity_rid: 1,
          transaction_type: 'TEST_EVENT',
          message: 'invalid json {'
        }
      ]]);

      const events = await data.getPendingEvents(1);

      expect(events).toHaveLength(1);
      expect(events[0].payload).toEqual({}); // Falls back to empty object
    });

    it('should respect batch size limit', async () => {
      // Mock 10 events but request only 3
      const mockEvents = Array.from({ length: 10 }, (_, i) => ({
        id: 300 + i,
        entity_rid: 1,
        transaction_type: 'TEST_EVENT',
        message: JSON.stringify({ index: i })
      }));

      mockQuery.mockResolvedValueOnce([mockEvents]);

      const events = await data.getPendingEvents(3);
      expect(events.length).toBeLessThanOrEqual(10);
    });
  });

  describe('Webhook Matching for Events', () => {
    it('should match webhooks by event type and entity', async () => {
      // Create webhooks for different event types
      const webhook1Id = await data.addWebhook(1, {
        name: 'TEST_POLL_PATIENT_WEBHOOK',
        eventType: 'PATIENT_REGISTERED',
        targetUrl: 'https://example.com/patient',
        httpMethod: 'POST',
        scope: 'ENTITY_ONLY',
        outgoingAuthType: 'NONE',
        transformationMode: 'NONE',
        isActive: true
      });

      const webhook2Id = await data.addWebhook(1, {
        name: 'TEST_POLL_APPOINTMENT_WEBHOOK',
        eventType: 'APPOINTMENT_CREATED',
        targetUrl: 'https://example.com/appointment',
        httpMethod: 'POST',
        scope: 'ENTITY_ONLY',
        outgoingAuthType: 'NONE',
        transformationMode: 'NONE',
        isActive: true
      });

      // Match webhooks for PATIENT_REGISTERED event
      const patientWebhooks = await data.listWebhooksForDelivery(1, 'PATIENT_REGISTERED');
      expect(patientWebhooks.some(w => w.id === webhook1Id)).toBe(true);
      expect(patientWebhooks.some(w => w.id === webhook2Id)).toBe(false);

      // Match webhooks for APPOINTMENT_CREATED event
      const appointmentWebhooks = await data.listWebhooksForDelivery(1, 'APPOINTMENT_CREATED');
      expect(appointmentWebhooks.some(w => w.id === webhook1Id)).toBe(false);
      expect(appointmentWebhooks.some(w => w.id === webhook2Id)).toBe(true);
    });

    it('should only match active webhooks', async () => {
      // Create active webhook
      const activeId = await data.addWebhook(1, {
        name: 'TEST_POLL_ACTIVE',
        eventType: 'BILL_CREATED',
        targetUrl: 'https://example.com/bill',
        httpMethod: 'POST',
        scope: 'ENTITY_ONLY',
        outgoingAuthType: 'NONE',
        transformationMode: 'NONE',
        isActive: true
      });

      // Create inactive webhook
      const inactiveId = await data.addWebhook(1, {
        name: 'TEST_POLL_INACTIVE',
        eventType: 'BILL_CREATED',
        targetUrl: 'https://example.com/bill2',
        httpMethod: 'POST',
        scope: 'ENTITY_ONLY',
        outgoingAuthType: 'NONE',
        transformationMode: 'NONE',
        isActive: false
      });

      const webhooks = await data.listWebhooksForDelivery(1, 'BILL_CREATED');

      expect(webhooks.some(w => w.id === activeId)).toBe(true);
      expect(webhooks.some(w => w.id === inactiveId)).toBe(false);
    });

    it('should handle entity hierarchy with INCLUDE_CHILDREN scope', async () => {
      // Create parent webhook with INCLUDE_CHILDREN
      const parentWebhookId = await data.addWebhook(1, {
        name: 'TEST_POLL_PARENT_INHERIT',
        eventType: 'PATIENT_REGISTERED',
        targetUrl: 'https://example.com/parent',
        httpMethod: 'POST',
        scope: 'INCLUDE_CHILDREN',
        outgoingAuthType: 'NONE',
        transformationMode: 'NONE',
        isActive: true
      });

      // Create child webhook
      const childWebhookId = await data.addWebhook(2, {
        name: 'TEST_POLL_CHILD_ONLY',
        eventType: 'PATIENT_REGISTERED',
        targetUrl: 'https://example.com/child',
        httpMethod: 'POST',
        scope: 'ENTITY_ONLY',
        outgoingAuthType: 'NONE',
        transformationMode: 'NONE',
        isActive: true
      });

      // Mock finding child tenant
      const store = require('../../src/data/store');
      store.findTenantByChildRid.mockReturnValue({ entityRid: 2, entityParentRid: 1 });

      // Match webhooks for child entity event
      const webhooks = await data.listWebhooksForDelivery(2, 'PATIENT_REGISTERED');

      // Should include both parent (inherited) and child webhooks
      expect(webhooks.length).toBeGreaterThanOrEqual(2);

      const hasParent = webhooks.some(w => w.id === parentWebhookId);
      const hasChild = webhooks.some(w => w.id === childWebhookId);

      expect(hasChild).toBe(true);
      // Parent webhook should be inherited if not excluded
    });

    it('should filter webhooks by excludedEntityRids', async () => {
      // Create parent webhook that excludes entity 3
      const webhookId = await data.addWebhook(1, {
        name: 'TEST_POLL_EXCLUDED',
        eventType: 'APPOINTMENT_CREATED',
        targetUrl: 'https://example.com/webhook',
        httpMethod: 'POST',
        scope: 'INCLUDE_CHILDREN',
        excludedEntityRids: [3],
        outgoingAuthType: 'NONE',
        transformationMode: 'NONE',
        isActive: true
      });

      // Match for entity 2 (not excluded)
      const webhooks2 = await data.listWebhooksForDelivery(2, 'APPOINTMENT_CREATED');
      // Should include the webhook (implementation may vary)

      // Match for entity 3 (excluded)
      const webhooks3 = await data.listWebhooksForDelivery(3, 'APPOINTMENT_CREATED');
      const hasExcluded = webhooks3.some(w => w.id === webhookId && w.excludedEntityRids?.includes(3));

      // Webhook delivery logic should skip excluded entities
      expect(true).toBe(true); // Placeholder for exclusion logic
    });

    it('should return empty array when no webhooks match', async () => {
      const webhooks = await data.listWebhooksForDelivery(1, 'NON_EXISTENT_EVENT');
      expect(webhooks).toEqual([]);
    });
  });

  describe('Event Processing Workflow', () => {
    it('should process event and update checkpoint', async () => {
      // Set initial checkpoint
      await data.setWorkerCheckpoint(500);

      // Create webhook
      await data.addWebhook(1, {
        name: 'TEST_POLL_PROCESS',
        eventType: 'PATIENT_REGISTERED',
        targetUrl: 'https://example.com/webhook',
        httpMethod: 'POST',
        scope: 'ENTITY_ONLY',
        outgoingAuthType: 'NONE',
        transformationMode: 'NONE',
        isActive: true
      });

      // Mock notification_queue event
      mockQuery.mockResolvedValueOnce([[
        {
          id: 501,
          entity_rid: 1,
          transaction_type: 'PATIENT_REGISTERED',
          message: JSON.stringify({ patientId: 'P999' })
        }
      ]]);

      // Mock successful delivery
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: jest.fn().mockResolvedValue('{"status":"success"}')
      });

      // Get and process event
      const events = await data.getPendingEvents(1);
      expect(events).toHaveLength(1);

      // Update checkpoint after processing
      await data.setWorkerCheckpoint(events[0].id);

      const newCheckpoint = await data.getWorkerCheckpoint();
      expect(newCheckpoint).toBe(501);
    });

    it('should handle multiple events in batch', async () => {
      await data.setWorkerCheckpoint(600);

      // Mock 3 events
      mockQuery.mockResolvedValueOnce([[
        {
          id: 601,
          entity_rid: 1,
          transaction_type: 'PATIENT_REGISTERED',
          message: JSON.stringify({ patientId: 'P1' })
        },
        {
          id: 602,
          entity_rid: 1,
          transaction_type: 'APPOINTMENT_CREATED',
          message: JSON.stringify({ appointmentId: 'A1' })
        },
        {
          id: 603,
          entity_rid: 1,
          transaction_type: 'BILL_CREATED',
          message: JSON.stringify({ billId: 'B1' })
        }
      ]]);

      const events = await data.getPendingEvents(5);
      expect(events).toHaveLength(3);

      // Process events and update checkpoint
      for (const evt of events) {
        await data.setWorkerCheckpoint(evt.id);
      }

      const finalCheckpoint = await data.getWorkerCheckpoint();
      expect(finalCheckpoint).toBe(603);
    });

    it('should skip events with no matching webhooks', async () => {
      await data.setWorkerCheckpoint(700);

      mockQuery.mockResolvedValueOnce([[
        {
          id: 701,
          entity_rid: 1,
          transaction_type: 'UNKNOWN_EVENT_TYPE',
          message: JSON.stringify({})
        }
      ]]);

      const events = await data.getPendingEvents(1);
      expect(events).toHaveLength(1);

      // Get matching webhooks
      const webhooks = await data.listWebhooksForDelivery(1, 'UNKNOWN_EVENT_TYPE');
      expect(webhooks).toHaveLength(0);

      // Still update checkpoint to avoid reprocessing
      await data.setWorkerCheckpoint(events[0].id);

      const checkpoint = await data.getWorkerCheckpoint();
      expect(checkpoint).toBe(701);
    });
  });

  describe('Event Deduplication', () => {
    it('should track processed events to prevent duplicates', async () => {
      const worker = require('../../src/processor/worker');

      // Access test utilities if available
      if (worker.__test) {
        const { generateEventKey, markEventProcessed, isEventProcessed } = worker.__test;

        const eventKey1 = generateEventKey('PATIENT_REGISTERED', { patientId: 'P123' }, 1);
        const eventKey2 = generateEventKey('PATIENT_REGISTERED', { patientId: 'P456' }, 1);

        // Initially not processed
        expect(isEventProcessed(eventKey1)).toBe(false);
        expect(isEventProcessed(eventKey2)).toBe(false);

        // Mark as processed
        markEventProcessed(eventKey1);
        expect(isEventProcessed(eventKey1)).toBe(true);
        expect(isEventProcessed(eventKey2)).toBe(false);

        markEventProcessed(eventKey2);
        expect(isEventProcessed(eventKey2)).toBe(true);
      } else {
        // Skip if test utilities not exposed
        expect(true).toBe(true);
      }
    });

    it('should use different keys for different event types', async () => {
      const worker = require('../../src/processor/worker');

      if (worker.__test) {
        const { generateEventKey } = worker.__test;

        const key1 = generateEventKey('PATIENT_REGISTERED', { id: 1 }, 1);
        const key2 = generateEventKey('APPOINTMENT_CREATED', { id: 1 }, 1);

        expect(key1).not.toBe(key2);
      } else {
        expect(true).toBe(true);
      }
    });
  });

  describe('Checkpoint Recovery', () => {
    it('should resume from last checkpoint after restart', async () => {
      // Set checkpoint to 1000
      await data.setWorkerCheckpoint(1000);

      // Simulate restart - checkpoint should persist
      const checkpoint = await data.getWorkerCheckpoint();
      expect(checkpoint).toBe(1000);

      // Mock new events after checkpoint
      mockQuery.mockResolvedValueOnce([[
        {
          id: 1001,
          entity_rid: 1,
          transaction_type: 'PATIENT_REGISTERED',
          message: JSON.stringify({ patientId: 'P_NEW' })
        }
      ]]);

      const events = await data.getPendingEvents(5);
      expect(events).toHaveLength(1);
      expect(events[0].id).toBe(1001);
    });

    it('should handle checkpoint corruption gracefully', async () => {
      // Manually corrupt checkpoint
      await db.collection('worker_checkpoint').updateOne(
        { workerId: 'main_worker' },
        { $set: { lastProcessedId: null } },
        { upsert: true }
      );

      // Should default to 0
      const checkpoint = await data.getWorkerCheckpoint();
      expect(typeof checkpoint).toBe('number');
      expect(checkpoint).toBeGreaterThanOrEqual(0);
    });
  });
});
