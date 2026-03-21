'use strict';

const { normalizeSubjectExtraction } = require('./lifecycle-config');

const CONDITION_DELIVERY_MODES = ['WAIT_FOR_EVENT', 'WAIT_FOR_CONDITION'];
const ALLOWED_CONDITION_ACTIONS = ['RELEASE_HELD', 'DISCARD_HELD'];
const ALLOWED_PAYLOAD_STRATEGIES = ['ORIGINAL_EVENT'];

function normalizeDeliveryMode(deliveryMode) {
  if (typeof deliveryMode !== 'string' || deliveryMode.trim() === '') {
    return 'IMMEDIATE';
  }

  const normalized = deliveryMode.trim().toUpperCase();
  if (normalized === 'WAIT_FOR_EVENT') {
    return 'WAIT_FOR_CONDITION';
  }

  return normalized;
}

function isConditionDeliveryMode(deliveryMode) {
  return normalizeDeliveryMode(deliveryMode) === 'WAIT_FOR_CONDITION';
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

function normalizeConditionRules(rules) {
  if (!Array.isArray(rules)) {
    return [];
  }

  return rules
    .map((rule) => ({
      eventTypes: normalizeStringList(rule?.eventTypes),
      action: typeof rule?.action === 'string' ? rule.action.trim() : '',
      matchKeys: normalizeStringList(rule?.matchKeys),
    }))
    .filter((rule) => rule.eventTypes.length > 0 || rule.action || rule.matchKeys.length > 0);
}

function normalizeConditionConfig(conditionConfig) {
  if (!conditionConfig || typeof conditionConfig !== 'object' || Array.isArray(conditionConfig)) {
    return null;
  }

  const payloadStrategy = typeof conditionConfig.payloadStrategy === 'string'
    ? conditionConfig.payloadStrategy.trim().toUpperCase()
    : 'ORIGINAL_EVENT';

  const expiresAfterMsRaw = conditionConfig.expiresAfterMs;
  const expiresAfterMs = Number.isFinite(Number(expiresAfterMsRaw)) && Number(expiresAfterMsRaw) > 0
    ? Math.floor(Number(expiresAfterMsRaw))
    : null;

  const releaseRules = normalizeConditionRules(conditionConfig.releaseRules);
  const discardRules = normalizeConditionRules(conditionConfig.discardRules);

  if (
    releaseRules.length === 0 &&
    discardRules.length === 0 &&
    payloadStrategy === 'ORIGINAL_EVENT' &&
    expiresAfterMs === null
  ) {
    return null;
  }

  return {
    payloadStrategy: ALLOWED_PAYLOAD_STRATEGIES.includes(payloadStrategy) ? payloadStrategy : payloadStrategy,
    expiresAfterMs,
    releaseRules,
    discardRules,
  };
}

function findConditionRule(conditionConfig, eventType) {
  if (!eventType) {
    return null;
  }

  const normalized = normalizeConditionConfig(conditionConfig);
  if (!normalized) {
    return null;
  }

  return [...normalized.releaseRules, ...normalized.discardRules].find((rule) => rule.eventTypes.includes(eventType)) || null;
}

function validateConditionConfig({ deliveryMode, resourceType, subjectExtraction, subjectMapping, conditionConfig }) {
  const normalizedDeliveryMode = normalizeDeliveryMode(deliveryMode);
  const normalizedConditionConfig = normalizeConditionConfig(conditionConfig);
  const normalizedSubjectExtraction = normalizeSubjectExtraction(subjectExtraction, subjectMapping);

  if (!normalizedConditionConfig) {
    if (normalizedDeliveryMode === 'WAIT_FOR_CONDITION') {
      return { valid: false, error: 'conditionConfig is required for WAIT_FOR_CONDITION delivery mode' };
    }

    return {
      valid: true,
      normalizedDeliveryMode,
      normalizedSubjectExtraction,
      normalizedConditionConfig: null,
    };
  }

  if (normalizedDeliveryMode !== 'WAIT_FOR_CONDITION') {
    return { valid: false, error: 'conditionConfig can only be used with WAIT_FOR_CONDITION delivery mode' };
  }

  if (!resourceType || typeof resourceType !== 'string' || resourceType.trim() === '') {
    return { valid: false, error: 'resourceType is required when conditionConfig is configured' };
  }

  if (!normalizedSubjectExtraction) {
    return { valid: false, error: 'subjectExtraction is required when conditionConfig is configured' };
  }

  if (normalizedConditionConfig.releaseRules.length === 0) {
    return { valid: false, error: 'conditionConfig requires at least one release rule' };
  }

  if (!ALLOWED_PAYLOAD_STRATEGIES.includes(normalizedConditionConfig.payloadStrategy)) {
    return { valid: false, error: `Invalid condition payload strategy: ${normalizedConditionConfig.payloadStrategy}` };
  }

  const seenEventTypes = new Set();
  const availablePathKeys =
    normalizedSubjectExtraction.mode === 'PATHS' ? new Set(Object.keys(normalizedSubjectExtraction.paths || {})) : null;

  for (const rule of [...normalizedConditionConfig.releaseRules, ...normalizedConditionConfig.discardRules]) {
    if (!ALLOWED_CONDITION_ACTIONS.includes(rule.action)) {
      return { valid: false, error: `Invalid condition rule action: ${rule.action}` };
    }

    if (rule.eventTypes.length === 0) {
      return { valid: false, error: 'Each condition rule must include at least one event type' };
    }

    if (rule.matchKeys.length === 0) {
      return { valid: false, error: `Condition rule for ${rule.eventTypes.join(', ')} must include at least one matchKey` };
    }

    for (const eventType of rule.eventTypes) {
      if (seenEventTypes.has(eventType)) {
        return { valid: false, error: `Duplicate condition rule event type: ${eventType}` };
      }
      seenEventTypes.add(eventType);
    }

    if (availablePathKeys && rule.matchKeys.some((key) => !availablePathKeys.has(key))) {
      const missingKeys = rule.matchKeys.filter((key) => !availablePathKeys.has(key));
      return {
        valid: false,
        error: `Condition rule references unmapped subject keys: ${missingKeys.join(', ')}`,
      };
    }
  }

  return {
    valid: true,
    normalizedDeliveryMode,
    normalizedSubjectExtraction,
    normalizedConditionConfig,
  };
}

function buildConditionProfile(integration, eventType) {
  const deliveryMode = normalizeDeliveryMode(integration?.deliveryMode);
  if (deliveryMode !== 'WAIT_FOR_CONDITION') {
    return null;
  }

  const conditionRule = findConditionRule(integration?.conditionConfig, eventType);
  if (!conditionRule) {
    return null;
  }

  const subjectExtraction = normalizeSubjectExtraction(integration?.subjectExtraction, integration?.subjectMapping);
  if (!subjectExtraction) {
    return null;
  }

  return {
    integrationId: integration.id,
    integrationName: integration.name,
    integration,
    eventType,
    action: conditionRule.action,
    subjectType: integration.resourceType || null,
    subjectExtraction,
    conditionRule,
    matchKeys: conditionRule.matchKeys,
    payloadStrategy: integration?.conditionConfig?.payloadStrategy || 'ORIGINAL_EVENT',
  };
}

module.exports = {
  CONDITION_DELIVERY_MODES,
  ALLOWED_CONDITION_ACTIONS,
  ALLOWED_PAYLOAD_STRATEGIES,
  normalizeDeliveryMode,
  isConditionDeliveryMode,
  normalizeConditionRules,
  normalizeConditionConfig,
  findConditionRule,
  validateConditionConfig,
  buildConditionProfile,
};
