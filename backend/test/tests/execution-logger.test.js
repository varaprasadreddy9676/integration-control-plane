'use strict';

jest.mock('../../src/data/execution-logs', () => ({
  createExecutionLog: jest.fn(),
  updateExecutionLog: jest.fn(),
  addExecutionStep: jest.fn(),
}));

jest.mock('../../src/data/dlq', () => ({
  createDLQEntry: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/logger', () => ({
  log: jest.fn(),
}));

const executionLogsData = require('../../src/data/execution-logs');
const dlqData = require('../../src/data/dlq');
const { createExecutionLogger } = require('../../src/utils/execution-logger');

describe('ExecutionLogger', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    executionLogsData.createExecutionLog.mockResolvedValue({
      traceId: 'trc-test-1',
      executionLogId: '507f1f77bcf86cd799439011',
    });
    executionLogsData.updateExecutionLog.mockResolvedValue(undefined);
    executionLogsData.addExecutionStep.mockResolvedValue(undefined);
  });

  it('updates the created execution log by stable document id', async () => {
    const logger = createExecutionLogger({
      direction: 'OUTBOUND',
      triggerType: 'EVENT',
      integrationConfigId: '507f1f77bcf86cd799439012',
      integrationName: 'NCX - Appointment Cancellation',
      eventType: 'APPOINTMENT_CANCELLED',
      eventId: 'evt-1',
      orgId: 812,
      messageId: 'msg-1',
      request: { url: 'https://example.com', method: 'POST', body: { ok: true } },
    });

    await logger.start();
    await logger.addStep('validation', { status: 'success', durationMs: 5 });
    await logger.success({ response: { statusCode: 200 } });

    const expectedRef = {
      executionLogId: '507f1f77bcf86cd799439011',
      traceId: 'trc-test-1',
      orgId: 812,
    };

    expect(executionLogsData.addExecutionStep).toHaveBeenCalledWith(
      expectedRef,
      expect.objectContaining({
        name: 'validation',
        status: 'success',
      })
    );
    expect(executionLogsData.updateExecutionLog).toHaveBeenCalledWith(
      expectedRef,
      expect.objectContaining({
        status: 'success',
      })
    );
  });

  it('does not insert a second execution log when start is called twice on one instance', async () => {
    const logger = createExecutionLogger({
      traceId: 'trc-test-2',
      direction: 'OUTBOUND',
      orgId: 812,
    });

    await logger.start();
    await logger.start();

    expect(executionLogsData.createExecutionLog).toHaveBeenCalledTimes(1);
  });

  it('passes executionLogId into DLQ entries for terminal failures', async () => {
    const logger = createExecutionLogger({
      traceId: 'trc-test-3',
      direction: 'INBOUND',
      orgId: 812,
      integrationConfigId: '507f1f77bcf86cd799439013',
      messageId: 'msg-3',
      request: { body: { patientId: 'p3' } },
    });

    await logger.start();
    await logger.fail(new Error('boom'));

    expect(dlqData.createDLQEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        traceId: 'trc-test-1',
        executionLogId: '507f1f77bcf86cd799439011',
      })
    );
  });
});
