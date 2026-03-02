'use strict';

const express = require('express');
const request = require('supertest');

const mockIntegrationCollection = {
  updateMany: jest.fn(),
  find: jest.fn(),
};

const mockAdminAuditCollection = {
  insertOne: jest.fn(),
};

const mockDb = {
  collection: jest.fn((name) => {
    if (name === 'integration_configs') return mockIntegrationCollection;
    if (name === 'admin_audit') return mockAdminAuditCollection;
    return {
      find: jest.fn(() => ({
        toArray: jest.fn().mockResolvedValue([]),
      })),
      updateMany: jest.fn().mockResolvedValue({ matchedCount: 0, modifiedCount: 0 }),
      insertOne: jest.fn().mockResolvedValue({ acknowledged: true }),
      deleteMany: jest.fn().mockResolvedValue({ deletedCount: 0 }),
      aggregate: jest.fn(() => ({
        toArray: jest.fn().mockResolvedValue([]),
      })),
      countDocuments: jest.fn().mockResolvedValue(0),
    };
  }),
};

jest.mock('../../src/mongodb', () => ({
  getDbSafe: jest.fn().mockResolvedValue(mockDb),
  isConnected: jest.fn(() => true),
  toObjectId: jest.fn((id) => (id ? { toString: () => String(id) } : null)),
}));

jest.mock('../../src/db', () => ({
  isConfigured: jest.fn(() => false),
  ping: jest.fn(async () => false),
}));

jest.mock('../../src/data/store', () => ({
  initStore: jest.fn(async () => {}),
  getTenant: jest.fn(() => null),
  findTenantByChildRid: jest.fn(() => null),
}));

jest.mock('../../src/logger', () => ({
  log: jest.fn(),
  logError: jest.fn(),
  requestLogger: (_req, _res, next) => next(),
  setDb: jest.fn(),
  closeLogStreams: jest.fn(),
}));

jest.mock('../../src/config', () => ({
  api: { basePrefix: '/api/v1' },
  security: { jwtSecret: 'test-secret', apiKey: 'test-api-key' },
  frontendUrl: 'http://localhost:5174',
  dailyReports: { apiKey: 'test-api-key' },
  worker: {},
}));

jest.mock('../../src/middleware/rate-limit', () => (_req, _res, next) => next());
jest.mock('../../src/middleware/request-id', () => (req, _res, next) => {
  req.id = 'req-test-id';
  next();
});

jest.mock('../../src/middleware/rate-limiter', () => ({
  getRateLimitStatus: jest.fn(async () => null),
  resetRateLimit: jest.fn(async () => ({})),
}));

jest.mock('../../src/services/memory-monitor', () => ({
  MemoryMonitor: jest.fn().mockImplementation(() => ({
    forceGC: jest.fn(() => null),
  })),
}));

const mockAuditConfig = {
  rateLimitBulkApplied: jest.fn(async () => {}),
};

jest.mock('../../src/middleware/audit', () => ({
  auditUser: { created: jest.fn(), updated: jest.fn(), deleted: jest.fn() },
  auditOrg: { created: jest.fn(), updated: jest.fn(), deleted: jest.fn() },
  auditConfig: mockAuditConfig,
  auditAdmin: { passwordChanged: jest.fn() },
}));

jest.mock('../../src/data', () => ({
  listUsers: jest.fn(async () => ({ users: [], total: 0 })),
  getUserById: jest.fn(async () => null),
  getSystemConfig: jest.fn(async () => null),
  updateSystemConfig: jest.fn(async () => ({})),
}));

function buildApp(userOverride = { id: 'admin-1', role: 'SUPER_ADMIN', orgId: null }) {
  const app = express();
  app.use(express.json());

  if (userOverride) {
    app.use((req, _res, next) => {
      req.user = userOverride;
      next();
    });
  }

  const adminRouter = require('../../src/routes/admin');
  const errorHandler = require('../../src/middleware/error-handler');

  app.use('/api/v1/admin', adminRouter);
  app.use(errorHandler);
  return app;
}

describe('Admin Rate Limits Routes', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    mockDb.collection.mockClear();
    mockIntegrationCollection.updateMany.mockReset();
    mockIntegrationCollection.find.mockReset();
    mockAdminAuditCollection.insertOne.mockReset();
  });

  it('bulk-apply merge handles integrations with rateLimits: null', async () => {
    mockIntegrationCollection.updateMany
      .mockResolvedValueOnce({ matchedCount: 2, modifiedCount: 2 }) // pre-normalize null docs
      .mockResolvedValueOnce({ matchedCount: 4, modifiedCount: 4 }); // requested merge update

    mockIntegrationCollection.find.mockReturnValue({
      limit: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([{ _id: { toString: () => 'int-1' } }]),
      }),
    });

    mockAdminAuditCollection.insertOne.mockResolvedValue({ acknowledged: true });

    const app = buildApp();
    const res = await request(app).post('/api/v1/admin/rate-limits/bulk-apply').send({
      filters: {},
      rateLimits: { enabled: false },
      mode: 'merge',
      confirmAll: true,
    });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      matched: 4,
      modified: 4,
      mode: 'merge',
    });

    expect(mockIntegrationCollection.updateMany).toHaveBeenCalledTimes(2);
    expect(mockIntegrationCollection.updateMany.mock.calls[0][0]).toEqual({ rateLimits: null });
    expect(mockIntegrationCollection.updateMany.mock.calls[1][1]).toMatchObject({
      $set: {
        'rateLimits.enabled': false,
      },
    });
    expect(mockAuditConfig.rateLimitBulkApplied).toHaveBeenCalledTimes(1);
  });
});

