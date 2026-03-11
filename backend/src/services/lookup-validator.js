const { log } = require('../logger');

/**
 * Validate lookup configuration in integration config
 * This validation runs at config-time (when integration is saved)
 * All errors are caught early to prevent runtime issues
 */
function validateLookupConfig(lookupConfig) {
  const { type, sourceField, sourceTemplate, targetField, unmappedBehavior, defaultValue, returnMode } = lookupConfig;

  // Validation 1: Required fields
  if (!type || !targetField || (!sourceField && !sourceTemplate)) {
    throw new Error('Lookup config requires type, targetField, and either sourceField or sourceTemplate');
  }

  // Validation 2: Valid unmappedBehavior
  const validBehaviors = ['PASSTHROUGH', 'FAIL', 'DEFAULT'];
  if (unmappedBehavior && !validBehaviors.includes(unmappedBehavior)) {
    throw new Error(
      `Invalid unmappedBehavior: "${unmappedBehavior}". ` + `Must be one of: ${validBehaviors.join(', ')}`
    );
  }

  // Validation 3: DEFAULT requires defaultValue
  if (unmappedBehavior === 'DEFAULT' && !Object.hasOwn(lookupConfig, 'defaultValue')) {
    throw new Error('unmappedBehavior=DEFAULT requires defaultValue to be set');
  }

  if (returnMode && !['SCALAR', 'OBJECT'].includes(returnMode)) {
    throw new Error('returnMode must be SCALAR or OBJECT');
  }

  // Validation 4: Array notation consistency
  const sourceIsArray = sourceField ? sourceField.includes('[]') : false;
  const targetIsArray = targetField.includes('[]');

  if (!sourceField && targetIsArray) {
    throw new Error('sourceField is required when targetField uses [] notation');
  }

  if (sourceField && sourceIsArray !== targetIsArray) {
    throw new Error(
      `Invalid lookup config: sourceField="${sourceField}" and targetField="${targetField}" ` +
        `must both use [] notation or both omit it. Cannot map array to scalar or vice versa.`
    );
  }

  // Validation 5: Array notation format and consistency
  if (sourceIsArray) {
    // Check basic format: must contain exactly one [] followed by a dot and field name
    const arrayPattern = /^.+\[\]\..+$/;

    if (!arrayPattern.test(sourceField)) {
      throw new Error(
        `Invalid sourceField format: "${sourceField}". ` +
          `Array notation must follow pattern: "arrayPath[].fieldName" ` +
          `(e.g., "items[].code", "data.orders[].serviceId", "lab-items[].test-code")`
      );
    }

    if (!arrayPattern.test(targetField)) {
      throw new Error(
        `Invalid targetField format: "${targetField}". ` +
          `Array notation must follow pattern: "arrayPath[].fieldName" ` +
          `(e.g., "items[].code", "data.orders[].serviceId", "lab-items[].test-code")`
      );
    }

    // Split and validate
    const sourceParts = sourceField.split('[].');
    const targetParts = targetField.split('[].');

    if (sourceParts.length !== 2) {
      throw new Error(`sourceField "${sourceField}" has invalid format (multiple [] or malformed path)`);
    }

    if (targetParts.length !== 2) {
      throw new Error(`targetField "${targetField}" has invalid format (multiple [] or malformed path)`);
    }

    // Validation 6: Array paths must match
    const sourceArrayPath = sourceParts[0];
    const targetArrayPath = targetParts[0];

    if (sourceArrayPath !== targetArrayPath) {
      throw new Error(
        `Array path mismatch: sourceField uses "${sourceArrayPath}[]" but ` +
          `targetField uses "${targetArrayPath}[]". Array paths must be identical.`
      );
    }
  }

  return true;
}

/**
 * Validate array of lookup configurations
 */
function validateLookupConfigs(lookupConfigs) {
  if (!Array.isArray(lookupConfigs)) {
    throw new Error('lookups must be an array');
  }

  for (let i = 0; i < lookupConfigs.length; i++) {
    try {
      validateLookupConfig(lookupConfigs[i]);
    } catch (err) {
      throw new Error(`Lookup config at index ${i}: ${err.message}`);
    }
  }

  return true;
}

/**
 * Validate single lookup entry (for CRUD operations)
 */
function validateLookupEntry(lookup) {
  const errors = [];

  // Required fields
  if (!lookup.type) {
    errors.push('type is required');
  }
  if (!lookup.source || (!lookup.source.id && !lookup.source.key)) {
    errors.push('source.id or source.key is required');
  }
  if (!lookup.target || typeof lookup.target !== 'object' || Array.isArray(lookup.target)) {
    errors.push('target object is required');
  }

  const orgUnitRid = lookup.orgUnitRid !== undefined ? lookup.orgUnitRid : lookup.entityRid;
  // orgUnitRid must be a number or null
  if (orgUnitRid !== undefined && orgUnitRid !== null && typeof orgUnitRid !== 'number') {
    errors.push('orgUnitRid must be a number or null');
  }

  if (errors.length > 0) {
    throw new Error(`Invalid lookup entry: ${errors.join(', ')}`);
  }

  return true;
}

/**
 * Validate bulk import data
 */
function validateBulkImport(lookups) {
  if (!Array.isArray(lookups)) {
    throw new Error('Import data must be an array');
  }

  if (lookups.length === 0) {
    throw new Error('Import data cannot be empty');
  }

  // Check for duplicate source.id within the import
  const sourceIds = new Set();
  const duplicates = [];

  for (let i = 0; i < lookups.length; i++) {
    const lookup = lookups[i];

    // Validate each entry
    try {
      validateLookupEntry(lookup);
    } catch (err) {
      throw new Error(`Row ${i + 1}: ${err.message}`);
    }

    // Check for duplicates
    const orgUnitRid = lookup.orgUnitRid !== undefined ? lookup.orgUnitRid : lookup.entityRid;
    const sourceMatchKey = lookup.source.key || lookup.source.id;
    const key = `${lookup.type}:${orgUnitRid || 'null'}:${sourceMatchKey}`;
    if (sourceIds.has(key)) {
      duplicates.push({
        row: i + 1,
        sourceId: sourceMatchKey,
        type: lookup.type,
      });
    }
    sourceIds.add(key);
  }

  if (duplicates.length > 0) {
    throw new Error(
      `Import contains duplicate source IDs: ${duplicates.map((d) => `row ${d.row} (${d.type}: ${d.sourceId})`).join(', ')}`
    );
  }

  return true;
}

module.exports = {
  validateLookupConfig,
  validateLookupConfigs,
  validateLookupEntry,
  validateBulkImport,
};
