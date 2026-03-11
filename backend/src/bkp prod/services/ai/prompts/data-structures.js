/**
 * Data structure documentation for source system events
 * Fetches from MongoDB event_types collection (single source of truth)
 */

const mongodb = require('../../../mongodb');

/**
 * Get data structures documentation from MongoDB event_types collection
 * No fallbacks - MongoDB is required
 */
async function getDataStructuresDocs() {
  const db = await mongodb.getDbSafe();

  // Fetch all event types to extract field documentation
  const eventTypes = await db.collection('event_types')
    .find({})
    .toArray();

  // Extract fields by object type
  const patientFields = [];
  const visitFields = [];
  const apptFields = [];
  const billFields = [];

  // Collect all fields from all event types (including nested properties)
  eventTypes.forEach(eventType => {
    if (!eventType.fields) return;

    // Recursive function to extract all fields including nested properties
    const extractFields = (fields) => {
      fields.forEach(field => {
        const path = field.path || '';

        // Add this field
        if (path.startsWith('patient.')) {
          if (!patientFields.find(f => f.path === path)) {
            patientFields.push(field);
          }
        } else if (path.startsWith('visit.')) {
          if (!visitFields.find(f => f.path === path)) {
            visitFields.push(field);
          }
        } else if (path.startsWith('appt.')) {
          if (!apptFields.find(f => f.path === path)) {
            apptFields.push(field);
          }
        } else if (path.startsWith('Bill.') || path.startsWith('bill.')) {
          if (!billFields.find(f => f.path === path)) {
            billFields.push(field);
          }
        }

        // Recursively process nested properties
        if (field.properties && Array.isArray(field.properties)) {
          extractFields(field.properties);
        }
      });
    };

    extractFields(eventType.fields);
  });

  // Build documentation from extracted fields
  return {
    patient: buildObjectDocFromFields('PATIENT OBJECT', patientFields),
    visit: buildObjectDocFromFields('VISIT OBJECT', visitFields),
    appt: buildObjectDocFromFields('APPOINTMENT OBJECT', apptFields),
    bill: buildObjectDocFromFields('BILL OBJECT', billFields)
  };
}

/**
 * Build markdown documentation from field array
 */
function buildObjectDocFromFields(title, fields) {
  if (!fields || fields.length === 0) {
    return `**${title}**: No fields available`;
  }

  fields.sort((a, b) => (a.path || '').localeCompare(b.path || ''));

  let doc = `**${title}** (${fields.length} fields):\n\`\`\`javascript\n{\n`;

  fields.forEach(field => {
    const path = field.path || '';
    const fieldName = path.split('.').pop();
    const description = field.description || '';
    const example = field.example;

    let value = example !== undefined
      ? (typeof example === 'string' ? `"${example}"` : example)
      : '[VALUE]';

    if (description) {
      doc += `  ${fieldName}: ${value}, // ${description}\n`;
    } else {
      doc += `  ${fieldName}: ${value},\n`;
    }
  });

  doc += `}\n\`\`\``;
  return doc;
}

/**
 * Build patient object documentation (LEGACY - for backward compatibility only)
 */
function buildPatientObjectDoc() {
  return `**PATIENT OBJECT STRUCTURE** (payload.patient):
\`\`\`javascript
{
  mrn: {
    documentNumber: "[HOSPITAL_CODE/NUMBER/YEAR]",
    sequenceNumber: [NUMBER]
  },
  fullName: "[PATIENT_NAME]",
  phone: "[10_DIGIT_PHONE]",
  email: "[EMAIL_OR_EMPTY]",
  address: "[ADDRESS]",
  age: [NUMBER],
  gender: "[Male|Female|Other]",
  isVIP: false,
  isInternational: false,
  isExpired: 0,
  isUnknown: false,
  confidential: false,
  notifyBySms: true,
  notifyByEmail: true,
  notifyByWhatsapp: true,
  isMobileNoVerified: false,
  valid: 0,
  sourceSystemId: 0,
  referencePatientId: 0,
  updateCount: 0
}
\`\`\``;
}

/**
 * Build visit object documentation (LEGACY - for backward compatibility only)
 */
function buildVisitObjectDoc() {
  return `**VISIT OBJECT STRUCTURE** (payload.visit):
\`\`\`javascript
{
  id: { value: "19840889" },
  date: "24/01/2026",
  time: "06:14 PM",
  type: 1,
  typeName: "OP",
  status: 8,
  statusName: "Draft",
  patientMRN: "SEHBLR/908601/26",
  gender: { name: "Male", index: 1 },
  speciality: { name: "General Ophthalmology", index: 549222 },
  consultingDoctor: { value: "54589" },
  visitedEntity: { value: "84" },
  referredBy: "Self",
  referralPhoneNumber: "8754111722",
  visitNumber: { documentNumber: "OP/123/26", sequenceNumber: 1 },
  leadNo: "",
  leadRemarks: "",
  sealed: false,
  visitCategory: 0,
  patientAgeInDays: 0,
  patientAgeInYears: 35,
  patientAgeInMonths: 420,
  freeRemainingCount: 0,
  sourceAppointmentId: 0
}
\`\`\``;
}

/**
 * Build appointment object documentation (LEGACY - for backward compatibility only)
 */
function buildApptObjectDoc() {
  return `**APPOINTMENT OBJECT STRUCTURE** (payload.appt):
\`\`\`javascript
{
  apptRID: 3909468,
  bookingNumber: "SEH-HYD-24012026-06",
  apptDate: "2026-01-24",
  apptTime: "17:10:00",
  fromDate: "2026-01-24",
  fromTime: "17:10:00",
  apptDuration: 10,
  apptStatus: 2,
  apptStatusName: "SCHEDULED",
  apptType: 1,
  apptTypeName: "REGULAR",
  patientRID: 59071145,
  patientName: "Krishna Kumar",
  patientMRN: "SEHBLR/908601/26",
  patientPhone: "8787879898",
  visitRID: 19840887,
  serviceProviderRID: 34206,
  serviceProviderName: "Dr. Balam Pradeep",
  serviceProviderPhone: "9591956783",
  serviceProviderResourceRID: 73638,
  resourceName: "Dr. Balam Pradeep",
  resourceType: 1,
  isResourceAppointment: true,
  isVideoConsultation: false,
  serviceRID: 0,
  serviceName: "",
  servicePointRID: 0,
  servicePointName: "",
  consultationFee: 500.0,
  paymentStatus: 0,
  bookingSource: "WALK_IN",
  callCenterBooking: 0,
  tokenNumber: "A123",
  remarks: "Follow-up checkup",
  recurring: false,
  orderRID: 0,
  updateCount: 0,
  apptCreatedUserRID: 15228108
}
\`\`\``;
}

/**
 * Build bill object documentation (LEGACY - for backward compatibility only)
 */
function buildBillObjectDoc() {
  return `**BILL OBJECT STRUCTURE** (payload.Bill - NOTE: This is an ARRAY):
\`\`\`javascript
Bill: [
  {
    id: 12345,
    billNumber: "BILL/2026/001234",
    billStatus: 1,
    date: "24/01/2026",
    patientMRN: "SEHBLR/908601/26",
    patientName: "Kishore Kumar",
    patientPhone: "7498668989",
    netAmount: 5000.00,
    taxAmount: 900.00,
    grossAmount: 5900.00,
    discountAmount: 500.00,
    paidAmount: 5900.00,
    balanceAmount: 0.00,
    billDetail: [
      {
        chargeName: "Consultation Fee",
        chargeCode: "CONSULT",
        qty: 1,
        price: 500.00,
        amount: 500.00,
        discountAmount: 0.00,
        taxAmount: 90.00,
        netAmount: 590.00
      }
    ],
    visitRID: 19840887,
    doctorRID: 54589,
    doctorName: "Dr. Pradeep",
    paymentMode: "CASH",
    paymentReference: "TXN123456",
    createdBy: 3439091,
    createdDate: "24/01/2026 06:14 PM"
  }
]
\`\`\`

**IMPORTANT**: Bill is an ARRAY. Always access it as:
\`\`\`javascript
const bill = payload.Bill?.[0];
const billNumber = bill?.billNumber || '';
const amount = bill?.netAmount || 0;
\`\`\``;
}

module.exports = {
  getDataStructuresDocs,
  // Export individual functions for fallback
  buildPatientObjectDoc,
  buildVisitObjectDoc,
  buildApptObjectDoc,
  buildBillObjectDoc
};
