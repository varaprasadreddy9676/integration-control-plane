'use strict';

/**
 * Scheduled Jobs route integration tests
 * Tests CRUD operations for /api/v1/scheduled-jobs
 */

const express = require('express');
const request = require('supertest');
const { createMockDb } = require('./helpers/mock-mongodb');

// Valid ObjectId format (24 hex chars) — required by the native mongodb driver
const VALID_JOB_ID = '507f1f77bcf86cd799439011';
const VALID_LOG_ID = '507f1f77bcf86cd799439022';

const mockJobDoc = {
  _id: { toString: () => VALID_JOB_ID },
  orgId: 1,
  name: 'Daily Export',
  direction: 'SCHEDULED',
  schedule: { type: 'CRON', expression: '0 0 * * *' },
  dataSource: { type: 'MySQL', host: 'localhost' },
  targetUrl: 'https://webhook.example.com',
  httpMethod: 'POST',
  isActive: true,
  createdAt: new Date()
};

const mockDb = createMockDb();

jest.mock('../../src/mongodb', () => ({
  getDb: jest.fn(async () => mockDb),
  getDbSafe: jest.fn(async () => mockDb),
  isConnected: jest.fn(() => true),
  toObjectId: jest.fn((id) => (id ? { toString: () => String(id) } : null)),
  ObjectId: class MockObjectId {
    constructor(id) { this.id = id; }
    toString() { return String(this.id); }
  }
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
  security: { jwtSecret: 'test-secret' },
  worker: {}
}));

jest.mock('../../src/middleware/rate-limit', () => (_req, _res, next) => next());
jest.mock('../../src/middleware/request-id', () => (req, _res, next) => { req.id = 'req-test-id'; next(); });

jest.mock('../../src/middleware/audit', () => ({
  auditScheduledJob: {
    created: jest.fn(async () => {}),
    updated: jest.fn(async () => {}),
    deleted: jest.fn(async () => {}),
    executed: jest.fn(async () => {})
  }
}));

jest.mock('node-cron', () => ({
  validate: jest.fn((expr) => expr && expr.length > 0)
}));

jest.mock('../../src/processor/scheduled-job-worker', () => ({
  getScheduledJobWorker: jest.fn(() => ({
    scheduleJob: jest.fn(),
    unscheduleJob: jest.fn(),
    executeJob: jest.fn()
  }))
}));

jest.mock('../../src/services/data-source-executor', () => ({
  executeDataSource: jest.fn(async () => [{ id: 1, name: 'Record 1' }])
}));

function buildApp() {
  const app = express();
  app.use(express.json());

  app.use((req, _res, next) => {
    req.orgId = 1;
    req.entityParentRid = 1;
    next();
  });

  const scheduledJobsRouter = require('../../src/routes/scheduled-jobs');
  const errorHandler = require('../../src/middleware/error-handler');

  app.use('/api/v1/scheduled-jobs', scheduledJobsRouter);
  app.use(errorHandler);
  return app;
}

describe('Scheduled Jobs Routes', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = buildApp();

    const configCollection = mockDb.collection('integration_configs');
    configCollection.find.mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      toArray: jest.fn(async () => [mockJobDoc])
    });
    configCollection.findOne.mockResolvedValue(mockJobDoc);
    configCollection.insertOne.mockResolvedValue({ insertedId: VALID_JOB_ID });
    configCollection.findOneAndUpdate.mockResolvedValue(mockJobDoc);
    configCollection.deleteOne.mockResolvedValue({ deletedCount: 1 });

    const logsCollection = mockDb.collection('scheduled_job_logs');
    logsCollection.findOne.mockResolvedValue(null);
    logsCollection.find.mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      toArray: jest.fn(async () => [])
    });
    logsCollection.countDocuments.mockResolvedValue(0);
  });

  describe('GET /api/v1/scheduled-jobs', () => {
    it('returns 200 with list of jobs', async () => {
      const res = await request(app).get('/api/v1/scheduled-jobs');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe('POST /api/v1/scheduled-jobs', () => {
    it('returns 201 when creating valid job', async () => {
      const res = await request(app)
        .post('/api/v1/scheduled-jobs')
        .send({
          name: 'New Job',
          schedule: { type: 'CRON', expression: '0 0 * * *' },
          dataSource: { type: 'MySQL', host: 'localhost' },
          targetUrl: 'https://webhook.example.com'
        });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('name', 'New Job');
    });

    it('returns 400 when name is missing', async () => {
      const res = await request(app)
        .post('/api/v1/scheduled-jobs')
        .send({
          schedule: { type: 'CRON', expression: '0 0 * * *' },
          dataSource: { type: 'MySQL' },
          targetUrl: 'https://webhook.example.com'
        });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
    });

    it('returns 400 when schedule is missing', async () => {
      const res = await request(app)
        .post('/api/v1/scheduled-jobs')
        .send({
          name: 'Incomplete Job',
          dataSource: { type: 'MySQL' },
          targetUrl: 'https://webhook.example.com'
        });

      expect(res.status).toBe(400);
    });

    it('returns 400 when dataSource is missing', async () => {
      const res = await request(app)
        .post('/api/v1/scheduled-jobs')
        .send({
          name: 'No Source',
          schedule: { type: 'CRON', expression: '0 0 * * *' },
          targetUrl: 'https://webhook.example.com'
        });

      expect(res.status).toBe(400);
    });

    it('returns 400 when targetUrl is missing', async () => {
      const res = await request(app)
        .post('/api/v1/scheduled-jobs')
        .send({
          name: 'No Target',
          schedule: { type: 'CRON', expression: '0 0 * * *' },
          dataSource: { type: 'MySQL' }
        });

      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/v1/scheduled-jobs/:id', () => {
    it('returns 200 when job exists', async () => {
      const res = await request(app).get(`/api/v1/scheduled-jobs/${VALID_JOB_ID}`);
      expect(res.status).toBe(200);
    });

    it('returns 404 when job not found', async () => {
      mockDb.collection('integration_configs').findOne.mockResolvedValueOnce(null);
      const res = await request(app).get(`/api/v1/scheduled-jobs/${VALID_JOB_ID}`);
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('error', 'Scheduled job not found');
    });
  });

  describe('PUT /api/v1/scheduled-jobs/:id', () => {
    it('returns 200 when updating job', async () => {
      const res = await request(app)
        .put(`/api/v1/scheduled-jobs/${VALID_JOB_ID}`)
        .send({ name: 'Updated Job' });

      expect(res.status).toBe(200);
    });

    it('returns 404 when job not found', async () => {
      mockDb.collection('integration_configs').findOneAndUpdate.mockResolvedValueOnce(null);
      mockDb.collection('integration_configs').findOne.mockResolvedValueOnce(null);

      const res = await request(app)
        .put(`/api/v1/scheduled-jobs/${VALID_JOB_ID}`)
        .send({ name: 'Updated' });

      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /api/v1/scheduled-jobs/:id', () => {
    it('returns 200 when deleting job', async () => {
      const res = await request(app).delete(`/api/v1/scheduled-jobs/${VALID_JOB_ID}`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('message', 'Scheduled job deleted successfully');
    });

    it('returns 404 when job not found', async () => {
      mockDb.collection('integration_configs').deleteOne.mockResolvedValueOnce({ deletedCount: 0 });
      const res = await request(app).delete(`/api/v1/scheduled-jobs/${VALID_JOB_ID}`);
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/v1/scheduled-jobs/:id/execute', () => {
    it('returns 200 when manually executing job', async () => {
      const res = await request(app).post(`/api/v1/scheduled-jobs/${VALID_JOB_ID}/execute`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('message', 'Job execution triggered');
    });

    it('returns 404 when job not found', async () => {
      mockDb.collection('integration_configs').findOne.mockResolvedValueOnce(null);
      const res = await request(app).post(`/api/v1/scheduled-jobs/${VALID_JOB_ID}/execute`);
      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/v1/scheduled-jobs/:id/logs', () => {
    it('returns 200 with execution logs', async () => {
      const res = await request(app).get(`/api/v1/scheduled-jobs/${VALID_JOB_ID}/logs`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });
});
