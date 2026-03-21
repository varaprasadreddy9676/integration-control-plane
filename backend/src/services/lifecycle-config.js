'use strict';

const ALLOWED_LIFECYCLE_ACTIONS = ['CANCEL_PENDING', 'RESCHEDULE_PENDING', 'REPLACE_EXISTING', 'IGNORE'];
const INVALIDATING_ACTIONS = ['CANCEL_PENDING', 'RESCHEDULE_PENDING'];
const ALLOWED_SUBJECT_EXTRACTION_MODES = ['PATHS', 'SCRIPT'];

function validateExtractionScript(script) {
  if (!script || typeof script !== 'string') {
    return false;
  }

  try {
    // eslint-disable-next-line no-new-func
    new Function('payload', 'context', `async function __subjectExtraction(payload, context) { ${script} }`);
    return true;
  } catch (_error) {
    return false;
  }
}

function normalizeStringList(values) {
  if (!Array.isArray(values)) {
    return [];
  }

  return Array.from(
    new Set(
      values
        .filter((value) => typeof value === 'string' && value.trim() !== '')
        .map((value) => value.trim())
    )
  );
}

function normalizePathValue(value) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  if (Array.isArray(value)) {
    const normalized = normalizeStringList(value);
    return normalized.length > 0 ? normalized : undefined;
  }

  if (typeof value === 'string' && value.trim() !== '') {
    return value.trim();
  }

  return undefined;
}

function normalizePathMap(pathMap) {
  if (!pathMap || typeof pathMap !== 'object' || Array.isArray(pathMap)) {
    return null;
  }

  const normalized = {};
  for (const [key, value] of Object.entries(pathMap)) {
    if (typeof key !== 'string' || key.trim() === '') {
      continue;
    }

    const normalizedValue = normalizePathValue(value);
    if (normalizedValue !== undefined) {
      normalized[key.trim()] = normalizedValue;
    }
  }

  return Object.keys(normalized).length > 0 ? normalized : null;
}

function normalizeSubjectExtraction(subjectExtraction, legacySubjectMapping = null) {
  const legacyExtraction =
    legacySubjectMapping && typeof legacySubjectMapping === 'object' && !Array.isArray(legacySubjectMapping)
      ? { mode: 'PATHS', paths: legacySubjectMapping }
      : null;
  const source = subjectExtraction || legacyExtraction;

  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    return null;
  }

  const rawMode = typeof source.mode === 'string' ? source.mode.trim().toUpperCase() : 'PATHS';
  const mode = ALLOWED_SUBJECT_EXTRACTION_MODES.includes(rawMode) ? rawMode : null;
  if (!mode) {
    return null;
  }

  if (mode === 'SCRIPT') {
    const script = typeof source.script === 'string' ? source.script.trim() : '';
    return script
      ? {
          mode: 'SCRIPT',
          script,
        }
      : null;
  }

  const paths = normalizePathMap(source.paths || source);
  if (!paths) {
    return null;
  }

  return {
    mode: 'PATHS',
    paths,
  };
}

function normalizeLifecycleRules(lifecycleRules) {
  if (!Array.isArray(lifecycleRules)) {
    return [];
  }

  return lifecycleRules
    .map((rule) => ({
      eventTypes: normalizeStringList(rule?.eventTypes),
      action: typeof rule?.action === 'string' ? rule.action.trim() : '',
      matchKeys: normalizeStringList(rule?.matchKeys),
    }))
    .filter((rule) => rule.eventTypes.length > 0 || rule.action || rule.matchKeys.length > 0);
}

function deriveCancelOnEvents(lifecycleRules) {
  return Array.from(
    new Set(
      normalizeLifecycleRules(lifecycleRules)
        .filter((rule) => INVALIDATING_ACTIONS.includes(rule.action))
        .flatMap((rule) => rule.eventTypes)
    )
  );
}

function findLifecycleRule(lifecycleRules, eventType) {
  if (!eventType) {
    return null;
  }

  return normalizeLifecycleRules(lifecycleRules).find((rule) => rule.eventTypes.includes(eventType)) || null;
}

function validateLifecycleConfig({ resourceType, subjectExtraction, subjectMapping, lifecycleRules }) {
  const normalizedSubjectExtraction = normalizeSubjectExtraction(subjectExtraction, subjectMapping);
  const normalizedLifecycleRules = normalizeLifecycleRules(lifecycleRules);

  if (normalizedLifecycleRules.length === 0) {
    if (normalizedSubjectExtraction?.mode === 'SCRIPT' && !validateExtractionScript(normalizedSubjectExtraction.script)) {
      return { valid: false, error: 'Invalid subjectExtraction script' };
    }

    return {
      valid: true,
      normalizedSubjectExtraction,
      normalizedLifecycleRules: [],
      derivedCancelOnEvents: [],
    };
  }

  if (!resourceType || typeof resourceType !== 'string' || resourceType.trim() === '') {
    return { valid: false, error: 'resourceType is required when lifecycleRules are configured' };
  }

  if (!normalizedSubjectExtraction) {
    return { valid: false, error: 'subjectExtraction is required when lifecycleRules are configured' };
  }

  if (normalizedSubjectExtraction.mode === 'SCRIPT' && !validateExtractionScript(normalizedSubjectExtraction.script)) {
    return { valid: false, error: 'Invalid subjectExtraction script' };
  }

  const seenEventTypes = new Set();
  const availablePathKeys =
    normalizedSubjectExtraction.mode === 'PATHS' ? new Set(Object.keys(normalizedSubjectExtraction.paths || {})) : null;

  for (const rule of normalizedLifecycleRules) {
    if (!ALLOWED_LIFECYCLE_ACTIONS.includes(rule.action)) {
      return { valid: false, error: `Invalid lifecycle rule action: ${rule.action}` };
    }

    if (rule.eventTypes.length === 0) {
      return { valid: false, error: 'Each lifecycle rule must include at least one event type' };
    }

    for (const eventType of rule.eventTypes) {
      if (seenEventTypes.has(eventType)) {
        return { valid: false, error: `Duplicate lifecycle rule event type: ${eventType}` };
      }
      seenEventTypes.add(eventType);
    }

    if (rule.action !== 'IGNORE' && rule.matchKeys.length === 0) {
      return { valid: false, error: `Lifecycle rule for ${rule.eventTypes.join(', ')} must include at least one matchKey` };
    }

    if (availablePathKeys && rule.matchKeys.some((key) => !availablePathKeys.has(key))) {
      const missingKeys = rule.matchKeys.filter((key) => !availablePathKeys.has(key));
      return {
        valid: false,
        error: `Lifecycle rule references unmapped subject keys: ${missingKeys.join(', ')}`,
      };
    }
  }

  return {
    valid: true,
    normalizedSubjectExtraction,
    normalizedLifecycleRules,
    derivedCancelOnEvents: deriveCancelOnEvents(normalizedLifecycleRules),
  };
}

function buildLifecycleProfile(integration, eventType) {
  const lifecycleRule = findLifecycleRule(integration?.lifecycleRules, eventType);
  if (!lifecycleRule || !INVALIDATING_ACTIONS.includes(lifecycleRule.action)) {
    return null;
  }

  const normalizedSubjectExtraction = normalizeSubjectExtraction(
    integration?.subjectExtraction,
    integration?.subjectMapping
  );
  if (!normalizedSubjectExtraction) {
    return null;
  }

  return {
    integrationId: integration.id,
    integrationName: integration.name,
    eventType,
    action: lifecycleRule.action,
    subjectType: integration.resourceType || null,
    subjectExtraction: normalizedSubjectExtraction,
    lifecycleRule,
    matchKeys: lifecycleRule.matchKeys,
  };
}

module.exports = {
  ALLOWED_LIFECYCLE_ACTIONS,
  ALLOWED_SUBJECT_EXTRACTION_MODES,
  INVALIDATING_ACTIONS,
  normalizeSubjectExtraction,
  normalizeLifecycleRules,
  deriveCancelOnEvents,
  findLifecycleRule,
  validateLifecycleConfig,
  buildLifecycleProfile,
};
