'use strict';

const ack = jest.fn();
const nack = jest.fn();

jest.mock('../../src/config', () => ({
  eventAudit: {
    enabled: false,
  },
}));

jest.mock('../../src/logger', () => ({
  log: jest.fn(),
}));

jest.mock('../../src/utils/event-utils', () => ({
  generateEventKey: jest.fn(() => 'evt-key'),
}));

jest.mock('../../src/processor/event-deduplication', () => ({
  isEventProcessed: jest.fn(() => false),
  markEventProcessed: jest.fn(),
}));

jest.mock('../../src/processor/event-processor', () => ({
  processEvent: jest.fn(),
}));

jest.mock('../../src/processor/event-normalizer', () => ({
  normalizeEventSubject: jest.fn(),
}));

jest.mock('../../src/data', () => ({
  resolveOrgIdFromEvent: jest.fn(() => 1),
  isEventAlreadyProcessed: jest.fn(() => false),
  listInvalidationProfiles: jest.fn(() => Promise.resolve([])),
  cancelScheduledIntegrationsByMatch: jest.fn(() => Promise.resolve(0)),
  listConditionProfiles: jest.fn(),
  releaseHeldDeliveriesByMatch: jest.fn(),
  discardHeldDeliveriesByMatch: jest.fn(),
  listIntegrationsForProcessing: jest.fn(),
  markEventComplete: jest.fn(),
  saveProcessedEvent: jest.fn(),
}));

const data = require('../../src/data');
const { processEvent } = require('../../src/processor/event-processor');
const { normalizeEventSubject } = require('../../src/processor/event-normalizer');
const { createEventHandler } = require('../../src/processor/event-handler');

describe('event-handler condition processing', () => {
  const handler = createEventHandler('http_push');

  beforeEach(() => {
    jest.clearAllMocks();
    ack.mockResolvedValue(undefined);
    nack.mockResolvedValue(undefined);
    data.listConditionProfiles.mockResolvedValue([]);
    data.releaseHeldDeliveriesByMatch.mockResolvedValue({ releasedCount: 0, failedCount: 0, matchedCount: 0 });
    data.discardHeldDeliveriesByMatch.mockResolvedValue(0);
    data.listIntegrationsForProcessing.mockResolvedValue([]);
    data.markEventComplete.mockResolvedValue(undefined);
    data.saveProcessedEvent.mockResolvedValue(undefined);
    processEvent.mockResolvedValue({
      deliveryResults: [],
      scheduledCount: 0,
      heldCount: 0,
    });
    normalizeEventSubject.mockResolvedValue({
      subjectType: 'GRN',
      eventType: 'GRN_APPROVED',
      action: null,
      data: { grn_id: 'GRN-1', txn_id: 'TXN-1' },
      warnings: [],
    });
  });

  it('releases held deliveries when a matching follow-up event arrives even without direct integrations', async () => {
    data.listConditionProfiles.mockResolvedValue([
      {
        integrationId: 'cfg-hold',
        integration: {
          id: 'cfg-hold',
          name: 'Hold until approved',
          conditionConfig: {
            releaseRules: [
              { eventTypes: ['GRN_APPROVED'], action: 'RELEASE_HELD', matchKeys: ['grn_id', 'txn_id'] },
            ],
          },
        },
        action: 'RELEASE_HELD',
        subjectType: 'GRN',
        subjectExtraction: {
          mode: 'PATHS',
          paths: {
            grn_id: 'grn.id',
            txn_id: 'grn.txnId',
          },
        },
        conditionRule: { eventTypes: ['GRN_APPROVED'], action: 'RELEASE_HELD', matchKeys: ['grn_id', 'txn_id'] },
      },
    ]);
    data.releaseHeldDeliveriesByMatch.mockResolvedValue({ releasedCount: 1, failedCount: 0, matchedCount: 1 });

    await handler(
      {
        id: 'evt-approve-1',
        event_type: 'GRN_APPROVED',
        payload: {
          grn: { id: 'GRN-1', txnId: 'TXN-1' },
        },
      },
      { ack, nack }
    );

    expect(data.releaseHeldDeliveriesByMatch).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        eventType: 'GRN_APPROVED',
        integrationConfigId: 'cfg-hold',
        subject: expect.objectContaining({
          data: { grn_id: 'GRN-1', txn_id: 'TXN-1' },
        }),
      })
    );
    expect(processEvent).not.toHaveBeenCalled();
    expect(ack).toHaveBeenCalledTimes(1);
    expect(nack).not.toHaveBeenCalled();
  });

  it('discards held deliveries when a discard rule matches', async () => {
    data.listConditionProfiles.mockResolvedValue([
      {
        integrationId: 'cfg-hold',
        integration: {
          id: 'cfg-hold',
          name: 'Hold until approved',
          conditionConfig: {
            discardRules: [
              { eventTypes: ['GRN_REJECTED'], action: 'DISCARD_HELD', matchKeys: ['grn_id', 'txn_id'] },
            ],
          },
        },
        action: 'DISCARD_HELD',
        subjectType: 'GRN',
        subjectExtraction: {
          mode: 'PATHS',
          paths: {
            grn_id: 'grn.id',
            txn_id: 'grn.txnId',
          },
        },
        conditionRule: { eventTypes: ['GRN_REJECTED'], action: 'DISCARD_HELD', matchKeys: ['grn_id', 'txn_id'] },
      },
    ]);
    data.discardHeldDeliveriesByMatch.mockResolvedValue(1);

    await handler(
      {
        id: 'evt-reject-1',
        event_type: 'GRN_REJECTED',
        payload: {
          grn: { id: 'GRN-1', txnId: 'TXN-1' },
        },
      },
      { ack, nack }
    );

    expect(data.discardHeldDeliveriesByMatch).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        eventType: 'GRN_REJECTED',
        integrationConfigId: 'cfg-hold',
      })
    );
    expect(processEvent).not.toHaveBeenCalled();
    expect(ack).toHaveBeenCalledTimes(1);
  });
});
