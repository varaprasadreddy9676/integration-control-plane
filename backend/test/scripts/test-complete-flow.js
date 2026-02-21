const mysql = require('mysql2/promise');
const { MongoClient } = require('mongodb');
const config = require('./src/config');

(async () => {
  console.log('\n========================================');
  console.log('COMPLETE E2E WORKFLOW TEST - Entity 33');
  console.log('========================================\n');

  // Connect to MySQL and MongoDB
  const mysqlConn = await mysql.createConnection({
    host: config.db.host,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
    port: config.db.port
  });

  const mongoClient = new MongoClient(config.mongodb.uri);
  await mongoClient.connect();
  const db = mongoClient.db(config.mongodb.database);

  try {
    // Step 1: Get current checkpoint
    console.log('📍 STEP 1: Current Checkpoint');
    console.log('--------------------------------');
    const checkpointBefore = await db.collection('worker_checkpoint').findOne({ workerId: 'main_worker' });
    console.log(`Current checkpoint: ${checkpointBefore?.lastProcessedId || 0}`);

    // Step 2: Get current max ID in notification_queue
    console.log('\n📊 STEP 2: Notification Queue Status');
    console.log('--------------------------------');
    const [maxIdResult] = await mysqlConn.execute(
      'SELECT MAX(id) as maxId FROM notification_queue'
    );
    const currentMaxId = maxIdResult[0]?.maxId || 0;
    console.log(`Current max ID in notification_queue: ${currentMaxId}`);

    // Step 3: Insert test events
    console.log('\n📝 STEP 3: Inserting Test Events');
    console.log('--------------------------------');

    const testEvents = [
      {
        entityRid: 33,
        eventType: 'APPOINTMENT_CREATED',
        payload: {
          eventId: 90001,
          eventType: 'APPOINTMENT_CREATED',
          eventDateTime: new Date().toISOString(),
          entityRID: 33,
          appt: {
            apptRID: 8001,
            apptDate: '2025-12-25',
            apptTime: '10:00:00',
            apptStatusName: 'SCHEDULED',
            patientName: 'John Test',
            serviceName: 'General Checkup',
            serviceProviderName: 'Dr. Smith'
          },
          patient: {
            fullName: 'John Test',
            phone: '+91-1234567890',
            email: 'john.test@example.com',
            MRN: { printableNumber: 'MRN2025001' }
          },
          appointmentDateTime: '2025-12-25T10:00:00'
        }
      },
      {
        entityRid: 33,
        eventType: 'PATIENT_REGISTERED',
        payload: {
          eventId: 90002,
          eventType: 'PATIENT_REGISTERED',
          eventDateTime: new Date().toISOString(),
          entityRID: 33,
          patient: {
            patientRid: 5001,
            fullName: 'Jane Test',
            phone: '+91-9876543210',
            email: 'jane.test@example.com',
            MRN: { printableNumber: 'MRN2025002' },
            dateOfBirth: '1990-01-15',
            gender: 'Female'
          }
        }
      },
      {
        entityRid: 33,
        eventType: 'APPOINTMENT_CREATED',
        payload: {
          eventId: 90003,
          eventType: 'APPOINTMENT_CREATED',
          eventDateTime: new Date().toISOString(),
          entityRID: 33,
          appt: {
            apptRID: 8002,
            apptDate: '2025-12-26',
            apptTime: '14:00:00',
            apptStatusName: 'SCHEDULED',
            patientName: 'Bob Test',
            serviceName: 'Follow-up Consultation',
            serviceProviderName: 'Dr. Jones'
          },
          patient: {
            fullName: 'Bob Test',
            phone: '+91-5555555555',
            email: 'bob.test@example.com',
            MRN: { printableNumber: 'MRN2025003' }
          },
          appointmentDateTime: '2025-12-26T14:00:00'
        }
      }
    ];

    const insertedIds = [];
    for (const event of testEvents) {
      const [result] = await mysqlConn.execute(
        'INSERT INTO notification_queue (entity_rid, transaction_type, message, created_at) VALUES (?, ?, ?, NOW())',
        [event.entityRid, event.eventType, JSON.stringify(event.payload)]
      );
      insertedIds.push(result.insertId);
      console.log(`✓ Inserted ${event.eventType} (ID: ${result.insertId}, Event: ${event.payload.eventId})`);
    }

    // Step 4: Wait for worker to process
    console.log('\n⏳ STEP 4: Waiting for Worker Processing');
    console.log('--------------------------------');
    console.log('Waiting 15 seconds for worker to poll and process...');
    await new Promise(resolve => setTimeout(resolve, 15000));

    // Step 5: Check checkpoint advancement
    console.log('\n📍 STEP 5: Checkpoint Advancement');
    console.log('--------------------------------');
    const checkpointAfter = await db.collection('worker_checkpoint').findOne({ workerId: 'main_worker' });
    console.log(`Checkpoint BEFORE: ${checkpointBefore?.lastProcessedId || 0}`);
    console.log(`Checkpoint AFTER:  ${checkpointAfter?.lastProcessedId || 0}`);

    if (checkpointAfter && checkpointAfter.lastProcessedId > (checkpointBefore?.lastProcessedId || 0)) {
      console.log(`✅ Checkpoint advanced by ${checkpointAfter.lastProcessedId - (checkpointBefore?.lastProcessedId || 0)}`);
    } else {
      console.log('⚠️  Checkpoint did not advance - worker may not be running');
    }

    // Step 6: Check delivery logs
    console.log('\n📦 STEP 6: Delivery Logs Created');
    console.log('--------------------------------');
    const deliveryLogs = await db.collection('delivery_logs')
      .find({
        entityRid: 33,
        eventId: { $in: [90001, 90002, 90003] }
      })
      .sort({ createdAt: -1 })
      .toArray();

    console.log(`Total delivery logs created: ${deliveryLogs.length}\n`);

    // Group by event to check multi-action
    const eventGroups = {};
    deliveryLogs.forEach(log => {
      const key = log.eventId;
      if (!eventGroups[key]) {
        eventGroups[key] = [];
      }
      eventGroups[key].push(log);
    });

    if (deliveryLogs.length > 0) {

      console.log('Delivery breakdown by event:\n');
      Object.entries(eventGroups).forEach(([eventId, logs]) => {
        console.log(`Event ${eventId} (${logs[0].eventType}):`);
        console.log(`  ✓ Triggered ${logs.length} webhook(s)`);
        logs.forEach(log => {
          console.log(`    - ${log.webhookName}`);
          console.log(`      Status: ${log.status}, HTTP: ${log.httpStatus || 'N/A'}`);
          console.log(`      Target: ${log.targetUrl}`);
          console.log(`      Transformation: ${log.transformationMode || 'NONE'}`);
          if (log.transformedPayload) {
            console.log(`      ✓ Transformation applied`);
          }
          if (log.requestHeaders && Object.keys(log.requestHeaders).length > 0) {
            const authHeaders = Object.keys(log.requestHeaders).filter(h =>
              h.toLowerCase().includes('auth') || h.toLowerCase().includes('key')
            );
            if (authHeaders.length > 0) {
              console.log(`      ✓ Auth headers: ${authHeaders.join(', ')}`);
            }
          }
        });
        console.log('');
      });

      // Check for multi-action webhooks
      const multiAction = Object.entries(eventGroups).filter(([_, logs]) => logs.length > 1);
      if (multiAction.length > 0) {
        console.log(`✅ Multi-action webhooks detected: ${multiAction.length} event(s) triggered multiple webhooks`);
      }

      // Check transformation
      const withTransform = deliveryLogs.filter(l => l.transformedPayload);
      if (withTransform.length > 0) {
        console.log(`✅ Transformations applied: ${withTransform.length} log(s)`);
      }

      // Check authentication
      const withAuth = deliveryLogs.filter(l => l.requestHeaders && Object.keys(l.requestHeaders).length > 0);
      if (withAuth.length > 0) {
        console.log(`✅ Authentication headers present: ${withAuth.length} log(s)`);
      }
    } else {
      console.log('⚠️  No delivery logs found - worker may not be running or webhooks not matching');
    }

    // Step 7: Check processed_events (duplicate prevention)
    console.log('\n✅ STEP 7: Duplicate Prevention');
    console.log('--------------------------------');
    const processedEvents = await db.collection('processed_events')
      .find({ eventId: { $in: [90001, 90002, 90003] } })
      .toArray();

    console.log(`Processed events tracked: ${processedEvents.length}\n`);
    if (processedEvents.length > 0) {
      processedEvents.forEach(pe => {
        const minutesToExpire = Math.floor((new Date(pe.expiresAt) - new Date()) / 60000);
        console.log(`✓ Event ${pe.eventId} (${pe.eventType})`);
        console.log(`  Entity: ${pe.entityRid}`);
        console.log(`  Expires in: ${minutesToExpire} minutes`);
      });
      console.log('\n✅ Duplicate prevention active');
    } else {
      console.log('⚠️  No processed_events tracked yet');
    }

    // Step 8: Check retry mechanism
    console.log('\n🔄 STEP 8: Retry Mechanism');
    console.log('--------------------------------');
    const failedLogs = deliveryLogs.filter(l => l.status === 'FAILED' || l.status === 'RETRYING');
    if (failedLogs.length > 0) {
      console.log(`Found ${failedLogs.length} failed/retrying delivery log(s):\n`);
      failedLogs.forEach(log => {
        console.log(`${log.webhookName}:`);
        console.log(`  Status: ${log.status}`);
        console.log(`  Retry Count: ${log.retryCount || 0}/${log.maxRetries || 3}`);
        console.log(`  Error: ${log.errorMessage || 'N/A'}`);
        console.log('');
      });
    } else {
      console.log('No failed deliveries to test retry mechanism');
      console.log('(This is expected if all webhooks succeeded)');
    }

    // Step 9: Verify scheduled webhooks created
    console.log('\n⏰ STEP 9: Scheduled Webhooks Created');
    console.log('--------------------------------');
    const scheduledWebhooks = await db.collection('scheduled_webhooks')
      .find({
        entityRid: 33,
        originalEventId: { $in: ['90001', '90002', '90003'] }
      })
      .toArray();

    console.log(`Scheduled webhooks created: ${scheduledWebhooks.length}\n`);
    if (scheduledWebhooks.length > 0) {
      scheduledWebhooks.forEach(sw => {
        const hoursUntil = Math.floor((new Date(sw.scheduledFor) - new Date()) / (60 * 60 * 1000));
        console.log(`✓ ${sw.webhookName}`);
        console.log(`  Event: ${sw.eventType} (Original: ${sw.originalEventId})`);
        console.log(`  Scheduled for: ${sw.scheduledFor} (in ${hoursUntil}h)`);
        console.log(`  Status: ${sw.status}`);
        if (sw.recurringConfig) {
          console.log(`  Recurring: ${sw.recurringConfig.occurrenceNumber}/${sw.recurringConfig.maxOccurrences}`);
        }
        console.log('');
      });
    } else {
      console.log('No scheduled webhooks created (normal for IMMEDIATE delivery mode)');
    }

    // Summary
    console.log('\n========================================');
    console.log('WORKFLOW TEST SUMMARY');
    console.log('========================================\n');

    const checks = [
      { name: 'Events inserted into notification_queue', pass: insertedIds.length === 3 },
      { name: 'Worker checkpoint advanced', pass: checkpointAfter && checkpointAfter.lastProcessedId > (checkpointBefore?.lastProcessedId || 0) },
      { name: 'Delivery logs created', pass: deliveryLogs.length > 0 },
      { name: 'Transformations applied', pass: deliveryLogs.some(l => l.transformedPayload) },
      { name: 'Authentication headers present', pass: deliveryLogs.some(l => l.requestHeaders && Object.keys(l.requestHeaders).length > 0) },
      { name: 'Duplicate prevention active', pass: processedEvents.length > 0 },
      { name: 'Multi-action webhooks working', pass: Object.values(eventGroups).some(logs => logs.length > 1) }
    ];

    checks.forEach(check => {
      const icon = check.pass ? '✅' : '❌';
      console.log(`${icon} ${check.name}`);
    });

    const allPassed = checks.every(c => c.pass);
    console.log('\n' + (allPassed ? '🎉 ALL CHECKS PASSED!' : '⚠️  Some checks failed - see details above'));

  } finally {
    await mysqlConn.end();
    await mongoClient.close();
  }

  console.log('\n========================================\n');
})().catch(console.error);
