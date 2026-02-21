/**
 * CleverTap Integration Template Seeder
 *
 * Seeds a production-ready CleverTap integration template into MongoDB
 * that can be used by any tenant via the templates API.
 *
 * Run: node backend/src/data/seed-clevertap-template.js
 */

const mongodb = require('../mongodb');
const { log } = require('../logger');

// CleverTap template with production-validated schemas
const CLEVERTAP_TEMPLATE = {
  name: 'CleverTap - Complete Integration',
  description: 'Production-ready CleverTap integration with profile uploads, event tracking, and MSG-* communication preferences. Supports 8 validated event types with rich field mappings.',
  category: 'CRM',
  eventType: '*',  // All events
  targetUrl: 'https://{{region}}.api.clevertap.com/1/upload',  // Placeholder for region
  httpMethod: 'POST',
  authType: 'CUSTOM_HEADERS',
  authConfig: {
    headers: {
      'X-CleverTap-Account-Id': '{{accountId}}',  // Placeholder
      'X-CleverTap-Passcode': '{{passcode}}',      // Placeholder
      'Content-Type': 'application/json'
    }
  },
  headers: {},
  timeoutMs: 30000,
  retryCount: 3,
  transformationMode: 'SCRIPT',
  transformation: {
    mode: 'SCRIPT',
    mappings: [],
    staticFields: [],
    script: ''
  },
  actions: [
    {
      name: 'Profile Upload - Patient Events',
      condition: "eventType === 'PATIENT_REGISTERED' || eventType === 'OP_VISIT_CREATED'",
      targetUrl: 'https://{{region}}.api.clevertap.com/1/upload',
      httpMethod: 'POST',
      transformationMode: 'SCRIPT',
      transformation: {
        script: "const identity = payload.patient?.mrn?.documentNumber || payload.patient?.phone || payload.patientMRN || payload.patientPhone || 'unknown'; let phone = payload.patient?.phone || payload.patientPhone || payload.phone || ''; if (phone && !phone.startsWith('+')) { const isInternational = payload.patient?.isInternational || false; if (!isInternational && !phone.startsWith('91')) { phone = '+91' + phone; } else if (!phone.startsWith('+')) { phone = '+' + phone; } } let dob = null; const age = payload.patient?.age || payload.age; if (age) { const birthYear = new Date().getFullYear() - age; dob = '$D_' + birthYear + '-01-01'; } const notifyBySms = payload.patient?.notifyBySms ?? true; const notifyByEmail = payload.patient?.notifyByEmail ?? true; const notifyByWhatsapp = payload.patient?.notifyByWhatsapp ?? true; const profileData = { Name: payload.patient?.fullName || payload.patientName || payload.name, Email: payload.patient?.email || payload.patientEmail || payload.email, Phone: phone, Identity: identity, Gender: (payload.patient?.gender || payload.gender || '').charAt(0).toUpperCase(), 'MSG-sms': notifyBySms, 'MSG-email': notifyByEmail, 'MSG-whatsapp': notifyByWhatsapp, MRN: payload.patient?.mrn?.documentNumber || payload.patientMRN || payload.mrn, 'MRN Sequence': payload.patient?.mrn?.sequenceNumber, UHID: payload.uhid, Address: payload.patient?.address || payload.address, City: payload.city, State: payload.state, 'Is VIP': payload.patient?.isVIP || false, 'Is International': payload.patient?.isInternational || false, 'Is Mobile Verified': payload.patient?.isMobileNoVerified || false, 'Last Visit': new Date().toISOString(), 'Patient Source': 'source system' }; if (dob) { profileData.DOB = dob; } if (age) { profileData.Age = age; } return { d: [{ identity: identity, type: 'profile', profileData: profileData }] };"
      }
    },
    {
      name: 'Event Upload - All Healthcare Events',
      targetUrl: 'https://{{region}}.api.clevertap.com/1/upload',
      httpMethod: 'POST',
      transformationMode: 'SCRIPT',
      transformation: {
        script: "const identity = payload.patient?.mrn?.documentNumber || payload.patient?.phone || payload.patientMRN || payload.patientPhone || 'unknown'; const eventType = payload.type || context.eventType; const eventName = eventType ? eventType.replace(/_/g, ' ').toLowerCase().replace(/\\b\\w/g, l => l.toUpperCase()) : 'Healthcare Event'; const timestamp = Math.floor(Date.now() / 1000); const evtData = { 'Event Type': eventType, 'Source': 'source system', 'Entity Name': payload.entityName || context.entityName, 'Org Unit ID': payload.orgUnitRid || context.orgUnitRid, 'Description': payload.description }; if (eventType === 'PATIENT_REGISTERED') { evtData['Patient Name'] = payload.patient?.fullName; evtData['MRN'] = payload.patient?.mrn?.documentNumber; evtData['Is VIP'] = payload.patient?.isVIP || false; evtData['Is International'] = payload.patient?.isInternational || false; } else if (eventType === 'APPOINTMENT_CONFIRMATION') { evtData['Appointment ID'] = payload.appt?.apptRID; evtData['Booking Number'] = payload.appt?.bookingNumber; evtData['Appointment Date'] = payload.appt?.apptDate; evtData['Appointment Time'] = payload.appt?.apptTime; evtData['Appointment Status'] = payload.appt?.apptStatusName; evtData['Doctor Name'] = payload.appt?.serviceProviderName; evtData['Speciality'] = payload.visit?.speciality?.name; evtData['Consultation Fee'] = payload.appt?.consultationFee; evtData['Booking Source'] = payload.appt?.bookingSource; evtData['Is Video Consultation'] = payload.appt?.isVideoConsultation || false; evtData['Patient Name'] = payload.patient?.fullName; evtData['Patient Phone'] = payload.patient?.phone; } else if (eventType === 'APPOINTMENT_CANCELLATION') { evtData['Appointment ID'] = payload.appt?.apptRID; evtData['Booking Number'] = payload.appt?.bookingNumber; evtData['Original Date'] = payload.appt?.apptDate; evtData['Original Time'] = payload.appt?.apptTime; evtData['Doctor Name'] = payload.appt?.serviceProviderName; evtData['Cancellation Reason'] = payload.appt?.remarks || 'Not specified'; evtData['Patient Name'] = payload.patient?.fullName; } else if (eventType === 'APPOINTMENT_RESCHEDULED') { evtData['Appointment ID'] = payload.appt?.apptRID; evtData['New Date'] = payload.appt?.apptDate; evtData['New Time'] = payload.appt?.apptTime; evtData['Previous Date'] = payload.appt?.previousValues?.apptDate; evtData['Previous Time'] = payload.appt?.previousValues?.apptTime; evtData['Patient Name'] = payload.patient?.fullName; } else if (eventType === 'BILL_CREATED') { const bill = payload.Bill?.[0]; if (bill) { evtData['Bill Number'] = bill.billNumber; evtData['Bill Status'] = bill.billStatus; evtData['Net Amount'] = parseFloat(bill.netAmount); evtData['Tax Amount'] = parseFloat(bill.taxAmount); evtData['Visit Type'] = bill.visitType; evtData['Payer Type'] = bill.payerType; if (bill.billDetail && bill.billDetail.length > 0) { evtData['Line Items Count'] = bill.billDetail.length; evtData['First Charge'] = bill.billDetail[0].chargeName; } } } else if (eventType === 'OP_VISIT_CREATED' || eventType === 'OP_VISIT_MODIFIED') { evtData['Visit ID'] = payload.visit?.id?.value; evtData['Visit Date'] = payload.visit?.date; evtData['Visit Time'] = payload.visit?.time; evtData['Visit Type'] = payload.visit?.typeName; evtData['Visit Status'] = payload.visit?.statusName; evtData['Consulting Doctor ID'] = payload.visit?.consultingDoctor?.value; evtData['Speciality'] = payload.visit?.speciality?.name; evtData['Referred By'] = payload.visit?.referredBy; } else { if (payload.billAmount || payload.amount) evtData['Amount'] = payload.billAmount || payload.amount; if (payload.doctorName) evtData['Doctor'] = payload.doctorName; if (payload.departmentName) evtData['Department'] = payload.departmentName; if (payload.appointmentDate) evtData['Appointment Date'] = payload.appointmentDate; if (payload.labTestName) evtData['Lab Test'] = payload.labTestName; if (payload.medicationName) evtData['Medication'] = payload.medicationName; } return { d: [{ identity: identity, ts: timestamp, type: 'event', evtName: eventName, evtData: evtData }] };"
      }
    }
  ],
  isActive: true,
  metadata: {
    version: '2.0',
    author: 'Integration Gateway',
    lastUpdated: new Date().toISOString(),
    features: [
      'Production event schema mappings',
      'MSG-* communication preferences',
      'Dynamic phone formatting',
      'Event-specific field mappings',
      '8 validated event types',
      'Backward compatible'
    ],
    placeholders: {
      region: {
        description: 'CleverTap region (in1, us1, sg1, eu1)',
        default: 'in1',
        required: true
      },
      accountId: {
        description: 'CleverTap Account ID',
        example: '6K7-8R6-857Z',
        required: true
      },
      passcode: {
        description: 'CleverTap Passcode',
        example: 'WHQ-KSY-CPEL',
        required: true
      }
    },
    supportedEventTypes: [
      'PATIENT_REGISTERED',
      'OP_VISIT_CREATED',
      'OP_VISIT_MODIFIED',
      'APPOINTMENT_CONFIRMATION',
      'APPOINTMENT_CANCELLATION',
      'APPOINTMENT_RESCHEDULED',
      'BILL_CREATED',
      'OP_REFERRAL_DOCTOR_EVENT'
    ],
    documentation: '/docs/integrations/clevertap-crm.md'
  }
};

/**
 * Seed CleverTap template for a specific org unit
 */
async function seedCleverTapTemplate(orgId) {
  try {
    await mongodb.connect();
    const mongoDb = await mongodb.getDbSafe();
    const collection = mongoDb.collection('integration_templates');

    log('info', 'Seeding CleverTap template', { orgId });

    // Check if template already exists for this entity
    const existing = await collection.findOne({
      orgUnitRid: orgId,
      name: CLEVERTAP_TEMPLATE.name
    });

    if (existing) {
      // Update existing template
      const result = await collection.updateOne(
        { _id: existing._id },
        {
          $set: {
            ...CLEVERTAP_TEMPLATE,
            updatedAt: new Date()
          }
        }
      );

      log('info', 'CleverTap template updated', {
        templateId: existing._id.toString(),
        orgId
      });

      return {
        id: existing._id.toString(),
        ...CLEVERTAP_TEMPLATE,
        isNew: false
      };
    } else {
      // Create new template
      const templateDoc = {
        orgUnitRid: orgId,
        ...CLEVERTAP_TEMPLATE,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      const result = await collection.insertOne(templateDoc);

      log('info', 'CleverTap template created', {
        templateId: result.insertedId.toString(),
        orgId
      });

      return {
        id: result.insertedId.toString(),
        ...CLEVERTAP_TEMPLATE,
        isNew: true
      };
    }
  } catch (error) {
    log('error', 'Failed to seed CleverTap template', {
      error: error.message,
      orgId
    });
    throw error;
  }
}

/**
 * Seed template for all existing org units
 */
async function seedCleverTapTemplateForAll() {
  try {
    await mongodb.connect();
    const mongoDb = await mongodb.getDbSafe();
    const integrationsCollection = mongoDb.collection('integration_configs');

    // Get unique orgUnitRids from existing integrations
    const orgUnitRids = await integrationsCollection.distinct('orgUnitRid');

    log('info', 'Found entities to seed templates for', {
      count: orgUnitRids.length,
      orgUnitRids
    });

    const results = [];
    for (const orgUnitRid of orgUnitRids) {
      try {
        const result = await seedCleverTapTemplate(orgUnitRid);
        results.push({
          orgUnitRid,
          success: true,
          templateId: result.id,
          isNew: result.isNew
        });
      } catch (error) {
        results.push({
          orgUnitRid,
          success: false,
          error: error.message
        });
      }
    }

    log('info', 'CleverTap template seeding completed', {
      total: results.length,
      successful: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length
    });

    return results;
  } catch (error) {
    log('error', 'Failed to seed CleverTap templates for all entities', {
      error: error.message
    });
    throw error;
  } finally {
    await mongodb.close();
  }
}

// Run if called directly
if (require.main === module) {
  const args = process.argv.slice(2);
  const orgUnitRid = args[0] ? parseInt(args[0]) : null;

  if (orgUnitRid) {
    // Seed for specific org unit
    seedCleverTapTemplate(orgUnitRid)
      .then((result) => {
        console.log('✅ CleverTap template seeded successfully:');
        console.log(`   Template ID: ${result.id}`);
        console.log(`   Org Unit RID: ${orgUnitRid}`);
        console.log(`   Status: ${result.isNew ? 'Created' : 'Updated'}`);
        process.exit(0);
      })
      .catch((error) => {
        console.error('❌ Failed to seed CleverTap template:', error.message);
        process.exit(1);
      })
      .finally(() => mongodb.close());
  } else {
    // Seed for all org units
    seedCleverTapTemplateForAll()
      .then((results) => {
        console.log('✅ CleverTap template seeding completed:');
        console.log(`   Total: ${results.length}`);
        console.log(`   Successful: ${results.filter(r => r.success).length}`);
        console.log(`   Failed: ${results.filter(r => !r.success).length}`);

        results.forEach(result => {
          if (result.success) {
            console.log(`   ✓ Org Unit ${result.orgUnitRid}: ${result.isNew ? 'Created' : 'Updated'} (${result.templateId})`);
          } else {
            console.log(`   ✗ Org Unit ${result.orgUnitRid}: ${result.error}`);
          }
        });

        process.exit(0);
      })
      .catch((error) => {
        console.error('❌ Failed to seed CleverTap templates:', error.message);
        process.exit(1);
      });
  }
}

module.exports = {
  CLEVERTAP_TEMPLATE,
  seedCleverTapTemplate,
  seedCleverTapTemplateForAll
};
