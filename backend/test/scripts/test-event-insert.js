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
      entity_rid: 33,
      transaction_type: 'PATIENT_REGISTERED',
      message: JSON.stringify({
        patientRID: 'PAT123456',
        patientName: 'John Doe Test',
        dateOfBirth: '1985-05-15',
        phoneNumber: '+1-555-0123',
        email: 'john.doe@test.com',
        registrationDate: new Date().toISOString()
      }),
      status: 'PENDING',
      created_at: new Date()
    };

    const [result] = await connection.execute(
      `INSERT INTO notification_queue (entity_rid, transaction_type, message, status, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [testEvent.entity_rid, testEvent.transaction_type, testEvent.message, testEvent.status, testEvent.created_at]
    );

    console.log('✅ Test event inserted successfully!');
    console.log('Event ID:', result.insertId);
    console.log('Entity RID:', testEvent.entity_rid);
    console.log('Event Type:', testEvent.transaction_type);
    console.log('Payload:', testEvent.message);
    console.log('\nWaiting for worker to pick up the event...');
    console.log('Check the backend logs and delivery logs API');

    // Wait a bit to see the worker process it
    await new Promise(resolve => setTimeout(resolve, 10000));

    // Check if it was processed
    const [events] = await connection.execute(
      'SELECT * FROM notification_queue WHERE id = ?',
      [result.insertId]
    );

    if (events.length > 0) {
      console.log('\nEvent status after 10 seconds:', events[0].status);
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await connection.end();
  }
}

insertTestEvent();
