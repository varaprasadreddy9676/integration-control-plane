/**
 * Stress Test: Verify retry mechanism stops at configured limit
 *
 * This creates a webhook that will intentionally fail with 500 errors,
 * then monitors to ensure it stops retrying after maxRetries
 */

const { connect, getDbSafe } = require('./src/mongodb');
const { query } = require('./src/db');

async function stressTestRetry() {
  try {
    await connect();
    const db = await getDbSafe();

    console.log('\n🧪 RETRY STRESS TEST\n');
    console.log('='.repeat(70));

    // Create a test webhook that will fail (bad URL)
    console.log('\n📋 Step 1: Creating test webhook with retryCount=2...');

    const webhookConfig = {
      entityRid: 33,
      name: 'Retry Stress Test - Should Stop at 2 Attempts',
      eventType: 'TEST_RETRY_EVENT',
      scope: 'ENTITY_ONLY',
      targetUrl: 'https://httpstat.us/500', // Always returns 500 error
      httpMethod: 'POST',
      outgoingAuthType: 'NONE',
      outgoingAuthConfig: {},
      headers: {},
      timeoutMs: 5000,
      retryCount: 2, // CRITICAL: Only retry ONCE (attempt 1 + 1 retry = 2 total)
      transformationMode: 'SIMPLE',
      transformation: {},
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    // Clean up any existing test webhook
    await db.collection('webhook_configs').deleteMany({
      name: /Retry Stress Test/i
    });

    const webhookResult = await db.collection('webhook_configs').insertOne(webhookConfig);
    const webhookId = webhookResult.insertedId.toString();

    console.log(`✅ Webhook created: ${webhookId}`);
    console.log(`   Max retries: 2 (initial attempt + 1 retry)`);
    console.log(`   Expected attempts: 2 total`);

    // Insert test event
    console.log('\n📋 Step 2: Inserting test event...');

    const testPayload = {
      type: 'TEST_RETRY_EVENT',
      message: 'This should trigger exactly 2 delivery attempts',
      timestamp: new Date().toISOString()
    };

    const insertQuery = `
      INSERT INTO notification_queue
      (entity_rid, transaction_type, message, status, created_at)
      VALUES (?, ?, ?, 'PENDING', NOW())
    `;

    const [result] = await query(insertQuery, [
      33,
      'TEST_RETRY_EVENT',
      JSON.stringify(testPayload)
    ]);

    const eventId = result.insertId;
    console.log(`✅ Event inserted: ${eventId}`);

    // Wait for processing
    console.log('\n📋 Step 3: Waiting for worker to process (20 seconds)...');
    console.log('   Expected timeline:');
    console.log('     0s: Initial attempt → 500 error → status=RETRYING, attemptCount=1');
    console.log('     10s: Retry attempt → 500 error → status=RETRYING, attemptCount=2');
    console.log('     10s: Check: 2 >= 2 → markLogAsAbandoned() → status=ABANDONED');
    console.log('     20s: No more retries (status=ABANDONED excluded from query)');

    await new Promise(resolve => setTimeout(resolve, 25000));

    // Check delivery logs
    console.log('\n📋 Step 4: Analyzing results...');

    const deliveryLogs = await db.collection('delivery_logs')
      .find({
        webhookConfigId: webhookId
      })
      .sort({ createdAt: -1 })
      .toArray();

    console.log(`\n   Total delivery logs: ${deliveryLogs.length}`);

    if (deliveryLogs.length === 0) {
      console.log('   ❌ ERROR: No delivery logs found!');
      console.log('   Check if webhook is active and worker is running');
      process.exit(1);
    }

    // Should be only 1 log document (updated with each retry)
    const log = deliveryLogs[0];

    console.log(`\n   Final Status: ${log.status}`);
    console.log(`   Attempt Count: ${log.attemptCount}`);
    console.log(`   Response Status: ${log.responseStatus}`);
    console.log(`   Error: ${log.errorMessage}`);
    console.log(`   Created: ${new Date(log.createdAt).toLocaleString()}`);
    console.log(`   Updated: ${new Date(log.updatedAt).toLocaleString()}`);

    // Verify expectations
    console.log('\n📋 Step 5: Verification...');

    let passed = true;
    const checks = [];

    // Check 1: Attempt count should be exactly 2
    if (log.attemptCount === 2) {
      checks.push('✅ Attempt count is 2 (correct)');
    } else {
      checks.push(`❌ Attempt count is ${log.attemptCount} (expected 2)`);
      passed = false;
    }

    // Check 2: Status should be ABANDONED
    if (log.status === 'ABANDONED') {
      checks.push('✅ Status is ABANDONED (correct)');
    } else {
      checks.push(`❌ Status is ${log.status} (expected ABANDONED)`);
      passed = false;
    }

    // Check 3: Response should be 500
    if (log.responseStatus === 500) {
      checks.push('✅ Response status is 500 (correct)');
    } else {
      checks.push(`❌ Response status is ${log.responseStatus} (expected 500)`);
      passed = false;
    }

    // Check 4: Only ONE log document (not multiple)
    if (deliveryLogs.length === 1) {
      checks.push('✅ Only 1 log document (updates in place, correct)');
    } else {
      checks.push(`❌ Found ${deliveryLogs.length} log documents (expected 1)`);
      passed = false;
    }

    checks.forEach(check => console.log(`   ${check}`));

    // Check delivery attempts collection
    const deliveryAttempts = await db.collection('delivery_attempts')
      .find({ deliveryLogId: log._id.toString() })
      .toArray();

    console.log(`\n   Delivery attempts recorded: ${deliveryAttempts.length}`);

    // Wait a bit longer to ensure no additional retries
    console.log('\n📋 Step 6: Waiting 20 more seconds to ensure no further retries...');
    await new Promise(resolve => setTimeout(resolve, 20000));

    const finalLog = await db.collection('delivery_logs').findOne({ _id: log._id });

    console.log(`\n   Final check after 20 seconds:`);
    console.log(`     Status: ${finalLog.status}`);
    console.log(`     Attempt Count: ${finalLog.attemptCount}`);

    if (finalLog.attemptCount === log.attemptCount) {
      console.log(`   ✅ Attempt count unchanged (no additional retries)`);
    } else {
      console.log(`   ❌ Attempt count changed from ${log.attemptCount} to ${finalLog.attemptCount}`);
      console.log(`   ❌ CRITICAL: Retry loop did not stop!`);
      passed = false;
    }

    // Cleanup
    console.log('\n📋 Step 7: Cleanup...');
    await db.collection('webhook_configs').deleteOne({ _id: webhookResult.insertedId });
    await db.collection('delivery_logs').deleteMany({ webhookConfigId: webhookId });
    console.log('   ✅ Test webhook and logs deleted');

    // Final result
    console.log('\n' + '='.repeat(70));

    if (passed) {
      console.log('✅ STRESS TEST PASSED');
      console.log('');
      console.log('   The retry mechanism:');
      console.log('   ✓ Stopped at the configured retry limit (2 attempts)');
      console.log('   ✓ Marked the log as ABANDONED');
      console.log('   ✓ Did not create additional retry attempts');
      console.log('   ✓ Updated the same log document (not creating duplicates)');
      console.log('');
      console.log('   🎉 No infinite loop detected!');
    } else {
      console.log('❌ STRESS TEST FAILED');
      console.log('');
      console.log('   Review the checks above for details');
    }

    console.log('\n' + '='.repeat(70));
    console.log('');

    process.exit(passed ? 0 : 1);

  } catch (error) {
    console.error('\n❌ Test failed:', error);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

stressTestRetry();
