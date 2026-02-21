const { applyTransform } = require('./src/services/transformer');

const testPayload = {
  eventType: 'PATIENT_REGISTERED',
  patientMRN: 'MRN001',
  uhid: 'UHID001',
  patientName: 'John Doe',
  patientPhone: '9876543210',
  patientEmail: 'john.doe@example.com',
  gender: 'Male',
  age: 35,
  city: 'Mumbai',
  state: 'Maharashtra',
  entityRid: 33
};

const webhook = {
  transformationMode: 'SCRIPT',
  transformation: {
    script: "const identity = payload.patientMRN || payload.patientPhone || payload.uhid || 'unknown'; let phone = payload.patientPhone || payload.phone || ''; if (phone && !phone.startsWith('+91')) { phone = '+91' + phone; } return { d: [{ identity: identity, type: 'profile', profileData: { Name: payload.patientName || payload.name, MRN: payload.patientMRN || payload.mrn, UHID: payload.uhid, Phone: phone, Email: payload.patientEmail || payload.email, Gender: payload.gender, Age: payload.age, City: payload.city, State: payload.state, LastVisit: new Date().toISOString() } }] };"
  }
};

const context = {
  eventType: 'PATIENT_REGISTERED',
  entityRid: 33
};

console.log('Testing transformation...');
console.log('Input payload:', testPayload);

try {
  const result = applyTransform(webhook, testPayload, context);
  console.log('\nTransformed result:', JSON.stringify(result, null, 2));
} catch (err) {
  console.error('\nError:', err.message);
  console.error(err.stack);
}
