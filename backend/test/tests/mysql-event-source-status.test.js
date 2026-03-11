'use strict';

const mockGetDbSafe = jest.fn();

jest.mock('../../src/mongodb', () => ({
  getDbSafe: (...args) => mockGetDbSafe(...args),
}));

jest.mock('../../src/logger', () => ({
  log: jest.fn(),
  logError: jest.fn(),
}));

jest.mock('../../src/worker-heartbeat', () => ({
  updateHeartbeat: jest.fn(),
}));

const { MysqlEventSource } = require('../../src/adapters/MysqlEventSource');

describe('MysqlEventSource.getRuntimeStatus', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetDbSafe.mockResolvedValue({
      collection: jest.fn(() => ({
        findOne: jest.fn().mockResolvedValue(null),
        updateOne: jest.fn().mockResolvedValue({}),
      })),
    });
  });

  it('reports connected status when the pool probe succeeds', async () => {
    const pool = {
      query: jest.fn().mockResolvedValue([[{ 1: 1 }]]),
      execute: jest.fn(),
    };

    const adapter = new MysqlEventSource({
      orgId: 812,
      pool,
      table: 'notification_queue',
      columnMapping: {
        id: 'id',
        orgId: 'entity_parent_rid',
        eventType: 'transaction_type',
        payload: 'message',
      },
      pollIntervalMs: 5000,
      batchSize: 10,
    });

    const status = await adapter.getRuntimeStatus();

    expect(status.connectionStatus).toBe('connected');
    expect(status.connectionProbe).toEqual(
      expect.objectContaining({
        ok: true,
      })
    );
    expect(pool.query).toHaveBeenCalledWith('SELECT 1');
  });

  it('reports error status when the pool probe fails', async () => {
    const pool = {
      query: jest.fn().mockRejectedValue(new Error('connect ETIMEDOUT')),
      execute: jest.fn(),
    };

    const adapter = new MysqlEventSource({
      orgId: 812,
      pool,
      table: 'notification_queue',
      columnMapping: {
        id: 'id',
        orgId: 'entity_parent_rid',
        eventType: 'transaction_type',
        payload: 'message',
      },
    });

    const status = await adapter.getRuntimeStatus();

    expect(status.connectionStatus).toBe('error');
    expect(status.connectionProbe).toEqual({
      ok: false,
      error: 'connect ETIMEDOUT',
    });
  });
});
