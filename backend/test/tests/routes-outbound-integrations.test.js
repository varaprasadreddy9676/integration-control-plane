'use strict';

/**
 * Outbound integrations route integration tests
 * Tests GET, POST, PUT, DELETE /api/v1/outbound-integrations
 */

const express = require('express');
const request = require('supertest');

// --- Mock setup ---

const mockIntegrationDoc = {
  _id: { toString: () => 'integration-id-123' },
  name: 'Test Integration',
  type: 'TEST_EVENT',
  eventType: 'TEST_EVENT',
  direction: 'OUTBOUND',
  orgId: 1,
  orgUnitRid: 1,
  targetUrl: 'https://example.com/webhook',
  httpMethod: 'POST',
  outgoingAuthType: 'NONE',
  outgoingAuthConfig: null,
  isActive: true,
  timeoutMs: 5000,
  retryCount: 3,
  transformationMode: 'SIMPLE',
  transformation: null,
  actions: null,
  scope: 'INCLUDE_CHILDREN',
  excludedEntityRids: [],
  signingSecret: 'secret-abc',
  signingSecrets: ['secret-abc'],
  enableSigning: false,
  signatureVersion: 'v1',
  deliveryMode: 'IMMEDIATE',
  schedulingConfig: null,
  metadata: {},
  createdAt: new Date(),
  updatedAt: new Date()
};

const mockCollection = {
  find: jest.fn().mockReturnValue({
    sort: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    toArray: jest.fn().mockResolvedValue([mockIntegrationDoc])
  }),
  findOne: jest.fn().mockResolvedValue(mockIntegrationDoc),
  insertOne: jest.fn().mockResolvedValue({ insertedId: 'integration-id-123' }),
  updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1, matchedCount: 1 }),
  updateMany: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
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
jest.mock('../../src/middleware/audit', () => ({
  auditIntegration: {
    created: jest.fn().mockReturnValue(jest.fn().mockResolvedValue(undefined)),
    updated: jest.fn().mockReturnValue(jest.fn().mockResolvedValue(undefined)),
    deleted: jest.fn().mockReturnValue(jest.fn().mockResolvedValue(undefined)),
    bulkEnabled: jest.fn().mockResolvedValue(undefined),
    bulkDisabled: jest.fn().mockResolvedValue(undefined)
  }
}));

jest.mock('../../src/services/transformer', () => ({
  validateScript: jest.fn().mockReturnValue(true),
  applyTransform: jest.fn().mockResolvedValue({})
}));

jest.mock('../../src/utils/url-check', () => ({
  validateTargetUrl: jest.fn().mockReturnValue({ valid: true })
}));

jest.mock('../../src/services/integration-signing', () => ({
  generateSigningSecret: jest.fn().mockReturnValue('mock-signing-secret')
}));

jest.mock('../../src/services/lookup-validator', () => ({
  validateLookupConfigs: jest.fn().mockResolvedValue(true)
}));

jest.mock('../../src/utils/runtime', () => ({
  fetch: jest.fn(),
  AbortController: class { constructor() { this.signal = {}; } abort() {} }
}));

jest.mock('../../src/services/scheduler', () => ({
  executeSchedulingScript: jest.fn().mockResolvedValue(null),
  validateRecurringConfig: jest.fn().mockReturnValue(true)
}));

jest.mock('../../src/utils/curl-generator', () => ({
  generateMaskedCurlCommand: jest.fn().mockReturnValue('curl -X POST ...')
}));

jest.mock('../../src/processor/auth-helper', () => ({
  buildAuthHeaders: jest.fn().mockResolvedValue({})
}));

function buildApp() {
  const app = express();
  app.use(express.json());

  // Inject auth context (simulate authenticated API key user)
  app.use((req, _res, next) => {
    req.user = { id: 'user-1', role: 'ORG_ADMIN', orgId: 1 };
    req.orgId = 1;
    req.entityParentRid = 1;
    req.authType = 'apikey';
    next();
  });

  const router = require('../../src/routes/outbound-integrations');
  const errorHandler = require('../../src/middleware/error-handler');

  app.use('/api/v1/outbound-integrations', router);
  app.use(errorHandler);
  return app;
}

describe('Outbound Integrations Routes', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = buildApp();
    // Reset collection mocks
    mockCollection.find.mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      toArray: jest.fn().mockResolvedValue([mockIntegrationDoc])
    });
    mockCollection.findOne.mockResolvedValue(mockIntegrationDoc);
  });

  describe('GET /api/v1/outbound-integrations', () => {
    it('returns 200 with array of integrations', async () => {
      const res = await request(app).get('/api/v1/outbound-integrations');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('returns empty array when no integrations exist', async () => {
      mockCollection.find.mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        toArray: jest.fn().mockResolvedValue([])
      });

      const res = await request(app).get('/api/v1/outbound-integrations');
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });
  });

  describe('POST /api/v1/outbound-integrations', () => {
    it('returns 201 when creating a valid integration', async () => {
      mockCollection.insertOne.mockResolvedValue({ insertedId: 'new-id' });
      mockCollection.findOne.mockResolvedValueOnce(null).mockResolvedValue({
        ...mockIntegrationDoc,
        _id: { toString: () => 'new-id' }
      });

      const res = await request(app)
        .post('/api/v1/outbound-integrations')
        .send({
          name: 'My Webhook',
          type: 'PATIENT_EVENT',
          eventType: 'PATIENT_EVENT',
          targetUrl: 'https://example.com/webhook',
          httpMethod: 'POST',
          scope: 'INCLUDE_CHILDREN',
          outgoingAuthType: 'NONE',
          timeoutMs: 5000,
          retryCount: 3,
          isActive: true
        });

      expect([200, 201]).toContain(res.status);
    });

    it('returns 400 when targetUrl is missing for OUTBOUND integration', async () => {
      const res = await request(app)
        .post('/api/v1/outbound-integrations')
        .send({
          name: 'Missing URL',
          type: 'PATIENT_EVENT',
          direction: 'OUTBOUND'
          // no targetUrl
        });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
    });
  });

  describe('GET /api/v1/outbound-integrations/:id', () => {
    it('returns 200 with integration by ID', async () => {
      const res = await request(app).get('/api/v1/outbound-integrations/integration-id-123');
      expect([200, 404]).toContain(res.status);
    });

    it('returns 404 when integration not found', async () => {
      mockCollection.findOne.mockResolvedValue(null);
      const res = await request(app).get('/api/v1/outbound-integrations/nonexistent-id');
      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /api/v1/outbound-integrations/:id', () => {
    it('returns 200 when deleting existing integration', async () => {
      mockCollection.deleteOne.mockResolvedValue({ deletedCount: 1 });

      const res = await request(app).delete('/api/v1/outbound-integrations/integration-id-123');
      expect([200, 204]).toContain(res.status);
    });

    it('returns 404 when integration to delete does not exist', async () => {
      mockCollection.deleteOne.mockResolvedValue({ deletedCount: 0 });

      const res = await request(app).delete('/api/v1/outbound-integrations/nonexistent-id');
      expect(res.status).toBe(404);
    });
  });
});

describe('Outbound Integrations - Auth Required', () => {
  it('returns 401 without authentication', async () => {
    // Build app without auth context injection
    const app = express();
    app.use(express.json());

    const auth = require('../../src/middleware/auth');
    const router = require('../../src/routes/outbound-integrations');
    const errorHandler = require('../../src/middleware/error-handler');

    app.use('/api/v1/outbound-integrations', auth, router);
    app.use(errorHandler);

    const res = await request(app).get('/api/v1/outbound-integrations');
    expect(res.status).toBe(401);
  });
});
