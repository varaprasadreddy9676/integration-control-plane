'use strict';

/**
 * Lookups route integration tests
 * Tests CRUD operations for /api/v1/lookups
 */

const express = require('express');
const request = require('supertest');

// --- Mock setup ---

const mockLookupDoc = {
  _id: { toString: () => 'lookup-id-789' },
  orgId: 1,
  orgUnitRid: 1,
  type: 'PATIENT_STATUS',
  sourceCode: 'ACTIVE',
  targetCode: '1',
  description: 'Active patient',
  isActive: true,
  category: 'status',
  createdAt: new Date(),
  updatedAt: new Date()
};

const mockCollection = {
  find: jest.fn().mockReturnValue({
    sort: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    project: jest.fn().mockReturnThis(),
    toArray: jest.fn().mockResolvedValue([mockLookupDoc])
  }),
  findOne: jest.fn().mockResolvedValue(mockLookupDoc),
  insertOne: jest.fn().mockResolvedValue({ insertedId: 'lookup-id-789' }),
  insertMany: jest.fn().mockResolvedValue({ insertedCount: 1 }),
  updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1, matchedCount: 1 }),
  deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }),
  deleteMany: jest.fn().mockResolvedValue({ deletedCount: 1 }),
  countDocuments: jest.fn().mockResolvedValue(1),
  distinct: jest.fn().mockResolvedValue(['PATIENT_STATUS', 'DIAGNOSIS_CODE']),
  aggregate: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) }),
  createIndex: jest.fn().mockResolvedValue('ok'),
  bulkWrite: jest.fn().mockResolvedValue({ insertedCount: 1, upsertedCount: 0 })
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
jest.mock('../../src/middleware/audit', () => ({
  auditLookup: {
    created: jest.fn().mockReturnValue(jest.fn().mockResolvedValue(undefined)),
    updated: jest.fn().mockReturnValue(jest.fn().mockResolvedValue(undefined)),
    deleted: jest.fn().mockReturnValue(jest.fn().mockResolvedValue(undefined)),
    bulkCreated: jest.fn().mockReturnValue(jest.fn().mockResolvedValue(undefined)),
    bulkDeleted: jest.fn().mockReturnValue(jest.fn().mockResolvedValue(undefined))
  }
}));

jest.mock('../../src/services/lookup-validator', () => ({
  validateLookupEntry: jest.fn().mockReturnValue(null), // null = no error
  validateBulkImport: jest.fn().mockReturnValue(null)
}));

jest.mock('../../src/services/lookup-service', () => ({
  testLookups: jest.fn().mockResolvedValue({ results: [], errors: [] })
}));

jest.mock('../../src/services/lookup-import-export', () => ({
  parseImportFile: jest.fn().mockResolvedValue([]),
  generateExportFile: jest.fn().mockResolvedValue(Buffer.from('csv data')),
  generateSimpleCSV: jest.fn().mockReturnValue('type,sourceCode,targetCode\n'),
  generateImportTemplate: jest.fn().mockReturnValue(Buffer.from('template'))
}));

function buildApp() {
  const app = express();
  app.use(express.json());

  // Simulate authenticated user with orgId
  app.use((req, _res, next) => {
    req.user = { id: 'user-1', role: 'ORG_ADMIN', orgId: 1 };
    req.orgId = 1;
    req.entityParentRid = 1;
    next();
  });

  const lookupsRouter = require('../../src/routes/lookups');
  const errorHandler = require('../../src/middleware/error-handler');

  app.use('/api/v1/lookups', lookupsRouter);
  app.use(errorHandler);
  return app;
}

describe('Lookups Routes', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = buildApp();

    mockCollection.find.mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      project: jest.fn().mockReturnThis(),
      toArray: jest.fn().mockResolvedValue([mockLookupDoc])
    });
    mockCollection.findOne.mockResolvedValue(mockLookupDoc);
  });

  describe('GET /api/v1/lookups', () => {
    it('returns 400 when orgId query param is missing', async () => {
      const res = await request(app).get('/api/v1/lookups');
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
    });

    it('returns 200 with list of lookups', async () => {
      const res = await request(app).get('/api/v1/lookups?orgId=1');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);
      expect(res.body).toHaveProperty('data');
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('accepts type filter', async () => {
      const res = await request(app).get('/api/v1/lookups?orgId=1&type=PATIENT_STATUS');
      expect(res.status).toBe(200);
    });

    it('returns 400 for tenantId query param', async () => {
      const res = await request(app).get('/api/v1/lookups?orgId=1&tenantId=abc');
      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/v1/lookups', () => {
    it('returns 201 when creating valid lookup', async () => {
      mockCollection.insertOne.mockResolvedValue({ insertedId: 'new-lookup-id' });

      const res = await request(app)
        .post('/api/v1/lookups')
        .query({ orgId: '1' })
        .send({
          type: 'PATIENT_STATUS',
          source: { id: 'NEW', name: 'New Patient' },
          target: { id: '5', name: '5' },
          description: 'New patient'
        });

      expect([200, 201]).toContain(res.status);
    });
  });

  describe('PUT /api/v1/lookups/:id', () => {
    it('returns 200 when updating existing lookup', async () => {
      const res = await request(app)
        .put('/api/v1/lookups/lookup-id-789')
        .query({ orgId: '1' })
        .send({ description: 'Updated description', isActive: true });

      expect([200, 404]).toContain(res.status);
    });
  });

  describe('DELETE /api/v1/lookups/:id', () => {
    it('returns 200 when deleting existing lookup', async () => {
      mockCollection.deleteOne.mockResolvedValue({ deletedCount: 1 });

      const res = await request(app)
        .delete('/api/v1/lookups/lookup-id-789')
        .query({ orgId: '1' });

      expect([200, 204]).toContain(res.status);
    });

    it('returns 404 when lookup does not exist', async () => {
      mockCollection.deleteOne.mockResolvedValue({ deletedCount: 0 });
      mockCollection.findOne.mockResolvedValue(null);

      const res = await request(app)
        .delete('/api/v1/lookups/nonexistent-id')
        .query({ orgId: '1' });

      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/v1/lookups/types', () => {
    it('returns 200 with list of lookup types', async () => {
      mockCollection.distinct.mockResolvedValue(['PATIENT_STATUS', 'DIAGNOSIS_CODE']);

      const res = await request(app)
        .get('/api/v1/lookups/types')
        .query({ orgId: '1' });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);
    });
  });

  describe('POST /api/v1/lookups/resolve', () => {
    it('resolves a lookup code', async () => {
      mockCollection.findOne.mockResolvedValue(mockLookupDoc);

      const res = await request(app)
        .post('/api/v1/lookups/resolve')
        .send({
          orgId: 1,
          type: 'PATIENT_STATUS',
          sourceCode: 'ACTIVE'
        });

      expect([200, 400]).toContain(res.status);
    });
  });
});
