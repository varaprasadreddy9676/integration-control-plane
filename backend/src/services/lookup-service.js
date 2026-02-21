const { resolveLookup } = require('../data');
const { log } = require('../logger');

/**
 * Get nested value from object using dot notation
 * Reused from transformer.js for consistency
 */
function getNestedValue(obj, path) {
  if (!path || !obj) return undefined;
  const keys = path.split('.');
  let value = obj;
  for (const key of keys) {
    value = value?.[key];
    if (value === undefined) return undefined;
  }
  return value;
}

/**
 * Set nested value in object using dot notation
 */
function setNestedValue(obj, path, value) {
  if (!path || !obj) return;
  const keys = path.split('.');
  let current = obj;

  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (!current[key] || typeof current[key] !== 'object') {
      current[key] = {};
    }
    current = current[key];
  }

  current[keys[keys.length - 1]] = value;
}

/**
 * Get unmapped value based on behavior
 */
function getUnmappedValue(sourceCode, unmappedBehavior, defaultValue) {
  switch (unmappedBehavior) {
    case 'FAIL':
      throw new Error(`Unmapped code: ${sourceCode}`);
    case 'DEFAULT':
      return defaultValue;
    case 'PASSTHROUGH':
    default:
      return sourceCode; // Keep original value
  }
}

/**
 * Apply mapping to array field
 * Example: items[].serviceCode -> items[].lisCode
 */
async function applyMappingToArray(
  payload,
  type,
  sourceField,
  targetField,
  entityParentRid,
  orgUnitRid,
  unmappedBehavior,
  defaultValue
) {
  // Split array notation: items[].serviceCode -> ["items", "serviceCode"]
  const [arrayPath, sourceFieldName] = sourceField.split('[].');
  const [, targetFieldName] = targetField.split('[].');

  const array = getNestedValue(payload, arrayPath);

  if (Array.isArray(array)) {
    for (const item of array) {
      const sourceValue = item[sourceFieldName];

      // Only process non-empty, non-null, non-undefined values
      if (sourceValue !== null && sourceValue !== undefined && sourceValue !== '') {
        const mappedValue = await resolveLookup(sourceValue, type, entityParentRid, orgUnitRid);

        if (mappedValue !== null) {
          // Mapping found - set to target field
          item[targetFieldName] = mappedValue;
        } else {
          // Mapping NOT found - apply unmapped behavior
          const fallbackValue = getUnmappedValue(sourceValue, unmappedBehavior, defaultValue);
          item[targetFieldName] = fallbackValue;
        }
      }
    }
  }

  return payload;
}

/**
 * Apply single lookup configuration to payload
 */
async function applyLookupConfig(payload, config, entityParentRid, orgUnitRid) {
  const { type, sourceField, targetField, unmappedBehavior, defaultValue } = config;

  // Handle array notation: items[].serviceCode
  if (sourceField.includes('[]')) {
    payload = await applyMappingToArray(
      payload,
      type,
      sourceField,
      targetField,
      entityParentRid,
      orgUnitRid,
      unmappedBehavior,
      defaultValue
    );
  } else {
    // Handle simple field: serviceCode
    const sourceValue = getNestedValue(payload, sourceField);

    // Only process non-empty, non-null, non-undefined values
    if (sourceValue !== null && sourceValue !== undefined && sourceValue !== '') {
      const mappedValue = await resolveLookup(sourceValue, type, entityParentRid, orgUnitRid);

      if (mappedValue !== null) {
        // Mapping found - use it
        setNestedValue(payload, targetField, mappedValue);
      } else {
        // Mapping NOT found - apply unmapped behavior
        const fallbackValue = getUnmappedValue(sourceValue, unmappedBehavior, defaultValue);
        setNestedValue(payload, targetField, fallbackValue);
      }
    }
  }

  return payload;
}

/**
 * Apply all lookup configurations to payload
 * This is the main entry point called from transformation pipeline
 */
async function applyLookups(payload, lookupConfigs, event) {
  if (!lookupConfigs || lookupConfigs.length === 0) {
    return payload;
  }

  const entityParentRid = event.entityParentRid || event.entity_parent_rid;
  const orgUnitRid = event.orgUnitRid || event.entityRid || event.entity_rid;

  log('debug', 'Applying lookups', {
    scope: 'applyLookups',
    entityParentRid,
    orgUnitRid,
    configCount: lookupConfigs.length
  });

  // Apply each lookup config sequentially
  for (const config of lookupConfigs) {
    try {
      payload = await applyLookupConfig(payload, config, entityParentRid, orgUnitRid);
    } catch (err) {
      // If unmappedBehavior is FAIL, throw error to stop delivery
      if (config.unmappedBehavior === 'FAIL') {
        log('error', 'Lookup failed with FAIL behavior', {
          scope: 'applyLookups',
          type: config.type,
          sourceField: config.sourceField,
          error: err.message
        });
        throw err;
      }

      // Otherwise log warning and continue
      log('warn', 'Lookup application failed, continuing', {
        scope: 'applyLookups',
        type: config.type,
        sourceField: config.sourceField,
        error: err.message
      });
    }
  }

  return payload;
}

/**
 * Test lookup configurations against sample payload
 * Returns transformed payload and any errors encountered
 */
async function testLookups(payload, lookupConfigs, entityParentRid, orgUnitRid) {
  const errors = [];
  let testPayload = JSON.parse(JSON.stringify(payload)); // Deep clone

  const event = { entityParentRid, orgUnitRid };

  for (let i = 0; i < lookupConfigs.length; i++) {
    const config = lookupConfigs[i];
    try {
      testPayload = await applyLookupConfig(testPayload, config, entityParentRid, orgUnitRid);
    } catch (err) {
      errors.push({
        index: i,
        type: config.type,
        sourceField: config.sourceField,
        error: err.message
      });
    }
  }

  return {
    transformed: testPayload,
    errors
  };
}

module.exports = {
  applyLookups,
  testLookups,
  getNestedValue,
  setNestedValue,
  resolveLookup
};
