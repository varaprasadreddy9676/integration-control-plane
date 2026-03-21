'use strict';

jest.mock('../../src/data', () => ({
  resolveOrgIdFromEvent: jest.fn(() => 1),
  listIntegrationsForProcessing: jest.fn(),
  markEventComplete: jest.fn(),
  createHeldOutboundDelivery: jest.fn(),
  recordLog: jest.fn(),
}));

jest.mock('../../src/logger', () => ({
  log: jest.fn(),
}));

jest.mock('../../src/services/transformer', () => ({
  applyTransform: jest.fn(),
}));

jest.mock('../../src/services/scheduler', () => ({
  executeSchedulingScript: jest.fn(),
}));

jest.mock('../../src/processor/event-normalizer', () => ({
  normalizeEventSubject: jest.fn(),
}));

jest.mock('../../src/utils/event-utils', () => ({
  generateCorrelationId: jest.fn(() => 'corr-1'),
}));

jest.mock('../../src/processor/delivery-engine', () => ({
  deliverToIntegration: jest.fn(),
}));

const data = require('../../src/data');
const { applyTransform } = require('../../src/services/transformer');
const { normalizeEventSubject } = require('../../src/processor/event-normalizer');
const { processEvent } = require('../../src/processor/event-processor');

describe('condition processing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    data.listIntegrationsForProcessing.mockResolvedValue([
      {
        id: 'cfg-wait',
        name: 'Wait for approval',
        type: 'GRN_CREATED',
        deliveryMode: 'WAIT_FOR_CONDITION',
        targetUrl: 'https://example.com/grn',
        httpMethod: 'POST',
        resourceType: 'GRN',
        subjectExtraction: {
          mode: 'PATHS',
          paths: {
            grn_id: 'grn.id',
            txn_id: 'grn.txnId',
          },
        },
        conditionConfig: {
          payloadStrategy: 'ORIGINAL_EVENT',
          releaseRules: [
            { eventTypes: ['GRN_APPROVED'], action: 'RELEASE_HELD', matchKeys: ['grn_id', 'txn_id'] },
          ],
          discardRules: [
            { eventTypes: ['GRN_REJECTED'], action: 'DISCARD_HELD', matchKeys: ['grn_id', 'txn_id'] },
          ],
        },
      },
    ]);
    applyTransform.mockResolvedValue({ outbound: true, grn_id: 'GRN-1' });
    normalizeEventSubject.mockResolvedValue({
      subjectType: 'GRN',
      eventType: 'GRN_CREATED',
      action: null,
      data: { grn_id: 'GRN-1', txn_id: 'TXN-1' },
      warnings: [],
    });
    data.createHeldOutboundDelivery.mockResolvedValue({ id: 'held-1' });
    data.recordLog.mockResolvedValue('log-1');
    data.markEventComplete.mockResolvedValue(undefined);
  });

  it('holds transformed payloads for WAIT_FOR_CONDITION integrations', async () => {
    const result = await processEvent(
      {
        id: 'evt-1',
        event_type: 'GRN_CREATED',
        payload: {
          grn: {
            id: 'GRN-1',
            txnId: 'TXN-1',
          },
        },
      },
      0
    );

    expect(data.createHeldOutboundDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        __KEEP___KEEP_integrationConfig__Id__: 'cfg-wait',
        eventType: 'GRN_CREATED',
        payload: { outbound: true, grn_id: 'GRN-1' },
        subject: expect.objectContaining({
          subjectType: 'GRN',
          data: { grn_id: 'GRN-1', txn_id: 'TXN-1' },
        }),
      })
    );
    expect(data.recordLog).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        status: 'PENDING',
        responseStatus: 202,
        errorMessage: 'Held until condition rules release this payload',
      })
    );
    expect(result.heldCount).toBe(1);
  });
});
