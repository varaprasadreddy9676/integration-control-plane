const express = require('express');
const request = require('supertest');

const mockIntegrationCollection = {
  findOne: jest.fn(),
  insertOne: jest.fn(),
  updateOne: jest.fn()
};

jest.mock('../../src/mongodb', () => ({
  getDbSafe: jest.fn().mockResolvedValue({
    collection: jest.fn((name) => {
      if (name === 'integration_configs') return mockIntegrationCollection;
      return mockIntegrationCollection;
    })
  })
}));

jest.mock('../../src/data', () => ({}));
jest.mock('../../src/processor/auth-helper', () => ({ buildAuthHeaders: jest.fn() }));
jest.mock('../../src/services/transformer', () => ({
  applyTransform: jest.fn(),
  applyResponseTransform: jest.fn()
}));
jest.mock('../../src/utils/execution-logger', () => ({
  createExecutionLogger: jest.fn()
}));
jest.mock('../../src/middleware/rate-limiter', () => ({
  checkRateLimit: jest.fn()
}));
jest.mock('../../src/services/communication/adapter-registry', () => ({
  send: jest.fn()
}));

const integrationsRouter = require('../../src/routes/integrations');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.orgId = 84;
    req.user = { username: 'test-user' };
    next();
  });
  app.use('/', integrationsRouter);
  return app;
}

describe('Inbound COMMUNICATION AI Draft compatibility', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = buildApp();
    mockIntegrationCollection.findOne.mockResolvedValue(null);
    mockIntegrationCollection.insertOne.mockResolvedValue({ insertedId: { toString: () => '507f1f77bcf86cd799439011' } });
    mockIntegrationCollection.updateOne.mockResolvedValue({ matchedCount: 1 });
  });

  it('creates inbound email integration when AI draft includes valid SMTP action', async () => {
    const response = await request(app)
      .post('/?orgId=84')
      .send({
        direction: 'INBOUND',
        name: 'Unity Hospital Email Notifications',
        type: 'unity-hospital-email-notifications',
        inboundAuthType: 'NONE',
        inboundAuthConfig: {},
        actions: [
          {
            name: 'Send EMAIL',
            kind: 'COMMUNICATION',
            communicationConfig: {
              channel: 'EMAIL',
              provider: 'SMTP',
              smtp: {
                host: 'smtp.bzsecure.in',
                port: 587,
                username: 'maintenance@unityhospital.in',
                password: 'Republic@2026',
                fromEmail: 'maintenance@unityhospital.in'
              }
            }
          }
        ]
      });

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(mockIntegrationCollection.insertOne).toHaveBeenCalled();
  });

  it('rejects COMMUNICATION SMTP draft missing fromEmail', async () => {
    const response = await request(app)
      .post('/?orgId=84')
      .send({
        direction: 'INBOUND',
        name: 'Broken SMTP Integration',
        type: 'broken-smtp-integration',
        inboundAuthType: 'NONE',
        actions: [
          {
            name: 'Send EMAIL',
            kind: 'COMMUNICATION',
            communicationConfig: {
              channel: 'EMAIL',
              provider: 'SMTP',
              smtp: {
                host: 'smtp.bzsecure.in',
                port: 587,
                username: 'maintenance@unityhospital.in',
                password: 'Republic@2026'
              }
            }
          }
        ]
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('communicationConfig.smtp.fromEmail');
    expect(mockIntegrationCollection.insertOne).not.toHaveBeenCalled();
  });

  it('rejects HTTP-style inbound draft missing targetUrl', async () => {
    const response = await request(app)
      .post('/?orgId=84')
      .send({
        direction: 'INBOUND',
        name: 'Inbound HTTP',
        type: 'inbound-http',
        inboundAuthType: 'NONE'
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('targetUrl');
  });
});
