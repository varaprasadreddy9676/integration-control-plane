/**
 * Flow to Payload Converter
 *
 * Converts a visual flow graph to the backend integration payload format.
 * Maps FlowState → BackendIntegrationPayload
 */

import {
  FlowState,
  FlowNode,
  BackendIntegrationPayload,
  TriggerNodeData,
  InboundAuthNodeData,
  OutboundAuthNodeData,
  HttpNodeData,
  TransformNodeData,
  IntegrationNodeData,
  MultiActionNodeData,
  IntegrationDirection,
  TransformMode,
  AuthType,
} from './flowTypes';

// ============================================================================
// Main Conversion Function
// ============================================================================

/**
 * Converts a flow graph to backend integration payload format
 */
export function flowToPayload(flowState: FlowState, orgId: number): BackendIntegrationPayload {
  // Extract nodes by type
  const triggerNode = flowState.nodes.find((n) => n.type === 'trigger');
  const inboundAuthNode = flowState.nodes.find((n) => n.type === 'inboundAuth');
  const outboundAuthNode = flowState.nodes.find((n) => n.type === 'outboundAuth');
  const transformNodes = flowState.nodes.filter((n) => n.type === 'transform');
  const httpNodes = flowState.nodes.filter((n) => n.type === 'http');
  const scheduleScriptNodes = flowState.nodes.filter((n) => n.type === 'scheduleScript');
  const integrationNodes = flowState.nodes.filter((n) => n.type === 'integration');
  const multiActionNodes = flowState.nodes.filter((n) => n.type === 'multiAction');

  if (!triggerNode) {
    throw new Error('Flow must have a trigger node');
  }

  const triggerData = triggerNode.data as TriggerNodeData;

  // Determine direction
  const direction: IntegrationDirection = flowState.mode === 'INBOUND' ? 'INBOUND' : 'OUTBOUND';

  // Initialize payload
  const payload: BackendIntegrationPayload = {
    name: flowState.name,
    direction,
    orgId,
    isActive: flowState.isActive ?? true,
  };

  // Add mode-specific configuration
  if (flowState.mode === 'INBOUND') {
    convertInboundFlow(flowState, payload, triggerData, inboundAuthNode, transformNodes, httpNodes);
  } else if (flowState.mode === 'OUTBOUND_EVENT') {
    convertOutboundEventFlow(flowState, payload, triggerData, outboundAuthNode, transformNodes, integrationNodes, multiActionNodes);
  } else if (flowState.mode === 'OUTBOUND_SCHEDULED') {
    convertOutboundScheduledFlow(flowState, payload, triggerData, outboundAuthNode, transformNodes, httpNodes, integrationNodes, multiActionNodes, scheduleScriptNodes);
  }

  // Add rate limiting if configured
  if (flowState.rateLimits?.enabled) {
    payload.rateLimits = {
      enabled: true,
      maxRequests: flowState.rateLimits.maxRequests,
      windowSeconds: flowState.rateLimits.windowSeconds,
    };
  }

  return payload;
}

// ============================================================================
// Mode-Specific Converters
// ============================================================================

/**
 * Convert INBOUND flow to payload
 * Flow: Trigger → InboundAuth → HTTP Call → Transform → Response
 */
function convertInboundFlow(
  flowState: FlowState,
  payload: BackendIntegrationPayload,
  triggerData: TriggerNodeData,
  inboundAuthNode: FlowNode | undefined,
  transformNodes: FlowNode[],
  httpNodes: FlowNode[]
): void {
  // Set integration type (e.g., LAB_RESULTS, APPOINTMENT_CREATED)
  payload.type = triggerData.inboundType || '';

  // Add inbound authentication
  if (inboundAuthNode) {
    const authData = inboundAuthNode.data as InboundAuthNodeData;
    const inboundAuth = convertInboundAuth(authData);
    payload.inboundAuthType = inboundAuth.type;
    payload.inboundAuthConfig = inboundAuth.config;
  } else {
    payload.inboundAuthType = 'NONE';
    payload.inboundAuthConfig = null;
  }

  // Find target URL from HTTP node
  const httpNode = httpNodes[0]; // INBOUND typically has one HTTP call
  if (httpNode) {
    const httpData = httpNode.data as HttpNodeData;
    payload.targetUrl = httpData.url;
    payload.httpMethod = httpData.method;
    payload.headers = httpData.headers;
    payload.timeoutMs = httpData.timeout || 10000;
    payload.retryCount = httpData.retryCount || 3;
    payload.retryDelay = httpData.retryDelay || 1000;
    payload.contentType = payload.contentType || 'application/json';
  }

  // Add request and response transformations
  const requestTransformNode = transformNodes.find((n) => (n.data as TransformNodeData).transformDirection === 'request');
  const responseTransformNode = transformNodes.find((n) => (n.data as TransformNodeData).transformDirection === 'response');

  if (requestTransformNode) {
    payload.requestTransformation = convertTransform(requestTransformNode.data as TransformNodeData);
  } else {
    payload.requestTransformation = { mode: 'NONE' };
  }

  if (responseTransformNode) {
    payload.responseTransformation = convertTransform(responseTransformNode.data as TransformNodeData);
  } else {
    payload.responseTransformation = { mode: 'NONE' };
  }

  payload.outgoingAuthType = payload.outgoingAuthType || 'NONE';
  payload.outgoingAuthConfig = payload.outgoingAuthConfig || null;
}

/**
 * Convert OUTBOUND_EVENT flow to payload
 * Flow: Trigger (Event) → Filter → Transform → OutboundAuth → Integration
 */
function convertOutboundEventFlow(
  flowState: FlowState,
  payload: BackendIntegrationPayload,
  triggerData: TriggerNodeData,
  outboundAuthNode: FlowNode | undefined,
  transformNodes: FlowNode[],
  integrationNodes: FlowNode[],
  multiActionNodes: FlowNode[]
): void {
  // Add event trigger configuration
  payload.type = triggerData.eventName || '';
  payload.eventType = payload.type;
  payload.scope = 'INCLUDE_CHILDREN';

  // Add outbound authentication
  if (outboundAuthNode) {
    const authData = outboundAuthNode.data as OutboundAuthNodeData;
    const outboundAuth = convertOutboundAuth(authData);
    payload.outgoingAuthType = outboundAuth.type;
    payload.outgoingAuthConfig = outboundAuth.config;
  } else {
    payload.outgoingAuthType = 'NONE';
    payload.outgoingAuthConfig = null;
  }

  // Add request transformation (transform before integration)
  const requestTransformNode = transformNodes[0];
  if (requestTransformNode) {
    const transform = convertTransform(requestTransformNode.data as TransformNodeData);
    payload.transformationMode = transform.mode;
    payload.transformation = transform;
  } else {
    payload.transformationMode = 'NONE';
    payload.transformation = null;
  }

  // Add integration delivery configuration
  if (integrationNodes.length > 0) {
    const integrationNode = integrationNodes[0];
    const integrationData = integrationNode.data as IntegrationNodeData;

    payload.targetUrl = integrationData.url;
    payload.httpMethod = integrationData.method || 'POST';
    payload.headers = integrationData.headers;
    payload.timeoutMs = integrationData.timeout || 10000;
    payload.retryCount = integrationData.retryCount || 3;
    payload.retryDelay = integrationData.retryDelay || 1000;
    payload.contentType = payload.contentType || 'application/json';
  }

  // Add multi-action delivery
  if (multiActionNodes.length > 0) {
    const multiActionNode = multiActionNodes[0];
    const multiActionData = multiActionNode.data as MultiActionNodeData;

    payload.actions = multiActionData.actions
      .filter((a) => a.enabled)
      .map((a) => ({
        name: a.name,
        url: a.url,
        method: a.method,
        headers: a.headers,
      }));
  }

  payload.deliveryMode = 'IMMEDIATE';
}

/**
 * Convert OUTBOUND_SCHEDULED flow to payload
 * Flow: Trigger (Schedule) → HTTP (Fetch) → Transform → Integration (Deliver)
 */
function convertOutboundScheduledFlow(
  flowState: FlowState,
  payload: BackendIntegrationPayload,
  triggerData: TriggerNodeData,
  outboundAuthNode: FlowNode | undefined,
  transformNodes: FlowNode[],
  httpNodes: FlowNode[],
  integrationNodes: FlowNode[],
  multiActionNodes: FlowNode[],
  scheduleScriptNodes: FlowNode[]
): void {
  // Scheduled integrations use deliveryMode + schedulingConfig (script required by backend)
  payload.deliveryMode = triggerData.scheduleType === 'DELAYED' ? 'DELAYED' : 'RECURRING';
  const scheduleNode = scheduleScriptNodes[0];
  payload.schedulingConfig = {
    script: scheduleNode ? (scheduleNode.data as any).script || '' : ''
  };
  payload.type = triggerData.eventName || flowState.name;
  payload.eventType = payload.type;
  payload.scope = 'INCLUDE_CHILDREN';

  // Add outbound authentication
  if (outboundAuthNode) {
    const authData = outboundAuthNode.data as OutboundAuthNodeData;
    const outboundAuth = convertOutboundAuth(authData);
    payload.outgoingAuthType = outboundAuth.type;
    payload.outgoingAuthConfig = outboundAuth.config;
  } else {
    payload.outgoingAuthType = 'NONE';
    payload.outgoingAuthConfig = null;
  }

  // Add request transformation
  const transformNode = transformNodes[0];
  if (transformNode) {
    const transform = convertTransform(transformNode.data as TransformNodeData);
    payload.transformationMode = transform.mode;
    payload.transformation = transform;
  } else {
    payload.transformationMode = 'NONE';
    payload.transformation = null;
  }

  // Add integration delivery configuration
  if (integrationNodes.length > 0) {
    const integrationNode = integrationNodes[0];
    const integrationData = integrationNode.data as IntegrationNodeData;

    payload.targetUrl = integrationData.url;
    payload.httpMethod = integrationData.method || 'POST';
    payload.headers = integrationData.headers;
    payload.timeoutMs = integrationData.timeout || 10000;
    payload.retryCount = integrationData.retryCount || 3;
    payload.retryDelay = integrationData.retryDelay || 1000;
    payload.contentType = payload.contentType || 'application/json';
  }

  // Add multi-action delivery
  if (multiActionNodes.length > 0) {
    const multiActionNode = multiActionNodes[0];
    const multiActionData = multiActionNode.data as MultiActionNodeData;

    payload.actions = multiActionData.actions
      .filter((a) => a.enabled)
      .map((a) => ({
        name: a.name,
        url: a.url,
        method: a.method,
        headers: a.headers,
      }));
  }
}

// ============================================================================
// Node Converters
// ============================================================================

/**
 * Convert inbound auth node to backend auth config
 */
function convertInboundAuth(authData: InboundAuthNodeData): { type: AuthType; config: BackendIntegrationPayload['inboundAuthConfig'] } {
  if (authData.authType === 'NONE') {
    return { type: 'NONE', config: null };
  }

  if (authData.authType === 'API_KEY') {
    return {
      type: 'API_KEY',
      config: {
        headerName: authData.apiKeyHeader || 'X-API-Key',
        value: authData.expectedApiKey,
      }
    };
  }

  if (authData.authType === 'BEARER') {
    return {
      type: 'BEARER',
      config: {
        token: authData.expectedBearerToken,
      }
    };
  }

  if (authData.authType === 'BASIC') {
    return {
      type: 'BASIC',
      config: {
        username: authData.expectedUsername,
        password: authData.expectedPassword,
      }
    };
  }

  return { type: authData.authType, config: null };
}

/**
 * Convert outbound auth node to backend auth config
 */
function convertOutboundAuth(authData: OutboundAuthNodeData): { type: AuthType; config: BackendIntegrationPayload['outgoingAuthConfig'] } {
  if (authData.authType === 'NONE') {
    return { type: 'NONE', config: null };
  }

  if (authData.authType === 'API_KEY') {
    return {
      type: 'API_KEY',
      config: {
        headerName: authData.apiKeyHeader || 'X-API-Key',
        value: authData.apiKey,
      }
    };
  }

  if (authData.authType === 'BEARER') {
    return {
      type: 'BEARER',
      config: {
        token: authData.bearerToken,
      }
    };
  }

  if (authData.authType === 'BASIC') {
    return {
      type: 'BASIC',
      config: {
        username: authData.basicUsername,
        password: authData.basicPassword,
      }
    };
  }

  if (authData.authType === 'OAUTH2' && authData.oauth2Config) {
    return {
      type: 'OAUTH2',
      config: {
        oauth2: {
          tokenUrl: authData.oauth2Config.tokenUrl,
          clientId: authData.oauth2Config.clientId,
          clientSecret: authData.oauth2Config.clientSecret,
          scope: authData.oauth2Config.scope,
        }
      }
    };
  }

  return { type: authData.authType, config: null };
}

/**
 * Convert transform node to backend transform config
 */
function convertTransform(transformData: TransformNodeData): NonNullable<BackendIntegrationPayload['requestTransformation']> {
  const transform: NonNullable<BackendIntegrationPayload['requestTransformation']> = {
    mode: transformData.transformMode,
  };

  if (transformData.transformMode === 'SIMPLE' && transformData.simpleMapping) {
    transform.simpleMapping = {
      fieldMappings: transformData.simpleMapping.fieldMappings?.map((m) => ({
        source: m.sourcePath,
        target: m.targetPath,
        defaultValue: m.defaultValue,
      })),
      staticFields: transformData.simpleMapping.staticFields,
    };
  } else if (transformData.transformMode === 'SCRIPT') {
    transform.script = transformData.scriptCode;
  }

  return transform;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Validate payload before sending to backend
 */
export function validatePayload(payload: BackendIntegrationPayload): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Required fields
  if (!payload.name || payload.name.trim().length === 0) {
    errors.push('Integration name is required');
  }

  if (!payload.direction) {
    errors.push('Integration direction is required');
  }

  if (!payload.orgId) {
    errors.push('Organization ID is required');
  }

  // Direction-specific validation
  if (payload.direction === 'INBOUND') {
    if (!payload.type) {
      errors.push('INBOUND integration must have a type (e.g., LAB_RESULTS)');
    }
  }

  if (payload.direction === 'OUTBOUND') {
    if (!payload.targetUrl && !payload.actions) {
      errors.push('OUTBOUND integration must have a target URL or delivery actions');
    }
  }

  if (payload.direction === 'OUTBOUND' && !payload.type && !payload.eventType) {
    errors.push('OUTBOUND event integrations must have an event type');
  }

  if (payload.deliveryMode && payload.deliveryMode !== 'IMMEDIATE') {
    if (!payload.schedulingConfig?.script) {
      errors.push('Scheduled integrations require schedulingConfig.script');
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Generate a preview of what the payload will look like
 */
export function generatePayloadPreview(flowState: FlowState, orgId: number): string {
  try {
    const payload = flowToPayload(flowState, orgId);
    return JSON.stringify(payload, null, 2);
  } catch (error) {
    return `Error generating preview: ${(error as Error).message}`;
  }
}

/**
 * Get a summary of the flow configuration
 */
export function getFlowSummary(flowState: FlowState): {
  mode: string;
  nodeCount: number;
  edgeCount: number;
  hasAuth: boolean;
  hasTransform: boolean;
  hasRateLimit: boolean;
} {
  return {
    mode: flowState.mode,
    nodeCount: flowState.nodes.length,
    edgeCount: flowState.edges.length,
    hasAuth:
      flowState.nodes.some((n) => n.type === 'inboundAuth') || flowState.nodes.some((n) => n.type === 'outboundAuth'),
    hasTransform: flowState.nodes.some((n) => n.type === 'transform'),
    hasRateLimit: flowState.rateLimits?.enabled ?? false,
  };
}
