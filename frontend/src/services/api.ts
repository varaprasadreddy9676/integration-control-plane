import type { AlertCenterLog, DashboardSummary, DeliveryLog, ScheduledIntegration, TenantInfo, IntegrationConfig, EventAuditRecord } from '../mocks/types';
import { getAuthToken, clearAuthStorage } from '../utils/auth-storage';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000/api/v1';
const API_KEY = import.meta.env.VITE_API_KEY || 'mdcs_dev_key_1f4a';

const buildAuthHeaders = (extra: HeadersInit = {}) => {
  const authToken = getAuthToken();
  return {
    'Content-Type': 'application/json',
    'X-API-Key': API_KEY,
    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    ...extra
  } as HeadersInit;
};

const buildAuthHeadersNoContentType = (extra: HeadersInit = {}) => {
  const authToken = getAuthToken();
  return {
    'X-API-Key': API_KEY,
    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    ...extra
  } as HeadersInit;
};

// Store the current orgId for automatic inclusion in all API requests
let currentOrgId: number | null = null;

// Error types for better error handling
export class APIError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public code?: string,
    public details?: any
  ) {
    super(message);
    this.name = 'APIError';
  }
}

export class NetworkError extends Error {
  constructor(message: string, public originalError?: any) {
    super(message);
    this.name = 'NetworkError';
  }
}

export class TimeoutError extends Error {
  constructor(message: string = 'Request timeout') {
    super(message);
    this.name = 'TimeoutError';
  }
}

/**
 * Set the orgId to be automatically included in all API requests.
 * This should be called by the TenantProvider when extracting the value from the URL.
 */
export const setCurrentOrgId = (orgId: number | null) => {
  currentOrgId = orgId;
};

/**
 * Get the current orgId
 */
export const getCurrentOrgId = (): number | null => currentOrgId;

/**
 * Configuration for retry logic
 */
interface RetryConfig {
  maxRetries: number;
  retryDelay: number;
  retryableStatuses: number[];
  backoffMultiplier: number;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  retryDelay: 1000, // 1 second
  retryableStatuses: [408, 429, 500, 502, 503, 504], // Timeout, rate limit, server errors
  backoffMultiplier: 2 // Exponential backoff
};

/**
 * Sleep for specified milliseconds
 */
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Check if error is retryable
 */
const isRetryable = (error: any, statusCode?: number): boolean => {
  // Network errors are retryable
  if (error instanceof NetworkError) {
    return true;
  }

  // Timeout errors are retryable
  if (error instanceof TimeoutError) {
    return true;
  }

  // Check status codes
  if (statusCode && DEFAULT_RETRY_CONFIG.retryableStatuses.includes(statusCode)) {
    return true;
  }

  return false;
};

/**
 * Fetch with timeout support
 */
const fetchWithTimeout = async (
  url: string,
  options: RequestInit = {},
  timeoutMs: number = 30000
): Promise<Response> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new TimeoutError(`Request timeout after ${timeoutMs}ms`);
    }
    throw error;
  }
};

/**
 * Make HTTP request with retry logic and enhanced error handling
 */
async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  // Build the URL with orgId automatically appended if available
  let url = `${API_BASE_URL}${path}`;

  const shouldAppendOrgId =
    currentOrgId &&
    currentOrgId > 0 &&
    !path.startsWith('/admin');

  if (shouldAppendOrgId) {
    const separator = url.includes('?') ? '&' : '?';
    url = `${url}${separator}orgId=${currentOrgId}`;
  }

  const headers = buildAuthHeaders(options.headers || {});

  let lastError: Error | null = null;

  // Retry loop with exponential backoff
  for (let attempt = 0; attempt <= DEFAULT_RETRY_CONFIG.maxRetries; attempt++) {
    try {
      const response = await fetchWithTimeout(url, { ...options, headers });

      // Parse response
      let data: any;
      const contentType = response.headers.get('content-type');
      const text = await response.text();

      if (text && contentType?.includes('application/json')) {
        try {
          data = JSON.parse(text);
        } catch (e) {
          // If JSON parsing fails, use text as-is
          data = text;
        }
      } else {
        data = text;
      }

      // Handle non-OK responses
      if (!response.ok) {
        const errorBody = data as any;

        // Extract error message with better fallbacks
        const message =
          errorBody?.error ||
          errorBody?.message ||
          (errorBody?.errors && Array.isArray(errorBody.errors)
            ? errorBody.errors.join(', ')
            : null) ||
          `Request failed with status ${response.status}`;

        const error = new APIError(
          message,
          response.status,
          errorBody?.code,
          errorBody
        );

        // Check if we should retry
        if (attempt < DEFAULT_RETRY_CONFIG.maxRetries && isRetryable(error, response.status)) {
          const delay = DEFAULT_RETRY_CONFIG.retryDelay * Math.pow(DEFAULT_RETRY_CONFIG.backoffMultiplier, attempt);
          console.warn(`API request failed (attempt ${attempt + 1}/${DEFAULT_RETRY_CONFIG.maxRetries + 1}), retrying in ${delay}ms...`, {
            url,
            status: response.status,
            error: message
          });
          await sleep(delay);
          continue;
        }

        // Special handling for auth errors
        if (response.status === 401 || response.status === 403) {
          clearAuthStorage();
          console.error('Authentication error:', message);
        }

        throw error;
      }

      return data as T;

    } catch (error: any) {
      lastError = error;

      // If it's already an APIError, just rethrow
      if (error instanceof APIError || error instanceof TimeoutError) {
        if (attempt < DEFAULT_RETRY_CONFIG.maxRetries && isRetryable(error)) {
          const delay = DEFAULT_RETRY_CONFIG.retryDelay * Math.pow(DEFAULT_RETRY_CONFIG.backoffMultiplier, attempt);
          console.warn(`Request failed (attempt ${attempt + 1}/${DEFAULT_RETRY_CONFIG.maxRetries + 1}), retrying in ${delay}ms...`, {
            url,
            error: error.message
          });
          await sleep(delay);
          continue;
        }
        throw error;
      }

      // Network errors (fetch failures)
      if (error instanceof TypeError || error.message.includes('fetch') || error.message.includes('network')) {
        const networkError = new NetworkError(
          'Network error - please check your internet connection',
          error
        );

        if (attempt < DEFAULT_RETRY_CONFIG.maxRetries) {
          const delay = DEFAULT_RETRY_CONFIG.retryDelay * Math.pow(DEFAULT_RETRY_CONFIG.backoffMultiplier, attempt);
          console.warn(`Network error (attempt ${attempt + 1}/${DEFAULT_RETRY_CONFIG.maxRetries + 1}), retrying in ${delay}ms...`, {
            url,
            error: error.message
          });
          await sleep(delay);
          continue;
        }

        throw networkError;
      }

      // Unknown errors
      if (attempt < DEFAULT_RETRY_CONFIG.maxRetries) {
        const delay = DEFAULT_RETRY_CONFIG.retryDelay * Math.pow(DEFAULT_RETRY_CONFIG.backoffMultiplier, attempt);
        console.warn(`Unexpected error (attempt ${attempt + 1}/${DEFAULT_RETRY_CONFIG.maxRetries + 1}), retrying in ${delay}ms...`, {
          url,
          error: error.message
        });
        await sleep(delay);
        continue;
      }

      throw error;
    }
  }

  // If we exhausted all retries, throw the last error
  throw lastError || new Error('Request failed after all retries');
}

export const createPortalSession = async (data: {
  orgId: number;
  role?: 'VIEWER' | 'INTEGRATION_EDITOR';
  expiresInHours?: number;
}): Promise<{
  accessToken: string;
  portalUrl: string;
  expiresIn: string;
  session: { orgId: number; role: string };
}> =>
  request('/auth/portal-session', {
    method: 'POST',
    body: JSON.stringify(data)
  });

const serializeIntegrationInput = (input: IntegrationConfig) => ({
  name: input.name,
  eventType: input.eventType,
  targetUrl: input.targetUrl,
  httpMethod: input.httpMethod,
  scope: input.scope,
  excludedEntityRids: input.excludedEntityRids,
  outgoingAuthType: input.outgoingAuthType,
  outgoingAuthConfig: input.outgoingAuthConfig,
  isActive: input.isActive,
  timeoutMs: input.timeoutMs,
  retryCount: input.retryCount,
  transformationMode: input.transformationMode,
  transformation: input.transformation,
  actions: input.actions,  // Support multi-action integrations
  lookups: input.lookups   // Support lookup configurations
});

export const getTenantInfo = async (): Promise<TenantInfo> =>
  request('/tenant');

export const getDashboardSummary = async (): Promise<DashboardSummary> => request('/dashboard');

export const sendDashboardEmail = async (data: {
  recipients: string[];
  days: number;
  includePdf: boolean;
}): Promise<{
  success: boolean;
  message: string;
  recipients: string[];
  messageId: string;
  includedPdf: boolean;
}> =>
  request('/dashboard/send-email', {
    method: 'POST',
    body: JSON.stringify(data)
  });

export const getIntegrations = async (): Promise<IntegrationConfig[]> => request('/outbound-integrations');

export const getIntegrationById = async (id: string): Promise<IntegrationConfig | undefined> =>
  request(`/outbound-integrations/${id}`);

export const createIntegration = async (payload: IntegrationConfig): Promise<IntegrationConfig> =>
  request('/outbound-integrations', {
    method: 'POST',
    body: JSON.stringify(serializeIntegrationInput(payload))
  });

export const updateIntegration = async (id: string, payload: IntegrationConfig): Promise<IntegrationConfig> =>
  request(`/outbound-integrations/${id}`, {
    method: 'PUT',
    body: JSON.stringify(serializeIntegrationInput(payload))
  });

export const deleteIntegration = async (id: string): Promise<void> =>
  request(`/outbound-integrations/${id}`, { method: 'DELETE' });

export const duplicateIntegration = async (id: string): Promise<IntegrationConfig> =>
  request(`/outbound-integrations/${id}/duplicate`, { method: 'POST' });

export const testIntegration = async (id: string, payload?: unknown) =>
  request(`/outbound-integrations/${id}/test`, {
    method: 'POST',
    body: JSON.stringify(payload || {})
  });

export const createOutboundIntegrationRaw = async (payload: any): Promise<any> =>
  request('/outbound-integrations', {
    method: 'POST',
    body: JSON.stringify(payload)
  });

export const updateOutboundIntegrationRaw = async (id: string, payload: any): Promise<any> =>
  request(`/outbound-integrations/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload)
  });

export const testOutboundSchedule = async (id: string, payload: { script: string; deliveryMode: string; eventType?: string; payload?: any }) =>
  request(`/outbound-integrations/${id}/test-schedule`, {
    method: 'POST',
    body: JSON.stringify(payload)
  });

export interface SchedulingTestResult {
  success: boolean;
  deliveryMode: 'DELAYED' | 'RECURRING';
  result: {
    timestamp?: number;
    scheduledFor?: string;
    delayFromNow?: string;
    isPastDue?: boolean;
    firstOccurrence?: number;
    firstOccurrenceDate?: string;
    intervalMs?: number;
    intervalHuman?: string;
    maxOccurrences?: number;
    endDate?: number;
    endDateFormatted?: string;
    totalDuration?: string;
    sampleOccurrences?: Array<{
      occurrence: number;
      scheduledFor: string;
    }>;
  };
  executionTimeMs: number;
}

export const testSchedulingScript = async (
  id: string,
  options?: {
    script?: string;
    deliveryMode?: 'DELAYED' | 'RECURRING';
    eventType?: string;
    payload?: unknown;
  }
): Promise<SchedulingTestResult> =>
  request(`/outbound-integrations/${id}/test-schedule`, {
    method: 'POST',
    body: JSON.stringify(options || {})
  });

// Integration signing API functions
export const rotateIntegrationSecret = async (id: string): Promise<{ message: string; newSecret: string; signingSecrets: string[] }> =>
  request(`/outbound-integrations/${id}/signing/rotate`, {
    method: 'POST'
  });

export const removeIntegrationSecret = async (id: string, secret: string): Promise<{ message: string; signingSecrets: string[] }> =>
  request(`/outbound-integrations/${id}/signing/remove`, {
    method: 'POST',
    body: JSON.stringify({ secret })
  });

// Inbound Integration API functions
export const getInboundIntegrations = async (): Promise<any[]> => request('/inbound-integrations');

export const getInboundIntegration = async (id: string): Promise<any> =>
  request(`/inbound-integrations/${id}`);

export const createInboundIntegration = async (payload: any): Promise<any> =>
  request('/inbound-integrations', {
    method: 'POST',
    body: JSON.stringify(payload)
  });

export const updateInboundIntegration = async (id: string, payload: any): Promise<any> =>
  request(`/inbound-integrations/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload)
  });

export const deleteInboundIntegration = async (id: string): Promise<void> =>
  request(`/inbound-integrations/${id}`, { method: 'DELETE' });

export const testInboundIntegration = async (id: string, payload?: unknown) =>
  request(`/inbound-integrations/${id}/test`, {
    method: 'POST',
    body: JSON.stringify(payload || {})
  });

export const getAllIntegrations = async (): Promise<any[]> => {
  const [inbound, outbound] = await Promise.all([
    getInboundIntegrations(),
    getIntegrations()
  ]);
  return [...inbound, ...outbound];
};

export const testInboundRuntime = async (integration: {
  type: string;
  httpMethod?: string;
}): Promise<any> => {
  const method = (integration.httpMethod || 'POST').toUpperCase();
  const path = `/integrations/${encodeURIComponent(integration.type)}`;
  if (method === 'GET') {
    return request(path, { method: 'GET' });
  }
  return request(path, {
    method: 'POST',
    body: JSON.stringify({})
  });
};

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPrevPage: boolean;
  };
}

export const getLogs = async (filters?: {
  status?: string;
  integrationId?: string;
  search?: string;
  eventType?: string;
  direction?: string;
  triggerType?: string;
  dateRange?: [string, string] | null;
  page?: number;
  limit?: number;
}): Promise<PaginatedResponse<DeliveryLog>> => {
  const params = new URLSearchParams();
  if (filters?.status) params.set('status', filters.status);
  if (filters?.integrationId) params.set('integrationId', filters.integrationId);
  if (filters?.search) params.set('search', filters.search);
  if (filters?.eventType) params.set('eventType', filters.eventType);
  if (filters?.direction) params.set('direction', filters.direction);
  if (filters?.triggerType) params.set('triggerType', filters.triggerType);
  if (filters?.dateRange && filters.dateRange[0] && filters.dateRange[1]) {
    params.set('startDate', filters.dateRange[0]);
    params.set('endDate', filters.dateRange[1]);
  }
  if (filters?.page) params.set('page', String(filters.page));
  if (filters?.limit) params.set('limit', String(filters.limit));
  const query = params.toString();
  return request(`/logs${query ? `?${query}` : ''}`);
};

export const getAlertCenterLogs = async (filters?: {
  status?: string;
  channel?: string;
  type?: string;
  search?: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
}): Promise<AlertCenterLog[]> => {
  const params = new URLSearchParams();
  if (filters?.status) params.set('status', filters.status);
  if (filters?.channel) params.set('channel', filters.channel);
  if (filters?.type) params.set('type', filters.type);
  if (filters?.search) params.set('search', filters.search);
  if (filters?.startDate) params.set('startDate', filters.startDate);
  if (filters?.endDate) params.set('endDate', filters.endDate);
  if (filters?.limit) params.set('limit', String(filters.limit));
  const query = params.toString();
  const response = await request<{ logs: AlertCenterLog[] }>(`/alert-center${query ? `?${query}` : ''}`);
  return response.logs || [];
};

export const exportAlertCenterLogsToJson = async (
  filters?: {
  status?: string;
  channel?: string;
  type?: string;
  search?: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
},
  options?: LogExportOptions
): Promise<void> => {
  const params = new URLSearchParams();
  if (filters?.status) params.set('status', filters.status);
  if (filters?.channel) params.set('channel', filters.channel);
  if (filters?.type) params.set('type', filters.type);
  if (filters?.search) params.set('search', filters.search);
  if (filters?.startDate) params.set('startDate', filters.startDate);
  if (filters?.endDate) params.set('endDate', filters.endDate);
  if (filters?.limit) params.set('limit', String(filters.limit));
  params.set('async', 'true');
  const query = params.toString();
  const url = `${API_BASE_URL}/alert-center/export/json${query ? `?${query}` : ''}`;

  const response = await fetch(url, {
    headers: buildAuthHeaders()
  });

  await handleLogExportResponse(
    response,
    `alert-center-${new Date().toISOString().split('T')[0]}.json`,
    options
  );
};

export const exportAlertCenterLogsToCsv = async (
  filters?: {
  status?: string;
  channel?: string;
  type?: string;
  search?: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
},
  options?: LogExportOptions
): Promise<void> => {
  const params = new URLSearchParams();
  if (filters?.status) params.set('status', filters.status);
  if (filters?.channel) params.set('channel', filters.channel);
  if (filters?.type) params.set('type', filters.type);
  if (filters?.search) params.set('search', filters.search);
  if (filters?.startDate) params.set('startDate', filters.startDate);
  if (filters?.endDate) params.set('endDate', filters.endDate);
  if (filters?.limit) params.set('limit', String(filters.limit));
  params.set('async', 'true');
  const query = params.toString();
  const url = `${API_BASE_URL}/alert-center/export/csv${query ? `?${query}` : ''}`;

  const response = await fetch(url, {
    headers: buildAuthHeaders()
  });

  await handleLogExportResponse(
    response,
    `alert-center-${new Date().toISOString().split('T')[0]}.csv`,
    options
  );
};

export const getAlertCenterStatus = async (): Promise<{
  enabled: boolean;
  intervalMinutes: number;
  lookbackMinutes: number;
  minFailures: number;
  maxItems: number;
  lastRunAt: string | null;
  nextRunAt: string | null;
  lastRunLog: {
    status: string;
    createdAt: string | null;
    totalFailures: number | null;
    recipients: string[];
    errorMessage: string | null;
  } | null;
}> => request('/alert-center/status');

export const getLogById = async (id: string): Promise<DeliveryLog | undefined> => request(`/logs/${id}`);

export const getLogStatsSummary = async (): Promise<{ total: number; failed: number; pending: number; success: number; refreshedAt?: string }> =>
  request('/logs/stats/summary');

export const retryLog = async (
  logId: string,
  options: { reason?: string; force?: boolean } = {}
): Promise<{ message: string; replayId: string; status: string }> => {
  const { reason = 'Manual retry from UI', force = false } = options;
  return request(`/logs/${logId}/replay`, {
    method: 'POST',
    body: JSON.stringify({ reason, force })
  });
};

// Bulk operations for logs
export const bulkRetryLogs = async (ids: string[]): Promise<{ message: string; retriedCount: number; failedIds: string[] }> =>
  request('/logs/bulk/retry', {
    method: 'POST',
    body: JSON.stringify({ ids })
  });

export const bulkDeleteLogs = async (ids: string[]): Promise<{ message: string; deletedCount: number; failedIds: string[] }> =>
  request('/logs/bulk', {
    method: 'DELETE',
    body: JSON.stringify({ ids })
  });

export const getEventTypes = async (): Promise<string[]> => {
  const resp = await request<{ eventTypes: string[] }>('/outbound-integrations/event-types');
  return resp.eventTypes;
};

export const getTemplates = async (): Promise<any[]> => {
  const response = await request<{ templates?: any[]; total?: number } | any[]>('/templates');
  if (Array.isArray(response)) {
    return response;
  }
  // Backend returns { templates, total }, extract the templates array
  return response.templates || [];
};

export const getTemplateById = async (id: string): Promise<any> => {
  const response = await request<{ template?: any } | any>(`/templates/${id}`);
  // Backend returns { template }, extract the template object
  return (response as { template?: any }).template || response;
};

export const createIntegrationFromTemplate = async (data: { templateId: string; overrides: any }): Promise<any> => {
  const response = await request<{ integration?: any; message?: string; template?: any } | any>(`/templates/${data.templateId}/create`, {
    method: 'POST',
    body: JSON.stringify(data.overrides)
  });
  // Backend returns { integration, message, template }, extract the integration
  return (response as { integration?: any }).integration || response;
};

export const createTemplate = async (template: any): Promise<any> =>
  request('/templates', {
    method: 'POST',
    body: JSON.stringify(template)
  });

export const updateTemplate = async (id: string, template: any): Promise<any> =>
  request(`/templates/${id}`, {
    method: 'PUT',
    body: JSON.stringify(template)
  });

export const deleteTemplate = async (id: string): Promise<void> =>
  request(`/templates/${id}`, { method: 'DELETE' });

// Bulk operations - Enable/Disable/Delete multiple integrations
export const bulkEnableIntegrations = async (ids: string[]): Promise<{ message: string; updatedCount: number; failedIds: string[] }> =>
  request('/outbound-integrations/bulk', {
    method: 'PATCH',
    body: JSON.stringify({ action: 'enable', ids })
  });

export const bulkDisableIntegrations = async (ids: string[]): Promise<{ message: string; updatedCount: number; failedIds: string[] }> =>
  request('/outbound-integrations/bulk', {
    method: 'PATCH',
    body: JSON.stringify({ action: 'disable', ids })
  });

export const bulkDeleteIntegrations = async (ids: string[]): Promise<{ message: string; deletedCount: number; failedIds: string[] }> =>
  request('/outbound-integrations/bulk', {
    method: 'DELETE',
    body: JSON.stringify({ ids })
  });

// Stub functions for BulkOperationsRoute (not implemented in backend yet)
export const bulkCreateIntegrations = async (integrations: Partial<IntegrationConfig>[]): Promise<any> => {
  throw new Error('Bulk create not implemented yet - use individual integration creation');
};

export const bulkUpdateIntegrations = async (integrationIds: string[], updates: Partial<IntegrationConfig>): Promise<any> => {
  throw new Error('Bulk update with custom fields not implemented yet - use bulk enable/disable instead');
};

export const exportIntegrations = async (options?: {
  includeInactive?: boolean;
  includeSensitive?: boolean;
  format?: string;
  integrationIds?: string[];
}): Promise<any> => {
  const params = new URLSearchParams();
  if (options?.includeInactive) params.set('includeInactive', 'true');
  if (options?.includeSensitive) params.set('includeSensitive', 'true');
  if (options?.format) params.set('format', options.format);
  if (options?.integrationIds) params.set('integrationIds', options.integrationIds.join(','));
  const query = params.toString();
  return request(`/import-export/outbound-integrations.json${query ? `?${query}` : ''}`);
};

export const importIntegrations = async (data: {
  importData: any;
  options?: {
    validateFirst?: boolean;
    continueOnError?: boolean;
    updateExisting?: boolean;
    preserveIds?: boolean;
    activateImported?: boolean;
  };
}): Promise<any> =>
  request('/import-export/outbound-integrations.json', {
    method: 'POST',
    body: JSON.stringify(data)
  });

export const validateBulkImport = async (data: { importData: any }): Promise<any> =>
  request('/import-export/validate', {
    method: 'POST',
    body: JSON.stringify(data)
  });

export const getIntegrationVersions = async (integrationName: string, params?: {
  limit?: number;
  includeInactive?: boolean;
  includePrerelease?: boolean;
}): Promise<any[]> => {
  const query = new URLSearchParams();
  if (params?.limit) query.set('limit', params.limit.toString());
  if (params?.includeInactive) query.set('includeInactive', 'true');
  if (params?.includePrerelease) query.set('includePrerelease', 'true');
  const queryString = query.toString();
  return request(`/versions/integration/${integrationName}/versions${queryString ? `?${queryString}` : ''}`);
};

export const getIntegrationVersion = async (integrationName: string, version: string): Promise<any> =>
  request(`/versions/integration/${integrationName}/version/${version}`);

export const createIntegrationVersion = async (integrationName: string, data: any): Promise<any> =>
  request(`/versions/integration/${integrationName}/version`, {
    method: 'POST',
    body: JSON.stringify(data)
  });

export const updateIntegrationVersion = async (integrationName: string, versionId: string, data: any): Promise<any> =>
  request(`/versions/integration/${integrationName}/version/${versionId}`, {
    method: 'PUT',
    body: JSON.stringify(data)
  });

export const deleteIntegrationVersion = async (integrationName: string, versionId: string): Promise<void> =>
  request(`/versions/integration/${integrationName}/version/${versionId}`, { method: 'DELETE' });

export const setDefaultIntegrationVersion = async (integrationName: string, versionId: string): Promise<any> =>
  request(`/versions/integration/${integrationName}/default`, {
    method: 'PUT',
    body: JSON.stringify({ versionId })
  });

export const activateIntegrationVersion = async (integrationName: string, versionId: string, options?: { activate: boolean }): Promise<any> =>
  request(`/versions/integration/${integrationName}/version/${versionId}/status`, {
    method: 'PATCH',
    body: JSON.stringify(options || { activate: true })
  });

export const rollbackIntegrationVersion = async (integrationName: string, versionId: string, data?: { reason?: string; force?: boolean }): Promise<any> =>
  request(`/versions/integration/${integrationName}/rollback/${versionId}`, {
    method: 'POST',
    body: JSON.stringify(data || {})
  });

export const compareIntegrationVersions = async (integrationName: string, v1: string, v2: string): Promise<any> =>
  request(`/versions/integration/${integrationName}/compare/${v1}/${v2}`);

export const getIntegrationCompatibilityMatrix = async (integrationName: string): Promise<any> =>
  request(`/versions/integration/${integrationName}/compatibility`);

// Analytics endpoints
export const getAnalyticsOverview = async (
  days?: number,
  direction?: string,
  triggerType?: string,
  integrationId?: string,
  options?: { startDate?: string; endDate?: string }
): Promise<any> => {
  const params = new URLSearchParams();
  if (days) params.set('days', String(days));
  if (options?.startDate) params.set('startDate', options.startDate);
  if (options?.endDate) params.set('endDate', options.endDate);
  if (direction) params.set('direction', direction);
  if (triggerType) params.set('triggerType', triggerType);
  if (integrationId) params.set('integrationId', integrationId);
  const query = params.toString();
  return request(`/analytics/overview${query ? `?${query}` : ''}`);
};

export const getAnalyticsTimeseries = async (
  days?: number,
  interval?: string,
  direction?: string,
  triggerType?: string,
  integrationId?: string,
  options?: { startDate?: string; endDate?: string }
): Promise<any> => {
  const params = new URLSearchParams();
  if (days) params.set('days', String(days));
  if (options?.startDate) params.set('startDate', options.startDate);
  if (options?.endDate) params.set('endDate', options.endDate);
  if (interval) params.set('interval', interval);
  if (direction) params.set('direction', direction);
  if (triggerType) params.set('triggerType', triggerType);
  if (integrationId) params.set('integrationId', integrationId);
  const query = params.toString();
  return request(`/analytics/timeseries${query ? `?${query}` : ''}`);
};

export const getAnalyticsPerformance = async (
  days?: number,
  integrationId?: string,
  direction?: string,
  triggerType?: string,
  options?: { startDate?: string; endDate?: string }
): Promise<any> => {
  const params = new URLSearchParams();
  if (days) params.set('days', String(days));
  if (options?.startDate) params.set('startDate', options.startDate);
  if (options?.endDate) params.set('endDate', options.endDate);
  if (integrationId) params.set('integrationId', integrationId);
  if (direction) params.set('direction', direction);
  if (triggerType) params.set('triggerType', triggerType);
  const query = params.toString();
  return request(`/analytics/performance${query ? `?${query}` : ''}`);
};

export const getAnalyticsErrors = async (
  days?: number,
  integrationId?: string,
  direction?: string,
  triggerType?: string,
  options?: { startDate?: string; endDate?: string }
): Promise<any> => {
  const params = new URLSearchParams();
  if (days) params.set('days', String(days));
  if (options?.startDate) params.set('startDate', options.startDate);
  if (options?.endDate) params.set('endDate', options.endDate);
  if (integrationId) params.set('integrationId', integrationId);
  if (direction) params.set('direction', direction);
  if (triggerType) params.set('triggerType', triggerType);
  const query = params.toString();
  return request(`/analytics/errors${query ? `?${query}` : ''}`);
};

// Event audit endpoints
export const getEventAudit = async (filters?: {
  status?: string;
  eventType?: string;
  source?: string;
  skipCategory?: string;
  startDate?: string;
  endDate?: string;
  search?: string;
  limit?: number;
  page?: number;
}): Promise<{ events: EventAuditRecord[]; total: number; pages: number; page: number }> => {
  const params = new URLSearchParams();
  if (filters?.status) params.set('status', filters.status);
  if (filters?.eventType) params.set('eventType', filters.eventType);
  if (filters?.source) params.set('source', filters.source);
  if (filters?.skipCategory) params.set('skipCategory', filters.skipCategory);
  if (filters?.startDate) params.set('startDate', filters.startDate);
  if (filters?.endDate) params.set('endDate', filters.endDate);
  if (filters?.search) params.set('search', filters.search);
  if (filters?.limit) params.set('limit', String(filters.limit));
  if (filters?.page) params.set('page', String(filters.page));
  const query = params.toString();
  return request(`/events${query ? `?${query}` : ''}`);
};

export const getEventAuditById = async (eventId: string): Promise<EventAuditRecord> =>
  request(`/events/${eventId}`);

export const getEventAuditStats = async (hoursBack: number = 24): Promise<any> =>
  request(`/events/stats?hoursBack=${hoursBack}`);

export const getEventAuditCheckpoints = async (source?: string): Promise<any[]> => {
  const params = new URLSearchParams();
  if (source) params.set('source', source);
  const query = params.toString();
  return request(`/events/checkpoints${query ? `?${query}` : ''}`);
};

export const getEventAuditGaps = async (source: string, hoursBack: number = 24): Promise<any> =>
  request(`/events/gaps?source=${encodeURIComponent(source)}&hoursBack=${hoursBack}`);

export const exportEventAuditToCsv = async (
  filters?: {
  status?: string;
  eventType?: string;
  source?: string;
  skipCategory?: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
  timeoutMs?: number;
},
  options?: LogExportOptions
): Promise<void> => {
  const params = new URLSearchParams();

  const orgId = getCurrentOrgId();
  if (orgId && orgId > 0) {
    params.set('orgId', String(orgId));
  }
  // Route exports through background jobs to keep the UI responsive.
  params.set('async', 'true');

  if (filters?.status) params.set('status', filters.status);
  if (filters?.eventType) params.set('eventType', filters.eventType);
  if (filters?.source) params.set('source', filters.source);
  if (filters?.skipCategory) params.set('skipCategory', filters.skipCategory);
  if (filters?.startDate) params.set('startDate', filters.startDate);
  if (filters?.endDate) params.set('endDate', filters.endDate);
  if (filters?.limit) params.set('limit', String(filters.limit));
  if (filters?.timeoutMs) params.set('timeoutMs', String(filters.timeoutMs));
  params.set('async', 'true');

  const query = params.toString();
  const url = `${API_BASE_URL}/events/export${query ? `?${query}` : ''}`;

  const response = await fetch(url, {
    headers: buildAuthHeaders()
  });

  await handleLogExportResponse(
    response,
    `event-audit-${new Date().toISOString().split('T')[0]}.csv`,
    options
  );
};

type LogExportFormat = 'csv' | 'json';

type LogExportFilters = {
  status?: string;
  integrationId?: string;
  search?: string;
  dateRange?: [string, string];
  direction?: string;
  triggerType?: string;
};

type LogExportJobStatus = 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

type LogExportJobResponse = {
  jobId: string;
  status: LogExportJobStatus;
  format: LogExportFormat;
  totalRecords: number;
  processedRecords: number;
  fileSizeBytes: number;
  fileName?: string | null;
  errorMessage?: string | null;
  statusPath?: string;
  downloadPath?: string;
};

type LogExportProgress = {
  status: LogExportJobStatus;
  processedRecords?: number;
  totalRecords?: number;
  fileSizeBytes?: number;
};

type LogExportOptions = {
  onProgress?: (progress: LogExportProgress) => void;
};

const parseFileNameFromDisposition = (contentDisposition: string | null, fallbackName: string): string => {
  if (!contentDisposition) return fallbackName;
  const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      return utf8Match[1];
    }
  }
  const basicMatch = contentDisposition.match(/filename="?([^"]+)"?/i);
  return basicMatch?.[1] || fallbackName;
};

const downloadResponseBlob = async (response: Response, fallbackName: string): Promise<void> => {
  const blob = await response.blob();
  const contentDisposition = response.headers.get('content-disposition');
  const filename = parseFileNameFromDisposition(contentDisposition, fallbackName);
  const downloadUrl = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = downloadUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(downloadUrl);
};

const appendOrgIdParam = (url: string): string => {
  const orgId = getCurrentOrgId();
  if (!orgId || orgId <= 0) return url;
  if (url.includes('orgId=')) return url;
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}orgId=${orgId}`;
};

const normalizeExportJobUrl = (pathOrUrl: string): string => {
  if (!pathOrUrl) return pathOrUrl;
  let fullUrl;
  if (/^https?:\/\//i.test(pathOrUrl)) {
    // Already a fully-qualified URL — use as-is
    fullUrl = pathOrUrl;
  } else if (pathOrUrl.startsWith('/api/v1/')) {
    // Backend returns absolute paths like "/api/v1/logs/export/jobs/..."
    // Using new URL('/api/v1/...', API_BASE_URL) drops the sub-path prefix because
    // leading "/" resolves relative to the origin only, not the full base URL path.
    // Instead, strip the "/api/v1/" prefix and resolve relative to API_BASE_URL
    // which already ends with "/api/v1".
    const relativePath = pathOrUrl.slice('/api/v1/'.length);
    fullUrl = `${API_BASE_URL}/${relativePath}`;
  } else {
    try {
      fullUrl = new URL(pathOrUrl, API_BASE_URL).toString();
    } catch {
      fullUrl = `${API_BASE_URL}/${pathOrUrl.replace(/^\//, '')}`;
    }
  }
  return appendOrgIdParam(fullUrl);
};

const buildLogExportParams = (filters?: LogExportFilters): URLSearchParams => {
  const params = new URLSearchParams();

  const orgId = getCurrentOrgId();
  if (orgId && orgId > 0) {
    params.set('orgId', String(orgId));
  }
  // Route exports through background jobs to keep the UI responsive.
  params.set('async', 'true');

  if (filters?.status) params.set('status', filters.status);
  if (filters?.integrationId) params.set('integrationId', filters.integrationId);
  if (filters?.search) params.set('search', filters.search);
  if (filters?.direction) params.set('direction', filters.direction);
  if (filters?.triggerType) params.set('triggerType', filters.triggerType);
  if (filters?.dateRange) {
    params.set('startDate', filters.dateRange[0]);
    params.set('endDate', filters.dateRange[1]);
  }
  return params;
};

const buildLogExportJobUrl = (jobId: string, suffix: '' | '/download' = ''): string => {
  const params = new URLSearchParams();
  const orgId = getCurrentOrgId();
  if (orgId && orgId > 0) {
    params.set('orgId', String(orgId));
  }
  const query = params.toString();
  return `${API_BASE_URL}/logs/export/jobs/${encodeURIComponent(jobId)}${suffix}${query ? `?${query}` : ''}`;
};

const waitForExportJobCompletion = async (
  statusUrl: string,
  options?: LogExportOptions
): Promise<LogExportJobResponse> => {
  const timeoutMs = 30 * 60 * 1000; // 30 minutes
  const pollEveryMs = 1500;
  const startedAt = Date.now();

  while (true) {
    const response = await fetch(statusUrl, {
      headers: buildAuthHeaders()
    });
    if (!response.ok) {
      throw new Error(`Export job status check failed: ${response.statusText}`);
    }
    const job = await response.json() as LogExportJobResponse;
    options?.onProgress?.({
      status: job.status,
      processedRecords: job.processedRecords,
      totalRecords: job.totalRecords,
      fileSizeBytes: job.fileSizeBytes
    });
    if (job.status === 'COMPLETED') {
      return job;
    }
    if (job.status === 'FAILED') {
      throw new Error(job.errorMessage || 'Export job failed');
    }
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error('Export job timed out');
    }
    await sleep(pollEveryMs);
  }
};

const handleLogExportResponse = async (
  response: Response,
  fallbackFileName: string,
  options?: LogExportOptions
): Promise<void> => {
  if (response.status === 202) {
    const queuedJob = await response.json() as LogExportJobResponse;
    options?.onProgress?.({
      status: queuedJob.status,
      processedRecords: queuedJob.processedRecords,
      totalRecords: queuedJob.totalRecords,
      fileSizeBytes: queuedJob.fileSizeBytes
    });
    const statusUrl = queuedJob.statusPath
      ? normalizeExportJobUrl(queuedJob.statusPath)
      : buildLogExportJobUrl(queuedJob.jobId);
    const downloadUrl = queuedJob.downloadPath
      ? normalizeExportJobUrl(queuedJob.downloadPath)
      : buildLogExportJobUrl(queuedJob.jobId, '/download');
    const completedJob = await waitForExportJobCompletion(statusUrl, options);
    const downloadResponse = await fetch(downloadUrl, {
      headers: buildAuthHeadersNoContentType()
    });
    if (!downloadResponse.ok) {
      throw new Error(`Export download failed: ${downloadResponse.statusText}`);
    }
    await downloadResponseBlob(downloadResponse, completedJob.fileName || fallbackFileName);
    return;
  }

  if (!response.ok) {
    throw new Error(`Export failed: ${response.statusText}`);
  }

  options?.onProgress?.({ status: 'COMPLETED' });
  await downloadResponseBlob(response, fallbackFileName);
};

export const exportLogsToCsv = async (filters?: LogExportFilters, options?: LogExportOptions): Promise<void> => {
  const params = buildLogExportParams(filters);
  const query = params.toString();
  const url = `${API_BASE_URL}/logs/export${query ? `?${query}` : ''}`;

  const response = await fetch(url, {
    headers: buildAuthHeaders()
  });

  await handleLogExportResponse(
    response,
    `integration-logs-${new Date().toISOString().split('T')[0]}.csv`,
    options
  );
};

export const insertTestNotificationQueueEvents = async (input: {
  orgId: number;
  orgUnitRid: number;
  phone?: string;
  mrn?: string;
  datetime?: string;
  createdAt?: string;
  limit?: number;
  eventTypes?: string[];
  randomizeDates?: boolean;
  randomDaysBack?: number;
  randomDaysForward?: number;
}): Promise<{ inserted: number; eventTypes: string[] }> => {
  return request('/events/test-notification-queue', {
    method: 'POST',
    body: JSON.stringify(input)
  });
};

// Export selected delivery logs by IDs (server-side)
export const exportSelectedLogs = async (
  ids: string[],
  format: 'csv' | 'json' = 'json',
  options?: LogExportOptions
): Promise<void> => {
  const params = new URLSearchParams();
  const orgId = getCurrentOrgId();
  if (orgId && orgId > 0) {
    params.set('orgId', String(orgId));
  }
  params.set('async', 'true');

  const query = params.toString();
  const url = `${API_BASE_URL}/logs/export/selected${query ? `?${query}` : ''}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: buildAuthHeaders(),
    body: JSON.stringify({ ids, format })
  });

  await handleLogExportResponse(
    response,
    `integration-logs-selected-${ids.length}-${new Date().toISOString().split('T')[0]}.${format}`,
    options
  );
};

export const exportLogsToJson = async (filters?: LogExportFilters, options?: LogExportOptions): Promise<void> => {
  const params = buildLogExportParams(filters);
  const query = params.toString();
  const url = `${API_BASE_URL}/logs/export/json${query ? `?${query}` : ''}`;

  const response = await fetch(url, {
    headers: buildAuthHeaders()
  });

  await handleLogExportResponse(
    response,
    `integration-logs-${new Date().toISOString().split('T')[0]}.json`,
    options
  );
};

// System logs
export interface SystemLog {
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  meta: Record<string, any>;
  category?: 'ui_error' | 'api_error' | 'validation_error' | 'business_logic' | 'unhandled' | 'unknown' | string;
  source?: 'browser' | 'server' | string;
}

export interface SystemLogsResponse {
  logs: SystemLog[];
  displayed: number;
  totalInPeriod: number;
  limit: number;
  filters: {
    level?: string;
    search?: string;
    pollId?: string;
    errorCategory?: string;
  };
  stats?: {
    total: number;
    error: number;
    warn: number;
    info: number;
    debug: number;
    errorCategories?: {
      [key: string]: number;
    };
  };
  pollStats?: {
    total: number;
    withErrors: number;
    withWarnings: number;
    healthy: number;
  };
  pollPerformance?: Array<{
    pollId: string;
    durationMs: number;
    eventsProcessed: number;
    retriesProcessed: number;
    logCount: number;
    hasError: boolean;
    hasWarn: boolean;
  }>;
}

export const getSystemLogs = async (params?: {
  limit?: number;
  level?: string;
  search?: string;
  errorCategory?: string;
}): Promise<SystemLogsResponse> => {
  const searchParams = new URLSearchParams();
  if (params?.limit) searchParams.append('limit', params.limit.toString());
  if (params?.level) searchParams.append('level', params.level);
  if (params?.search) searchParams.append('search', params.search);
  if (params?.errorCategory) searchParams.append('errorCategory', params.errorCategory);

  const query = searchParams.toString();
  return request<SystemLogsResponse>(`/system-logs${query ? `?${query}` : ''}`);
};

// Export system logs as JSON
export const exportSystemLogsToJson = async (
  filters?: {
  level?: string;
  search?: string;
  errorCategory?: string;
  pollId?: string;
  limit?: number;
},
  options?: LogExportOptions
): Promise<void> => {
  const params = new URLSearchParams();
  if (filters?.level) params.set('level', filters.level);
  if (filters?.search) params.set('search', filters.search);
  if (filters?.errorCategory) params.set('errorCategory', filters.errorCategory);
  if (filters?.pollId) params.set('pollId', filters.pollId);
  if (filters?.limit) params.set('limit', filters.limit.toString());
  params.set('async', 'true');

  const query = params.toString();
  const url = `${API_BASE_URL}/system-logs/export/json${query ? `?${query}` : ''}`;

  const response = await fetch(url, {
    headers: buildAuthHeaders()
  });

  await handleLogExportResponse(
    response,
    `system-logs-${new Date().toISOString().split('T')[0]}.json`,
    options
  );
};

// Export system logs as CSV
export const exportSystemLogsToCsv = async (
  filters?: {
  level?: string;
  search?: string;
  errorCategory?: string;
  pollId?: string;
  limit?: number;
},
  options?: LogExportOptions
): Promise<void> => {
  const params = new URLSearchParams();
  if (filters?.level) params.set('level', filters.level);
  if (filters?.search) params.set('search', filters.search);
  if (filters?.errorCategory) params.set('errorCategory', filters.errorCategory);
  if (filters?.pollId) params.set('pollId', filters.pollId);
  if (filters?.limit) params.set('limit', filters.limit.toString());
  params.set('async', 'true');

  const query = params.toString();
  const url = `${API_BASE_URL}/system-logs/export/csv${query ? `?${query}` : ''}`;

  const response = await fetch(url, {
    headers: buildAuthHeaders()
  });

  await handleLogExportResponse(
    response,
    `system-logs-${new Date().toISOString().split('T')[0]}.csv`,
    options
  );
};

// Clear all system logs (with archive)
export const clearSystemLogs = async (): Promise<{ message: string; archived: string }> =>
  request('/system-logs/clear', {
    method: 'DELETE'
  });

// Event Types & Field Schemas
export interface FieldSchema {
  name: string;                    // Field name (e.g., "eventId")
  path: string;                    // Field path (e.g., "patient.MRN.printableNumber")
  type: 'string' | 'integer' | 'number' | 'boolean' | 'date' | 'datetime' | 'time' | 'object' | 'array';
  required: boolean;               // Whether field is required
  description: string;             // Human-readable description
  itemType?: string;               // For arrays: type of items
  itemSchema?: FieldSchema[];      // For arrays of objects: nested schema
  properties?: FieldSchema[];      // For objects: nested properties
}

export interface EventType {
  eventType: string;               // Event type identifier (e.g., "BILL_CREATED")
  eventTypeId?: number;            // Numeric event ID from the client app (optional for custom types)
  orgId: number | null;            // null = global template; number = org-specific
  label: string;                   // Human-readable label
  description: string;             // Event description
  category: string;                // Event category
  implementationClass?: string;    // Java class name (optional for custom types)
  fields: FieldSchema[];           // Field schema array
  samplePayload?: any;             // Sample event payload
  isActive?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface EventTypeInput {
  eventType: string;
  label: string;
  description?: string;
  category?: string;
  isActive?: boolean;
  fields: FieldSchema[];
  samplePayload?: any;
}

/**
 * Get all event types with their field schemas
 * Use this for populating event type dropdowns
 */
export const getAllEventTypes = async (): Promise<EventType[]> => {
  const response = await request<{ eventTypes: EventType[]; count: number }>('/field-schemas/event-types');
  return response.eventTypes;
};

/**
 * Get a specific event type with its field schema
 */
export const getEventType = async (eventType: string): Promise<EventType> => {
  return request<EventType>(`/field-schemas/event-types/${eventType}`);
};

/**
 * Get field schema for a specific event type
 * Returns just the fields array
 */
export const getFieldSchema = async (eventType: string): Promise<FieldSchema[]> => {
  const response = await request<{ eventType: string; fields: FieldSchema[]; count: number }>(`/field-schemas?eventType=${eventType}`);
  return response.fields;
};

/**
 * Create a new org-specific event type
 */
export const createEventType = async (data: EventTypeInput): Promise<{ success: boolean; eventType: string; message: string }> => {
  return request('/field-schemas/event-types', { method: 'POST', body: JSON.stringify(data) });
};

/**
 * Update an existing org-specific event type
 */
export const updateEventType = async (eventType: string, data: Partial<EventTypeInput>): Promise<{ success: boolean; message: string }> => {
  return request(`/field-schemas/event-types/${eventType}`, { method: 'PUT', body: JSON.stringify(data) });
};

/**
 * Delete an org-specific event type (global templates cannot be deleted)
 */
export const deleteEventType = async (eventType: string): Promise<{ success: boolean; message: string }> => {
  return request(`/field-schemas/event-types/${eventType}`, { method: 'DELETE' });
};

/**
 * Import all global templates into the org's catalogue.
 * Skips event types the org already has custom entries for.
 */
export const importEventTemplates = async (): Promise<{ success: boolean; imported: number; skipped: number; message: string }> => {
  return request('/field-schemas/event-types/import-templates', { method: 'POST', body: JSON.stringify({}) });
};

// UI Configuration
export interface UIConfig {
  httpMethods: Array<{ value: string; label: string }>;
  authTypes: Array<{ value: string; label: string }>;
  scopeTypes: Array<{ value: string; label: string }>;
  deliveryStatuses: Array<{ value: string; label: string }>;
  transformationModes: Array<{ value: string; label: string }>;
  validationRules: {
    timeout: {
      min: number;
      max: number;
      default: number;
      step: number;
      label: string;
      description: string;
    };
    retry: {
      min: number;
      max: number;
      default: number;
      step: number;
      label: string;
      description: string;
    };
  };
  pagination: {
    defaultPageSize: number;
    pageSizeOptions: number[];
  };
  analytics: {
    timeRangeOptions: Array<{ value: number; label: string }>;
  };
  notifications?: {
    failureEmailReports?: {
      enabled?: boolean;
      email?: string;
      intervalMinutes?: number;
      lookbackMinutes?: number;
      minFailures?: number;
      maxItems?: number;
    };
  };
  worker?: {
    multiActionDelayMs?: number;
  };
  dashboard?: {
    autoRefreshSeconds?: number;
  };
  features?: {
    aiAssistant?: boolean;
  };
}

/**
 * Get UI configuration from server
 * Returns all dynamic configuration for dropdowns, validation rules, etc.
 */
export const getUIConfig = async (): Promise<UIConfig> => {
  return request<UIConfig>('/config/ui');
};

export const getUIConfigOverride = async (): Promise<any | null> => {
  const response = await request<{ override: any | null }>('/config/ui/entity');
  return response.override || null;
};

export const updateUIConfigOverride = async (override: any): Promise<any | null> => {
  const response = await request<{ override: any | null }>('/config/ui/entity', {
    method: 'PATCH',
    body: JSON.stringify({ override })
  });
  return response.override || null;
};

export const clearUIConfigOverride = async (): Promise<void> => {
  await request('/config/ui/entity', { method: 'DELETE' });
};

// Worker Checkpoint APIs
export type CheckpointResponse = {
  lastProcessedId?: number;
  checkpoint?: { lastProcessedId: number };
  eventSource?: 'mysql' | 'kafka';
  consumerGroup?: string;
  topic?: string;
  totalLag?: number;
  partitions?: Array<{
    partition: number;
    offset: number;
    highWatermark: number;
    lag: number;
  }>;
  error?: string;
  message?: string;
};

export const getCheckpoint = async (): Promise<CheckpointResponse> => {
  return request<CheckpointResponse>('/config/checkpoint');
};

export const updateCheckpoint = async (lastProcessedId: number): Promise<{ message: string; lastProcessedId: number }> => {
  return request<{ message: string; lastProcessedId: number }>('/config/checkpoint', {
    method: 'PATCH',
    body: JSON.stringify({ lastProcessedId }),
  });
};

// Scheduled Integrations APIs
export const getScheduledIntegrations = async (filters?: {
  status?: string;
  integrationConfigId?: string;
  __KEEP___KEEP_integrationConfig__Id__?: string;
  eventType?: string;
  limit?: number;
}): Promise<ScheduledIntegration[]> => {
  const params = new URLSearchParams();
  if (filters?.status) params.set('status', filters.status);
  if (filters?.integrationConfigId) params.set('integrationConfigId', filters.integrationConfigId);
  if (filters?.__KEEP___KEEP_integrationConfig__Id__) params.set('__KEEP___KEEP_integrationConfig__Id__', filters.__KEEP___KEEP_integrationConfig__Id__);
  if (filters?.eventType) params.set('eventType', filters.eventType);
  if (filters?.limit) params.set('limit', filters.limit.toString());

  const query = params.toString();
  const response = await request<{ scheduledIntegrations: ScheduledIntegration[] }>(
    `/scheduled-integrations${query ? `?${query}` : ''}`
  );
  return response.scheduledIntegrations;
};

export const updateScheduledIntegration = async (
  id: string,
  updates: { scheduledFor: string }
): Promise<{ message: string; scheduledFor: string }> =>
  request(`/scheduled-integrations/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(updates)
  });

export const deleteScheduledIntegration = async (id: string): Promise<{ message: string }> =>
  request(`/scheduled-integrations/${id}`, { method: 'DELETE' });

export const bulkDeleteScheduledIntegrations = async (ids: string[]): Promise<{
  message: string;
  deletedCount: number;
  failedIds: string[];
}> =>
  request('/scheduled-integrations/bulk', {
    method: 'DELETE',
    body: JSON.stringify({ ids })
  });

export const validateSchedulingScript = async (data: {
  script: string;
  deliveryMode: 'DELAYED' | 'RECURRING';
  timezone?: string;
  eventType?: string;
}): Promise<{
  success: boolean;
  message?: string;
  error?: string;
  result?: any;
}> =>
  request('/scheduled-integrations/validate', {
    method: 'POST',
    body: JSON.stringify(data)
  });

// Lookup Tables APIs
import type { Lookup, LookupStats, LookupImportResult, LookupTestResult } from '../mocks/types';

/**
 * Get all lookups with optional filters
 */
export const getLookups = async (filters?: {
  type?: string;
  orgUnitRid?: number;
  isActive?: boolean;
  search?: string;
  limit?: number;
  offset?: number;
}): Promise<{ lookups: Lookup[]; total: number }> => {
  const params = new URLSearchParams();
  if (filters?.type) params.set('type', filters.type);
  if (filters?.orgUnitRid !== undefined) params.set('orgUnitRid', filters.orgUnitRid.toString());
  if (filters?.isActive !== undefined) params.set('isActive', filters.isActive.toString());
  if (filters?.search) params.set('search', filters.search);
  if (filters?.limit) params.set('limit', filters.limit.toString());
  if (filters?.offset) params.set('offset', filters.offset.toString());

  const query = params.toString();
  const response = await request<{ success: boolean; data: Lookup[]; count: number }>(`/lookups${query ? `?${query}` : ''}`);

  // Transform backend response to frontend format
  return {
    lookups: response.data || [],
    total: response.count || 0
  };
};

/**
 * Get a single lookup by ID
 */
export const getLookup = async (id: string): Promise<Lookup> => {
  const response = await request<{ success: boolean; data: Lookup }>(`/lookups/${id}`);
  return response.data;
};

/**
 * Create a new lookup
 */
export const createLookup = async (lookup: Partial<Lookup>): Promise<Lookup> => {
  const response = await request<{ success: boolean; data: Lookup }>('/lookups', {
    method: 'POST',
    body: JSON.stringify(lookup)
  });
  return response.data;
};

/**
 * Update an existing lookup
 */
export const updateLookup = async (id: string, lookup: Partial<Lookup>): Promise<Lookup> => {
  const response = await request<{ success: boolean; data: Lookup }>(`/lookups/${id}`, {
    method: 'PUT',
    body: JSON.stringify(lookup)
  });
  return response.data;
};

/**
 * Delete a lookup
 */
export const deleteLookup = async (id: string): Promise<void> =>
  request(`/lookups/${id}`, { method: 'DELETE' });

/**
 * Bulk create lookups
 */
export const bulkCreateLookups = async (lookups: Partial<Lookup>[]): Promise<{
  message: string;
  imported: number;
  errors: Array<{ index: number; error: string }>;
}> =>
  request('/lookups/bulk', {
    method: 'POST',
    body: JSON.stringify({ lookups })
  });

/**
 * Bulk delete lookups
 */
export const bulkDeleteLookups = async (ids: string[]): Promise<{
  message: string;
  deletedCount: number;
  failedIds: string[];
}> =>
  request('/lookups/bulk', {
    method: 'DELETE',
    body: JSON.stringify({ ids })
  });

/**
 * Resolve a single code mapping
 */
export const resolveLookup = async (data: {
  sourceId: string;
  type: string;
  orgUnitRid?: number;
}): Promise<{
  sourceId: string;
  targetId: string | null;
  found: boolean;
  lookupId?: string;
}> => {
  const params = new URLSearchParams();
  if (data.orgUnitRid !== undefined) params.set('orgUnitRid', String(data.orgUnitRid));
  const query = params.toString() ? `?${params.toString()}` : '';
  return request(`/lookups/resolve${query}`, {
    method: 'POST',
    body: JSON.stringify({
      sourceId: data.sourceId,
      type: data.type,
    })
  });
};

/**
 * Resolve multiple code mappings
 */
export const resolveLookupBulk = async (data: {
  sourceIds: string[];
  type: string;
  orgUnitRid?: number;
}): Promise<{
  results: Array<{
    sourceId: string;
    type: string;
    targetId: string | null;
    found: boolean;
  }>;
}> => {
  const params = new URLSearchParams();
  if (data.orgUnitRid !== undefined) params.set('orgUnitRid', String(data.orgUnitRid));
  const query = params.toString() ? `?${params.toString()}` : '';
  return request(`/lookups/resolve-bulk${query}`, {
    method: 'POST',
    body: JSON.stringify({
      sourceIds: data.sourceIds,
      type: data.type,
    })
  });
};

/**
 * Reverse lookup - find source from target
 */
export const reverseLookup = async (data: {
  targetId: string;
  type: string;
  orgUnitRid?: number;
}): Promise<{
  targetId: string;
  sourceIds: string[];
  found: boolean;
}> => {
  const params = new URLSearchParams();
  if (data.orgUnitRid !== undefined) params.set('orgUnitRid', String(data.orgUnitRid));
  const query = params.toString() ? `?${params.toString()}` : '';
  return request(`/lookups/reverse${query}`, {
    method: 'POST',
    body: JSON.stringify({
      targetId: data.targetId,
      type: data.type,
    })
  });
};

/**
 * Get lookup statistics
 */
export const getLookupStats = async (): Promise<LookupStats> => {
  const response = await request<{ success: boolean; data: LookupStats }>('/lookups/stats');
  return response.data;
};

/**
 * Get all lookup types
 */
export const getLookupTypes = async (): Promise<{ types: string[] }> => {
  const response = await request<{ success: boolean; data: string[] }>('/lookups/types');
  return { types: response.data || [] };
};

/**
 * Import lookups from Excel/CSV file
 */
export const importLookups = async (file: File, options: {
  type: string;
  orgUnitRid?: number;
  format?: 'simple' | 'detailed';
}): Promise<LookupImportResult> => {
  const formData = new FormData();
  formData.append('file', file);
  // type is sent as query param (required by backend route)
  if (options.format) formData.append('format', options.format);

  const params = new URLSearchParams();
  params.set('type', options.type);

  const orgId = getCurrentOrgId();
  if (orgId && orgId > 0) {
    params.set('orgId', String(orgId));
  }
  if (options.orgUnitRid !== undefined) {
    params.set('orgUnitRid', String(options.orgUnitRid));
  }
  const url = `${import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000/api/v1'}/lookups/import?${params.toString()}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: buildAuthHeadersNoContentType(),
    body: formData
  });

  if (!response.ok) {
    const error = await response.json();
    throw new APIError(error.error || 'Import failed', response.status, error.code);
  }

  return response.json();
};

/**
 * Export lookups to Excel
 */
export const exportLookups = async (filters?: {
  type?: string;
  orgUnitRid?: number;
  isActive?: boolean;
}): Promise<void> => {
  const params = new URLSearchParams();

  const orgId = getCurrentOrgId();
  if (orgId && orgId > 0) {
    params.set('orgId', String(orgId));
  }

  if (filters?.type) params.set('type', filters.type);
  if (filters?.orgUnitRid !== undefined) params.set('orgUnitRid', filters.orgUnitRid.toString());
  if (filters?.isActive !== undefined) params.set('isActive', filters.isActive.toString());

  const query = params.toString();
  const url = `${import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000/api/v1'}/lookups/export${query ? `?${query}` : ''}`;

  const response = await fetch(url, {
    headers: buildAuthHeadersNoContentType()
  });

  if (!response.ok) {
    throw new Error(`Export failed: ${response.statusText}`);
  }

  const blob = await response.blob();
  const downloadUrl = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = downloadUrl;
  link.download = `lookups-${new Date().toISOString().split('T')[0]}.xlsx`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(downloadUrl);
};

/**
 * Download import template
 */
export const downloadLookupTemplate = async (type: string): Promise<void> => {
  const params = new URLSearchParams();
  params.set('type', type);

  const orgId = getCurrentOrgId();
  if (orgId && orgId > 0) {
    params.set('orgId', String(orgId));
  }

  const query = params.toString();
  const url = `${import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000/api/v1'}/lookups/import/template${query ? `?${query}` : ''}`;

  const response = await fetch(url, {
    headers: buildAuthHeadersNoContentType()
  });

  if (!response.ok) {
    throw new Error(`Template download failed: ${response.statusText}`);
  }

  const blob = await response.blob();
  const downloadUrl = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = downloadUrl;
  link.download = `lookup-template-${type}.xlsx`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(downloadUrl);
};

/**
 * Test lookup configurations against sample payload
 */
export const testLookups = async (data: {
  lookupConfigs: any[];
  payload: Record<string, any>;
  orgUnitRid?: number;
}): Promise<LookupTestResult> => {
  const params = new URLSearchParams();
  if (data.orgUnitRid !== undefined) params.set('orgUnitRid', String(data.orgUnitRid));
  const query = params.toString() ? `?${params.toString()}` : '';
  return request<LookupTestResult>(`/lookups/test${query}`, {
    method: 'POST',
    body: JSON.stringify({
      lookupConfigs: data.lookupConfigs,
      samplePayload: data.payload,
    })
  });
};

// ==================== Admin APIs ====================

export interface AdminUser {
  id: string;
  email: string;
  role: string;
  orgId?: number | null;
  isActive: boolean;
  lastLoginAt?: string | null;
}

export const listAdminUsers = async (filters: {
  orgId?: number;
  role?: string;
  search?: string;
  isActive?: boolean;
  page?: number;
  limit?: number;
} = {}): Promise<{ users: AdminUser[]; total: number; page: number; limit: number }> => {
  const params = new URLSearchParams();
  if (filters.orgId) params.set('orgId', String(filters.orgId));
  if (filters.role) params.set('role', filters.role);
  if (filters.search) params.set('search', filters.search);
  if (filters.isActive !== undefined) params.set('isActive', String(filters.isActive));
  if (filters.page) params.set('page', String(filters.page));
  if (filters.limit) params.set('limit', String(filters.limit));
  const query = params.toString() ? `?${params.toString()}` : '';
  const response = await request<{ users: AdminUser[]; total: number; page: number; limit: number }>(`/admin/users${query}`);
  return {
    users: response.users || [],
    total: response.total ?? (response.users ? response.users.length : 0),
    page: response.page ?? filters.page ?? 1,
    limit: response.limit ?? filters.limit ?? 50
  };
};

export const createAdminUser = async (payload: {
  email: string;
  password: string;
  role: string;
  orgId?: number | null;
}): Promise<AdminUser> => {
  const response = await request<{ user: AdminUser }>('/admin/users', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
  return response.user;
};

export const updateAdminUser = async (id: string, payload: Partial<AdminUser>): Promise<AdminUser> => {
  const response = await request<{ user: AdminUser }>(`/admin/users/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload)
  });
  return response.user;
};

export const resetAdminUserPassword = async (id: string, password: string): Promise<void> => {
  await request(`/admin/users/${id}/reset-password`, {
    method: 'POST',
    body: JSON.stringify({ password })
  });
};

export const setAdminUserActive = async (id: string, isActive: boolean): Promise<AdminUser> => {
  const response = await request<{ user: AdminUser }>(`/admin/users/${id}/disable`, {
    method: 'PATCH',
    body: JSON.stringify({ isActive })
  });
  return response.user;
};

export const listAdminOrgs = async (): Promise<number[]> => {
  const response = await request<{ orgs: number[] }>('/admin/orgs');
  return response.orgs || [];
};

export interface AdminOrgSummary {
  orgId: number;
  name?: string | null;
  code?: string | null;
  phone?: string | null;
  address?: string | null;
  tags?: string[] | null;
  region?: string | null;
  timezone?: string | null;
  email?: string | null;
}

export const listAdminOrgSummaries = async (): Promise<AdminOrgSummary[]> => {
  const response = await request<{ orgs: AdminOrgSummary[] }>('/admin/orgs/summary');
  return response.orgs || [];
};

export interface AdminOrganization extends AdminOrgSummary {
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface AdminOrgUnit {
  orgId: number;
  rid: number;
  name?: string | null;
  code?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  tags?: string[] | null;
  region?: string | null;
  timezone?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export const createAdminOrg = async (payload: AdminOrganization): Promise<AdminOrganization> => {
  const response = await request<{ org: AdminOrganization }>('/admin/orgs', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
  return response.org;
};

export const updateAdminOrg = async (orgId: number, payload: Partial<AdminOrganization>): Promise<AdminOrganization> => {
  const response = await request<{ org: AdminOrganization }>(`/admin/orgs/${orgId}`, {
    method: 'PUT',
    body: JSON.stringify(payload)
  });
  return response.org;
};

export const deleteAdminOrg = async (orgId: number): Promise<void> => {
  await request(`/admin/orgs/${orgId}`, { method: 'DELETE' });
};

export const listAdminOrgUnits = async (orgId: number): Promise<AdminOrgUnit[]> => {
  const response = await request<{ units: AdminOrgUnit[] }>(`/admin/orgs/${orgId}/units`);
  return response.units || [];
};

export const createAdminOrgUnit = async (orgId: number, payload: AdminOrgUnit): Promise<AdminOrgUnit> => {
  const response = await request<{ unit: AdminOrgUnit }>(`/admin/orgs/${orgId}/units`, {
    method: 'POST',
    body: JSON.stringify(payload)
  });
  return response.unit;
};

export const updateAdminOrgUnit = async (orgId: number, rid: number, payload: Partial<AdminOrgUnit>): Promise<AdminOrgUnit> => {
  const response = await request<{ unit: AdminOrgUnit }>(`/admin/orgs/${orgId}/units/${rid}`, {
    method: 'PUT',
    body: JSON.stringify(payload)
  });
  return response.unit;
};

export const deleteAdminOrgUnit = async (orgId: number, rid: number): Promise<void> => {
  await request(`/admin/orgs/${orgId}/units/${rid}`, { method: 'DELETE' });
};

export const getAdminUiConfig = async () => {
  const response = await request<{ config: any }>('/admin/ui-config');
  return response.config;
};

// Role Management
export interface RoleConfig {
  role: string;
  name: string;
  description: string;
  scope: 'global' | 'organization' | 'api';
  features: Record<string, string[]>;
  isCustom?: boolean;
}

export const getRoles = async (): Promise<RoleConfig[]> => {
  const response = await request<{ roles: RoleConfig[] }>('/admin/roles');
  return response.roles;
};

export const getRoleById = async (role: string): Promise<RoleConfig> => {
  return request<RoleConfig>(`/admin/roles/${role}`);
};

export const createRole = async (payload: Omit<RoleConfig, 'role' | 'isCustom'>): Promise<RoleConfig> => {
  return request<RoleConfig>('/admin/roles', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
};

export const updateRole = async (role: string, payload: { name?: string; description?: string; features?: Record<string, string[]> }): Promise<RoleConfig> => {
  return request<RoleConfig>(`/admin/roles/${role}`, {
    method: 'PUT',
    body: JSON.stringify(payload)
  });
};

export const deleteRole = async (role: string): Promise<void> => {
  await request(`/admin/roles/${role}`, { method: 'DELETE' });
};

export interface AdminRateLimitStatus {
  enabled: boolean;
  current: number;
  limit: number | null;
  remaining: number | null;
  resetAt?: string | null;
  windowSeconds?: number | null;
}

export interface AdminRateLimitItem {
  id: string;
  name: string;
  type: string;
  direction: string;
  orgId: number;
  tenantId?: number;
  isActive: boolean;
  rateLimits?: {
    enabled?: boolean;
    maxRequests?: number;
    windowSeconds?: number;
  } | null;
  updatedAt?: string | null;
  status?: AdminRateLimitStatus | null;
}

export const listAdminRateLimits = async (filters: {
  orgId?: number;
  direction?: string;
  enabled?: boolean;
  search?: string;
  page?: number;
  limit?: number;
} = {}): Promise<{ items: AdminRateLimitItem[]; total: number; page: number; limit: number }> => {
  const params = new URLSearchParams();
  if (filters.orgId) params.set('orgId', String(filters.orgId));
  if (filters.direction) params.set('direction', filters.direction);
  if (filters.enabled !== undefined) params.set('enabled', String(filters.enabled));
  if (filters.search) params.set('search', filters.search);
  if (filters.page) params.set('page', String(filters.page));
  if (filters.limit) params.set('limit', String(filters.limit));
  const query = params.toString() ? `?${params.toString()}` : '';
  const response = await request<{ items: AdminRateLimitItem[]; total: number; page: number; limit: number }>(`/admin/rate-limits${query}`);
  return {
    items: response.items || [],
    total: response.total ?? (response.items ? response.items.length : 0),
    page: response.page ?? filters.page ?? 1,
    limit: response.limit ?? filters.limit ?? 50
  };
};

export const updateAdminRateLimit = async (id: string, rateLimits: {
  enabled?: boolean;
  maxRequests?: number;
  windowSeconds?: number;
}): Promise<{ enabled: boolean; maxRequests: number; windowSeconds: number }> => {
  const response = await request<{ rateLimits: { enabled: boolean; maxRequests: number; windowSeconds: number } }>(`/admin/rate-limits/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ rateLimits })
  });
  return response.rateLimits;
};

export const resetAdminRateLimit = async (id: string): Promise<void> => {
  await request(`/admin/rate-limits/${id}/reset`, {
    method: 'POST'
  });
};

export const bulkApplyAdminRateLimits = async (payload: {
  filters?: {
    orgId?: number;
    direction?: string;
    enabled?: boolean;
    search?: string;
  };
  rateLimits: {
    enabled?: boolean;
    maxRequests?: number;
    windowSeconds?: number;
  };
  mode?: 'override' | 'merge';
  confirmAll?: boolean;
}): Promise<{ matched: number; modified: number; mode: string; rateLimits: any }> => {
  return request('/admin/rate-limits/bulk-apply', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
};

export const bulkResetAdminRateLimits = async (filters?: {
  orgId?: number;
  direction?: string;
  enabled?: boolean;
  search?: string;
  confirmAll?: boolean;
}): Promise<{ integrations: number; deleted: number }> => {
  return request('/admin/rate-limits/bulk-reset', {
    method: 'POST',
    body: JSON.stringify({ filters, confirmAll: filters?.confirmAll })
  });
};

export const exportAdminRateLimits = async (filters: {
  orgId?: number;
  direction?: string;
  enabled?: boolean;
  search?: string;
} = {}): Promise<void> => {
  const params = new URLSearchParams();
  if (filters.orgId) params.set('orgId', String(filters.orgId));
  if (filters.direction) params.set('direction', filters.direction);
  if (filters.enabled !== undefined) params.set('enabled', String(filters.enabled));
  if (filters.search) params.set('search', filters.search);
  const query = params.toString() ? `?${params.toString()}` : '';
  const url = `${API_BASE_URL}/admin/rate-limits/export${query}`;

  const response = await fetch(url, {
    headers: buildAuthHeadersNoContentType()
  });

  if (!response.ok) {
    throw new Error(`Export failed: ${response.statusText}`);
  }

  const blob = await response.blob();
  const downloadUrl = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = downloadUrl;
  link.download = `rate-limits-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(downloadUrl);
};

export interface AdminAuditLog {
  id: string;
  action: string;
  adminId?: string | null;
  adminEmail?: string | null;
  adminRole?: string | null;
  filters?: any;
  mode?: string | null;
  rateLimits?: any;
  matched?: number | null;
  modified?: number | null;
  integrations?: number | null;
  deleted?: number | null;
  count?: number | null;
  createdAt?: string | null;
}

export const listAdminAuditLogs = async (filters: {
  action?: string;
  role?: string;
  adminId?: string;
  search?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
  limit?: number;
} = {}): Promise<{ items: AdminAuditLog[]; total: number; page: number; limit: number; summary?: { total: number; topActions: { action: string; count: number }[]; topAdmins: { adminEmail: string; count: number }[]; actionBreakdown: { action: string; count: number }[]; dailyCounts: { date: string; count: number }[] } }> => {
  const params = new URLSearchParams();
  if (filters.action) params.set('action', filters.action);
  if (filters.role) params.set('role', filters.role);
  if (filters.adminId) params.set('adminId', filters.adminId);
  if (filters.search) params.set('search', filters.search);
  if (filters.startDate) params.set('startDate', filters.startDate);
  if (filters.endDate) params.set('endDate', filters.endDate);
  if (filters.page) params.set('page', String(filters.page));
  if (filters.limit) params.set('limit', String(filters.limit));
  const query = params.toString() ? `?${params.toString()}` : '';
  const response = await request<{ items: AdminAuditLog[]; total: number; page: number; limit: number; summary?: { total: number; topActions: { action: string; count: number }[]; topAdmins: { adminEmail: string; count: number }[]; actionBreakdown: { action: string; count: number }[]; dailyCounts: { date: string; count: number }[] } }>(`/admin/audit-logs${query}`);
  return {
    items: response.items || [],
    total: response.total ?? (response.items ? response.items.length : 0),
    page: response.page ?? filters.page ?? 1,
    limit: response.limit ?? filters.limit ?? 50,
    summary: response.summary
  };
};

export const exportAdminAuditLogs = async (filters: {
  action?: string;
  role?: string;
  adminId?: string;
  search?: string;
  startDate?: string;
  endDate?: string;
  days?: number;
} = {}): Promise<void> => {
  const params = new URLSearchParams();
  if (filters.action) params.set('action', filters.action);
  if (filters.role) params.set('role', filters.role);
  if (filters.adminId) params.set('adminId', filters.adminId);
  if (filters.search) params.set('search', filters.search);
  if (filters.startDate) params.set('startDate', filters.startDate);
  if (filters.endDate) params.set('endDate', filters.endDate);
  if (filters.days) params.set('days', String(filters.days));
  const query = params.toString() ? `?${params.toString()}` : '';
  const url = `${API_BASE_URL}/admin/audit-logs/export${query}`;

  const response = await fetch(url, {
    headers: buildAuthHeadersNoContentType()
  });

  if (!response.ok) {
    throw new Error(`Export failed: ${response.statusText}`);
  }

  const blob = await response.blob();
  const downloadUrl = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = downloadUrl;
  link.download = `admin-audit-logs-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(downloadUrl);
};

export const exportAdminAuditTrend = async (filters: {
  action?: string;
  role?: string;
  adminId?: string;
  search?: string;
  startDate?: string;
  endDate?: string;
  days?: number;
} = {}): Promise<void> => {
  const params = new URLSearchParams();
  if (filters.action) params.set('action', filters.action);
  if (filters.role) params.set('role', filters.role);
  if (filters.adminId) params.set('adminId', filters.adminId);
  if (filters.search) params.set('search', filters.search);
  if (filters.startDate) params.set('startDate', filters.startDate);
  if (filters.endDate) params.set('endDate', filters.endDate);
  if (filters.days) params.set('days', String(filters.days));
  const query = params.toString() ? `?${params.toString()}` : '';
  const url = `${API_BASE_URL}/admin/audit-logs/export-trend${query}`;

  const response = await fetch(url, {
    headers: buildAuthHeadersNoContentType()
  });

  if (!response.ok) {
    throw new Error(`Export failed: ${response.statusText}`);
  }

  const blob = await response.blob();
  const downloadUrl = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = downloadUrl;
  link.download = `admin-audit-trend-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(downloadUrl);
};

// ==================== Execution Logs (Trace Viewer) APIs ====================

export interface ExecutionLogStep {
  name: string;
  timestamp: string;
  durationMs: number | null;
  status: string;
  metadata?: Record<string, any>;
  error?: {
    message: string;
    code?: string;
  } | null;
}

export interface ExecutionLog {
  traceId: string;
  messageId?: string | null;
  direction: 'OUTBOUND' | 'INBOUND' | 'SCHEDULED';
  triggerType: 'EVENT' | 'SCHEDULE' | 'MANUAL' | 'REPLAY';
  integrationConfigId: string;
  orgId: number;
  status: 'PENDING' | 'SUCCESS' | 'FAILED' | 'RETRYING' | 'ABANDONED';
  startedAt: string;
  finishedAt?: string | null;
  durationMs?: number | null;
  steps: ExecutionLogStep[];
  request?: {
    headers?: Record<string, any>;
    body?: any;
    url?: string | null;
    method?: string | null;
  };
  response?: {
    statusCode?: number | null;
    headers?: Record<string, any>;
    body?: any;
  };
  error?: {
    message: string;
    stack?: string | null;
    code?: string;
  } | null;
  metadata?: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

export interface ExecutionLogsListResponse {
  success: boolean;
  data: Array<ExecutionLog | Record<string, any>>;
  pagination: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}

export const listExecutionLogs = async (filters: {
  direction?: 'OUTBOUND' | 'INBOUND' | 'SCHEDULED';
  triggerType?: 'EVENT' | 'SCHEDULE' | 'MANUAL' | 'REPLAY';
  status?: 'PENDING' | 'SUCCESS' | 'FAILED' | 'RETRYING' | 'ABANDONED';
  integrationConfigId?: string;
  messageId?: string;
  startDate?: string;
  endDate?: string;
  groupBy?: 'log' | 'trace';
  page?: number;
  limit?: number;
  offset?: number;
} = {}): Promise<ExecutionLogsListResponse> => {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      params.set(key, String(value));
    }
  });
  const query = params.toString() ? `?${params.toString()}` : '';
  return request<ExecutionLogsListResponse>(`/execution-logs${query}`);
};

export const getExecutionLog = async (traceId: string): Promise<ExecutionLog> => {
  const response = await request<{ success: boolean; data: ExecutionLog }>(`/execution-logs/${traceId}`);
  return response.data;
};

export interface ExecutionLogTimeline {
  summary: {
    traceId: string;
    status: string;
    direction: string | null;
    triggerType: string | null;
    totalDuration: number | null;
    startedAt: string | null;
    finishedAt: string | null;
    stepCount: number;
    errorStep: string | null;
  };
  timeline: Array<ExecutionLogStep & {
    gapMs: number | null;
    request?: any;
    response?: any;
  }>;
  request: any;
  response: any;
  error: any;
  vendorResponses?: Array<{
    stage: string;
    status: string;
    timestamp: string | null;
    provider: string | null;
    channel: string | null;
    responseStatus: number | null;
    messageId: string | null;
    target: string | null;
    responseBody: any;
  }>;
  records?: Array<Record<string, any>>;
}

export const getExecutionLogTimeline = async (traceId: string): Promise<ExecutionLogTimeline> => {
  const response = await request<{ success: boolean; data: ExecutionLogTimeline }>(`/execution-logs/${traceId}/timeline`);
  return response.data;
};

export const getExecutionStats = async (filters: {
  direction?: string;
  integrationConfigId?: string;
  startDate?: string;
  endDate?: string;
} = {}): Promise<any> => {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      params.set(key, String(value));
    }
  });
  const query = params.toString() ? `?${params.toString()}` : '';
  const response = await request<{ success: boolean; data: any }>(`/execution-logs/stats${query}`);
  return response.data;
};

// ==================== Dead Letter Queue (DLQ) APIs ====================

export interface DLQEntry {
  dlqId: string;
  traceId: string;
  messageId?: string | null;
  executionLogId?: string | null;
  integrationConfigId: string;
  orgId: number;
  direction: 'OUTBOUND' | 'INBOUND' | 'SCHEDULED';
  payload: any;
  error: {
    message: string;
    stack?: string | null;
    code: string;
    category: string;
    statusCode?: number | null;
  };
  status: 'pending' | 'retrying' | 'resolved' | 'abandoned';
  retryCount: number;
  maxRetries: number;
  nextRetryAt?: string | null;
  retryStrategy: 'exponential' | 'linear' | 'fixed';
  resolvedAt?: string | null;
  resolvedBy?: string | null;
  resolutionMethod?: 'manual_retry' | 'auto_retry' | 'abandoned' | 'fixed' | 'max_retries_exceeded' | 'manual_abandon' | null;
  resolutionNotes?: string | null;
  metadata?: Record<string, any>;
  failedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface DLQListResponse {
  success: boolean;
  data: DLQEntry[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}

export const listDLQEntries = async (filters: {
  status?: 'pending' | 'retrying' | 'resolved' | 'abandoned';
  integrationConfigId?: string;
  errorCategory?: string;
  errorCode?: string;
  direction?: 'OUTBOUND' | 'INBOUND' | 'SCHEDULED';
  startDate?: string;
  endDate?: string;
  limit?: number;
  offset?: number;
} = {}): Promise<DLQListResponse> => {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      params.set(key, String(value));
    }
  });
  const query = params.toString() ? `?${params.toString()}` : '';
  return request<DLQListResponse>(`/dlq${query}`);
};

export const getDLQEntry = async (dlqId: string): Promise<DLQEntry> => {
  const response = await request<{ success: boolean; data: DLQEntry }>(`/dlq/${dlqId}`);
  return response.data;
};

export const retryDLQEntry = async (dlqId: string): Promise<void> => {
  await request(`/dlq/${dlqId}/retry`, {
    method: 'POST'
  });
};

export const abandonDLQEntry = async (dlqId: string, notes?: string): Promise<void> => {
  await request(`/dlq/${dlqId}/abandon`, {
    method: 'POST',
    body: JSON.stringify({ notes })
  });
};

export const deleteDLQEntry = async (dlqId: string): Promise<void> => {
  await request(`/dlq/${dlqId}`, {
    method: 'DELETE'
  });
};

export const bulkRetryDLQ = async (dlqIds: string[]): Promise<{ success: string[]; failed: Array<{ dlqId: string; error: string }> }> => {
  const response = await request<{ success: boolean; data: { success: string[]; failed: Array<{ dlqId: string; error: string }> } }>('/dlq/bulk/retry', {
    method: 'POST',
    body: JSON.stringify({ dlqIds })
  });
  return response.data;
};

export const bulkAbandonDLQ = async (dlqIds: string[], notes?: string): Promise<{ success: string[]; failed: Array<{ dlqId: string; error: string }> }> => {
  const response = await request<{ success: boolean; data: { success: string[]; failed: Array<{ dlqId: string; error: string }> } }>('/dlq/bulk/abandon', {
    method: 'POST',
    body: JSON.stringify({ dlqIds, notes })
  });
  return response.data;
};

export const bulkDeleteDLQ = async (dlqIds: string[]): Promise<{ success: string[]; failed: Array<{ dlqId: string; error: string }> }> => {
  const response = await request<{ success: boolean; data: { success: string[]; failed: Array<{ dlqId: string; error: string }> } }>('/dlq/bulk/delete', {
    method: 'POST',
    body: JSON.stringify({ dlqIds })
  });
  return response.data;
};

export const getDLQStats = async (filters: {
  integrationConfigId?: string;
  startDate?: string;
  endDate?: string;
} = {}): Promise<any> => {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      params.set(key, String(value));
    }
  });
  const query = params.toString() ? `?${params.toString()}` : '';
  const response = await request<{ success: boolean; data: any }>(`/dlq/stats${query}`);
  return response.data;
};

export const getDLQSummaryForIntegration = async (integrationId: string): Promise<any> => {
  const response = await request<{ success: boolean; data: any }>(`/dlq/integration/${integrationId}/summary`);
  return response.data;
};

export const updateAdminUiConfig = async (config: any) => {
  const response = await request<{ config: any }>('/admin/ui-config', {
    method: 'PATCH',
    body: JSON.stringify({ config })
  });
  return response.config;
};

export const getAdminSystemConfig = async () => {
  const response = await request<{ config: any }>('/admin/system-config');
  return response.config;
};

export const updateAdminSystemConfig = async (config: any) => {
  const response = await request<{ message: string; requiresRestart: boolean }>('/admin/system-config', {
    method: 'PATCH',
    body: JSON.stringify({ config })
  });
  return response;
};

// ==================== Scheduled Jobs APIs ====================

/**
 * Get all scheduled jobs
 */
export const getAllScheduledJobs = async (orgId?: string | null): Promise<any[]> =>
  request('/scheduled-jobs');

/**
 * Get scheduled job by ID
 */
export const getScheduledJobById = async (id: string, orgId?: string | null): Promise<any> =>
  request(`/scheduled-jobs/${id}`);

/**
 * Create new scheduled job
 */
export const createScheduledJob = async (job: any, orgId?: string | null): Promise<any> =>
  request('/scheduled-jobs', {
    method: 'POST',
    body: JSON.stringify(job)
  });

/**
 * Update scheduled job
 */
export const updateScheduledJob = async (id: string, job: any, orgId?: string | null): Promise<any> =>
  request(`/scheduled-jobs/${id}`, {
    method: 'PUT',
    body: JSON.stringify(job)
  });

/**
 * Delete scheduled job
 */
export const deleteScheduledJob = async (id: string, orgId?: string | null): Promise<void> =>
  request(`/scheduled-jobs/${id}`, {
    method: 'DELETE'
  });

/**
 * Manually trigger job execution
 */
export const executeScheduledJob = async (id: string, orgId?: string | null): Promise<{ message: string }> =>
  request(`/scheduled-jobs/${id}/execute`, {
    method: 'POST'
  });

/**
 * Get execution logs for a scheduled job
 */
export const getScheduledJobLogs = async (
  id: string,
  filters?: {
    status?: string;
    limit?: number;
    offset?: number;
  },
  orgId?: string | null
): Promise<any[]> => {
  const params = new URLSearchParams();

  if (filters?.status) params.set('status', filters.status);
  if (filters?.limit) params.set('limit', filters.limit.toString());
  if (filters?.offset) params.set('offset', filters.offset.toString());

  const query = params.toString();
  return request(`/scheduled-jobs/${id}/logs${query ? `?${query}` : ''}`);
};

/**
 * Get single execution log detail
 */
export const getScheduledJobLogById = async (
  jobId: string,
  logId: string,
  orgId?: string | null
): Promise<any> =>
  request(`/scheduled-jobs/${jobId}/logs/${logId}`);

/**
 * Test data source configuration and get sample data
 */
export const testDataSource = async (
  dataSource: any,
  orgId?: string | null
): Promise<{
  success: boolean;
  message: string;
  recordsFetched?: number;
  sampleData?: any;
  limitedRecords?: boolean;
  error?: string;
  details?: any;
}> =>
  request('/scheduled-jobs/test-datasource', {
    method: 'POST',
    body: JSON.stringify({ dataSource })
  });

/**
 * Bulk import events from file upload
 */
export const bulkImportEvents = async (
  file: File,
  dryRun = false,
  continueOnError = true
): Promise<{
  success: boolean;
  summary: {
    total: number;
    successful: number;
    failed: number;
    duplicates: number;
  };
  results: {
    successful: any[];
    failed: any[];
    duplicates: any[];
  };
  parseErrors?: any[];
}> => {
  const formData = new FormData();
  formData.append('file', file);

  const params = new URLSearchParams();
  params.set('dryRun', dryRun.toString());
  params.set('continueOnError', continueOnError.toString());

  const response = await fetch(
    `${API_BASE_URL}/events/import?${params.toString()}`,
    {
      method: 'POST',
      headers: buildAuthHeadersNoContentType(),
      body: formData
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new APIError(
      error.error || 'Import failed',
      response.status,
      error.code,
      error
    );
  }

  return response.json();
};

/**
 * Bulk import events from JSON data
 */
export const bulkImportEventsJSON = async (
  events: any[],
  dryRun = false,
  continueOnError = true
): Promise<{
  success: boolean;
  summary: {
    total: number;
    successful: number;
    failed: number;
    duplicates: number;
  };
  results: {
    successful: any[];
    failed: any[];
    duplicates: any[];
  };
  parseErrors?: any[];
}> => {
  const params = new URLSearchParams();
  params.set('dryRun', dryRun.toString());
  params.set('continueOnError', continueOnError.toString());

  return request(`/events/import?${params.toString()}`, {
    method: 'POST',
    body: JSON.stringify({ events })
  });
};

/**
 * Download import template in specified format
 */
export const downloadImportTemplate = (format: 'csv' | 'json' | 'xlsx') => {
  const url = `${API_BASE_URL}/events/import/template?format=${format}`;
  window.open(url, '_blank');
};

// ============================================
// USER ACTIVITY TRACKING API
// ============================================

export interface UserActivity {
  _id: string;
  timestamp: string;
  event: string;
  category: string;
  userId: string;
  userEmail: string;
  userRole: string;
  orgId: number;
  page: string | null;
  feature: string | null;
  action: string | null;
  target: any;
  changes: {
    before: any;
    after: any;
  } | null;
  duration: number | null;
  ipAddress: string | null;
  userAgent: string | null;
  success: boolean;
  errorMessage: string | null;
  metadata: Record<string, any>;
  sessionId: string | null;
  date: string;
  hour: number;
}

export interface UserActivityStats {
  totalActivities: number;
  uniqueUsers: number;
  eventsByType: Array<{ event: string; count: number }>;
  activitiesByCategory: Array<{ category: string; count: number }>;
  topPages: Array<{ page: string; count: number }>;
  topFeatures: Array<{ feature: string; count: number }>;
  hourlyActivity: Array<{ hour: number; count: number }>;
}

/**
 * Query user activities with filters
 */
export const getUserActivities = async (params: {
  startDate?: string;
  endDate?: string;
  userId?: string;
  event?: string;
  category?: string;
  orgId?: number;
  page?: number;
  feature?: string;
  success?: boolean;
  search?: string;
  limit?: number;
}): Promise<{ activities: UserActivity[]; pagination: any }> => {
  const queryParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      queryParams.append(key, String(value));
    }
  });

  return request(`/admin/audit/activities?${queryParams.toString()}`);
};

/**
 * Get user activity statistics
 */
export const getUserActivityStats = async (params: {
  startDate?: string;
  endDate?: string;
  userId?: string;
  orgId?: number;
}): Promise<UserActivityStats> => {
  const queryParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      queryParams.append(key, String(value));
    }
  });

  return request(`/admin/audit/activities/stats?${queryParams.toString()}`);
};

/**
 * Get user session timeline
 */
export const getUserSessions = async (
  userId: string,
  params?: { startDate?: string; endDate?: string }
): Promise<{ userId: string; sessions: any[]; totalSessions: number }> => {
  const queryParams = new URLSearchParams();
  if (params?.startDate) queryParams.append('startDate', params.startDate);
  if (params?.endDate) queryParams.append('endDate', params.endDate);

  return request(`/admin/audit/activities/sessions/${userId}?${queryParams.toString()}`);
};

/**
 * Get available activity event types
 */
export const getActivityEvents = async (): Promise<{ events: string[] }> => {
  return request('/admin/audit/activity-events');
};

/**
 * Get available activity categories
 */
export const getActivityCategories = async (): Promise<{ categories: string[] }> => {
  return request('/admin/audit/activity-categories');
};

/**
 * Admin Audit Logs (for tracking admin actions, not user activities)
 */

export interface AuditLog {
  _id: string;
  timestamp: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  userId?: string;
  userEmail?: string;
  userRole?: string;
  orgId?: number;
  changes?: {
    before?: any;
    after?: any;
  };
  metadata?: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
  success: boolean;
  errorMessage?: string;
}

export interface AuditStats {
  totalLogs: number;
  failedActions: number;
  successRate: string;
  actionsByType: Array<{ action: string; count: number }>;
  topUsers: Array<{ userId: string; userEmail: string; count: number }>;
}

/**
 * Get admin audit logs
 */
export const getAdminAuditLogs = async (params: {
  startDate?: string;
  endDate?: string;
  userId?: string;
  action?: string;
  resourceType?: string;
  orgId?: number;
  success?: boolean;
  search?: string;
  page?: number;
  limit?: number;
}): Promise<{ logs: AuditLog[]; pagination: any }> => {
  const queryParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      queryParams.append(key, String(value));
    }
  });

  return request(`/admin/audit/logs?${queryParams.toString()}`);
};

/**
 * Get admin audit log statistics
 */
export const getAdminAuditStats = async (params: {
  startDate?: string;
  endDate?: string;
}): Promise<AuditStats> => {
  const queryParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      queryParams.append(key, String(value));
    }
  });

  return request(`/admin/audit/stats?${queryParams.toString()}`);
};

/**
 * Export audit logs (system audit logs, not admin audit logs)
 */
export const exportAuditLogs = async (params: {
  format: 'json' | 'csv';
  startDate?: string;
  endDate?: string;
  action?: string;
  resourceType?: string;
  success?: boolean;
}): Promise<Blob> => {
  const response = await fetch(`${API_BASE_URL}/admin/audit/export`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...buildAuthHeaders()
    },
    body: JSON.stringify(params)
  });

  if (!response.ok) {
    throw new Error('Export failed');
  }

  return response.blob();
};

// ---------------------------------------------------------------------------
// Event Source Configuration
// ---------------------------------------------------------------------------

export interface ColumnMeta {
  name: string;
  type: string;
  nullable: boolean;
  key: string | null;
  default: any;
}

export interface EventSourceConfig {
  orgId: number;
  type: 'mysql' | 'kafka' | 'http_push';
  config: Record<string, any>;
  isActive: boolean;
  updatedAt?: string;
  createdAt?: string;
}

export interface EventSourceTestResult {
  success: boolean;
  message?: string;
  // Failure fields
  code?: string;
  error?: string;
  hint?: string;
  // MySQL success fields
  tableColumns?: string[];
  columnMeta?: ColumnMeta[];
  columnTypes?: Record<string, string>;
  validatedMapping?: Record<string, { column: string; found: boolean; type?: string | null }>;
  sampleEvent?: Record<string, any> | null;
  // Kafka success fields
  topicExists?: boolean | null;
  topicMeta?: { name: string; partitions: number } | null;
  availableTopics?: string[];
}

export interface EventSourceColumnsResult {
  success: boolean;
  table?: string;
  columns?: ColumnMeta[];
  code?: string;
  error?: string;
  hint?: string;
}

/**
 * Get the event source configuration for an org.
 * Throws APIError with statusCode 404 if not configured yet.
 */
export const getEventSourceConfig = async (orgId: number): Promise<EventSourceConfig> =>
  request(`/event-sources/${orgId}`);

/**
 * Create or update the event source configuration for an org.
 */
export const upsertEventSourceConfig = async (
  orgId: number,
  payload: { type: string; config: Record<string, any> }
): Promise<EventSourceConfig> =>
  request(`/event-sources/${orgId}`, { method: 'PUT', body: JSON.stringify(payload) });

/**
 * Deactivate (soft-delete) the event source configuration for an org.
 */
export const deleteEventSourceConfig = async (orgId: number): Promise<{ success: boolean }> =>
  request(`/event-sources/${orgId}`, { method: 'DELETE' });

/**
 * Test an event source configuration without saving it.
 * Always returns { success: boolean, ... } — never throws for connection failures.
 */
export const testEventSourceConnection = async (
  type: string,
  config: Record<string, any>
): Promise<EventSourceTestResult> =>
  request('/event-sources/test', { method: 'POST', body: JSON.stringify({ type, config }) });

/**
 * Discover table columns for an org's saved event source configuration.
 */
export const getEventSourceColumns = async (orgId: number): Promise<EventSourceColumnsResult> =>
  request(`/event-sources/${orgId}/columns`);

// ---------------------------------------------------------------------------
// Admin MySQL shared pool
// ---------------------------------------------------------------------------

export interface MysqlPoolConfig {
  host: string;
  port?: number;
  user: string;
  password: string;
  database: string;
  connectionLimit?: number;
  queueLimit?: number;
}

export const getAdminMysqlPool = async (): Promise<{ config: MysqlPoolConfig; isConfigured: boolean }> =>
  request('/admin/mysql-pool');

export const updateAdminMysqlPool = async (
  config: MysqlPoolConfig
): Promise<{ success: boolean; message: string }> =>
  request('/admin/mysql-pool', { method: 'PUT', body: JSON.stringify(config) });

export const testAdminMysqlPool = async (config: MysqlPoolConfig): Promise<EventSourceTestResult> =>
  request('/admin/mysql-pool/test', { method: 'POST', body: JSON.stringify(config) });

// ---------------------------------------------------------------------------
// Admin Storage Stats
// ---------------------------------------------------------------------------

export interface CollectionStat {
  name: string;
  label: string;
  count: number;
  dataSize: number;
  storageSize: number;
  indexSize: number;
  totalSize: number;
  avgObjSize: number;
  percentOfTotal: number;
}

export interface StorageStats {
  db: {
    dataSize: number;
    storageSize: number;
    indexSize: number;
    objects: number;
    collections: number;
    avgObjSize: number;
  };
  collections: CollectionStat[];
  /** true when the caller is ORG_ADMIN — storage sizes are platform-wide, counts are org-scoped */
  isOrgView?: boolean;
  generatedAt: string;
}

export const getAdminStorageStats = async (): Promise<StorageStats> =>
  request('/admin/storage-stats');
