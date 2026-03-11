const { resolveLookup, resolveLookupObject } = require('../data');
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

function renderLookupTemplate(template, scope = {}) {
  if (!template || typeof template !== 'string') return '';
  return template.replace(/\{\{\s*([^}]+)\s*\}\}/g, (_match, expr) => {
    const path = String(expr || '').trim();
    if (!path) return '';
    const direct = getNestedValue(scope, path);
    if (direct !== undefined && direct !== null) return String(direct);
    const itemScoped = getNestedValue(scope.item, path);
    if (itemScoped !== undefined && itemScoped !== null) return String(itemScoped);
    const payloadScoped = getNestedValue(scope.payload, path);
    if (payloadScoped !== undefined && payloadScoped !== null) return String(payloadScoped);
    return '';
  });
}

async function resolveConfiguredLookupValue(sourceValue, config, orgId, orgUnitRid) {
  const returnMode = String(config.returnMode || 'SCALAR').toUpperCase();
  if (returnMode === 'OBJECT') {
    return resolveLookupObject(sourceValue, config.type, orgId, orgUnitRid);
  }

  const targetValueField = config.targetValueField || 'id';
  if (targetValueField !== 'id') {
    return resolveLookup(sourceValue, config.type, orgId, orgUnitRid, targetValueField);
  }

  return resolveLookup(sourceValue, config.type, orgId, orgUnitRid);
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
  config,
  sourceField,
  targetField,
  orgId,
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
      const sourceValue = config.sourceTemplate
        ? renderLookupTemplate(config.sourceTemplate, { item, payload })
        : item[sourceFieldName];

      // Only process non-empty, non-null, non-undefined values
      if (sourceValue !== null && sourceValue !== undefined && sourceValue !== '') {
        const mappedValue = await resolveConfiguredLookupValue(sourceValue, config, orgId, orgUnitRid);

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
async function applyLookupConfig(payload, config, orgId, orgUnitRid) {
  const { sourceField, targetField, unmappedBehavior, defaultValue } = config;

  // Handle array notation: items[].serviceCode
  if (sourceField && sourceField.includes('[]')) {
    payload = await applyMappingToArray(
      payload,
      config,
      sourceField,
      targetField,
      orgId,
      orgUnitRid,
      unmappedBehavior,
      defaultValue
    );
  } else {
    // Handle simple field: serviceCode
    const sourceValue = config.sourceTemplate
      ? renderLookupTemplate(config.sourceTemplate, payload)
      : getNestedValue(payload, sourceField);

    // Only process non-empty, non-null, non-undefined values
    if (sourceValue !== null && sourceValue !== undefined && sourceValue !== '') {
      const mappedValue = await resolveConfiguredLookupValue(sourceValue, config, orgId, orgUnitRid);

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

  const orgId = event.orgId || event.entityParentRid || event.entity_parent_rid;
  const orgUnitRid = event.orgUnitRid || event.entityRid || event.entity_rid;

  log('debug', 'Applying lookups', {
    scope: 'applyLookups',
    orgId,
    orgUnitRid,
    configCount: lookupConfigs.length,
  });

  // Apply each lookup config sequentially
  for (const config of lookupConfigs) {
    try {
      payload = await applyLookupConfig(payload, config, orgId, orgUnitRid);
    } catch (err) {
      // If unmappedBehavior is FAIL, throw error to stop delivery
      if (config.unmappedBehavior === 'FAIL') {
        log('error', 'Lookup failed with FAIL behavior', {
          scope: 'applyLookups',
          type: config.type,
          sourceField: config.sourceField,
          error: err.message,
        });
        throw err;
      }

      // Otherwise log warning and continue
      log('warn', 'Lookup application failed, continuing', {
        scope: 'applyLookups',
        type: config.type,
        sourceField: config.sourceField,
        error: err.message,
      });
    }
  }

  return payload;
}

/**
 * Test lookup configurations against sample payload
 * Returns transformed payload and any errors encountered
 */
async function testLookups(payload, lookupConfigs, orgId, orgUnitRid) {
  const errors = [];
  let testPayload = JSON.parse(JSON.stringify(payload)); // Deep clone

  for (let i = 0; i < lookupConfigs.length; i++) {
    const config = lookupConfigs[i];
    try {
      testPayload = await applyLookupConfig(testPayload, config, orgId, orgUnitRid);
    } catch (err) {
      errors.push({
        index: i,
        type: config.type,
        sourceField: config.sourceField,
        error: err.message,
      });
    }
  }

  return {
    transformed: testPayload,
    errors,
  };
}

module.exports = {
  applyLookups,
  testLookups,
  getNestedValue,
  setNestedValue,
  resolveLookup,
  resolveLookupObject,
  renderLookupTemplate,
};
