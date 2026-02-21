const mysql = require('mysql2/promise');

async function insertTestEvents() {
  const connection = await mysql.createConnection({
    host: process.env.TEST_MYSQL_HOST || 'localhost',
    port: Number(process.env.TEST_MYSQL_PORT || 3306),
    user: process.env.TEST_MYSQL_USER || 'root',
    password: process.env.TEST_MYSQL_PASSWORD || '',
    database: process.env.TEST_MYSQL_DATABASE || 'integration_gateway'
  });

  const events = [
    {
      topic: 'patient.registered',
      type: 'PATIENT_REGISTERED',
      message: {
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
        entityRid: 33,
        timestamp: new Date().toISOString()
      }
    },
    {
      topic: 'appointment.created',
      type: 'APPOINTMENT_CREATED',
      message: {
        eventType: 'APPOINTMENT_CREATED',
        patientMRN: 'MRN001',
        patientName: 'John Doe',
        patientPhone: '9876543210',
        doctorName: 'Dr. Smith',
        departmentName: 'Cardiology',
        appointmentDate: '2025-12-15 10:00:00',
        appointmentId: 'APT001',
        entityRid: 33,
        timestamp: new Date().toISOString()
      }
    },
    {
      topic: 'opvisit.created',
      type: 'OP_VISIT_CREATED',
      message: {
        eventType: 'OP_VISIT_CREATED',
        patientMRN: 'MRN001',
        uhid: 'UHID001',
        patientName: 'John Doe',
        patientPhone: '9876543210',
        doctorName: 'Dr. Smith',
        departmentName: 'Cardiology',
        visitId: 'VISIT001',
        entityRid: 33,
        timestamp: new Date().toISOString()
      }
    },
    {
      topic: 'bill.created',
      type: 'BILL_CREATED',
      message: {
        eventType: 'BILL_CREATED',
        patientMRN: 'MRN001',
        patientName: 'John Doe',
        patientPhone: '9876543210',
        billId: 'BILL001',
        billAmount: 5000.00,
        billDate: new Date().toISOString(),
        doctorName: 'Dr. Smith',
        departmentName: 'Cardiology',
        entityRid: 33,
        timestamp: new Date().toISOString()
      }
    },
    {
      topic: 'lab.result.signed',
      type: 'LAB_RESULT_SIGNED',
      message: {
        eventType: 'LAB_RESULT_SIGNED',
        patientMRN: 'MRN002',
        patientName: 'Jane Smith',
        patientPhone: '9123456789',
        labTestName: 'Complete Blood Count',
        labTestId: 'LAB001',
        doctorName: 'Dr. Johnson',
        departmentName: 'Pathology',
        entityRid: 33,
        timestamp: new Date().toISOString()
      }
    },
    {
      topic: 'patient.followup',
      type: 'PATIENT_FOLLOWUP_CREATED',
      message: {
        eventType: 'PATIENT_FOLLOWUP_CREATED',
        patientMRN: 'MRN001',
        patientName: 'John Doe',
        patientPhone: '9876543210',
        followupDate: '2025-12-20',
        followupReason: 'Post-surgery checkup',
        doctorName: 'Dr. Smith',
        entityRid: 33,
        timestamp: new Date().toISOString()
      }
    },
    {
      topic: 'appointment.confirmation',
      type: 'APPOINTMENT_CONFIRMATION',
      message: {
        eventType: 'APPOINTMENT_CONFIRMATION',
        patientMRN: 'MRN002',
        patientName: 'Jane Smith',
        patientPhone: '9123456789',
        appointmentId: 'APT002',
        appointmentDate: '2025-12-16 14:00:00',
        doctorName: 'Dr. Johnson',
        departmentName: 'Neurology',
        entityRid: 33,
        timestamp: new Date().toISOString()
      }
    },
    {
      topic: 'retail.bill.created',
      type: 'RETAIL_BILL_CREATED',
      message: {
        eventType: 'RETAIL_BILL_CREATED',
        patientMRN: 'MRN002',
        patientName: 'Jane Smith',
        patientPhone: '9123456789',
        billId: 'PHARM001',
        billAmount: 1200.00,
        medicationName: 'Aspirin, Lisinopril',
        entityRid: 33,
        timestamp: new Date().toISOString()
      }
    }
  ];

  console.log('Inserting test events...');

  for (const event of events) {
    await connection.execute(
      'INSERT INTO notification_queue (topic, transaction_type, message, entity_rid, entity_parent_rid, status, created_at) VALUES (?, ?, ?, ?, ?, ?, NOW())',
      [event.topic, event.type, JSON.stringify(event.message), 33, 33, 'PENDING']
    );
    console.log(`✅ Inserted: ${event.type}`);
  }

  console.log(`\n✅ Successfully inserted ${events.length} test events`);
  await connection.end();
}

insertTestEvents().catch(console.error);
