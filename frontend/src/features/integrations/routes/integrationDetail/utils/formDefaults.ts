export const getFormInitialValues = (uiConfig: any) => ({
  httpMethod: 'POST',
  scope: 'INCLUDE_CHILDREN',
  excludedEntityRids: [],
  isActive: true,
  retryCount: uiConfig?.validationRules.retry.default ?? 3,
  timeoutMs: uiConfig?.validationRules.timeout.default ?? 3000,
  outgoingAuthType: 'NONE',
  enableSigning: false,
  signingSecret: null,
  signingSecrets: []
});
