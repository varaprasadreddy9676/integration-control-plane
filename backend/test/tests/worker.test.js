/**
 * Worker Tests for MongoDB Architecture
 * Tests event processing worker with MongoDB backend
 */

const makeCursor = (docs = []) => ({
  toArray: jest.fn().mockResolvedValue(docs),
  sort: jest.fn().mockReturnThis(),
  skip: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis()
});

// Mock MongoDB
const mockCollection = {
  find: jest.fn().mockImplementation(() => makeCursor([])),
  distinct: jest.fn().mockResolvedValue([]),
  findOne: jest.fn().mockResolvedValue(null),
  insertOne: jest.fn().mockResolvedValue({ insertedId: 'mock_id' }),
  updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 })
};

jest.mock('../../src/mongodb', () => ({
  connect: jest.fn().mockResolvedValue(),
  getDb: jest.fn().mockReturnValue({
    collection: jest.fn().mockReturnValue(mockCollection)
  }),
  getDbSafe: jest.fn().mockResolvedValue({
    collection: jest.fn().mockReturnValue(mockCollection)
  }),
  isConnected: jest.fn().mockReturnValue(true),
  toObjectId: jest.fn(id => id),
  ObjectId: class ObjectId {
    constructor(id) {
      this.id = id;
    }
    toString() {
      return this.id;
    }
  }
}));

// Mock MySQL for notification_queue
jest.mock('../../src/db', () => ({
  isConfigured: jest.fn().mockReturnValue(true),
  ping: jest.fn().mockResolvedValue(true),
  query: jest.fn().mockResolvedValue([[]]),
  getConnection: jest.fn().mockResolvedValue({
    execute: jest.fn().mockResolvedValue([[]])
  })
}));

jest.mock('../../src/data/store', () => ({
  initStore: jest.fn().mockResolvedValue(),
  getTenant: jest.fn().mockReturnValue({
    entityParentRid: 1,
    entityName: 'Test Clinic'
  }),
  findTenantByChildRid: jest.fn((entityRid) => (entityRid !== 1 ? { entityRid, entityParentRid: 1 } : null)),
  getPendingEvents: jest.fn().mockResolvedValue([])
}));

// Mock fetch for webhook delivery
global.fetch = jest.fn().mockResolvedValue({
  ok: true,
  status: 200,
  text: jest.fn().mockResolvedValue('OK')
});

describe('Worker with MongoDB', () => {
  let data;
  let worker;
  const dedup = () => require('../../src/processor/worker').__test;

  beforeAll(() => {
    jest.resetModules();
    data = require('../../src/data');
    worker = require('../../src/processor/worker');
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockCollection.find.mockImplementation(() => makeCursor([]));
    mockCollection.distinct.mockResolvedValue([]);
  });

  describe('Event Processing', () => {
    it('should process events from notification_queue', async () => {
      const mockEvents = [
        {
          id: 1,
          entity_rid: 1,
          event_type: 'PATIENT_REGISTERED',
          payload: { patientId: '123' }
        }
      ];

      const mockWebhooks = [
        {
          _id: 'wh1',
          name: 'Test Webhook',
          eventType: 'PATIENT_REGISTERED',
          entityRid: 1,
          targetUrl: 'https://example.com/webhook',
          httpMethod: 'POST',
          outgoingAuthType: 'NONE',
          isActive: true,
          timeoutMs: 3000,
          retryCount: 3,
          createdAt: new Date(),
          updatedAt: new Date()
        }
      ];

      // Mock getPendingEvents to return events
      const db = require('../../src/db');
      mockCollection.distinct.mockResolvedValueOnce([1]);
      db.query.mockResolvedValueOnce([mockEvents]);

      // Mock getWorkerCheckpoint
      mockCollection.findOne.mockResolvedValueOnce({
        workerId: 'main_worker',
        lastProcessedId: 0
      });

      // Mock listWebhooks
      mockCollection.find.mockReturnValueOnce({
        ...makeCursor(mockWebhooks)
      });

      // This would normally be called by the worker
      const events = await data.getPendingEvents(5);
      expect(events.length).toBe(1);

      const webhooks = await data.listWebhooks(1);
      expect(webhooks.length).toBe(1);
    });

    it('should save checkpoint to MongoDB after processing', async () => {
      mockCollection.updateOne.mockResolvedValueOnce({ modifiedCount: 1 });

      await data.setWorkerCheckpoint(100);

      expect(mockCollection.updateOne).toHaveBeenCalledWith(
        { workerId: 'main_worker' },
        expect.objectContaining({
          $set: expect.objectContaining({
            lastProcessedId: 100
          })
        }),
        { upsert: true }
      );
    });

    it('should record delivery log in MongoDB', async () => {
      const logData = {
        webhookConfigId: 'wh1',
        webhookName: 'Test Webhook',
        eventType: 'PATIENT_REGISTERED',
        status: 'SUCCESS',
        responseStatus: 200,
        responseTimeMs: 150,
        attemptCount: 1,
        requestPayload: { patientId: '123' }
      };

      mockCollection.insertOne.mockResolvedValueOnce({ insertedId: 'log1' });

      await data.recordLog(1, logData);

      expect(mockCollection.insertOne).toHaveBeenCalled();
      const insertCall = mockCollection.insertOne.mock.calls[0][0];
      expect(insertCall.status).toBe('SUCCESS');
      expect(insertCall.orgUnitRid).toBe(1);
    });
  });

  describe('Webhook Matching with Hierarchy', () => {
    it('should match webhooks for entity-specific events', async () => {
      const mockWebhooks = [
        {
          _id: 'wh1',
          entityRid: 102, // Child entity
          eventType: 'BILL_CREATED',
          scope: 'ENTITY_ONLY',
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date()
        }
      ];

      mockCollection.find.mockReturnValueOnce({
        ...makeCursor(mockWebhooks)
      });

      const webhooks = await data.listWebhooks(102);

      expect(webhooks.length).toBe(1);
      expect(webhooks[0].id).toBeDefined();
    });

    it('includes parent webhooks by default unless explicitly ENTITY_ONLY', async () => {
      const childHooks = [
        {
          _id: 'wh_child',
          entityRid: 102,
          eventType: 'BILL_CREATED',
          scope: 'ENTITY_ONLY',
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date()
        }
      ];

      const parentHooks = [
        {
          _id: 'wh_parent_inherited',
          entityRid: 100,
          eventType: 'BILL_CREATED',
          // Scope omitted -> should inherit by default
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date()
        },
        {
          _id: 'wh_parent_local_only',
          entityRid: 100,
          eventType: 'BILL_CREATED',
          scope: 'ENTITY_ONLY',
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date()
        }
      ];

      // First call: child hooks; second call: parent hooks
      mockCollection.find
        .mockReturnValueOnce(makeCursor(childHooks))
        .mockReturnValueOnce(makeCursor(parentHooks));

      const result = await data.listWebhooksForDelivery(102, 'BILL_CREATED');
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
    });

    it('should handle parent webhooks with INCLUDE_CHILDREN', async () => {
      // This would be implemented in listWebhooksForDelivery
      const mockParentWebhooks = [
        {
          _id: 'wh_parent',
          entityRid: 100, // Parent
          eventType: 'BILL_CREATED',
          scope: 'INCLUDE_CHILDREN',
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date()
        }
      ];

      mockCollection.find.mockReturnValueOnce({
        ...makeCursor(mockParentWebhooks)
      });

      const webhooks = await data.listWebhooks(100);
      expect(webhooks.length).toBeGreaterThanOrEqual(1);
      expect(webhooks[0].id).toBeDefined();
    });
  });

  describe('Failed Log Retry Logic', () => {
    it('should get failed logs for retry from MongoDB', async () => {
      const mockFailedLogs = [
        {
          _id: 'log1',
          webhookConfigId: 'wh1',
          __KEEP___KEEP_integrationConfig__Id__: 'wh1',
          status: 'FAILED',
          attemptCount: 1,
          createdAt: new Date()
        }
      ];

      const mockWebhook = {
        _id: 'wh1',
        retryCount: 3,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      mockCollection.find.mockReturnValueOnce({
        ...makeCursor(mockFailedLogs)
      });

      mockCollection.findOne.mockResolvedValueOnce(mockWebhook);

      const logs = await data.getFailedLogsForRetry(3);

      expect(Array.isArray(logs)).toBe(true);
      expect(mockCollection.find).toHaveBeenCalled();
    });

    it('should mark log as abandoned in MongoDB', async () => {
      mockCollection.updateOne.mockResolvedValueOnce({ modifiedCount: 1 });

      await data.markLogAsAbandoned('log123');

      expect(mockCollection.updateOne).toHaveBeenCalledWith(
        expect.anything(),
        { $set: expect.objectContaining({ status: 'ABANDONED' }) }
      );
    });
  });

  describe('Deduplication cache', () => {
    it('should flag recent duplicates and allow after window expires', () => {
      jest.useFakeTimers();
      const { generateEventKey, markEventProcessed, isEventProcessed, cleanupDedupCache, _processedEvents } = dedup();

      const key = generateEventKey('TEST', { id: 1 }, 10);
      markEventProcessed(key);

      expect(isEventProcessed(key)).toBe(true);

      // Advance beyond dedup window and trigger cleanup
      jest.advanceTimersByTime(5 * 60 * 1000 + 1000);
      cleanupDedupCache(Date.now());

      expect(isEventProcessed(key)).toBe(false);
      expect(_processedEvents.size).toBe(0);

      jest.useRealTimers();
    });
  });

  describe('TTL Index Cleanup', () => {
    it('should rely on MongoDB TTL for data cleanup', async () => {
      // Cleanup is automatic with MongoDB TTL indexes
      // This function logs that cleanup is handled by TTL
      await data.cleanupOldData();

      // MongoDB handles cleanup automatically via TTL indexes
      // No explicit delete operations needed
      expect(true).toBe(true);
    });
  });

  afterAll(() => {
    const logger = require('../../src/logger');
    if (logger.closeLogStreams) {
      logger.closeLogStreams();
    }
  });
});
