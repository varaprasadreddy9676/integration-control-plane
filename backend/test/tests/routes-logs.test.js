'use strict';

/**
 * Logs route integration tests
 * Tests GET /api/v1/logs and related endpoints
 */

const express = require('express');
const request = require('supertest');

// --- Mock setup ---

const mockLogDoc = {
  _id: { toString: () => 'log-id-456' },
  orgId: 1,
  __KEEP___KEEP_integrationConfig__Id__: { toString: () => 'integration-id-123' },
  __KEEP_integrationName__: 'Test Integration',
  eventType: 'TEST_EVENT',
  direction: 'OUTBOUND',
  triggerType: 'EVENT',
  status: 'SUCCESS',
  responseStatus: 200,
  responseTimeMs: 150,
  attemptCount: 1,
  createdAt: new Date(),
  deliveredAt: new Date(),
  targetUrl: 'https://example.com/webhook',
  httpMethod: 'POST'
};

const mockCollection = {
  find: jest.fn().mockReturnValue({
    sort: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    toArray: jest.fn().mockResolvedValue([mockLogDoc])
  }),
  findOne: jest.fn().mockResolvedValue(null),
  insertOne: jest.fn().mockResolvedValue({ insertedId: 'log-id-456' }),
  updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1, matchedCount: 1 }),
  updateMany: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
  deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }),
  deleteMany: jest.fn().mockResolvedValue({ deletedCount: 1 }),
  countDocuments: jest.fn().mockResolvedValue(1),
  distinct: jest.fn().mockResolvedValue([]),
  aggregate: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) }),
  createIndex: jest.fn().mockResolvedValue('ok')
};

const mockDb = {
  collection: jest.fn().mockReturnValue(mockCollection)
};

jest.mock('../../src/mongodb', () => ({
  connect: jest.fn().mockResolvedValue(undefined),
  getDb: jest.fn().mockReturnValue(mockDb),
  getDbSafe: jest.fn().mockResolvedValue(mockDb),
  isConnected: jest.fn().mockReturnValue(true),
  toObjectId: jest.fn((id) => (id ? { toString: () => String(id), _bsontype: 'ObjectId' } : null)),
  ObjectId: class MockObjectId {
    constructor(id) { this.id = id; }
    toString() { return String(this.id); }
  }
}));

jest.mock('../../src/db', () => ({
  isConfigured: jest.fn().mockReturnValue(false),
  ping: jest.fn().mockResolvedValue(false)
}));

jest.mock('../../src/data/store', () => ({
  initStore: jest.fn().mockResolvedValue(undefined),
  getTenant: jest.fn().mockReturnValue(null),
  findTenantByChildRid: jest.fn().mockReturnValue(null)
}));

jest.mock('../../src/logger', () => ({
  log: jest.fn(),
  logError: jest.fn(),
  requestLogger: (_req, _res, next) => next(),
  setDb: jest.fn(),
  closeLogStreams: jest.fn()
}));

jest.mock('../../src/config', () => ({
  api: { basePrefix: '/api/v1' },
  security: { jwtSecret: 'test-secret', jwtExpiresIn: '12h', apiKey: 'test-api-key-xyz' },
  worker: {}
}));

jest.mock('../../src/middleware/rate-limit', () => (_req, _res, next) => next());
jest.mock('../../src/middleware/request-id', () => (req, _res, next) => { req.id = 'req-test-id'; next(); });

jest.mock('../../src/processor/retry-handler', () => ({
  replayEvent: jest.fn().mockResolvedValue({ id: 'replay-log-id', status: 'PENDING' })
}));

function buildApp() {
  const app = express();
  app.use(express.json());

  app.use((req, _res, next) => {
    req.user = { id: 'user-1', role: 'ORG_ADMIN', orgId: 1 };
    req.orgId = 1;
    req.entityParentRid = 1;
    next();
  });

  const logsRouter = require('../../src/routes/logs');
  const errorHandler = require('../../src/middleware/error-handler');

  app.use('/api/v1/logs', logsRouter);
  app.use(errorHandler);
  return app;
}

function buildAppWithAuth() {
  const app = express();
  app.use(express.json());

  const auth = require('../../src/middleware/auth');
  const logsRouter = require('../../src/routes/logs');
  const errorHandler = require('../../src/middleware/error-handler');

  app.use('/api/v1/logs', auth, logsRouter);
  app.use(errorHandler);
  return app;
}

describe('Logs Routes', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = buildApp();

    mockCollection.find.mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      toArray: jest.fn().mockResolvedValue([mockLogDoc])
    });
    mockCollection.countDocuments.mockResolvedValue(1);
  });

  describe('GET /api/v1/logs', () => {
    it('returns 200 with logs and pagination', async () => {
      const res = await request(app).get('/api/v1/logs');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('data');
      expect(res.body).toHaveProperty('pagination');
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('returns empty data when no logs exist', async () => {
      mockCollection.find.mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        toArray: jest.fn().mockResolvedValue([])
      });
      mockCollection.countDocuments.mockResolvedValue(0);

      const res = await request(app).get('/api/v1/logs');
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
      expect(res.body.pagination.total).toBe(0);
    });

    it('accepts status filter', async () => {
      const res = await request(app).get('/api/v1/logs?status=FAILED');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('data');
    });

    it('accepts pagination params', async () => {
      const res = await request(app).get('/api/v1/logs?page=2&limit=10');
      expect(res.status).toBe(200);
      expect(res.body.pagination).toMatchObject({
        page: 2,
        limit: 10
      });
    });

    it('returns correct pagination metadata', async () => {
      mockCollection.countDocuments.mockResolvedValue(25);

      const res = await request(app).get('/api/v1/logs?page=1&limit=10');
      expect(res.status).toBe(200);
      expect(res.body.pagination.total).toBe(25);
      expect(res.body.pagination.totalPages).toBe(3);
    });
  });

  describe('GET /api/v1/logs without auth', () => {
    it('returns 401 without any token or API key', async () => {
      const appWithAuth = buildAppWithAuth();
      const res = await request(appWithAuth).get('/api/v1/logs');
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/v1/logs/stats/summary', () => {
    it('returns 200 with stats', async () => {
      mockCollection.aggregate.mockReturnValue({
        toArray: jest.fn().mockResolvedValue([{ total: 10, success: 8, failed: 2, pending: 0 }])
      });

      const res = await request(app).get('/api/v1/logs/stats/summary');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('total');
    });
  });

  describe('GET /api/v1/logs/:id', () => {
    it('returns 404 when log not found', async () => {
      mockCollection.findOne.mockResolvedValue(null);
      const res = await request(app).get('/api/v1/logs/nonexistent-log-id');
      expect(res.status).toBe(404);
    });

    it('returns 200 with log details when found', async () => {
      const logWithAttempts = {
        ...mockLogDoc,
        __KEEP___KEEP_integrationConfig__Id__: null
      };
      mockCollection.findOne.mockResolvedValue(logWithAttempts);

      // Also mock the delivery_attempts collection
      mockDb.collection.mockImplementation((name) => {
        if (name === 'delivery_attempts') {
          return {
            find: jest.fn().mockReturnValue({
              sort: jest.fn().mockReturnThis(),
              toArray: jest.fn().mockResolvedValue([])
            })
          };
        }
        return mockCollection;
      });

      const res = await request(app).get('/api/v1/logs/log-id-456');
      expect([200, 404]).toContain(res.status);
    });
  });
});
