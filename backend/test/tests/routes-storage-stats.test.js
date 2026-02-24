'use strict';

/**
 * Admin storage-stats route integration tests
 * Tests for GET /api/v1/admin/storage-stats
 */

const express = require('express');
const request = require('supertest');

// --- Mock MongoDB db and collection responses ---

const mockDbStats = {
  dataSize: 2048000,
  storageSize: 1024000,
  indexSize: 204800,
  objects: 5000,
  collections: 3,
  avgObjSize: 409,
  fsUsedSize: 10240000,
  fsTotalSize: 102400000,
};

const mockCollStats = {
  count: 100,
  size: 512000,
  storageSize: 256000,
  totalIndexSize: 51200,
  avgObjSize: 5120,
};

const mockCollectionList = [
  { name: 'integration_configs' },
  { name: 'execution_logs' },
  { name: 'system.views' }, // should be filtered out
];

const mockCollection = {
  countDocuments: jest.fn().mockResolvedValue(42),
};

const mockDb = {
  command: jest.fn(),
  listCollections: jest.fn(),
  collection: jest.fn().mockReturnValue(mockCollection),
};

jest.mock('../../src/mongodb', () => ({
  getDb: jest.fn(),
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

jest.mock('../../src/middleware/audit', () => ({
  auditUser: { created: jest.fn(), updated: jest.fn(), deleted: jest.fn() },
  auditOrg: { created: jest.fn(), updated: jest.fn(), deleted: jest.fn() },
  auditConfig: { updated: jest.fn() },
  auditAdmin: { passwordChanged: jest.fn() },
}));

jest.mock('../../src/services/memory-monitor', () => ({
  MemoryMonitor: jest.fn().mockImplementation(() => ({
    forceGC: jest.fn(() => null),
  })),
}));

const mockData = {
  listUsers: jest.fn(async () => ({ users: [], total: 0 })),
  getUserById: jest.fn(async () => null),
  getSystemConfig: jest.fn(async () => null),
  updateSystemConfig: jest.fn(async () => ({})),
  listAdminRateLimits: jest.fn(async () => ({ items: [], total: 0 })),
  bulkApplyAdminRateLimits: jest.fn(async () => ({})),
  bulkResetAdminRateLimits: jest.fn(async () => ({})),
  listAuditLogs: jest.fn(async () => ({ logs: [], total: 0 })),
  listOrganizations: jest.fn(async () => ({ orgs: [], total: 0 })),
};
jest.mock('../../src/data', () => mockData);

// Build app with a specific user injected (or no user for 401 testing)
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

  // No outer guard — the admin router handles its own auth internally
  app.use('/api/v1/admin', adminRouter);
  app.use(errorHandler);
  return app;
}

describe('Admin Storage Stats Routes', () => {
  beforeEach(() => {
    jest.resetModules(); // clears module-level cache vars between tests
    jest.clearAllMocks();

    // Default happy-path mock setup
    mockDb.command.mockImplementation(async (cmd) => {
      if (cmd.dbStats) return mockDbStats;
      if (cmd.collStats) return mockCollStats;
      throw new Error(`Unexpected command: ${JSON.stringify(cmd)}`);
    });

    mockDb.listCollections.mockReturnValue({
      toArray: jest.fn().mockResolvedValue(mockCollectionList),
    });
  });

  describe('GET /api/v1/admin/storage-stats', () => {
    it('returns 200 with db and collections for SUPER_ADMIN', async () => {
      const app = buildApp({ id: 'admin-1', role: 'SUPER_ADMIN', orgId: null });
      const res = await request(app).get('/api/v1/admin/storage-stats');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('db');
      expect(res.body).toHaveProperty('collections');
      expect(res.body).toHaveProperty('generatedAt');
    });

    it('returns 200 for ADMIN role', async () => {
      const app = buildApp({ id: 'admin-2', role: 'ADMIN', orgId: null });
      const res = await request(app).get('/api/v1/admin/storage-stats');
      expect(res.status).toBe(200);
    });

    it('returns 200 for ORG_ADMIN role', async () => {
      const app = buildApp({ id: 'orgadmin-1', role: 'ORG_ADMIN', orgId: 1 });
      const res = await request(app).get('/api/v1/admin/storage-stats');
      expect(res.status).toBe(200);
    });
  });

  describe('ORG_ADMIN view', () => {
    it('sets isOrgView: true for ORG_ADMIN', async () => {
      const app = buildApp({ id: 'orgadmin-1', role: 'ORG_ADMIN', orgId: 1 });
      const res = await request(app).get('/api/v1/admin/storage-stats');
      expect(res.status).toBe(200);
      expect(res.body.isOrgView).toBe(true);
    });

    it('does not set isOrgView for SUPER_ADMIN', async () => {
      const app = buildApp({ id: 'admin-1', role: 'SUPER_ADMIN', orgId: null });
      const res = await request(app).get('/api/v1/admin/storage-stats');
      expect(res.status).toBe(200);
      expect(res.body.isOrgView).toBeFalsy();
    });

    it('only returns org-scoped collections for ORG_ADMIN', async () => {
      // Add a non-org-scoped collection to the list
      mockDb.listCollections.mockReturnValueOnce({
        toArray: jest.fn().mockResolvedValue([
          { name: 'integration_configs' }, // org-scoped
          { name: 'execution_logs' },       // org-scoped
          { name: 'organizations' },        // NOT org-scoped
          { name: 'system_config' },        // NOT org-scoped
        ]),
      });

      const app = buildApp({ id: 'orgadmin-1', role: 'ORG_ADMIN', orgId: 1 });
      const res = await request(app).get('/api/v1/admin/storage-stats');

      expect(res.status).toBe(200);
      const names = res.body.collections.map((c) => c.name);
      expect(names).toContain('integration_configs');
      expect(names).toContain('execution_logs');
      expect(names).not.toContain('organizations');
      expect(names).not.toContain('system_config');
    });

    it('uses per-org document counts (countDocuments) for ORG_ADMIN', async () => {
      mockCollection.countDocuments.mockResolvedValue(7);

      const app = buildApp({ id: 'orgadmin-1', role: 'ORG_ADMIN', orgId: 1 });
      const res = await request(app).get('/api/v1/admin/storage-stats');

      expect(res.status).toBe(200);
      // count should be 7 (per-org), not 100 (global mockCollStats.count)
      expect(res.body.collections[0].count).toBe(7);
    });

    it('db.objects reflects org total (sum of per-org counts) for ORG_ADMIN', async () => {
      mockCollection.countDocuments.mockResolvedValue(10);

      const app = buildApp({ id: 'orgadmin-1', role: 'ORG_ADMIN', orgId: 1 });
      const res = await request(app).get('/api/v1/admin/storage-stats');

      expect(res.status).toBe(200);
      // 2 org-scoped collections in mockCollectionList × 10 each = 20
      expect(res.body.db.objects).toBe(20);
    });
  });

  describe('Response shape (shared)', () => {
    it('db shape has required numeric fields', async () => {
      const app = buildApp();
      const res = await request(app).get('/api/v1/admin/storage-stats');

      expect(res.status).toBe(200);
      const { db } = res.body;
      expect(typeof db.dataSize).toBe('number');
      expect(typeof db.storageSize).toBe('number');
      expect(typeof db.indexSize).toBe('number');
      expect(typeof db.objects).toBe('number');
      expect(typeof db.collections).toBe('number');
      expect(db.storageSize).toBe(mockDbStats.storageSize);
    });

    it('collections is an array sorted by storageSize descending', async () => {
      const app = buildApp();
      const res = await request(app).get('/api/v1/admin/storage-stats');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.collections)).toBe(true);

      const { collections } = res.body;
      // system.views should be filtered out — only 2 user collections
      expect(collections).toHaveLength(2);

      for (let i = 1; i < collections.length; i++) {
        expect(collections[i - 1].storageSize).toBeGreaterThanOrEqual(collections[i].storageSize);
      }
    });

    it('each collection element has required fields', async () => {
      const app = buildApp();
      const res = await request(app).get('/api/v1/admin/storage-stats');

      expect(res.status).toBe(200);
      const col = res.body.collections[0];
      expect(col).toHaveProperty('name');
      expect(col).toHaveProperty('label');
      expect(col).toHaveProperty('count');
      expect(col).toHaveProperty('storageSize');
      expect(col).toHaveProperty('percentOfTotal');
      expect(typeof col.percentOfTotal).toBe('number');
    });

    it('assigns known labels from COLLECTION_LABELS map', async () => {
      const app = buildApp();
      const res = await request(app).get('/api/v1/admin/storage-stats');

      expect(res.status).toBe(200);
      const intCol = res.body.collections.find((c) => c.name === 'integration_configs');
      expect(intCol).toBeDefined();
      expect(intCol.label).toBe('Integrations');
    });

    it('filters out system.* collections', async () => {
      const app = buildApp();
      const res = await request(app).get('/api/v1/admin/storage-stats');

      expect(res.status).toBe(200);
      const names = res.body.collections.map((c) => c.name);
      expect(names.some((n) => n.startsWith('system.'))).toBe(false);
    });

    it('generatedAt is a valid ISO timestamp', async () => {
      const app = buildApp();
      const res = await request(app).get('/api/v1/admin/storage-stats');

      expect(res.status).toBe(200);
      expect(() => new Date(res.body.generatedAt)).not.toThrow();
      expect(new Date(res.body.generatedAt).toISOString()).toBe(res.body.generatedAt);
    });
  });

  describe('Access control', () => {
    it('returns 401 without user context', async () => {
      const app = buildApp(null);
      const res = await request(app).get('/api/v1/admin/storage-stats');
      expect(res.status).toBe(401);
    });

    it('returns 403 for VIEWER role', async () => {
      const app = buildApp({ id: 'user-1', role: 'VIEWER', orgId: 1 });
      const res = await request(app).get('/api/v1/admin/storage-stats');
      expect(res.status).toBe(403);
    });

    it('returns 403 for API_KEY role', async () => {
      const app = buildApp({ id: 'key-1', role: 'API_KEY', orgId: 1 });
      const res = await request(app).get('/api/v1/admin/storage-stats');
      expect(res.status).toBe(403);
    });
  });

  describe('Error handling', () => {
    it('returns 500 when db.command throws', async () => {
      mockDb.command.mockRejectedValueOnce(new Error('MongoDB unavailable'));

      const app = buildApp();
      const res = await request(app).get('/api/v1/admin/storage-stats');
      expect(res.status).toBe(500);
    });

    it('returns 500 when listCollections throws', async () => {
      mockDb.listCollections.mockReturnValueOnce({
        toArray: jest.fn().mockRejectedValueOnce(new Error('cursor error')),
      });

      const app = buildApp();
      const res = await request(app).get('/api/v1/admin/storage-stats');
      expect(res.status).toBe(500);
    });

    it('tolerates individual collStats failures (allSettled)', async () => {
      // First collection succeeds, second fails
      let callCount = 0;
      mockDb.command.mockImplementation(async (cmd) => {
        if (cmd.dbStats) return mockDbStats;
        if (cmd.collStats) {
          callCount++;
          if (callCount === 2) throw new Error('collStats failed');
          return mockCollStats;
        }
        throw new Error('unexpected');
      });

      const app = buildApp();
      const res = await request(app).get('/api/v1/admin/storage-stats');

      // Should still succeed overall — failed collection is skipped
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('collections');
    });
  });
});
