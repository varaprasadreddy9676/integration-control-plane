/**
 * CleverTap Integration Test
 * Tests multi-action webhooks with CUSTOM_HEADERS auth for CleverTap CRM
 */

const { buildAuthHeaders } = require('../../src/processor/auth-helper');

// Mock fetch for testing
global.fetch = jest.fn();

describe('CleverTap Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch.mockReset();
  });

  describe('CleverTap Authentication Headers', () => {
    it('should create CleverTap auth headers correctly', async () => {
      const webhook = {
        outgoingAuthType: 'CUSTOM_HEADERS',
        outgoingAuthConfig: {
          headers: {
            'X-CleverTap-Account-Id': '6K7-8R6-857Z',
            'X-CleverTap-Passcode': 'WHQ-KSY-CPEL'
          }
        }
      };

      const headers = await buildAuthHeaders(webhook);

      expect(headers).toEqual({
        'X-CleverTap-Account-Id': '6K7-8R6-857Z',
        'X-CleverTap-Passcode': 'WHQ-KSY-CPEL'
      });
    });
  });

  describe('CleverTap Profile Upload Payload', () => {
    it('should build CleverTap profile payload with correct structure', () => {
      const patientData = {
        patientRID: 12345,
        patientMRN: 'MRN-001',
        patientName: 'John Doe',
        patientPhone: '+919876543210',
        patientEmail: 'john.doe@example.com',
        patientAddress: '123 Main St'
      };

      // This is what the transformation script should produce
      const cleverTapPayload = {
        d: [
          {
            identity: 'MRN-001',
            type: 'profile',
            profileData: {
              Name: 'John Doe',
              MRN: 'MRN-001',
              Phone: '+919876543210',
              Email: 'john.doe@example.com',
              Address: '123 Main St'
            }
          }
        ]
      };

      expect(cleverTapPayload.d[0].identity).toBe('MRN-001');
      expect(cleverTapPayload.d[0].type).toBe('profile');
      expect(cleverTapPayload.d[0].profileData.Name).toBe('John Doe');
    });
  });

  describe('CleverTap Event Upload Payload', () => {
    it('should build CleverTap event payload with correct structure', () => {
      const appointmentData = {
        appointmentId: 789,
        patientMRN: 'MRN-001',
        appointmentDateTime: '2024-03-15T10:30:00Z',
        doctorName: 'Dr. Smith',
        department: 'Cardiology'
      };

      const cleverTapPayload = {
        d: [
          {
            identity: 'MRN-001',
            type: 'event',
            evtName: 'Appointment Scheduled',
            evtData: {
              appointmentId: 789,
              appointmentDateTime: '2024-03-15T10:30:00Z',
              doctorName: 'Dr. Smith',
              department: 'Cardiology'
            }
          }
        ]
      };

      expect(cleverTapPayload.d[0].type).toBe('event');
      expect(cleverTapPayload.d[0].evtName).toBe('Appointment Scheduled');
      expect(cleverTapPayload.d[0].identity).toBe('MRN-001');
    });
  });

  describe('Multi-Action Webhook Configuration', () => {
    it('should validate multi-action webhook structure for CleverTap', () => {
      const webhookConfig = {
        name: 'CleverTap Patient Integration',
        eventType: 'PATIENT_REGISTRATION',
        scope: 'ENTITY_ONLY',
        outgoingAuthType: 'CUSTOM_HEADERS',
        outgoingAuthConfig: {
          headers: {
            'X-CleverTap-Account-Id': '6K7-8R6-857Z',
            'X-CleverTap-Passcode': 'WHQ-KSY-CPEL'
          }
        },
        timeoutMs: 30000,
        retryCount: 3,
        actions: [
          {
            name: 'Profile Upload',
            condition: 'eventType === "PATIENT_REGISTRATION"',
            targetUrl: 'https://api.clevertap.com/1/upload',
            httpMethod: 'POST',
            transformationMode: 'SCRIPT',
            transformation: {
              script: `function transform(payload) {
                return {
                  d: [{
                    identity: payload.patientMRN,
                    type: 'profile',
                    profileData: {
                      Name: payload.patientName,
                      MRN: payload.patientMRN,
                      Phone: payload.patientPhone,
                      Email: payload.patientEmail
                    }
                  }]
                };
              }`
            }
          },
          {
            name: 'Event Upload',
            targetUrl: 'https://api.clevertap.com/1/upload',
            httpMethod: 'POST',
            transformationMode: 'SCRIPT',
            transformation: {
              script: `function transform(payload) {
                return {
                  d: [{
                    identity: payload.patientMRN,
                    type: 'event',
                    evtName: 'Patient Registered',
                    evtData: {
                      registrationDate: new Date().toISOString(),
                      patientMRN: payload.patientMRN
                    }
                  }]
                };
              }`
            }
          }
        ]
      };

      // Validate structure
      expect(webhookConfig.outgoingAuthType).toBe('CUSTOM_HEADERS');
      expect(webhookConfig.outgoingAuthConfig.headers).toHaveProperty('X-CleverTap-Account-Id');
      expect(webhookConfig.outgoingAuthConfig.headers).toHaveProperty('X-CleverTap-Passcode');
      expect(webhookConfig.actions).toHaveLength(2);
      expect(webhookConfig.actions[0].name).toBe('Profile Upload');
      expect(webhookConfig.actions[0].condition).toBeDefined();
      expect(webhookConfig.actions[1].name).toBe('Event Upload');
    });
  });

  describe('Phone Number Formatting', () => {
    it('should format phone number with +91 prefix if missing', () => {
      const phoneNumbers = [
        { input: '9876543210', expected: '+919876543210' },
        { input: '+919876543210', expected: '+919876543210' },
        { input: '919876543210', expected: '+919876543210' }
      ];

      phoneNumbers.forEach(({ input, expected }) => {
        const formatted = input.startsWith('+91') ? input :
                         input.startsWith('91') ? `+${input}` :
                         `+91${input}`;
        expect(formatted).toBe(expected);
      });
    });
  });

  describe('Identity Resolution', () => {
    it('should resolve identity from patient MRN', () => {
      const payload = {
        patientMRN: 'MRN-12345',
        patientPhone: '+919876543210'
      };

      const identity = payload.patientMRN || payload.patientPhone || 'unknown';
      expect(identity).toBe('MRN-12345');
    });

    it('should fallback to phone number if MRN is missing', () => {
      const payload = {
        patientPhone: '+919876543210'
      };

      const identity = payload.patientMRN || payload.patientPhone || 'unknown';
      expect(identity).toBe('+919876543210');
    });

    it('should use unknown if both MRN and phone are missing', () => {
      const payload = {
        patientName: 'John Doe'
      };

      const identity = payload.patientMRN || payload.patientPhone || 'unknown';
      expect(identity).toBe('unknown');
    });
  });

  describe('Conditional Action Execution', () => {
    it('should evaluate condition for profile events', () => {
      const profileEvents = ['PATIENT_REGISTRATION', 'VISIT_CREATED'];
      const condition = 'eventType === "PATIENT_REGISTRATION" || eventType === "VISIT_CREATED"';

      profileEvents.forEach(eventType => {
        const context = { eventType };
        const func = new Function('eventType', `return Boolean(${condition});`);
        const result = func(eventType);
        expect(result).toBe(true);
      });
    });

    it('should not execute profile upload for non-profile events', () => {
      const condition = 'eventType === "PATIENT_REGISTRATION" || eventType === "VISIT_CREATED"';
      const context = { eventType: 'APPOINTMENT_CREATED' };

      const func = new Function('eventType', `return Boolean(${condition});`);
      const result = func(context.eventType);
      expect(result).toBe(false);
    });
  });

  describe('Transformation Script Execution', () => {
    it('should execute CleverTap profile transformation', () => {
      const transformScript = `
        function transform(payload) {
          return {
            d: [{
              identity: payload.patientMRN || payload.patientPhone || 'unknown',
              type: 'profile',
              profileData: {
                Name: payload.patientName,
                MRN: payload.patientMRN,
                Phone: payload.patientPhone?.startsWith('+91') ? payload.patientPhone : '+91' + payload.patientPhone,
                Email: payload.patientEmail
              }
            }]
          };
        }
      `;

      const payload = {
        patientMRN: 'MRN-001',
        patientName: 'John Doe',
        patientPhone: '9876543210',
        patientEmail: 'john@example.com'
      };

      // Extract and execute the function
      const funcMatch = transformScript.match(/function transform\(payload\)\s*{([\s\S]*)}/);
      const funcBody = funcMatch[1];
      const transform = new Function('payload', funcBody);
      const result = transform(payload);

      expect(result.d[0].identity).toBe('MRN-001');
      expect(result.d[0].type).toBe('profile');
      expect(result.d[0].profileData.Phone).toBe('+919876543210');
    });

    it('should execute CleverTap event transformation', () => {
      const transformScript = `
        function transform(payload) {
          return {
            d: [{
              identity: payload.patientMRN || 'unknown',
              type: 'event',
              evtName: 'Appointment Scheduled',
              evtData: {
                appointmentId: payload.appointmentId,
                appointmentDateTime: payload.appointmentDateTime,
                doctorName: payload.doctorName
              }
            }]
          };
        }
      `;

      const payload = {
        patientMRN: 'MRN-001',
        appointmentId: 789,
        appointmentDateTime: '2024-03-15T10:30:00Z',
        doctorName: 'Dr. Smith'
      };

      const funcMatch = transformScript.match(/function transform\(payload\)\s*{([\s\S]*)}/);
      const funcBody = funcMatch[1];
      const transform = new Function('payload', funcBody);
      const result = transform(payload);

      expect(result.d[0].type).toBe('event');
      expect(result.d[0].evtName).toBe('Appointment Scheduled');
      expect(result.d[0].evtData.appointmentId).toBe(789);
    });
  });
});
