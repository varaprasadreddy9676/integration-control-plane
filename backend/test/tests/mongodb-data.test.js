/**
 * MongoDB Data Layer Tests
 * Tests for hybrid MongoDB + MySQL architecture
 */

// Mock MongoDB
const mockCollection = {
  find: jest.fn().mockReturnValue({
    toArray: jest.fn().mockResolvedValue([]),
    sort: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis()
  }),
  findOne: jest.fn().mockResolvedValue(null),
  insertOne: jest.fn().mockResolvedValue({ insertedId: 'mock_object_id' }),
  updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
  deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }),
  aggregate: jest.fn().mockReturnValue({
    toArray: jest.fn().mockResolvedValue([])
  })
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
  toObjectId: jest.fn(id => ({ toString: () => id })),
  ObjectId: class ObjectId {
    constructor(id) {
      this.id = id;
    }
    toString() {
      return this.id;
    }
  }
}));

// Mock MySQL (for notification_queue only)
jest.mock('../../src/db', () => ({
  isConfigured: jest.fn().mockReturnValue(true),
  ping: jest.fn().mockResolvedValue(true),
  query: jest.fn().mockResolvedValue([[]]),
  getConnection: jest.fn().mockResolvedValue({
    execute: jest.fn().mockResolvedValue([[]])
  })
}));

// Mock store fallback
jest.mock('../../src/data/store', () => ({
  initStore: jest.fn().mockResolvedValue(),
  getTenant: jest.fn().mockReturnValue({
    entityParentRid: 1,
    entityName: 'Test Clinic'
  }),
  findTenantByChildRid: jest.fn().mockReturnValue(null)
}));

describe('MongoDB Data Layer', () => {
  let data;
  let mongodb;

  beforeAll(() => {
    jest.resetModules();
    data = require('../../src/data');
    mongodb = require('../../src/mongodb');
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Initialization', () => {
    it('should initialize data layer with MongoDB connection', async () => {
      await data.initDataLayer();

      expect(mongodb.connect).toHaveBeenCalled();
    });
  });

  describe('Webhook CRUD Operations', () => {
    it('should create webhook in MongoDB', async () => {
      const webhookData = {
        name: 'Test Webhook',
        eventType: 'PATIENT_REGISTERED',
        targetUrl: 'https://example.com/webhook',
        httpMethod: 'POST',
        scope: 'ENTITY_ONLY',
        outgoingAuthType: 'NONE',
        isActive: true,
        timeoutMs: 3000,
        retryCount: 3
      };

      mockCollection.insertOne.mockResolvedValueOnce({
        insertedId: 'new_webhook_id'
      });

      const result = await data.addWebhook(1, webhookData);

      expect(mockCollection.insertOne).toHaveBeenCalled();
      const insertCall = mockCollection.insertOne.mock.calls[0][0];
      expect(insertCall.name).toBe('Test Webhook');
      expect(insertCall.eventType).toBe('PATIENT_REGISTERED');
      expect(insertCall.outgoingAuthType).toBe('NONE');
      expect(insertCall.orgUnitRid).toBe(1);
    });

    it('should list webhooks from MongoDB', async () => {
      const mockWebhooks = [
        {
          _id: 'wh1',
          name: 'Webhook 1',
          eventType: 'PATIENT_REGISTERED',
          entityRid: 1,
          outgoingAuthType: 'NONE',
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date()
        }
      ];

      mockCollection.find.mockReturnValueOnce({
        sort: jest.fn().mockReturnThis(),
        toArray: jest.fn().mockResolvedValue(mockWebhooks)
      });

      const result = await data.listWebhooks(1);

      expect(mockCollection.find).toHaveBeenCalledWith({ orgId: 1 });
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(1);
      expect(result[0].name).toBe('Webhook 1');
    });

    it('should get webhook by ID from MongoDB', async () => {
      const mockWebhook = {
        _id: 'wh123',
        name: 'Test Webhook',
        eventType: 'PATIENT_REGISTERED',
        entityRid: 1,
        outgoingAuthType: 'API_KEY',
        createdAt: new Date(),
        updatedAt: new Date()
      };

      mockCollection.findOne.mockResolvedValueOnce(mockWebhook);

      const result = await data.getWebhook('wh123');

      expect(mockCollection.findOne).toHaveBeenCalled();
      expect(result.name).toBe('Test Webhook');
    });

    it('should update webhook in MongoDB', async () => {
      const mockWebhook = {
        _id: 'wh123',
        name: 'Updated Webhook',
        eventType: 'PATIENT_REGISTERED',
        entityRid: 1,
        isActive: false,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      mockCollection.updateOne.mockResolvedValueOnce({ modifiedCount: 1 });
      mockCollection.findOne.mockResolvedValueOnce(mockWebhook);

      const result = await data.updateWebhook(1, 'wh123', {
        name: 'Updated Webhook',
        isActive: false
      });

      expect(mockCollection.updateOne).toHaveBeenCalled();
      expect(mockCollection.findOne).toHaveBeenCalled();
    });

    it('should delete webhook from MongoDB', async () => {
      mockCollection.deleteOne.mockResolvedValueOnce({ deletedCount: 1 });

      const result = await data.deleteWebhook(1, 'wh123');

      expect(mockCollection.deleteOne).toHaveBeenCalledWith({
        _id: expect.anything(),
        orgId: 1
      });
      expect(result).toBe(true);
    });
  });

  describe('Delivery Log Operations', () => {
    it('should record delivery log in MongoDB', async () => {
      const logData = {
        webhookConfigId: 'wh123',
        webhookName: 'Test Webhook',
        eventType: 'PATIENT_REGISTERED',
        status: 'SUCCESS',
        responseStatus: 200,
        responseTimeMs: 150,
        attemptCount: 1,
        requestPayload: { patientId: '123' }
      };

      mockCollection.insertOne.mockResolvedValueOnce({ insertedId: 'log123' });

      const result = await data.recordLog(1, logData);

      expect(mockCollection.insertOne).toHaveBeenCalled();
      const insertCall = mockCollection.insertOne.mock.calls[0][0];
      expect(insertCall.status).toBe('SUCCESS');
      expect(insertCall.requestPayload).toEqual({ patientId: '123' }); // Native object, not stringified!
    });

    it('should list logs from MongoDB', async () => {
      const mockLogs = [
        {
          _id: 'log1',
          webhookConfigId: 'wh123',
          status: 'SUCCESS',
          eventType: 'PATIENT_REGISTERED',
          createdAt: new Date()
        }
      ];

      mockCollection.find.mockReturnValueOnce({
        sort: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
        toArray: jest.fn().mockResolvedValue(mockLogs)
      });

      const result = await data.listLogs(1, {});

      expect(mockCollection.find).toHaveBeenCalledWith({ orgId: 1 });
      expect(result.length).toBe(1);
    });

    it('should filter logs by status', async () => {
      mockCollection.find.mockReturnValueOnce({
        sort: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
        toArray: jest.fn().mockResolvedValue([])
      });

      await data.listLogs(1, { status: 'FAILED' });

      expect(mockCollection.find).toHaveBeenCalledWith({
        orgId: 1,
        status: 'FAILED'
      });
    });
  });

  describe('Dashboard Summary with Aggregation', () => {
    it('should get dashboard stats using MongoDB aggregation', async () => {
      const mockStats = [
        {
          _id: null,
          total: 100,
          successful: 95,
          failed: 5,
          avgResponseTime: 250
        }
      ];

      mockCollection.aggregate.mockReturnValueOnce({
        toArray: jest.fn().mockResolvedValue(mockStats)
      });

      mockCollection.find.mockReturnValueOnce({
        sort: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
        toArray: jest.fn().mockResolvedValue([])
      });

      const result = await data.getDashboardSummary(1);

      expect(mockCollection.aggregate).toHaveBeenCalled();
      expect(result.totalDeliveries24h).toBe(100);
      expect(result.successRate24h).toBe(95);
      expect(result.failedCount24h).toBe(5);
    });
  });

  describe('Worker Checkpoint Operations', () => {
    it('should get worker checkpoint from MongoDB', async () => {
      const mockCheckpoint = {
        workerId: 'main_worker',
        lastProcessedId: 1234
      };

      mockCollection.findOne.mockResolvedValueOnce(mockCheckpoint);

      const result = await data.getWorkerCheckpoint();

      expect(mockCollection.findOne).toHaveBeenCalledWith({
        workerId: 'main_worker'
      });
      expect(result).toBe(1234);
    });

    it('should set worker checkpoint in MongoDB', async () => {
      mockCollection.updateOne.mockResolvedValueOnce({ modifiedCount: 1 });

      await data.setWorkerCheckpoint(5678);

      expect(mockCollection.updateOne).toHaveBeenCalledWith(
        { workerId: 'main_worker' },
        expect.objectContaining({
          $set: expect.objectContaining({
            lastProcessedId: 5678
          })
        }),
        { upsert: true }
      );
    });
  });

  describe('Native JSON Storage Benefits', () => {
    it('should store objects without JSON.stringify', async () => {
      const webhookData = {
        name: 'Test',
        eventType: 'PATIENT_REGISTERED',
        targetUrl: 'https://example.com',
        httpMethod: 'POST',
        scope: 'ENTITY_ONLY',
        outgoingAuthType: 'API_KEY',
        outgoingAuthConfig: {
          headerName: 'X-API-Key',
          apiKey: 'secret123'
        }, // Direct object!
        transformation: {
          mode: 'SIMPLE',
          mappings: { oldField: 'newField' }
        }, // Direct object!
        isActive: true,
        timeoutMs: 3000,
        retryCount: 3
      };

      await data.addWebhook(1, webhookData);

      const insertCall = mockCollection.insertOne.mock.calls[0][0];
      // Check that objects are stored directly, not as strings
      expect(typeof insertCall.outgoingAuthConfig).toBe('object');
      expect(typeof insertCall.transformation).toBe('object');
      expect(insertCall.outgoingAuthConfig.apiKey).toBe('secret123');
    });
  });

  afterAll(() => {
    const logger = require('../../src/logger');
    if (logger.closeLogStreams) {
      logger.closeLogStreams();
    }
  });
});
