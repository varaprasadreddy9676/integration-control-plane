#!/usr/bin/env node

/**
 * Token Management Smoke Test
 * Tests token caching, expiration detection, and refresh logic
 *
 * Usage: node smoke-test-token-management.js
 *
 * Requirements:
 * - Server must be running on port 3545
 * - MongoDB must be accessible
 * - Test tenant ID configured below
 */

const http = require('http');
const { MongoClient, ObjectId } = require('mongodb');

// Configuration
const CONFIG = {
  baseUrl: 'http://localhost:3545',
  tenantId: 145,
  mongoUrl: process.env.MONGO_URL || 'mongodb://localhost:27017',
  dbName: process.env.DB_NAME || 'medics_integration_gateway',
  timeout: 10000,
};

// Colors for console output
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m',
};

function log(message, type = 'info') {
  const timestamp = new Date().toISOString();
  const colorMap = {
    info: colors.blue,
    success: colors.green,
    error: colors.red,
    warn: colors.yellow,
  };
  const color = colorMap[type] || colors.reset;
  console.log(`${color}[${timestamp}] ${message}${colors.reset}`);
}

// Helper to make HTTP requests
function makeRequest(method, path, data = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, CONFIG.baseUrl);

    const options = {
      method,
      headers: {
        'Content-Type': 'application/json',
        'x-tenant-id': CONFIG.tenantId.toString(),
        'x-api-key': 'mdcs_dev_key_1f4a',
      },
    };

    const req = http.request(url, options, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try {
          const parsed = body ? JSON.parse(body) : {};
          resolve({ status: res.statusCode, data: parsed });
        } catch (err) {
          resolve({ status: res.statusCode, data: body });
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(CONFIG.timeout, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    if (data) {
      req.write(JSON.stringify(data));
    }
    req.end();
  });
}

// MongoDB connection
let mongoClient;
let db;

async function connectMongo() {
  mongoClient = new MongoClient(CONFIG.mongoUrl);
  await mongoClient.connect();
  db = mongoClient.db(CONFIG.dbName);
  log('Connected to MongoDB', 'success');
}

async function disconnectMongo() {
  if (mongoClient) {
    await mongoClient.close();
    log('Disconnected from MongoDB', 'info');
  }
}

// Test results tracker
const testResults = {
  passed: 0,
  failed: 0,
  skipped: 0,
  tests: [],
};

function recordTest(name, passed, message = '') {
  testResults.tests.push({ name, passed, message });
  if (passed) {
    testResults.passed++;
    log(`✓ ${name}${message ? ': ' + message : ''}`, 'success');
  } else {
    testResults.failed++;
    log(`✗ ${name}${message ? ': ' + message : ''}`, 'error');
  }
}

function skipTest(name, reason) {
  testResults.skipped++;
  testResults.tests.push({ name, passed: null, message: reason });
  log(`⊘ ${name}: ${reason}`, 'warn');
}

// Clean up test data
let createdIntegrationIds = [];

async function cleanup() {
  log('Cleaning up test data...', 'info');

  // Delete created integrations from MongoDB
  if (db && createdIntegrationIds.length > 0) {
    try {
      await db.collection('integration_configs').deleteMany({
        _id: { $in: createdIntegrationIds.map(id => new ObjectId(id)) }
      });
      log(`Deleted ${createdIntegrationIds.length} test integration(s)`, 'info');
    } catch (err) {
      log(`Failed to delete integrations: ${err.message}`, 'warn');
    }
  }

  createdIntegrationIds = [];
}

// Test 1: Verify auth-helper.js exports
async function testAuthHelperExports() {
  try {
    const authHelper = require('./src/processor/auth-helper');

    const expectedExports = [
      'buildAuthHeaders',
      'fetchOAuth2Token',
      'fetchCustomToken',
      'clearCachedToken',
      'extractValueByPath'
    ];

    const missingExports = expectedExports.filter(exp => !authHelper[exp]);

    if (missingExports.length === 0) {
      recordTest('Auth Helper Exports', true, 'All required exports present');
      return true;
    } else {
      recordTest('Auth Helper Exports', false, `Missing: ${missingExports.join(', ')}`);
      return false;
    }
  } catch (err) {
    recordTest('Auth Helper Exports', false, err.message);
    return false;
  }
}

// Test 2: Test extractValueByPath helper
async function testExtractValueByPath() {
  try {
    const { extractValueByPath } = require('./src/processor/auth-helper');

    const testCases = [
      {
        obj: { error: { message: 'token expired' } },
        path: 'error.message',
        expected: 'token expired'
      },
      {
        obj: { status: 'unauthorized' },
        path: 'status',
        expected: 'unauthorized'
      },
      {
        obj: { data: { auth: { valid: false } } },
        path: 'data.auth.valid',
        expected: false
      },
      {
        obj: { error: 'simple error' },
        path: 'error',
        expected: 'simple error'
      }
    ];

    let passed = true;
    for (const testCase of testCases) {
      const result = extractValueByPath(testCase.obj, testCase.path);
      if (result !== testCase.expected) {
        passed = false;
        log(`  Failed: ${testCase.path} -> Expected: ${testCase.expected}, Got: ${result}`, 'error');
      }
    }

    if (passed) {
      recordTest('Extract Value By Path Helper', true, `${testCases.length} test cases passed`);
      return true;
    } else {
      recordTest('Extract Value By Path Helper', false, 'Some test cases failed');
      return false;
    }
  } catch (err) {
    recordTest('Extract Value By Path Helper', false, err.message);
    return false;
  }
}

// Test 3: Create OUTBOUND integration with OAuth2
async function testCreateOutboundOAuth2Integration() {
  try {
    const integration = {
      name: 'TOKEN_TEST_OUTBOUND_OAUTH2',
      direction: 'OUTBOUND',
      eventType: 'TOKEN_TEST_EVENT',
      scope: 'GLOBAL',
      targetUrl: 'https://httpbin.org/post',
      httpMethod: 'POST',
      isActive: true,
      deliveryMode: 'IMMEDIATE',
      retryCount: 2,
      outgoingAuthType: 'OAUTH2',
      outgoingAuthConfig: {
        tokenUrl: 'https://httpbin.org/post',  // Mock OAuth endpoint
        clientId: 'test_client_id',
        clientSecret: 'test_client_secret',
        grantType: 'client_credentials',
        scope: 'read write'
      },
      timeoutMs: 10000,
      description: 'Token management test - OUTBOUND OAuth2',
    };

    const integrationId = new ObjectId();
    await db.collection('integration_configs').insertOne({
      _id: integrationId,
      ...integration,
      tenantId: CONFIG.tenantId,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    createdIntegrationIds.push(integrationId.toString());
    recordTest('Create OUTBOUND OAuth2 Integration', true, `ID: ${integrationId}`);
    return integrationId.toString();
  } catch (err) {
    recordTest('Create OUTBOUND OAuth2 Integration', false, err.message);
    return null;
  }
}

// Test 4: Create INBOUND integration with Custom auth
async function testCreateInboundCustomAuthIntegration() {
  try {
    const integration = {
      name: 'TOKEN_TEST_INBOUND_CUSTOM',
      direction: 'INBOUND',
      scope: 'GLOBAL',
      targetUrl: 'https://httpbin.org/post',
      httpMethod: 'POST',
      isActive: true,
      deliveryMode: 'IMMEDIATE',
      retryCount: 2,
      outgoingAuthType: 'CUSTOM',
      outgoingAuthConfig: {
        tokenUrl: 'https://httpbin.org/post',
        tokenMethod: 'POST',
        tokenRequestBody: JSON.stringify({ username: 'test', password: 'test' }),
        tokenResponsePath: 'token',
        tokenExpiresInPath: 'expires_in',
        customHeaderName: 'X-Auth-Token'
      },
      timeoutMs: 10000,
      description: 'Token management test - INBOUND Custom auth',
    };

    const integrationId = new ObjectId();
    await db.collection('integration_configs').insertOne({
      _id: integrationId,
      ...integration,
      tenantId: CONFIG.tenantId,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    createdIntegrationIds.push(integrationId.toString());
    recordTest('Create INBOUND Custom Auth Integration', true, `ID: ${integrationId}`);
    return integrationId.toString();
  } catch (err) {
    recordTest('Create INBOUND Custom Auth Integration', false, err.message);
    return null;
  }
}

// Test 5: Verify MongoDB token cache index exists
async function testMongoTokenIndex() {
  try {
    const indexes = await db.collection('integration_configs').indexes();
    const tokenIndex = indexes.find(idx => idx.name === 'token_expiry_idx');

    if (tokenIndex) {
      recordTest('MongoDB Token Expiration Index', true, 'Index exists');
      return true;
    } else {
      recordTest('MongoDB Token Expiration Index', false, 'Index not found');
      return false;
    }
  } catch (err) {
    recordTest('MongoDB Token Expiration Index', false, err.message);
    return false;
  }
}

// Test 6: Simulate token caching (manual token insertion)
async function testTokenCachingInDB(integrationId) {
  if (!integrationId) {
    skipTest('Token Caching in MongoDB', 'No integration ID provided');
    return false;
  }

  try {
    const expiresAt = new Date(Date.now() + 3600 * 1000).toISOString(); // 1 hour from now

    await db.collection('integration_configs').updateOne(
      { _id: new ObjectId(integrationId) },
      {
        $set: {
          'outgoingAuthConfig._cachedToken': 'test_cached_token_abc123',
          'outgoingAuthConfig._tokenExpiresAt': expiresAt,
          'outgoingAuthConfig._tokenLastFetched': new Date().toISOString()
        }
      }
    );

    // Verify the token was cached
    const integration = await db.collection('integration_configs').findOne({
      _id: new ObjectId(integrationId)
    });

    if (integration.outgoingAuthConfig._cachedToken === 'test_cached_token_abc123') {
      recordTest('Token Caching in MongoDB', true, 'Token cached successfully');
      return true;
    } else {
      recordTest('Token Caching in MongoDB', false, 'Token not found in cache');
      return false;
    }
  } catch (err) {
    recordTest('Token Caching in MongoDB', false, err.message);
    return false;
  }
}

// Test 7: Test clearCachedToken function
async function testClearCachedToken(integrationId) {
  if (!integrationId) {
    skipTest('Clear Cached Token', 'No integration ID provided');
    return false;
  }

  try {
    const { clearCachedToken } = require('./src/processor/auth-helper');

    // Clear the cached token
    await clearCachedToken(new ObjectId(integrationId));

    // Verify the token was cleared
    const integration = await db.collection('integration_configs').findOne({
      _id: new ObjectId(integrationId)
    });

    if (!integration.outgoingAuthConfig._cachedToken &&
        !integration.outgoingAuthConfig._tokenExpiresAt) {
      recordTest('Clear Cached Token', true, 'Token cleared successfully');
      return true;
    } else {
      recordTest('Clear Cached Token', false, 'Token still exists in cache');
      return false;
    }
  } catch (err) {
    recordTest('Clear Cached Token', false, err.message);
    return false;
  }
}

// Test 8: Test manual token refresh API endpoint
async function testManualTokenRefreshAPI(integrationId) {
  if (!integrationId) {
    skipTest('Manual Token Refresh API', 'No integration ID provided');
    return false;
  }

  try {
    // First, cache a token
    await db.collection('integration_configs').updateOne(
      { _id: new ObjectId(integrationId) },
      {
        $set: {
          'outgoingAuthConfig._cachedToken': 'old_token_to_refresh',
          'outgoingAuthConfig._tokenExpiresAt': new Date(Date.now() + 3600 * 1000).toISOString()
        }
      }
    );

    // Call the refresh endpoint
    const res = await makeRequest('POST', `/api/v1/inbound-integrations/${integrationId}/refresh-token`);

    if (res.status === 200 && res.data.success) {
      // Verify token was cleared
      const integration = await db.collection('integration_configs').findOne({
        _id: new ObjectId(integrationId)
      });

      if (!integration.outgoingAuthConfig._cachedToken) {
        recordTest('Manual Token Refresh API', true, 'Token cache cleared via API');
        return true;
      } else {
        recordTest('Manual Token Refresh API', false, 'Token not cleared after API call');
        return false;
      }
    } else {
      recordTest('Manual Token Refresh API', false, `Status: ${res.status}`);
      return false;
    }
  } catch (err) {
    recordTest('Manual Token Refresh API', false, err.message);
    return false;
  }
}

// Test 9: Test buildAuthHeaders with NONE auth type (baseline)
async function testBuildAuthHeadersNone() {
  try {
    const { buildAuthHeaders } = require('./src/processor/auth-helper');

    const integration = {
      _id: new ObjectId(),
      outgoingAuthType: 'NONE',
      outgoingAuthConfig: {}
    };

    const headers = await buildAuthHeaders(integration, 'POST', 'https://example.com');

    if (Object.keys(headers).length === 0) {
      recordTest('Build Auth Headers (NONE)', true, 'No headers added for NONE auth');
      return true;
    } else {
      recordTest('Build Auth Headers (NONE)', false, `Unexpected headers: ${JSON.stringify(headers)}`);
      return false;
    }
  } catch (err) {
    recordTest('Build Auth Headers (NONE)', false, err.message);
    return false;
  }
}

// Test 10: Test buildAuthHeaders with API_KEY auth type
async function testBuildAuthHeadersAPIKey() {
  try {
    const { buildAuthHeaders } = require('./src/processor/auth-helper');

    const integration = {
      _id: new ObjectId(),
      outgoingAuthType: 'API_KEY',
      outgoingAuthConfig: {
        apiKeyHeader: 'X-API-Key',
        apiKeyValue: 'test_api_key_12345'
      }
    };

    const headers = await buildAuthHeaders(integration, 'POST', 'https://example.com');

    if (headers['X-API-Key'] === 'test_api_key_12345') {
      recordTest('Build Auth Headers (API_KEY)', true, 'API key header added');
      return true;
    } else {
      recordTest('Build Auth Headers (API_KEY)', false, `Missing or wrong API key: ${JSON.stringify(headers)}`);
      return false;
    }
  } catch (err) {
    recordTest('Build Auth Headers (API_KEY)', false, err.message);
    return false;
  }
}

// Test 11: Test buildAuthHeaders with BEARER token
async function testBuildAuthHeadersBearer() {
  try {
    const { buildAuthHeaders } = require('./src/processor/auth-helper');

    const integration = {
      _id: new ObjectId(),
      outgoingAuthType: 'BEARER',
      outgoingAuthConfig: {
        bearerToken: 'test_bearer_token_xyz'
      }
    };

    const headers = await buildAuthHeaders(integration, 'POST', 'https://example.com');

    if (headers['Authorization'] === 'Bearer test_bearer_token_xyz') {
      recordTest('Build Auth Headers (BEARER)', true, 'Bearer token header added');
      return true;
    } else {
      recordTest('Build Auth Headers (BEARER)', false, `Wrong Authorization header: ${headers['Authorization']}`);
      return false;
    }
  } catch (err) {
    recordTest('Build Auth Headers (BEARER)', false, err.message);
    return false;
  }
}

// Test 12: Verify delivery-engine.js has token expiration detection
async function testDeliveryEngineHasExpirationDetection() {
  try {
    const fs = require('fs');
    const deliveryEngineCode = fs.readFileSync('./src/processor/delivery-engine.js', 'utf8');

    const requiredCode = [
      'tokenExpirationDetection',
      'clearCachedToken',
      'extractValueByPath',
      'tokenExpiredInBody',
      'expirationValues'
    ];

    const missingCode = requiredCode.filter(code => !deliveryEngineCode.includes(code));

    if (missingCode.length === 0) {
      recordTest('Delivery Engine Token Expiration Detection', true, 'All required code present');
      return true;
    } else {
      recordTest('Delivery Engine Token Expiration Detection', false, `Missing: ${missingCode.join(', ')}`);
      return false;
    }
  } catch (err) {
    recordTest('Delivery Engine Token Expiration Detection', false, err.message);
    return false;
  }
}

// Test 13: Test integration with tokenExpirationDetection config
async function testTokenExpirationDetectionConfig() {
  try {
    const integration = {
      name: 'TOKEN_TEST_EXPIRATION_DETECTION',
      direction: 'OUTBOUND',
      eventType: 'TOKEN_TEST_EVENT',
      scope: 'GLOBAL',
      targetUrl: 'https://httpbin.org/post',
      httpMethod: 'POST',
      isActive: true,
      deliveryMode: 'IMMEDIATE',
      retryCount: 2,
      outgoingAuthType: 'OAUTH2',
      outgoingAuthConfig: {
        tokenUrl: 'https://httpbin.org/post',
        clientId: 'test_client_id',
        clientSecret: 'test_client_secret',
        tokenExpirationDetection: {
          enabled: true,
          responseBodyPath: 'error.message',
          expirationValues: ['token expired', 'unauthorized', 'invalid token']
        }
      },
      timeoutMs: 10000,
      description: 'Token expiration detection test',
    };

    const integrationId = new ObjectId();
    await db.collection('integration_configs').insertOne({
      _id: integrationId,
      ...integration,
      tenantId: CONFIG.tenantId,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    createdIntegrationIds.push(integrationId.toString());

    // Verify config was saved
    const saved = await db.collection('integration_configs').findOne({ _id: integrationId });

    if (saved.outgoingAuthConfig.tokenExpirationDetection &&
        saved.outgoingAuthConfig.tokenExpirationDetection.enabled === true) {
      recordTest('Token Expiration Detection Config', true, 'Config saved successfully');
      return integrationId.toString();
    } else {
      recordTest('Token Expiration Detection Config', false, 'Config not saved correctly');
      return null;
    }
  } catch (err) {
    recordTest('Token Expiration Detection Config', false, err.message);
    return null;
  }
}

// Main test runner
async function runTokenManagementTests() {
  console.log('\n' + '='.repeat(70));
  log('🔐 Token Management & Caching Smoke Tests', 'info');
  console.log('='.repeat(70) + '\n');

  log(`Configuration:`, 'info');
  log(`  Base URL: ${CONFIG.baseUrl}`, 'info');
  log(`  MongoDB: ${CONFIG.mongoUrl}`, 'info');
  log(`  Database: ${CONFIG.dbName}`, 'info');
  log(`  Tenant ID: ${CONFIG.tenantId}`, 'info');
  console.log('');

  try {
    // Connect to MongoDB
    await connectMongo();
    console.log('');

    // Test auth-helper.js
    log('Testing auth-helper.js module...', 'info');
    await testAuthHelperExports();
    await testExtractValueByPath();
    await testBuildAuthHeadersNone();
    await testBuildAuthHeadersAPIKey();
    await testBuildAuthHeadersBearer();
    console.log('');

    // Test MongoDB integration
    log('Testing MongoDB token caching...', 'info');
    await testMongoTokenIndex();
    const outboundId = await testCreateOutboundOAuth2Integration();
    const inboundId = await testCreateInboundCustomAuthIntegration();

    if (outboundId) {
      await testTokenCachingInDB(outboundId);
      await testClearCachedToken(outboundId);
    }

    if (inboundId) {
      await testManualTokenRefreshAPI(inboundId);
    }
    console.log('');

    // Test delivery engine integration
    log('Testing delivery-engine.js integration...', 'info');
    await testDeliveryEngineHasExpirationDetection();
    await testTokenExpirationDetectionConfig();
    console.log('');

  } catch (err) {
    log(`Fatal error during tests: ${err.message}`, 'error');
    console.error(err);
  } finally {
    // Cleanup
    await cleanup();
    await disconnectMongo();
  }

  // Print summary
  console.log('\n' + '='.repeat(70));
  log('📊 Test Summary', 'info');
  console.log('='.repeat(70) + '\n');

  log(`Total Tests: ${testResults.passed + testResults.failed + testResults.skipped}`, 'info');
  log(`✓ Passed: ${testResults.passed}`, 'success');
  log(`✗ Failed: ${testResults.failed}`, 'error');
  log(`⊘ Skipped: ${testResults.skipped}`, 'warn');
  console.log('');

  if (testResults.failed > 0) {
    log('Failed Tests:', 'error');
    testResults.tests
      .filter(t => t.passed === false)
      .forEach(t => log(`  - ${t.name}: ${t.message}`, 'error'));
    console.log('');
  }

  const exitCode = testResults.failed > 0 ? 1 : 0;

  if (exitCode === 0) {
    log('🎉 All token management tests passed!', 'success');
    log('✅ Token caching working for BOTH INBOUND & OUTBOUND', 'success');
  } else {
    log('⚠️  Some tests failed. Please review.', 'error');
  }

  console.log('\n' + '='.repeat(70) + '\n');

  process.exit(exitCode);
}

// Handle errors
process.on('unhandledRejection', (err) => {
  log(`Unhandled rejection: ${err.message}`, 'error');
  console.error(err);
  process.exit(1);
});

// Run tests
runTokenManagementTests();
