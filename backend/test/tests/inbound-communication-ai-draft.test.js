const express = require('express');
const request = require('supertest');
const axios = require('axios');

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

jest.mock('../../src/data', () => ({
  recordLog: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../src/processor/auth-helper', () => ({ buildAuthHeaders: jest.fn() }));
jest.mock('axios', () => jest.fn());
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
const { applyTransform } = require('../../src/services/transformer');
const { buildAuthHeaders } = require('../../src/processor/auth-helper');
const { createExecutionLogger } = require('../../src/utils/execution-logger');

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
    createExecutionLogger.mockReturnValue({
      start: jest.fn().mockResolvedValue(undefined),
      addStep: jest.fn().mockResolvedValue(undefined),
      updateStatus: jest.fn().mockResolvedValue(undefined),
      fail: jest.fn().mockResolvedValue(undefined),
      success: jest.fn().mockResolvedValue(undefined),
    });
    buildAuthHeaders.mockResolvedValue({});
    axios.mockResolvedValue({
      status: 200,
      data: { ok: true },
      headers: {},
    });
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

  it('persists maxInboundFileSizeMb when provided for multipart inbound integrations', async () => {
    const response = await request(app)
      .post('/?orgId=84')
      .send({
        direction: 'INBOUND',
        name: 'Lab Attachment Inbound',
        type: 'lab-attachment',
        targetUrl: 'https://example.com/lab/upload',
        httpMethod: 'POST',
        contentType: 'multipart/form-data',
        maxInboundFileSizeMb: 25,
      });

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(mockIntegrationCollection.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        maxInboundFileSizeMb: 25,
      })
    );
  });

  it('rejects maxInboundFileSizeMb outside allowed range', async () => {
    const response = await request(app)
      .post('/?orgId=84')
      .send({
        direction: 'INBOUND',
        name: 'Lab Attachment Too Large',
        type: 'lab-attachment-too-large',
        targetUrl: 'https://example.com/lab/upload',
        httpMethod: 'POST',
        contentType: 'multipart/form-data',
        maxInboundFileSizeMb: 250,
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('maxInboundFileSizeMb must be between 1 and 100');
    expect(mockIntegrationCollection.insertOne).not.toHaveBeenCalled();
  });

  it('persists lookup configs for inbound integrations', async () => {
    const response = await request(app)
      .post('/?orgId=84')
      .send({
        direction: 'INBOUND',
        name: 'Pathkind Result Inbound',
        type: 'pathkind-result-inbound',
        targetUrl: 'https://medicsprime.in/api/lab',
        httpMethod: 'POST',
        lookups: [
          {
            type: 'PATHKIND_TEST_TO_GRID_TEST',
            sourceTemplate: '{{sourceContext.vendorCode}}|{{sourceContext.externalTestCode}}',
            targetField: 'gridTestCode',
            targetValueField: 'code',
            unmappedBehavior: 'FAIL',
          },
        ],
      });

    expect(response.status).toBe(201);
    expect(mockIntegrationCollection.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        lookups: [
          expect.objectContaining({
            type: 'PATHKIND_TEST_TO_GRID_TEST',
            sourceTemplate: '{{sourceContext.vendorCode}}|{{sourceContext.externalTestCode}}',
            targetField: 'gridTestCode',
            targetValueField: 'code',
          }),
        ],
      })
    );
  });

  it('passes inbound lookups into request transformation at runtime', async () => {
    mockIntegrationCollection.findOne.mockResolvedValue({
      _id: { toString: () => '507f1f77bcf86cd799439012' },
      name: 'Pathkind Result Runtime',
      type: 'pathkind-result-runtime',
      direction: 'INBOUND',
      orgId: 84,
      isActive: true,
      targetUrl: 'https://medicsprime.in/api/lab',
      httpMethod: 'POST',
      requestTransformation: {
        mode: 'SCRIPT',
        script: 'return payload;',
      },
      responseTransformation: null,
      lookups: [
        {
          type: 'PATHKIND_TEST_TO_GRID_TEST',
          sourceTemplate: '{{sourceContext.vendorCode}}|{{sourceContext.externalTestCode}}',
          targetField: 'gridTestCode',
          targetValueField: 'code',
          unmappedBehavior: 'FAIL',
        },
      ],
      outgoingAuthType: 'NONE',
      outgoingAuthConfig: {},
      retryCount: 1,
      timeout: 5000,
      contentType: 'application/json',
      streamResponse: false,
    });
    applyTransform.mockResolvedValue({
      gridTestCode: 'LAB001',
      gridTestName: 'HAEMOGLOBIN',
    });

    const response = await request(app)
      .post('/pathkind-result-runtime?orgId=84')
      .send({
        ResultData: [{ TestCode: 'HB', TestResult: '13.2' }],
      });

    expect(response.status).toBe(200);
    expect(applyTransform).toHaveBeenCalledWith(
      expect.objectContaining({
        lookups: [
          expect.objectContaining({
            type: 'PATHKIND_TEST_TO_GRID_TEST',
            targetValueField: 'code',
          }),
        ],
      }),
      expect.any(Object),
      expect.objectContaining({
        eventType: 'pathkind-result-runtime',
        orgId: 84,
      })
    );
  });
});
