const mysql = require('mysql2/promise');

async function insertTestEvent() {
  const connection = await mysql.createConnection({
    host: process.env.TEST_MYSQL_HOST || 'localhost',
    port: Number(process.env.TEST_MYSQL_PORT || 3306),
    user: process.env.TEST_MYSQL_USER || 'root',
    password: process.env.TEST_MYSQL_PASSWORD || '',
    database: process.env.TEST_MYSQL_DATABASE || 'integration_gateway'
  });

  try {
    const testEvent = {
      type: 'APPOINTMENT_SCHEDULED',
      patientRid: '12345',
      patient: {
        fullName: 'John Test Patient',
        mrn: 'TEST-001',
        phone: '9876543210'
      },
      appointmentDateTime: '2025-12-19T14:30:00+05:30',
      scheduledDateTime: '2025-12-19T14:30:00+05:30',
      doctor: {
        name: 'Dr. Sarah Smith',
        speciality: 'Ophthalmology'
      },
      clinic: {
        name: 'SANKARA EYE HOSPITAL, Bangalore',
        location: 'HSR Layout'
      },
      appointmentType: 'Follow-up Consultation',
      description: 'Test appointment for scheduled webhook testing'
    };

    const [result] = await connection.execute(
      'INSERT INTO notification_queue (entity_rid, transaction_type, message, created_at) VALUES (?, ?, ?, NOW())',
      [115, 'APPOINTMENT_SCHEDULED', JSON.stringify(testEvent)]
    );

    console.log('Test event inserted successfully!');
    console.log('Insert ID:', result.insertId);
    console.log('Event will be picked up by the delivery worker in the next cycle (within 5 seconds)');
  } catch (err) {
    console.error('Error inserting test event:', err.message);
  } finally {
    await connection.end();
  }
}

insertTestEvent();
