/**
 * Lookup Service Tests
 * Tests code mapping functionality including simple fields, nested fields, arrays, and unmapped behaviors
 */

const {
  applyLookups,
  testLookups,
  getNestedValue,
  setNestedValue
} = require('../../src/services/lookup-service');

// Mock data.resolveLookup
jest.mock('../../src/data', () => ({
  resolveLookup: jest.fn()
}));

const { resolveLookup } = require('../../src/data');

describe('Lookup Service Tests', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Nested Value Access Helpers', () => {
    it('should get nested values with dot notation', () => {
      const obj = {
        patient: {
          contact: {
            email: 'test@example.com',
            phone: '1234567890'
          },
          name: 'John Doe'
        }
      };

      expect(getNestedValue(obj, 'patient.name')).toBe('John Doe');
      expect(getNestedValue(obj, 'patient.contact.email')).toBe('test@example.com');
      expect(getNestedValue(obj, 'patient.contact.phone')).toBe('1234567890');
    });

    it('should return undefined for non-existent paths', () => {
      const obj = { test: 'data' };

      expect(getNestedValue(obj, 'missing.path')).toBeUndefined();
      expect(getNestedValue(obj, 'test.nested')).toBeUndefined();
    });

    it('should handle null/undefined gracefully', () => {
      expect(getNestedValue(null, 'path')).toBeUndefined();
      expect(getNestedValue(undefined, 'path')).toBeUndefined();
      expect(getNestedValue({ test: 'data' }, null)).toBeUndefined();
      expect(getNestedValue({ test: 'data' }, '')).toBeUndefined();
    });

    it('should set nested values with dot notation', () => {
      const obj = {};

      setNestedValue(obj, 'patient.name', 'Alice Johnson');
      setNestedValue(obj, 'patient.contact.email', 'alice@example.com');
      setNestedValue(obj, 'appointment.doctorId', 'D123');

      expect(obj.patient.name).toBe('Alice Johnson');
      expect(obj.patient.contact.email).toBe('alice@example.com');
      expect(obj.appointment.doctorId).toBe('D123');
    });

    it('should overwrite existing nested values', () => {
      const obj = {
        patient: {
          name: 'Old Name'
        }
      };

      setNestedValue(obj, 'patient.name', 'New Name');
      expect(obj.patient.name).toBe('New Name');
    });

    it('should create intermediate objects when setting nested values', () => {
      const obj = {};

      setNestedValue(obj, 'deeply.nested.path.value', 'test');
      expect(obj.deeply.nested.path.value).toBe('test');
    });
  });

  describe('Simple Field Lookups', () => {
    it('should apply simple field lookup with mapping found', async () => {
      resolveLookup.mockResolvedValue('MAPPED_CODE');

      const payload = {
        serviceCode: 'SERVICE_123',
        patientId: 'P001'
      };

      const lookupConfigs = [
        {
          type: 'SERVICE_CODE',
          sourceField: 'serviceCode',
          targetField: 'lisCode',
          unmappedBehavior: 'PASSTHROUGH'
        }
      ];

      const event = { entityParentRid: 1, entityRid: 100 };

      const result = await applyLookups(payload, lookupConfigs, event);

      expect(result.lisCode).toBe('MAPPED_CODE');
      expect(result.serviceCode).toBe('SERVICE_123'); // Original preserved
      expect(result.patientId).toBe('P001');
      expect(resolveLookup).toHaveBeenCalledWith('SERVICE_123', 'SERVICE_CODE', 1, 100);
    });

    it('should use PASSTHROUGH behavior when mapping not found', async () => {
      resolveLookup.mockResolvedValue(null); // No mapping found

      const payload = {
        serviceCode: 'UNMAPPED_123'
      };

      const lookupConfigs = [
        {
          type: 'SERVICE_CODE',
          sourceField: 'serviceCode',
          targetField: 'lisCode',
          unmappedBehavior: 'PASSTHROUGH'
        }
      ];

      const event = { entityParentRid: 1, entityRid: 100 };

      const result = await applyLookups(payload, lookupConfigs, event);

      expect(result.lisCode).toBe('UNMAPPED_123'); // Original value passed through
    });

    it('should use DEFAULT behavior when mapping not found', async () => {
      resolveLookup.mockResolvedValue(null); // No mapping found

      const payload = {
        gender: 'OTHER'
      };

      const lookupConfigs = [
        {
          type: 'GENDER',
          sourceField: 'gender',
          targetField: 'genderCode',
          unmappedBehavior: 'DEFAULT',
          defaultValue: 'U' // Unknown
        }
      ];

      const event = { entityParentRid: 1, entityRid: 100 };

      const result = await applyLookups(payload, lookupConfigs, event);

      expect(result.genderCode).toBe('U'); // Default value used
    });

    it('should use FAIL behavior and throw error when mapping not found', async () => {
      resolveLookup.mockResolvedValue(null); // No mapping found

      const payload = {
        criticalCode: 'UNMAPPED'
      };

      const lookupConfigs = [
        {
          type: 'CRITICAL_CODE',
          sourceField: 'criticalCode',
          targetField: 'mappedCode',
          unmappedBehavior: 'FAIL'
        }
      ];

      const event = { entityParentRid: 1, entityRid: 100 };

      await expect(applyLookups(payload, lookupConfigs, event))
        .rejects.toThrow('Unmapped code: UNMAPPED');
    });

    it('should skip lookup for null values', async () => {
      const payload = {
        serviceCode: null
      };

      const lookupConfigs = [
        {
          type: 'SERVICE_CODE',
          sourceField: 'serviceCode',
          targetField: 'lisCode',
          unmappedBehavior: 'FAIL' // Would fail if processed
        }
      ];

      const event = { entityParentRid: 1, entityRid: 100 };

      const result = await applyLookups(payload, lookupConfigs, event);

      expect(resolveLookup).not.toHaveBeenCalled();
      expect(result.lisCode).toBeUndefined();
    });

    it('should skip lookup for undefined values', async () => {
      const payload = {
        patientId: 'P001'
        // serviceCode is undefined
      };

      const lookupConfigs = [
        {
          type: 'SERVICE_CODE',
          sourceField: 'serviceCode',
          targetField: 'lisCode',
          unmappedBehavior: 'FAIL'
        }
      ];

      const event = { entityParentRid: 1, entityRid: 100 };

      const result = await applyLookups(payload, lookupConfigs, event);

      expect(resolveLookup).not.toHaveBeenCalled();
      expect(result.lisCode).toBeUndefined();
    });

    it('should skip lookup for empty string values', async () => {
      const payload = {
        serviceCode: ''
      };

      const lookupConfigs = [
        {
          type: 'SERVICE_CODE',
          sourceField: 'serviceCode',
          targetField: 'lisCode',
          unmappedBehavior: 'FAIL'
        }
      ];

      const event = { entityParentRid: 1, entityRid: 100 };

      const result = await applyLookups(payload, lookupConfigs, event);

      expect(resolveLookup).not.toHaveBeenCalled();
      expect(result.lisCode).toBeUndefined();
    });
  });

  describe('Nested Field Lookups', () => {
    it('should apply lookup to nested source and target fields', async () => {
      resolveLookup.mockResolvedValue('M');

      const payload = {
        patient: {
          gender: 'MALE',
          name: 'John Doe'
        }
      };

      const lookupConfigs = [
        {
          type: 'GENDER',
          sourceField: 'patient.gender',
          targetField: 'patient.genderCode',
          unmappedBehavior: 'PASSTHROUGH'
        }
      ];

      const event = { entityParentRid: 1, entityRid: 100 };

      const result = await applyLookups(payload, lookupConfigs, event);

      expect(result.patient.genderCode).toBe('M');
      expect(result.patient.gender).toBe('MALE');
      expect(result.patient.name).toBe('John Doe');
    });

    it('should create nested target path if it does not exist', async () => {
      resolveLookup.mockResolvedValue('MAPPED_VALUE');

      const payload = {
        sourceCode: 'CODE_123'
      };

      const lookupConfigs = [
        {
          type: 'CUSTOM',
          sourceField: 'sourceCode',
          targetField: 'nested.deeply.mappedCode',
          unmappedBehavior: 'PASSTHROUGH'
        }
      ];

      const event = { entityParentRid: 1, entityRid: 100 };

      const result = await applyLookups(payload, lookupConfigs, event);

      expect(result.nested.deeply.mappedCode).toBe('MAPPED_VALUE');
    });

    it('should handle deeply nested source fields', async () => {
      resolveLookup.mockResolvedValue('PROCESSED');

      const payload = {
        appointment: {
          doctor: {
            department: {
              code: 'DEPT_CARDIO'
            }
          }
        }
      };

      const lookupConfigs = [
        {
          type: 'DEPARTMENT',
          sourceField: 'appointment.doctor.department.code',
          targetField: 'departmentId',
          unmappedBehavior: 'PASSTHROUGH'
        }
      ];

      const event = { entityParentRid: 1, entityRid: 100 };

      const result = await applyLookups(payload, lookupConfigs, event);

      expect(result.departmentId).toBe('PROCESSED');
    });
  });

  describe('Array Field Lookups', () => {
    it('should apply lookups to array fields', async () => {
      resolveLookup
        .mockResolvedValueOnce('LIS_SERVICE_1')
        .mockResolvedValueOnce('LIS_SERVICE_2')
        .mockResolvedValueOnce('LIS_SERVICE_3');

      const payload = {
        items: [
          { serviceCode: 'SERVICE_1', quantity: 1 },
          { serviceCode: 'SERVICE_2', quantity: 2 },
          { serviceCode: 'SERVICE_3', quantity: 1 }
        ]
      };

      const lookupConfigs = [
        {
          type: 'SERVICE_CODE',
          sourceField: 'items[].serviceCode',
          targetField: 'items[].lisCode',
          unmappedBehavior: 'PASSTHROUGH'
        }
      ];

      const event = { entityParentRid: 1, entityRid: 100 };

      const result = await applyLookups(payload, lookupConfigs, event);

      expect(result.items[0].lisCode).toBe('LIS_SERVICE_1');
      expect(result.items[0].serviceCode).toBe('SERVICE_1');
      expect(result.items[1].lisCode).toBe('LIS_SERVICE_2');
      expect(result.items[2].lisCode).toBe('LIS_SERVICE_3');
      expect(resolveLookup).toHaveBeenCalledTimes(3);
    });

    it('should handle array lookups with PASSTHROUGH behavior', async () => {
      resolveLookup
        .mockResolvedValueOnce('MAPPED_1')
        .mockResolvedValueOnce(null) // Not found
        .mockResolvedValueOnce('MAPPED_3');

      const payload = {
        items: [
          { code: 'CODE_1' },
          { code: 'CODE_2' },
          { code: 'CODE_3' }
        ]
      };

      const lookupConfigs = [
        {
          type: 'CODE',
          sourceField: 'items[].code',
          targetField: 'items[].mappedCode',
          unmappedBehavior: 'PASSTHROUGH'
        }
      ];

      const event = { entityParentRid: 1, entityRid: 100 };

      const result = await applyLookups(payload, lookupConfigs, event);

      expect(result.items[0].mappedCode).toBe('MAPPED_1');
      expect(result.items[1].mappedCode).toBe('CODE_2'); // Original value (PASSTHROUGH)
      expect(result.items[2].mappedCode).toBe('MAPPED_3');
    });

    it('should handle array lookups with DEFAULT behavior', async () => {
      resolveLookup
        .mockResolvedValueOnce(null) // Not found
        .mockResolvedValueOnce('FOUND');

      const payload = {
        tests: [
          { testCode: 'UNMAPPED' },
          { testCode: 'MAPPED' }
        ]
      };

      const lookupConfigs = [
        {
          type: 'TEST_CODE',
          sourceField: 'tests[].testCode',
          targetField: 'tests[].lisTestCode',
          unmappedBehavior: 'DEFAULT',
          defaultValue: 'DEFAULT_TEST'
        }
      ];

      const event = { entityParentRid: 1, entityRid: 100 };

      const result = await applyLookups(payload, lookupConfigs, event);

      expect(result.tests[0].lisTestCode).toBe('DEFAULT_TEST');
      expect(result.tests[1].lisTestCode).toBe('FOUND');
    });

    it('should handle empty arrays gracefully', async () => {
      const payload = {
        items: []
      };

      const lookupConfigs = [
        {
          type: 'SERVICE_CODE',
          sourceField: 'items[].serviceCode',
          targetField: 'items[].lisCode',
          unmappedBehavior: 'FAIL'
        }
      ];

      const event = { entityParentRid: 1, entityRid: 100 };

      const result = await applyLookups(payload, lookupConfigs, event);

      expect(result.items).toEqual([]);
      expect(resolveLookup).not.toHaveBeenCalled();
    });

    it('should skip null values in arrays', async () => {
      resolveLookup.mockResolvedValue('MAPPED');

      const payload = {
        items: [
          { code: 'CODE_1' },
          { code: null },
          { code: 'CODE_3' }
        ]
      };

      const lookupConfigs = [
        {
          type: 'CODE',
          sourceField: 'items[].code',
          targetField: 'items[].mapped',
          unmappedBehavior: 'FAIL' // Would fail if null is processed
        }
      ];

      const event = { entityParentRid: 1, entityRid: 100 };

      const result = await applyLookups(payload, lookupConfigs, event);

      expect(result.items[0].mapped).toBe('MAPPED');
      expect(result.items[1].mapped).toBeUndefined(); // Skipped
      expect(result.items[2].mapped).toBe('MAPPED');
      expect(resolveLookup).toHaveBeenCalledTimes(2); // Only non-null values
    });
  });

  describe('Multiple Lookups', () => {
    it('should apply multiple lookup configurations sequentially', async () => {
      resolveLookup
        .mockResolvedValueOnce('M') // Gender lookup
        .mockResolvedValueOnce('LIS_SERVICE'); // Service lookup

      const payload = {
        patient: {
          gender: 'MALE'
        },
        serviceCode: 'SERVICE_123'
      };

      const lookupConfigs = [
        {
          type: 'GENDER',
          sourceField: 'patient.gender',
          targetField: 'patient.genderCode',
          unmappedBehavior: 'PASSTHROUGH'
        },
        {
          type: 'SERVICE_CODE',
          sourceField: 'serviceCode',
          targetField: 'lisCode',
          unmappedBehavior: 'PASSTHROUGH'
        }
      ];

      const event = { entityParentRid: 1, entityRid: 100 };

      const result = await applyLookups(payload, lookupConfigs, event);

      expect(result.patient.genderCode).toBe('M');
      expect(result.lisCode).toBe('LIS_SERVICE');
      expect(resolveLookup).toHaveBeenCalledTimes(2);
    });

    it('should continue processing lookups even if one fails (non-FAIL behavior)', async () => {
      resolveLookup
        .mockRejectedValueOnce(new Error('Database error'))
        .mockResolvedValueOnce('MAPPED');

      const payload = {
        code1: 'CODE_1',
        code2: 'CODE_2'
      };

      const lookupConfigs = [
        {
          type: 'CODE',
          sourceField: 'code1',
          targetField: 'mapped1',
          unmappedBehavior: 'PASSTHROUGH' // Should continue on error
        },
        {
          type: 'CODE',
          sourceField: 'code2',
          targetField: 'mapped2',
          unmappedBehavior: 'PASSTHROUGH'
        }
      ];

      const event = { entityParentRid: 1, entityRid: 100 };

      const result = await applyLookups(payload, lookupConfigs, event);

      // Second lookup should still succeed
      expect(result.mapped2).toBe('MAPPED');
    });

    it('should stop processing lookups if FAIL behavior throws', async () => {
      resolveLookup.mockResolvedValue(null); // Not found

      const payload = {
        criticalCode: 'UNMAPPED',
        regularCode: 'CODE_2'
      };

      const lookupConfigs = [
        {
          type: 'CRITICAL',
          sourceField: 'criticalCode',
          targetField: 'mappedCritical',
          unmappedBehavior: 'FAIL' // Will throw
        },
        {
          type: 'REGULAR',
          sourceField: 'regularCode',
          targetField: 'mappedRegular',
          unmappedBehavior: 'PASSTHROUGH'
        }
      ];

      const event = { entityParentRid: 1, entityRid: 100 };

      await expect(applyLookups(payload, lookupConfigs, event))
        .rejects.toThrow('Unmapped code: UNMAPPED');

      // Second lookup should not be called
      expect(resolveLookup).toHaveBeenCalledTimes(1);
    });
  });

  describe('Test Lookups Function', () => {
    it('should test lookup configurations and return transformed payload', async () => {
      resolveLookup.mockResolvedValue('MAPPED');

      const payload = {
        serviceCode: 'SERVICE_123'
      };

      const lookupConfigs = [
        {
          type: 'SERVICE_CODE',
          sourceField: 'serviceCode',
          targetField: 'lisCode',
          unmappedBehavior: 'PASSTHROUGH'
        }
      ];

      const result = await testLookups(payload, lookupConfigs, 1, 100);

      expect(result.transformed.lisCode).toBe('MAPPED');
      expect(result.errors).toEqual([]);
    });

    it('should capture errors in test mode', async () => {
      resolveLookup.mockResolvedValue(null); // Not found

      const payload = {
        criticalCode: 'UNMAPPED'
      };

      const lookupConfigs = [
        {
          type: 'CRITICAL',
          sourceField: 'criticalCode',
          targetField: 'mapped',
          unmappedBehavior: 'FAIL'
        }
      ];

      const result = await testLookups(payload, lookupConfigs, 1, 100);

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].error).toContain('Unmapped code');
      expect(result.errors[0].index).toBe(0);
      expect(result.errors[0].type).toBe('CRITICAL');
    });

    it('should not modify original payload in test mode', async () => {
      resolveLookup.mockResolvedValue('MAPPED');

      const payload = {
        code: 'ORIGINAL'
      };

      const lookupConfigs = [
        {
          type: 'CODE',
          sourceField: 'code',
          targetField: 'mappedCode',
          unmappedBehavior: 'PASSTHROUGH'
        }
      ];

      await testLookups(payload, lookupConfigs, 1, 100);

      // Original payload should be unchanged
      expect(payload.mappedCode).toBeUndefined();
      expect(payload.code).toBe('ORIGINAL');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty lookup configs', async () => {
      const payload = { test: 'data' };
      const result = await applyLookups(payload, [], { entityParentRid: 1, entityRid: 100 });

      expect(result).toEqual(payload);
      expect(resolveLookup).not.toHaveBeenCalled();
    });

    it('should handle null lookup configs', async () => {
      const payload = { test: 'data' };
      const result = await applyLookups(payload, null, { entityParentRid: 1, entityRid: 100 });

      expect(result).toEqual(payload);
      expect(resolveLookup).not.toHaveBeenCalled();
    });

    it('should extract entityParentRid from alternate field names', async () => {
      resolveLookup.mockResolvedValue('MAPPED');

      const payload = { code: 'CODE_1' };
      const lookupConfigs = [
        {
          type: 'CODE',
          sourceField: 'code',
          targetField: 'mapped',
          unmappedBehavior: 'PASSTHROUGH'
        }
      ];

      // Using alternate field name
      const event = { entity_parent_rid: 99, entity_rid: 200 };

      await applyLookups(payload, lookupConfigs, event);

      expect(resolveLookup).toHaveBeenCalledWith('CODE_1', 'CODE', 99, 200);
    });

    it('should handle numeric and boolean source values', async () => {
      resolveLookup
        .mockResolvedValueOnce('ACTIVE_CODE')
        .mockResolvedValueOnce('PRIORITY_1');

      const payload = {
        isActive: true,
        priority: 1
      };

      const lookupConfigs = [
        {
          type: 'BOOLEAN',
          sourceField: 'isActive',
          targetField: 'statusCode',
          unmappedBehavior: 'PASSTHROUGH'
        },
        {
          type: 'PRIORITY',
          sourceField: 'priority',
          targetField: 'priorityCode',
          unmappedBehavior: 'PASSTHROUGH'
        }
      ];

      const event = { entityParentRid: 1, entityRid: 100 };

      const result = await applyLookups(payload, lookupConfigs, event);

      expect(result.statusCode).toBe('ACTIVE_CODE');
      expect(result.priorityCode).toBe('PRIORITY_1');
    });
  });

  afterAll(() => {
    const logger = require('../../src/logger');
    if (logger.closeLogStreams) {
      logger.closeLogStreams();
    }
  });
});
