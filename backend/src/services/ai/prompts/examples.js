/**
 * Transformation examples for AI prompts
 */

/**
 * Build transformation examples
 */
function buildTransformationExamples() {
  return `## TRANSFORMATION EXAMPLES

**Example 1: Simple Patient Data Mapping**
\`\`\`javascript
const identity = payload.patient?.mrn?.documentNumber || payload.patient?.phone || '';
const name = payload.patient?.fullName || '';
const phone = payload.patient?.phone || '';
const email = payload.patient?.email || '';

return {
  patientId: identity,
  patientName: name,
  contactNumber: phone,
  emailAddress: email
};
\`\`\`

**Example 2: Phone Number Formatting (WhatsApp/International)**
\`\`\`javascript
let phone = payload.patient?.phone || payload.appt?.patientPhone || '';
// Remove non-numeric characters
phone = phone.replace(/[^0-9]/g, '');
// Add +91 if not present
if (phone && !phone.startsWith('91')) {
  phone = '91' + phone;
}
// Format for WhatsApp (with +)
phone = '+' + phone;

return {
  to: phone,
  message: \`Hi \${payload.patient?.fullName || 'Patient'}, your appointment is confirmed.\`
};
\`\`\`

**Example 3: Date/Time Formatting**
\`\`\`javascript
// Convert DD/MM/YYYY to ISO 8601
const dateParts = (payload.appt?.apptDate || '').split('-'); // YYYY-MM-DD format
const timeParts = (payload.appt?.apptTime || '00:00:00').split(':'); // HH:mm:ss format

const isoDateTime = \`\${payload.appt?.apptDate}T\${payload.appt?.apptTime}\`;

return {
  appointmentDate: payload.appt?.apptDate, // YYYY-MM-DD
  appointmentTime: payload.appt?.apptTime, // HH:mm:ss
  appointmentISO: isoDateTime               // ISO 8601
};
\`\`\`

**Example 4: Bill Data (Array Access)**
\`\`\`javascript
const bill = payload.Bill?.[0]; // Get first bill from array
const firstLineItem = bill?.billDetail?.[0]; // Get first line item

return {
  billNumber: bill?.billNumber || '',
  totalAmount: parseFloat(bill?.netAmount || '0'),
  patientMRN: bill?.patientMRN || '',
  firstItemName: firstLineItem?.chargeName || '',
  firstItemAmount: parseFloat(firstLineItem?.netAmount || '0')
};
\`\`\`

**Example 5: Conditional Logic**
\`\`\`javascript
const eventType = context.eventType;
const patient = payload.patient;

// Different logic based on event type
if (eventType === 'PATIENT_REGISTERED') {
  return {
    action: 'create_profile',
    name: patient?.fullName || '',
    phone: patient?.phone || ''
  };
} else if (eventType === 'APPOINTMENT_CONFIRMATION') {
  return {
    action: 'book_appointment',
    patientName: payload.appt?.patientName || '',
    appointmentDate: payload.appt?.apptDate || ''
  };
}

return { action: 'unknown' };
\`\`\``;
}

module.exports = {
  buildTransformationExamples,
};
