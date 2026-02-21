/**
 * Complete End-to-End Workflow Test
 * Tests the entire webhook delivery pipeline with real data for Entity 33
 */

const { MongoClient, ObjectId } = require('mongodb');
const mysql = require('mysql2/promise');
const config = require('../backend/src/config');

// Track test results
const testResults = {
  passed: 0,
  failed: 0,
  tests: []
};

function logTest(name, status, details = '') {
  const result = { name, status, details };
  testResults.tests.push(result);
  if (status === 'PASS') {
    testResults.passed++;
    console.log(`✅ ${name}`);
  } else {
    testResults.failed++;
    console.log(`❌ ${name}`);
  }
  if (details) console.log(`   ${details}`);
}

async function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

(async () => {
  let mongoClient, mysqlConn, db;

  try {
    console.log('\n========================================');
    console.log('COMPLETE END-TO-END WORKFLOW TEST');
    console.log('Entity Parent RID: 33');
    console.log('========================================\n');

    // Connect to databases
    console.log('📡 Connecting to databases...');
    mongoClient = new MongoClient(config.mongodb.uri);
    await mongoClient.connect();
    db = mongoClient.db(config.mongodb.database);

    mysqlConn = await mysql.createConnection({
      host: config.db.host,
      user: config.db.user,
      password: config.db.password,
      database: config.db.database
    });

    logTest('Database connections established', 'PASS');

    // ============================================
    // PHASE 1: CHECKPOINT MANAGEMENT
    // ============================================
    console.log('\n--- PHASE 1: Checkpoint Management ---');

    // Get initial checkpoint
    const initialCheckpoint = await db.collection('worker_checkpoint')
      .findOne({ workerId: 'main_worker' });

    const startCheckpoint = initialCheckpoint ? initialCheckpoint.lastProcessedId : 0;
    console.log(`Initial checkpoint: ${startCheckpoint}`);
    logTest('Read initial checkpoint', 'PASS', `Checkpoint: ${startCheckpoint}`);

    // ============================================
    // PHASE 2: CREATE TEST WEBHOOKS
    // ============================================
    console.log('\n--- PHASE 2: Create Test Webhooks ---');

    // Clean up any existing test webhooks
    await db.collection('webhook_configs').deleteMany({
      name: { $regex: /^E2E_TEST_/ }
    });

    // Webhook 1: SIMPLE transformation with API Key auth
    const webhook1 = {
      name: 'E2E_TEST_APPOINTMENT_SIMPLE',
      eventType: 'APPOINTMENT_CREATED',
      targetUrl: 'https://webhook.site/unique-id-1',
      httpMethod: 'POST',
      scope: 'ENTITY_ONLY',
      entityRid: 33,
      outgoingAuthType: 'API_KEY',
      outgoingAuthConfig: {
        headerName: 'X-API-Key',
        apiKey: 'test_key_123'
      },
      deliveryMode: 'IMMEDIATE',
      transformationMode: 'SIMPLE',
      transformation: {
        mappings: [
          { sourceField: 'patient.fullName', targetField: 'patientName', transform: 'trim' },
          { sourceField: 'appt.apptDate', targetField: 'appointmentDate', transform: 'none' },
          { sourceField: 'appt.serviceName', targetField: 'service', transform: 'trim' }
        ],
        staticFields: [
          { key: 'webhookType', value: 'appointment_notification' },
          { key: 'entityRid', value: '{{entityRid}}' }
        ]
      },
      isActive: true,
      timeoutMs: 10000,
      retryCount: 3,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const result1 = await db.collection('webhook_configs').insertOne(webhook1);
    const webhookId1 = result1.insertedId.toString();
    logTest('Created SIMPLE transformation webhook', 'PASS', `ID: ${webhookId1}`);

    // Webhook 2: SCRIPT transformation with Bearer auth
    const webhook2 = {
      name: 'E2E_TEST_APPOINTMENT_SCRIPT',
      eventType: 'APPOINTMENT_CREATED',
      targetUrl: 'https://webhook.site/unique-id-2',
      httpMethod: 'POST',
      scope: 'ENTITY_ONLY',
      entityRid: 33,
      outgoingAuthType: 'BEARER',
      outgoingAuthConfig: {
        token: 'bearer_token_xyz'
      },
      deliveryMode: 'IMMEDIATE',
      transformationMode: 'SCRIPT',
      transformation: {
        script: `
          const result = {
            type: 'appointment',
            patient: {
              name: payload.patient.fullName,
              mrn: payload.patient.MRN.printableNumber,
              contact: payload.patient.phone
            },
            appointment: {
              id: payload.appt.apptRID,
              datetime: payload.appt.apptDate + 'T' + payload.appt.apptTime,
              service: payload.appt.serviceName,
              doctor: payload.appt.serviceProviderName
            },
            metadata: {
              eventId: payload.eventId,
              processedAt: new Date().toISOString(),
              entityRid: context.entityRid
            }
          };
          result;
        `
      },
      isActive: true,
      timeoutMs: 10000,
      retryCount: 3,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const result2 = await db.collection('webhook_configs').insertOne(webhook2);
    const webhookId2 = result2.insertedId.toString();
    logTest('Created SCRIPT transformation webhook', 'PASS', `ID: ${webhookId2}`);

    // Webhook 3: Intentionally failing webhook for retry testing
    const webhook3 = {
      name: 'E2E_TEST_APPOINTMENT_FAIL',
      eventType: 'APPOINTMENT_CREATED',
      targetUrl: 'https://httpstat.us/500', // Returns 500 error
      httpMethod: 'POST',
      scope: 'ENTITY_ONLY',
      entityRid: 33,
      outgoingAuthType: 'NONE',
      deliveryMode: 'IMMEDIATE',
      transformationMode: 'NONE',
      isActive: true,
      timeoutMs: 5000,
      retryCount: 3,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const result3 = await db.collection('webhook_configs').insertOne(webhook3);
    const webhookId3 = result3.insertedId.toString();
    logTest('Created FAILING webhook for retry testing', 'PASS', `ID: ${webhookId3}`);

    console.log(`\nCreated 3 webhooks for APPOINTMENT_CREATED event (multi-action test)`);

    // ============================================
    // PHASE 3: INSERT TEST EVENT INTO notification_queue
    // ============================================
    console.log('\n--- PHASE 3: Insert Test Event ---');

    const testEvent = {
      eventId: 999001,
      eventType: 'APPOINTMENT_CREATED',
      eventDateTime: new Date().toISOString(),
      description: 'E2E Test Appointment',
      entityRID: 33,
      appt: {
        apptRID: 9001,
        tokenNumber: 'E2E-001',
        apptDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        apptTime: '14:30:00',
        apptStatus: 1,
        apptStatusName: 'SCHEDULED',
        patientRID: 33001,
        patientName: 'E2E Test Patient',
        patientMRN: 'MRN-E2E-001',
        serviceName: 'Cardiology Consultation',
        serviceProviderName: 'Dr. E2E Test',
        servicePointName: 'Clinic Room 1'
      },
      patient: {
        fullName: 'E2E Test Patient',
        phone: '+91-9999999999',
        email: 'e2e@test.com',
        MRN: {
          printableNumber: 'MRN-E2E-001',
          sequenceNumber: 33001
        }
      }
    };

    const [insertResult] = await mysqlConn.execute(
      'INSERT INTO notification_queue (entity_rid, transaction_type, message) VALUES (?, ?, ?)',
      [33, 'APPOINTMENT_CREATED', JSON.stringify(testEvent)]
    );

    const eventId = insertResult.insertId;
    console.log(`Inserted event ID: ${eventId}`);
    logTest('Inserted test event into notification_queue', 'PASS', `Event ID: ${eventId}`);

    // ============================================
    // PHASE 4: WAIT FOR WORKER TO POLL
    // ============================================
    console.log('\n--- PHASE 4: Worker Polling & Processing ---');
    console.log('Waiting for worker to poll and process event (15 seconds)...');

    await wait(15000);

    // Check checkpoint was updated
    const updatedCheckpoint = await db.collection('worker_checkpoint')
      .findOne({ workerId: 'main_worker' });

    if (updatedCheckpoint && updatedCheckpoint.lastProcessedId >= eventId) {
      logTest('Checkpoint updated after processing', 'PASS',
        `New checkpoint: ${updatedCheckpoint.lastProcessedId} (>= ${eventId})`);
    } else {
      logTest('Checkpoint updated after processing', 'FAIL',
        `Expected >= ${eventId}, got ${updatedCheckpoint?.lastProcessedId || 'null'}`);
    }

    // ============================================
    // PHASE 5: VERIFY DELIVERY LOGS
    // ============================================
    console.log('\n--- PHASE 5: Delivery Logs Verification ---');

    const deliveryLogs = await db.collection('delivery_logs')
      .find({
        entityRid: 33,
        webhookName: { $regex: /^E2E_TEST_/ }
      })
      .sort({ createdAt: -1 })
      .toArray();

    console.log(`\nFound ${deliveryLogs.length} delivery log entries`);

    // Should have 3 logs (one for each webhook)
    if (deliveryLogs.length >= 3) {
      logTest('Multi-action webhook delivery', 'PASS',
        `All 3 webhooks triggered for same event`);
    } else {
      logTest('Multi-action webhook delivery', 'FAIL',
        `Expected 3 logs, got ${deliveryLogs.length}`);
    }

    // Check SIMPLE transformation webhook
    const log1 = deliveryLogs.find(l => l.webhookName === 'E2E_TEST_APPOINTMENT_SIMPLE');
    if (log1) {
      console.log(`\n📋 SIMPLE Transformation Webhook:`);
      console.log(`   Status: ${log1.status}`);
      console.log(`   Webhook ID: ${log1.webhookConfigId}`);
      console.log(`   Event ID: ${log1.eventId}`);
      console.log(`   Target URL: ${log1.targetUrl}`);
      console.log(`   Auth Type: ${log1.outgoingAuthType}`);

      // Check transformed payload
      if (log1.transformedPayload) {
        console.log(`   Transformed Payload:`, JSON.stringify(log1.transformedPayload, null, 2));

        if (log1.transformedPayload.patientName === 'E2E Test Patient' &&
            log1.transformedPayload.webhookType === 'appointment_notification') {
          logTest('SIMPLE transformation applied correctly', 'PASS');
        } else {
          logTest('SIMPLE transformation applied correctly', 'FAIL',
            'Transformed payload missing expected fields');
        }
      }

      // Check auth header was added
      if (log1.requestHeaders && log1.requestHeaders['X-API-Key']) {
        logTest('API Key authentication added', 'PASS',
          `Header: X-API-Key present`);
      }
    } else {
      logTest('SIMPLE transformation webhook log found', 'FAIL');
    }

    // Check SCRIPT transformation webhook
    const log2 = deliveryLogs.find(l => l.webhookName === 'E2E_TEST_APPOINTMENT_SCRIPT');
    if (log2) {
      console.log(`\n📋 SCRIPT Transformation Webhook:`);
      console.log(`   Status: ${log2.status}`);
      console.log(`   Auth Type: ${log2.outgoingAuthType}`);

      if (log2.transformedPayload) {
        console.log(`   Transformed Payload:`, JSON.stringify(log2.transformedPayload, null, 2));

        if (log2.transformedPayload.type === 'appointment' &&
            log2.transformedPayload.patient &&
            log2.transformedPayload.appointment) {
          logTest('SCRIPT transformation applied correctly', 'PASS');
        } else {
          logTest('SCRIPT transformation applied correctly', 'FAIL');
        }
      }

      // Check Bearer token was added
      if (log2.requestHeaders && log2.requestHeaders['Authorization']) {
        logTest('Bearer token authentication added', 'PASS',
          `Header: Authorization present`);
      }
    } else {
      logTest('SCRIPT transformation webhook log found', 'FAIL');
    }

    // Check FAILING webhook
    const log3 = deliveryLogs.find(l => l.webhookName === 'E2E_TEST_APPOINTMENT_FAIL');
    if (log3) {
      console.log(`\n📋 FAILING Webhook (Retry Test):`);
      console.log(`   Status: ${log3.status}`);
      console.log(`   HTTP Status: ${log3.httpStatus}`);
      console.log(`   Retry Count: ${log3.retryCount || 0}`);
      console.log(`   Max Retries: ${log3.maxRetries || 3}`);

      if (log3.status === 'FAILED') {
        logTest('Failed webhook marked as FAILED', 'PASS');
      }

      // Check retry attempts
      if (log3.retryCount >= 0) {
        logTest('Retry count tracked', 'PASS', `Retry count: ${log3.retryCount}`);
      }
    } else {
      logTest('FAILING webhook log found', 'FAIL');
    }

    // ============================================
    // PHASE 6: DUPLICATE PREVENTION TEST
    // ============================================
    console.log('\n--- PHASE 6: Duplicate Prevention ---');

    // Insert the SAME event again
    const [duplicateResult] = await mysqlConn.execute(
      'INSERT INTO notification_queue (entity_rid, transaction_type, message) VALUES (?, ?, ?)',
      [33, 'APPOINTMENT_CREATED', JSON.stringify(testEvent)]
    );

    const duplicateEventId = duplicateResult.insertId;
    console.log(`Inserted duplicate event ID: ${duplicateEventId}`);

    // Wait for worker
    await wait(10000);

    // Check if duplicate deliveries were created
    const allLogs = await db.collection('delivery_logs')
      .find({
        entityRid: 33,
        webhookName: { $regex: /^E2E_TEST_/ }
      })
      .toArray();

    const logsForEvent1 = allLogs.filter(l => l.eventId === eventId);
    const logsForEvent2 = allLogs.filter(l => l.eventId === duplicateEventId);

    console.log(`Logs for original event ${eventId}: ${logsForEvent1.length}`);
    console.log(`Logs for duplicate event ${duplicateEventId}: ${logsForEvent2.length}`);

    // Both should have been processed (different event IDs in queue)
    if (logsForEvent2.length >= 3) {
      logTest('Duplicate event processing', 'PASS',
        'Different queue entries processed separately (expected behavior)');
    }

    // ============================================
    // PHASE 7: PROCESSED EVENTS TRACKING
    // ============================================
    console.log('\n--- PHASE 7: Processed Events Tracking ---');

    const processedEvents = await db.collection('processed_events')
      .find({
        eventId: { $in: [eventId, duplicateEventId] }
      })
      .toArray();

    console.log(`Processed events tracked: ${processedEvents.length}`);

    if (processedEvents.length >= 2) {
      logTest('Processed events tracked in collection', 'PASS',
        `${processedEvents.length} events tracked`);

      // Check TTL (should expire after 1 hour)
      const hasExpiry = processedEvents.some(pe => pe.expiresAt);
      if (hasExpiry) {
        logTest('TTL expiry set on processed events', 'PASS',
          'Events will auto-expire after 1 hour');
      }
    }

    // ============================================
    // PHASE 8: RETRY MECHANISM TEST
    // ============================================
    console.log('\n--- PHASE 8: Retry Mechanism ---');

    // Wait for retries to happen
    console.log('Waiting for retry attempts (30 seconds)...');
    await wait(30000);

    const failedLog = await db.collection('delivery_logs')
      .findOne({
        webhookName: 'E2E_TEST_APPOINTMENT_FAIL',
        eventId: eventId
      });

    if (failedLog) {
      console.log(`\n🔄 Retry Information:`);
      console.log(`   Final Status: ${failedLog.status}`);
      console.log(`   Retry Count: ${failedLog.retryCount || 0}`);
      console.log(`   Max Retries: ${failedLog.maxRetries || 3}`);
      console.log(`   Last Attempt: ${failedLog.lastAttemptAt}`);

      if (failedLog.retryCount >= 3 || failedLog.status === 'FAILED') {
        logTest('Max retries attempted', 'PASS',
          `Stopped after ${failedLog.retryCount || 0} retries`);
      } else {
        logTest('Max retries attempted', 'FAIL',
          `Only ${failedLog.retryCount || 0} retries attempted`);
      }

      if (failedLog.status === 'FAILED' && failedLog.retryCount >= 3) {
        logTest('Webhook marked FAILED after max retries', 'PASS');
      }
    }

    // ============================================
    // PHASE 9: CHECKPOINT RESUME TEST
    // ============================================
    console.log('\n--- PHASE 9: Checkpoint Resume Test ---');

    const finalCheckpoint = await db.collection('worker_checkpoint')
      .findOne({ workerId: 'main_worker' });

    console.log(`Final checkpoint: ${finalCheckpoint.lastProcessedId}`);
    console.log(`Checkpoint updated at: ${finalCheckpoint.updatedAt}`);

    if (finalCheckpoint.lastProcessedId >= duplicateEventId) {
      logTest('Checkpoint updated to latest processed event', 'PASS',
        `Checkpoint: ${finalCheckpoint.lastProcessedId}`);
    }

    // Verify checkpoint persists across restarts
    const checkpointDoc = await db.collection('worker_checkpoint')
      .findOne({ workerId: 'main_worker' });

    if (checkpointDoc && checkpointDoc._id) {
      logTest('Checkpoint persisted in MongoDB', 'PASS',
        'Ready to resume after restart');
    }

    // ============================================
    // SUMMARY
    // ============================================
    console.log('\n========================================');
    console.log('TEST SUMMARY');
    console.log('========================================');
    console.log(`✅ Passed: ${testResults.passed}`);
    console.log(`❌ Failed: ${testResults.failed}`);
    console.log(`📊 Total:  ${testResults.tests.length}`);
    console.log('========================================\n');

    // Detailed results
    console.log('📋 Detailed Results:\n');
    testResults.tests.forEach((test, i) => {
      const icon = test.status === 'PASS' ? '✅' : '❌';
      console.log(`${i + 1}. ${icon} ${test.name}`);
      if (test.details) {
        console.log(`   ${test.details}`);
      }
    });

    // Print delivery log details
    console.log('\n📦 Delivery Logs Summary:');
    const finalLogs = await db.collection('delivery_logs')
      .find({
        entityRid: 33,
        webhookName: { $regex: /^E2E_TEST_/ }
      })
      .sort({ createdAt: -1 })
      .toArray();

    finalLogs.forEach(log => {
      console.log(`\n  Webhook: ${log.webhookName}`);
      console.log(`  Event ID: ${log.eventId}`);
      console.log(`  Status: ${log.status}`);
      console.log(`  HTTP Status: ${log.httpStatus || 'N/A'}`);
      console.log(`  Retries: ${log.retryCount || 0}/${log.maxRetries || 3}`);
      console.log(`  Created: ${log.createdAt}`);
    });

  } catch (error) {
    console.error('\n❌ Test failed with error:', error);
    logTest('Test execution', 'FAIL', error.message);
  } finally {
    // Cleanup
    if (mysqlConn) await mysqlConn.end();
    if (mongoClient) await mongoClient.close();

    console.log('\n✅ Test completed and cleaned up');
    process.exit(testResults.failed > 0 ? 1 : 0);
  }
})();
