const express = require('express');
const request = require('supertest');

const mockAIService = {
  isAvailable: jest.fn(),
  getProviderNameForEntity: jest.fn(),
  checkRateLimit: jest.fn(),
  chat: jest.fn(),
  analyzeError: jest.fn()
};

const mockAIConfigData = {
  getAIConfig: jest.fn(),
  saveAIConfig: jest.fn(),
  getProviderConfig: jest.fn()
};

const mockProviderFactory = {
  create: jest.fn()
};

const mockExecutionLogsCollection = {
  findOne: jest.fn()
};

const mockIntegrationsCollection = {
  findOne: jest.fn(),
  updateOne: jest.fn()
};

const mockDb = {
  collection: jest.fn((name) => {
    if (name === 'execution_logs') return mockExecutionLogsCollection;
    if (name === 'integration_configs') return mockIntegrationsCollection;
    return mockExecutionLogsCollection;
  })
};

jest.mock('../../src/services/ai', () => mockAIService);
jest.mock('../../src/data/ai-config', () => mockAIConfigData);
jest.mock('../../src/services/ai/provider-factory', () => mockProviderFactory);
jest.mock('../../src/mongodb', () => ({
  isConnected: jest.fn().mockReturnValue(true),
  getDbSafe: jest.fn().mockResolvedValue(mockDb)
}));
jest.mock('../../src/services/transformer', () => ({
  validateScript: jest.fn().mockReturnValue(true)
}));
jest.mock('../../src/services/ai/interaction-logger', () => ({
  getInteractions: jest.fn().mockResolvedValue([]),
  getStats: jest.fn().mockResolvedValue({}),
  logInteraction: jest.fn().mockResolvedValue()
}));
jest.mock('../../src/middleware/feature-permission', () => ({
  requireFeature: () => (_req, _res, next) => next()
}));

const aiRouter = require('../../src/routes/ai');
const aiConfigRouter = require('../../src/routes/ai-config');
const errorHandler = require('../../src/middleware/error-handler');

function buildTestApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'u-1', role: 'ADMIN' };
    req.entityParentRid = Number(req.query.entityParentRid || req.query.orgId || 84);
    next();
  });
  app.use('/ai', aiRouter);
  app.use('/ai-config', aiConfigRouter);
  app.use(errorHandler);
  return app;
}

describe('AI Routes Integration', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = buildTestApp();
    mockAIService.isAvailable.mockResolvedValue(true);
    mockAIService.checkRateLimit.mockResolvedValue({ usage: 1, limit: 100, allowed: true });
    mockExecutionLogsCollection.findOne.mockResolvedValue(null);
    mockIntegrationsCollection.findOne.mockResolvedValue(null);
    mockIntegrationsCollection.updateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
  });

  it('returns status with provider for scoped entity', async () => {
    mockAIService.isAvailable.mockResolvedValue(true);
    mockAIService.getProviderNameForEntity.mockResolvedValue('openai');

    const response = await request(app).get('/ai/status?orgId=91');

    expect(response.status).toBe(200);
    expect(mockAIService.isAvailable).toHaveBeenCalledWith(91);
    expect(response.body.data).toEqual({
      available: true,
      provider: 'openai',
      enabled: true
    });
  });

  it('parses INTEGRATION_DRAFT from chat response', async () => {
    mockAIService.chat.mockResolvedValue(
      'Draft ready\n[INTEGRATION_DRAFT]{"name":"Lead Webhook","direction":"OUTBOUND"}[/INTEGRATION_DRAFT]'
    );

    const response = await request(app)
      .post('/ai/chat?entityParentRid=84')
      .send({
        messages: [{ role: 'user', content: 'Create integration' }],
        context: { page: 'integrations' }
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.action).toEqual({
      type: 'CREATE_INTEGRATION',
      config: { name: 'Lead Webhook', direction: 'OUTBOUND' }
    });
    expect(response.body.data.reply).toBe('Draft ready');
  });

  it('returns 429 with usage context when chat hits AI rate limit', async () => {
    mockAIService.chat.mockRejectedValue(
      new Error('Daily AI limit exceeded. Used 100/100 requests today. Resets tomorrow.')
    );
    mockAIService.checkRateLimit.mockResolvedValue({ usage: 100, limit: 100, allowed: false });

    const response = await request(app)
      .post('/ai/chat?entityParentRid=84')
      .send({ messages: [{ role: 'user', content: 'Hi' }] });

    expect(response.status).toBe(429);
    expect(response.body.code).toBe('RATE_LIMIT_EXCEEDED');
    expect(response.body.usage).toBe(100);
    expect(response.body.limit).toBe(100);
  });

  it('rejects invalid chat payloads', async () => {
    const response = await request(app)
      .post('/ai/chat?entityParentRid=84')
      .send({ messages: [{ role: 'system', content: 123 }] });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('Each message must have role');
  });

  it('blocks AI execution routes when AI is disabled', async () => {
    mockAIService.isAvailable.mockResolvedValue(false);

    const response = await request(app)
      .post('/ai/chat?entityParentRid=84')
      .send({ messages: [{ role: 'user', content: 'Create integration' }] });

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('AI_DISABLED');
    expect(mockAIService.chat).not.toHaveBeenCalled();
  });

  it('returns default ai-config when no entity config is saved', async () => {
    mockAIConfigData.getAIConfig.mockResolvedValue(null);

    const response = await request(app).get('/ai-config?entityParentRid=84');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.provider).toBe('openai');
    expect(response.body.data.enabled).toBe(false);
  });

  it('validates provider/model mismatch in ai-config update', async () => {
    const response = await request(app)
      .put('/ai-config?entityParentRid=84')
      .send({ provider: 'openai', model: 'claude-3-opus-20240229' });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('VALIDATION_ERROR');
    expect(response.body.error).toContain('Invalid model');
  });

  it('returns validation error for unsupported provider', async () => {
    const response = await request(app)
      .put('/ai-config?entityParentRid=84')
      .send({ provider: 'unsupported-vendor' });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('Invalid provider');
  });

  it('returns explicit error when testing ai-config without api key', async () => {
    mockAIConfigData.getProviderConfig.mockResolvedValue(null);

    const response = await request(app)
      .post('/ai-config/test?entityParentRid=84')
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error).toContain('No AI API key configured');
  });

  it('diagnoses failed log and returns patch diff', async () => {
    const logId = '507f1f77bcf86cd799439012';
    const integrationId = '507f1f77bcf86cd799439011';

    mockExecutionLogsCollection.findOne.mockResolvedValue({
      _id: { toString: () => logId },
      orgId: 84,
      errorMessage: 'TypeError: Cannot read properties of undefined',
      requestPayload: { patient: null },
      __KEEP___KEEP_integrationConfig__Id__: integrationId
    });

    mockIntegrationsCollection.findOne.mockResolvedValue({
      _id: { toString: () => integrationId },
      tenantId: 84,
      direction: 'OUTBOUND',
      transformation: { script: "const x = payload.patient.name; return { x };" },
      transformationMode: 'SCRIPT'
    });

    mockAIService.analyzeError.mockResolvedValue({
      rootCause: 'Unsafe property access',
      explanation: 'patient can be null',
      suggestedFix: 'Use optional chaining',
      codeChange: "const x = payload.patient?.name || ''; return { x };",
      configPatch: { timeoutMs: 15000 },
      severity: 'medium'
    });

    const response = await request(app)
      .post('/ai/diagnose-log-fix?entityParentRid=84')
      .send({ logId });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.patchable).toBe(true);
    expect(response.body.data.patch.script.path).toBe('transformation.script');
    expect(response.body.data.patch.config.patch.timeoutMs).toBe(15000);
  });

  it('applies AI fix to linked integration', async () => {
    const logId = '507f1f77bcf86cd799439012';
    const integrationId = '507f1f77bcf86cd799439011';

    mockExecutionLogsCollection.findOne.mockResolvedValue({
      _id: { toString: () => logId },
      orgId: 84,
      __KEEP___KEEP_integrationConfig__Id__: integrationId
    });
    mockIntegrationsCollection.findOne.mockResolvedValue({
      _id: { toString: () => integrationId },
      tenantId: 84,
      direction: 'OUTBOUND',
      transformation: { script: "return { x: payload.x };" },
      transformationMode: 'SCRIPT'
    });

    const response = await request(app)
      .post('/ai/apply-log-fix?entityParentRid=84')
      .send({
        logId,
        integrationId,
        codeChange: "return { x: payload?.x || '' };",
        scriptPath: 'transformation.script',
        configPatch: { retryCount: 4 }
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(mockIntegrationsCollection.updateOne).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        $set: expect.objectContaining({
          'transformation.script': "return { x: payload?.x || '' };",
          retryCount: 4
        })
      })
    );
  });
});
