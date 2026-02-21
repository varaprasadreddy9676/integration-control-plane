/**
 * Insert Sample Events into notification_queue
 *
 * This script inserts various test events into the notification_queue table
 * to test the delivery worker functionality with real data.
 *
 * Usage:
 *   node insert-test-events-notification-queue.js
 */

const mysql = require('mysql2/promise');
const config = require('./src/config');

const TEST_EVENTS = [
  {
    entity_rid: 1,
    transaction_type: 'PATIENT_REGISTERED',
    message: {
      patientRid: 100001,
      patientId: 'P001',
      patientName: 'John Doe',
      dateOfBirth: '1985-03-15',
      gender: 'M',
      phone: '555-0101',
      email: 'john.doe@example.com',
      registrationDate: new Date().toISOString(),
      address: {
        street: '123 Main St',
        city: 'Springfield',
        state: 'IL',
        zip: '62701'
      }
    }
  },
  {
    entity_rid: 1,
    transaction_type: 'APPOINTMENT_CREATED',
    message: {
      appointmentRid: 200001,
      appointmentId: 'APT001',
      patientRid: 100001,
      patientName: 'John Doe',
      doctorRid: 5001,
      doctorName: 'Dr. Smith',
      appointmentDateTime: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // Tomorrow
      duration: 30,
      appointmentType: 'Check-up',
      status: 'SCHEDULED',
      notes: 'Annual physical examination',
      createdAt: new Date().toISOString()
    }
  },
  {
    entity_rid: 1,
    transaction_type: 'BILL_CREATED',
    message: {
      billRid: 300001,
      billId: 'BILL001',
      patientRid: 100001,
      patientName: 'John Doe',
      amount: 250.00,
      currency: 'USD',
      billDate: new Date().toISOString(),
      dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days from now
      status: 'PENDING',
      items: [
        { description: 'Consultation Fee', amount: 150.00 },
        { description: 'Lab Tests', amount: 100.00 }
      ],
      insuranceClaim: {
        claimNumber: 'CLM001',
        insuranceProvider: 'BlueCross',
        coveredAmount: 200.00,
        patientResponsibility: 50.00
      }
    }
  },
  {
    entity_rid: 1,
    transaction_type: 'LAB_RESULT_AVAILABLE',
    message: {
      labResultRid: 400001,
      labResultId: 'LAB001',
      patientRid: 100001,
      patientName: 'John Doe',
      testName: 'Complete Blood Count',
      testDate: new Date().toISOString(),
      resultDate: new Date().toISOString(),
      status: 'COMPLETED',
      results: [
        { parameter: 'WBC', value: '7.5', unit: 'K/µL', normalRange: '4.0-11.0', flag: 'NORMAL' },
        { parameter: 'RBC', value: '4.8', unit: 'M/µL', normalRange: '4.5-5.5', flag: 'NORMAL' },
        { parameter: 'Hemoglobin', value: '14.2', unit: 'g/dL', normalRange: '13.5-17.5', flag: 'NORMAL' }
      ],
      orderingPhysician: 'Dr. Smith',
      critical: false
    }
  },
  {
    entity_rid: 1,
    transaction_type: 'PRESCRIPTION_CREATED',
    message: {
      prescriptionRid: 500001,
      prescriptionId: 'RX001',
      patientRid: 100001,
      patientName: 'John Doe',
      doctorRid: 5001,
      doctorName: 'Dr. Smith',
      medications: [
        {
          name: 'Lisinopril',
          dosage: '10mg',
          frequency: 'Once daily',
          duration: '30 days',
          quantity: 30,
          refills: 3
        }
      ],
      prescriptionDate: new Date().toISOString(),
      status: 'ACTIVE',
      pharmacy: {
        name: 'Main Street Pharmacy',
        phone: '555-0200',
        fax: '555-0201'
      }
    }
  },
  {
    entity_rid: 1,
    transaction_type: 'APPOINTMENT_RESCHEDULED',
    message: {
      appointmentRid: 200002,
      appointmentId: 'APT002',
      patientRid: 100002,
      patientName: 'Jane Smith',
      previousDateTime: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
      newDateTime: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
      doctorName: 'Dr. Johnson',
      reason: 'Patient request',
      rescheduledAt: new Date().toISOString()
    }
  },
  {
    entity_rid: 1,
    transaction_type: 'APPOINTMENT_CANCELLED',
    message: {
      appointmentRid: 200003,
      appointmentId: 'APT003',
      patientRid: 100003,
      patientName: 'Bob Wilson',
      scheduledDateTime: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
      doctorName: 'Dr. Brown',
      cancellationReason: 'Emergency',
      cancelledBy: 'Patient',
      cancelledAt: new Date().toISOString()
    }
  },
  {
    entity_rid: 1,
    transaction_type: 'PATIENT_VISIT_COMPLETED',
    message: {
      visitRid: 600001,
      visitId: 'VISIT001',
      patientRid: 100001,
      patientName: 'John Doe',
      doctorRid: 5001,
      doctorName: 'Dr. Smith',
      visitDate: new Date().toISOString(),
      visitType: 'Office Visit',
      chiefComplaint: 'Annual physical',
      diagnosis: [
        { code: 'Z00.00', description: 'Encounter for general adult medical examination without abnormal findings' }
      ],
      procedures: [
        { code: '99213', description: 'Office visit, established patient, low complexity' }
      ],
      vitals: {
        bloodPressure: '120/80',
        pulse: 72,
        temperature: 98.6,
        weight: 175,
        height: 70
      }
    }
  }
];

async function insertTestEvents() {
  let connection;

  try {
    console.log('\n🔌 Connecting to MySQL...');
    console.log(`   Host: ${config.db.host}:${config.db.port}`);
    console.log(`   Database: ${config.db.database}`);

    connection = await mysql.createConnection({
      host: config.db.host,
      port: config.db.port,
      user: config.db.user,
      password: config.db.password,
      database: config.db.database
    });

    console.log('✅ Connected to MySQL\n');

    console.log('📝 Inserting test events into notification_queue...\n');

    let insertedCount = 0;
    const insertedIds = [];

    for (const event of TEST_EVENTS) {
      const messageJson = JSON.stringify(event.message);

      const [result] = await connection.query(
        `INSERT INTO notification_queue (entity_rid, transaction_type, message, created_at)
         VALUES (?, ?, ?, NOW())`,
        [event.entity_rid, event.transaction_type, messageJson]
      );

      insertedIds.push(result.insertId);
      insertedCount++;

      console.log(`  ✓ [${insertedCount}/${TEST_EVENTS.length}] ${event.transaction_type} (ID: ${result.insertId})`);
    }

    console.log(`\n✅ Successfully inserted ${insertedCount} test events\n`);
    console.log('📊 Event IDs:', insertedIds.join(', '));
    console.log('\n📌 Event Types Inserted:');
    TEST_EVENTS.forEach((evt, idx) => {
      console.log(`   ${idx + 1}. ${evt.transaction_type}`);
    });

    console.log('\n💡 TIP: The delivery worker will process these events automatically');
    console.log('   Watch the backend logs to see the worker in action!\n');

    // Show current checkpoint
    const { MongoClient } = require('mongodb');
    const mongoClient = new MongoClient(config.mongodb.uri, config.mongodb.options);
    await mongoClient.connect();
    const db = mongoClient.db(config.mongodb.database);

    const checkpoint = await db.collection('worker_checkpoint').findOne({
      workerId: 'main_worker'
    });

    if (checkpoint) {
      console.log(`📍 Current worker checkpoint: ${checkpoint.lastProcessedId}`);
      console.log(`   Worker will process events with ID > ${checkpoint.lastProcessedId}\n`);
    } else {
      console.log('📍 No checkpoint found - worker will start from ID 0\n');
    }

    await mongoClient.close();

  } catch (error) {
    console.error('\n❌ Error inserting test events:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
      console.log('👋 MySQL connection closed\n');
    }
  }
}

// Run if called directly
if (require.main === module) {
  insertTestEvents()
    .then(() => {
      console.log('✨ Done!\n');
      process.exit(0);
    })
    .catch(err => {
      console.error('Fatal error:', err);
      process.exit(1);
    });
}

module.exports = { insertTestEvents, TEST_EVENTS };
