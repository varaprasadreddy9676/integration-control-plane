/**
 * IVF/Fertility Treatment Event Schema Seeder
 * Seeds event_types collection with IVF and fertility treatment event schemas
 *
 * Run this script to add IVF event types to MongoDB:
 * node backend/src/data/seed-ivf-event-schemas.js
 */

const mongodb = require('../mongodb');
const { log } = require('../logger');

/**
 * Common fields shared across all IVF events
 */
const commonFields = [
  { path: 'type', type: 'string', description: 'Event type identifier', example: 'TREATMENT_ADVISED' },
  { path: 'datetime', type: 'string', description: 'Event timestamp', example: '27/01/2026 01:21 PM' },
  { path: 'orgUnitRid', type: 'number', description: 'Org unit resource identifier', example: 353 },
  { path: 'entityCode', type: 'string', description: 'Entity code', example: '7635035' },
  { path: 'entityName', type: 'string', description: 'Entity name', example: 'GarbhaGudi IVF Centre Pvt Ltd - Kalyan Nagar' },
  { path: 'entityPhone', type: 'string', description: 'Entity phone number', example: '9886825556' },
  { path: 'entityParentID', type: 'number', description: 'Parent entity identifier', example: 353 },
  { path: 'enterpriseCode', type: 'string', description: 'Enterprise code', example: '7331985' },
  { path: 'enterpriseEntityRID', type: 'number', description: 'Enterprise entity RID', example: 353 },
  { path: 'description', type: 'string', description: 'Event description', example: 'Treatment Advised' },
  { path: 'unitRID', type: 'number', description: 'Unit resource identifier', example: 8058 },
  { path: 'userRID', type: 'number', description: 'User resource identifier', example: 12991391 },

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
  { path: 'patient.mrn.documentNumber', type: 'string', description: 'Patient MRN document number', example: '25-26/GGKN/05338' },
  { path: 'patient.mrn.sequenceNumber', type: 'number', description: 'Patient MRN sequence number', example: 59071078 },
  { path: 'patient.fullName', type: 'string', description: 'Patient full name', example: 'Leela' },
  { path: 'patient.phone', type: 'string', description: 'Patient phone number', example: '9886106330' },
  { path: 'patient.email', type: 'string', description: 'Patient email address', example: '' },
  { path: 'patient.address', type: 'string', description: 'Patient address', example: 'HLK' },
  { path: 'patient.isVIP', type: 'boolean', description: 'VIP patient flag', example: false },
  { path: 'patient.isExpired', type: 'number', description: 'Patient expired flag', example: 0 },
  { path: 'patient.isUnknown', type: 'boolean', description: 'Unknown patient flag', example: false },
  { path: 'patient.isInternational', type: 'boolean', description: 'International patient flag', example: false },
  { path: 'patient.confidential', type: 'boolean', description: 'Confidential flag', example: false },
  { path: 'patient.notifyBySms', type: 'boolean', description: 'SMS notification preference', example: false },
  { path: 'patient.notifyByEmail', type: 'boolean', description: 'Email notification preference', example: false },
  { path: 'patient.notifyByWhatsapp', type: 'boolean', description: 'WhatsApp notification preference', example: false },
  { path: 'patient.isMobileNoVerified', type: 'boolean', description: 'Mobile verification status', example: false },
  { path: 'patient.valid', type: 'number', description: 'Patient validity status', example: 0 },
  { path: 'patient.sourceSystemId', type: 'number', description: 'source system ID', example: 0 },
  { path: 'patient.referencePatientId', type: 'number', description: 'Reference patient ID', example: 0 },
  { path: 'patient.updateCount', type: 'number', description: 'Update count', example: 0 }
];

/**
 * IVF/Fertility Treatment event type schemas
 * EventTypeIds start from 57 (highest existing is 56)
 */
const ivfEventSchemas = [
  {
    eventType: 'TREATMENT_ADVISED',
    eventTypeId: 57,
    label: 'Treatment Advised',
    description: 'Triggered when a treatment is advised to a patient',
    category: 'Treatment Management',
    implementationClass: 'ubq.ivf.TreatmentAdvisedEvent',
    isActive: true,
    fields: [
      ...commonFields,
      { path: 'treatmentAdvise.treatmentType', type: 'string', description: 'Type of treatment advised', example: 'IVF' },
      { path: 'treatmentAdvise.treatmentAdviseBy', type: 'string', description: 'Name of person who advised treatment', example: 'UBQ Admin' },
      { path: 'treatmentAdvise.treatmentAdviseId', type: 'number', description: 'Treatment advise record ID', example: 680061 },
      { path: 'treatmentAdvise.treatmentAdviseDate', type: 'string', description: 'Date when treatment was advised', example: '07/01/2026 12:00 AM' }
    ]
  },

  {
    eventType: 'CONSENT_RECEIVED',
    eventTypeId: 58,
    label: 'Consent Received',
    description: 'Triggered when patient consent is received for a treatment',
    category: 'Treatment Management',
    implementationClass: 'ubq.ivf.ConsentReceivedEvent',
    isActive: true,
    fields: [
      ...commonFields,
      { path: 'consentReceived.doctor', type: 'string', description: 'Primary doctor name', example: 'Dr AVINASH' },
      { path: 'consentReceived.counsellor', type: 'string', description: 'Counsellor name', example: 'Bhuvaneshwari.' },
      { path: 'consentReceived.coordinator', type: 'string', description: 'Coordinator name', example: 'SUMITHRA K' },
      { path: 'consentReceived.treatmentType', type: 'string', description: 'Type of treatment', example: 'IVF' },
      { path: 'consentReceived.assistantDoctor', type: 'string', description: 'Assistant doctor name', example: 'Dr AVINASH' },
      { path: 'consentReceived.consentReceivedOn', type: 'string', description: 'Date consent was received', example: '07/01/2026' },
      { path: 'consentReceived.treatmentAdviseId', type: 'number', description: 'Related treatment advise ID', example: 680061 }
    ]
  },

  {
    eventType: 'TREATMENT_CYCLE_STARTED',
    eventTypeId: 59,
    label: 'Treatment Cycle Started',
    description: 'Triggered when a treatment cycle is started',
    category: 'IVF Cycle Management',
    implementationClass: 'ubq.ivf.TreatmentCycleStartedEvent',
    isActive: true,
    fields: [
      ...commonFields,
      { path: 'treatmentCycle.doctor', type: 'string', description: 'Doctor managing the cycle', example: 'Dr AVINASH' },
      { path: 'treatmentCycle.treatmentType', type: 'string', description: 'Type of treatment (IVF, IUI, etc.)', example: 'IVF' },
      { path: 'treatmentCycle.treatmentStartDate', type: 'string', description: 'Date treatment cycle started', example: '09/01/2026' },
      { path: 'treatmentCycle.treatmentspecification', type: 'string', description: 'Detailed treatment specification', example: 'IVF (Conventional IVF), Self Ovum (Fresh), Partner Sperm' }
    ]
  },

  {
    eventType: 'STIMULATION_STARTED',
    eventTypeId: 60,
    implementationClass: 'ubq.ivf.StimulationStartedEvent',
    label: 'Stimulation Started',
    description: 'Triggered when ovarian stimulation is started',
    category: 'IVF Cycle Management',
    isActive: true,
    fields: [
      ...commonFields,
      { path: 'treatmentChart.chartId', type: 'number', description: 'Treatment chart ID', example: 527844 },
      { path: 'treatmentChart.protocolName', type: 'string', description: 'Stimulation protocol name', example: 'Antagonist' },
      { path: 'treatmentChart.stimulationStartedOn', type: 'string', description: 'Date stimulation started', example: '09/01/2026' }
    ]
  },

  {
    eventType: 'STIMULATION_MEDICATION_RECORDED',
    eventTypeId: 61,
    implementationClass: 'ubq.ivf.StimulationMedicationRecordedEvent',
    label: 'Stimulation Medication Recorded',
    description: 'Triggered when stimulation medication is recorded',
    category: 'IVF Cycle Management',
    isActive: true,
    fields: [
      ...commonFields,
      { path: 'treatmentChartMedicationEvent.chartId', type: 'number', description: 'Treatment chart ID', example: 527844 },
      { path: 'treatmentChartMedicationEvent.protocolName', type: 'string', description: 'Stimulation protocol name', example: 'Antagonist' },
      { path: 'treatmentChartMedicationEvent.stimulationDay', type: 'number', description: 'Day of stimulation cycle', example: 1 },
      { path: 'treatmentChartMedicationEvent.stimulationDate', type: 'string', description: 'Date of medication', example: '10/01/2026' },
      { path: 'treatmentChartMedicationEvent.medicationRecorded', type: 'boolean', description: 'Whether medication was recorded', example: true },
      { path: 'treatmentChartMedicationEvent.stimulationStartedOn', type: 'string', description: 'Stimulation start date', example: '09/01/2026' }
    ]
  },

  {
    eventType: 'STIMULATION_SCAN_RECORDED',
    eventTypeId: 62,
    implementationClass: 'ubq.ivf.StimulationScanRecordedEvent',
    label: 'Stimulation Scan Recorded',
    description: 'Triggered when a stimulation scan is recorded',
    category: 'IVF Cycle Management',
    isActive: true,
    fields: [
      ...commonFields,
      { path: 'treatmentChartScanEvent.chartId', type: 'number', description: 'Treatment chart ID', example: 527844 },
      { path: 'treatmentChartScanEvent.protocolName', type: 'string', description: 'Stimulation protocol name', example: 'Antagonist' },
      { path: 'treatmentChartScanEvent.scanRecorded', type: 'boolean', description: 'Whether scan was recorded', example: true },
      { path: 'treatmentChartScanEvent.stimulationDay', type: 'number', description: 'Day of stimulation cycle', example: 5 },
      { path: 'treatmentChartScanEvent.stimulationDate', type: 'string', description: 'Date of scan', example: '14/01/2026' },
      { path: 'treatmentChartScanEvent.stimulationStartedOn', type: 'string', description: 'Stimulation start date', example: '09/01/2026' }
    ]
  },

  {
    eventType: 'OPU_OR_IUI_TRIGGER_SCHEDULE',
    eventTypeId: 63,
    implementationClass: 'ubq.ivf.OpuOrIuiTriggerScheduleEvent',
    label: 'OPU/IUI Trigger Scheduled',
    description: 'Triggered when trigger injection is scheduled for OPU or IUI',
    category: 'IVF Procedure Management',
    isActive: true,
    fields: [
      ...commonFields,
      { path: 'DUAL_TRIGGER', type: 'number', description: 'Dual trigger identifier', example: 1000703 },
      { path: 'treatmentCycleTrigger.doctor', type: 'string', description: 'Doctor name', example: 'Dr AVINASH' },
      { path: 'treatmentCycleTrigger.cycleId', type: 'number', description: 'Treatment cycle ID', example: 601525 },
      { path: 'treatmentCycleTrigger.firstTriggeredDate', type: 'string', description: 'First trigger date', example: '15/01/2026' },
      { path: 'treatmentCycleTrigger.firstTriggeredDose', type: 'string', description: 'First trigger dose', example: null },
      { path: 'treatmentCycleTrigger.firstTriggeredDrug', type: 'string', description: 'First trigger drug', example: null },
      { path: 'treatmentCycleTrigger.firstTriggeredTime', type: 'string', description: 'First trigger time', example: '02:35 PM' },
      { path: 'treatmentCycleTrigger.secondTriggeredDate', type: 'string', description: 'Second trigger date (dual trigger)', example: '27/01/2026' },
      { path: 'treatmentCycleTrigger.secondTriggeredDose', type: 'string', description: 'Second trigger dose', example: null },
      { path: 'treatmentCycleTrigger.secondTriggeredDrug', type: 'string', description: 'Second trigger drug', example: null },
      { path: 'treatmentCycleTrigger.secondTriggeredTime', type: 'string', description: 'Second trigger time', example: '02:35 PM' },
      { path: 'treatmentCycleTrigger.firstTriggeredOtherDose', type: 'string', description: 'First trigger other dose', example: null },
      { path: 'treatmentCycleTrigger.secondTriggeredOtherDose', type: 'string', description: 'Second trigger other dose', example: null }
    ]
  },

  {
    eventType: 'OPU_SCHEDULE',
    eventTypeId: 64,
    implementationClass: 'ubq.ivf.OpuScheduleEvent',
    label: 'OPU Scheduled',
    description: 'Triggered when Ovum Pick-Up (OPU) is scheduled',
    category: 'IVF Procedure Management',
    isActive: true,
    fields: [
      ...commonFields,
      { path: 'treatmentChart.cycleId', type: 'number', description: 'Treatment cycle ID', example: 601525 },
      { path: 'treatmentChart.treatmentType', type: 'string', description: 'Type of treatment', example: 'IVF' },
      { path: 'treatmentChart.OPUScheduledAt', type: 'string', description: 'OPU scheduled time', example: '01:35 AM' },
      { path: 'treatmentChart.OPUScheduledBy', type: 'string', description: 'Doctor who scheduled OPU', example: 'Dr AVINASH' },
      { path: 'treatmentChart.OPUScheduledOn', type: 'string', description: 'OPU scheduled date', example: '17/01/2026' }
    ]
  },

  {
    eventType: 'OPU_DONE',
    eventTypeId: 65,
    implementationClass: 'ubq.ivf.OpuDoneEvent',
    label: 'OPU Done',
    description: 'Triggered when Ovum Pick-Up (OPU) is completed',
    category: 'IVF Procedure Management',
    isActive: true,
    fields: [
      ...commonFields,
      { path: 'OPU.opuDoneDate', type: 'string', description: 'Date when OPU was completed', example: '17/01/2026' }
    ]
  },

  {
    eventType: 'ET_SCHEDULE',
    eventTypeId: 66,
    implementationClass: 'ubq.ivf.EtScheduleEvent',
    label: 'ET Scheduled',
    description: 'Triggered when Embryo Transfer (ET) is scheduled',
    category: 'IVF Procedure Management',
    isActive: true,
    fields: [
      ...commonFields,
      { path: 'etSchedule.cycleId', type: 'number', description: 'Treatment cycle ID', example: 601525 },
      { path: 'etSchedule.ETScheduledAt', type: 'string', description: 'ET scheduled time', example: '01/01/1970' },
      { path: 'etSchedule.ETScheduledBy', type: 'string', description: 'Doctor who scheduled ET', example: 'Dr AVINASH' },
      { path: 'etSchedule.ETScheduledOn', type: 'string', description: 'ET scheduled date', example: '24/01/2026' },
      { path: 'etSchedule.treatmentType', type: 'string', description: 'Type of treatment', example: 'IVF' }
    ]
  },

  {
    eventType: 'ET_DONE',
    eventTypeId: 67,
    implementationClass: 'ubq.ivf.EtDoneEvent',
    label: 'ET Done',
    description: 'Triggered when Embryo Transfer (ET) is completed',
    category: 'IVF Procedure Management',
    isActive: true,
    fields: [
      ...commonFields,
      { path: 'ET.etDoneDate', type: 'string', description: 'Date when ET was completed', example: '24/01/2026' }
    ]
  },

  {
    eventType: 'BETA_HCG_RECORD',
    eventTypeId: 68,
    implementationClass: 'ubq.ivf.BetaHcgRecordEvent',
    label: 'Beta HCG Recorded',
    description: 'Triggered when Beta HCG test results are recorded',
    category: 'IVF Results Management',
    isActive: true,
    fields: [
      ...commonFields,
      { path: 'betaHCGRecord', type: 'object', description: 'Beta HCG record details', example: {} }
    ]
  },

  {
    eventType: 'CYCLE_COMPLETED',
    eventTypeId: 69,
    implementationClass: 'ubq.ivf.CycleCompletedEvent',
    label: 'Cycle Completed',
    description: 'Triggered when a treatment cycle is completed',
    category: 'IVF Cycle Management',
    isActive: true,
    fields: [
      ...commonFields,
      { path: 'treatmentCycleCompleted.treatmentType', type: 'string', description: 'Type of treatment', example: 'IVF' },
      { path: 'treatmentCycleCompleted.treatmentStatus', type: 'string', description: 'Treatment cycle status', example: 'Treatment cycle completed.' }
    ]
  },

  {
    eventType: 'CLINICAL_PREGNANCY',
    eventTypeId: 70,
    implementationClass: 'ubq.ivf.ClinicalPregnancyEvent',
    label: 'Clinical Pregnancy',
    description: 'Triggered when clinical pregnancy is confirmed',
    category: 'IVF Results Management',
    isActive: true,
    fields: [
      ...commonFields,
      { path: 'clinicalPregnancyRecord.sacCount', type: 'number', description: 'Gestational sac count', example: 2 },
      { path: 'clinicalPregnancyRecord.sacLocation', type: 'string', description: 'Sac location', example: 'Ectopic' },
      { path: 'clinicalPregnancyRecord.sacImplimention', type: 'string', description: 'Sac implantation status', example: 'Successful' },
      { path: 'clinicalPregnancyRecord.clinicalPregnanyRecordedBy', type: 'string', description: 'Doctor who recorded pregnancy', example: 'Dr CHAITHRA S K' },
      { path: 'clinicalPregnancyRecord.clinicalPregnanyRecordedOn', type: 'string', description: 'Date pregnancy was recorded', example: '27/01/2026' }
    ]
  },

  {
    eventType: 'LIVE_BIRTH',
    eventTypeId: 71,
    implementationClass: 'ubq.ivf.LiveBirthEvent',
    label: 'Live Birth',
    description: 'Triggered when live birth is recorded',
    category: 'IVF Results Management',
    isActive: true,
    fields: [
      ...commonFields,
      { path: 'liveBirth.birthTerm', type: 'string', description: 'Birth term (Term/Preterm)', example: 'Term' },
      { path: 'liveBirth.birthCount', type: 'number', description: 'Number of babies born', example: 1 },
      { path: 'liveBirth.birthWeight', type: 'string', description: 'Birth weight', example: null },
      { path: 'liveBirth.birthDetailsRecordedBy', type: 'string', description: 'Doctor who recorded birth', example: 'Dr CHAITHRA S K' },
      { path: 'liveBirth.birthDetailsRecordedDate', type: 'string', description: 'Date birth was recorded', example: '27/01/2026' }
    ]
  },

  {
    eventType: 'IUI_SCHEDULE',
    eventTypeId: 72,
    implementationClass: 'ubq.ivf.IuiScheduleEvent',
    label: 'IUI Scheduled',
    description: 'Triggered when Intrauterine Insemination (IUI) is scheduled',
    category: 'IUI Management',
    isActive: true,
    fields: [
      ...commonFields,
      { path: 'iuiScheduled.cycleId', type: 'number', description: 'Treatment cycle ID', example: 601526 },
      { path: 'iuiScheduled.treatmentType', type: 'string', description: 'Type of treatment', example: 'IUI' },
      { path: 'iuiScheduled.IUIScheduledAt', type: 'string', description: 'IUI scheduled time', example: '11:55 PM' },
      { path: 'iuiScheduled.IUIScheduledBy', type: 'string', description: 'Doctor who scheduled IUI', example: 'Dr ASHA S VIJAY' },
      { path: 'iuiScheduled.IUIScheduledOn', type: 'string', description: 'IUI scheduled date', example: '23/01/2026' }
    ]
  },

  {
    eventType: 'IUI_RECORDED',
    eventTypeId: 73,
    implementationClass: 'ubq.ivf.IuiRecordedEvent',
    label: 'IUI Recorded',
    description: 'Triggered when IUI procedure is recorded',
    category: 'IUI Management',
    isActive: true,
    fields: [
      ...commonFields,
      { path: 'iuiRecord.iuiDoneBy', type: 'string', description: 'Doctor who performed IUI', example: 'Dr AVINASH' },
      { path: 'iuiRecord.iuiDoneDate', type: 'string', description: 'Date IUI was performed', example: '23/01/2026' },
      { path: 'iuiRecord.iuiDoneAndrologist', type: 'string', description: 'Andrologist involved', example: 'Dr SRINIVAS BV' }
    ]
  },

  {
    eventType: 'MISCARRIAGE_RECORDED',
    eventTypeId: 74,
    implementationClass: 'ubq.ivf.MiscarriageRecordedEvent',
    label: 'Miscarriage Recorded',
    description: 'Triggered when pregnancy miscarriage is recorded',
    category: 'IVF Results Management',
    isActive: true,
    fields: [
      ...commonFields,
      { path: 'pregnancyMiscarriage.treatmentType', type: 'string', description: 'Type of treatment', example: 'IUI' },
      { path: 'pregnancyMiscarriage.cycleMiscarriageType', type: 'string', description: 'Type of miscarriage', example: 'Biochemical Miscarriage' }
    ]
  },

  {
    eventType: 'CYCLE_STOPPED',
    eventTypeId: 75,
    implementationClass: 'ubq.ivf.CycleStoppedEvent',
    label: 'Cycle Stopped',
    description: 'Triggered when a treatment cycle is stopped prematurely',
    category: 'IVF Cycle Management',
    isActive: true,
    fields: [
      ...commonFields,
      { path: 'treatmentCycleStopped.treatmentType', type: 'string', description: 'Type of treatment', example: 'Ovum Freezing' },
      { path: 'treatmentCycleStopped.treatmentStoppedOn', type: 'string', description: 'Date treatment was stopped', example: '27/01/2026' },
      { path: 'treatmentCycleStopped.treatmentStoppedReason', type: 'string', description: 'Reason for stopping treatment', example: 'Abnormal Blood Reports' }
    ]
  }
];

/**
 * Seed IVF event type schemas to MongoDB
 */
async function seedIvfEventSchemas() {
  try {
    await mongodb.connect();
    const mongoDb = await mongodb.getDbSafe();
    const collection = mongoDb.collection('event_types');

    log('info', 'Starting IVF event schema seeding...');

    let created = 0;
    let updated = 0;
    let errors = 0;

    for (const schema of ivfEventSchemas) {
      try {
        const result = await collection.updateOne(
          { eventType: schema.eventType },
          {
            $set: {
              ...schema,
              orgId: null,
              updatedAt: new Date()
            },
            $setOnInsert: {
              createdAt: new Date()
            }
          },
          { upsert: true }
        );

        if (result.upsertedCount > 0) {
          created++;
          log('info', `✓ Created schema for ${schema.eventType}`, {
            category: schema.category,
            fieldCount: schema.fields.length
          });
          console.log(`✓ Created: ${schema.eventType} (${schema.fields.length} fields)`);
        } else {
          updated++;
          log('info', `✓ Updated schema for ${schema.eventType}`, {
            category: schema.category,
            fieldCount: schema.fields.length
          });
          console.log(`✓ Updated: ${schema.eventType} (${schema.fields.length} fields)`);
        }
      } catch (error) {
        errors++;
        log('error', `✗ Failed to process ${schema.eventType}`, { error: error.message });
        console.error(`✗ Failed: ${schema.eventType} - ${error.message}`);
      }
    }

    console.log('\n' + '='.repeat(70));
    console.log('IVF Event Schema Seeding Summary');
    console.log('='.repeat(70));
    console.log(`Total schemas processed: ${ivfEventSchemas.length}`);
    console.log(`✓ Created: ${created}`);
    console.log(`✓ Updated: ${updated}`);
    if (errors > 0) {
      console.log(`✗ Errors: ${errors}`);
    }
    console.log('='.repeat(70));

    log('info', 'IVF event schema seeding completed', {
      total: ivfEventSchemas.length,
      created,
      updated,
      errors
    });

    await mongodb.close();

    return { total: ivfEventSchemas.length, created, updated, errors };
  } catch (error) {
    log('error', 'Failed to seed IVF event schemas', { error: error.message });
    console.error('Failed to seed IVF event schemas:', error);
    throw error;
  }
}

/**
 * Verify seeded schemas
 */
async function verifySchemas() {
  try {
    await mongodb.connect();
    const mongoDb = await mongodb.getDbSafe();
    const collection = mongoDb.collection('event_types');

    console.log('\nVerifying seeded schemas...\n');

    for (const schema of ivfEventSchemas) {
      const doc = await collection.findOne({ eventType: schema.eventType });
      if (doc) {
        console.log(`✓ ${schema.eventType} - ${doc.fields.length} fields, active: ${doc.isActive}`);
      } else {
        console.log(`✗ ${schema.eventType} - NOT FOUND`);
      }
    }

    await mongodb.close();
  } catch (error) {
    console.error('Failed to verify schemas:', error);
    throw error;
  }
}

// Run if called directly
if (require.main === module) {
  const args = process.argv.slice(2);
  const shouldVerify = args.includes('--verify');

  seedIvfEventSchemas()
    .then((result) => {
      if (result.errors > 0) {
        console.error(`\nCompleted with ${result.errors} error(s)`);
        process.exit(1);
      } else {
        console.log('\n✓ All IVF event schemas seeded successfully!\n');

        if (shouldVerify) {
          return verifySchemas();
        }
      }
    })
    .then(() => {
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n✗ Failed to seed IVF event schemas:', error);
      process.exit(1);
    });
}

module.exports = { seedIvfEventSchemas, ivfEventSchemas };
