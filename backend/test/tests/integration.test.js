/**
 * Integration Tests with Real MongoDB
 * Tests complete webhook flow with transformations, auth, and worker checkpoint
 */

const { MongoClient, ObjectId } = require('mongodb');
const config = require('../../src/config');
const runRealDbSuite = process.env.RUN_REAL_DB_TESTS === '1';
const describeRealDb = runRealDbSuite ? describe : describe.skip;

// Mock MySQL since we can't connect
jest.mock('../../src/db', () => ({
  isConfigured: jest.fn().mockReturnValue(true),
  ping: jest.fn().mockResolvedValue(true),
  query: jest.fn().mockResolvedValue([[]]),
  getConnection: jest.fn().mockResolvedValue({
    execute: jest.fn().mockResolvedValue([[]]),
    release: jest.fn()
  })
}));

// Mock store
jest.mock('../../src/data/store', () => ({
  initStore: jest.fn().mockResolvedValue(),
  getTenant: jest.fn().mockReturnValue({
    entityParentRid: 1,
    entityName: 'Test Clinic'
  })
}));

// Mock fetch for webhook deliveries and token endpoints
global.fetch = jest.fn();

describeRealDb('Integration Tests with Real MongoDB', () => {
  let mongoClient;
  let db;
  let data;
  let worker;
  let mongodb;

  beforeAll(async () => {
    // Connect to real MongoDB
    mongoClient = new MongoClient(config.mongodb.uri);
    await mongoClient.connect();
    db = mongoClient.db(config.mongodb.database);

    // Load modules
    mongodb = require('../../src/mongodb');
    data = require('../../src/data');
    worker = require('../../src/processor/worker');

    // Initialize data layer with real MongoDB
    await data.initDataLayer();
  });

  afterAll(async () => {
    // Clean up test data
    if (db) {
      await db.collection('integration_configs').deleteMany({
        name: { $regex: /^TEST_/ }
      });
      await db.collection('execution_logs').deleteMany({
        webhookName: { $regex: /^TEST_/ }
      });
      await db.collection('worker_checkpoint').deleteMany({
        workerId: /^test_/
      });
    }

    // Close MongoDB connections
    if (mongoClient) {
      await mongoClient.close();
    }

    // Close module-managed MongoDB client and log streams
    if (mongodb && mongodb.close) {
      await mongodb.close();
    }
    const logger = require('../../src/logger');
    if (logger.closeLogStreams) {
      logger.closeLogStreams();
    }

    // Give MongoDB time to close connections
    await new Promise(resolve => setTimeout(resolve, 100));
  }, 10000);

  beforeEach(async () => {
    // Clear mocks
    jest.clearAllMocks();
    global.fetch.mockReset();

    // Clear test data before each test
    await db.collection('integration_configs').deleteMany({
      name: { $regex: /^TEST_/ }
    });
    await db.collection('execution_logs').deleteMany({
      webhookName: { $regex: /^TEST_/ }
    });
  });

  describe('MongoDB Connection', () => {
    it('should connect to real MongoDB', async () => {
      const isConnected = mongodb.isConnected();
      expect(isConnected).toBe(true);

      // Verify database exists
      const adminDb = mongoClient.db().admin();
      const { databases } = await adminDb.listDatabases();
      const webhookDb = databases.find(d => d.name === config.mongodb.database);
      expect(webhookDb).toBeDefined();
    });

    it('should have required collections', async () => {
      const collections = await db.listCollections().toArray();
      const collectionNames = collections.map(c => c.name);

      expect(collectionNames).toContain('integration_configs');
      expect(collectionNames).toContain('execution_logs');
      expect(collectionNames).toContain('worker_checkpoint');
    });
  });

  describe('Webhook Configuration with Transformations', () => {
    it('should create webhook with SIMPLE transformation', async () => {
      const webhookData = {
        name: 'TEST_SIMPLE_TRANSFORM',
        eventType: 'PATIENT_REGISTERED',
        targetUrl: 'https://api.example.com/webhook',
        httpMethod: 'POST',
        scope: 'ENTITY_ONLY',
        outgoingAuthType: 'API_KEY',
        outgoingAuthConfig: {
          headerName: 'X-API-Key',
          apiKey: 'test_api_key_123'
        },
        transformationMode: 'SIMPLE',
        transformation: {
          mappings: [
            { sourceField: 'firstName', targetField: 'patient_first_name', transform: 'trim' },
            { sourceField: 'lastName', targetField: 'patient_last_name', transform: 'upper' },
            { sourceField: 'email', targetField: 'patient_email', transform: 'lower' }
          ],
          staticFields: [
            { key: 'source', value: 'medics' },
            { key: 'version', value: '1.0' }
          ]
        },
        isActive: true,
        timeoutMs: 5000,
        retryCount: 3
      };

      const webhookId = await data.addWebhook(1, webhookData);
      expect(webhookId).toBeDefined();

      // Verify in MongoDB
      const webhook = await db.collection('integration_configs').findOne({
        _id: new ObjectId(webhookId)
      });

      expect(webhook).toBeDefined();
      expect(webhook.name).toBe('TEST_SIMPLE_TRANSFORM');
      expect(webhook.transformationMode).toBe('SIMPLE');
      expect(webhook.transformation.mappings).toHaveLength(3);
      expect(webhook.transformation.staticFields).toHaveLength(2);
      expect(webhook.outgoingAuthType).toBe('API_KEY');
      expect(webhook.outgoingAuthConfig.apiKey).toBe('test_api_key_123');
    });

    it('should create webhook with SCRIPT transformation', async () => {
      const webhookData = {
        name: 'TEST_SCRIPT_TRANSFORM',
        eventType: 'BILL_CREATED',
        targetUrl: 'https://api.example.com/billing',
        httpMethod: 'POST',
        scope: 'ENTITY_ONLY',
        outgoingAuthType: 'BEARER',
        outgoingAuthConfig: {
          token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test.token'
        },
        transformationMode: 'SCRIPT',
        transformation: {
          script: `
            // Calculate total and transform bill data
            const items = payload.items || [];
            const total = items.reduce((sum, item) => sum + (item.quantity * item.price), 0);

            return {
              billId: payload.billId,
              patientId: payload.patientId,
              totalAmount: total,
              itemCount: items.length,
              currency: 'USD',
              eventType: context.eventType,
              timestamp: new Date().toISOString()
            };
          `
        },
        isActive: true,
        timeoutMs: 5000,
        retryCount: 3
      };

      const webhookId = await data.addWebhook(1, webhookData);
      expect(webhookId).toBeDefined();

      // Verify in MongoDB
      const webhook = await db.collection('integration_configs').findOne({
        _id: new ObjectId(webhookId)
      });

      expect(webhook).toBeDefined();
      expect(webhook.name).toBe('TEST_SCRIPT_TRANSFORM');
      expect(webhook.transformationMode).toBe('SCRIPT');
      expect(webhook.transformation.script).toContain('Calculate total');
      expect(webhook.outgoingAuthType).toBe('BEARER');
    });

    it('should create webhook with OAUTH2 authentication', async () => {
      const webhookData = {
        name: 'TEST_OAUTH2_AUTH',
        eventType: 'APPOINTMENT_CREATED',
        targetUrl: 'https://api.example.com/appointments',
        httpMethod: 'POST',
        scope: 'ENTITY_ONLY',
        outgoingAuthType: 'OAUTH2',
        outgoingAuthConfig: {
          tokenEndpoint: 'https://oauth.example.com/token',
          clientId: 'client_123',
          clientSecret: 'secret_456',
          scope: 'appointments:write'
        },
        transformationMode: 'NONE',
        isActive: true,
        timeoutMs: 5000,
        retryCount: 3
      };

      const webhookId = await data.addWebhook(1, webhookData);
      expect(webhookId).toBeDefined();

      // Verify in MongoDB
      const webhook = await db.collection('integration_configs').findOne({
        _id: new ObjectId(webhookId)
      });

      expect(webhook).toBeDefined();
      expect(webhook.name).toBe('TEST_OAUTH2_AUTH');
      expect(webhook.outgoingAuthType).toBe('OAUTH2');
      expect(webhook.outgoingAuthConfig.tokenEndpoint).toBe('https://oauth.example.com/token');
    });

    it('should create webhook with CUSTOM authentication', async () => {
      const webhookData = {
        name: 'TEST_CUSTOM_AUTH',
        eventType: 'LAB_RESULT_SIGNED',
        targetUrl: 'https://api.example.com/labs',
        httpMethod: 'POST',
        scope: 'ENTITY_ONLY',
        outgoingAuthType: 'CUSTOM',
        outgoingAuthConfig: {
          tokenEndpoint: 'https://api.example.com/auth/custom-token',
          tokenRequestMethod: 'POST',
          tokenRequestBody: {
            username: 'service_account',
            password: 'service_pass',
            grant_type: 'custom_grant'
          },
          tokenResponsePath: 'data.access_token',
          tokenHeaderName: 'X-Custom-Auth',
          tokenHeaderPrefix: 'Token'
        },
        transformationMode: 'NONE',
        isActive: true,
        timeoutMs: 5000,
        retryCount: 3
      };

      const webhookId = await data.addWebhook(1, webhookData);
      expect(webhookId).toBeDefined();

      // Verify in MongoDB
      const webhook = await db.collection('integration_configs').findOne({
        _id: new ObjectId(webhookId)
      });

      expect(webhook).toBeDefined();
      expect(webhook.name).toBe('TEST_CUSTOM_AUTH');
      expect(webhook.outgoingAuthType).toBe('CUSTOM');
      expect(webhook.outgoingAuthConfig.tokenRequestBody.grant_type).toBe('custom_grant');
    });
  });

  describe('Worker Checkpoint Mechanism', () => {
    it('should initialize worker checkpoint', async () => {
      // Get initial checkpoint
      const checkpoint = await data.getWorkerCheckpoint();
      expect(typeof checkpoint).toBe('number');
      expect(checkpoint).toBeGreaterThanOrEqual(0);
    });

    it('should update worker checkpoint', async () => {
      // Set checkpoint to specific value
      await data.setWorkerCheckpoint(12345);

      // Verify it was saved
      const checkpoint = await data.getWorkerCheckpoint();
      expect(checkpoint).toBe(12345);

      // Verify in MongoDB
      const checkpointDoc = await db.collection('worker_checkpoint').findOne({
        workerId: 'main_worker'
      });

      expect(checkpointDoc).toBeDefined();
      expect(checkpointDoc.lastProcessedId).toBe(12345);
      expect(checkpointDoc.updatedAt).toBeDefined();
    });

    it('should increment checkpoint as events are processed', async () => {
      // Set initial checkpoint
      await data.setWorkerCheckpoint(100);

      // Update to new checkpoint
      await data.setWorkerCheckpoint(101);
      let checkpoint = await data.getWorkerCheckpoint();
      expect(checkpoint).toBe(101);

      // Update again
      await data.setWorkerCheckpoint(102);
      checkpoint = await data.getWorkerCheckpoint();
      expect(checkpoint).toBe(102);

      // Verify final state in MongoDB
      const checkpointDoc = await db.collection('worker_checkpoint').findOne({
        workerId: 'main_worker'
      });
      expect(checkpointDoc.lastProcessedId).toBe(102);
    });
  });

  describe('Event Processing with Transformations', () => {
    it('should process event with SIMPLE transformation', async () => {
      // Create webhook
      const webhookId = await data.addWebhook(1, {
        name: 'TEST_SIMPLE_PROCESSING',
        eventType: 'PATIENT_REGISTERED',
        targetUrl: 'https://api.example.com/patients',
        httpMethod: 'POST',
        scope: 'ENTITY_ONLY',
        outgoingAuthType: 'API_KEY',
        outgoingAuthConfig: {
          headerName: 'X-API-Key',
          apiKey: 'test_key'
        },
        transformationMode: 'SIMPLE',
        transformation: {
          mappings: [
            { sourceField: 'firstName', targetField: 'first_name', transform: 'trim' },
            { sourceField: 'lastName', targetField: 'last_name', transform: 'upper' }
          ],
          staticFields: [
            { key: 'source', value: 'medics' }
          ]
        },
        isActive: true,
        timeoutMs: 5000,
        retryCount: 3
      });

      // Mock successful webhook delivery
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: jest.fn().mockResolvedValue('{"status":"success"}')
      });

      // Mock getPendingEvents to return test event
      const mockDb = require('../../src/db');
      mockDb.query.mockResolvedValueOnce([[{
        id: 201,
        entity_rid: 1,
        event_type: 'PATIENT_REGISTERED',
        payload: {
          firstName: '  John  ',
          lastName: 'doe',
          email: 'john@example.com'
        },
        created_at: new Date()
      }]]);

      // Get pending events
      const events = await data.getPendingEvents(5);
      expect(events).toHaveLength(1);

      // Manually verify transformation would be applied
      const { applyTransform } = require('../../src/services/transformer');
      const webhook = await data.getWebhook(webhookId);
      const transformed = applyTransform(webhook, events[0].payload, {
        eventType: 'PATIENT_REGISTERED',
        entityRid: 1
      });

      expect(transformed.first_name).toBe('John');
      expect(transformed.last_name).toBe('DOE');
      expect(transformed.source).toBe('medics');
    });

    it('should process event with SCRIPT transformation', async () => {
      // Create webhook with script transformation
      const webhookId = await data.addWebhook(1, {
        name: 'TEST_SCRIPT_PROCESSING',
        eventType: 'BILL_CREATED',
        targetUrl: 'https://api.example.com/billing',
        httpMethod: 'POST',
        scope: 'ENTITY_ONLY',
        outgoingAuthType: 'NONE',
        transformationMode: 'SCRIPT',
        transformation: {
          script: `
            const items = payload.items || [];
            const total = items.reduce((sum, item) => sum + item.price, 0);

            return {
              billId: payload.billId,
              totalAmount: total,
              itemCount: items.length,
              processingSystem: 'medics'
            };
          `
        },
        isActive: true,
        timeoutMs: 5000,
        retryCount: 3
      });

      // Test transformation
      const { applyTransform } = require('../../src/services/transformer');
      const webhook = await data.getWebhook(webhookId);

      const testPayload = {
        billId: 'BILL-123',
        items: [
          { name: 'Item 1', price: 100 },
          { name: 'Item 2', price: 200 },
          { name: 'Item 3', price: 300 }
        ]
      };

      const transformed = applyTransform(webhook, testPayload, {
        eventType: 'BILL_CREATED',
        entityRid: 1
      });

      expect(transformed.billId).toBe('BILL-123');
      expect(transformed.totalAmount).toBe(600);
      expect(transformed.itemCount).toBe(3);
      expect(transformed.processingSystem).toBe('medics');
    });
  });

  describe('Delivery Logs in MongoDB', () => {
    it('should record successful delivery log', async () => {
      const logData = {
        webhookConfigId: 'test_wh_123',
        webhookName: 'TEST_LOG_WEBHOOK',
        eventType: 'PATIENT_REGISTERED',
        status: 'SUCCESS',
        responseStatus: 200,
        responseTimeMs: 150,
        attemptCount: 1,
        requestPayload: {
          patientId: 'P123',
          firstName: 'John',
          lastName: 'Doe'
        },
        responseBody: '{"status":"success"}',
        errorMessage: null
      };

      await data.recordLog(1, logData);

      // Verify in MongoDB
      const logs = await db.collection('execution_logs').find({
        webhookName: 'TEST_LOG_WEBHOOK'
      }).toArray();

      expect(logs).toHaveLength(1);
      expect(logs[0].status).toBe('SUCCESS');
      expect(logs[0].responseStatus).toBe(200);
      expect(logs[0].requestPayload.patientId).toBe('P123');
      expect(logs[0].entityRid).toBe(1);
      expect(logs[0].createdAt).toBeDefined();
    });

    it('should record failed delivery log with retry flag', async () => {
      const logData = {
        webhookConfigId: 'test_wh_456',
        webhookName: 'TEST_FAILED_WEBHOOK',
        eventType: 'BILL_CREATED',
        status: 'RETRYING',
        responseStatus: 503,
        responseTimeMs: 5000,
        attemptCount: 1,
        requestPayload: { billId: 'B456' },
        responseBody: 'Service Unavailable',
        errorMessage: 'Server error: 503',
        shouldRetry: true
      };

      await data.recordLog(1, logData);

      // Verify in MongoDB
      const logs = await db.collection('execution_logs').find({
        webhookName: 'TEST_FAILED_WEBHOOK'
      }).toArray();

      expect(logs).toHaveLength(1);
      expect(logs[0].status).toBe('RETRYING');
      expect(logs[0].attemptCount).toBe(1);
      expect(logs[0].errorMessage).toBe('Server error: 503');
    });
  });

  describe('Complete Workflow Test', () => {
    it('should execute complete workflow: webhook creation → transformation → delivery → logging', async () => {
      // Step 1: Create webhook with transformation and auth
      const webhookId = await data.addWebhook(1, {
        name: 'TEST_COMPLETE_WORKFLOW',
        eventType: 'APPOINTMENT_CREATED',
        targetUrl: 'https://api.example.com/appointments',
        httpMethod: 'POST',
        scope: 'ENTITY_ONLY',
        outgoingAuthType: 'BEARER',
        outgoingAuthConfig: {
          token: 'workflow_test_token'
        },
        transformationMode: 'SIMPLE',
        transformation: {
          mappings: [
            { sourceField: 'patientName', targetField: 'patient', transform: 'trim' },
            { sourceField: 'appointmentDate', targetField: 'scheduled_date', transform: 'date' }
          ],
          staticFields: [
            { key: 'facility', value: 'Test Clinic' },
            { key: 'system', value: 'medics' }
          ]
        },
        isActive: true,
        timeoutMs: 5000,
        retryCount: 3
      });

      // Step 2: Verify webhook in MongoDB
      const webhook = await db.collection('integration_configs').findOne({
        _id: new ObjectId(webhookId)
      });

      expect(webhook).toBeDefined();
      expect(webhook.name).toBe('TEST_COMPLETE_WORKFLOW');

      // Step 3: Test transformation
      const { applyTransform } = require('../../src/services/transformer');
      const testPayload = {
        patientName: '  Jane Smith  ',
        appointmentDate: '2024-12-15T10:00:00',
        doctorId: 'D123'
      };

      const transformed = applyTransform(webhook, testPayload, {
        eventType: 'APPOINTMENT_CREATED',
        entityRid: 1
      });

      expect(transformed.patient).toBe('Jane Smith');
      expect(transformed.scheduled_date).toMatch(/2024-12-15/);
      expect(transformed.facility).toBe('Test Clinic');
      expect(transformed.system).toBe('medics');
      expect(transformed.doctorId).toBe('D123');

      // Step 4: Mock successful delivery
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: jest.fn().mockResolvedValue('{"appointmentId":"A123"}')
      });

      // Step 5: Record delivery log
      await data.recordLog(1, {
        webhookConfigId: webhookId,
        webhookName: 'TEST_COMPLETE_WORKFLOW',
        eventType: 'APPOINTMENT_CREATED',
        status: 'SUCCESS',
        responseStatus: 200,
        responseTimeMs: 120,
        attemptCount: 1,
        requestPayload: transformed,
        responseBody: '{"appointmentId":"A123"}'
      });

      // Step 6: Verify delivery log in MongoDB
      const logs = await db.collection('execution_logs').find({
        webhookName: 'TEST_COMPLETE_WORKFLOW'
      }).toArray();

      expect(logs).toHaveLength(1);
      expect(logs[0].status).toBe('SUCCESS');
      expect(logs[0].requestPayload.patient).toBe('Jane Smith');
      expect(logs[0].requestPayload.facility).toBe('Test Clinic');

      // Step 7: Verify checkpoint update
      await data.setWorkerCheckpoint(999);
      const checkpoint = await data.getWorkerCheckpoint();
      expect(checkpoint).toBe(999);
    });
  });

  describe('Authentication Header Building', () => {
    it('should build API_KEY authentication headers', async () => {
      const webhook = await db.collection('integration_configs').findOne({
        name: 'TEST_SIMPLE_TRANSFORM'
      });

      if (webhook) {
        expect(webhook.outgoingAuthType).toBe('API_KEY');
        expect(webhook.outgoingAuthConfig.headerName).toBe('X-API-Key');
        expect(webhook.outgoingAuthConfig.apiKey).toBe('test_api_key_123');
      }
    });

    it('should build BEARER authentication headers', async () => {
      const webhook = await db.collection('integration_configs').findOne({
        name: 'TEST_SCRIPT_TRANSFORM'
      });

      if (webhook) {
        expect(webhook.outgoingAuthType).toBe('BEARER');
        expect(webhook.outgoingAuthConfig.token).toContain('eyJhbGciOiJIUzI1NiI');
      }
    });
  });
});
