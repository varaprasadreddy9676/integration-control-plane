import type { ConditionConfig } from '../../../../../mocks/types';

export interface ConditionRuleFormValue {
  eventTypes?: string[];
  action?: 'RELEASE_HELD' | 'DISCARD_HELD';
  matchKeys?: string[];
}

export const buildConditionConfigFromForm = (values: {
  conditionPayloadStrategy?: 'ORIGINAL_EVENT';
  conditionExpiresAfterHours?: number | null;
  conditionRules?: ConditionRuleFormValue[];
}): ConditionConfig | null => {
  const rules = Array.isArray(values.conditionRules)
    ? values.conditionRules
        .map((rule) => ({
          eventTypes: Array.isArray(rule?.eventTypes) ? rule.eventTypes.filter(Boolean) : [],
          action: rule?.action,
          matchKeys: Array.isArray(rule?.matchKeys) ? rule.matchKeys.filter(Boolean) : [],
        }))
        .filter((rule): rule is { eventTypes: string[]; action: 'RELEASE_HELD' | 'DISCARD_HELD'; matchKeys: string[] } =>
          rule.action === 'RELEASE_HELD' || rule.action === 'DISCARD_HELD'
        )
    : [];

  const releaseRules = rules.filter((rule) => rule.action === 'RELEASE_HELD');
  const discardRules = rules.filter((rule) => rule.action === 'DISCARD_HELD');
  const expiresAfterHours = values.conditionExpiresAfterHours;
  const expiresAfterMs =
    typeof expiresAfterHours === 'number' && Number.isFinite(expiresAfterHours) && expiresAfterHours > 0
      ? Math.round(expiresAfterHours * 60 * 60 * 1000)
      : null;

  if (releaseRules.length === 0 && discardRules.length === 0 && expiresAfterMs === null) {
    return null;
  }

  return {
    payloadStrategy: values.conditionPayloadStrategy || 'ORIGINAL_EVENT',
    expiresAfterMs,
    releaseRules,
    discardRules,
  };
};

export const conditionConfigToFormFields = (conditionConfig?: ConditionConfig | null) => {
  const rules = [
    ...((conditionConfig?.releaseRules || []).map((rule) => ({ ...rule, action: 'RELEASE_HELD' as const }))),
    ...((conditionConfig?.discardRules || []).map((rule) => ({ ...rule, action: 'DISCARD_HELD' as const }))),
  ];

  return {
    conditionPayloadStrategy: conditionConfig?.payloadStrategy || 'ORIGINAL_EVENT',
    conditionExpiresAfterHours:
      typeof conditionConfig?.expiresAfterMs === 'number' && conditionConfig.expiresAfterMs > 0
        ? Number((conditionConfig.expiresAfterMs / (60 * 60 * 1000)).toFixed(2))
        : null,
    conditionRules: rules,
  };
};
