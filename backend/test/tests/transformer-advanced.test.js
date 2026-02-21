/**
 * Advanced Transformer Tests
 * Tests async/await, HTTP helper, global utilities, response transformations, and edge cases
 */

const { applyTransform, applyResponseTransform, validateScript } = require('../../src/services/transformer');
const axios = require('axios');

// Mock axios for HTTP tests
jest.mock('axios');

describe('Advanced Transformer Tests', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Async/Await Transformations', () => {
    it('should handle async transformation scripts', async () => {
      const integration = {
        transformationMode: 'SCRIPT',
        transformation: {
          script: `
            // Simulate async operation
            const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
            await delay(10);

            return {
              ...payload,
              processed: true,
              timestamp: Date.now()
            };
          `
        }
      };

      const payload = { patientId: '123', name: 'John Doe' };
      const result = await applyTransform(integration, payload, {});

      expect(result.patientId).toBe('123');
      expect(result.name).toBe('John Doe');
      expect(result.processed).toBe(true);
      expect(result.timestamp).toBeGreaterThan(0);
    });

    it('should handle multiple await calls in transformation', async () => {
      const integration = {
        transformationMode: 'SCRIPT',
        transformation: {
          script: `
            const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

            await delay(5);
            const step1 = { ...payload, step: 1 };

            await delay(5);
            const step2 = { ...step1, step: 2 };

            return step2;
          `
        }
      };

      const payload = { data: 'test' };
      const result = await applyTransform(integration, payload, {});

      expect(result.data).toBe('test');
      expect(result.step).toBe(2);
    });

    it('should handle async errors in transformation scripts', async () => {
      const integration = {
        transformationMode: 'SCRIPT',
        transformation: {
          script: `
            const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
            await delay(5);
            throw new Error('Async operation failed');
          `
        }
      };

      const payload = { test: 'data' };

      await expect(applyTransform(integration, payload, {}))
        .rejects.toThrow('Script execution failed');
    });
  });

  describe('HTTP Helper in Transformations', () => {
    it('should make HTTP GET requests from transformation script', async () => {
      axios.get.mockResolvedValue({
        status: 200,
        data: { patientType: 'PREMIUM', discount: 10 },
        headers: { 'content-type': 'application/json' }
      });

      const integration = {
        transformationMode: 'SCRIPT',
        transformation: {
          script: `
            const response = await http.get('https://api.example.com/patients/' + payload.patientId);

            return {
              ...payload,
              patientType: response.data.patientType,
              discount: response.data.discount
            };
          `
        }
      };

      const payload = { patientId: '12345', name: 'John Doe' };
      const context = { eventType: 'PATIENT_REGISTERED' };

      const result = await applyTransform(integration, payload, context);

      expect(result.patientId).toBe('12345');
      expect(result.patientType).toBe('PREMIUM');
      expect(result.discount).toBe(10);
      expect(axios.get).toHaveBeenCalledWith(
        'https://api.example.com/patients/12345',
        expect.objectContaining({
          timeout: 30000
        })
      );
    });

    it('should make HTTP POST requests with data', async () => {
      axios.post.mockResolvedValue({
        status: 201,
        data: { orderId: 'ORD-999', status: 'CREATED' },
        headers: {}
      });

      const integration = {
        transformationMode: 'SCRIPT',
        transformation: {
          script: `
            const orderData = {
              patientId: payload.patientId,
              amount: payload.amount
            };

            const response = await http.post(
              'https://api.example.com/orders',
              orderData,
              { headers: { 'X-API-Key': 'secret123' } }
            );

            return {
              ...payload,
              orderId: response.data.orderId,
              orderStatus: response.data.status
            };
          `
        }
      };

      const payload = { patientId: 'P123', amount: 5000 };
      const result = await applyTransform(integration, payload, {});

      expect(result.orderId).toBe('ORD-999');
      expect(result.orderStatus).toBe('CREATED');
      expect(axios.post).toHaveBeenCalledWith(
        'https://api.example.com/orders',
        { patientId: 'P123', amount: 5000 },
        expect.objectContaining({
          headers: { 'X-API-Key': 'secret123' }
        })
      );
    });

    it('should handle HTTP errors in transformation scripts', async () => {
      axios.get.mockRejectedValue(new Error('Network timeout'));

      const integration = {
        transformationMode: 'SCRIPT',
        transformation: {
          script: `
            const response = await http.get('https://api.example.com/data');
            return response.data;
          `
        }
      };

      const payload = { test: 'data' };

      await expect(applyTransform(integration, payload, {}))
        .rejects.toThrow('Script execution failed');
    });

    it('should support HTTP PUT requests', async () => {
      axios.put.mockResolvedValue({
        status: 200,
        data: { updated: true },
        headers: {}
      });

      const integration = {
        transformationMode: 'SCRIPT',
        transformation: {
          script: `
            const response = await http.put(
              'https://api.example.com/patients/' + payload.id,
              { status: 'ACTIVE' }
            );
            return { ...payload, updated: response.data.updated };
          `
        }
      };

      const payload = { id: '123' };
      const result = await applyTransform(integration, payload, {});

      expect(result.updated).toBe(true);
    });

    it('should support HTTP PATCH requests', async () => {
      axios.patch.mockResolvedValue({
        status: 200,
        data: { patched: true },
        headers: {}
      });

      const integration = {
        transformationMode: 'SCRIPT',
        transformation: {
          script: `
            const response = await http.patch(
              'https://api.example.com/resource',
              { field: 'value' }
            );
            return { patched: response.data.patched };
          `
        }
      };

      const result = await applyTransform(integration, {}, {});
      expect(result.patched).toBe(true);
    });

    it('should support HTTP DELETE requests', async () => {
      axios.delete.mockResolvedValue({
        status: 204,
        data: null,
        headers: {}
      });

      const integration = {
        transformationMode: 'SCRIPT',
        transformation: {
          script: `
            const response = await http.delete('https://api.example.com/resource/123');
            return { deleted: response.status === 204 };
          `
        }
      };

      const result = await applyTransform(integration, {}, {});
      expect(result.deleted).toBe(true);
    });
  });

  describe('Global Utility Functions', () => {
    it('should use epoch() utility to convert date strings to Unix timestamps', async () => {
      const integration = {
        transformationMode: 'SCRIPT',
        transformation: {
          script: `
            const timestamp = epoch('2024-01-15T10:30:00Z');
            return { timestamp };
          `
        }
      };

      const result = await applyTransform(integration, {}, {});
      expect(result.timestamp).toBeGreaterThan(0);
      expect(typeof result.timestamp).toBe('number');
    });

    it('should handle DD/MM/YYYY date format in epoch()', async () => {
      const integration = {
        transformationMode: 'SCRIPT',
        transformation: {
          script: `
            const timestamp = epoch('15/01/2024');
            return { timestamp };
          `
        }
      };

      const result = await applyTransform(integration, {}, {});
      expect(result.timestamp).toBeGreaterThan(0);
    });

    it('should handle DD/MM/YYYY HH:MM AM/PM format in epoch()', async () => {
      const integration = {
        transformationMode: 'SCRIPT',
        transformation: {
          script: `
            const timestamp = epoch('04/02/2026 04:07 PM');
            return { timestamp };
          `
        }
      };

      const result = await applyTransform(integration, {}, {});
      expect(result.timestamp).toBeGreaterThan(0);
    });

    it('should handle DD-MMM-YYYY format in epoch()', async () => {
      const integration = {
        transformationMode: 'SCRIPT',
        transformation: {
          script: `
            const timestamp = epoch('15-Jan-2024');
            return { timestamp };
          `
        }
      };

      const result = await applyTransform(integration, {}, {});
      expect(result.timestamp).toBeGreaterThan(0);
    });

    it('should use datetime() utility to combine date and time', async () => {
      const integration = {
        transformationMode: 'SCRIPT',
        transformation: {
          script: `
            const timestamp = datetime('2024-01-15', '10:30:00');
            return { timestamp };
          `
        }
      };

      const result = await applyTransform(integration, {}, {});
      expect(result.timestamp).toBeGreaterThan(0);
    });

    it('should use datetime() with custom timezone', async () => {
      const integration = {
        transformationMode: 'SCRIPT',
        transformation: {
          script: `
            const timestamp = datetime('2024-01-15', '10:30:00', '+00:00');
            return { timestamp };
          `
        }
      };

      const result = await applyTransform(integration, {}, {});
      expect(result.timestamp).toBeGreaterThan(0);
    });

    it('should use uppercase() utility', async () => {
      const integration = {
        transformationMode: 'SCRIPT',
        transformation: {
          script: `
            return {
              code: uppercase(payload.code)
            };
          `
        }
      };

      const payload = { code: 'abc123' };
      const result = await applyTransform(integration, payload, {});
      expect(result.code).toBe('ABC123');
    });

    it('should use lowercase() utility', async () => {
      const integration = {
        transformationMode: 'SCRIPT',
        transformation: {
          script: `
            return {
              email: lowercase(payload.email)
            };
          `
        }
      };

      const payload = { email: 'USER@EXAMPLE.COM' };
      const result = await applyTransform(integration, payload, {});
      expect(result.email).toBe('user@example.com');
    });

    it('should use trim() utility', async () => {
      const integration = {
        transformationMode: 'SCRIPT',
        transformation: {
          script: `
            return {
              name: trim(payload.name)
            };
          `
        }
      };

      const payload = { name: '  John Doe  ' };
      const result = await applyTransform(integration, payload, {});
      expect(result.name).toBe('John Doe');
    });

    it('should use formatPhone() utility with default country code', async () => {
      const integration = {
        transformationMode: 'SCRIPT',
        transformation: {
          script: `
            return {
              phone: formatPhone(payload.phone)
            };
          `
        }
      };

      const payload = { phone: '9876543210' };
      const result = await applyTransform(integration, payload, {});
      expect(result.phone).toBe('+919876543210');
    });

    it('should use formatPhone() with custom country code', async () => {
      const integration = {
        transformationMode: 'SCRIPT',
        transformation: {
          script: `
            return {
              phone: formatPhone(payload.phone, '1')
            };
          `
        }
      };

      const payload = { phone: '5551234567' };
      const result = await applyTransform(integration, payload, {});
      expect(result.phone).toBe('+15551234567');
    });

    it('should use get() utility for nested object access', async () => {
      const integration = {
        transformationMode: 'SCRIPT',
        transformation: {
          script: `
            return {
              patientName: get(payload, 'patient.name', 'Unknown'),
              phoneNumber: get(payload, 'patient.contact.phone', 'N/A')
            };
          `
        }
      };

      const payload = {
        patient: {
          name: 'Alice Johnson',
          contact: {
            phone: '1234567890'
          }
        }
      };

      const result = await applyTransform(integration, payload, {});
      expect(result.patientName).toBe('Alice Johnson');
      expect(result.phoneNumber).toBe('1234567890');
    });

    it('should return default value when path not found in get()', async () => {
      const integration = {
        transformationMode: 'SCRIPT',
        transformation: {
          script: `
            return {
              missing: get(payload, 'nonexistent.path', 'DEFAULT')
            };
          `
        }
      };

      const payload = { test: 'data' };
      const result = await applyTransform(integration, payload, {});
      expect(result.missing).toBe('DEFAULT');
    });
  });

  describe('Nested Field Access in SIMPLE Mode', () => {
    it('should support nested source fields with dot notation', async () => {
      const integration = {
        transformationMode: 'SIMPLE',
        transformation: {
          mappings: [
            { sourceField: 'patient.name', targetField: 'patientName' },
            { sourceField: 'patient.contact.email', targetField: 'email' },
            { sourceField: 'appointment.doctor.id', targetField: 'doctorId' }
          ]
        }
      };

      const payload = {
        patient: {
          name: 'Jane Doe',
          contact: {
            email: 'jane@example.com',
            phone: '1234567890'
          }
        },
        appointment: {
          doctor: {
            id: 'D123',
            name: 'Dr. Smith'
          }
        }
      };

      const result = await applyTransform(integration, payload, {});

      expect(result.patientName).toBe('Jane Doe');
      expect(result.email).toBe('jane@example.com');
      expect(result.doctorId).toBe('D123');
    });

    it('should handle undefined nested paths gracefully', async () => {
      const integration = {
        transformationMode: 'SIMPLE',
        transformation: {
          mappings: [
            { sourceField: 'missing.nested.field', targetField: 'result' }
          ]
        }
      };

      const payload = { test: 'data' };
      const result = await applyTransform(integration, payload, {});

      expect(result.result).toBeUndefined();
    });
  });

  describe('Response Transformations (INBOUND)', () => {
    it('should apply SIMPLE response transformation', async () => {
      const integration = {
        tenantId: 1,
        responseTransformation: {
          mode: 'SIMPLE',
          mappings: [
            { sourceField: 'external_patient_id', targetField: 'patientId' },
            { sourceField: 'status_code', targetField: 'status', transform: 'upper' }
          ],
          staticFields: [
            { key: 'source', value: 'external_api' }
          ]
        }
      };

      const response = {
        external_patient_id: 'EXT-12345',
        status_code: 'active',
        data: 'test'
      };

      const result = await applyResponseTransform(integration, response, {});

      expect(result.patientId).toBe('EXT-12345');
      expect(result.status).toBe('ACTIVE');
      expect(result.source).toBe('external_api');
    });

    it('should apply SCRIPT response transformation', async () => {
      const integration = {
        tenantId: 1,
        responseTransformation: {
          mode: 'SCRIPT',
          script: `
            return {
              patientId: payload.data.patient_id,
              appointments: payload.data.appointments.map(a => ({
                id: a.appt_id,
                date: a.scheduled_date
              }))
            };
          `
        }
      };

      const response = {
        data: {
          patient_id: 'P999',
          appointments: [
            { appt_id: 'A1', scheduled_date: '2024-01-15' },
            { appt_id: 'A2', scheduled_date: '2024-01-20' }
          ]
        }
      };

      const result = await applyResponseTransform(integration, response, {});

      expect(result.patientId).toBe('P999');
      expect(result.appointments).toHaveLength(2);
      expect(result.appointments[0].id).toBe('A1');
      expect(result.appointments[1].id).toBe('A2');
    });

    it('should return response as-is when no transformation configured', async () => {
      const integration = {
        tenantId: 1
        // No responseTransformation
      };

      const response = { test: 'data', value: 123 };
      const result = await applyResponseTransform(integration, response, {});

      expect(result).toEqual(response);
    });

    it('should validate response transformation script', async () => {
      const integration = {
        tenantId: 1,
        responseTransformation: {
          mode: 'SCRIPT',
          script: null // Invalid
        }
      };

      const response = { test: 'data' };

      await expect(applyResponseTransform(integration, response, {}))
        .rejects.toThrow('Invalid response transformation script');
    });
  });

  describe('Script Validation', () => {
    it('should validate valid scripts', () => {
      const validScript = 'return { test: payload.value };';
      expect(validateScript(validScript)).toBe(true);
    });

    it('should validate scripts with await', () => {
      const asyncScript = 'const result = await someAsyncFunc(); return result;';
      expect(validateScript(asyncScript)).toBe(true);
    });

    it('should reject invalid scripts', () => {
      const invalidScript = 'this is not valid javascript {{{';
      expect(validateScript(invalidScript)).toBe(false);
    });

    it('should reject null/undefined scripts', () => {
      expect(validateScript(null)).toBe(false);
      expect(validateScript(undefined)).toBe(false);
      expect(validateScript('')).toBe(false);
    });

    it('should reject non-string scripts', () => {
      expect(validateScript(123)).toBe(false);
      expect(validateScript({})).toBe(false);
      expect(validateScript([])).toBe(false);
    });
  });

  describe('Complex Async Workflows', () => {
    it('should handle complex async workflow with multiple HTTP calls', async () => {
      axios.get.mockImplementation((url) => {
        if (url.includes('/patient/')) {
          return Promise.resolve({
            status: 200,
            data: { tier: 'GOLD' },
            headers: {}
          });
        } else if (url.includes('/pricing/')) {
          return Promise.resolve({
            status: 200,
            data: { discount: 20 },
            headers: {}
          });
        }
      });

      const integration = {
        transformationMode: 'SCRIPT',
        transformation: {
          script: `
            // Fetch patient tier
            const patientResponse = await http.get('https://api.example.com/patient/' + payload.patientId);
            const tier = patientResponse.data.tier;

            // Fetch pricing based on tier
            const pricingResponse = await http.get('https://api.example.com/pricing/' + tier);
            const discount = pricingResponse.data.discount;

            return {
              ...payload,
              tier,
              discount,
              finalAmount: payload.amount * (1 - discount / 100)
            };
          `
        }
      };

      const payload = { patientId: 'P123', amount: 1000 };
      const result = await applyTransform(integration, payload, {});

      expect(result.tier).toBe('GOLD');
      expect(result.discount).toBe(20);
      expect(result.finalAmount).toBe(800);
      expect(axios.get).toHaveBeenCalledTimes(2);
    });
  });

  describe('Error Handling and Edge Cases', () => {
    it('should handle timeout in async transformations', async () => {
      const integration = {
        transformationMode: 'SCRIPT',
        transformation: {
          script: `
            // Create a promise that never resolves to simulate timeout
            const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
            await delay(70000); // 70 seconds (exceeds 60s timeout)
            return payload;
          `
        }
      };

      const payload = { test: 'data' };

      await expect(applyTransform(integration, payload, {}))
        .rejects.toThrow();
    }, 65000); // Increase jest timeout for this test

    it('should reject circular references', async () => {
      const integration = {
        transformationMode: 'SCRIPT',
        transformation: {
          script: `
            const obj = { ...payload };
            obj.circular = obj; // Create circular reference
            return obj;
          `
        }
      };

      const payload = { test: 'data' };

      // Should throw error due to circular reference
      await expect(applyTransform(integration, payload, {}))
        .rejects.toThrow('Script execution failed');
    });

    it('should preserve original payload on empty mappings', async () => {
      const integration = {
        transformationMode: 'SIMPLE',
        transformation: {
          mappings: []
        }
      };

      const payload = { field1: 'value1', field2: 'value2' };
      const result = await applyTransform(integration, payload, {});

      expect(result).toEqual(payload);
    });

    it('should handle null payload gracefully', async () => {
      const integration = {
        transformationMode: 'SIMPLE',
        transformation: {
          mappings: [
            { sourceField: 'test', targetField: 'output' }
          ]
        }
      };

      const result = await applyTransform(integration, null, {});
      expect(result).toBeDefined();
    });
  });

  afterAll(() => {
    const logger = require('../../src/logger');
    if (logger.closeLogStreams) {
      logger.closeLogStreams();
    }
  });
});
