'use strict';

const express = require('express');
const request = require('supertest');

const mockFindOne = jest.fn();
const mockRecordLog = jest.fn();
const mockAxios = jest.fn();

jest.mock('../../src/mongodb', () => ({
  getDbSafe: jest.fn().mockResolvedValue({
    collection: jest.fn(() => ({
      findOne: mockFindOne,
    })),
  }),
}));

jest.mock('../../src/data', () => ({
  recordLog: (...args) => mockRecordLog(...args),
}));

jest.mock('../../src/config', () => ({
  logging: {},
}));

jest.mock('../../src/processor/auth-helper', () => ({
  buildAuthHeaders: jest.fn().mockResolvedValue({}),
  clearCachedToken: jest.fn(),
}));

jest.mock('../../src/services/transformer', () => ({
  applyTransform: jest.fn(async (_integration, payload) => payload),
  applyResponseTransform: jest.fn(async (_integration, payload) => payload),
}));

jest.mock('../../src/logger', () => ({
  log: jest.fn(),
}));

jest.mock('../../src/utils/execution-logger', () => ({
  createExecutionLogger: jest.fn(() => ({
    start: jest.fn().mockResolvedValue(undefined),
    addStep: jest.fn().mockResolvedValue(undefined),
    updateStatus: jest.fn().mockResolvedValue(undefined),
    fail: jest.fn().mockResolvedValue(undefined),
    success: jest.fn().mockResolvedValue(undefined),
  })),
}));

jest.mock('../../src/services/communication/adapter-registry', () => ({}));
jest.mock('../../src/services/lookup-validator', () => ({
  validateLookupConfigs: jest.fn(),
}));
jest.mock('../../src/services/communication/sender-routing', () => ({
  isSenderRoutingEnabled: jest.fn(() => false),
  resolveSenderRoute: jest.fn(),
}));
jest.mock('../../src/services/request-policy', () => ({
  normalizeRateLimit: jest.fn((value) => value),
  normalizeRequestPolicy: jest.fn((value) => value),
  validateRequestPolicy: jest.fn(() => null),
  evaluateInboundRequestPolicy: jest.fn(async () => ({
    allowed: true,
    headers: null,
    metadata: {},
  })),
}));

jest.mock('axios', () => mockAxios);

const {
  generateSigningSecret,
  generateSignatureHeaders,
} = require('../../src/services/integration-signing');
const inboundRouter = require('../../src/routes/integrations');

function createApp() {
  const app = express();
  app.use(
    express.json({
      verify: (req, _res, buf, encoding) => {
        req.rawBody = buf.length > 0 ? buf.toString(encoding || 'utf8') : '';
      },
    })
  );
  app.use((req, _res, next) => {
    req.id = 'req-hmac-test';
    next();
  });
  app.post('/api/v1/public/integrations/:type', inboundRouter.parseInboundRuntimeRequest, inboundRouter.handleInboundRuntime);
  return app;
}

describe('inbound integrations HMAC auth', () => {
  const payload = { orderId: 'ord-1001', total: 99.5 };
  const secret = generateSigningSecret();

  beforeEach(() => {
    jest.clearAllMocks();
    mockFindOne.mockResolvedValue({
      _id: { toString: () => 'integration-123' },
      name: 'Inbound HMAC',
      type: 'ORDER_CREATED',
      direction: 'INBOUND',
      isActive: true,
      orgId: 84,
      httpMethod: 'POST',
      targetUrl: 'https://example.com/upstream',
      outgoingAuthType: 'NONE',
      requestTransformation: { mode: 'SCRIPT', script: '' },
      responseTransformation: { mode: 'SCRIPT', script: '' },
      retryCount: 1,
      inboundAuthType: 'HMAC',
      inboundAuthConfig: {
        secret,
      },
    });
    mockAxios.mockResolvedValue({
      status: 200,
      data: { ok: true },
      headers: { 'content-type': 'application/json' },
    });
    mockRecordLog.mockResolvedValue('log-1');
  });

  it('rejects requests with an invalid HMAC signature', async () => {
    const app = createApp();
    const rawBody = JSON.stringify(payload);
    const headers = generateSignatureHeaders(secret, 'msg-1', Math.floor(Date.now() / 1000), rawBody);

    const response = await request(app)
      .post('/api/v1/public/integrations/ORDER_CREATED?orgId=84')
      .set('X-Integration-ID', headers['X-Integration-ID'])
      .set('X-Integration-Timestamp', headers['X-Integration-Timestamp'])
      .set('X-Integration-Signature', headers['X-Integration-Signature'])
      .send({ ...payload, total: 100 });

    expect(response.status).toBe(401);
    expect(response.body.error).toBe('AUTHENTICATION_FAILED');
    expect(mockAxios).not.toHaveBeenCalled();
  });

  it('accepts valid HMAC-signed requests and forwards them upstream', async () => {
    const app = createApp();
    const rawBody = JSON.stringify(payload);
    const headers = generateSignatureHeaders(secret, 'msg-2', Math.floor(Date.now() / 1000), rawBody);

    const response = await request(app)
      .post('/api/v1/public/integrations/ORDER_CREATED?orgId=84')
      .set('X-Integration-ID', headers['X-Integration-ID'])
      .set('X-Integration-Timestamp', headers['X-Integration-Timestamp'])
      .set('X-Integration-Signature', headers['X-Integration-Signature'])
      .send(payload);

    expect(response.status).toBe(200);
    expect(mockAxios).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        url: 'https://example.com/upstream',
        data: payload,
      })
    );
  });
});
