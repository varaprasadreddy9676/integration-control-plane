'use strict';

const { isInvalidatingEvent, matchSubjects, normalizeEventSubject } = require('../../src/processor/event-normalizer');

describe('event-normalizer', () => {
  it('extracts generic subject data from path-based config', async () => {
    const subject = await normalizeEventSubject(
      'APPOINTMENT_CANCELLATION',
      {
        appt: {
          apptRID: 4153193,
          bookingNumber: 'LF-21032026-12',
        },
        patient: {
          id: 59499673,
        },
      },
      {
        subjectType: 'APPOINTMENT',
        subjectExtraction: {
          mode: 'PATHS',
          paths: {
            appointment_id: ['appt.apptRID', 'appointment.id'],
            patient_ref: 'patient.id',
            booking_ref: 'appt.bookingNumber',
          },
        },
      }
    );

    expect(subject).toEqual({
      subjectType: 'APPOINTMENT',
      action: 'cancel',
      eventType: 'APPOINTMENT_CANCELLATION',
      data: {
        appointment_id: 4153193,
        patient_ref: 59499673,
        booking_ref: 'LF-21032026-12',
      },
      warnings: [],
    });
  });

  it('extracts generic subject data from script-based config', async () => {
    const subject = await normalizeEventSubject(
      'CUSTOM_CANCEL_EVENT',
      {
        booking: {
          id: ' BK-1 ',
          customer: { ref: 77 },
        },
      },
      {
        subjectType: 'BOOKING',
        subjectExtraction: {
          mode: 'SCRIPT',
          script: `
            return {
              booking_ref: trim(payload.booking?.id),
              customer_ref: payload.booking?.customer?.ref,
            };
          `,
        },
      }
    );

    expect(subject).toEqual({
      subjectType: 'BOOKING',
      action: null,
      eventType: 'CUSTOM_CANCEL_EVENT',
      data: {
        booking_ref: 'BK-1',
        customer_ref: 77,
      },
      warnings: [],
    });
  });

  it('matches subjects by any configured lifecycle key', () => {
    const match = matchSubjects(
      {
        subjectType: 'BOOKING',
        data: {
          booking_ref: 'BK-1',
          customer_ref: 77,
        },
      },
      {
        subjectType: 'BOOKING',
        data: {
          booking_ref: 'BK-1',
          customer_ref: 88,
        },
      },
      ['customer_ref', 'booking_ref']
    );

    expect(match).toEqual({ matchedOn: 'booking_ref' });
  });

  it('flags only update and cancel classified events as invalidating', () => {
    expect(isInvalidatingEvent('APPOINTMENT_CANCELLATION')).toBe(true);
    expect(isInvalidatingEvent('APPOINTMENT_RESCHEDULED')).toBe(true);
    expect(isInvalidatingEvent('APPOINTMENT_CONFIRMATION')).toBe(false);
    expect(isInvalidatingEvent('CUSTOM_CANCEL_EVENT')).toBe(false);
  });
});
