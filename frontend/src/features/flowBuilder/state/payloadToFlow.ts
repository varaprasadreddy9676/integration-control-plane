/**
 * Payload to Flow Converter
 *
 * Converts backend integration payload to visual flow graph format.
 * Maps BackendIntegrationPayload → FlowState
 */

import {
  FlowState,
  FlowNode,
  FlowEdge,
  BackendIntegrationPayload,
  IntegrationMode,
  TriggerNodeData,
  InboundAuthNodeData,
  OutboundAuthNodeData,
  HttpNodeData,
  TransformNodeData,
  IntegrationNodeData,
  MultiActionNodeData,
  ResponseNodeData,
} from './flowTypes';

// ============================================================================
// Main Conversion Function
// ============================================================================

/**
 * Converts a backend integration payload to a flow graph
 */
export function payloadToFlow(payload: BackendIntegrationPayload, integrationId?: string): FlowState {
  // Determine integration mode
  const mode = determineIntegrationMode(payload);

  // Initialize flow state
  const flowState: FlowState = {
    id: integrationId,
    name: payload.name,
    description: '',
    mode,
    nodes: [],
    edges: [],
    rateLimits: payload.rateLimits || { enabled: false, maxRequests: 100, windowSeconds: 60 },
    isActive: payload.isActive ?? true,
    isValid: false,
    errors: [],
    warnings: [],
    isDirty: false,
    orgId: payload.orgId,
  };

  // Convert based on mode
  if (mode === 'INBOUND') {
    convertInboundPayload(payload, flowState);
  } else if (mode === 'OUTBOUND_EVENT') {
    convertOutboundEventPayload(payload, flowState);
  } else if (mode === 'OUTBOUND_SCHEDULED') {
    convertOutboundScheduledPayload(payload, flowState);
  }

  return flowState;
}

// ============================================================================
// Mode Determination
// ============================================================================

/**
 * Determine integration mode from payload
 */
function determineIntegrationMode(payload: BackendIntegrationPayload): IntegrationMode {
  if (payload.direction === 'INBOUND') {
    return 'INBOUND';
  }

  if (payload.deliveryMode && payload.deliveryMode !== 'IMMEDIATE') {
    return 'OUTBOUND_SCHEDULED';
  }

  // Default to OUTBOUND_EVENT if direction is OUTBOUND but no trigger specified
  return 'OUTBOUND_EVENT';
}

// ============================================================================
// Mode-Specific Converters
// ============================================================================

/**
 * Convert INBOUND payload to flow graph
 * Flow: Trigger → InboundAuth → HTTP Call → Transform → Response
 */
function convertInboundPayload(payload: BackendIntegrationPayload, flowState: FlowState): void {
  let xPosition = 100;
  const yPosition = 200;
  const xSpacing = 250;
  let previousNodeId: string | null = null;

  // 1. Create trigger node
  const triggerId = 'trigger-1';
  flowState.nodes.push({
    id: triggerId,
    type: 'trigger',
    position: { x: xPosition, y: yPosition },
    data: {
      nodeType: 'trigger',
      label: 'Inbound Request',
      description: 'Receives incoming API requests',
      isValid: !!payload.type,
      triggerType: 'INBOUND',
      inboundType: payload.type,
    } as TriggerNodeData,
  });
  previousNodeId = triggerId;
  xPosition += xSpacing;

  // 2. Create inbound auth node if configured
  if (payload.inboundAuthType && payload.inboundAuthType !== 'NONE') {
    const authId = 'inbound-auth-1';
    const inboundConfig = payload.inboundAuthConfig || {};
    flowState.nodes.push({
      id: authId,
      type: 'inboundAuth',
      position: { x: xPosition, y: yPosition },
      data: {
        nodeType: 'inboundAuth',
        label: 'Validate Request',
        description: 'Authenticate incoming request',
        isValid: true,
        authType: payload.inboundAuthType as any,
        apiKeyHeader: inboundConfig.headerName || 'X-API-Key',
        expectedApiKey: inboundConfig.value,
        expectedBearerToken: inboundConfig.token,
        expectedUsername: inboundConfig.username,
        expectedPassword: inboundConfig.password,
      } as InboundAuthNodeData,
    });

    flowState.edges.push({
      id: `e-${previousNodeId}-${authId}`,
      source: previousNodeId,
      target: authId,
      animated: true,
    });

    previousNodeId = authId;
    xPosition += xSpacing;
  }

  // 3. Create request transform node if configured
  if (payload.requestTransformation && payload.requestTransformation.mode !== 'NONE') {
    const transformId = 'transform-request-1';
    flowState.nodes.push({
      id: transformId,
      type: 'transform',
      position: { x: xPosition, y: yPosition },
      data: convertTransformPayload(
        payload.requestTransformation,
        'request',
        'Transform Request',
        'Transform request before forwarding'
      ),
    });

    flowState.edges.push({
      id: `e-${previousNodeId}-${transformId}`,
      source: previousNodeId,
      target: transformId,
    });

    previousNodeId = transformId;
    xPosition += xSpacing;
  }

  // 4. Create HTTP call node if target URL is configured
  if (payload.targetUrl) {
    const httpId = 'http-1';
    flowState.nodes.push({
      id: httpId,
      type: 'http',
      position: { x: xPosition, y: yPosition },
      data: {
        nodeType: 'http',
        label: 'Call External API',
        description: 'Forward request to external system',
        isValid: !!payload.targetUrl,
        url: payload.targetUrl,
        method: payload.httpMethod || 'POST',
        headers: payload.headers,
        timeout: payload.timeoutMs || 10000,
        retryEnabled: true,
        retryCount: payload.retryCount || 3,
        retryDelay: payload.retryDelay || 1000,
      } as HttpNodeData,
    });

    flowState.edges.push({
      id: `e-${previousNodeId}-${httpId}`,
      source: previousNodeId,
      target: httpId,
    });

    previousNodeId = httpId;
    xPosition += xSpacing;
  }

  // 5. Create response transform node if configured
  if (payload.responseTransformation && payload.responseTransformation.mode !== 'NONE') {
    const transformId = 'transform-response-1';
    flowState.nodes.push({
      id: transformId,
      type: 'transform',
      position: { x: xPosition, y: yPosition },
      data: convertTransformPayload(
        payload.responseTransformation,
        'response',
        'Transform Response',
        'Transform response before returning'
      ),
    });

    flowState.edges.push({
      id: `e-${previousNodeId}-${transformId}`,
      source: previousNodeId,
      target: transformId,
    });

    previousNodeId = transformId;
    xPosition += xSpacing;
  }

  // 6. Create response node
  const responseId = 'response-1';
  flowState.nodes.push({
    id: responseId,
    type: 'response',
    position: { x: xPosition, y: yPosition },
    data: {
      nodeType: 'response',
      label: 'Return Response',
      description: 'Send response back to client',
      isValid: true,
      statusCode: 200,
      bodyType: 'json',
    } as ResponseNodeData,
  });

  flowState.edges.push({
    id: `e-${previousNodeId}-${responseId}`,
    source: previousNodeId,
    target: responseId,
  });
}

/**
 * Convert OUTBOUND_EVENT payload to flow graph
 * Flow: Trigger (Event) → Transform → OutboundAuth → Integration
 */
function convertOutboundEventPayload(payload: BackendIntegrationPayload, flowState: FlowState): void {
  let xPosition = 100;
  const yPosition = 200;
  const xSpacing = 250;
  let previousNodeId: string | null = null;

  // 1. Create trigger node
  const triggerId = 'trigger-1';
  flowState.nodes.push({
    id: triggerId,
    type: 'trigger',
    position: { x: xPosition, y: yPosition },
    data: {
      nodeType: 'trigger',
      label: 'Event Trigger',
      description: 'Listens for system events',
      isValid: !!(payload.type || payload.eventType),
      triggerType: 'OUTBOUND_EVENT',
      eventName: payload.type || payload.eventType,
    } as TriggerNodeData,
  });
  previousNodeId = triggerId;
  xPosition += xSpacing;

  // 3. Create request transform node if configured
  if (payload.transformationMode && payload.transformationMode !== 'NONE') {
    const transformId = 'transform-1';
    flowState.nodes.push({
      id: transformId,
      type: 'transform',
      position: { x: xPosition, y: yPosition },
      data: convertTransformPayload(
        {
          mode: payload.transformationMode,
          simpleMapping: payload.transformation?.simpleMapping,
          script: payload.transformation?.script,
        },
        'request',
        'Transform Payload',
        'Transform event data for integration'
      ),
    });

    flowState.edges.push({
      id: `e-${previousNodeId}-${transformId}`,
      source: previousNodeId,
      target: transformId,
    });

    previousNodeId = transformId;
    xPosition += xSpacing;
  }

  // 3. Create outbound auth node if configured
  if (payload.outgoingAuthType && payload.outgoingAuthType !== 'NONE') {
    const authId = 'outbound-auth-1';
    const outboundConfig = payload.outgoingAuthConfig || {};
    flowState.nodes.push({
      id: authId,
      type: 'outboundAuth',
      position: { x: xPosition, y: yPosition },
      data: {
        nodeType: 'outboundAuth',
        label: 'Add Authentication',
        description: 'Add auth headers to integration',
        isValid: true,
        authType: payload.outgoingAuthType as any,
        apiKey: outboundConfig.value || outboundConfig.apiKey,
        apiKeyHeader: outboundConfig.headerName || outboundConfig.apiKeyHeader || 'X-API-Key',
        bearerToken: outboundConfig.token || outboundConfig.bearerToken,
        basicUsername: outboundConfig.username || outboundConfig.basicAuth?.username,
        basicPassword: outboundConfig.password || outboundConfig.basicAuth?.password,
        oauth2Config: outboundConfig.oauth2
          ? {
              tokenUrl: outboundConfig.oauth2.tokenUrl,
              clientId: outboundConfig.oauth2.clientId,
              clientSecret: outboundConfig.oauth2.clientSecret,
              scope: outboundConfig.oauth2.scope,
            }
          : undefined,
      } as OutboundAuthNodeData,
    });

    flowState.edges.push({
      id: `e-${previousNodeId}-${authId}`,
      source: previousNodeId,
      target: authId,
    });

    previousNodeId = authId;
    xPosition += xSpacing;
  }

  // 4. Create integration or multi-action node
  if (payload.actions && payload.actions.length > 0) {
    const multiActionId = 'multi-action-1';
    flowState.nodes.push({
      id: multiActionId,
      type: 'multiAction',
      position: { x: xPosition, y: yPosition },
      data: {
        nodeType: 'multiAction',
        label: 'Multi-Action Delivery',
        description: 'Deliver to multiple endpoints',
        isValid: true,
        executeInParallel: true,
        continueOnError: true,
        actions: payload.actions.map((action, index) => ({
          id: `action-${index + 1}`,
          name: action.name,
          enabled: true,
          url: action.url,
          method: action.method,
          headers: action.headers,
        })),
        resultAggregation: 'all',
      } as MultiActionNodeData,
    });

    flowState.edges.push({
      id: `e-${previousNodeId}-${multiActionId}`,
      source: previousNodeId,
      target: multiActionId,
    });
  } else if (payload.targetUrl) {
    const integrationId = 'integration-1';
    flowState.nodes.push({
      id: integrationId,
      type: 'integration',
      position: { x: xPosition, y: yPosition },
      data: {
        nodeType: 'integration',
        label: 'Deliver Integration',
        description: 'Send integration to external system',
        isValid: !!payload.targetUrl,
        url: payload.targetUrl,
        method: payload.httpMethod || 'POST',
        headers: payload.headers,
        timeout: payload.timeoutMs || 10000,
        retryEnabled: true,
        retryCount: payload.retryCount || 3,
        retryDelay: payload.retryDelay || 1000,
        enableDLQ: true,
      } as IntegrationNodeData,
    });

    flowState.edges.push({
      id: `e-${previousNodeId}-${integrationId}`,
      source: previousNodeId,
      target: integrationId,
    });
  }
}

/**
 * Convert OUTBOUND_SCHEDULED payload to flow graph
 * Flow: Trigger (Schedule) → HTTP (Fetch) → Transform → Integration (Deliver)
 */
function convertOutboundScheduledPayload(payload: BackendIntegrationPayload, flowState: FlowState): void {
  let xPosition = 100;
  const yPosition = 200;
  const xSpacing = 250;
  let previousNodeId: string | null = null;

  // 1. Create trigger node
  const triggerId = 'trigger-1';
  flowState.nodes.push({
    id: triggerId,
    type: 'trigger',
    position: { x: xPosition, y: yPosition },
    data: {
      nodeType: 'trigger',
      label: 'Schedule Trigger',
      description: 'Runs on a schedule',
      isValid: !!payload.deliveryMode,
      triggerType: 'OUTBOUND_SCHEDULED',
      scheduleType: payload.deliveryMode === 'DELAYED' ? 'DELAYED' : 'RECURRING',
      cronExpression: undefined,
      delaySeconds: undefined,
      recurringInterval: undefined,
      recurringUnit: undefined,
      eventName: payload.type || payload.eventType,
    } as TriggerNodeData,
  });
  previousNodeId = triggerId;
  xPosition += xSpacing;

  // 2. Schedule script node
  const scheduleScriptId = 'schedule-script-1';
  flowState.nodes.push({
    id: scheduleScriptId,
    type: 'scheduleScript',
    position: { x: xPosition, y: yPosition },
    data: {
      nodeType: 'scheduleScript',
      label: 'Schedule Script',
      description: 'Compute next execution time',
      isValid: !!payload.schedulingConfig?.script,
      script: payload.schedulingConfig?.script || '',
    },
  });

  flowState.edges.push({
    id: `e-${previousNodeId}-${scheduleScriptId}`,
    source: previousNodeId,
    target: scheduleScriptId,
    animated: true,
  });

  previousNodeId = scheduleScriptId;
  xPosition += xSpacing;

  // 2. Create request transform node if configured
  if (payload.transformationMode && payload.transformationMode !== 'NONE') {
    const transformId = 'transform-1';
    flowState.nodes.push({
      id: transformId,
      type: 'transform',
      position: { x: xPosition, y: yPosition },
      data: convertTransformPayload(
        {
          mode: payload.transformationMode,
          simpleMapping: payload.transformation?.simpleMapping,
          script: payload.transformation?.script,
        },
        'request',
        'Transform Data',
        'Transform data for delivery'
      ),
    });

    flowState.edges.push({
      id: `e-${previousNodeId}-${transformId}`,
      source: previousNodeId,
      target: transformId,
    });

    previousNodeId = transformId;
    xPosition += xSpacing;
  }

  // 3. Create outbound auth node if configured
  if (payload.outgoingAuthType && payload.outgoingAuthType !== 'NONE') {
    const authId = 'outbound-auth-1';
    const outboundConfig = payload.outgoingAuthConfig || {};
    flowState.nodes.push({
      id: authId,
      type: 'outboundAuth',
      position: { x: xPosition, y: yPosition },
      data: {
        nodeType: 'outboundAuth',
        label: 'Add Authentication',
        description: 'Add auth headers',
        isValid: true,
        authType: payload.outgoingAuthType as any,
        apiKey: outboundConfig.value || outboundConfig.apiKey,
        apiKeyHeader: outboundConfig.headerName || outboundConfig.apiKeyHeader || 'X-API-Key',
        bearerToken: outboundConfig.token || outboundConfig.bearerToken,
        basicUsername: outboundConfig.username || outboundConfig.basicAuth?.username,
        basicPassword: outboundConfig.password || outboundConfig.basicAuth?.password,
        oauth2Config: outboundConfig.oauth2
          ? {
              tokenUrl: outboundConfig.oauth2.tokenUrl,
              clientId: outboundConfig.oauth2.clientId,
              clientSecret: outboundConfig.oauth2.clientSecret,
              scope: outboundConfig.oauth2.scope,
            }
          : undefined,
      } as OutboundAuthNodeData,
    });

    flowState.edges.push({
      id: `e-${previousNodeId}-${authId}`,
      source: previousNodeId,
      target: authId,
    });

    previousNodeId = authId;
    xPosition += xSpacing;
  }

  // 4. Create integration or multi-action node
  if (payload.actions && payload.actions.length > 0) {
    const multiActionId = 'multi-action-1';
    flowState.nodes.push({
      id: multiActionId,
      type: 'multiAction',
      position: { x: xPosition, y: yPosition },
      data: {
        nodeType: 'multiAction',
        label: 'Multi-Action Delivery',
        description: 'Deliver to multiple endpoints',
        isValid: true,
        executeInParallel: true,
        continueOnError: true,
        actions: payload.actions.map((action, index) => ({
          id: `action-${index + 1}`,
          name: action.name,
          enabled: true,
          url: action.url,
          method: action.method,
          headers: action.headers,
        })),
        resultAggregation: 'all',
      } as MultiActionNodeData,
    });

    flowState.edges.push({
      id: `e-${previousNodeId}-${multiActionId}`,
      source: previousNodeId,
      target: multiActionId,
    });
  } else if (payload.targetUrl) {
    const integrationId = 'integration-1';
    flowState.nodes.push({
      id: integrationId,
      type: 'integration',
      position: { x: xPosition, y: yPosition },
      data: {
        nodeType: 'integration',
        label: 'Deliver Integration',
        description: 'Send data to destination',
        isValid: !!payload.targetUrl,
        url: payload.targetUrl,
        method: payload.httpMethod || 'POST',
        headers: payload.headers,
        timeout: payload.timeoutMs || 10000,
        retryEnabled: true,
        retryCount: payload.retryCount || 3,
        retryDelay: payload.retryDelay || 1000,
        enableDLQ: true,
      } as IntegrationNodeData,
    });

    flowState.edges.push({
      id: `e-${previousNodeId}-${integrationId}`,
      source: previousNodeId,
      target: integrationId,
    });
  }
}

// ============================================================================
// Helper Converters
// ============================================================================

/**
 * Convert transform payload to transform node data
 */
function convertTransformPayload(
  transform: NonNullable<BackendIntegrationPayload['requestTransformation']>,
  direction: 'request' | 'response',
  label: string,
  description: string
): TransformNodeData {
  const data: TransformNodeData = {
    nodeType: 'transform',
    label,
    description,
    isValid: true,
    transformMode: transform.mode,
    transformDirection: direction,
  };

  if (transform.mode === 'SIMPLE' && transform.simpleMapping) {
    data.simpleMapping = {
      fieldMappings:
        transform.simpleMapping.fieldMappings?.map((m, index) => ({
          id: `mapping-${index + 1}`,
          sourcePath: m.source,
          targetPath: m.target,
          defaultValue: m.defaultValue,
          transform: 'none',
        })) || [],
      staticFields: transform.simpleMapping.staticFields,
      removeUnmapped: false,
    };
  } else if (transform.mode === 'SCRIPT') {
    data.scriptCode = transform.script;
    data.scriptTimeout = 5000;
  }

  return data;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Check if a payload can be converted to a flow
 */
export function canConvertToFlow(payload: BackendIntegrationPayload): { canConvert: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!payload.name) {
    errors.push('Integration name is required');
  }

  if (!payload.direction) {
    errors.push('Integration direction is required');
  }

  if (!payload.orgId) {
    errors.push('Organization ID is required');
  }

  return {
    canConvert: errors.length === 0,
    errors,
  };
}

/**
 * Generate a preview of what the flow will look like
 */
export function generateFlowPreview(payload: BackendIntegrationPayload): string {
  try {
    const flow = payloadToFlow(payload);
    return `Flow: ${flow.nodes.map((n) => n.data.label).join(' → ')}`;
  } catch (error) {
    return `Error generating preview: ${(error as Error).message}`;
  }
}
