const mysql = require('mysql2/promise');

async function testSchedulingScript() {
  const connection = await mysql.createConnection({
    host: process.env.TEST_MYSQL_HOST || 'localhost',
    port: Number(process.env.TEST_MYSQL_PORT || 3306),
    user: process.env.TEST_MYSQL_USER || 'root',
    password: process.env.TEST_MYSQL_PASSWORD || '',
    database: process.env.TEST_MYSQL_DATABASE || 'integration_gateway'
  });

  try {
    // Create event with appointment 5 minutes from now
    const appointmentTime = new Date(Date.now() + (5 * 60 * 1000)); // 5 minutes from now

    const testEvent = {
      type: 'APPOINTMENT_SCHEDULED',
      patientRid: '99999',
      patient: {
        fullName: 'Test Script Patient',
        mrn: 'SCRIPT-TEST-001',
        phone: '9999999999'
      },
      appointmentDateTime: appointmentTime.toISOString(),
      scheduledDateTime: appointmentTime.toISOString(),
      doctor: {
        name: 'Dr. Script Test',
        speciality: 'Testing'
      },
      clinic: {
        name: 'Test Clinic',
        location: 'Test Location'
      },
      appointmentType: 'Script Test',
      description: 'Testing scheduling script execution'
    };

    const [result] = await connection.execute(
      'INSERT INTO notification_queue (entity_rid, transaction_type, message, created_at) VALUES (?, ?, ?, NOW())',
      [115, 'APPOINTMENT_SCHEDULED', JSON.stringify(testEvent)]
    );

    console.log('✓ Test event inserted successfully!');
    console.log('  Event ID:', result.insertId);
    console.log('  Appointment Time:', appointmentTime.toISOString());
    console.log('  Expected Scheduled Time (24h before):', new Date(appointmentTime.getTime() - (24 * 60 * 60 * 1000)).toISOString());
    console.log('\nOur webhook is configured to send reminder 24 hours BEFORE appointment.');
    console.log('So it should create a scheduled webhook for the past (will be picked up immediately by scheduler).');
    console.log('\nWait 10 seconds and check logs for:');
    console.log('  1. Worker processing the event');
    console.log('  2. Executing scheduling script');
    console.log('  3. Creating scheduled webhook');
    console.log('  4. Scheduler delivering it');

  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await connection.end();
  }
}

testSchedulingScript();
