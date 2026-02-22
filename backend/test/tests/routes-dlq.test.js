'use strict';

/**
 * DLQ route integration tests
 * Tests CRUD and retry operations for /api/v1/dlq
 */

const express = require('express');
const request = require('supertest');

const mockDLQEntry = {
  _id: { toString: () => 'dlq-123' },
  orgId: 1,
  integrationConfigId: 'integration-456',
  status: 'pending',
  errorCategory: 'TIMEOUT',
  errorCode: 'DELIVERY_TIMEOUT',
  direction: 'OUTBOUND',
  payload: { event: 'order.created' },
  retryCount: 3,
  createdAt: new Date(),
  failedAt: new Date()
};

jest.mock('../../src/mongodb', () => ({
  getDb: jest.fn(),
  getDbSafe: jest.fn(),
  isConnected: jest.fn(() => true)
}));

jest.mock('../../src/db', () => ({
  isConfigured: jest.fn(() => false),
  ping: jest.fn(async () => false)
}));

jest.mock('../../src/data/store', () => ({
  initStore: jest.fn(async () => {}),
  getTenant: jest.fn(() => null),
  findTenantByChildRid: jest.fn(() => null)
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
  security: { jwtSecret: 'test-secret' },
  worker: {}
}));

jest.mock('../../src/middleware/rate-limit', () => (_req, _res, next) => next());
jest.mock('../../src/middleware/request-id', () => (req, _res, next) => { req.id = 'req-test-id'; next(); });

const mockDlqData = {
  listDLQEntries: jest.fn(async () => ({
    entries: [mockDLQEntry],
    total: 1,
    limit: 50,
    offset: 0,
    hasMore: false
  })),
  getDLQStats: jest.fn(async () => ({
    totalEntries: 1,
    byStatus: { pending: 1 },
    byErrorCategory: { TIMEOUT: 1 }
  })),
  getDLQEntry: jest.fn(async () => mockDLQEntry),
  deleteDLQEntry: jest.fn(async () => true),
  manualRetryDLQ: jest.fn(async () => mockDLQEntry),
  abandonDLQEntry: jest.fn(async () => true)
};
jest.mock('../../src/data/dlq', () => mockDlqData);

function buildApp() {
  const app = express();
  app.use(express.json());

  app.use((req, _res, next) => {
    req.orgId = 1;
    req.user = { id: 'user-123' };
    next();
  });

  const dlqRouter = require('../../src/routes/dlq');
  const errorHandler = require('../../src/middleware/error-handler');

  app.use('/api/v1/dlq', dlqRouter);
  app.use(errorHandler);
  return app;
}

describe('DLQ Routes', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = buildApp();
  });

  describe('GET /api/v1/dlq', () => {
    it('returns 200 with paginated DLQ entries', async () => {
      const res = await request(app).get('/api/v1/dlq');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);
      expect(res.body).toHaveProperty('data');
      expect(res.body).toHaveProperty('pagination');
      expect(res.body.pagination).toHaveProperty('total');
    });

    it('passes filters to data layer', async () => {
      await request(app).get('/api/v1/dlq?status=pending&errorCategory=TIMEOUT');
      expect(mockDlqData.listDLQEntries).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ status: 'pending', errorCategory: 'TIMEOUT' }),
        expect.any(Object)
      );
    });
  });

  describe('GET /api/v1/dlq/stats', () => {
    it('returns 200 with DLQ statistics', async () => {
      const res = await request(app).get('/api/v1/dlq/stats');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);
      expect(res.body.data).toHaveProperty('totalEntries');
    });
  });

  describe('GET /api/v1/dlq/:dlqId', () => {
    it('returns 200 when DLQ entry exists', async () => {
      const res = await request(app).get('/api/v1/dlq/dlq-123');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);
      expect(res.body).toHaveProperty('data');
    });

    it('returns 404 when DLQ entry not found', async () => {
      mockDlqData.getDLQEntry.mockResolvedValueOnce(null);
      const res = await request(app).get('/api/v1/dlq/nonexistent');
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('code', 'NOT_FOUND');
    });
  });

  describe('POST /api/v1/dlq/:dlqId/retry', () => {
    it('returns 200 when retrying DLQ entry', async () => {
      const res = await request(app).post('/api/v1/dlq/dlq-123/retry');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);
      expect(res.body).toHaveProperty('message', 'Retry initiated');
      expect(res.body.data).toHaveProperty('status', 'retrying');
    });
  });

  describe('POST /api/v1/dlq/:dlqId/abandon', () => {
    it('returns 200 when abandoning DLQ entry', async () => {
      const res = await request(app)
        .post('/api/v1/dlq/dlq-123/abandon')
        .send({ notes: 'Unable to resolve' });

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('status', 'abandoned');
    });
  });

  describe('DELETE /api/v1/dlq/:dlqId', () => {
    it('returns 200 when deleting DLQ entry', async () => {
      const res = await request(app).delete('/api/v1/dlq/dlq-123');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('message', 'DLQ entry deleted');
    });
  });

  describe('POST /api/v1/dlq/bulk/retry', () => {
    it('returns 200 when bulk retrying', async () => {
      const res = await request(app)
        .post('/api/v1/dlq/bulk/retry')
        .send({ dlqIds: ['dlq-123', 'dlq-456'] });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);
      expect(Array.isArray(res.body.data.success)).toBe(true);
      expect(Array.isArray(res.body.data.failed)).toBe(true);
    });

    it('returns 400 with empty dlqIds array', async () => {
      const res = await request(app)
        .post('/api/v1/dlq/bulk/retry')
        .send({ dlqIds: [] });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('code', 'VALIDATION_ERROR');
    });

    it('returns 400 when exceeding 100 entry limit', async () => {
      const ids = Array.from({ length: 101 }, (_, i) => `dlq-${i}`);
      const res = await request(app)
        .post('/api/v1/dlq/bulk/retry')
        .send({ dlqIds: ids });

      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/v1/dlq/integration/:integrationId/summary', () => {
    it('returns 200 with integration DLQ summary', async () => {
      const res = await request(app).get('/api/v1/dlq/integration/integration-456/summary');
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('stats');
      expect(res.body.data).toHaveProperty('recentPendingEntries');
    });
  });
});
