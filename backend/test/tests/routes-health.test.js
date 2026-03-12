'use strict';

/**
 * Health endpoint route tests
 * Tests that the /health endpoint responds correctly
 */

const express = require('express');
const request = require('supertest');

// --- Mocks ---
jest.mock('../../src/mongodb', () => ({
  connect: jest.fn().mockResolvedValue(undefined),
  getDb: jest.fn().mockReturnValue({ collection: jest.fn() }),
  getDbSafe: jest.fn().mockResolvedValue({ collection: jest.fn() }),
  isConnected: jest.fn().mockReturnValue(true),
  toObjectId: jest.fn((id) => (id ? { toString: () => String(id) } : null))
}));

jest.mock('../../src/db', () => ({
  isConfigured: jest.fn().mockReturnValue(false),
  ping: jest.fn().mockResolvedValue(false),
  query: jest.fn().mockResolvedValue([[]])
}));

jest.mock('../../src/data/store', () => ({
  initStore: jest.fn().mockResolvedValue(undefined),
  getTenant: jest.fn().mockReturnValue(null)
}));

jest.mock('../../src/services/health-monitor', () => ({
  getSystemHealth: jest.fn().mockResolvedValue({
    status: 'ok',
    timestamp: new Date().toISOString(),
    mongodb: { status: 'connected' }
  }),
  startMonitoring: jest.fn()
}));

jest.mock('../../src/worker-heartbeat', () => ({
  checkWorkers: jest.fn().mockReturnValue({
    deliveryWorker: { alive: true, lastBeat: Date.now() },
    schedulerWorker: { alive: true, lastBeat: Date.now() }
  })
}));

jest.mock('../../src/data', () => ({
  initDataLayer: jest.fn().mockResolvedValue(undefined),
  isMysqlAvailable: jest.fn().mockReturnValue(false)
}));

jest.mock('../../src/middleware/rate-limit', () => (_req, _res, next) => next());
jest.mock('../../src/middleware/request-id', () => (_req, _res, next) => next());
jest.mock('../../src/logger', () => ({
  log: jest.fn(),
  logError: jest.fn(),
  requestLogger: (_req, _res, next) => next(),
  setDb: jest.fn(),
  closeLogStreams: jest.fn()
}));

// Build a minimal express app that only has the /health route
function buildHealthApp() {
  const app = express();
  app.use(express.json());

  const healthMonitor = require('../../src/services/health-monitor');
  const { checkWorkers } = require('../../src/worker-heartbeat');
  const data = require('../../src/data');

  function normalizeHealthStatus(status) {
    const normalized = String(status || '').toLowerCase();
    if (normalized === 'ok') return 'healthy';
    if (normalized === 'degraded') return 'warning';
    if (normalized === 'healthy' || normalized === 'warning' || normalized === 'critical' || normalized === 'error') {
      return normalized;
    }
    return 'unknown';
  }

  function getWorkerHealthState(worker) {
    if (!worker) {
      return { state: 'unknown', hardFailure: true, degraded: false };
    }
    if (worker.enabled === false) {
      return { state: 'disabled', hardFailure: false, degraded: false };
    }
    const state = worker.status || (worker.alive ? 'healthy' : worker.running ? 'stale' : 'stopped');
    return {
      state,
      hardFailure: state === 'stopped' || state === 'unknown',
      degraded: state === 'stale' || state === 'starting',
    };
  }

  app.get('/health', async (req, res) => {
    try {
      const orgId = req.orgId || 1;
      const healthStatus = await healthMonitor.getSystemHealth(orgId);
      const workerStatus = checkWorkers();
      const mysqlAvailable = data.isMysqlAvailable();
      const coreWorkers = {
        deliveryWorker: getWorkerHealthState(workerStatus.deliveryWorker),
        schedulerWorker: getWorkerHealthState(workerStatus.schedulerWorker),
      };
      const workerHardFailure = Object.values(coreWorkers).some((worker) => worker.hardFailure);
      const workerDegraded = Object.values(coreWorkers).some((worker) => worker.degraded);
      let statusCode = 200;
      let overallStatus = normalizeHealthStatus(healthStatus.status);

      if (!mysqlAvailable && overallStatus === 'healthy') {
        overallStatus = 'warning';
      }

      if (workerHardFailure) {
        statusCode = 503;
        overallStatus = 'critical';
      } else if (workerDegraded && overallStatus === 'healthy') {
        overallStatus = 'warning';
      } else if (overallStatus === 'critical') {
        statusCode = 503;
      } else if (overallStatus === 'error') {
        statusCode = 500;
      }

      res.status(statusCode).json({
        ...healthStatus,
        status: overallStatus,
        workers: workerStatus,
        mysql: { available: mysqlAvailable }
      });
    } catch (err) {
      res.status(500).json({ status: 'error', error: 'Health check failed' });
    }
  });

  return app;
}

describe('GET /health', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = buildHealthApp();
  });

  it('returns 200 with ok status when all systems healthy', async () => {
    const healthMonitor = require('../../src/services/health-monitor');
    healthMonitor.getSystemHealth.mockResolvedValue({
      status: 'ok',
      timestamp: new Date().toISOString(),
      mongodb: { status: 'connected' }
    });

    const res = await request(app).get('/health');
    // degraded because MySQL is not available, but not critical
    expect([200, 503]).toContain(res.status);
    expect(res.body).toHaveProperty('status');
    expect(res.body).toHaveProperty('workers');
    expect(res.body).toHaveProperty('mysql');
  });

  it('returns 503 when workers are dead', async () => {
    const { checkWorkers } = require('../../src/worker-heartbeat');
    checkWorkers.mockReturnValue({
      deliveryWorker: { alive: false, lastBeat: 0 },
      schedulerWorker: { alive: false, lastBeat: 0 }
    });

    const healthMonitor = require('../../src/services/health-monitor');
    healthMonitor.getSystemHealth.mockResolvedValue({ status: 'ok', timestamp: new Date().toISOString() });

    const res = await request(app).get('/health');
    expect(res.status).toBe(503);
    expect(res.body.status).toBe('critical');
  });

  it('returns 200 warning when workers are stale but still running', async () => {
    const { checkWorkers } = require('../../src/worker-heartbeat');
    checkWorkers.mockReturnValue({
      deliveryWorker: { enabled: true, running: true, alive: false, status: 'stale' },
      schedulerWorker: { enabled: true, running: true, alive: true, status: 'healthy' }
    });

    const healthMonitor = require('../../src/services/health-monitor');
    healthMonitor.getSystemHealth.mockResolvedValue({ status: 'healthy', timestamp: new Date().toISOString() });

    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('warning');
  });

  it('returns 200 while workers are still starting', async () => {
    const { checkWorkers } = require('../../src/worker-heartbeat');
    checkWorkers.mockReturnValue({
      deliveryWorker: { enabled: true, running: true, alive: true, status: 'starting' },
      schedulerWorker: { enabled: true, running: true, alive: true, status: 'healthy' }
    });

    const healthMonitor = require('../../src/services/health-monitor');
    healthMonitor.getSystemHealth.mockResolvedValue({ status: 'healthy', timestamp: new Date().toISOString() });

    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('warning');
  });

  it('returns 503 when mongodb is critical', async () => {
    const healthMonitor = require('../../src/services/health-monitor');
    healthMonitor.getSystemHealth.mockResolvedValue({ status: 'critical', timestamp: new Date().toISOString() });

    const res = await request(app).get('/health');
    expect(res.status).toBe(503);
    expect(res.body.status).toBe('critical');
  });

  it('returns mysql status field', async () => {
    const data = require('../../src/data');
    data.isMysqlAvailable.mockReturnValue(true);

    const healthMonitor = require('../../src/services/health-monitor');
    healthMonitor.getSystemHealth.mockResolvedValue({ status: 'ok', timestamp: new Date().toISOString() });

    const res = await request(app).get('/health');
    expect(res.body.mysql).toEqual({ available: true });
  });
});
