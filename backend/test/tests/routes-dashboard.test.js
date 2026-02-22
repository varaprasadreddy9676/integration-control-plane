'use strict';

/**
 * Dashboard route integration tests
 * Tests for /api/v1/dashboard
 */

const express = require('express');
const request = require('supertest');

const mockDashboardSummary = {
  totalEvents: 1000,
  totalDeliveries: 950,
  failedDeliveries: 50,
  pendingDeliveries: 10,
  avgLatencyMs: 250
};

jest.mock('../../src/mongodb', () => ({
  getDb: jest.fn(),
  getDbSafe: jest.fn(),
  isConnected: jest.fn(() => true)
}));

jest.mock('../../src/db', () => ({
  isConfigured: jest.fn(() => false),
  ping: jest.fn(async () => false)
}));

jest.mock('../../src/data/store', () => ({
  initStore: jest.fn(async () => {}),
  getTenant: jest.fn(() => null),
  findTenantByChildRid: jest.fn(() => null)
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
  security: { jwtSecret: 'test-secret', apiKey: 'test-api-key' },
  frontendUrl: 'http://localhost:5174',
  dailyReports: { apiKey: 'test-api-key' },
  worker: {}
}));

jest.mock('../../src/middleware/rate-limit', () => (_req, _res, next) => next());
jest.mock('../../src/middleware/request-id', () => (req, _res, next) => { req.id = 'req-test-id'; next(); });

const mockDataModule = {
  getDashboardSummary: jest.fn(async () => mockDashboardSummary),
  getTenant: jest.fn(async () => ({ tenantName: 'Test Org' }))
};
jest.mock('../../src/data', () => mockDataModule);

const mockEmailService = {
  sendDailyReport: jest.fn(async () => ({
    success: true,
    recipients: ['test@example.com'],
    messageId: 'msg-123'
  }))
};
jest.mock('../../src/services/email-service', () => mockEmailService);

const mockDashboardCapture = {
  getDashboardSummary: jest.fn(async () => mockDashboardSummary),
  captureDashboard: jest.fn(async () => Buffer.from('pdf-data'))
};
jest.mock('../../src/services/dashboard-capture', () => mockDashboardCapture);

function buildApp() {
  const app = express();
  app.use(express.json());

  app.use((req, _res, next) => {
    req.orgId = 1;
    next();
  });

  const dashboardRouter = require('../../src/routes/dashboard');
  const errorHandler = require('../../src/middleware/error-handler');

  app.use('/api/v1/dashboard', dashboardRouter);
  app.use(errorHandler);
  return app;
}

describe('Dashboard Routes', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = buildApp();
  });

  describe('GET /api/v1/dashboard', () => {
    it('returns 200 with dashboard summary', async () => {
      const res = await request(app).get('/api/v1/dashboard');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('totalEvents', 1000);
      expect(res.body).toHaveProperty('totalDeliveries', 950);
      expect(res.body).toHaveProperty('failedDeliveries', 50);
    });

    it('calls getDashboardSummary with orgId', async () => {
      await request(app).get('/api/v1/dashboard');
      expect(mockDataModule.getDashboardSummary).toHaveBeenCalledWith(1);
    });
  });

  describe('POST /api/v1/dashboard/send-email', () => {
    it('returns 200 when sending dashboard email', async () => {
      const res = await request(app)
        .post('/api/v1/dashboard/send-email')
        .send({
          recipients: ['admin@example.com'],
          days: 1,
          includePdf: false
        });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);
      expect(res.body).toHaveProperty('message', 'Dashboard email sent successfully');
    });

    it('returns 400 when recipients array is empty', async () => {
      const res = await request(app)
        .post('/api/v1/dashboard/send-email')
        .send({ recipients: [], days: 1 });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error', 'Recipients array is required');
    });

    it('returns 400 when recipients is missing', async () => {
      const res = await request(app)
        .post('/api/v1/dashboard/send-email')
        .send({ days: 1 });

      expect(res.status).toBe(400);
    });

    it('returns 400 when email format is invalid', async () => {
      const res = await request(app)
        .post('/api/v1/dashboard/send-email')
        .send({ recipients: ['not-an-email'], days: 1 });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid email');
    });

    it('returns 500 when email service fails', async () => {
      mockEmailService.sendDailyReport.mockResolvedValueOnce({
        success: false,
        error: 'SMTP connection failed'
      });

      const res = await request(app)
        .post('/api/v1/dashboard/send-email')
        .send({ recipients: ['admin@example.com'] });

      expect(res.status).toBe(500);
    });
  });
});
