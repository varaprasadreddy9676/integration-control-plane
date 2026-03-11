'use strict';

jest.mock('node-cron', () => ({
  schedule: jest.fn(() => ({ stop: jest.fn() })),
}));

const mockFindOne = jest.fn();

jest.mock('../../src/mongodb', () => ({
  getDbSafe: jest.fn().mockResolvedValue({
    collection: jest.fn(() => ({
      findOne: (...args) => mockFindOne(...args),
    })),
  }),
}));

const mockGetDLQEntriesForRetry = jest.fn();
const mockUpdateDLQEntry = jest.fn();
const mockRecordRetryAttempt = jest.fn();

jest.mock('../../src/data/dlq', () => ({
  getDLQEntriesForRetry: (...args) => mockGetDLQEntriesForRetry(...args),
  updateDLQEntry: (...args) => mockUpdateDLQEntry(...args),
  recordRetryAttempt: (...args) => mockRecordRetryAttempt(...args),
}));

const mockGetExecutionLog = jest.fn();

jest.mock('../../src/data/execution-logs', () => ({
  getExecutionLog: (...args) => mockGetExecutionLog(...args),
}));

const mockRecordLog = jest.fn();

jest.mock('../../src/data', () => ({
  recordLog: (...args) => mockRecordLog(...args),
}));

jest.mock('../../src/processor/auth-helper', () => ({
  buildAuthHeaders: jest.fn(async () => ({})),
  clearCachedToken: jest.fn(async () => undefined),
}));

jest.mock('../../src/services/transformer', () => ({
  applyTransform: jest.fn(async (_integration, payload) => payload),
  applyResponseTransform: jest.fn(async (_integration, responseContext) => responseContext.data),
}));

const mockDeliverSingleAction = jest.fn();

jest.mock('../../src/processor/delivery-engine', () => ({
  deliverSingleAction: (...args) => mockDeliverSingleAction(...args),
}));

jest.mock('axios', () => jest.fn(async () => ({
  status: 200,
  data: { ok: true },
  headers: { 'content-type': 'application/json' },
})));

jest.mock('../../src/utils/runtime', () => ({
  fetch: jest.fn(async () => ({
    status: 200,
    text: async () => 'ok',
  })),
  AbortController: class MockAbortController {
    constructor() {
      this.signal = {};
    }
    abort() {}
  },
}));

jest.mock('../../src/config', () => ({
  worker: {},
}));

jest.mock('../../src/logger', () => ({
  log: jest.fn(),
}));

const { processDLQRetries } = require('../../src/processor/dlq-worker');

describe('dlq-worker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFindOne.mockResolvedValue({
      _id: 'integration-1',
      isActive: true,
      orgId: 812,
      name: 'Retry Integration',
      targetUrl: 'https://example.com/retry',
      httpMethod: 'POST',
      eventType: 'APPOINTMENT_CREATED',
      direction: 'INBOUND',
      actions: [{ name: 'Send Message', kind: 'COMMUNICATION' }],
    });
    mockGetDLQEntriesForRetry.mockResolvedValue([
      {
        dlqId: 'dlq-1',
        traceId: 'trace-1',
        orgId: 812,
        direction: 'OUTBOUND',
        retryCount: 0,
        maxRetries: 3,
        integrationConfigId: 'integration-1',
        payload: { id: 'payload-1' },
      },
    ]);
    mockUpdateDLQEntry.mockResolvedValue(undefined);
    mockRecordRetryAttempt.mockResolvedValue(undefined);
    mockGetExecutionLog.mockResolvedValue({
      eventType: 'APPOINTMENT_CREATED',
    });
    mockRecordLog.mockResolvedValue('log-1');
    mockDeliverSingleAction.mockResolvedValue({ status: 'SUCCESS', logId: 'log-1' });
  });

  it('loads the execution log with org scope and preserves the original event type', async () => {
    mockGetDLQEntriesForRetry.mockResolvedValue([
      {
        dlqId: 'dlq-1',
        traceId: 'trace-1',
        orgId: 812,
        direction: 'OUTBOUND',
        retryCount: 0,
        maxRetries: 3,
        integrationConfigId: 'integration-1',
        payload: { id: 'payload-1' },
      },
    ]);

    await processDLQRetries();

    expect(mockGetExecutionLog).toHaveBeenCalledWith('trace-1', 812);
    expect(mockRecordLog).toHaveBeenCalledWith(
      812,
      expect.objectContaining({
        eventType: 'APPOINTMENT_CREATED',
        deliveredAt: expect.any(String),
      })
    );
  });

  it('replays inbound DLQ entries through the original action delivery path', async () => {
    mockGetDLQEntriesForRetry.mockResolvedValue([
      {
        dlqId: 'dlq-2',
        traceId: 'trace-2',
        orgId: 812,
        direction: 'INBOUND',
        retryCount: 1,
        maxRetries: 3,
        integrationConfigId: 'integration-1',
        executionLogId: 'exec-log-22',
        messageId: 'msg-22',
        payload: { id: 'payload-2' },
        metadata: {
          actionIndex: 0,
          actionName: 'Send Message',
          eventType: 'LEAD_CREATED',
          logId: 'log-22',
        },
      },
    ]);

    await processDLQRetries();

    expect(mockDeliverSingleAction).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'integration-1',
        direction: 'INBOUND',
      }),
      expect.objectContaining({
        name: 'Send Message',
      }),
      expect.objectContaining({
        event_type: 'LEAD_CREATED',
        payload: { id: 'payload-2' },
        attempt_count: 1,
      }),
      0,
      0,
      'trace-2',
      null,
      expect.objectContaining({
        existingLogId: 'exec-log-22',
        triggerType: 'MANUAL',
      })
    );
  });

  it('fails safely when inbound DLQ metadata cannot resolve an action', async () => {
    mockGetDLQEntriesForRetry.mockResolvedValue([
      {
        dlqId: 'dlq-3',
        traceId: 'trace-3',
        orgId: 812,
        direction: 'INBOUND',
        retryCount: 0,
        maxRetries: 3,
        integrationConfigId: 'integration-1',
        payload: { id: 'payload-3' },
        metadata: {
          actionIndex: 8,
          actionName: 'Missing Action',
        },
      },
    ]);

    await processDLQRetries();

    expect(mockDeliverSingleAction).not.toHaveBeenCalled();
    expect(mockRecordRetryAttempt).toHaveBeenCalledWith('dlq-3', 812, 'failed');
  });

  it('replays direct inbound runtime DLQ entries through the buffered inbound proxy path', async () => {
    mockGetDLQEntriesForRetry.mockResolvedValue([
      {
        dlqId: 'dlq-4',
        traceId: 'trace-4',
        orgId: 812,
        direction: 'INBOUND',
        retryCount: 0,
        maxRetries: 3,
        integrationConfigId: 'integration-1',
        payload: {
          body: { patientId: 'p-4' },
          query: { orgId: '812' },
          headers: { authorization: 'Bearer retry-token' },
          file: null,
        },
        metadata: {
          replayMode: 'INBOUND_RUNTIME',
          eventType: 'APPOINTMENT_CREATED',
          requestUrl: '/api/v1/integrations/APPOINTMENT_CREATED?orgId=812',
          requestMethod: 'POST',
        },
      },
    ]);

    await processDLQRetries();

    expect(mockDeliverSingleAction).not.toHaveBeenCalled();
    expect(mockRecordLog).toHaveBeenCalledWith(
      812,
      expect.objectContaining({
        direction: 'INBOUND',
        triggerType: 'REPLAY',
        status: 'SUCCESS',
        eventType: 'APPOINTMENT_CREATED',
        deliveredAt: expect.any(String),
      })
    );
    expect(mockRecordRetryAttempt).toHaveBeenCalledWith('dlq-4', 812, 'success');
  });
});
