/**
 * Transformer Tests
 * Tests data transformation logic (no database dependency)
 */

const { applyTransform } = require('../../src/services/transformer');

describe('Transformer', () => {
  describe('SIMPLE Mode Transformations', () => {
    it('should apply field mappings', async () => {
      const webhook = {
        transformationMode: 'SIMPLE',
        transformation: {
          mappings: [
            { sourceField: 'oldField', targetField: 'newField' },
            { sourceField: 'nested', targetField: 'flat' }
          ]
        }
      };

      const payload = {
        oldField: 'value1',
        nested: 'value2',
        unchanged: 'value3'
      };

      const result = await applyTransform(webhook, payload, {});

      expect(result.newField).toBe('value1');
      expect(result.flat).toBe('value2');
      expect(result.unchanged).toBe('value3');
    });

    it('should add static fields', async () => {
      const webhook = {
        transformationMode: 'SIMPLE',
        transformation: {
          staticFields: [
            { key: 'source', value: 'medics' },
            { key: 'version', value: '1.0' }
          ]
        }
      };

      const payload = {
        patientId: '123'
      };

      const result = await applyTransform(webhook, payload, {});

      expect(result.source).toBe('medics');
      expect(result.version).toBe('1.0');
      expect(result.patientId).toBe('123');
    });

    it('should apply trim transform', async () => {
      const webhook = {
        transformationMode: 'SIMPLE',
        transformation: {
          mappings: [
            { sourceField: 'name', targetField: 'trimmedName', transform: 'trim' }
          ]
        }
      };

      const payload = {
        name: '  John Doe  '
      };

      const result = await applyTransform(webhook, payload, {});

      expect(result.trimmedName).toBe('John Doe');
    });

    it('should apply upper transform', async () => {
      const webhook = {
        transformationMode: 'SIMPLE',
        transformation: {
          mappings: [
            { sourceField: 'code', targetField: 'upperCode', transform: 'upper' }
          ]
        }
      };

      const payload = {
        code: 'abc123'
      };

      const result = await applyTransform(webhook, payload, {});

      expect(result.upperCode).toBe('ABC123');
    });

    it('should apply lower transform', async () => {
      const webhook = {
        transformationMode: 'SIMPLE',
        transformation: {
          mappings: [
            { sourceField: 'email', targetField: 'lowerEmail', transform: 'lower' }
          ]
        }
      };

      const payload = {
        email: 'USER@EXAMPLE.COM'
      };

      const result = await applyTransform(webhook, payload, {});

      expect(result.lowerEmail).toBe('user@example.com');
    });

    it('should apply date transform', async () => {
      const webhook = {
        transformationMode: 'SIMPLE',
        transformation: {
          mappings: [
            { sourceField: 'createdAt', targetField: 'isoDate', transform: 'date' }
          ]
        }
      };

      const payload = {
        createdAt: '2024-01-15'
      };

      const result = await applyTransform(webhook, payload, {});

      expect(result.isoDate).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it('should apply default transform with fallback value', async () => {
      const webhook = {
        transformationMode: 'SIMPLE',
        transformation: {
          mappings: [
            { sourceField: 'optional', targetField: 'withDefault', transform: 'default', defaultValue: 'N/A' }
          ]
        }
      };

      const payload = {
        required: 'value'
      };

      const result = await applyTransform(webhook, payload, {});

      expect(result.withDefault).toBe('N/A');
    });

    it('should apply multiple transforms together', async () => {
      const webhook = {
        transformationMode: 'SIMPLE',
        transformation: {
          mappings: [
            { sourceField: 'firstName', targetField: 'name', transform: 'trim' },
            { sourceField: 'email', targetField: 'emailLower', transform: 'lower' },
            { sourceField: 'status', targetField: 'statusUpper', transform: 'upper' }
          ],
          staticFields: [
            { key: 'source', value: 'medics' },
            { key: 'timestamp', value: '2024-01-15T10:00:00Z' }
          ]
        }
      };

      const payload = {
        firstName: '  Alice  ',
        email: 'ALICE@EXAMPLE.COM',
        status: 'active'
      };

      const result = await applyTransform(webhook, payload, {});

      expect(result.name).toBe('Alice');
      expect(result.emailLower).toBe('alice@example.com');
      expect(result.statusUpper).toBe('ACTIVE');
      expect(result.source).toBe('medics');
      expect(result.timestamp).toBe('2024-01-15T10:00:00Z');
    });

    it('should handle empty transformation', async () => {
      const webhook = {
        transformationMode: 'SIMPLE',
        transformation: {}
      };

      const payload = {
        field1: 'value1'
      };

      const result = await applyTransform(webhook, payload, {});

      expect(result).toEqual(payload);
    });

    it('should handle non-string values in string transforms', async () => {
      const webhook = {
        transformationMode: 'SIMPLE',
        transformation: {
          mappings: [
            { sourceField: 'number', targetField: 'trimmed', transform: 'trim' },
            { sourceField: 'number', targetField: 'upper', transform: 'upper' }
          ]
        }
      };

      const payload = {
        number: 12345
      };

      const result = await applyTransform(webhook, payload, {});

      // Non-string values should pass through unchanged
      expect(result.trimmed).toBe(12345);
      expect(result.upper).toBe(12345);
    });
  });

  describe('SCRIPT Mode Transformations', () => {
    it('should validate script before execution', async () => {
      const webhook = {
        transformationMode: 'SCRIPT',
        transformation: {
          script: null // Invalid script
        }
      };

      const payload = { test: 'data' };

      await expect(applyTransform(webhook, payload, {})).rejects.toThrow('Invalid script transformation');
    });

    it('should handle empty script', async () => {
      const webhook = {
        transformationMode: 'SCRIPT',
        transformation: {}
      };

      const payload = { test: 'data' };

      await expect(applyTransform(webhook, payload, {})).rejects.toThrow('Invalid script transformation');
    });

    it('should execute valid script transformation', async () => {
      const webhook = {
        transformationMode: 'SCRIPT',
        transformation: {
          script: `
            return {
              ...payload,
              fullName: payload.firstName + ' ' + payload.lastName,
              source: 'medics'
            };
          `
        }
      };

      const payload = {
        firstName: 'John',
        lastName: 'Doe',
        age: 30
      };

      const result = await applyTransform(webhook, payload, {});

      expect(result.fullName).toBe('John Doe');
      expect(result.source).toBe('medics');
      expect(result.age).toBe(30);
    });

    it('should provide context to script', async () => {
      const webhook = {
        transformationMode: 'SCRIPT',
        transformation: {
          script: `
            return {
              ...payload,
              eventType: context.eventType,
              entityRid: context.entityRid
            };
          `
        }
      };

      const payload = {
        patientId: '123'
      };

      const context = {
        eventType: 'PATIENT_REGISTERED',
        entityRid: 42
      };

      const result = await applyTransform(webhook, payload, context);

      expect(result.eventType).toBe('PATIENT_REGISTERED');
      expect(result.entityRid).toBe(42);
      expect(result.patientId).toBe('123');
    });

    it('should handle complex transformations in script', async () => {
      const webhook = {
        transformationMode: 'SCRIPT',
        transformation: {
          script: `
            const items = payload.items || [];
            const total = items.reduce((sum, item) => sum + item.price, 0);

            return {
              orderId: payload.orderId,
              itemCount: items.length,
              totalAmount: total,
              currency: 'USD'
            };
          `
        }
      };

      const payload = {
        orderId: 'ORD-123',
        items: [
          { name: 'Item 1', price: 10 },
          { name: 'Item 2', price: 20 },
          { name: 'Item 3', price: 30 }
        ]
      };

      const result = await applyTransform(webhook, payload, {});

      expect(result.orderId).toBe('ORD-123');
      expect(result.itemCount).toBe(3);
      expect(result.totalAmount).toBe(60);
      expect(result.currency).toBe('USD');
    });

    it('should handle script errors gracefully', async () => {
      const webhook = {
        transformationMode: 'SCRIPT',
        transformation: {
          script: `
            throw new Error('Custom error in script');
          `
        }
      };

      const payload = { test: 'data' };

      await expect(applyTransform(webhook, payload, {})).rejects.toThrow('Script execution failed');
    });

    it('should prevent extremely nested objects', async () => {
      const webhook = {
        transformationMode: 'SCRIPT',
        transformation: {
          script: `
            // Create deeply nested object (60 levels, exceeds MAX_DEPTH of 50)
            function createDeepObject(levels) {
              if (levels === 0) return { end: true };
              return { nested: createDeepObject(levels - 1) };
            }
            return createDeepObject(60);
          `
        }
      };

      const payload = { test: 'data' };

      await expect(applyTransform(webhook, payload, {})).rejects.toThrow('Transformed object too deep');
    });

    it('should handle conditional logic in script', async () => {
      const webhook = {
        transformationMode: 'SCRIPT',
        transformation: {
          script: `
            return {
              patientId: payload.patientId,
              status: payload.age >= 18 ? 'ADULT' : 'MINOR',
              category: payload.age >= 65 ? 'SENIOR' : 'REGULAR'
            };
          `
        }
      };

      const payload1 = { patientId: 'P001', age: 25 };
      const result1 = await applyTransform(webhook, payload1, {});
      expect(result1.status).toBe('ADULT');
      expect(result1.category).toBe('REGULAR');

      const payload2 = { patientId: 'P002', age: 70 };
      const result2 = await applyTransform(webhook, payload2, {});
      expect(result2.status).toBe('ADULT');
      expect(result2.category).toBe('SENIOR');

      const payload3 = { patientId: 'P003', age: 15 };
      const result3 = await applyTransform(webhook, payload3, {});
      expect(result3.status).toBe('MINOR');
      expect(result3.category).toBe('REGULAR');
    });
  });

  describe('No Transformation', () => {
    it('should pass through payload when no transformation configured', async () => {
      const webhook = {
        transformationMode: null,
        transformation: null
      };

      const payload = {
        field1: 'value1',
        field2: 'value2'
      };

      const result = await applyTransform(webhook, payload, {});

      expect(result).toEqual(payload);
    });

    it('should pass through when webhook is null', async () => {
      const payload = {
        field1: 'value1'
      };

      const result = await applyTransform(null, payload, {});

      expect(result).toEqual(payload);
    });
  });

  afterAll(() => {
    const logger = require('../../src/logger');
    if (logger.closeLogStreams) {
      logger.closeLogStreams();
    }
  });
});
