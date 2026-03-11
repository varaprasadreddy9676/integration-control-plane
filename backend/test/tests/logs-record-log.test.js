'use strict';

const mockExecutionLogsCollection = {
  find: jest.fn(),
  updateOne: jest.fn(),
  insertOne: jest.fn(),
};

const mockIntegrationConfigsCollection = {
  findOne: jest.fn(),
};

const mockDb = {
  collection: jest.fn((name) => {
    if (name === 'execution_logs') return mockExecutionLogsCollection;
    if (name === 'integration_configs') return mockIntegrationConfigsCollection;
    throw new Error(`Unexpected collection: ${name}`);
  }),
};

jest.mock('../../src/logger', () => ({
  log: jest.fn(),
  logError: jest.fn(),
}));

jest.mock('../../src/mongodb', () => ({
  getDbSafe: jest.fn().mockResolvedValue(mockDb),
  toObjectId: jest.fn(() => null),
}));

jest.mock('../../src/data/helpers', () => ({
  useMongo: jest.fn(() => true),
  normalizeOrgId: jest.fn((orgId) => Number(orgId)),
  buildOrgScopeQuery: jest.fn(() => ({})),
  addOrgScope: jest.fn((query) => query),
  fallbackDisabledError: jest.fn(),
  mapLogFromMongo: jest.fn((value) => value),
  mapIntegrationFromMongo: jest.fn((value) => value),
}));

const { recordLog } = require('../../src/data/logs');

describe('recordLog', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockExecutionLogsCollection.find.mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      toArray: jest.fn().mockResolvedValue([{ _id: 'latest-doc-id' }]),
    });
    mockExecutionLogsCollection.updateOne.mockResolvedValue({ matchedCount: 1 });
    mockExecutionLogsCollection.insertOne.mockResolvedValue({ insertedId: 'new-doc-id' });
    mockIntegrationConfigsCollection.findOne.mockResolvedValue(null);
  });

  it('resolves duplicate trace ids to a concrete latest execution log before updating', async () => {
    await recordLog(812, {
      id: 'trace-duplicate-1',
      traceId: 'trace-duplicate-1',
      status: 'FAILED',
      responseStatus: 500,
      responseBody: 'server error',
      requestPayload: { ok: false },
    });

    expect(mockExecutionLogsCollection.find).toHaveBeenCalledWith({
      traceId: 'trace-duplicate-1',
      orgId: 812,
    });
    expect(mockExecutionLogsCollection.updateOne).toHaveBeenCalledWith(
      { _id: 'latest-doc-id', orgId: 812 },
      expect.objectContaining({
        $set: expect.objectContaining({
          status: 'FAILED',
          traceId: 'trace-duplicate-1',
        }),
      })
    );
    expect(mockExecutionLogsCollection.insertOne).not.toHaveBeenCalled();
  });
});
