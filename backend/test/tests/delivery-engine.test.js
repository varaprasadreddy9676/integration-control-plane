'use strict';

jest.mock('../../src/utils/runtime', () => ({
  fetch: jest.fn(),
  AbortController: class MockAbortController {
    constructor() {
      this.signal = {};
    }
    abort() {}
  },
}));

jest.mock('../../src/config', () => ({
  security: {},
  worker: {},
}));

const mockRecordLog = jest.fn();
const mockCheckCircuitState = jest.fn();
const mockRecordDeliverySuccess = jest.fn();
const mockRecordDeliveryFailure = jest.fn();

jest.mock('../../src/data', () => ({
  recordLog: (...args) => mockRecordLog(...args),
  checkCircuitState: (...args) => mockCheckCircuitState(...args),
  recordDeliverySuccess: (...args) => mockRecordDeliverySuccess(...args),
  recordDeliveryFailure: (...args) => mockRecordDeliveryFailure(...args),
}));

jest.mock('../../src/logger', () => ({
  log: jest.fn(),
}));

jest.mock('../../src/services/transformer', () => ({
  applyTransform: jest.fn(async (_integration, payload) => payload),
}));

jest.mock('../../src/utils/url-check', () => ({
  validateTargetUrl: jest.fn(() => ({ valid: true })),
}));

jest.mock('../../src/processor/auth-helper', () => ({
  buildAuthHeaders: jest.fn(async () => ({})),
}));

jest.mock('../../src/services/integration-signing', () => ({
  generateSignatureHeaders: jest.fn(() => ({})),
}));

jest.mock('../../src/middleware/rate-limiter', () => ({
  checkRateLimit: jest.fn(async () => ({
    allowed: false,
    remaining: 0,
    resetAt: new Date().toISOString(),
    retryAfter: 30,
  })),
}));

jest.mock('../../src/data/dlq', () => ({
  createDLQEntry: jest.fn(),
}));

jest.mock('../../src/processor/condition-evaluator', () => ({
  evaluateCondition: jest.fn(() => true),
}));

jest.mock('../../src/utils/event-utils', () => ({
  generateCorrelationId: jest.fn(() => 'trace-1'),
  sleep: jest.fn(),
  isTestEvent: jest.fn(() => false),
  safeRead: jest.fn(),
}));

const mockStart = jest.fn();
const mockAddStep = jest.fn();
const mockUpdateStatus = jest.fn();
const mockSuccess = jest.fn();
const mockFail = jest.fn();

jest.mock('../../src/utils/execution-logger', () => ({
  createExecutionLogger: jest.fn(() => ({
    executionLogId: 'exec-log-1',
    start: (...args) => mockStart(...args),
    addStep: (...args) => mockAddStep(...args),
    updateStatus: (...args) => mockUpdateStatus(...args),
    success: (...args) => mockSuccess(...args),
    fail: (...args) => mockFail(...args),
  })),
}));

jest.mock('../../src/utils/timeout', () => ({
  withTimeout: jest.fn((promise) => promise),
}));

jest.mock('../../src/services/communication/adapter-registry', () => ({}));

const { deliverToIntegration } = require('../../src/processor/delivery-engine');
const { fetch: mockFetch } = require('../../src/utils/runtime');
const { generateSignatureHeaders } = require('../../src/services/integration-signing');
const { checkRateLimit } = require('../../src/middleware/rate-limiter');

describe('delivery-engine', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckCircuitState.mockResolvedValue({ isOpen: false, state: 'CLOSED', reason: null });
    mockRecordLog.mockResolvedValue('exec-log-1');
    mockStart.mockResolvedValue('trace-1');
    mockAddStep.mockResolvedValue(undefined);
    mockUpdateStatus.mockResolvedValue(undefined);
    mockSuccess.mockResolvedValue(undefined);
    mockFail.mockResolvedValue(undefined);
  });

  it('updates the existing execution log document when first-attempt rate limiting occurs', async () => {
    const integration = {
      id: 'integration-1',
      name: 'Rate Limited Integration',
      orgId: 812,
      targetUrl: 'https://example.com/hook',
      httpMethod: 'POST',
      rateLimits: {
        enabled: true,
        maxRequests: 1,
        windowSeconds: 60,
      },
    };

    const evt = {
      id: 'evt-1',
      event_type: 'APPOINTMENT_CREATED',
      payload: { patientId: 'p1' },
      attempt_count: 0,
      orgId: 812,
    };

    const result = await deliverToIntegration(integration, evt, false, 0, null, 'trace-1', true);

    expect(result).toEqual({ status: 'RETRYING', logId: 'exec-log-1', logIds: null });
    expect(mockRecordLog).toHaveBeenCalledWith(
      812,
      expect.objectContaining({
        id: 'exec-log-1',
        status: 'RETRYING',
        responseStatus: 429,
      })
    );
  });

  it('fails closed when signing is enabled but signature generation throws', async () => {
    checkRateLimit.mockResolvedValue({
      allowed: true,
      remaining: 10,
      resetAt: new Date().toISOString(),
      retryAfter: 0,
    });
    generateSignatureHeaders.mockImplementation(() => {
      throw new Error('broken-secret');
    });

    const integration = {
      id: 'integration-1',
      name: 'Signed Integration',
      orgId: 812,
      targetUrl: 'https://example.com/hook',
      httpMethod: 'POST',
      retryCount: 3,
      enableSigning: true,
      signingSecrets: ['whsec_test_secret'],
    };

    const evt = {
      id: 'evt-2',
      event_type: 'ORDER_CREATED',
      payload: { orderId: 'o1' },
      attempt_count: 0,
      orgId: 812,
    };

    const result = await deliverToIntegration(integration, evt, false, 0, null, 'trace-2', true);

    expect(result).toEqual({ status: 'FAILED', logId: 'exec-log-1', logIds: null });
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockRecordLog).toHaveBeenCalledWith(
      812,
      expect.objectContaining({
        status: 'FAILED',
        errorMessage: expect.stringContaining('Signing configuration error'),
      })
    );
  });
});
