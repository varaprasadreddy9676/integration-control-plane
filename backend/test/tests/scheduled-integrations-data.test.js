'use strict';

const mockScheduledCollection = {
  find: jest.fn(),
  findOne: jest.fn(),
  findOneAndUpdate: jest.fn(),
  insertOne: jest.fn(),
  updateMany: jest.fn(),
};

const mockDb = {
  collection: jest.fn((name) => {
    if (name !== 'scheduled_integrations') {
      throw new Error(`Unexpected collection: ${name}`);
    }
    return mockScheduledCollection;
  }),
};

jest.mock('../../src/mongodb', () => ({
  isConnected: jest.fn(() => true),
  getDbSafe: jest.fn().mockResolvedValue(mockDb),
  toObjectId: jest.fn((value) => (value ? `oid:${value}` : null)),
}));

jest.mock('../../src/logger', () => ({
  log: jest.fn(),
  logError: jest.fn(),
}));

const scheduledIntegrations = require('../../src/data/scheduled-integrations');

describe('scheduled-integrations data layer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockScheduledCollection.find.mockReturnValue({
      toArray: jest.fn().mockResolvedValue([]),
    });
    mockScheduledCollection.findOne.mockResolvedValue(null);
    mockScheduledCollection.findOneAndUpdate.mockResolvedValue({ value: null });
    mockScheduledCollection.insertOne.mockResolvedValue({ insertedId: 'scheduled-1' });
    mockScheduledCollection.updateMany.mockResolvedValue({ modifiedCount: 0 });
  });

  it('suppresses duplicate reminder creation when an identical reminder was already sent', async () => {
    mockScheduledCollection.findOne.mockResolvedValue({
      _id: 'existing-1',
      __KEEP___KEEP_integrationConfig__Id__: 'oid:cfg-1',
      __KEEP_integrationName__: 'Luma - Reminder 2 (T-3hrs)',
      orgId: 648,
      status: 'SENT',
      scheduledFor: new Date('2026-03-11T05:30:00.000Z'),
      payload: {
        metadata: {
          messageType: 'reminder_2_t3',
          appointmentDate: '2026-03-11',
        },
      },
      originalPayload: {
        appt: {
          bookingNumber: 'LF-11032026-34',
          apptDate: '2026-03-11',
        },
      },
      createdAt: new Date('2026-03-10T17:55:55.432Z'),
      updatedAt: new Date('2026-03-11T06:54:22.342Z'),
    });

    const result = await scheduledIntegrations.createScheduledIntegration({
      __KEEP___KEEP_integrationConfig__Id__: 'cfg-1',
      __KEEP_integrationName__: 'Luma - Reminder 2 (T-3hrs)',
      orgId: 648,
      originalEventId: 903865,
      eventType: 'APPOINTMENT_CONFIRMATION',
      scheduledFor: new Date('2026-03-11T05:30:00.000Z').toISOString(),
      payload: {
        metadata: {
          messageType: 'reminder_2_t3',
          appointmentDate: '2026-03-11',
        },
      },
      originalPayload: {
        appt: {
          bookingNumber: 'LF-11032026-34',
          apptDate: '2026-03-11',
        },
      },
      targetUrl: 'https://api.qikchat.in/v1/messages',
      httpMethod: 'POST',
    });

    expect(mockScheduledCollection.insertOne).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        id: 'existing-1',
        status: 'SENT',
      })
    );
  });

  it('updates an existing pending reminder instead of inserting a duplicate', async () => {
    mockScheduledCollection.findOne.mockResolvedValue({
      _id: 'existing-2',
      __KEEP___KEEP_integrationConfig__Id__: 'oid:cfg-1',
      __KEEP_integrationName__: 'Luma - Reminder 2 (T-3hrs)',
      orgId: 648,
      status: 'PENDING',
      scheduledFor: new Date('2026-03-11T05:30:00.000Z'),
      payload: {
        metadata: {
          messageType: 'reminder_2_t3',
          appointmentDate: '2026-03-11',
        },
      },
      originalPayload: {
        appt: {
          bookingNumber: 'LF-11032026-34',
          apptDate: '2026-03-11',
        },
      },
      createdAt: new Date('2026-03-10T14:00:41.826Z'),
      updatedAt: new Date('2026-03-10T14:00:41.826Z'),
    });
    mockScheduledCollection.findOneAndUpdate.mockResolvedValue({
      value: {
        _id: 'existing-2',
        __KEEP___KEEP_integrationConfig__Id__: 'oid:cfg-1',
        __KEEP_integrationName__: 'Luma - Reminder 2 (T-3hrs)',
        orgId: 648,
        status: 'PENDING',
        scheduledFor: new Date('2026-03-11T05:30:00.000Z'),
        payload: {
          metadata: {
            messageType: 'reminder_2_t3',
            appointmentDate: '2026-03-11',
          },
        },
        originalPayload: {
          appt: {
            bookingNumber: 'LF-11032026-34',
            apptDate: '2026-03-11',
          },
        },
        createdAt: new Date('2026-03-10T14:00:41.826Z'),
        updatedAt: new Date('2026-03-10T17:55:55.432Z'),
      },
    });

    const result = await scheduledIntegrations.createScheduledIntegration({
      __KEEP___KEEP_integrationConfig__Id__: 'cfg-1',
      __KEEP_integrationName__: 'Luma - Reminder 2 (T-3hrs)',
      orgId: 648,
      originalEventId: 903864,
      eventType: 'APPOINTMENT_CONFIRMATION',
      scheduledFor: new Date('2026-03-11T05:30:00.000Z').toISOString(),
      payload: {
        metadata: {
          messageType: 'reminder_2_t3',
          appointmentDate: '2026-03-11',
        },
      },
      originalPayload: {
        appt: {
          bookingNumber: 'LF-11032026-34',
          apptDate: '2026-03-11',
        },
      },
      targetUrl: 'https://api.qikchat.in/v1/messages',
      httpMethod: 'POST',
    });

    expect(mockScheduledCollection.insertOne).not.toHaveBeenCalled();
    expect(mockScheduledCollection.findOneAndUpdate).toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        id: 'existing-2',
        status: 'PENDING',
      })
    );
  });

  it('dedupes by originalEventId when booking metadata is unavailable', async () => {
    mockScheduledCollection.findOne.mockResolvedValue({
      _id: 'existing-3',
      __KEEP___KEEP_integrationConfig__Id__: 'oid:cfg-1',
      __KEEP_integrationName__: 'Luma - Reminder 1 (D-24hrs)',
      orgId: 648,
      status: 'PENDING',
      scheduledFor: new Date('2026-03-10T04:00:00.000Z'),
      payload: {},
      originalPayload: {
        appt: {},
      },
      createdAt: new Date('2026-03-09T04:41:09.491Z'),
      updatedAt: new Date('2026-03-09T04:41:09.491Z'),
      originalEventId: 821777,
      eventType: 'APPOINTMENT_CONFIRMATION',
    });
    mockScheduledCollection.findOneAndUpdate.mockResolvedValue({
      value: {
        _id: 'existing-3',
        __KEEP___KEEP_integrationConfig__Id__: 'oid:cfg-1',
        __KEEP_integrationName__: 'Luma - Reminder 1 (D-24hrs)',
        orgId: 648,
        status: 'PENDING',
        scheduledFor: new Date('2026-03-10T05:52:00.000Z'),
        payload: {},
        originalPayload: {
          appt: {},
        },
        createdAt: new Date('2026-03-09T04:41:09.491Z'),
        updatedAt: new Date('2026-03-09T04:41:09.491Z'),
        originalEventId: 821777,
        eventType: 'APPOINTMENT_CONFIRMATION',
      },
    });

    const result = await scheduledIntegrations.createScheduledIntegration({
      __KEEP___KEEP_integrationConfig__Id__: 'cfg-1',
      __KEEP_integrationName__: 'Luma - Reminder 1 (D-24hrs)',
      orgId: 648,
      originalEventId: 821777,
      eventType: 'APPOINTMENT_CONFIRMATION',
      scheduledFor: new Date('2026-03-10T05:52:00.000Z').toISOString(),
      payload: {},
      originalPayload: {
        appt: {},
      },
      targetUrl: 'https://api.qikchat.in/v1/messages',
      httpMethod: 'POST',
    });

    expect(mockScheduledCollection.insertOne).not.toHaveBeenCalled();
    expect(mockScheduledCollection.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        originalEventId: 821777,
        eventType: 'APPOINTMENT_CONFIRMATION',
      }),
      expect.any(Object)
    );
    expect(result).toEqual(
      expect.objectContaining({
        id: 'existing-3',
        status: 'PENDING',
      })
    );
  });

  it('stores normalized subject metadata and cancelOnEvents on newly scheduled rows', async () => {
    await scheduledIntegrations.createScheduledIntegration({
      __KEEP___KEEP_integrationConfig__Id__: 'cfg-2',
      __KEEP_integrationName__: 'Generic Reminder',
      orgId: 648,
      originalEventId: 903900,
      eventType: 'APPOINTMENT_CONFIRMATION',
      scheduledFor: new Date('2026-03-21T08:30:00.000Z').toISOString(),
      payload: {},
      originalPayload: {
        appt: {
          bookingNumber: 'LF-21032026-12',
        },
      },
      targetUrl: 'https://example.com/reminders',
      httpMethod: 'POST',
      subject: {
        subjectType: 'APPOINTMENT',
        eventType: 'APPOINTMENT_CONFIRMATION',
        action: 'create',
        data: {
          appointment_id: 4153193,
          patient_ref: 59499673,
          booking_ref: 'LF-21032026-12',
        },
      },
      subjectExtraction: {
        mode: 'PATHS',
        paths: {
          appointment_id: 'appt.apptRID',
          patient_ref: 'appt.patientRID',
          booking_ref: 'appt.bookingNumber',
        },
      },
      lifecycleRules: [
        {
          eventTypes: ['APPOINTMENT_CANCELLATION', 'APPOINTMENT_RESCHEDULED'],
          action: 'CANCEL_PENDING',
          matchKeys: ['appointment_id', 'booking_ref'],
        },
      ],
      cancelOnEvents: ['APPOINTMENT_CANCELLATION', 'APPOINTMENT_RESCHEDULED'],
    });

    expect(mockScheduledCollection.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: expect.objectContaining({
          subjectType: 'APPOINTMENT',
          data: expect.objectContaining({
            booking_ref: 'LF-21032026-12',
          }),
        }),
        subjectExtraction: expect.objectContaining({
          mode: 'PATHS',
        }),
        lifecycleRules: [
          expect.objectContaining({
            action: 'CANCEL_PENDING',
            matchKeys: ['appointment_id', 'booking_ref'],
          }),
        ],
        cancelOnEvents: ['APPOINTMENT_CANCELLATION', 'APPOINTMENT_RESCHEDULED'],
      })
    );
  });

  it('claims scheduled rows with subject metadata for recurring propagation', async () => {
    mockScheduledCollection.findOneAndUpdate
      .mockResolvedValueOnce({
        value: {
          _id: 'pending-1',
          __KEEP___KEEP_integrationConfig__Id__: 'oid:cfg-9',
          __KEEP_integrationName__: 'Recurring Reminder',
          orgId: 648,
          originalEventId: 910001,
          eventType: 'APPOINTMENT_CONFIRMATION',
          scheduledFor: new Date('2026-03-21T08:30:00.000Z'),
          status: 'PROCESSING',
          payload: {},
          originalPayload: {},
          targetUrl: 'https://example.com/reminders',
          httpMethod: 'POST',
          subject: {
            subjectType: 'APPOINTMENT',
            data: {
              appointment_id: '4153193',
              booking_ref: 'LF-21032026-12',
            },
          },
          lifecycleRules: [
            {
              eventTypes: ['APPOINTMENT_CANCELLATION'],
              action: 'CANCEL_PENDING',
              matchKeys: ['appointment_id'],
            },
          ],
          cancelOnEvents: ['APPOINTMENT_CANCELLATION'],
          recurringConfig: { interval: 3600000, occurrenceNumber: 1 },
          createdAt: new Date('2026-03-20T10:00:00.000Z'),
        },
      })
      .mockResolvedValueOnce({ value: null });

    const rows = await scheduledIntegrations.getPendingScheduledIntegrations(1);

    expect(rows).toEqual([
      expect.objectContaining({
        id: 'pending-1',
        subject: expect.objectContaining({
          data: expect.objectContaining({
            appointment_id: '4153193',
            booking_ref: 'LF-21032026-12',
          }),
        }),
        cancelOnEvents: ['APPOINTMENT_CANCELLATION'],
      }),
    ]);
  });

  it('matches new-system rows by generic extracted subject keys', async () => {
    mockScheduledCollection.find.mockReturnValue({
      toArray: jest.fn().mockResolvedValue([
        {
          _id: 'scheduled-2',
          __KEEP_integrationName__: 'Generic Reminder',
          status: 'PENDING',
          scheduledFor: new Date('2026-03-20T10:00:00.000Z'),
          eventType: 'APPOINTMENT_CONFIRMATION',
          subject: {
            subjectType: 'APPOINTMENT',
            data: {
              appointment_id: '4153193',
              booking_ref: 'LF-21032026-12',
            },
          },
          lifecycleRules: [
            {
              eventTypes: ['APPOINTMENT_CANCELLATION'],
              action: 'CANCEL_PENDING',
              matchKeys: ['appointment_id', 'booking_ref'],
            },
          ],
          cancelOnEvents: ['APPOINTMENT_CANCELLATION'],
        },
      ]),
    });
    mockScheduledCollection.updateMany.mockResolvedValue({ modifiedCount: 1 });

    const cancelledCount = await scheduledIntegrations.cancelScheduledIntegrationsByMatch(648, {
      eventType: 'APPOINTMENT_CANCELLATION',
      integrationConfigId: 'cfg-2',
      subject: {
        subjectType: 'APPOINTMENT',
        data: {
          appointment_id: '4153193',
          booking_ref: 'LF-21032026-12',
        },
      },
      lifecycleRule: {
        eventTypes: ['APPOINTMENT_CANCELLATION'],
        action: 'CANCEL_PENDING',
        matchKeys: ['appointment_id', 'booking_ref'],
      },
    });

    expect(cancelledCount).toBe(1);
    expect(mockScheduledCollection.find).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 648,
        __KEEP___KEEP_integrationConfig__Id__: 'oid:cfg-2',
        status: { $in: ['PENDING', 'OVERDUE'] },
      }),
      expect.any(Object)
    );
    expect(mockScheduledCollection.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 648,
        _id: { $in: ['scheduled-2'] },
        status: { $in: ['PENDING', 'OVERDUE'] },
      }),
      expect.any(Object)
    );
  });

  it('rebuilds legacy row subjects from original payload using stored subjectExtraction', async () => {
    mockScheduledCollection.find.mockReturnValue({
      toArray: jest.fn().mockResolvedValue([
        {
          _id: 'scheduled-legacy',
          __KEEP_integrationName__: 'Legacy Reminder',
          status: 'OVERDUE',
          scheduledFor: new Date('2026-03-20T10:00:00.000Z'),
          eventType: 'APPOINTMENT_CONFIRMATION',
          subject: null,
          originalPayload: {
            appt: {
              apptRID: 4153193,
              bookingNumber: 'LF-21032026-12',
            },
          },
          subjectExtraction: {
            mode: 'PATHS',
            paths: {
              appointment_id: 'appt.apptRID',
              booking_ref: 'appt.bookingNumber',
            },
          },
          lifecycleRules: [],
          cancelOnEvents: ['APPOINTMENT_CANCELLATION'],
        },
      ]),
    });
    mockScheduledCollection.updateMany.mockResolvedValue({ modifiedCount: 1 });

    const cancelledCount = await scheduledIntegrations.cancelScheduledIntegrationsByMatch(648, {
      eventType: 'APPOINTMENT_CANCELLATION',
      integrationConfigId: 'cfg-legacy',
      subject: {
        subjectType: 'APPOINTMENT',
        data: {
          appointment_id: '4153193',
          booking_ref: 'LF-21032026-12',
        },
      },
      lifecycleRule: {
        eventTypes: ['APPOINTMENT_CANCELLATION'],
        action: 'CANCEL_PENDING',
        matchKeys: ['appointment_id', 'booking_ref'],
      },
      subjectExtraction: {
        mode: 'PATHS',
        paths: {
          appointment_id: 'appt.apptRID',
          booking_ref: 'appt.bookingNumber',
        },
      },
    });

    expect(cancelledCount).toBe(1);
    expect(mockScheduledCollection.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: { $in: ['scheduled-legacy'] },
        orgId: 648,
      }),
      expect.any(Object)
    );
  });
});
