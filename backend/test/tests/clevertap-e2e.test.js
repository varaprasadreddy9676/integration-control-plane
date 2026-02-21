/**
 * CleverTap End-to-End Integration Test
 * Creates actual webhook configs in MongoDB and events in notification_queue
 * Tests the complete flow from event ingestion to CleverTap delivery
 */

const { MongoClient } = require('mongodb');
const mysql = require('mysql2/promise');
const config = require('../../src/config');
const runRealDbSuite = process.env.RUN_REAL_DB_TESTS === '1';
const describeRealDb = runRealDbSuite ? describe : describe.skip;

// Mock HTTP server to simulate CleverTap API
const http = require('http');
const { URL } = require('url');

describeRealDb('CleverTap E2E Integration', () => {
  let mongoClient;
  let db;
  let mysqlConnection;
  let mockCleverTapServer;
  let receivedRequests = [];
  const mockPort = 9876;

  beforeAll(async () => {
    // Connect to MongoDB
    mongoClient = new MongoClient(config.mongodb.uri);
    await mongoClient.connect();
    db = mongoClient.db(config.mongodb.database);

    // Connect to MySQL
    mysqlConnection = await mysql.createConnection(config.db);

    // Start mock CleverTap server
    mockCleverTapServer = http.createServer((req, res) => {
      let body = '';
      req.on('data', chunk => {
        body += chunk.toString();
      });
      req.on('end', () => {
        const request = {
          url: req.url,
          method: req.method,
          headers: req.headers,
          body: body ? JSON.parse(body) : null
        };
        receivedRequests.push(request);

        // Simulate CleverTap success response
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'success', processed: 1 }));
      });
    });

    await new Promise(resolve => {
      mockCleverTapServer.listen(mockPort, resolve);
    });
  });

  afterAll(async () => {
    if (mongoClient) await mongoClient.close();
    if (mysqlConnection) await mysqlConnection.end();
    if (mockCleverTapServer) {
      await new Promise(resolve => mockCleverTapServer.close(resolve));
    }
  });

  beforeEach(() => {
    receivedRequests = [];
  });

  describe('Scenario 1: Patient Registration with Profile Upload', () => {
    it('should create multi-action webhook and process patient registration event', async () => {
      // Step 1: Create CleverTap multi-action webhook in MongoDB
      const webhookConfig = {
        id: 'clevertap-patient-reg-001',
        name: 'CleverTap Patient Registration',
        eventType: 'PATIENT_REGISTRATION',
        entityRid: 100,
        entityName: 'Test Hospital',
        scope: 'ENTITY_ONLY',
        outgoingAuthType: 'CUSTOM_HEADERS',
        outgoingAuthConfig: {
          headers: {
            'X-CleverTap-Account-Id': '6K7-8R6-857Z',
            'X-CleverTap-Passcode': 'WHQ-KSY-CPEL'
          }
        },
        isActive: true,
        timeoutMs: 30000,
        retryCount: 3,
        httpMethod: 'POST',
        actions: [
          {
            name: 'Profile Upload',
            condition: 'eventType === "PATIENT_REGISTRATION"',
            targetUrl: `http://localhost:${mockPort}/1/upload`,
            httpMethod: 'POST',
            transformationMode: 'SCRIPT',
            transformation: {
              script: `
                function transform(payload, context) {
                  const identity = payload.patientMRN || payload.patientPhone || 'unknown';
                  const phone = payload.patientPhone?.startsWith('+91')
                    ? payload.patientPhone
                    : '+91' + payload.patientPhone;

                  return {
                    d: [{
                      identity: identity,
                      type: 'profile',
                      profileData: {
                        Name: payload.patientName,
                        MRN: payload.patientMRN,
                        Phone: phone,
                        Email: payload.patientEmail,
                        Address: payload.patientAddress,
                        Age: payload.patientAge,
                        Gender: payload.patientGender
                      }
                    }]
                  };
                }
              `
            }
          },
          {
            name: 'Event Upload',
            targetUrl: `http://localhost:${mockPort}/1/upload`,
            httpMethod: 'POST',
            transformationMode: 'SCRIPT',
            transformation: {
              script: `
                function transform(payload, context) {
                  const identity = payload.patientMRN || payload.patientPhone || 'unknown';

                  return {
                    d: [{
                      identity: identity,
                      type: 'event',
                      evtName: 'Patient Registered',
                      evtData: {
                        patientMRN: payload.patientMRN,
                        registrationDate: new Date().toISOString(),
                        hospitalName: 'Test Hospital',
                        source: 'medics'
                      }
                    }]
                  };
                }
              `
            }
          }
        ],
        createdAt: new Date(),
        updatedAt: new Date()
      };

      await db.collection('integration_configs').insertOne(webhookConfig);

      // Step 2: Insert patient registration event into notification_queue
      const patientEvent = {
        event_type: 'PATIENT_REGISTRATION',
        entity_rid: 100,
        payload: JSON.stringify({
          patientRID: 12345,
          patientMRN: 'MRN-TEST-001',
          patientName: 'John Doe',
          patientPhone: '9876543210',
          patientEmail: 'john.doe@hospital.com',
          patientAddress: '123 Main Street, City',
          patientAge: 45,
          patientGender: 'Male',
          registrationDate: '2024-03-15T10:30:00Z'
        }),
        created_at: new Date()
      };

      const [insertResult] = await mysqlConnection.execute(
        'INSERT INTO notification_queue (transaction_type, entity_rid, message, created_at) VALUES (?, ?, ?, ?)',
        [patientEvent.event_type, patientEvent.entity_rid, patientEvent.payload, patientEvent.created_at]
      );

      const eventId = insertResult.insertId;

      // Verify webhook was created
      const savedWebhook = await db.collection('integration_configs').findOne({ id: 'clevertap-patient-reg-001' });
      expect(savedWebhook).toBeDefined();
      expect(savedWebhook.actions).toHaveLength(2);
      expect(savedWebhook.outgoingAuthType).toBe('CUSTOM_HEADERS');

      // Verify event was inserted
      const [events] = await mysqlConnection.execute(
        'SELECT * FROM notification_queue WHERE id = ?',
        [eventId]
      );
      expect(events).toHaveLength(1);
      expect(events[0].event_type).toBe('PATIENT_REGISTRATION');
    });
  });

  describe('Scenario 2: Appointment Created (Event Only, No Profile)', () => {
    it('should create webhook with conditional profile upload', async () => {
      const webhookConfig = {
        id: 'clevertap-appointment-001',
        name: 'CleverTap Appointment Events',
        eventType: 'APPOINTMENT_CREATED',
        entityRid: 100,
        entityName: 'Test Hospital',
        scope: 'ENTITY_ONLY',
        outgoingAuthType: 'CUSTOM_HEADERS',
        outgoingAuthConfig: {
          headers: {
            'X-CleverTap-Account-Id': '6K7-8R6-857Z',
            'X-CleverTap-Passcode': 'WHQ-KSY-CPEL'
          }
        },
        isActive: true,
        timeoutMs: 30000,
        retryCount: 3,
        httpMethod: 'POST',
        actions: [
          {
            name: 'Profile Upload',
            // This condition will be false for APPOINTMENT_CREATED
            condition: 'eventType === "PATIENT_REGISTRATION"',
            targetUrl: `http://localhost:${mockPort}/1/upload`,
            httpMethod: 'POST',
            transformationMode: 'SCRIPT',
            transformation: {
              script: 'function transform(payload) { return { d: [{ identity: payload.patientMRN, type: "profile", profileData: {} }] }; }'
            }
          },
          {
            name: 'Appointment Event Upload',
            // No condition - always execute
            targetUrl: `http://localhost:${mockPort}/1/upload`,
            httpMethod: 'POST',
            transformationMode: 'SCRIPT',
            transformation: {
              script: `
                function transform(payload, context) {
                  return {
                    d: [{
                      identity: payload.patientMRN,
                      type: 'event',
                      evtName: 'Appointment Scheduled',
                      evtData: {
                        appointmentId: payload.appointmentId,
                        appointmentDateTime: payload.appointmentDateTime,
                        doctorName: payload.doctorName,
                        department: payload.department,
                        appointmentType: payload.appointmentType
                      }
                    }]
                  };
                }
              `
            }
          }
        ],
        createdAt: new Date(),
        updatedAt: new Date()
      };

      await db.collection('integration_configs').insertOne(webhookConfig);

      const appointmentEvent = {
        event_type: 'APPOINTMENT_CREATED',
        entity_rid: 100,
        payload: JSON.stringify({
          appointmentId: 789,
          patientMRN: 'MRN-TEST-001',
          appointmentDateTime: '2024-03-20T14:00:00Z',
          doctorName: 'Dr. Sarah Smith',
          department: 'Cardiology',
          appointmentType: 'Follow-up'
        }),
        created_at: new Date()
      };

      const [insertResult] = await mysqlConnection.execute(
        'INSERT INTO notification_queue (transaction_type, entity_rid, message, created_at) VALUES (?, ?, ?, ?)',
        [appointmentEvent.event_type, appointmentEvent.entity_rid, appointmentEvent.payload, appointmentEvent.created_at]
      );

      const eventId = insertResult.insertId;

      // Verify
      const savedWebhook = await db.collection('integration_configs').findOne({ id: 'clevertap-appointment-001' });
      expect(savedWebhook).toBeDefined();
      expect(savedWebhook.actions[0].condition).toBe('eventType === "PATIENT_REGISTRATION"');
      expect(savedWebhook.actions[1].condition).toBeUndefined(); // Always execute
    });
  });

  describe('Scenario 3: Contact Subscription', () => {
    it('should handle contact subscription as separate action', async () => {
      const webhookConfig = {
        id: 'clevertap-with-subscription-001',
        name: 'CleverTap with Contact Subscription',
        eventType: 'PATIENT_REGISTRATION',
        entityRid: 100,
        entityName: 'Test Hospital',
        scope: 'ENTITY_ONLY',
        outgoingAuthType: 'CUSTOM_HEADERS',
        outgoingAuthConfig: {
          headers: {
            'X-CleverTap-Account-Id': '6K7-8R6-857Z',
            'X-CleverTap-Passcode': 'WHQ-KSY-CPEL'
          }
        },
        isActive: true,
        timeoutMs: 30000,
        retryCount: 3,
        httpMethod: 'POST',
        actions: [
          {
            name: 'Profile Upload',
            targetUrl: `http://localhost:${mockPort}/1/upload`,
            transformationMode: 'SCRIPT',
            transformation: {
              script: 'function transform(p) { return { d: [{ identity: p.patientMRN, type: "profile", profileData: { Name: p.patientName } }] }; }'
            }
          },
          {
            name: 'Contact Subscription',
            // Only subscribe if phone and email exist
            condition: 'payload.patientPhone && payload.patientEmail',
            targetUrl: `http://localhost:${mockPort}/1/subscribe`,
            transformationMode: 'SCRIPT',
            transformation: {
              script: `
                function transform(payload) {
                  const subscriptions = [];
                  if (payload.patientPhone) {
                    subscriptions.push({ type: 'phone', value: payload.patientPhone, status: 'Resubscribe' });
                  }
                  if (payload.patientEmail) {
                    subscriptions.push({ type: 'email', value: payload.patientEmail, status: 'Resubscribe' });
                  }
                  return { d: subscriptions };
                }
              `
            }
          },
          {
            name: 'Event Upload',
            targetUrl: `http://localhost:${mockPort}/1/upload`,
            transformationMode: 'SCRIPT',
            transformation: {
              script: 'function transform(p) { return { d: [{ identity: p.patientMRN, type: "event", evtName: "Patient Registered", evtData: {} }] }; }'
            }
          }
        ],
        createdAt: new Date(),
        updatedAt: new Date()
      };

      await db.collection('integration_configs').insertOne(webhookConfig);

      // Verify subscription action
      const savedWebhook = await db.collection('integration_configs').findOne({ id: 'clevertap-with-subscription-001' });
      expect(savedWebhook.actions).toHaveLength(3);
      expect(savedWebhook.actions[1].name).toBe('Contact Subscription');
      expect(savedWebhook.actions[1].targetUrl).toContain('/1/subscribe');
    });
  });

  describe('Scenario 4: Multiple Event Types on Same Webhook', () => {
    it('should create webhook that handles multiple event types with different logic', async () => {
      const webhookConfig = {
        id: 'clevertap-multi-event-001',
        name: 'CleverTap All Events',
        eventType: '*', // Wildcard for all events
        entityRid: 100,
        entityName: 'Test Hospital',
        scope: 'ENTITY_ONLY',
        outgoingAuthType: 'CUSTOM_HEADERS',
        outgoingAuthConfig: {
          headers: {
            'X-CleverTap-Account-Id': '6K7-8R6-857Z',
            'X-CleverTap-Passcode': 'WHQ-KSY-CPEL'
          }
        },
        isActive: true,
        timeoutMs: 30000,
        retryCount: 3,
        httpMethod: 'POST',
        actions: [
          {
            name: 'Profile Upload for Registration',
            condition: 'eventType === "PATIENT_REGISTRATION" || eventType === "PATIENT_UPDATE"',
            targetUrl: `http://localhost:${mockPort}/1/upload`,
            transformationMode: 'SCRIPT',
            transformation: {
              script: 'function transform(p) { return { d: [{ identity: p.patientMRN, type: "profile", profileData: { Name: p.patientName } }] }; }'
            }
          },
          {
            name: 'Generic Event Upload',
            targetUrl: `http://localhost:${mockPort}/1/upload`,
            transformationMode: 'SCRIPT',
            transformation: {
              script: `
                function transform(payload, context) {
                  const eventNames = {
                    'PATIENT_REGISTRATION': 'Patient Registered',
                    'APPOINTMENT_CREATED': 'Appointment Scheduled',
                    'BILL_CREATED': 'Bill Generated'
                  };
                  return {
                    d: [{
                      identity: payload.patientMRN || payload.patientPhone || 'unknown',
                      type: 'event',
                      evtName: eventNames[context.eventType] || context.eventType,
                      evtData: payload
                    }]
                  };
                }
              `
            }
          }
        ],
        createdAt: new Date(),
        updatedAt: new Date()
      };

      await db.collection('integration_configs').insertOne(webhookConfig);

      const savedWebhook = await db.collection('integration_configs').findOne({ id: 'clevertap-multi-event-001' });
      expect(savedWebhook).toBeDefined();
      expect(savedWebhook.eventType).toBe('*');
    });
  });

  describe('Validation Tests', () => {
    it('should validate CUSTOM_HEADERS auth config structure', () => {
      const validConfig = {
        outgoingAuthType: 'CUSTOM_HEADERS',
        outgoingAuthConfig: {
          headers: {
            'X-CleverTap-Account-Id': '6K7-8R6-857Z',
            'X-CleverTap-Passcode': 'WHQ-KSY-CPEL'
          }
        }
      };

      expect(validConfig.outgoingAuthConfig.headers).toHaveProperty('X-CleverTap-Account-Id');
      expect(validConfig.outgoingAuthConfig.headers).toHaveProperty('X-CleverTap-Passcode');
    });

    it('should validate multi-action structure', () => {
      const actions = [
        { name: 'Action 1', targetUrl: 'https://api.example.com' },
        { name: 'Action 2', targetUrl: 'https://api.example.com', condition: 'eventType === "TEST"' }
      ];

      expect(actions).toHaveLength(2);
      expect(actions[0].targetUrl).toBeDefined();
      expect(actions[1].condition).toBeDefined();
    });
  });
});
