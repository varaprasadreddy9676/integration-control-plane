'use strict';

jest.mock('../../src/config', () => ({
  eventSource: {},
}));

jest.mock('../../src/data', () => ({
  listOrganizations: jest.fn(async () => []),
}));

jest.mock('../../src/db', () => ({
  getPoolVersion: jest.fn(() => 1),
  getPool: jest.fn(() => null),
}));

jest.mock('../../src/logger', () => ({
  log: jest.fn(),
  logError: jest.fn(),
}));

jest.mock('../../src/processor/event-handler', () => ({
  createEventHandler: jest.fn(() => jest.fn()),
}));

jest.mock('../../src/adapters/MysqlEventSource', () => ({
  MysqlEventSource: jest.fn(),
}));

jest.mock('../../src/adapters/KafkaEventSource', () => ({
  KafkaEventSource: jest.fn(),
}));

jest.mock('../../src/adapters/HttpPushAdapter', () => ({
  HttpPushAdapter: jest.fn(),
}));

jest.mock('../../src/data/event-sources', () => ({
  listActiveConfigs: jest.fn(async () => []),
}));

jest.mock('../../src/utils/mysql-safety', () => ({
  sanitizePoolConfig: jest.fn((cfg) => cfg),
  sanitizeMysqlSourceConfig: jest.fn((cfg) => cfg),
}));

const { DeliveryWorkerManager } = require('../../src/processor/delivery-worker-manager');

describe('DeliveryWorkerManager.getStatus', () => {
  it('returns runtime status for each adapter and does not fail the whole response if one probe errors', async () => {
    const manager = new DeliveryWorkerManager();
    manager.lastSyncStartedAt = new Date('2026-03-11T10:00:00.000Z');
    manager.lastSyncFinishedAt = new Date('2026-03-11T10:00:03.000Z');
    manager.desiredState.set(812, { type: 'mysql', configOrigin: 'explicit' });
    manager.desiredState.set(648, { type: 'kafka', configOrigin: 'explicit' });
    manager.adapterErrors.set(648, {
      orgId: 648,
      sourceType: 'kafka',
      configOrigin: 'explicit',
      stage: 'start',
      errorMessage: 'Broker timeout',
      updatedAt: '2026-03-11T10:00:02.000Z',
    });

    manager.adapters.set(812, {
      sourceType: 'mysql',
      configHash: 'hash-812',
      adapter: {
        getName: () => 'MysqlEventSource[org=812]',
        getRuntimeStatus: jest.fn(async () => ({
          connectionStatus: 'connected',
          lastRowsFetched: 10,
        })),
      },
    });

    manager.adapters.set(648, {
      sourceType: 'kafka',
      configHash: 'hash-648',
      adapter: {
        getName: () => 'KafkaEventSource[org=648]',
        getRuntimeStatus: jest.fn(async () => {
          throw new Error('Broker timeout');
        }),
      },
    });

    const status = await manager.getStatus();

    expect(status.count).toBe(2);
    expect(status.adapters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          orgId: 812,
          sourceType: 'mysql',
          connectionStatus: 'connected',
          lastRowsFetched: 10,
        }),
        expect.objectContaining({
          orgId: 648,
          sourceType: 'kafka',
          connectionStatus: 'error',
          statusError: 'Broker timeout',
        }),
      ])
    );
    expect(status.lastSyncStartedAt).toBe('2026-03-11T10:00:00.000Z');
    expect(status.lastSyncFinishedAt).toBe('2026-03-11T10:00:03.000Z');
    expect(status.desiredConfigs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          orgId: 812,
          sourceType: 'mysql',
          state: 'running',
        }),
        expect.objectContaining({
          orgId: 648,
          sourceType: 'kafka',
          state: 'running',
          error: expect.objectContaining({
            errorMessage: 'Broker timeout',
          }),
        }),
      ])
    );
  });
});
