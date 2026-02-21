export type IntegrationScope = 'ENTITY_ONLY' | 'INCLUDE_CHILDREN';
export type TransformationMode = 'SIMPLE' | 'SCRIPT';
export type OutgoingAuthType = 'NONE' | 'API_KEY' | 'BASIC' | 'BEARER' | 'OAUTH2' | 'CUSTOM' | 'CUSTOM_HEADERS';
export type DeliveryMode = 'IMMEDIATE' | 'DELAYED' | 'RECURRING';
export type ScheduledIntegrationStatus = 'PENDING' | 'SENT' | 'FAILED' | 'CANCELLED' | 'OVERDUE';

export interface SchedulingConfig {
  script: string;
  timezone?: string;
  description?: string;
}

export interface ScheduledIntegration {
  id: string;
  __KEEP___KEEP_integrationConfig__Id__: string;
  __KEEP_integrationName__: string;
  integrationConfigId?: string; // Mapped field for convenience
  integrationName?: string; // Mapped field for convenience
  tenantId: number;
  orgId?: number;
  originalEventId: string;
  eventType: string;
  scheduledFor: string;
  status: ScheduledIntegrationStatus;
  payload?: Record<string, unknown>;
  targetUrl: string;
  httpMethod: 'POST' | 'PUT';
  errorMessage?: string;
  deliveredAt?: string;
  attemptCount?: number;
  cancellationInfo?: {
    patientRid?: number;
    scheduledDateTime?: string;
  };
  recurringConfig?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface IntegrationAction {
  name: string;
  kind?: 'HTTP' | 'COMMUNICATION' | string;
  condition?: string;
  targetUrl?: string;
  httpMethod?: 'POST' | 'PUT';
  communicationConfig?: {
    channel?: string;
    provider?: string;
    smtp?: {
      host?: string;
      port?: number;
      username?: string;
      password?: string;
      fromEmail?: string;
    };
    [key: string]: unknown;
  };
  transformationMode?: TransformationMode;
  transformation?: {
    mode?: TransformationMode;
    mappings?: Array<Record<string, unknown>>;
    staticFields?: Array<Record<string, unknown>>;
    script?: string;
  };
}

export interface IntegrationConfig {
  id: string;
  type?: string;
  name: string;
  eventType: string;
  tenantId: number;
  entityName: string;
  scope: IntegrationScope;
  excludedEntityRids?: number[];
  targetUrl: string;
  httpMethod: 'POST' | 'PUT';
  outgoingAuthType: OutgoingAuthType;
  outgoingAuthConfig?: Record<string, unknown>;
  isActive: boolean;
  timeoutMs: number;
  retryCount: number;
  transformationMode: TransformationMode;
  transformation?: {
    mode: TransformationMode;
    mappings?: Array<Record<string, unknown>>;
    staticFields?: Array<Record<string, unknown>>;
    script?: string;
  };
  actions?: IntegrationAction[]; // Multi-action integration support
  isInherited?: boolean;
  sourceEntityName?: string;
  // Integration signing (opt-in security feature)
  enableSigning?: boolean;
  signingSecret?: string;
  signingSecrets?: string[];
  signatureVersion?: string;
  // Delivery scheduling (opt-in scheduling feature)
  deliveryMode?: DeliveryMode;
  schedulingConfig?: SchedulingConfig;
  // Lookup configurations
  lookups?: LookupConfig[];
  updatedAt: string;
}

export type DeliveryStatus = 'PENDING' | 'SUCCESS' | 'FAILED' | 'RETRYING' | 'ABANDONED' | 'SKIPPED';
export type EventAuditStatus = 'RECEIVED' | 'PROCESSING' | 'DELIVERED' | 'SKIPPED' | 'FAILED' | 'STUCK';

export type AlertChannel = 'EMAIL' | 'SMS' | 'WHATSAPP' | 'SLACK' | 'WEBHOOK' | 'IN_APP';
export type AlertStatus = 'SENT' | 'FAILED' | 'SKIPPED';

export interface AlertCenterLog {
  id: string;
  tenantId: number;
  type: string;
  channel: AlertChannel | string;
  status: AlertStatus | string;
  subject?: string | null;
  recipients?: string[];
  totalFailures?: number | null;
  windowStart?: string | null;
  windowEnd?: string | null;
  errorMessage?: string | null;
  errorStack?: string | null;
  payload?: any | null;
  providerUrl?: string | null;
  providerResponse?: { status: number; body: string } | null;
  createdAt: string;
}

export interface DeliveryAttempt {
  attemptNumber: number;
  status: DeliveryStatus;
  responseStatus: number | null;
  responseBody?: string;
  responseTimeMs: number | null;
  errorMessage?: string;
  requestPayload: Record<string, unknown>;
  requestHeaders: Record<string, unknown>;
  targetUrl: string;
  httpMethod: string;
  attemptedAt: string;
  retryReason?: string;
}

export interface DeliveryLog {
  id: string;
  __KEEP___KEEP_integrationConfig__Id__: string;
  __KEEP_integrationName__: string;
  eventType: string;
  integrationType?: string;
  direction?: 'INBOUND' | 'OUTBOUND' | 'SCHEDULED' | string;
  triggerType?: 'EVENT' | 'SCHEDULED' | 'MANUAL' | 'REPLAY' | string;
  actionName?: string | null;
  actionIndex?: number | null;
  status: DeliveryStatus;
  errorCategory?: string | null;
  responseStatus: number | null;
  responseTimeMs: number;
  attemptCount: number;
  createdAt: string;
  errorMessage?: string;
  requestPayload: Record<string, unknown>;
  responseBody?: string;
  targetUrl?: string;
  httpMethod?: string;
  request?: {
    headers?: Record<string, unknown>;
    body?: unknown;
    url?: string | null;
    method?: string | null;
  };
  requestHeaders?: Record<string, unknown>; // Actual request headers sent (for debugging)
  __KEEP_integrationConfig__?: IntegrationConfig; // Enhanced with integration configuration details
  retryAttempts?: DeliveryAttempt[]; // Detailed retry attempts for enhanced UI
  metadata?: {
    recordsFetched?: number;
    dataFetched?: unknown;
    transformedPayload?: unknown;
    httpRequest?: {
      method?: string;
      url?: string;
      headers?: Record<string, unknown>;
      body?: unknown;
    };
    curlCommand?: string;
    errorContext?: {
      stage?: string;
    };
  };
}

export interface EventAuditTimelineEntry {
  ts: string;
  stage: string;
  details?: string;
}

export interface EventAuditRecord {
  id?: string;
  _id?: string;
  eventId: string;
  eventKey?: string;
  eventType?: string;
  source?: string;
  sourceId?: string;
  tenantId?: number;
  orgId?: number | null;
  receivedAt?: string;
  processingStartedAt?: string;
  processedAt?: string;
  processingCompletedAt?: string;
  processingTimeMs?: number;
  status?: EventAuditStatus;
  skipCategory?: string | null;
  skipReason?: string | null;
  duplicateType?: string | null;
  errorMessage?: string | null;
  errorStack?: string | null;
  payload?: any | null;
  payloadHash?: string;
  payloadSummary?: Record<string, unknown>;
  payloadSize?: number;
  deliveryStatus?: {
    integrationsMatched?: number;
    deliveredCount?: number;
    failedCount?: number;
    deliveryLogIds?: string[];
  };
  integrationIds?: string[];
  timeline?: EventAuditTimelineEntry[];
}

export interface DashboardSummary {
  totalDeliveries24h: number;
  successRate24h: number;
  failedCount24h: number;
  avgResponseTimeMs24h: number;
  integrationHealth: Array<{
    id: string;
    name: string;
    status: 'GREEN' | 'YELLOW' | 'RED';
    failureCount24h: number;
  }>;
  recentFailures: DeliveryLog[];
}

export interface TenantInfo {
  orgId: number;
  tenantName: string;
  tenantCode: string;
  tenantEmail?: string | null;
  tenantPhone?: string | null;
  tenantAddress?: string | null;
  tenantTags?: string[] | null;
  region: string;
  timezone: string;
  childEntities: Array<{ rid: number; name: string; code: string }>;
}

export interface IntegrationTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  eventType: string;
  targetUrl?: string;
  httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE';
  authType?: OutgoingAuthType;
  authConfig?: Record<string, any>;
  headers?: Record<string, string>;
  timeoutMs?: number;
  retryCount?: number;
  transformationMode?: TransformationMode | null;
  transformation?: {
    mode?: TransformationMode;
    mappings?: Array<Record<string, unknown>>;
    staticFields?: Array<Record<string, unknown>>;
    script?: string;
  };
  actions?: Array<{
    name: string;
    condition?: string;
    targetUrl?: string;
    httpMethod?: string;
    transformationMode?: TransformationMode;
    transformation?: {
      script?: string;
      mappings?: Array<Record<string, unknown>>;
    };
  }>;
  isActive?: boolean;
  metadata?: {
    source?: string;
    version?: string;
    tags?: string[];
    documentation?: string;
    placeholders?: Record<string, string>;
    examples?: Array<{
      name: string;
      eventType?: string;
      templateName?: string;
      params?: string[];
    }>;
    vendor?: string;
  };
  createdAt?: string;
  updatedAt?: string;
  isCustom?: boolean;
}

// Lookup Tables
export type UnmappedBehavior = 'PASSTHROUGH' | 'FAIL' | 'DEFAULT';

export interface LookupSource {
  id: string;
  label?: string;
}

export interface LookupTarget {
  id: string;
  label?: string;
}

export interface Lookup {
  id: string;
  orgId: number;
  tenantId: number | null;
  type: string;
  source: LookupSource;
  target: LookupTarget;
  isActive: boolean;
  version: number;
  usageCount: number;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
  updatedBy?: string;
}

export interface LookupConfig {
  type: string;
  sourceField: string;
  targetField: string;
  unmappedBehavior: UnmappedBehavior;
  defaultValue?: string;
}

export interface LookupStats {
  totalMappings: number;
  activeParent: number;
  activeEntity: number;
  typesCount: number;
  mostUsedTypes: Array<{
    type: string;
    count: number;
    lastUsedAt: string | null;
  }>;
  recentlyUsed: Array<{
    type: string;
    sourceId: string;
    targetId: string;
    usageCount: number;
    lastUsedAt: string;
  }>;
}

export interface LookupImportResult {
  message: string;
  imported: number;
  updated: number;
  skipped: number;
  errors: Array<{
    row: number;
    error: string;
  }>;
}

export interface LookupTestResult {
  originalPayload: Record<string, any>;
  transformedPayload: Record<string, any>;
  appliedMappings: Array<{
    field: string;
    sourceValue: any;
    targetValue: any;
    mappingType: string;
  }>;
  unmappedFields: Array<{
    field: string;
    value: any;
    reason: string;
  }>;
}
