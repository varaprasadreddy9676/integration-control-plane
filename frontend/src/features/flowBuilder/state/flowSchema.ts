/**
 * Flow Schema Definitions
 *
 * Defines the allowed node types, connection rules, and default templates
 * for each integration mode (INBOUND, OUTBOUND_EVENT, OUTBOUND_SCHEDULED).
 */

import {
  IntegrationMode,
  FlowNodeType,
  FlowNode,
  FlowEdge,
  NodeConnectionRules,
  TriggerNodeData,
  InboundAuthNodeData,
  OutboundAuthNodeData,
  HttpNodeData,
  TransformNodeData,
  ResponseNodeData,
  IntegrationNodeData,
  ScheduleScriptNodeData,
} from './flowTypes';

// ============================================================================
// Node Type Allowlist by Integration Mode
// ============================================================================

/**
 * Defines which node types are allowed in each integration mode
 */
export const ALLOWED_NODE_TYPES: Record<IntegrationMode, FlowNodeType[]> = {
  INBOUND: [
    'trigger',       // INBOUND request trigger
    'inboundAuth',   // Validate incoming request
    'transform',     // Request/response transformation
    'http',          // Call external API
    'filter',        // Conditional logic
    'response',      // Return response to client
  ],

  OUTBOUND_EVENT: [
    'trigger',       // Event trigger
    'outboundAuth',  // Auth for integration delivery
    'transform',     // Transform event data
    'filter',        // Filter events
    'integration',       // Deliver integration
    'multiAction',   // Multiple integration deliveries
    'delay',         // Delay before delivery
  ],

  OUTBOUND_SCHEDULED: [
    'trigger',       // Schedule trigger
    'scheduleScript',// Scheduling script
    'outboundAuth',  // Auth for integration delivery
    'http',          // Fetch data from API
    'transform',     // Transform data
    'filter',        // Filter data
    'integration',       // Deliver integration
    'multiAction',   // Multiple integration deliveries
    'delay',         // Delay between actions
  ],
};

// ============================================================================
// Node Connection Rules
// ============================================================================

/**
 * Defines connection rules for each node type:
 * - allowedSources: Which node types can connect TO this node
 * - allowedTargets: Which node types this node can connect TO
 * - maxIncoming: Max incoming connections (-1 = unlimited)
 * - maxOutgoing: Max outgoing connections (-1 = unlimited)
 * - requiredInMode: Must be present in these modes
 * - forbiddenInMode: Cannot be present in these modes
 */
export const NODE_CONNECTION_RULES: NodeConnectionRules = {
  trigger: {
    allowedSources: [], // Trigger is always first
    allowedTargets: ['inboundAuth', 'outboundAuth', 'transform', 'http', 'filter', 'integration', 'scheduleScript'],
    maxIncoming: 0, // No incoming connections
    maxOutgoing: 1, // Single output
    requiredInMode: ['INBOUND', 'OUTBOUND_EVENT', 'OUTBOUND_SCHEDULED'],
    forbiddenInMode: [],
  },

  inboundAuth: {
    allowedSources: ['trigger'],
    allowedTargets: ['transform', 'http', 'filter'],
    maxIncoming: 1,
    maxOutgoing: 1,
    requiredInMode: [],
    forbiddenInMode: ['OUTBOUND_EVENT', 'OUTBOUND_SCHEDULED'],
  },

  outboundAuth: {
    allowedSources: ['trigger', 'transform', 'filter', 'http'],
    allowedTargets: ['http', 'integration', 'multiAction'],
    maxIncoming: -1,
    maxOutgoing: -1,
    requiredInMode: [],
    forbiddenInMode: ['INBOUND'],
  },

  http: {
    allowedSources: ['trigger', 'inboundAuth', 'transform', 'filter', 'outboundAuth', 'delay'],
    allowedTargets: ['transform', 'filter', 'response', 'integration', 'http'],
    maxIncoming: -1,
    maxOutgoing: -1,
    requiredInMode: [],
    forbiddenInMode: [],
  },

  transform: {
    allowedSources: ['trigger', 'inboundAuth', 'outboundAuth', 'http', 'filter', 'integration', 'delay'],
    allowedTargets: ['http', 'filter', 'response', 'integration', 'transform', 'outboundAuth'],
    maxIncoming: -1,
    maxOutgoing: -1,
    requiredInMode: [],
    forbiddenInMode: [],
  },

  filter: {
    allowedSources: ['trigger', 'inboundAuth', 'outboundAuth', 'http', 'transform', 'delay'],
    allowedTargets: ['http', 'transform', 'response', 'integration', 'multiAction', 'filter'],
    maxIncoming: -1,
    maxOutgoing: 2, // Two outputs: pass and fail
    requiredInMode: [],
    forbiddenInMode: [],
  },

  scheduleScript: {
    allowedSources: ['trigger'],
    allowedTargets: ['http', 'transform', 'filter', 'outboundAuth', 'integration', 'multiAction'],
    maxIncoming: 1,
    maxOutgoing: 1,
    requiredInMode: ['OUTBOUND_SCHEDULED'],
    forbiddenInMode: ['INBOUND', 'OUTBOUND_EVENT'],
  },

  delay: {
    allowedSources: ['trigger', 'filter', 'transform', 'http'],
    allowedTargets: ['http', 'integration', 'multiAction', 'transform'],
    maxIncoming: -1,
    maxOutgoing: 1,
    requiredInMode: [],
    forbiddenInMode: ['INBOUND'], // No delays in real-time proxy
  },

  multiAction: {
    allowedSources: ['trigger', 'outboundAuth', 'transform', 'filter', 'delay'],
    allowedTargets: ['transform', 'filter'], // After multi-action, can transform results
    maxIncoming: -1,
    maxOutgoing: 1,
    requiredInMode: [],
    forbiddenInMode: ['INBOUND'],
  },

  response: {
    allowedSources: ['inboundAuth', 'http', 'transform', 'filter'],
    allowedTargets: [], // Response is always last
    maxIncoming: -1,
    maxOutgoing: 0, // No outgoing connections
    requiredInMode: ['INBOUND'],
    forbiddenInMode: ['OUTBOUND_EVENT', 'OUTBOUND_SCHEDULED'],
  },

  integration: {
    allowedSources: ['trigger', 'outboundAuth', 'transform', 'filter', 'http', 'delay'],
    allowedTargets: ['transform'], // Can transform integration response
    maxIncoming: -1,
    maxOutgoing: 1,
    requiredInMode: [],
    forbiddenInMode: ['INBOUND'], // INBOUND uses 'response' node instead
  },
};

// ============================================================================
// Default Flow Templates
// ============================================================================

/**
 * Creates a default INBOUND flow graph
 * Flow: Trigger → InboundAuth → HTTP Call → Transform → Response
 */
export function createDefaultInboundFlow(orgId: number): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const nodes: FlowNode[] = [
    {
      id: 'trigger-1',
      type: 'trigger',
      position: { x: 100, y: 200 },
      data: {
        nodeType: 'trigger',
        label: 'Inbound Request',
        description: 'Receives incoming API requests',
        isValid: false,
        triggerType: 'INBOUND',
        errors: ['Integration identifier not configured'],
      } as TriggerNodeData,
    },
    {
      id: 'inbound-auth-1',
      type: 'inboundAuth',
      position: { x: 350, y: 200 },
      data: {
        nodeType: 'inboundAuth',
        label: 'Validate Request',
        description: 'Authenticate incoming request',
        isValid: false,
        authType: 'API_KEY',
        apiKeyHeader: 'X-API-Key',
        errors: ['Expected API key not configured'],
      } as InboundAuthNodeData,
    },
    {
      id: 'http-1',
      type: 'http',
      position: { x: 600, y: 200 },
      data: {
        nodeType: 'http',
        label: 'Call External API',
        description: 'Forward request to external system',
        isValid: false,
        url: '',
        method: 'POST',
        timeout: 10000,
        retryEnabled: true,
        retryCount: 3,
        errors: ['Target URL not configured'],
      } as HttpNodeData,
    },
    {
      id: 'transform-1',
      type: 'transform',
      position: { x: 850, y: 200 },
      data: {
        nodeType: 'transform',
        label: 'Transform Response',
        description: 'Transform API response before returning',
        isValid: true,
        transformMode: 'NONE',
        transformDirection: 'response',
      } as TransformNodeData,
    },
    {
      id: 'response-1',
      type: 'response',
      position: { x: 1100, y: 200 },
      data: {
        nodeType: 'response',
        label: 'Return Response',
        description: 'Send response back to client',
        isValid: true,
        statusCode: 200,
        bodyType: 'json',
      } as ResponseNodeData,
    },
  ];

  const edges: FlowEdge[] = [
    {
      id: 'e-trigger-auth',
      source: 'trigger-1',
      target: 'inbound-auth-1',
      animated: true,
    },
    {
      id: 'e-auth-http',
      source: 'inbound-auth-1',
      target: 'http-1',
    },
    {
      id: 'e-http-transform',
      source: 'http-1',
      target: 'transform-1',
    },
    {
      id: 'e-transform-response',
      source: 'transform-1',
      target: 'response-1',
    },
  ];

  return { nodes, edges };
}

/**
 * Creates a default OUTBOUND_EVENT flow graph
 * Flow: Trigger (Event) → Filter → Transform → OutboundAuth → Integration
 */
export function createDefaultOutboundEventFlow(orgId: number): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const nodes: FlowNode[] = [
    {
      id: 'trigger-1',
      type: 'trigger',
      position: { x: 100, y: 200 },
      data: {
        nodeType: 'trigger',
        label: 'Event Trigger',
        description: 'Listens for system events',
        isValid: false,
        triggerType: 'OUTBOUND_EVENT',
        errors: ['Event type not configured'],
      } as TriggerNodeData,
    },
    {
      id: 'filter-1',
      type: 'filter',
      position: { x: 350, y: 200 },
      data: {
        nodeType: 'filter',
        label: 'Filter Events',
        description: 'Only process matching events',
        isValid: true,
        conditions: [],
        matchMode: 'all',
      },
    },
    {
      id: 'transform-1',
      type: 'transform',
      position: { x: 600, y: 200 },
      data: {
        nodeType: 'transform',
        label: 'Transform Payload',
        description: 'Transform event data for integration',
        isValid: true,
        transformMode: 'NONE',
        transformDirection: 'request',
      } as TransformNodeData,
    },
    {
      id: 'outbound-auth-1',
      type: 'outboundAuth',
      position: { x: 850, y: 200 },
      data: {
        nodeType: 'outboundAuth',
        label: 'Add Authentication',
        description: 'Add auth headers to integration',
        isValid: true,
        authType: 'NONE',
      } as OutboundAuthNodeData,
    },
    {
      id: 'integration-1',
      type: 'integration',
      position: { x: 1100, y: 200 },
      data: {
        nodeType: 'integration',
        label: 'Deliver Integration',
        description: 'Send integration to external system',
        isValid: false,
        url: '',
        method: 'POST',
        timeout: 10000,
        retryEnabled: true,
        retryCount: 3,
        enableDLQ: true,
        errors: ['Integration URL not configured'],
      } as IntegrationNodeData,
    },
  ];

  const edges: FlowEdge[] = [
    {
      id: 'e-trigger-filter',
      source: 'trigger-1',
      target: 'filter-1',
      animated: true,
    },
    {
      id: 'e-filter-transform',
      source: 'filter-1',
      target: 'transform-1',
      label: 'pass',
    },
    {
      id: 'e-transform-auth',
      source: 'transform-1',
      target: 'outbound-auth-1',
    },
    {
      id: 'e-auth-integration',
      source: 'outbound-auth-1',
      target: 'integration-1',
    },
  ];

  return { nodes, edges };
}

/**
 * Creates a default OUTBOUND_SCHEDULED flow graph
 * Flow: Trigger (Schedule) → HTTP (Fetch) → Transform → Integration (Deliver)
 */
export function createDefaultOutboundScheduledFlow(orgId: number): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const nodes: FlowNode[] = [
    {
      id: 'trigger-1',
      type: 'trigger',
      position: { x: 100, y: 200 },
      data: {
        nodeType: 'trigger',
        label: 'Schedule Trigger',
        description: 'Runs on a schedule',
        isValid: false,
        triggerType: 'OUTBOUND_SCHEDULED',
        eventName: 'SCHEDULED_EVENT',
        scheduleType: 'RECURRING',
        errors: ['Schedule not configured'],
      } as TriggerNodeData,
    },
    {
      id: 'schedule-script-1',
      type: 'scheduleScript',
      position: { x: 350, y: 200 },
      data: {
        nodeType: 'scheduleScript',
        label: 'Schedule Script',
        description: 'Compute next execution time',
        isValid: false,
        script: '',
        errors: ['Schedule script is required'],
      } as ScheduleScriptNodeData,
    },
    {
      id: 'http-1',
      type: 'http',
      position: { x: 600, y: 200 },
      data: {
        nodeType: 'http',
        label: 'Fetch Data',
        description: 'Fetch data from source API',
        isValid: false,
        url: '',
        method: 'GET',
        timeout: 10000,
        retryEnabled: true,
        retryCount: 3,
        errors: ['Source URL not configured'],
      } as HttpNodeData,
    },
    {
      id: 'transform-1',
      type: 'transform',
      position: { x: 850, y: 200 },
      data: {
        nodeType: 'transform',
        label: 'Transform Data',
        description: 'Transform data for delivery',
        isValid: true,
        transformMode: 'NONE',
        transformDirection: 'request',
      } as TransformNodeData,
    },
    {
      id: 'integration-1',
      type: 'integration',
      position: { x: 1100, y: 200 },
      data: {
        nodeType: 'integration',
        label: 'Deliver Integration',
        description: 'Send data to destination',
        isValid: false,
        url: '',
        method: 'POST',
        timeout: 10000,
        retryEnabled: true,
        retryCount: 3,
        enableDLQ: true,
        errors: ['Integration URL not configured'],
      } as IntegrationNodeData,
    },
  ];

  const edges: FlowEdge[] = [
    {
      id: 'e-trigger-schedule',
      source: 'trigger-1',
      target: 'schedule-script-1',
      animated: true,
    },
    {
      id: 'e-schedule-http',
      source: 'schedule-script-1',
      target: 'http-1',
    },
    {
      id: 'e-http-transform',
      source: 'http-1',
      target: 'transform-1',
    },
    {
      id: 'e-transform-integration',
      source: 'transform-1',
      target: 'integration-1',
    },
  ];

  return { nodes, edges };
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if a node type is allowed in a specific integration mode
 */
export function isNodeTypeAllowed(nodeType: FlowNodeType, mode: IntegrationMode): boolean {
  return ALLOWED_NODE_TYPES[mode].includes(nodeType);
}

/**
 * Check if a connection is allowed between two node types
 */
export function isConnectionAllowed(
  sourceType: FlowNodeType,
  targetType: FlowNodeType,
  mode: IntegrationMode
): boolean {
  const rules = NODE_CONNECTION_RULES[targetType];
  if (!rules) return false;

  // Check if source is allowed
  if (!rules.allowedSources.includes(sourceType) && rules.allowedSources.length > 0) {
    return false;
  }

  // Check if target node is forbidden in this mode
  if (rules.forbiddenInMode.includes(mode)) {
    return false;
  }

  // Check if both nodes are allowed in this mode
  if (!isNodeTypeAllowed(sourceType, mode) || !isNodeTypeAllowed(targetType, mode)) {
    return false;
  }

  return true;
}

/**
 * Get the maximum number of incoming connections for a node type
 */
export function getMaxIncomingConnections(nodeType: FlowNodeType): number {
  return NODE_CONNECTION_RULES[nodeType]?.maxIncoming ?? -1;
}

/**
 * Get the maximum number of outgoing connections for a node type
 */
export function getMaxOutgoingConnections(nodeType: FlowNodeType): number {
  return NODE_CONNECTION_RULES[nodeType]?.maxOutgoing ?? -1;
}

/**
 * Get all allowed target node types for a given source node type
 */
export function getAllowedTargets(nodeType: FlowNodeType, mode: IntegrationMode): FlowNodeType[] {
  const rules = NODE_CONNECTION_RULES[nodeType];
  if (!rules) return [];

  return rules.allowedTargets.filter((targetType) => isNodeTypeAllowed(targetType, mode));
}

/**
 * Get all allowed source node types for a given target node type
 */
export function getAllowedSources(nodeType: FlowNodeType, mode: IntegrationMode): FlowNodeType[] {
  const rules = NODE_CONNECTION_RULES[nodeType];
  if (!rules) return [];

  if (rules.allowedSources.length === 0) return []; // Trigger has no sources

  return rules.allowedSources.filter((sourceType) => isNodeTypeAllowed(sourceType, mode));
}

/**
 * Create a default flow for a given integration mode
 */
export function createDefaultFlow(
  mode: IntegrationMode,
  orgId: number,
  name: string = 'Untitled Integration'
): { nodes: FlowNode[]; edges: FlowEdge[] } {
  switch (mode) {
    case 'INBOUND':
      return createDefaultInboundFlow(orgId);
    case 'OUTBOUND_EVENT':
      return createDefaultOutboundEventFlow(orgId);
    case 'OUTBOUND_SCHEDULED':
      return createDefaultOutboundScheduledFlow(orgId);
    default:
      throw new Error(`Unknown integration mode: ${mode}`);
  }
}

/**
 * Validate that a flow graph is structurally sound for its mode
 */
export function validateFlowStructure(
  nodes: FlowNode[],
  edges: FlowEdge[],
  mode: IntegrationMode
): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Must have exactly one trigger node
  const triggers = nodes.filter((n) => n.type === 'trigger');
  if (triggers.length === 0) {
    errors.push('Flow must have a trigger node');
  } else if (triggers.length > 1) {
    errors.push('Flow can only have one trigger node');
  }

  // INBOUND must have at least one response node
  if (mode === 'INBOUND') {
    const responses = nodes.filter((n) => n.type === 'response');
    if (responses.length === 0) {
      errors.push('INBOUND flow must have at least one response node');
    }
  }

  // OUTBOUND_EVENT and OUTBOUND_SCHEDULED must have at least one integration node
  if (mode === 'OUTBOUND_EVENT' || mode === 'OUTBOUND_SCHEDULED') {
    const integrations = nodes.filter((n) => n.type === 'integration' || n.type === 'multiAction');
    if (integrations.length === 0) {
      errors.push(`${mode} flow must have at least one integration or multi-action node`);
    }
  }

  // Validate node types are allowed in this mode
  for (const node of nodes) {
    if (!isNodeTypeAllowed(node.type as FlowNodeType, mode)) {
      errors.push(`Node type '${node.type}' is not allowed in ${mode} mode`);
    }
  }

  // Validate connections
  for (const edge of edges) {
    const sourceNode = nodes.find((n) => n.id === edge.source);
    const targetNode = nodes.find((n) => n.id === edge.target);

    if (!sourceNode || !targetNode) {
      errors.push(`Invalid edge: ${edge.id} connects non-existent nodes`);
      continue;
    }

    if (!isConnectionAllowed(sourceNode.type as FlowNodeType, targetNode.type as FlowNodeType, mode)) {
      errors.push(
        `Invalid connection: ${sourceNode.type} cannot connect to ${targetNode.type} in ${mode} mode`
      );
    }
  }

  // Check for disconnected nodes (except trigger)
  for (const node of nodes) {
    if (node.type === 'trigger') continue;

    const hasIncoming = edges.some((e) => e.target === node.id);
    if (!hasIncoming) {
      errors.push(`Node '${node.data.label || node.id}' is not connected to the flow`);
    }
  }

  // Check for unreachable terminal nodes
  const terminalNodeTypes = mode === 'INBOUND' ? ['response'] : ['integration', 'multiAction'];
  for (const node of nodes) {
    if (!node.type || !terminalNodeTypes.includes(node.type)) continue;

    const hasOutgoing = edges.some((e) => e.source === node.id);
    if (hasOutgoing && node.type !== 'integration') {
      errors.push(`Terminal node '${node.data.label || node.id}' cannot have outgoing connections`);
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}
