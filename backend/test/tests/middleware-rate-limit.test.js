const createMockRes = () => {
  const res = {
    headers: {},
    statusCode: 200,
    body: null,
    set: jest.fn(function set(header, value) {
      if (typeof header === 'string') {
        this.headers[header] = value;
      } else if (header && typeof header === 'object') {
        Object.assign(this.headers, header);
      }
      return this;
    }),
    status: jest.fn(function status(code) {
      this.statusCode = code;
      return this;
    }),
    json: jest.fn(function json(payload) {
      this.body = payload;
      return this;
    }),
  };
  return res;
};

describe('Global Rate Limit Middleware', () => {
  const findOneAndUpdate = jest.fn();
  const createIndexes = jest.fn();
  const findOne = jest.fn();
  const insertOne = jest.fn();

  const db = {
    collection: jest.fn((name) => {
      if (name === 'api_rate_limits') {
        return { findOneAndUpdate, createIndexes };
      }
      if (name === 'integration_configs') {
        return { findOne };
      }
      if (name === 'execution_logs') {
        return { insertOne };
      }
      throw new Error(`Unexpected collection: ${name}`);
    }),
  };

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();

    createIndexes.mockResolvedValue(undefined);
    findOne.mockResolvedValue({ _id: '507f1f77bcf86cd799439011', name: 'Lab Results Inbound' });

    jest.doMock('../../src/config', () => ({
      api: { basePrefix: '/api/v1' },
      rateLimit: { enabled: true, maxRequests: 100, windowSeconds: 60 },
    }));

    jest.doMock('../../src/mongodb', () => ({
      getDbSafe: jest.fn().mockResolvedValue(db),
    }));

    jest.doMock('../../src/logger', () => ({
      log: jest.fn(),
    }));
  });

  it('writes inbound execution log entry when global limiter returns 429 on inbound runtime path', async () => {
    findOneAndUpdate.mockResolvedValue({ value: { count: 101 } });

    const rateLimit = require('../../src/middleware/rate-limit');

    const req = {
      id: 'req_429_test_1',
      method: 'POST',
      path: '/api/v1/integrations/lab-results',
      originalUrl: '/api/v1/integrations/lab-results?orgId=84',
      query: { orgId: '84' },
      body: { resultId: 'LAB-1', value: 'positive' },
      headers: {
        'x-api-key': 'secret-key',
        authorization: 'Bearer abc',
      },
      ip: '10.0.0.8',
      connection: { remoteAddress: '10.0.0.8' },
      socket: { remoteAddress: '10.0.0.8' },
    };

    const res = createMockRes();
    const next = jest.fn();

    await rateLimit(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.body).toMatchObject({
      code: 'RATE_LIMIT_EXCEEDED',
    });

    expect(insertOne).toHaveBeenCalledTimes(1);
    const inserted = insertOne.mock.calls[0][0];

    expect(inserted).toMatchObject({
      orgId: 84,
      direction: 'INBOUND',
      status: 'FAILED',
      responseStatus: 429,
      errorCategory: 'RATE_LIMIT',
      eventType: 'lab-results',
      metadata: { source: 'global_rate_limit_middleware' },
    });

    expect(inserted.request.headers.authorization).toBe('[REDACTED]');
    expect(inserted.request.headers['x-api-key']).toBe('[REDACTED]');
  });
});
