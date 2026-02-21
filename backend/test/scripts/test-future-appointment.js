const mysql = require('mysql2/promise');

async function testFutureAppointment() {
  const connection = await mysql.createConnection({
    host: process.env.TEST_MYSQL_HOST || 'localhost',
    port: Number(process.env.TEST_MYSQL_PORT || 3306),
    user: process.env.TEST_MYSQL_USER || 'root',
    password: process.env.TEST_MYSQL_PASSWORD || '',
    database: process.env.TEST_MYSQL_DATABASE || 'integration_gateway'
  });

  try {
    // Create event with appointment 30 DAYS from now (so 24h before is still in future)
    const appointmentTime = new Date(Date.now() + (30 * 24 * 60 * 60 * 1000));
    const expectedScheduledTime = new Date(appointmentTime.getTime() - (24 * 60 * 60 * 1000));

    const testEvent = {
      type: 'APPOINTMENT_SCHEDULED',
      patientRid: '88888',
      patient: {
        fullName: 'Future Appointment Patient',
        mrn: 'FUTURE-001',
        phone: '8888888888'
      },
      appointmentDateTime: appointmentTime.toISOString(),
      scheduledDateTime: appointmentTime.toISOString(),
      doctor: {
        name: 'Dr. Future Test',
        speciality: 'Testing'
      },
      clinic: {
        name: 'Future Test Clinic',
        location: 'Test Location'
      },
      appointmentType: 'Future Test',
      description: 'Testing with appointment 30 days in future'
    };

    const [result] = await connection.execute(
      'INSERT INTO notification_queue (entity_rid, transaction_type, message, created_at) VALUES (?, ?, ?, NOW())',
      [115, 'APPOINTMENT_SCHEDULED', JSON.stringify(testEvent)]
    );

    console.log('✓ Test event inserted successfully!');
    console.log('  Event ID:', result.insertId);
    console.log('  Appointment Time:', appointmentTime.toISOString());
    console.log('  Expected Scheduled Time (24h before):', expectedScheduledTime.toISOString());
    console.log('  Expected Scheduled Time is', Math.floor((expectedScheduledTime - Date.now()) / 1000), 'seconds in the future');
    console.log('\nThe scheduled webhook should be created successfully now!');
    console.log('Scheduler will deliver it in ~29 days.');

  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await connection.end();
  }
}

testFutureAppointment();
