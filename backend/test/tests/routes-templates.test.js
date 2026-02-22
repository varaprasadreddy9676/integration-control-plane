'use strict';

/**
 * Templates route integration tests
 * Tests CRUD operations for /api/v1/templates
 */

const express = require('express');
const request = require('supertest');

const mockTemplateDoc = {
  _id: { toString: () => 'template-123' },
  id: 'custom_template-123',
  orgId: 1,
  name: 'Webhook Template',
  category: 'webhooks',
  eventType: 'order.created',
  targetUrl: 'https://example.com/webhook',
  httpMethod: 'POST',
  authType: 'NONE',
  headers: {},
  timeoutMs: 15000,
  retryCount: 3,
  isActive: true,
  createdAt: new Date()
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
  security: { jwtSecret: 'test-secret' },
  worker: {}
}));

jest.mock('../../src/middleware/rate-limit', () => (_req, _res, next) => next());
jest.mock('../../src/middleware/request-id', () => (req, _res, next) => { req.id = 'req-test-id'; next(); });

jest.mock('../../src/middleware/audit', () => ({
  auditTemplate: {
    created: jest.fn(async () => {}),
    updated: jest.fn(async () => {}),
    deleted: jest.fn(async () => {})
  }
}));

const mockDataModule = {
  listCustomTemplates: jest.fn(async () => [mockTemplateDoc]),
  getCustomTemplate: jest.fn(async () => mockTemplateDoc),
  createTemplate: jest.fn(async () => mockTemplateDoc),
  updateTemplate: jest.fn(async () => mockTemplateDoc),
  deleteTemplate: jest.fn(async () => true),
  addIntegration: jest.fn(async () => ({ id: 'integration-123' })),
  listIntegrations: jest.fn(async () => [])
};
jest.mock('../../src/data', () => mockDataModule);

const mockTemplatesModule = {
  getTemplateCategories: jest.fn(async () => ['webhooks', 'api']),
  getTemplatesByCategory: jest.fn(async () => [mockTemplateDoc]),
  validateTemplate: jest.fn(async () => ({ valid: true, template: mockTemplateDoc, warnings: [] })),
  createIntegrationFromTemplate: jest.fn(async () => ({ name: 'Integration' })),
  getAllTemplates: jest.fn(async () => [mockTemplateDoc]),
  getTemplateById: jest.fn(async () => mockTemplateDoc)
};
jest.mock('../../src/data/templates', () => mockTemplatesModule);

function buildApp() {
  const app = express();
  app.use(express.json());

  app.use((req, _res, next) => {
    req.orgId = 1;
    next();
  });

  const templatesRouter = require('../../src/routes/templates');
  const errorHandler = require('../../src/middleware/error-handler');

  app.use('/api/v1/templates', templatesRouter);
  app.use(errorHandler);
  return app;
}

describe('Templates Routes', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = buildApp();
  });

  describe('GET /api/v1/templates', () => {
    it('returns 200 with list of templates', async () => {
      const res = await request(app).get('/api/v1/templates');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('templates');
      expect(res.body).toHaveProperty('total');
      expect(Array.isArray(res.body.templates)).toBe(true);
    });

    it('filters by category', async () => {
      const res = await request(app).get('/api/v1/templates?category=webhooks');
      expect(res.status).toBe(200);
    });
  });

  describe('POST /api/v1/templates', () => {
    it('returns 201 when creating valid template', async () => {
      const res = await request(app)
        .post('/api/v1/templates')
        .send({
          name: 'New Template',
          category: 'webhooks',
          eventType: 'order.created',
          targetUrl: 'https://example.com',
          httpMethod: 'POST',
          authType: 'NONE'
        });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('message', 'Template created successfully');
      expect(res.body).toHaveProperty('template');
    });

    it('returns 400 when required fields missing', async () => {
      const res = await request(app)
        .post('/api/v1/templates')
        .send({ name: 'Incomplete' });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error', 'Missing required fields');
      expect(res.body).toHaveProperty('required');
    });
  });

  describe('GET /api/v1/templates/:templateId', () => {
    it('returns 200 when template exists', async () => {
      const res = await request(app).get('/api/v1/templates/template-123');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('template');
    });

    it('returns 404 when template not found', async () => {
      mockDataModule.getCustomTemplate.mockResolvedValueOnce(null);
      const res = await request(app).get('/api/v1/templates/nonexistent');
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('code', 'TEMPLATE_NOT_FOUND');
    });
  });

  describe('PUT /api/v1/templates/:templateId', () => {
    it('returns 200 when updating custom template', async () => {
      const res = await request(app)
        .put('/api/v1/templates/custom_123')
        .send({ name: 'Updated Template' });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('message', 'Template updated successfully');
    });

    it('returns 403 when trying to update built-in template', async () => {
      const res = await request(app)
        .put('/api/v1/templates/builtin_123')
        .send({ name: 'Updated' });

      expect(res.status).toBe(403);
      expect(res.body).toHaveProperty('code', 'FORBIDDEN');
    });

    it('returns 404 when custom template not found', async () => {
      mockDataModule.updateTemplate.mockResolvedValueOnce(null);
      const res = await request(app)
        .put('/api/v1/templates/custom_999')
        .send({ name: 'Updated' });

      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /api/v1/templates/:templateId', () => {
    it('returns 200 when deleting custom template', async () => {
      const res = await request(app).delete('/api/v1/templates/custom_123');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('message', 'Template deleted successfully');
    });

    it('returns 403 when trying to delete built-in template', async () => {
      const res = await request(app).delete('/api/v1/templates/builtin_123');
      expect(res.status).toBe(403);
    });

    it('returns 404 when custom template not found', async () => {
      mockDataModule.deleteTemplate.mockResolvedValueOnce(false);
      const res = await request(app).delete('/api/v1/templates/custom_999');
      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/v1/templates/categories', () => {
    it('returns 200 with template categories', async () => {
      const res = await request(app).get('/api/v1/templates/categories');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('categories');
    });
  });
});
