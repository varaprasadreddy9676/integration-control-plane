'use strict';

const mockScheduledCollection = {
  findOne: jest.fn(),
  findOneAndUpdate: jest.fn(),
  insertOne: jest.fn(),
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
    mockScheduledCollection.findOne.mockResolvedValue(null);
    mockScheduledCollection.findOneAndUpdate.mockResolvedValue({ value: null });
    mockScheduledCollection.insertOne.mockResolvedValue({ insertedId: 'scheduled-1' });
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
});
