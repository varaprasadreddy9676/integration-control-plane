'use strict';

jest.mock('../../src/middleware/rate-limiter', () => ({
  checkRateLimit: jest.fn(),
}));

const { checkRateLimit } = require('../../src/middleware/rate-limiter');
const {
  normalizeRequestPolicy,
  validateRequestPolicy,
  evaluateInboundRequestPolicy,
} = require('../../src/services/request-policy');

describe('request-policy', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('normalizes request policy and folds legacy rate limits in', () => {
    const result = normalizeRequestPolicy(
      {
        allowedIpCidrs: ['203.0.113.10', '203.0.113.0/24', 'bad'],
        allowedBrowserOrigins: ['https://app.example.com', 'not-an-origin'],
      },
      { enabled: true, maxRequests: 25, windowSeconds: 90 }
    );

    expect(result).toEqual({
      allowedIpCidrs: ['203.0.113.10/32', '203.0.113.0/24'],
      allowedBrowserOrigins: ['https://app.example.com'],
      rateLimit: { enabled: true, maxRequests: 25, windowSeconds: 90 },
    });
  });

  it('rejects invalid request policy entries', () => {
    expect(validateRequestPolicy({ allowedIpCidrs: ['bad-cidr'] })).toBe('Invalid CIDR/IP entry: bad-cidr');
    expect(validateRequestPolicy({ allowedBrowserOrigins: ['example.com'] })).toBe('Invalid browser origin: example.com');
  });

  it('blocks requests from disallowed IPs', async () => {
    const decision = await evaluateInboundRequestPolicy(
      {
        ip: '198.51.100.44',
        headers: {},
      },
      {
        _id: { toString: () => 'integration-1' },
        orgId: 784,
        requestPolicy: {
          allowedIpCidrs: ['203.0.113.0/24'],
        },
      }
    );

    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe('IP_NOT_ALLOWED');
    expect(decision.statusCode).toBe(403);
  });

  it('blocks browser requests from unapproved origins', async () => {
    const decision = await evaluateInboundRequestPolicy(
      {
        ip: '203.0.113.10',
        headers: { origin: 'https://evil.example.com' },
      },
      {
        _id: { toString: () => 'integration-2' },
        orgId: 784,
        requestPolicy: {
          allowedBrowserOrigins: ['https://app.example.com'],
        },
      }
    );

    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe('ORIGIN_NOT_ALLOWED');
    expect(decision.statusCode).toBe(403);
  });

  it('enforces rate limits through the shared limiter', async () => {
    checkRateLimit.mockResolvedValue({
      allowed: false,
      remaining: 0,
      resetAt: new Date('2026-03-12T10:00:00.000Z'),
      retryAfter: 45,
    });

    const decision = await evaluateInboundRequestPolicy(
      {
        ip: '203.0.113.10',
        headers: {},
      },
      {
        _id: { toString: () => 'integration-3' },
        orgId: 784,
        requestPolicy: {
          rateLimit: {
            enabled: true,
            maxRequests: 10,
            windowSeconds: 60,
          },
        },
      }
    );

    expect(checkRateLimit).toHaveBeenCalledWith('integration-3', 784, {
      enabled: true,
      maxRequests: 10,
      windowSeconds: 60,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe('RATE_LIMIT_EXCEEDED');
    expect(decision.statusCode).toBe(429);
    expect(decision.headers['Retry-After']).toBe(45);
  });
});
