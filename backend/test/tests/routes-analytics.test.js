'use strict';

const express = require('express');
const request = require('supertest');

const executionCollection = {
  aggregate: jest.fn(),
};

const integrationConfigCollection = {
  find: jest.fn(),
};

const mockDb = {
  collection: jest.fn((name) => {
    if (name === 'execution_logs') return executionCollection;
    if (name === 'integration_configs') return integrationConfigCollection;
    throw new Error(`Unexpected collection: ${name}`);
  }),
};

jest.mock('../../src/mongodb', () => ({
  getDbSafe: jest.fn().mockResolvedValue(mockDb),
  isConnected: jest.fn(() => true),
  toObjectId: jest.fn((id) => (id ? { toString: () => String(id), _bsontype: 'ObjectId' } : null)),
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
  worker: {},
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

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.orgId = 1;
    next();
  });

  const analyticsRouter = require('../../src/routes/analytics');
  const errorHandler = require('../../src/middleware/error-handler');
  app.use('/api/v1/analytics', analyticsRouter);
  app.use(errorHandler);
  return app;
}

describe('Analytics Routes', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = buildApp();

    executionCollection.aggregate
      .mockReturnValueOnce({
        toArray: jest.fn().mockResolvedValue([
          { _id: 'SUCCESS', count: 2 },
          { _id: 'FAILED', count: 1 },
        ]),
      })
      .mockReturnValueOnce({
        toArray: jest.fn().mockResolvedValue([{ total: 3 }]),
      })
      .mockReturnValueOnce({
        toArray: jest.fn().mockResolvedValue([
          {
            _id: 'APPOINTMENT_CONFIRMATION',
            total: 3,
            successful: 2,
            failed: 1,
            responseTimeSum: 120,
            responseTimeCount: 2,
          },
        ]),
      })
      .mockReturnValueOnce({
        toArray: jest.fn().mockResolvedValue([
          {
            _id: { toString: () => 'integration-1' },
            integrationName: null,
            total: 3,
            successful: 2,
            failed: 1,
            responseTimeSum: 120,
            responseTimeCount: 2,
          },
        ]),
      })
      .mockReturnValueOnce({
        toArray: jest.fn().mockResolvedValue([{ avgResponseTime: 60, responseTimeCount: 2 }]),
      })
      .mockReturnValueOnce({
        toArray: jest.fn().mockResolvedValue([]),
      });

    integrationConfigCollection.find.mockReturnValue({
      toArray: jest.fn().mockResolvedValue([
        { _id: { toString: () => 'integration-1' }, name: 'Resolved Integration Name' },
      ]),
    });
  });

  it('resolves integration names from integration_configs when analytics rows are missing names', async () => {
    const res = await request(app).get('/api/v1/analytics/overview?days=1');

    expect(res.status).toBe(200);
    expect(res.body.integrationPerformance).toHaveLength(1);
    expect(res.body.integrationPerformance[0]).toMatchObject({
      __KEEP___KEEP_integrationConfig__Id__: 'integration-1',
      __KEEP_integrationName__: 'Resolved Integration Name',
      total: 3,
      successful: 2,
      failed: 1,
    });
    expect(res.body.eventTypes).toMatchObject({
      APPOINTMENT_CONFIRMATION: {
        total: 3,
        successful: 2,
        failed: 1,
        avgResponseTime: 60,
      },
    });
    expect(integrationConfigCollection.find).toHaveBeenCalled();
  });
});
