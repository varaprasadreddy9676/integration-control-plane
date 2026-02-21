/**
 * Test script for DLQ, Execution Logging, and Rate Limiting
 *
 * Usage: node test-dlq-rate-limiting.js
 */

const { connect, getDb, toObjectId } = require('./src/mongodb');
const executionLogsData = require('./src/data/execution-logs');
const dlqData = require('./src/data/dlq');
const { checkRateLimit, resetRateLimit } = require('./src/middleware/rate-limiter');
const { log } = require('./src/logger');

async function testExecutionLogging() {
  console.log('\n=== Testing Execution Logging ===\n');

  // Test 1: Create execution log
  const testLog = {
    traceId: `test_${Date.now()}`,
    messageId: `msg_${Date.now()}`,
    direction: 'OUTBOUND',
    triggerType: 'EVENT',
    integrationConfigId: toObjectId('507f1f77bcf86cd799439011'),
    orgId: 100,
    status: 'pending',
    startedAt: new Date(),
    request: {
      url: 'https://webhook.site/test',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { test: true }
    },
    steps: [],
    metadata: { test: 'execution-logging-test' }
  };

  try {
    const logId = await executionLogsData.createExecutionLog(testLog);
    console.log('✓ Created execution log:', logId);

    // Test 2: Add steps
    await executionLogsData.addExecutionStep(logId, {
      name: 'validation',
      timestamp: new Date(),
      durationMs: 5,
      status: 'success',
      metadata: { validated: true }
    });
    console.log('✓ Added validation step');

    await executionLogsData.addExecutionStep(logId, {
      name: 'rate_limit',
      timestamp: new Date(),
      durationMs: 2,
      status: 'success',
      metadata: { remaining: 99, maxRequests: 100 }
    });
    console.log('✓ Added rate_limit step');

    await executionLogsData.addExecutionStep(logId, {
      name: 'http_request',
      timestamp: new Date(),
      durationMs: 150,
      status: 'success',
      metadata: { statusCode: 200 }
    });
    console.log('✓ Added http_request step');

    // Test 3: Update to success
    await executionLogsData.updateExecutionLog(logId, {
      status: 'success',
      finishedAt: new Date(),
      durationMs: 157,
      response: {
        statusCode: 200,
        body: { success: true }
      }
    });
    console.log('✓ Updated execution log to success');

    // Test 4: Retrieve execution log
    const retrieved = await executionLogsData.getExecutionLog(logId, 100);
    console.log('✓ Retrieved execution log with', retrieved.steps.length, 'steps');
    console.log('✓ Execution timeline:', retrieved.steps.map(s => s.name).join(' → '));

    // Test 5: Get stats (skip if MongoDB version doesn't support $percentile)
    try {
      const stats = await executionLogsData.getExecutionStats(100);
      console.log('✓ Got stats:', JSON.stringify(stats, null, 2));
    } catch (err) {
      if (err.message.includes('$percentile')) {
        console.log('⚠ Skipped stats test (MongoDB version doesn\'t support $percentile)');
      } else {
        throw err;
      }
    }

    console.log('\n✅ Execution logging tests passed!\n');
    return logId;
  } catch (error) {
    console.error('✗ Execution logging test failed:', error.message);
    throw error;
  }
}

async function testDLQ() {
  console.log('\n=== Testing Dead Letter Queue ===\n');

  const testEntry = {
    traceId: `test_dlq_${Date.now()}`,
    executionLogId: `test_exec_${Date.now()}`,
    integrationConfigId: toObjectId('507f1f77bcf86cd799439011'),
    orgId: 100,
    direction: 'OUTBOUND',
    payload: { test: 'dlq-test', timestamp: Date.now() },
    error: {
      message: 'Test error: Simulated failure',
      code: 'ECONNREFUSED',
      category: 'NETWORK',
      statusCode: null
    },
    retryStrategy: 'exponential',
    maxRetries: 5,
    metadata: { test: 'dlq-test' }
  };

  try {
    // Test 1: Create DLQ entry
    const entryId = await dlqData.createDLQEntry(testEntry);
    console.log('✓ Created DLQ entry:', entryId);

    // Test 2: Get entry details
    const entry = await dlqData.getDLQEntry(entryId, 100);
    console.log('✓ Retrieved DLQ entry, status:', entry.status, 'retryCount:', entry.retryCount);

    // Test 3: Get entries for retry (should not include this one yet since nextRetryAt is in future)
    const forRetry = await dlqData.getDLQEntriesForRetry(10);
    console.log('✓ Found', forRetry.length, 'entries ready for retry');

    // Test 4: Record retry attempt (simulate failure)
    await dlqData.recordRetryAttempt(entryId, 100, 'failure');
    console.log('✓ Recorded retry attempt (failure)');

    // Test 5: Manual retry (marks as resolved on success)
    await dlqData.manualRetryDLQ(entryId, 100);
    console.log('✓ Triggered manual retry');

    // Test 6: Get DLQ stats
    const stats = await dlqData.getDLQStats(100);
    console.log('✓ Got DLQ stats:', JSON.stringify(stats, null, 2));

    // Test 7: List DLQ entries
    const entries = await dlqData.listDLQEntries(100, { limit: 5, skip: 0 });
    console.log('✓ Listed', entries.total, 'total DLQ entries,', entries.entries.length, 'in current page');

    console.log('\n✅ DLQ tests passed!\n');
    return entryId;
  } catch (error) {
    console.error('✗ DLQ test failed:', error.message);
    throw error;
  }
}

async function testRateLimiting() {
  console.log('\n=== Testing Rate Limiting ===\n');

  const testIntegrationId = toObjectId('507f1f77bcf86cd799439011');
  const testOrgId = 100;
  const rateLimits = {
    enabled: true,
    maxRequests: 3,
    windowSeconds: 60
  };

  try {
    // Clean up any existing rate limit state
    await resetRateLimit(testIntegrationId, testOrgId);
    console.log('✓ Reset rate limit state');

    // Test 1: First request - should be allowed
    const result1 = await checkRateLimit(testIntegrationId, testOrgId, rateLimits);
    console.log('✓ Request 1 - Allowed:', result1.allowed, 'Remaining:', result1.remaining);
    if (!result1.allowed || result1.remaining !== 2) {
      throw new Error('Expected request 1 to be allowed with 2 remaining');
    }

    // Test 2: Second request - should be allowed
    const result2 = await checkRateLimit(testIntegrationId, testOrgId, rateLimits);
    console.log('✓ Request 2 - Allowed:', result2.allowed, 'Remaining:', result2.remaining);
    if (!result2.allowed || result2.remaining !== 1) {
      throw new Error('Expected request 2 to be allowed with 1 remaining');
    }

    // Test 3: Third request - should be allowed (last one)
    const result3 = await checkRateLimit(testIntegrationId, testOrgId, rateLimits);
    console.log('✓ Request 3 - Allowed:', result3.allowed, 'Remaining:', result3.remaining);
    if (!result3.allowed || result3.remaining !== 0) {
      throw new Error('Expected request 3 to be allowed with 0 remaining');
    }

    // Test 4: Fourth request - should be BLOCKED
    const result4 = await checkRateLimit(testIntegrationId, testOrgId, rateLimits);
    console.log('✓ Request 4 - Allowed:', result4.allowed, 'Retry after:', result4.retryAfter, 's');
    if (result4.allowed) {
      throw new Error('Expected request 4 to be blocked (rate limit exceeded)');
    }

    // Test 5: Fifth request - should also be BLOCKED
    const result5 = await checkRateLimit(testIntegrationId, testOrgId, rateLimits);
    console.log('✓ Request 5 - Allowed:', result5.allowed, 'Retry after:', result5.retryAfter, 's');
    if (result5.allowed) {
      throw new Error('Expected request 5 to be blocked (rate limit exceeded)');
    }

    // Verify rate_limits collection has entry
    const db = getDb();
    const rateLimitDoc = await db.collection('rate_limits').findOne({
      integrationConfigId: testIntegrationId,
      orgId: testOrgId
    });
    console.log('✓ Rate limit document in DB:', {
      requestCount: rateLimitDoc.requestCount,
      windowStart: rateLimitDoc.windowStart,
      windowEnd: rateLimitDoc.windowEnd
    });

    if (rateLimitDoc.requestCount !== 5) {
      throw new Error(`Expected 5 requests counted, got ${rateLimitDoc.requestCount}`);
    }

    console.log('\n✅ Rate limiting tests passed!\n');
    console.log('Summary:');
    console.log('  - Requests 1-3: ✓ Allowed');
    console.log('  - Requests 4-5: ✗ Blocked (rate limit exceeded)');
    console.log('  - Rate limit tracking: ✓ Working correctly\n');

  } catch (error) {
    console.error('✗ Rate limiting test failed:', error.message);
    throw error;
  }
}

async function testRateLimitedDLQIntegration() {
  console.log('\n=== Testing Rate Limited Request → DLQ Integration ===\n');

  // Simulate what happens when a rate-limited request creates a DLQ entry
  const traceId = `test_rl_dlq_${Date.now()}`;

  try {
    // Step 1: Create execution log for rate-limited request
    const execLog = {
      traceId,
      messageId: `msg_rl_${Date.now()}`,
      direction: 'OUTBOUND',
      triggerType: 'EVENT',
      integrationConfigId: toObjectId('507f1f77bcf86cd799439011'),
      orgId: 100,
      status: 'retrying',
      startedAt: new Date(),
      request: {
        url: 'https://webhook.site/test-rate-limit',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: { data: 'rate-limited-request' }
      },
      steps: [
        {
          name: 'rate_limit',
          timestamp: new Date(),
          durationMs: 2,
          status: 'failed',
          metadata: {
            remaining: 0,
            resetAt: new Date(Date.now() + 60000).toISOString(),
            maxRequests: 3,
            windowSeconds: 60
          },
          error: { message: 'Rate limit exceeded' }
        }
      ]
    };

    const execLogId = await executionLogsData.createExecutionLog(execLog);
    console.log('✓ Created execution log for rate-limited request:', execLogId);

    // Step 2: Create DLQ entry with RATE_LIMIT category
    const dlqEntry = {
      traceId,
      executionLogId: execLogId,
      integrationConfigId: toObjectId('507f1f77bcf86cd799439011'),
      orgId: 100,
      direction: 'OUTBOUND',
      payload: { data: 'rate-limited-request' },
      error: {
        message: 'Rate limit exceeded, retry after 60s',
        code: 'RATE_LIMIT',
        category: 'RATE_LIMIT',
        statusCode: 429
      },
      retryStrategy: 'exponential',
      maxRetries: 5,
      metadata: { rateLimitedAt: new Date() }
    };

    const dlqId = await dlqData.createDLQEntry(dlqEntry);
    console.log('✓ Created DLQ entry with RATE_LIMIT category:', dlqId);

    // Step 3: Verify the integration
    const retrievedExecLog = await executionLogsData.getExecutionLog(execLogId, 100);
    const retrievedDLQ = await dlqData.getDLQEntry(dlqId, 100);

    console.log('✓ Verified execution log status:', retrievedExecLog.status);
    console.log('✓ Verified DLQ error category:', retrievedDLQ.error.category);
    console.log('✓ Verified DLQ status:', retrievedDLQ.status);

    if (retrievedDLQ.error.category !== 'RATE_LIMIT') {
      throw new Error('Expected DLQ error category to be RATE_LIMIT');
    }

    if (retrievedDLQ.error.statusCode !== 429) {
      throw new Error('Expected status code 429');
    }

    console.log('\n✅ Rate-limited request → DLQ integration test passed!\n');
  } catch (error) {
    console.error('✗ Rate-limited DLQ integration test failed:', error.message);
    throw error;
  }
}

async function runAllTests() {
  console.log('\n╔════════════════════════════════════════════════════════╗');
  console.log('║  DLQ + Execution Logging + Rate Limiting Test Suite  ║');
  console.log('╚════════════════════════════════════════════════════════╝\n');

  try {
    // Connect to MongoDB
    await connect();
    console.log('✓ Connected to MongoDB\n');

    // Run all tests
    await testExecutionLogging();
    await testDLQ();
    await testRateLimiting();
    await testRateLimitedDLQIntegration();

    console.log('\n╔════════════════════════════════════════════════════════╗');
    console.log('║           ✅ ALL TESTS PASSED SUCCESSFULLY            ║');
    console.log('╚════════════════════════════════════════════════════════╝\n');

    process.exit(0);
  } catch (error) {
    console.error('\n╔════════════════════════════════════════════════════════╗');
    console.error('║              ✗ TESTS FAILED                           ║');
    console.error('╚════════════════════════════════════════════════════════╝\n');
    console.error('Error:', error.message);
    console.error('\nStack:', error.stack);
    process.exit(1);
  }
}

// Run tests
runAllTests();
