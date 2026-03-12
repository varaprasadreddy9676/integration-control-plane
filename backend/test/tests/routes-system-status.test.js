'use strict';

const express = require('express');
const request = require('supertest');

const mockCollections = {};

function makeAggregateCursor(rows) {
  return {
    toArray: jest.fn().mockResolvedValue(rows),
  };
}

function makeFindCursor(rows) {
  return {
    sort: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    toArray: jest.fn().mockResolvedValue(rows),
  };
}

jest.mock('fs/promises', () => ({
  readdir: jest.fn(),
  stat: jest.fn(),
  readFile: jest.fn(),
}));

jest.mock('../../src/mongodb', () => ({
  getDbSafe: jest.fn().mockResolvedValue({
    collection: jest.fn((name) => {
      if (!mockCollections[name]) {
        throw new Error(`Unexpected collection: ${name}`);
      }
      return mockCollections[name];
    }),
  }),
}));

jest.mock('../../src/services/health-monitor', () => ({
  getSystemHealth: jest.fn(),
}));

jest.mock('../../src/services/memory-monitor', () => ({
  MemoryMonitor: jest.fn().mockImplementation(() => ({
    getMemoryStats: jest.fn(() => ({
      heapUsedMB: 120,
      heapTotalMB: 256,
      heapLimitMB: 2048,
      percentUsed: 6,
      rss: 180,
      heapTotal: 256,
      heapUsed: 120,
      external: 12,
      mallocedMemory: 5,
      peakMallocedMemory: 6,
      numberOfNativeContexts: 1,
      numberOfDetachedContexts: 0,
      uptimeSeconds: 3600,
      uptimeHours: 1,
    })),
    getMemoryReport: jest.fn(() => ({
      status: 'healthy',
      heap: { used: '120 MB', total: '256 MB', limit: '2048 MB', percentUsed: '6%' },
      process: { rss: '180 MB', external: '12 MB' },
      threshold: { warning: '1024 MB', critical: '1536 MB' },
      uptime: { seconds: 3600, hours: 1 },
      leakIndicators: { detachedContexts: 0, possibleLeak: false },
    })),
  })),
}));

jest.mock('../../src/worker-heartbeat', () => ({
  getWorkersStatus: jest.fn(),
}));

jest.mock('../../src/data', () => ({
  isMysqlAvailable: jest.fn(),
}));

jest.mock('../../src/processor/scheduled-job-worker', () => ({
  getScheduledJobWorker: jest.fn(),
}));

jest.mock('../../src/processor/delivery-worker-manager', () => ({
  getDeliveryWorkerManager: jest.fn(),
}));

describe('System Status Route', () => {
  let app;
  let healthMonitor;
  let fsPromises;
  let data;
  let workerHeartbeat;
  let scheduledJobWorker;
  let deliveryWorkerManager;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();

    healthMonitor = require('../../src/services/health-monitor');
    fsPromises = require('fs/promises');
    data = require('../../src/data');
    workerHeartbeat = require('../../src/worker-heartbeat');
    scheduledJobWorker = require('../../src/processor/scheduled-job-worker');
    deliveryWorkerManager = require('../../src/processor/delivery-worker-manager');

    mockCollections.pending_deliveries = {
      aggregate: jest.fn().mockReturnValue(makeAggregateCursor([
        { _id: 'PENDING', count: 4 },
        { _id: 'PROCESSING', count: 1 },
      ])),
    };
    mockCollections.failed_deliveries = {
      aggregate: jest.fn().mockReturnValue(makeAggregateCursor([
        { _id: 'pending', count: 2 },
        { _id: 'abandoned', count: 1 },
      ])),
    };
    mockCollections.scheduled_integrations = {
      aggregate: jest.fn().mockReturnValue(makeAggregateCursor([
        { _id: 'PENDING', count: 3 },
        { _id: 'SENT', count: 7 },
      ])),
    };

    const executionCountMap = new Map([
      ['300000', 3],
      ['900000', 9],
      ['3600000', 20],
      ['86400000', 250],
    ]);
    const eventCountMap = new Map([
      ['300000', 2],
      ['900000', 5],
      ['3600000', 11],
      ['86400000', 120],
    ]);

    mockCollections.execution_logs = {
      countDocuments: jest.fn(async (query) => {
        const delta = Date.now() - new Date(query.createdAt.$gte).getTime();
        return executionCountMap.get(String(delta)) ?? 0;
      }),
      aggregate: jest.fn().mockReturnValue(makeAggregateCursor([
        { _id: 'OUTBOUND', count: 13 },
        { _id: 'INBOUND', count: 7 },
      ])),
    };
    mockCollections.event_audit = {
      countDocuments: jest.fn(async (query) => {
        const delta = Date.now() - new Date(query.createdAt.$gte).getTime();
        return eventCountMap.get(String(delta)) ?? 0;
      }),
    };
    mockCollections.integration_configs = {
      aggregate: jest.fn().mockReturnValue(makeAggregateCursor([
        { _id: null, total: 4, active: 3, inactive: 1, cron: 2, interval: 2 },
      ])),
    };
    mockCollections.scheduled_job_logs = {
      find: jest.fn().mockReturnValue(makeFindCursor([
        {
          integrationId: { toString: () => 'job-1' },
          integrationName: 'Nightly Sync',
          status: 'SUCCESS',
          startedAt: new Date('2026-03-11T10:00:00.000Z'),
          completedAt: new Date('2026-03-11T10:00:04.000Z'),
          durationMs: 4000,
          recordsFetched: 150,
          correlationId: 'trace-job-1',
          orgId: 812,
        },
      ])),
    };

    healthMonitor.getSystemHealth.mockResolvedValue({
      status: 'warning',
      metrics: {
        delivery: {
          total24h: 250,
          successRate24h: 91.5,
          failedCount24h: 12,
          pendingCount: 4,
          retryingCount: 2,
        },
        performance: {
          p95ResponseTime: 420,
        },
        system: {
          uptime: {
            formatted: '1h 0m',
            uptime: 3600,
          },
        },
      },
      alertCount: {
        critical: 0,
        warning: 1,
        total: 1,
      },
      alerts: [
        {
          type: 'queue_growth',
          severity: 'warning',
          message: 'Queue size growing',
        },
      ],
      checks: {
        successRate: 'healthy',
        queueSize: 'warning',
      },
    });

    workerHeartbeat.getWorkersStatus.mockReturnValue({
      deliveryWorker: {
        workerName: 'deliveryWorker',
        displayName: 'Delivery Worker',
        enabled: true,
        running: true,
        alive: true,
        lastHeartbeat: '2026-03-11T10:10:00.000Z',
        meta: {},
      },
      schedulerWorker: {
        workerName: 'schedulerWorker',
        displayName: 'Scheduler Worker',
        enabled: true,
        running: true,
        alive: true,
        lastHeartbeat: '2026-03-11T10:10:00.000Z',
        meta: {},
      },
      pendingDeliveriesWorker: {
        workerName: 'pendingDeliveriesWorker',
        displayName: 'Pending Deliveries Worker',
        enabled: true,
        running: true,
        alive: true,
        lastHeartbeat: '2026-03-11T10:10:00.000Z',
        meta: { lastProcessedCount: 2 },
      },
      scheduledJobWorker: {
        workerName: 'scheduledJobWorker',
        displayName: 'Scheduled Job Worker',
        enabled: true,
        running: true,
        alive: true,
        lastHeartbeat: '2026-03-11T10:10:00.000Z',
        meta: { scheduledTaskCount: 3 },
      },
      dlqWorker: {
        workerName: 'dlqWorker',
        displayName: 'DLQ Worker',
        enabled: true,
        running: true,
        alive: false,
        lastHeartbeat: '2026-03-11T10:07:00.000Z',
        meta: { failed: 1 },
      },
    });

    data.isMysqlAvailable.mockReturnValue(true);

    scheduledJobWorker.getScheduledJobWorker.mockReturnValue({
      isRunning: true,
      scheduledTasks: new Map([['job-1', {}], ['job-2', {}], ['job-3', {}]]),
    });

    deliveryWorkerManager.getDeliveryWorkerManager.mockReturnValue({
      getStatus: jest.fn().mockResolvedValue({
        count: 2,
        refreshIntervalMs: 120000,
        lastSyncStartedAt: '2026-03-11T10:09:00.000Z',
        lastSyncFinishedAt: '2026-03-11T10:09:02.000Z',
        lastSyncErrorAt: null,
        lastSyncErrorMessage: null,
        desiredConfigs: [
          {
            orgId: 812,
            sourceType: 'mysql',
            configOrigin: 'explicit',
            configured: true,
            state: 'running',
            error: null,
          },
        ],
        adapters: [
          {
            orgId: 812,
            sourceType: 'mysql',
            adapterName: 'MysqlEventSource[org=812, table=notification_queue]',
            connectionStatus: 'connected',
            lastRowsFetched: 5,
            connectionProbe: { ok: true, responseTimeMs: 14 },
          },
          {
            orgId: 648,
            sourceType: 'http_push',
            adapterName: 'HttpPushAdapter[org=648]',
            connectionStatus: 'not_applicable',
          },
        ],
      }),
    });

    fsPromises.readdir.mockImplementation(async (dirPath) => {
      if (String(dirPath).includes('crash-markers')) {
        return ['abrupt-restart-2026-03-11T09-01-00-000Z-pid-1234.json'];
      }
      return [
        'app-2026-03-11.log',
        'access-2026-03-11.log',
      ];
    });
    fsPromises.stat.mockImplementation(async (fullPath) => ({
      mtimeMs: fullPath.includes('app-') ? Date.now() - 30_000 : Date.now() - 45_000,
      mtime: new Date(fullPath.includes('app-') ? Date.now() - 30_000 : Date.now() - 45_000),
      size: fullPath.includes('app-') ? 2048 : 4096,
    }));
    fsPromises.readFile.mockImplementation(async (fullPath) => {
      if (String(fullPath).endsWith('process-state.json')) {
        return JSON.stringify({
          status: 'running',
          pid: 4321,
          startedAt: '2026-03-11T09:00:00.000Z',
          updatedAt: '2026-03-11T10:10:00.000Z',
          metadata: {
            allowNaturalExit: true,
          },
        });
      }
      if (String(fullPath).includes('abrupt-restart-')) {
        return JSON.stringify({
          detectedAt: '2026-03-11T09:01:00.000Z',
          previousState: {
            pid: 1234,
            status: 'running',
            startedAt: '2026-03-11T08:00:00.000Z',
            updatedAt: '2026-03-11T08:59:00.000Z',
            metadata: {
              reason: null,
            },
          },
        });
      }
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    });

    const router = require('../../src/routes/system-status');
    app = express();
    app.use('/api/v1/system-status', router);
  });

  it('returns a rich system status payload for the requested org', async () => {
    const res = await request(app).get('/api/v1/system-status?orgId=812');

    expect(res.status).toBe(200);
    expect(res.body.orgId).toBe(812);
    expect(res.body.overall).toMatchObject({
      status: 'warning',
      summary: {
        deliveries24h: 250,
        successRate24h: 91.5,
        failed24h: 12,
      },
    });
    expect(res.body.workers.summary).toMatchObject({
      total: 5,
      healthy: 4,
      stale: 1,
    });
    expect(res.body.backlogs).toMatchObject({
      pendingDeliveries: { PENDING: 4, PROCESSING: 1 },
      dlq: { pending: 2, abandoned: 1 },
      scheduledIntegrations: { PENDING: 3, SENT: 7 },
    });
    expect(res.body.eventSources.summary).toMatchObject({
      total: 1,
      connected: 1,
    });
    expect(res.body.eventSources.configuration).toMatchObject({
      configured: true,
      sourceType: 'mysql',
      state: 'running',
    });
    expect(res.body.eventSources.orgAdapters).toEqual([
      expect.objectContaining({
        orgId: 812,
        sourceType: 'mysql',
        connectionStatus: 'connected',
      }),
    ]);
    expect(res.body.logs.app).toMatchObject({
      status: 'fresh',
      fileName: 'app-2026-03-11.log',
    });
    expect(res.body.processLifecycle.current).toMatchObject({
      status: 'running',
      pid: 4321,
      startedAt: '2026-03-11T09:00:00.000Z',
      updatedAt: '2026-03-11T10:10:00.000Z',
      allowNaturalExit: true,
    });
    expect(res.body.processLifecycle.abruptRestart).toMatchObject({
      detected: true,
      detectedAt: '2026-03-11T09:01:00.000Z',
      previousPid: 1234,
      previousStatus: 'running',
    });
    expect(res.body.scheduledJobs.summary).toMatchObject({
      total: 4,
      active: 3,
      inactive: 1,
    });
    expect(res.body.scheduledJobs.recentExecutions).toHaveLength(1);
  });

  it('requires orgId', async () => {
    const res = await request(app).get('/api/v1/system-status');

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      code: 'ORG_ID_REQUIRED',
    });
  });

  it('reports event source configuration as not_configured instead of down when the org has no adapter configured', async () => {
    deliveryWorkerManager.getDeliveryWorkerManager.mockReturnValue({
      getStatus: jest.fn().mockResolvedValue({
        count: 1,
        refreshIntervalMs: 120000,
        lastSyncStartedAt: '2026-03-11T10:09:00.000Z',
        lastSyncFinishedAt: '2026-03-11T10:09:02.000Z',
        lastSyncErrorAt: null,
        lastSyncErrorMessage: null,
        desiredConfigs: [],
        adapters: [
          {
            orgId: 648,
            sourceType: 'mysql',
            adapterName: 'MysqlEventSource[org=648]',
            connectionStatus: 'connected',
          },
        ],
      }),
    });

    const router = require('../../src/routes/system-status');
    app = express();
    app.use('/api/v1/system-status', router);

    const res = await request(app).get('/api/v1/system-status?orgId=812');

    expect(res.status).toBe(200);
    expect(res.body.eventSources.configuration).toEqual({
      configured: false,
      sourceType: null,
      configOrigin: null,
      state: 'not_configured',
      error: null,
    });
    expect(res.body.eventSources.summary).toEqual({ total: 0 });
    expect(res.body.eventSources.orgAdapters).toEqual([]);
  });

  it('returns default lifecycle data when no marker files exist', async () => {
    fsPromises.readdir.mockImplementation(async () => [
      'app-2026-03-11.log',
      'access-2026-03-11.log',
    ]);
    fsPromises.readFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

    const router = require('../../src/routes/system-status');
    app = express();
    app.use('/api/v1/system-status', router);

    const res = await request(app).get('/api/v1/system-status?orgId=812');

    expect(res.status).toBe(200);
    expect(res.body.processLifecycle.current.status).toBe('running');
    expect(res.body.processLifecycle.abruptRestart).toEqual({
      detected: false,
      detectedAt: null,
      previousPid: null,
      previousStatus: null,
      previousStartedAt: null,
      previousUpdatedAt: null,
      previousReason: null,
    });
  });
});
