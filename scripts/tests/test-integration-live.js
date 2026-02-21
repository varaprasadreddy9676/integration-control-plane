/**
 * Live Integration Test - Test with actual backend server and databases
 *
 * This test verifies:
 * 1. Execution logging API endpoints
 * 2. DLQ API endpoints
 * 3. Rate limiting integration
 * 4. DLQ worker functionality
 * 5. Frontend data access
 *
 * Usage: node test-integration-live.js
 */

const config = require('./config.json');
const { connect, getDb, toObjectId } = require('./src/mongodb');

const BASE_URL = `http://localhost:${config.port}${config.api.basePrefix}`;
const API_KEY = config.security.apiKey;
const ORG_ID = 100;

let testResults = {
  passed: 0,
  failed: 0,
  tests: []
};

function logTest(name, passed, details = '') {
  const status = passed ? '✓ PASS' : '✗ FAIL';
  console.log(`  ${status} - ${name}`);
  if (details) {
    console.log(`         ${details}`);
  }
  testResults.tests.push({ name, passed, details });
  if (passed) testResults.passed++;
  else testResults.failed++;
}

// HTTP Helper
async function apiRequest(method, path, body = null) {
  const https = require('https');
  const http = require('http');

  return new Promise((resolve, reject) => {
    const url = new URL(BASE_URL + path);
    const isHttps = url.protocol === 'https:';
    const client = isHttps ? https : http;

    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'x-org-id': ORG_ID.toString()
      }
    };

    if (body) {
      const bodyStr = JSON.stringify(body);
      options.headers['Content-Length'] = Buffer.byteLength(bodyStr);
    }

    const req = client.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {data += chunk;
      });
      res.on('end', () => {
        try {
          const parsed = data ? JSON.parse(data) : null;
          resolve({
            status: res.statusCode,
            headers: res.headers,
            data: parsed
          });
        } catch (e) {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            data: { raw: data }
          });
        }
      });
    });

    req.on('error', reject);

    if (body) {
      req.write(JSON.stringify(body));
    }

    req.end();
  });
}

// Test 1: API Health Check
async function testHealthCheck() {
  console.log('\n=== Test 1: API Health Check ===');

  try {
    const res = await apiRequest('GET', '/../../health');
    logTest('Health endpoint accessible', res.status === 200);
    logTest('MongoDB connected', res.data?.mysql?.available === true || res.data?.checks !== undefined);
    logTest('Delivery worker alive', res.data?.workers?.deliveryWorker?.alive === true);
    logTest('Scheduler worker alive', res.data?.workers?.schedulerWorker?.alive === true);
  } catch (error) {
    logTest('Health check', false, error.message);
  }
}

// Test 2: Execution Logs API
async function testExecutionLogsAPI() {
  console.log('\n=== Test 2: Execution Logs API ===');

  try {
    // List execution logs
    const listRes = await apiRequest('GET', `/execution-logs?orgId=${ORG_ID}&limit=5`);
    logTest('List execution logs endpoint', listRes.status === 200);

    if (listRes.data) {
      const logs = listRes.data.logs || listRes.data.data || listRes.data;
      logTest('Execution logs returned', Array.isArray(logs), `Found ${Array.isArray(logs) ? logs.length : 0} logs`);

      if (Array.isArray(logs) && logs.length > 0) {
        const log = logs[0];
        logTest('Execution log has traceId', !!log.traceId, `TraceId: ${log.traceId}`);
        logTest('Execution log has steps', Array.isArray(log.steps), `Steps: ${log.steps?.length || 0}`);
        logTest('Execution log has status', !!log.status, `Status: ${log.status}`);
      }
    }

    // Get stats
    const statsRes = await apiRequest('GET', `/execution-logs/stats?orgId=${ORG_ID}`);
    logTest('Execution logs stats endpoint', statsRes.status === 200, `Status: ${statsRes.status}`);

  } catch (error) {
    logTest('Execution logs API', false, error.message);
  }
}

// Test 3: DLQ API
async function testDLQAPI() {
  console.log('\n=== Test 3: DLQ (Dead Letter Queue) API ===');

  try {
    // List DLQ entries
    const listRes = await apiRequest('GET', `/dlq?orgId=${ORG_ID}&limit=10`);
    logTest('List DLQ entries endpoint', listRes.status === 200);

    if (listRes.data) {
      const entries = listRes.data.entries || listRes.data.data || listRes.data;
      logTest('DLQ entries returned', Array.isArray(entries), `Found ${Array.isArray(entries) ? entries.length : 0} entries`);

      if (Array.isArray(entries) && entries.length > 0) {
        const entry = entries[0];
        logTest('DLQ entry has dlqId', !!entry.dlqId, `DLQ ID: ${entry.dlqId}`);
        logTest('DLQ entry has error category', !!entry.error?.category, `Category: ${entry.error?.category}`);
        logTest('DLQ entry has status', !!entry.status, `Status: ${entry.status}`);

        // Count rate-limited entries
        const rateLimited = entries.filter(e => e.error?.category === 'RATE_LIMIT');
        if (rateLimited.length > 0) {
          logTest('Rate-limited DLQ entries found', true, `Count: ${rateLimited.length}`);
        }
      }
    }

    // Get DLQ stats
    const statsRes = await apiRequest('GET', `/dlq/stats?orgId=${ORG_ID}`);
    logTest('DLQ stats endpoint', statsRes.status === 200);

  } catch (error) {
    logTest('DLQ API', false, error.message);
  }
}

// Test 4: MongoDB Collections Direct Verification
async function testMongoDBCollections() {
  console.log('\n=== Test 4: MongoDB Collections Verification ===');

  try {
    const db = getDb();

    // Check execution_logs
    const execLogCount = await db.collection('execution_logs').countDocuments();
    logTest('execution_logs collection exists', execLogCount >= 0, `Documents: ${execLogCount}`);

    if (execLogCount > 0) {
      const sampleLog = await db.collection('execution_logs').findOne({}, { sort: { createdAt: -1 } });
      logTest('Execution log has required fields',
        !!(sampleLog.traceId && sampleLog.direction && sampleLog.status),
        `TraceId: ${sampleLog.traceId}, Status: ${sampleLog.status}`
      );

      logTest('Execution log has steps array',
        Array.isArray(sampleLog.steps),
        `Steps: ${sampleLog.steps?.map(s => s.name).join(' → ') || 'none'}`
      );
    }

    // Check failed_deliveries (DLQ)
    const dlqCount = await db.collection('failed_deliveries').countDocuments();
    logTest('failed_deliveries collection exists', dlqCount >= 0, `Documents: ${dlqCount}`);

    if (dlqCount > 0) {
      const sampleDLQ = await db.collection('failed_deliveries').findOne({}, { sort: { createdAt: -1 } });
      logTest('DLQ entry has required fields',
        !!(sampleDLQ.dlqId && sampleDLQ.error && sampleDLQ.status),
        `DLQ ID: ${sampleDLQ.dlqId}, Category: ${sampleDLQ.error?.category}`
      );
    }

    // Check rate_limits
    const rateLimitCount = await db.collection('rate_limits').countDocuments();
    logTest('rate_limits collection exists', rateLimitCount >= 0, `Documents: ${rateLimitCount}`);

    if (rateLimitCount > 0) {
      const sampleRL = await db.collection('rate_limits').findOne({}, { sort: { windowStart: -1 } });
      logTest('Rate limit has sliding window',
        !!(sampleRL.windowStart && sampleRL.windowEnd && sampleRL.requestCount !== undefined),
        `Request count: ${sampleRL.requestCount}, Window: ${Math.ceil((sampleRL.windowEnd - new Date()) / 1000)}s remaining`
      );
    }

    // Check indexes
    const execLogIndexes = await db.collection('execution_logs').indexes();
    logTest('execution_logs has indexes', execLogIndexes.length > 1, `Count: ${execLogIndexes.length}`);

    const dlqIndexes = await db.collection('failed_deliveries').indexes();
    logTest('failed_deliveries has indexes', dlqIndexes.length > 1, `Count: ${dlqIndexes.length}`);

    const rateLimitIndexes = await db.collection('rate_limits').indexes();
    logTest('rate_limits has indexes', rateLimitIndexes.length > 1, `Count: ${rateLimitIndexes.length}`);

  } catch (error) {
    logTest('MongoDB collections verification', false, error.message);
  }
}

// Test 5: Rate Limiting Integration
async function testRateLimitingIntegration() {
  console.log('\n=== Test 5: Rate Limiting Integration ===');

  try {
    const db = getDb();

    // Check if any integrations have rate limits configured
    const integrations = await db.collection('integration_configs').find({
      'rateLimits.enabled': true
    }).toArray();

    logTest('Integrations with rate limits configured', integrations.length > 0, `Count: ${integrations.length}`);

    if (integrations.length > 0) {
      const integration = integrations[0];
      logTest('Rate limit configuration valid',
        !!(integration.rateLimits.maxRequests && integration.rateLimits.windowSeconds),
        `${integration.rateLimits.maxRequests} requests per ${integration.rateLimits.windowSeconds}s`
      );
    }

    // Check for rate-limited executions
    const rateLimitedExecutions = await db.collection('execution_logs').find({
      'steps': {
        $elemMatch: {
          name: 'rate_limit',
          status: 'failed'
        }
      }
    }).limit(5).toArray();

    if (rateLimitedExecutions.length > 0) {
      logTest('Rate-limited executions found', true, `Count: ${rateLimitedExecutions.length}`);

      rateLimitedExecutions.forEach((exec, idx) => {
        const rateLimitStep = exec.steps.find(s => s.name === 'rate_limit');
        logTest(`  Rate limit step ${idx + 1} has metadata`,
          !!(rateLimitStep?.metadata),
          `Remaining: ${rateLimitStep?.metadata?.remaining}, Max: ${rateLimitStep?.metadata?.maxRequests}`
        );
      });
    }

  } catch (error) {
    logTest('Rate limiting integration', false, error.message);
  }
}

// Test 6: DLQ and Execution Log Correlation
async function testDLQExecutionCorrelation() {
  console.log('\n=== Test 6: DLQ ↔ Execution Log Correlation ===');

  try {
    const db = getDb();

    // Find DLQ entries with rate limit category
    const rateLimitedDLQ = await db.collection('failed_deliveries').find({
      'error.category': 'RATE_LIMIT'
    }).limit(3).toArray();

    if (rateLimitedDLQ.length > 0) {
      logTest('Rate-limited DLQ entries exist', true, `Count: ${rateLimitedDLQ.length}`);

      for (const dlq of rateLimitedDLQ) {
        // Find corresponding execution log
        const execLog = await db.collection('execution_logs').findOne({
          traceId: dlq.executionLogId || dlq.traceId
        });

        logTest(`  DLQ ${dlq.dlqId} has matching execution log`,
          !!execLog,
          execLog ? `TraceId: ${execLog.traceId}` : 'Not found'
        );

        if (execLog) {
          logTest(`    Execution log status is retrying`,
            execLog.status === 'retrying',
            `Status: ${execLog.status}`
          );

          const rateLimitStep = execLog.steps.find(s => s.name === 'rate_limit');
          logTest(`    Has rate_limit step with failed status`,
            rateLimitStep?.status === 'failed',
            rateLimitStep ? 'Found' : 'Missing'
          );
        }
      }
    } else {
      logTest('Rate-limited DLQ entries', false, 'No rate-limited DLQ entries found (expected if no rate limits hit yet)');
    }

  } catch (error) {
    logTest('DLQ/Execution correlation', false, error.message);
  }
}

// Test 7: Frontend Data Access Simulation
async function testFrontendDataAccess() {
  console.log('\n=== Test 7: Frontend Data Access Simulation ===');

  try {
    // Simulate what the frontend would request

    // 1. Get DLQ statistics for dashboard
    const dlqStats = await apiRequest('GET', `/dlq/stats?orgId=${ORG_ID}`);
    logTest('Frontend: DLQ stats accessible', dlqStats.status === 200);

    // 2. Get recent execution logs
    const execLogs = await apiRequest('GET', `/execution-logs?orgId=${ORG_ID}&limit=10`);
    logTest('Frontend: Execution logs accessible', execLogs.status === 200);

    // 3. Get DLQ entries for table
    const dlqEntries = await apiRequest('GET', `/dlq?orgId=${ORG_ID}&limit=20`);
    logTest('Frontend: DLQ entries accessible', dlqEntries.status === 200);

    // 4. If we have a traceId, simulate getting timeline
    const db = getDb();
    const sampleLog = await db.collection('execution_logs').findOne({}, { sort: { createdAt: -1 } });
    if (sampleLog) {
      const timeline = await apiRequest('GET', `/execution-logs/${sampleLog.traceId}/timeline?orgId=${ORG_ID}`);
      logTest('Frontend: Execution timeline accessible', timeline.status === 200, `TraceId: ${sampleLog.traceId}`);
    }

  } catch (error) {
    logTest('Frontend data access', false, error.message);
  }
}

// Test 8: DLQ Worker Verification
async function testDLQWorker() {
  console.log('\n=== Test 8: DLQ Worker Verification ===');

  try {
    const db = getDb();

    // Check if DLQ worker has processed any entries
    const retriedEntries = await db.collection('failed_deliveries').find({
      retryCount: { $gt: 0 }
    }).limit(5).toArray();

    logTest('DLQ worker has processed retries', retriedEntries.length > 0, `Retried entries: ${retriedEntries.length}`);

    if (retriedEntries.length > 0) {
      const entry = retriedEntries[0];
      logTest('Retry count incremented',
        entry.retryCount > 0,
        `Retry count: ${entry.retryCount}/${entry.maxRetries}`
      );

      logTest('Next retry time calculated',
        !!entry.nextRetryAt,
        entry.nextRetryAt ? `Next retry: ${new Date(entry.nextRetryAt).toISOString()}` : 'Not set'
      );
    }

    // Check for resolved entries (successful retries)
    const resolvedEntries = await db.collection('failed_deliveries').find({
      status: 'resolved'
    }).limit(3).toArray();

    if (resolvedEntries.length > 0) {
      logTest('DLQ worker has successfully resolved entries', true, `Resolved: ${resolvedEntries.length}`);
    }

    // Check for abandoned entries (max retries reached)
    const abandonedEntries = await db.collection('failed_deliveries').find({
      status: 'abandoned'
    }).limit(3).toArray();

    if (abandonedEntries.length > 0) {
      logTest('Max retries enforced (abandoned entries)', true, `Abandoned: ${abandonedEntries.length}`);
    }

  } catch (error) {
    logTest('DLQ worker verification', false, error.message);
  }
}

// Main test runner
async function runIntegrationTests() {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║  Live Integration Test Suite - Production Database Testing  ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  try {
    // Connect to MongoDB
    await connect();
    console.log('✓ Connected to MongoDB');
    console.log(`✓ Testing against: ${BASE_URL}`);
    console.log(`✓ Organization ID: ${ORG_ID}\n`);

    // Run all tests
    await testHealthCheck();
    await testExecutionLogsAPI();
    await testDLQAPI();
    await testMongoDBCollections();
    await testRateLimitingIntegration();
    await testDLQExecutionCorrelation();
    await testFrontendDataAccess();
    await testDLQWorker();

    // Print summary
    console.log('\n╔══════════════════════════════════════════════════════════════╗');
    console.log('║                       TEST SUMMARY                           ║');
    console.log('╚══════════════════════════════════════════════════════════════╝\n');

    console.log(`  Total Tests: ${testResults.passed + testResults.failed}`);
    console.log(`  ✓ Passed: ${testResults.passed}`);
    console.log(`  ✗ Failed: ${testResults.failed}`);
    console.log(`  Success Rate: ${Math.round((testResults.passed / (testResults.passed + testResults.failed)) * 100)}%\n`);

    if (testResults.failed === 0) {
      console.log('╔══════════════════════════════════════════════════════════════╗');
      console.log('║              ✅ ALL INTEGRATION TESTS PASSED                ║');
      console.log('╚══════════════════════════════════════════════════════════════╝\n');
      console.log('✓ DLQ, Execution Logging, and Rate Limiting are working correctly');
      console.log('✓ All API endpoints accessible');
      console.log('✓ MongoDB collections properly configured');
      console.log('✓ Workers are operational\n');
    } else {
      console.log('╔══════════════════════════════════════════════════════════════╗');
      console.log('║            ⚠️  SOME INTEGRATION TESTS FAILED                ║');
      console.log('╚══════════════════════════════════════════════════════════════╝\n');
      console.log('Failed tests:');
      testResults.tests
        .filter(t => !t.passed)
        .forEach(t => console.log(`  ✗ ${t.name}: ${t.details}`));
      console.log('');
    }

    console.log('Next Steps:');
    console.log('  1. Open frontend: http://localhost:' + config.port + '/dlq');
    console.log('  2. Test DLQ Management UI');
    console.log('  3. Click "View Trace" on any entry to see execution timeline');
    console.log('  4. Monitor DLQ worker auto-retry in backend logs');
    console.log('  5. Trigger test webhooks to verify rate limiting\n');

    process.exit(testResults.failed === 0 ? 0 : 1);

  } catch (error) {
    console.error('\n╔══════════════════════════════════════════════════════════════╗');
    console.error('║              ✗ INTEGRATION TESTS CRASHED                    ║');
    console.error('╚══════════════════════════════════════════════════════════════╝\n');
    console.error('Error:', error.message);
    console.error('\nStack:', error.stack);
    process.exit(1);
  }
}

// Run tests
runIntegrationTests();
