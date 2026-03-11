'use strict';

const mockExecutionLogsCollection = {
  insertOne: jest.fn(),
  findOne: jest.fn(),
  updateOne: jest.fn(),
};

const mockDb = {
  collection: jest.fn(() => mockExecutionLogsCollection),
};

jest.mock('../../src/mongodb', () => ({
  getDbSafe: jest.fn().mockResolvedValue(mockDb),
  toObjectId: jest.fn((value) => (value ? `oid:${value}` : null)),
  ObjectId: class MockObjectId {},
}));

jest.mock('../../src/logger', () => ({
  log: jest.fn(),
}));

jest.mock('../../src/utils/runtime', () => ({
  uuidv4: jest.fn(() => '12345678-1234-1234-1234-1234567890ab'),
}));

const executionLogsData = require('../../src/data/execution-logs');

describe('execution-logs data layer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDb.collection.mockReturnValue(mockExecutionLogsCollection);
    mockExecutionLogsCollection.insertOne.mockResolvedValue({ insertedId: 'db-log-1' });
    mockExecutionLogsCollection.findOne.mockResolvedValue({ startedAt: new Date(0) });
    mockExecutionLogsCollection.updateOne.mockResolvedValue({ matchedCount: 1 });
  });

  it('returns both traceId and executionLogId when creating a log', async () => {
    const result = await executionLogsData.createExecutionLog({
      traceId: 'trc-explicit-1',
      orgId: 812,
      direction: 'OUTBOUND',
      triggerType: 'EVENT',
      status: 'PENDING',
    });

    expect(result).toEqual({
      traceId: 'trc-explicit-1',
      executionLogId: 'db-log-1',
    });
  });

  it('updates and appends steps by execution log id when provided', async () => {
    const ref = {
      executionLogId: 'db-log-1',
      traceId: 'trc-explicit-1',
      orgId: 812,
    };
    const finishedAt = new Date(5000);

    await executionLogsData.updateExecutionLog(ref, {
      status: 'success',
      finishedAt,
    });
    await executionLogsData.addExecutionStep(ref, {
      name: 'delivery',
      status: 'success',
    });

    expect(mockExecutionLogsCollection.findOne).toHaveBeenCalledWith({ _id: 'oid:db-log-1' });
    expect(mockExecutionLogsCollection.updateOne).toHaveBeenNthCalledWith(
      1,
      { _id: 'oid:db-log-1' },
      expect.objectContaining({
        $set: expect.objectContaining({
          status: 'SUCCESS',
          durationMs: 5000,
        }),
      })
    );
    expect(mockExecutionLogsCollection.updateOne).toHaveBeenNthCalledWith(
      2,
      { _id: 'oid:db-log-1' },
      expect.objectContaining({
        $push: expect.objectContaining({
          steps: expect.objectContaining({
            name: 'delivery',
          }),
        }),
      })
    );
  });
});
