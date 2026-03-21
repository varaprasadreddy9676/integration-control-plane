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
  listInvalidationProfiles: jest.fn(),
  cancelScheduledIntegrationsByMatch: jest.fn(),
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

describe('event-handler lifecycle invalidation', () => {
  const handler = createEventHandler('http_push');

  beforeEach(() => {
    jest.clearAllMocks();
    ack.mockResolvedValue(undefined);
    nack.mockResolvedValue(undefined);
    data.resolveOrgIdFromEvent.mockReturnValue(1);
    data.isEventAlreadyProcessed.mockResolvedValue(false);
    data.listInvalidationProfiles.mockResolvedValue([]);
    data.cancelScheduledIntegrationsByMatch.mockResolvedValue(0);
    data.listConditionProfiles.mockResolvedValue([]);
    data.releaseHeldDeliveriesByMatch.mockResolvedValue({ releasedCount: 0, failedCount: 0, matchedCount: 0 });
    data.discardHeldDeliveriesByMatch.mockResolvedValue(0);
    data.listIntegrationsForProcessing.mockResolvedValue([]);
    data.markEventComplete.mockResolvedValue(undefined);
    data.saveProcessedEvent.mockResolvedValue(undefined);
    processEvent.mockResolvedValue({
      deliveryResults: [{ status: 'SUCCESS', logId: 'log-1' }],
      scheduledCount: 0,
    });
    normalizeEventSubject.mockResolvedValue({
      subjectType: 'BOOKING',
      eventType: 'BOOKING_CANCELLED',
      action: 'cancel',
      data: { booking_ref: 'B-1' },
      warnings: [],
    });
  });

  it('skips profiles whose extraction returns no subject or throws and still processes delivery', async () => {
    data.listInvalidationProfiles.mockResolvedValue([
      {
        integrationId: 'cfg-a',
        subjectType: 'BOOKING',
        subjectExtraction: { mode: 'SCRIPT', script: 'return null;' },
        lifecycleRule: { eventTypes: ['BOOKING_CANCELLED'], action: 'CANCEL_PENDING', matchKeys: ['booking_ref'] },
      },
      {
        integrationId: 'cfg-b',
        subjectType: 'BOOKING',
        subjectExtraction: { mode: 'SCRIPT', script: 'throw new Error("boom");' },
        lifecycleRule: { eventTypes: ['BOOKING_CANCELLED'], action: 'CANCEL_PENDING', matchKeys: ['booking_ref'] },
      },
    ]);
    normalizeEventSubject
      .mockResolvedValueOnce({
        subjectType: 'BOOKING',
        eventType: 'BOOKING_CANCELLED',
        action: 'cancel',
        data: null,
        warnings: [],
      })
      .mockRejectedValueOnce(new Error('boom'));
    data.listIntegrationsForProcessing.mockResolvedValue([{ id: 'int-1', name: 'Delivery Integration' }]);

    await handler(
      {
        id: 'evt-1',
        event_type: 'BOOKING_CANCELLED',
        payload: { booking: { id: 'B-1' } },
      },
      { ack, nack }
    );

    expect(data.cancelScheduledIntegrationsByMatch).not.toHaveBeenCalled();
    expect(processEvent).toHaveBeenCalledTimes(1);
    expect(ack).toHaveBeenCalledTimes(1);
    expect(nack).not.toHaveBeenCalled();
  });

  it('passes cleanly through the delivery path when no invalidation profiles exist', async () => {
    data.listInvalidationProfiles.mockResolvedValue([]);
    data.listIntegrationsForProcessing.mockResolvedValue([{ id: 'int-2', name: 'Outbound Integration' }]);

    await handler(
      {
        id: 'evt-2',
        event_type: 'PATIENT_REGISTERED',
        payload: { patient: { id: 'P-1' } },
      },
      { ack, nack }
    );

    expect(data.listInvalidationProfiles).toHaveBeenCalledWith(1, 'PATIENT_REGISTERED');
    expect(data.listConditionProfiles).toHaveBeenCalledWith(1, 'PATIENT_REGISTERED');
    expect(data.listIntegrationsForProcessing).toHaveBeenCalledWith(1, 'PATIENT_REGISTERED');
    expect(processEvent).toHaveBeenCalledTimes(1);
    expect(ack).toHaveBeenCalledTimes(1);
    expect(nack).not.toHaveBeenCalled();
  });

  it('keeps invalidation scoped to each profile integration id', async () => {
    data.listInvalidationProfiles.mockResolvedValue([
      {
        integrationId: 'cfg-a',
        subjectType: 'APPOINTMENT',
        subjectExtraction: { mode: 'PATHS', paths: { appointment_id: 'appt.apptRID' } },
        lifecycleRule: { eventTypes: ['APPOINTMENT_CANCELLATION'], action: 'CANCEL_PENDING', matchKeys: ['appointment_id'] },
      },
      {
        integrationId: 'cfg-b',
        subjectType: 'APPOINTMENT',
        subjectExtraction: { mode: 'PATHS', paths: { appointment_id: 'appt.apptRID' } },
        lifecycleRule: { eventTypes: ['APPOINTMENT_CANCELLATION'], action: 'CANCEL_PENDING', matchKeys: ['appointment_id'] },
      },
    ]);
    normalizeEventSubject
      .mockResolvedValueOnce({
        subjectType: 'APPOINTMENT',
        eventType: 'APPOINTMENT_CANCELLATION',
        action: 'cancel',
        data: { appointment_id: 'A-1' },
        warnings: [],
      })
      .mockResolvedValueOnce({
        subjectType: 'APPOINTMENT',
        eventType: 'APPOINTMENT_CANCELLATION',
        action: 'cancel',
        data: { appointment_id: 'A-1' },
        warnings: [],
      });
    data.cancelScheduledIntegrationsByMatch
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0);

    await handler(
      {
        id: 'evt-3',
        event_type: 'APPOINTMENT_CANCELLATION',
        payload: { appt: { apptRID: 'A-1' } },
      },
      { ack, nack }
    );

    expect(data.cancelScheduledIntegrationsByMatch).toHaveBeenNthCalledWith(
      1,
      1,
      expect.objectContaining({
        integrationConfigId: 'cfg-a',
        subject: expect.objectContaining({
          data: { appointment_id: 'A-1' },
        }),
      })
    );
    expect(data.cancelScheduledIntegrationsByMatch).toHaveBeenNthCalledWith(
      2,
      1,
      expect.objectContaining({
        integrationConfigId: 'cfg-b',
        subject: expect.objectContaining({
          data: { appointment_id: 'A-1' },
        }),
      })
    );
    expect(ack).toHaveBeenCalledTimes(1);
    expect(nack).not.toHaveBeenCalled();
  });
});
