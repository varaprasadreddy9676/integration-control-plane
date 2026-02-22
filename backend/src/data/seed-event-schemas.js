/**
 * Production Event Schema Seeder
 * Seeds event_types collection with comprehensive field schemas based on production events
 *
 * Run this script to populate MongoDB with accurate event type schemas:
 * node backend/src/data/seed-event-schemas.js
 */

const mongodb = require('../mongodb');
const { log } = require('../logger');

/**
 * Comprehensive event type schemas based on production data
 */
const eventTypeSchemas = [
  {
    eventType: 'PATIENT_REGISTERED',
    label: 'Patient Registered',
    description: 'Triggered when a new patient is registered in the system',
    category: 'Patient Management',
    isActive: true,
    fields: [
      { path: 'type', type: 'string', description: 'Event type identifier', example: 'PATIENT_REGISTERED' },
      { path: 'datetime', type: 'string', description: 'Event timestamp', example: '24/01/2026 06:14 PM' },
      { path: 'orgUnitRid', type: 'number', description: 'Org unit resource identifier', example: 84 },
      { path: 'entityCode', type: 'string', description: 'Entity code', example: '7172139' },
      { path: 'entityName', type: 'string', description: 'Entity name', example: 'SANKARA EYE HOSPITAL, Bangalore' },
      { path: 'entityPhone', type: 'string', description: 'Entity phone number', example: '08069038900' },
      { path: 'entityParentID', type: 'number', description: 'Parent entity identifier', example: 84 },
      { path: 'enterpriseCode', type: 'string', description: 'Enterprise code', example: '7709418' },
      { path: 'enterpriseEntityRID', type: 'number', description: 'Enterprise entity RID', example: 84 },
      { path: 'description', type: 'string', description: 'Event description', example: 'Patient Registered' },
      { path: 'unitRID', type: 'number', description: 'Unit resource identifier', example: 3470 },
      { path: 'userRID', type: 'number', description: 'User resource identifier', example: 3439091 },

      // Patient object fields
      {
        path: 'patient.mrn.documentNumber',
        type: 'string',
        description: 'Patient MRN document number',
        example: 'SEHBLR/908601/26',
      },
      {
        path: 'patient.mrn.sequenceNumber',
        type: 'number',
        description: 'Patient MRN sequence number',
        example: 59071146,
      },
      { path: 'patient.fullName', type: 'string', description: 'Patient full name', example: 'Kishore' },
      { path: 'patient.phone', type: 'string', description: 'Patient phone number', example: '7498668989' },
      { path: 'patient.email', type: 'string', description: 'Patient email address', example: 'patient@example.com' },
      { path: 'patient.address', type: 'string', description: 'Patient address', example: 'Btm' },
      { path: 'patient.isVIP', type: 'boolean', description: 'VIP patient flag', example: false },
      { path: 'patient.isExpired', type: 'number', description: 'Patient expired flag', example: 0 },
      { path: 'patient.isUnknown', type: 'boolean', description: 'Unknown patient flag', example: false },
      { path: 'patient.isInternational', type: 'boolean', description: 'International patient flag', example: false },
      { path: 'patient.confidential', type: 'boolean', description: 'Confidential flag', example: false },
      { path: 'patient.notifyBySms', type: 'boolean', description: 'SMS notification preference', example: false },
      { path: 'patient.notifyByEmail', type: 'boolean', description: 'Email notification preference', example: false },
      {
        path: 'patient.notifyByWhatsapp',
        type: 'boolean',
        description: 'WhatsApp notification preference',
        example: false,
      },
      {
        path: 'patient.isMobileNoVerified',
        type: 'boolean',
        description: 'Mobile verification status',
        example: false,
      },
      { path: 'patient.valid', type: 'number', description: 'Patient validity status', example: 0 },
      { path: 'patient.sourceSystemId', type: 'number', description: 'source system ID', example: 0 },
      { path: 'patient.referencePatientId', type: 'number', description: 'Reference patient ID', example: 0 },
      { path: 'patient.updateCount', type: 'number', description: 'Update count', example: 0 },

      // Visit object (if present in event)
      { path: 'visit.sealed', type: 'boolean', description: 'Visit sealed status', example: false },
      { path: 'visit.sourceSystemId', type: 'number', description: 'source system visit ID', example: 0 },
      { path: 'visit.updateCount', type: 'number', description: 'Visit update count', example: 0 },
      { path: 'visit.visitCategory', type: 'number', description: 'Visit category', example: 0 },
      { path: 'visit.patientAgeInDays', type: 'number', description: 'Patient age in days', example: 0 },
      { path: 'visit.patientAgeInYears', type: 'number', description: 'Patient age in years', example: 0 },
      { path: 'visit.patientAgeInMonths', type: 'number', description: 'Patient age in months', example: 0 },
      { path: 'visit.freeRemainingCount', type: 'number', description: 'Free remaining count', example: 0 },
      { path: 'visit.sourceAppointmentId', type: 'number', description: 'source system appointment ID', example: 0 },
    ],
  },

  {
    eventType: 'OP_VISIT_CREATED',
    label: 'OP Visit Created',
    description: 'Triggered when a new outpatient visit is created',
    category: 'Visit Management',
    isActive: true,
    fields: [
      { path: 'type', type: 'string', description: 'Event type identifier', example: 'OP_VISIT_CREATED' },
      { path: 'datetime', type: 'string', description: 'Event timestamp', example: '24/01/2026 02:07 PM' },
      { path: 'orgUnitRid', type: 'number', description: 'Org unit resource identifier', example: 84 },
      { path: 'entityCode', type: 'string', description: 'Entity code', example: '7831211' },
      { path: 'entityName', type: 'string', description: 'Entity name', example: 'SANKARA EYE HOSPITAL, Coimbatore' },
      { path: 'entityPhone', type: 'string', description: 'Entity phone number', example: '04223116789' },
      { path: 'entityParentID', type: 'number', description: 'Parent entity identifier', example: 84 },
      { path: 'enterpriseCode', type: 'string', description: 'Enterprise code', example: '7709418' },
      { path: 'enterpriseEntityRID', type: 'number', description: 'Enterprise entity RID', example: 84 },
      { path: 'description', type: 'string', description: 'Event description', example: 'Object created' },
      { path: 'unitRID', type: 'number', description: 'Unit resource identifier', example: 3264 },
      { path: 'userRID', type: 'number', description: 'User resource identifier', example: 55502772 },

      // Visit object fields
      { path: 'visit.sealed', type: 'boolean', description: 'Visit sealed status', example: false },
      { path: 'visit.sourceSystemId', type: 'number', description: 'source system visit ID', example: 0 },
      { path: 'visit.updateCount', type: 'number', description: 'Visit update count', example: 0 },
      { path: 'visit.visitCategory', type: 'number', description: 'Visit category', example: 0 },
      { path: 'visit.patientAgeInDays', type: 'number', description: 'Patient age in days', example: 0 },
      { path: 'visit.patientAgeInYears', type: 'number', description: 'Patient age in years', example: 0 },
      { path: 'visit.patientAgeInMonths', type: 'number', description: 'Patient age in months', example: 0 },
      { path: 'visit.freeRemainingCount', type: 'number', description: 'Free remaining count', example: 0 },
      { path: 'visit.sourceAppointmentId', type: 'number', description: 'source system appointment ID', example: 0 },

      // Patient object fields
      {
        path: 'patient.mrn.documentNumber',
        type: 'string',
        description: 'Patient MRN document number',
        example: 'SEC/860797/25',
      },
      {
        path: 'patient.mrn.sequenceNumber',
        type: 'number',
        description: 'Patient MRN sequence number',
        example: 25416590,
      },
      { path: 'patient.fullName', type: 'string', description: 'Patient full name', example: 'Leelavathi B A' },
      { path: 'patient.phone', type: 'string', description: 'Patient phone number', example: '8310955291' },
      { path: 'patient.email', type: 'string', description: 'Patient email address', example: '' },
      { path: 'patient.address', type: 'string', description: 'Patient address', example: 'Kannanda Bane' },
      { path: 'patient.isVIP', type: 'boolean', description: 'VIP patient flag', example: false },
      { path: 'patient.isExpired', type: 'number', description: 'Patient expired flag', example: 0 },
      { path: 'patient.isUnknown', type: 'boolean', description: 'Unknown patient flag', example: false },
      { path: 'patient.isInternational', type: 'boolean', description: 'International patient flag', example: false },
      { path: 'patient.confidential', type: 'boolean', description: 'Confidential flag', example: false },
      { path: 'patient.notifyBySms', type: 'boolean', description: 'SMS notification preference', example: false },
      { path: 'patient.notifyByEmail', type: 'boolean', description: 'Email notification preference', example: false },
      {
        path: 'patient.notifyByWhatsapp',
        type: 'boolean',
        description: 'WhatsApp notification preference',
        example: false,
      },
      {
        path: 'patient.isMobileNoVerified',
        type: 'boolean',
        description: 'Mobile verification status',
        example: false,
      },
      { path: 'patient.valid', type: 'number', description: 'Patient validity status', example: 0 },
      { path: 'patient.sourceSystemId', type: 'number', description: 'source system ID', example: 0 },
      { path: 'patient.referencePatientId', type: 'number', description: 'Reference patient ID', example: 0 },
      { path: 'patient.updateCount', type: 'number', description: 'Update count', example: 0 },
    ],
  },

  {
    eventType: 'OP_VISIT_MODIFIED',
    label: 'OP Visit Modified',
    description: 'Triggered when an outpatient visit is modified',
    category: 'Visit Management',
    isActive: true,
    fields: [
      { path: 'type', type: 'string', description: 'Event type identifier', example: 'OP_VISIT_MODIFIED' },
      { path: 'datetime', type: 'string', description: 'Event timestamp', example: '24/01/2026 06:14 PM' },
      { path: 'orgUnitRid', type: 'number', description: 'Org unit resource identifier', example: 84 },
      { path: 'entityCode', type: 'string', description: 'Entity code', example: '7172139' },
      { path: 'entityName', type: 'string', description: 'Entity name', example: 'SANKARA EYE HOSPITAL, Bangalore' },
      { path: 'entityPhone', type: 'string', description: 'Entity phone number', example: '08069038900' },
      { path: 'entityParentID', type: 'number', description: 'Parent entity identifier', example: 84 },
      { path: 'enterpriseCode', type: 'string', description: 'Enterprise code', example: '7709418' },
      { path: 'enterpriseEntityRID', type: 'number', description: 'Enterprise entity RID', example: 84 },
      { path: 'description', type: 'string', description: 'Event description', example: 'Object created' },
      { path: 'unitRID', type: 'number', description: 'Unit resource identifier', example: 3470 },
      { path: 'userRID', type: 'number', description: 'User resource identifier', example: 3439091 },

      // Visit object fields (comprehensive)
      { path: 'visit.id.value', type: 'string', description: 'Visit ID', example: '19840889' },
      { path: 'visit.date', type: 'string', description: 'Visit date', example: '24/01/2026' },
      { path: 'visit.time', type: 'string', description: 'Visit time', example: '06:14 PM' },
      { path: 'visit.type', type: 'number', description: 'Visit type code', example: 1 },
      { path: 'visit.typeName', type: 'string', description: 'Visit type name', example: 'OP' },
      { path: 'visit.status', type: 'number', description: 'Visit status code', example: 8 },
      { path: 'visit.statusName', type: 'string', description: 'Visit status name', example: 'Draft' },
      { path: 'visit.patientMRN', type: 'string', description: 'Patient MRN', example: 'SEHBLR/908601/26' },
      { path: 'visit.gender.name', type: 'string', description: 'Patient gender', example: 'Male' },
      { path: 'visit.gender.index', type: 'number', description: 'Gender code', example: 1 },
      {
        path: 'visit.speciality.name',
        type: 'string',
        description: 'Speciality name',
        example: 'General Ophthalmology',
      },
      { path: 'visit.speciality.index', type: 'number', description: 'Speciality code', example: 549222 },
      { path: 'visit.consultingDoctor.value', type: 'string', description: 'Consulting doctor ID', example: '54589' },
      { path: 'visit.visitedEntity.value', type: 'string', description: 'Visited entity ID', example: '84' },
      { path: 'visit.referredBy', type: 'string', description: 'Referral source', example: 'Self' },
      {
        path: 'visit.referralPhoneNumber',
        type: 'string',
        description: 'Referral phone number',
        example: '8754111722',
      },
      { path: 'visit.visitNumber.documentNumber', type: 'string', description: 'Visit document number', example: '' },
      { path: 'visit.visitNumber.sequenceNumber', type: 'number', description: 'Visit sequence number', example: 1 },
      { path: 'visit.leadNo', type: 'string', description: 'Lead number', example: '' },
      { path: 'visit.leadRemarks', type: 'string', description: 'Lead remarks', example: '' },
      { path: 'visit.sealed', type: 'boolean', description: 'Visit sealed status', example: false },
      { path: 'visit.sourceSystemId', type: 'number', description: 'source system visit ID', example: 0 },
      { path: 'visit.updateCount', type: 'number', description: 'Visit update count', example: 0 },
      { path: 'visit.visitCategory', type: 'number', description: 'Visit category', example: 0 },
      { path: 'visit.patientAgeInDays', type: 'number', description: 'Patient age in days', example: 0 },
      { path: 'visit.patientAgeInYears', type: 'number', description: 'Patient age in years', example: 0 },
      { path: 'visit.patientAgeInMonths', type: 'number', description: 'Patient age in months', example: 0 },
      { path: 'visit.freeRemainingCount', type: 'number', description: 'Free remaining count', example: 0 },
      { path: 'visit.sourceAppointmentId', type: 'number', description: 'source system appointment ID', example: 0 },

      // Patient object fields
      {
        path: 'patient.mrn.documentNumber',
        type: 'string',
        description: 'Patient MRN document number',
        example: 'SEHBLR/908601/26',
      },
      {
        path: 'patient.mrn.sequenceNumber',
        type: 'number',
        description: 'Patient MRN sequence number',
        example: 59071146,
      },
      { path: 'patient.fullName', type: 'string', description: 'Patient full name', example: 'Kishore' },
      { path: 'patient.phone', type: 'string', description: 'Patient phone number', example: '7498668989' },
      { path: 'patient.address', type: 'string', description: 'Patient address', example: 'Btm' },
      { path: 'patient.isVIP', type: 'boolean', description: 'VIP patient flag', example: false },
      { path: 'patient.valid', type: 'number', description: 'Patient validity status', example: 0 },
      { path: 'patient.isExpired', type: 'number', description: 'Patient expired flag', example: 0 },
      { path: 'patient.isUnknown', type: 'boolean', description: 'Unknown patient flag', example: false },
      { path: 'patient.isInternational', type: 'boolean', description: 'International patient flag', example: false },
      { path: 'patient.confidential', type: 'boolean', description: 'Confidential flag', example: false },
      { path: 'patient.notifyBySms', type: 'boolean', description: 'SMS notification preference', example: false },
      { path: 'patient.notifyByEmail', type: 'boolean', description: 'Email notification preference', example: false },
      {
        path: 'patient.notifyByWhatsapp',
        type: 'boolean',
        description: 'WhatsApp notification preference',
        example: false,
      },
      {
        path: 'patient.isMobileNoVerified',
        type: 'boolean',
        description: 'Mobile verification status',
        example: false,
      },
      { path: 'patient.sourceSystemId', type: 'number', description: 'source system ID', example: 0 },
      { path: 'patient.referencePatientId', type: 'number', description: 'Reference patient ID', example: 0 },
      { path: 'patient.updateCount', type: 'number', description: 'Update count', example: 0 },
    ],
  },

  {
    eventType: 'APPOINTMENT_CONFIRMATION',
    label: 'Appointment Confirmation',
    description: 'Triggered when an appointment is confirmed/created',
    category: 'Appointment Management',
    isActive: true,
    fields: [
      { path: 'type', type: 'string', description: 'Event type identifier', example: 'APPOINTMENT_CONFIRMATION' },
      { path: 'datetime', type: 'string', description: 'Event timestamp', example: '24/01/2026 05:10 PM' },
      { path: 'orgUnitRid', type: 'number', description: 'Org unit resource identifier', example: 435 },
      { path: 'entityCode', type: 'string', description: 'Entity code', example: '7823876' },
      { path: 'entityName', type: 'string', description: 'Entity name', example: 'SANKARA EYE HOSPITAL, Hyderabad' },
      { path: 'entityPhone', type: 'string', description: 'Entity phone number', example: '040-2345660' },
      { path: 'entityParentID', type: 'number', description: 'Parent entity identifier', example: 84 },
      { path: 'enterpriseCode', type: 'string', description: 'Enterprise code', example: '7709418' },
      { path: 'enterpriseEntityRID', type: 'number', description: 'Enterprise entity RID', example: 84 },
      { path: 'description', type: 'string', description: 'Event description', example: 'Appointment Object Created' },
      { path: 'unitRID', type: 'number', description: 'Unit resource identifier', example: 9708 },
      { path: 'userRID', type: 'number', description: 'User resource identifier', example: 15228108 },

      // Appointment object fields
      { path: 'appt.apptRID', type: 'number', description: 'Appointment resource ID', example: 3909468 },
      {
        path: 'appt.bookingNumber',
        type: 'string',
        description: 'Booking number',
        example: 'SEH-HYDERABAD-24012026-06',
      },
      { path: 'appt.apptDate', type: 'string', description: 'Appointment date', example: '2026-01-24' },
      { path: 'appt.apptTime', type: 'string', description: 'Appointment time', example: '17:10:00' },
      { path: 'appt.fromDate', type: 'string', description: 'From date', example: '2026-01-24' },
      { path: 'appt.fromTime', type: 'string', description: 'From time', example: '17:10:00' },
      { path: 'appt.apptDuration', type: 'number', description: 'Appointment duration in minutes', example: 10 },
      { path: 'appt.apptStatus', type: 'number', description: 'Appointment status code', example: 2 },
      { path: 'appt.apptStatusName', type: 'string', description: 'Appointment status name', example: 'SCHEDULED' },
      { path: 'appt.apptType', type: 'number', description: 'Appointment type code', example: 1 },
      { path: 'appt.apptTypeName', type: 'string', description: 'Appointment type name', example: 'REGULAR' },
      { path: 'appt.patientRID', type: 'number', description: 'Patient resource ID', example: 59071145 },
      { path: 'appt.patientName', type: 'string', description: 'Patient name', example: 'Krishna' },
      { path: 'appt.patientMRN', type: 'string', description: 'Patient MRN', example: '' },
      { path: 'appt.patientPhone', type: 'string', description: 'Patient phone', example: '8787879898' },
      { path: 'appt.visitRID', type: 'number', description: 'Visit resource ID', example: 19840887 },
      { path: 'appt.serviceProviderRID', type: 'number', description: 'Service provider RID', example: 34206 },
      {
        path: 'appt.serviceProviderName',
        type: 'string',
        description: 'Service provider name',
        example: 'Balam Pradeep',
      },
      {
        path: 'appt.serviceProviderPhone',
        type: 'string',
        description: 'Service provider phone',
        example: '9591956783',
      },
      {
        path: 'appt.serviceProviderResourceRID',
        type: 'number',
        description: 'Service provider resource RID',
        example: 73638,
      },
      { path: 'appt.resourceName', type: 'string', description: 'Resource name', example: 'Balam Pradeep' },
      { path: 'appt.resourceType', type: 'number', description: 'Resource type', example: 1 },
      { path: 'appt.isResourceAppointment', type: 'boolean', description: 'Is resource appointment', example: true },
      { path: 'appt.isVideoConsultation', type: 'boolean', description: 'Is video consultation', example: false },
      { path: 'appt.serviceRID', type: 'number', description: 'Service RID', example: 0 },
      { path: 'appt.serviceName', type: 'string', description: 'Service name', example: '' },
      { path: 'appt.servicePointRID', type: 'number', description: 'Service point RID', example: 0 },
      { path: 'appt.servicePointName', type: 'string', description: 'Service point name', example: '' },
      { path: 'appt.consultationFee', type: 'number', description: 'Consultation fee', example: 0.0 },
      { path: 'appt.paymentStatus', type: 'number', description: 'Payment status', example: 0 },
      { path: 'appt.bookingSource', type: 'string', description: 'Booking source', example: 'WALK_IN' },
      { path: 'appt.callCenterBooking', type: 'number', description: 'Call center booking flag', example: 0 },
      { path: 'appt.tokenNumber', type: 'string', description: 'Token number', example: '' },
      { path: 'appt.remarks', type: 'string', description: 'Appointment remarks', example: '' },
      { path: 'appt.recurring', type: 'boolean', description: 'Recurring appointment', example: false },
      { path: 'appt.orderRID', type: 'number', description: 'Order RID', example: 0 },
      { path: 'appt.updateCount', type: 'number', description: 'Update count', example: 0 },
      {
        path: 'appt.apptCreatedUserRID',
        type: 'number',
        description: 'User who created appointment',
        example: 15228108,
      },

      // Visit object fields
      { path: 'visit.id.value', type: 'string', description: 'Visit ID', example: '19840887' },
      { path: 'visit.date', type: 'string', description: 'Visit date', example: '24/01/2026' },
      { path: 'visit.time', type: 'string', description: 'Visit time', example: '05:10 PM' },
      { path: 'visit.type', type: 'number', description: 'Visit type code', example: 1 },
      { path: 'visit.typeName', type: 'string', description: 'Visit type name', example: 'OP' },
      { path: 'visit.status', type: 'number', description: 'Visit status code', example: 8 },
      { path: 'visit.statusName', type: 'string', description: 'Visit status name', example: 'Draft' },
      { path: 'visit.patientMRN', type: 'string', description: 'Patient MRN', example: '' },
      { path: 'visit.gender.name', type: 'string', description: 'Patient gender', example: 'Male' },
      { path: 'visit.gender.index', type: 'number', description: 'Gender code', example: 1 },
      { path: 'visit.speciality.name', type: 'string', description: 'Speciality name', example: 'Glaucoma' },
      { path: 'visit.speciality.index', type: 'number', description: 'Speciality code', example: 1654727 },
      { path: 'visit.consultingDoctor.value', type: 'string', description: 'Consulting doctor ID', example: '34206' },
      { path: 'visit.visitedEntity.value', type: 'string', description: 'Visited entity ID', example: '84' },
      { path: 'visit.referredBy', type: 'string', description: 'Referral source', example: 'Self' },
      { path: 'visit.visitNumber.documentNumber', type: 'string', description: 'Visit document number', example: '' },
      { path: 'visit.visitNumber.sequenceNumber', type: 'number', description: 'Visit sequence number', example: 1 },
      { path: 'visit.leadNo', type: 'string', description: 'Lead number', example: '' },
      { path: 'visit.leadRemarks', type: 'string', description: 'Lead remarks', example: '' },
      { path: 'visit.sealed', type: 'boolean', description: 'Visit sealed status', example: false },
      { path: 'visit.sourceSystemId', type: 'number', description: 'source system visit ID', example: 0 },
      { path: 'visit.updateCount', type: 'number', description: 'Visit update count', example: 0 },
      { path: 'visit.visitCategory', type: 'number', description: 'Visit category', example: 0 },
      { path: 'visit.patientAgeInDays', type: 'number', description: 'Patient age in days', example: 0 },
      { path: 'visit.patientAgeInYears', type: 'number', description: 'Patient age in years', example: 0 },
      { path: 'visit.patientAgeInMonths', type: 'number', description: 'Patient age in months', example: 0 },
      { path: 'visit.freeRemainingCount', type: 'number', description: 'Free remaining count', example: 0 },
      { path: 'visit.sourceAppointmentId', type: 'number', description: 'source system appointment ID', example: 0 },

      // Patient object fields
      { path: 'patient.mrn.documentNumber', type: 'string', description: 'Patient MRN document number', example: '' },
      {
        path: 'patient.mrn.sequenceNumber',
        type: 'number',
        description: 'Patient MRN sequence number',
        example: 59071145,
      },
      { path: 'patient.fullName', type: 'string', description: 'Patient full name', example: 'Krishna' },
      { path: 'patient.phone', type: 'string', description: 'Patient phone number', example: '8787879898' },
      { path: 'patient.valid', type: 'number', description: 'Patient validity status', example: 0 },
      { path: 'patient.isVIP', type: 'boolean', description: 'VIP patient flag', example: false },
      { path: 'patient.isExpired', type: 'number', description: 'Patient expired flag', example: 0 },
      { path: 'patient.isUnknown', type: 'boolean', description: 'Unknown patient flag', example: false },
      { path: 'patient.isInternational', type: 'boolean', description: 'International patient flag', example: false },
      { path: 'patient.confidential', type: 'boolean', description: 'Confidential flag', example: false },
      { path: 'patient.notifyBySms', type: 'boolean', description: 'SMS notification preference', example: false },
      { path: 'patient.notifyByEmail', type: 'boolean', description: 'Email notification preference', example: false },
      {
        path: 'patient.notifyByWhatsapp',
        type: 'boolean',
        description: 'WhatsApp notification preference',
        example: false,
      },
      {
        path: 'patient.isMobileNoVerified',
        type: 'boolean',
        description: 'Mobile verification status',
        example: false,
      },
      { path: 'patient.sourceSystemId', type: 'number', description: 'source system ID', example: 0 },
      { path: 'patient.referencePatientId', type: 'number', description: 'Reference patient ID', example: 0 },
      { path: 'patient.updateCount', type: 'number', description: 'Update count', example: 0 },
    ],
  },

  {
    eventType: 'APPOINTMENT_CANCELLATION',
    label: 'Appointment Cancellation',
    description: 'Triggered when an appointment is cancelled',
    category: 'Appointment Management',
    isActive: true,
    fields: [
      { path: 'type', type: 'string', description: 'Event type identifier', example: 'APPOINTMENT_CANCELLATION' },
      { path: 'datetime', type: 'string', description: 'Event timestamp', example: '24/01/2026 04:43 PM' },
      { path: 'orgUnitRid', type: 'number', description: 'Org unit resource identifier', example: 849 },
      { path: 'entityCode', type: 'string', description: 'Entity code', example: '7179258' },
      { path: 'entityName', type: 'string', description: 'Entity name', example: 'Oval Fertility Private Limited' },
      { path: 'entityPhone', type: 'string', description: 'Entity phone number', example: '9898989898' },
      { path: 'entityParentID', type: 'number', description: 'Parent entity identifier', example: 847 },
      { path: 'enterpriseCode', type: 'string', description: 'Enterprise code', example: '7576746' },
      { path: 'enterpriseEntityRID', type: 'number', description: 'Enterprise entity RID', example: 847 },
      { path: 'description', type: 'string', description: 'Event description', example: 'Appointment Cancelled' },
      { path: 'unitRID', type: 'number', description: 'Unit resource identifier', example: 20432 },
      { path: 'userRID', type: 'number', description: 'User resource identifier', example: 41317657 },

      // Appointment object fields (similar to APPOINTMENT_CONFIRMATION but with status = CANCELLED)
      { path: 'appt.apptRID', type: 'number', description: 'Appointment resource ID', example: 3909466 },
      {
        path: 'appt.bookingNumber',
        type: 'string',
        description: 'Booking number',
        example: 'BANJARA HILLS-24012026-08',
      },
      { path: 'appt.apptDate', type: 'string', description: 'Appointment date', example: '2026-01-24' },
      { path: 'appt.apptTime', type: 'string', description: 'Appointment time', example: '16:50:00' },
      {
        path: 'appt.apptStatus',
        type: 'number',
        description: 'Appointment status code (-1 for cancelled)',
        example: -1,
      },
      { path: 'appt.apptStatusName', type: 'string', description: 'Appointment status name', example: 'CANCELLED' },
      { path: 'appt.patientRID', type: 'number', description: 'Patient resource ID', example: 59071143 },
      { path: 'appt.patientName', type: 'string', description: 'Patient name', example: 'John' },
      { path: 'appt.patientPhone', type: 'string', description: 'Patient phone', example: '9515557495' },
      {
        path: 'appt.serviceProviderName',
        type: 'string',
        description: 'Service provider name',
        example: 'Sandeep Karunakaran',
      },

      // Visit and patient fields (same as APPOINTMENT_CONFIRMATION)
      { path: 'visit.id.value', type: 'string', description: 'Visit ID', example: '19840885' },
      { path: 'visit.status', type: 'number', description: 'Visit status code (5 for cancelled)', example: 5 },
      { path: 'visit.statusName', type: 'string', description: 'Visit status name', example: 'Cancelled' },
      {
        path: 'patient.mrn.sequenceNumber',
        type: 'number',
        description: 'Patient MRN sequence number',
        example: 59071143,
      },
      { path: 'patient.fullName', type: 'string', description: 'Patient full name', example: 'John' },
      { path: 'patient.phone', type: 'string', description: 'Patient phone number', example: '9515557495' },
    ],
  },

  {
    eventType: 'APPOINTMENT_RESCHEDULED',
    label: 'Appointment Rescheduled',
    description: 'Triggered when an appointment is rescheduled',
    category: 'Appointment Management',
    isActive: true,
    fields: [
      { path: 'type', type: 'string', description: 'Event type identifier', example: 'APPOINTMENT_RESCHEDULED' },
      { path: 'datetime', type: 'string', description: 'Event timestamp', example: '24/01/2026 04:43 PM' },
      { path: 'description', type: 'string', description: 'Event description', example: 'Appointment Rescheduled' },

      // Current appointment details
      { path: 'appt.apptRID', type: 'number', description: 'Appointment resource ID', example: 3909466 },
      { path: 'appt.apptDate', type: 'string', description: 'New appointment date', example: '2026-01-24' },
      { path: 'appt.apptTime', type: 'string', description: 'New appointment time', example: '16:50:00' },
      { path: 'appt.patientRID', type: 'number', description: 'Patient resource ID', example: 59071143 },
      { path: 'appt.patientName', type: 'string', description: 'Patient name', example: 'John' },

      // Previous appointment details (in previousValues object)
      {
        path: 'appt.previousValues.apptRID',
        type: 'number',
        description: 'Previous appointment RID',
        example: 3909465,
      },
      {
        path: 'appt.previousValues.apptDate',
        type: 'string',
        description: 'Previous appointment date',
        example: '2026-01-24',
      },
      {
        path: 'appt.previousValues.apptTime',
        type: 'string',
        description: 'Previous appointment time',
        example: '18:00:00',
      },
      {
        path: 'appt.previousValues.recurring',
        type: 'boolean',
        description: 'Previous recurring status',
        example: false,
      },
      { path: 'appt.previousValues.updateCount', type: 'number', description: 'Previous update count', example: 0 },
      { path: 'appt.previousValues.apptDuration', type: 'number', description: 'Previous duration', example: 10 },
      {
        path: 'appt.previousValues.servicePointRID',
        type: 'number',
        description: 'Previous service point RID',
        example: 0,
      },
      {
        path: 'appt.previousValues.servicePointName',
        type: 'string',
        description: 'Previous service point name',
        example: '',
      },
      {
        path: 'appt.previousValues.serviceProviderRID',
        type: 'number',
        description: 'Previous service provider RID',
        example: 75656,
      },
      {
        path: 'appt.previousValues.serviceProviderName',
        type: 'string',
        description: 'Previous service provider name',
        example: 'Sandeep Karunakaran',
      },
      {
        path: 'appt.previousValues.isVideoConsultation',
        type: 'boolean',
        description: 'Previous video consultation flag',
        example: false,
      },
      {
        path: 'appt.previousValues.isResourceAppointment',
        type: 'boolean',
        description: 'Previous resource appointment flag',
        example: false,
      },

      // Visit and patient fields
      { path: 'visit.id.value', type: 'string', description: 'Visit ID', example: '19840885' },
      {
        path: 'patient.mrn.sequenceNumber',
        type: 'number',
        description: 'Patient MRN sequence number',
        example: 59071143,
      },
      { path: 'patient.fullName', type: 'string', description: 'Patient full name', example: 'John' },
    ],
  },

  {
    eventType: 'BILL_CREATED',
    label: 'Bill Created',
    description: 'Triggered when a new bill is created',
    category: 'Billing',
    isActive: true,
    fields: [
      { path: 'type', type: 'string', description: 'Event type identifier', example: 'BILL_CREATED' },
      { path: 'datetime', type: 'string', description: 'Event timestamp', example: '24/01/2026 04:35 PM' },
      { path: 'orgUnitRid', type: 'number', description: 'Org unit resource identifier', example: 849 },
      { path: 'entityCode', type: 'string', description: 'Entity code', example: '7179258' },
      { path: 'entityName', type: 'string', description: 'Entity name', example: 'Oval Fertility Private Limited' },
      { path: 'entityPhone', type: 'string', description: 'Entity phone number', example: '9898989898' },
      { path: 'enterpriseCode', type: 'string', description: 'Enterprise code', example: '7576746' },
      { path: 'description', type: 'string', description: 'Event description', example: 'Object created' },

      // Bill array (first element fields)
      { path: 'Bill[0].id', type: 'string', description: 'Bill ID', example: '20341014' },
      { path: 'Bill[0].billNumber', type: 'string', description: 'Bill number', example: 'BNH/OP/25/88' },
      { path: 'Bill[0].billStatus', type: 'string', description: 'Bill status', example: 'FullyPaid' },
      { path: 'Bill[0].date', type: 'string', description: 'Bill date', example: '24/01/2026' },
      { path: 'Bill[0].visitDate', type: 'string', description: 'Visit date', example: '24/01/2026' },
      { path: 'Bill[0].visitType', type: 'string', description: 'Visit type', example: 'OP' },
      { path: 'Bill[0].visitID', type: 'string', description: 'Visit ID', example: '19840884' },
      { path: 'Bill[0].patientID', type: 'string', description: 'Patient ID', example: '59071142' },
      { path: 'Bill[0].patientMRN', type: 'string', description: 'Patient MRN', example: 'BNH00033' },
      { path: 'Bill[0].entityID', type: 'string', description: 'Entity ID', example: '849' },
      { path: 'Bill[0].unitID', type: 'string', description: 'Unit ID', example: '20432' },
      { path: 'Bill[0].unitName', type: 'string', description: 'Unit name', example: 'BILLING' },
      { path: 'Bill[0].netAmount', type: 'string', description: 'Net amount', example: '600.0' },
      { path: 'Bill[0].taxAmount', type: 'string', description: 'Tax amount', example: '0.0' },
      { path: 'Bill[0].payerType', type: 'string', description: 'Payer type', example: 'N' },
      { path: 'Bill[0].agencyCode', type: 'string', description: 'Agency code', example: '' },
      { path: 'Bill[0].seqNumber', type: 'string', description: 'Sequence number', example: '88' },
      { path: 'Bill[0].receiptId', type: 'string', description: 'Receipt ID', example: '18611234' },
      { path: 'Bill[0].IPNO', type: 'string', description: 'IP number', example: '' },

      // Bill detail array (first element fields)
      { path: 'Bill[0].billDetail[0].detailId', type: 'string', description: 'Bill detail ID', example: '73076571' },
      { path: 'Bill[0].billDetail[0].billId', type: 'string', description: 'Bill ID', example: '20341014' },
      { path: 'Bill[0].billDetail[0].orderId', type: 'string', description: 'Order ID', example: '35583621' },
      { path: 'Bill[0].billDetail[0].chargeId', type: 'string', description: 'Charge ID', example: '1522064' },
      { path: 'Bill[0].billDetail[0].chargeCode', type: 'string', description: 'Charge code', example: 'CONSFEE' },
      {
        path: 'Bill[0].billDetail[0].chargeName',
        type: 'string',
        description: 'Charge name',
        example: 'CONSULTATION CHARGES',
      },
      { path: 'Bill[0].billDetail[0].chargeType', type: 'string', description: 'Charge type', example: 'C' },
      { path: 'Bill[0].billDetail[0].groupId', type: 'string', description: 'Group ID', example: '8959560' },
      { path: 'Bill[0].billDetail[0].groupCode', type: 'string', description: 'Group code', example: 'G-8959372' },
      { path: 'Bill[0].billDetail[0].groupName', type: 'string', description: 'Group name', example: 'Consultation' },
      { path: 'Bill[0].billDetail[0].groupTypeId', type: 'string', description: 'Group type ID', example: '1' },
      {
        path: 'Bill[0].billDetail[0].parentGroupID',
        type: 'string',
        description: 'Parent group ID',
        example: '8959517',
      },
      {
        path: 'Bill[0].billDetail[0].parentGroupCode',
        type: 'string',
        description: 'Parent group code',
        example: 'G-8959329',
      },
      {
        path: 'Bill[0].billDetail[0].parentGroupName',
        type: 'string',
        description: 'Parent group name',
        example: 'CHARGES',
      },
      { path: 'Bill[0].billDetail[0].qty', type: 'string', description: 'Quantity', example: '1.0' },
      { path: 'Bill[0].billDetail[0].price', type: 'string', description: 'Price', example: '600.0' },
      { path: 'Bill[0].billDetail[0].grossAmount', type: 'string', description: 'Gross amount', example: '600.0' },
      { path: 'Bill[0].billDetail[0].discAmount', type: 'string', description: 'Discount amount', example: '0.0' },
      {
        path: 'Bill[0].billDetail[0].discPercentage',
        type: 'string',
        description: 'Discount percentage',
        example: '0.0',
      },
      { path: 'Bill[0].billDetail[0].taxAmount', type: 'string', description: 'Tax amount', example: '0.0' },
      { path: 'Bill[0].billDetail[0].taxPercentage', type: 'string', description: 'Tax percentage', example: '0.0' },
      { path: 'Bill[0].billDetail[0].netAmount', type: 'string', description: 'Net amount', example: '600.0' },
      { path: 'Bill[0].billDetail[0].patientAmount', type: 'string', description: 'Patient amount', example: '600.0' },
      { path: 'Bill[0].billDetail[0].payerAmount', type: 'string', description: 'Payer amount', example: '0.0' },
      {
        path: 'Bill[0].billDetail[0].patientLineNetAmt',
        type: 'string',
        description: 'Patient line net amount',
        example: '600.0',
      },
      {
        path: 'Bill[0].billDetail[0].payerLineNetAmt',
        type: 'string',
        description: 'Payer line net amount',
        example: '0.0',
      },
      {
        path: 'Bill[0].billDetail[0].payerGrossAmt',
        type: 'string',
        description: 'Payer gross amount',
        example: '0.0',
      },
      { path: 'Bill[0].billDetail[0].coPayAmt', type: 'string', description: 'Co-pay amount', example: '0.0' },
      { path: 'Bill[0].billDetail[0].hsn', type: 'string', description: 'HSN code', example: '01' },
      { path: 'Bill[0].billDetail[0].hcpcsCode', type: 'string', description: 'HCPCS code', example: '' },
      { path: 'Bill[0].billDetail[0].mrp', type: 'string', description: 'MRP', example: null },
      {
        path: 'Bill[0].billDetail[0].orderDateTime',
        type: 'string',
        description: 'Order date time',
        example: '2026-01-24 16:35:14',
      },
      { path: 'Bill[0].billDetail[0].incidentId', type: 'string', description: 'Incident ID', example: '19840884' },
      {
        path: 'Bill[0].billDetail[0].itemTransType',
        type: 'string',
        description: 'Item transaction type',
        example: 'O',
      },
      { path: 'Bill[0].billDetail[0].batchNumber', type: 'string', description: 'Batch number', example: '' },
      { path: 'Bill[0].billDetail[0].batchNumberId', type: 'string', description: 'Batch number ID', example: '' },
      { path: 'Bill[0].billDetail[0].packageId', type: 'string', description: 'Package ID', example: '0' },
      { path: 'Bill[0].billDetail[0].packageQty', type: 'string', description: 'Package quantity', example: '0.0' },
      { path: 'Bill[0].billDetail[0].packageAmt', type: 'string', description: 'Package amount', example: '0.0' },
      { path: 'Bill[0].billDetail[0].packageOrderId', type: 'string', description: 'Package order ID', example: '0' },
      { path: 'Bill[0].billDetail[0].planId', type: 'string', description: 'Plan ID', example: '0' },
      { path: 'Bill[0].billDetail[0].pcmId', type: 'string', description: 'PCM ID', example: '0' },
      { path: 'Bill[0].billDetail[0].orderHeaderId', type: 'string', description: 'Order header ID', example: '0' },
      {
        path: 'Bill[0].billDetail[0].orderHeaderNumber',
        type: 'string',
        description: 'Order header number',
        example: '',
      },
      { path: 'Bill[0].billDetail[0].billOrderStatus', type: 'string', description: 'Bill order status', example: '0' },
      { path: 'Bill[0].billDetail[0].discRemarks', type: 'string', description: 'Discount remarks', example: '' },
      {
        path: 'Bill[0].billDetail[0].isDiscApproved',
        type: 'string',
        description: 'Is discount approved',
        example: '1',
      },
      {
        path: 'Bill[0].billDetail[0].discApprovalUserId',
        type: 'string',
        description: 'Discount approval user ID',
        example: '0',
      },
      {
        path: 'Bill[0].billDetail[0].isItemLevelDiscGiven',
        type: 'string',
        description: 'Is item level discount given',
        example: '0',
      },
      { path: 'Bill[0].billDetail[0].debtAdviceType', type: 'string', description: 'Debt advice type', example: '1' },
      {
        path: 'Bill[0].billDetail[0].billingBedTypeId',
        type: 'string',
        description: 'Billing bed type ID',
        example: '0',
      },
      {
        path: 'Bill[0].billDetail[0].claimsDeniedAmt',
        type: 'string',
        description: 'Claims denied amount',
        example: '0.0',
      },
    ],
  },

  {
    eventType: 'OP_REFERRAL_DOCTOR_EVENT',
    label: 'OP Referral Doctor Event',
    description: 'Triggered when an OP referral doctor event occurs',
    category: 'Referral Management',
    isActive: true,
    fields: [
      { path: 'type', type: 'string', description: 'Event type identifier', example: 'OP_REFERRAL_DOCTOR_EVENT' },
      { path: 'datetime', type: 'string', description: 'Event timestamp', example: '24/01/2026 02:07 PM' },
      { path: 'orgUnitRid', type: 'number', description: 'Org unit resource identifier', example: 84 },
      { path: 'entityCode', type: 'string', description: 'Entity code', example: '7831211' },
      { path: 'entityName', type: 'string', description: 'Entity name', example: 'SANKARA EYE HOSPITAL, Coimbatore' },
      { path: 'description', type: 'string', description: 'Event description', example: 'OP referral doctor event' },
      { path: 'unitRID', type: 'number', description: 'Unit resource identifier', example: 3264 },
      { path: 'userRID', type: 'number', description: 'User resource identifier', example: 55502772 },

      // Visit and patient fields (minimal structure)
      { path: 'visit.sealed', type: 'boolean', description: 'Visit sealed status', example: false },
      { path: 'visit.sourceSystemId', type: 'number', description: 'source system visit ID', example: 0 },
      {
        path: 'patient.mrn.documentNumber',
        type: 'string',
        description: 'Patient MRN document number',
        example: 'SEC/860797/25',
      },
      {
        path: 'patient.mrn.sequenceNumber',
        type: 'number',
        description: 'Patient MRN sequence number',
        example: 25416590,
      },
      { path: 'patient.fullName', type: 'string', description: 'Patient full name', example: 'Leelavathi B A' },
      { path: 'patient.phone', type: 'string', description: 'Patient phone number', example: '8310955291' },
      { path: 'patient.email', type: 'string', description: 'Patient email address', example: '' },
      { path: 'patient.address', type: 'string', description: 'Patient address', example: 'Kannanda Bane' },
    ],
  },
];

/**
 * Seed event type schemas to MongoDB
 */
async function seedEventSchemas() {
  try {
    await mongodb.connect();
    const mongoDb = await mongodb.getDbSafe();
    const collection = mongoDb.collection('event_types');

    log('info', 'Starting event schema seeding...');

    let created = 0;
    let updated = 0;

    for (const schema of eventTypeSchemas) {
      const result = await collection.updateOne(
        { eventType: schema.eventType },
        {
          $set: {
            ...schema,
            orgId: null,
            updatedAt: new Date(),
          },
          $setOnInsert: {
            createdAt: new Date(),
          },
        },
        { upsert: true }
      );

      if (result.upsertedCount > 0) {
        created++;
        log('info', `Created schema for ${schema.eventType}`, { fieldCount: schema.fields.length });
      } else {
        updated++;
        log('info', `Updated schema for ${schema.eventType}`, { fieldCount: schema.fields.length });
      }
    }

    log('info', 'Event schema seeding completed', {
      total: eventTypeSchemas.length,
      created,
      updated,
    });

    await mongodb.close();
  } catch (error) {
    log('error', 'Failed to seed event schemas', { error: error.message });
    throw error;
  }
}

// Run if called directly
if (require.main === module) {
  seedEventSchemas()
    .then(() => {
      console.log('Event schemas seeded successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Failed to seed event schemas:', error);
      process.exit(1);
    });
}

module.exports = { seedEventSchemas, eventTypeSchemas };
