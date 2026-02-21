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
        patientRID: 'PAT-ADV-98765',
        patientName: 'Sarah Advanced Test',
        dateOfBirth: '1990-08-25',
        phoneNumber: '+1-555-9999',
        email: 'sarah.advanced@example.com',
        registrationDate: new Date().toISOString(),
        medicalRecordNumber: 'MRN-2025-001',
        emergencyContact: '+1-555-8888'
      }),
      status: 'PENDING',
      created_at: new Date()
    };

    const [result] = await connection.execute(
      `INSERT INTO notification_queue (entity_rid, transaction_type, message, status, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [testEvent.entity_rid, testEvent.transaction_type, testEvent.message, testEvent.status, testEvent.created_at]
    );

    console.log('\n✅ Multi-webhook test event inserted successfully!');
    console.log('   Event ID:', result.insertId);
    console.log('   Entity RID:', testEvent.entity_rid);
    console.log('   Event Type:', testEvent.transaction_type);
    console.log('\n📋 This single event will trigger 3 webhooks:');
    console.log('   1. SCRIPT transformation (calculates age, age group, priority)');
    console.log('   2. SIMPLE transformation (field mappings + static metadata)');
    console.log('   3. Raw forwarding (original payload + timestamp)');
    console.log('\n⏳ Waiting for worker to process (5-10 seconds)...\n');

    // Wait for worker to pick it up
    await new Promise(resolve => setTimeout(resolve, 12000));

    console.log('✅ Worker should have processed the event by now');
    console.log('   Check delivery logs to see all 3 deliveries\n');

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await connection.end();
  }
}

insertTestEvent();
