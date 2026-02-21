/**
 * Flow Validation Logic
 *
 * Provides comprehensive validation for flow graphs including:
 * - Node-level validation (required fields, data consistency)
 * - Flow-level validation (structure, connections, mode compliance)
 * - Readiness checks (can save, can test, can deploy)
 */

import {
  FlowState,
  FlowNode,
  FlowEdge,
  FlowValidationResult,
  FlowValidationError,
  FlowValidationWarning,
  NodeValidationResult,
  IntegrationMode,
  FlowNodeType,
  TriggerNodeData,
  InboundAuthNodeData,
  OutboundAuthNodeData,
  HttpNodeData,
  TransformNodeData,
  FilterNodeData,
  ScheduleScriptNodeData,
  DelayNodeData,
  MultiActionNodeData,
  ResponseNodeData,
  IntegrationNodeData,
  AuthType,
} from './flowTypes';
import { validateFlowStructure, isConnectionAllowed } from './flowSchema';

// ============================================================================
// Main Validation Function
// ============================================================================

/**
 * Validates an entire flow and returns detailed results
 */
export function validateFlow(flowState: FlowState): FlowValidationResult {
  const errors: FlowValidationError[] = [];
  const warnings: FlowValidationWarning[] = [];

  // 1. Validate basic flow properties
  if (!flowState.name || flowState.name.trim().length === 0) {
    errors.push({ message: 'Integration name is required' });
  }

  if (flowState.name && flowState.name.length > 100) {
    errors.push({ message: 'Integration name must be less than 100 characters' });
  }

  // 2. Validate flow structure
  const structureValidation = validateFlowStructure(flowState.nodes, flowState.edges, flowState.mode);
  if (!structureValidation.isValid) {
    errors.push(...structureValidation.errors.map((msg) => ({ message: msg })));
  }

  // 3. Validate individual nodes
  for (const node of flowState.nodes) {
    const nodeValidation = validateNode(node, flowState.mode);
    if (!nodeValidation.isValid) {
      errors.push(...nodeValidation.errors.map((msg: string) => ({ nodeId: node.id, message: msg })));
    }
    warnings.push(...nodeValidation.warnings.map((msg: string) => ({ nodeId: node.id, message: msg })));
  }

  // 4. Mode-specific validations
  const modeValidation = validateModeRequirements(flowState.nodes, flowState.edges, flowState.mode);
  errors.push(...modeValidation.errors);
  warnings.push(...modeValidation.warnings);

  // 5. Check for common issues
  const commonIssues = checkCommonIssues(flowState.nodes, flowState.edges, flowState.mode);
  errors.push(...commonIssues.errors);
  warnings.push(...commonIssues.warnings);

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

// ============================================================================
// Node-Level Validation
// ============================================================================

/**
 * Validates a single node based on its type
 */
export function validateNode(node: FlowNode, mode: IntegrationMode): NodeValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  switch (node.type as FlowNodeType) {
    case 'trigger':
      validateTriggerNode(node.data as TriggerNodeData, errors, warnings, mode);
      break;
    case 'inboundAuth':
      validateInboundAuthNode(node.data as InboundAuthNodeData, errors, warnings);
      break;
    case 'outboundAuth':
      validateOutboundAuthNode(node.data as OutboundAuthNodeData, errors, warnings);
      break;
    case 'http':
      validateHttpNode(node.data as HttpNodeData, errors, warnings);
      break;
    case 'transform':
      validateTransformNode(node.data as TransformNodeData, errors, warnings);
      break;
    case 'filter':
      validateFilterNode(node.data as FilterNodeData, errors, warnings);
      break;
    case 'scheduleScript':
      validateScheduleScriptNode(node.data as ScheduleScriptNodeData, errors, warnings);
      break;
    case 'delay':
      validateDelayNode(node.data as DelayNodeData, errors, warnings);
      break;
    case 'multiAction':
      validateMultiActionNode(node.data as MultiActionNodeData, errors, warnings);
      break;
    case 'response':
      validateResponseNode(node.data as ResponseNodeData, errors, warnings);
      break;
    case 'integration':
      validateIntegrationNode(node.data as IntegrationNodeData, errors, warnings);
      break;
    default:
      errors.push(`Unknown node type: ${node.type}`);
  }

  return {
    nodeId: node.id,
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

// ============================================================================
// Node Type Validators
// ============================================================================

function validateTriggerNode(
  data: TriggerNodeData,
  errors: string[],
  warnings: string[],
  mode: IntegrationMode
): void {
  if (data.triggerType !== mode) {
    errors.push(`Trigger type '${data.triggerType}' does not match integration mode '${mode}'`);
  }

  if (mode === 'INBOUND') {
    if (!data.inboundType || data.inboundType.trim().length === 0) {
      errors.push('Integration identifier is required (e.g., clevertap, salesforce)');
    } else if (!/^[a-z0-9-]+$/.test(data.inboundType)) {
      errors.push('Integration identifier must be lowercase alphanumeric with hyphens only');
    }
  }

  if (mode === 'OUTBOUND_EVENT') {
    if (!data.eventName || data.eventName.trim().length === 0) {
      errors.push('Event name is required for event-triggered integrations');
    }

    if (data.eventFilter?.enabled && (!data.eventFilter.conditions || data.eventFilter.conditions.length === 0)) {
      warnings.push('Event filter is enabled but no conditions are defined');
    }
  }

  if (mode === 'OUTBOUND_SCHEDULED') {
    if (!data.eventName || data.eventName.trim().length === 0) {
      errors.push('Event name is required for scheduled integrations');
    }
    if (!data.scheduleType) {
      errors.push('Schedule type is required (CRON, DELAYED, or RECURRING)');
    }

    if (data.scheduleType === 'CRON') {
      if (!data.cronExpression || data.cronExpression.trim().length === 0) {
        errors.push('Cron expression is required for CRON schedule type');
      } else {
        // Basic cron validation (5 or 6 fields)
        const parts = data.cronExpression.trim().split(/\s+/);
        if (parts.length < 5 || parts.length > 6) {
          errors.push('Invalid cron expression format (expected 5 or 6 fields)');
        }
      }
    }

    if (data.scheduleType === 'DELAYED') {
      if (!data.delaySeconds || data.delaySeconds <= 0) {
        errors.push('Delay in seconds is required and must be positive');
      }
    }

    if (data.scheduleType === 'RECURRING') {
      if (!data.recurringInterval || data.recurringInterval <= 0) {
        errors.push('Recurring interval is required and must be positive');
      }
      if (!data.recurringUnit) {
        errors.push('Recurring unit is required (SECONDS, MINUTES, HOURS, or DAYS)');
      }
    }
  }
}

function validateInboundAuthNode(data: InboundAuthNodeData, errors: string[], warnings: string[]): void {
  if (data.authType === 'NONE') {
    warnings.push('Inbound authentication is set to NONE - requests will not be validated');
  }

  if (data.authType === 'API_KEY') {
    if (!data.apiKeyHeader || data.apiKeyHeader.trim().length === 0) {
      errors.push('API key header name is required');
    }
    if (!data.expectedApiKey || data.expectedApiKey.trim().length === 0) {
      errors.push('Expected API key value is required for validation');
    }
  }

  if (data.authType === 'BEARER') {
    if (!data.expectedBearerToken || data.expectedBearerToken.trim().length === 0) {
      errors.push('Expected bearer token is required for validation');
    }
  }

  if (data.authType === 'BASIC') {
    if (!data.expectedUsername || data.expectedUsername.trim().length === 0) {
      errors.push('Expected username is required for basic auth');
    }
    if (!data.expectedPassword || data.expectedPassword.trim().length === 0) {
      errors.push('Expected password is required for basic auth');
    }
  }

  if (data.authType === 'OAUTH2') {
    if (!data.oauth2Config?.validateTokenUrl) {
      errors.push('OAuth2 token validation URL is required');
    }
  }
}

function validateOutboundAuthNode(data: OutboundAuthNodeData, errors: string[], warnings: string[]): void {
  if (data.authType === 'NONE') {
    warnings.push('Outbound authentication is set to NONE - no auth headers will be added');
  }

  if (data.authType === 'API_KEY') {
    if (!data.apiKey || data.apiKey.trim().length === 0) {
      errors.push('API key is required');
    }
    if (!data.apiKeyHeader || data.apiKeyHeader.trim().length === 0) {
      errors.push('API key header name is required');
    }
  }

  if (data.authType === 'BEARER') {
    if (!data.bearerToken || data.bearerToken.trim().length === 0) {
      errors.push('Bearer token is required');
    }
  }

  if (data.authType === 'BASIC') {
    if (!data.basicUsername || data.basicUsername.trim().length === 0) {
      errors.push('Username is required for basic auth');
    }
    if (!data.basicPassword || data.basicPassword.trim().length === 0) {
      errors.push('Password is required for basic auth');
    }
  }

  if (data.authType === 'OAUTH2') {
    if (!data.oauth2Config?.tokenUrl) {
      errors.push('OAuth2 token URL is required');
    }
    if (!data.oauth2Config?.clientId) {
      errors.push('OAuth2 client ID is required');
    }
    if (!data.oauth2Config?.clientSecret) {
      errors.push('OAuth2 client secret is required');
    }
  }
}

function validateHttpNode(data: HttpNodeData, errors: string[], warnings: string[]): void {
  if (!data.url || data.url.trim().length === 0) {
    errors.push('HTTP URL is required');
  } else {
    // Validate URL format
    try {
      new URL(data.url);
    } catch {
      errors.push('Invalid URL format');
    }
  }

  if (!data.method) {
    errors.push('HTTP method is required');
  }

  if (data.timeout && data.timeout < 1000) {
    warnings.push('HTTP timeout is less than 1 second - requests may fail prematurely');
  }

  if (data.timeout && data.timeout > 60000) {
    warnings.push('HTTP timeout is greater than 60 seconds - clients may timeout waiting for response');
  }

  if (data.retryEnabled && data.retryCount && data.retryCount > 5) {
    warnings.push('Retry count is greater than 5 - this may cause long delays');
  }

  if (data.bodyType === 'json' && data.bodyTemplate) {
    try {
      JSON.parse(data.bodyTemplate);
    } catch {
      // Template might have variables, so this is just a warning
      warnings.push('Body template may not be valid JSON (variables are allowed)');
    }
  }
}

function validateTransformNode(data: TransformNodeData, errors: string[], warnings: string[]): void {
  if (data.transformMode === 'SIMPLE') {
    if (!data.simpleMapping?.fieldMappings || data.simpleMapping.fieldMappings.length === 0) {
      warnings.push('No field mappings defined - transformation will have no effect');
    }

    // Validate field mappings
    data.simpleMapping?.fieldMappings?.forEach((mapping, index) => {
      if (!mapping.sourcePath || mapping.sourcePath.trim().length === 0) {
        errors.push(`Field mapping ${index + 1}: Source path is required`);
      }
      if (!mapping.targetPath || mapping.targetPath.trim().length === 0) {
        errors.push(`Field mapping ${index + 1}: Target path is required`);
      }
    });
  }

  if (data.transformMode === 'SCRIPT') {
    if (!data.scriptCode || data.scriptCode.trim().length === 0) {
      errors.push('Script code is required for SCRIPT transform mode');
    }

    // Basic JavaScript syntax check
    if (data.scriptCode) {
      try {
        new Function(data.scriptCode);
      } catch (e) {
        errors.push(`Script has syntax error: ${(e as Error).message}`);
      }
    }

    if (data.scriptTimeout && data.scriptTimeout > 5000) {
      warnings.push('Script timeout is greater than 5 seconds - this may cause performance issues');
    }
  }

  if (data.transformMode === 'NONE') {
    warnings.push('Transform mode is NONE - this node will have no effect');
  }
}

function validateFilterNode(data: FilterNodeData, errors: string[], warnings: string[]): void {
  if (!data.useCustomExpression && (!data.conditions || data.conditions.length === 0)) {
    errors.push('At least one filter condition is required');
  }

  if (data.useCustomExpression) {
    if (!data.customExpression || data.customExpression.trim().length === 0) {
      errors.push('Custom filter expression is required');
    }

    // Basic JavaScript syntax check
    if (data.customExpression) {
      try {
        new Function(`return ${data.customExpression}`);
      } catch (e) {
        errors.push(`Custom expression has syntax error: ${(e as Error).message}`);
      }
    }
  }

  // Validate individual conditions
  data.conditions?.forEach((condition, index) => {
    if (!condition.field || condition.field.trim().length === 0) {
      errors.push(`Condition ${index + 1}: Field path is required`);
    }

    const operatorsRequiringValue = ['equals', 'contains', 'gt', 'lt', 'gte', 'lte', 'matches'];
    if (operatorsRequiringValue.includes(condition.operator) && condition.value === undefined) {
      errors.push(`Condition ${index + 1}: Value is required for operator '${condition.operator}'`);
    }
  });
}

function validateScheduleScriptNode(data: ScheduleScriptNodeData, errors: string[], warnings: string[]): void {
  if (!data.script || data.script.trim().length === 0) {
    errors.push('Schedule script is required for scheduled integrations');
  }
}

function validateDelayNode(data: DelayNodeData, errors: string[], warnings: string[]): void {
  if (data.delayType === 'FIXED') {
    if (!data.delayMs || data.delayMs <= 0) {
      errors.push('Delay duration must be greater than 0');
    }

    if (data.delayMs && data.delayMs > 300000) {
      warnings.push('Delay is greater than 5 minutes - consider using scheduled integration instead');
    }
  }

  if (data.delayType === 'DYNAMIC') {
    if (!data.delayExpression || data.delayExpression.trim().length === 0) {
      errors.push('Delay expression is required for dynamic delays');
    }
  }
}

function validateMultiActionNode(data: MultiActionNodeData, errors: string[], warnings: string[]): void {
  if (!data.actions || data.actions.length === 0) {
    errors.push('At least one action is required');
  }

  if (data.actions && data.actions.length > 10) {
    warnings.push('More than 10 actions may cause performance issues');
  }

  data.actions?.forEach((action, index) => {
    if (!action.name || action.name.trim().length === 0) {
      errors.push(`Action ${index + 1}: Name is required`);
    }

    if (!action.url || action.url.trim().length === 0) {
      errors.push(`Action ${index + 1}: URL is required`);
    } else {
      try {
        new URL(action.url);
      } catch {
        errors.push(`Action ${index + 1}: Invalid URL format`);
      }
    }

    if (!action.method) {
      errors.push(`Action ${index + 1}: HTTP method is required`);
    }
  });

  if (data.executeInParallel) {
    warnings.push('Parallel execution may cause high load - ensure rate limits are configured');
  }
}

function validateResponseNode(data: ResponseNodeData, errors: string[], warnings: string[]): void {
  if (!data.statusCode) {
    errors.push('HTTP status code is required');
  } else if (data.statusCode < 100 || data.statusCode > 599) {
    errors.push('HTTP status code must be between 100 and 599');
  }

  if (data.bodyType === 'json') {
    if (data.bodyTemplate) {
      try {
        JSON.parse(data.bodyTemplate);
      } catch {
        warnings.push('Response body template may not be valid JSON (variables are allowed)');
      }
    }
  }

  if (data.statusCode >= 400 && !data.bodyTemplate && !data.bodyJson && !data.bodyText) {
    warnings.push('Error responses should include a body with error details');
  }
}

function validateIntegrationNode(data: IntegrationNodeData, errors: string[], warnings: string[]): void {
  if (!data.url || data.url.trim().length === 0) {
    errors.push('Integration URL is required');
  } else {
    try {
      new URL(data.url);
    } catch {
      errors.push('Invalid integration URL format');
    }
  }

  if (!data.method) {
    errors.push('HTTP method is required');
  }

  if (data.timeout && data.timeout < 1000) {
    warnings.push('Integration timeout is less than 1 second - deliveries may fail prematurely');
  }

  if (data.retryEnabled && data.retryCount && data.retryCount > 5) {
    warnings.push('Retry count is greater than 5 - failed deliveries may take a long time');
  }

  if (!data.enableDLQ) {
    warnings.push('DLQ (Dead Letter Queue) is disabled - failed integrations will not be retried');
  }
}

// ============================================================================
// Flow-Level Validation
// ============================================================================

function validateModeRequirements(
  nodes: FlowNode[],
  edges: FlowEdge[],
  mode: IntegrationMode
): { errors: FlowValidationError[]; warnings: FlowValidationWarning[] } {
  const errors: FlowValidationError[] = [];
  const warnings: FlowValidationWarning[] = [];

  if (mode === 'INBOUND') {
    // Must have at least one HTTP call or transform
    const hasHttp = nodes.some((n) => n.type === 'http');
    const hasTransform = nodes.some((n) => n.type === 'transform');

    if (!hasHttp && !hasTransform) {
      warnings.push({ message: 'INBOUND integration has no HTTP call or transform - it will just echo the request' });
    }

    // Should have inbound auth
    const hasInboundAuth = nodes.some((n) => n.type === 'inboundAuth');
    if (!hasInboundAuth) {
      warnings.push({ message: 'No inbound authentication configured - requests will not be validated' });
    }
  }

  if (mode === 'OUTBOUND_EVENT' || mode === 'OUTBOUND_SCHEDULED') {
    // Should have at least one integration or multi-action
    const hasIntegration = nodes.some((n) => n.type === 'integration');
    const hasMultiAction = nodes.some((n) => n.type === 'multiAction');

    if (!hasIntegration && !hasMultiAction) {
      errors.push({ message: `${mode} integration must have at least one integration or multi-action node` });
    }
  }

  if (mode === 'OUTBOUND_SCHEDULED') {
    const hasScheduleScript = nodes.some((n) => n.type === 'scheduleScript');
    if (!hasScheduleScript) {
      errors.push({ message: 'Scheduled integrations require a Schedule Script node' });
    }
  }

  return { errors, warnings };
}

function checkCommonIssues(
  nodes: FlowNode[],
  edges: FlowEdge[],
  mode: IntegrationMode
): { errors: FlowValidationError[]; warnings: FlowValidationWarning[] } {
  const errors: FlowValidationError[] = [];
  const warnings: FlowValidationWarning[] = [];

  // Check for cycles
  if (hasCycle(nodes, edges)) {
    errors.push({ message: 'Flow contains a cycle - nodes cannot connect back to themselves' });
  }

  // Check for multiple paths to response (INBOUND only)
  if (mode === 'INBOUND') {
    const responseNodes = nodes.filter((n) => n.type === 'response');
    if (responseNodes.length > 1) {
      warnings.push({ message: 'Multiple response nodes detected - only one will be used' });
    }
  }

  // Check for unreachable nodes
  const reachableNodes = getReachableNodes(nodes, edges);
  const unreachable = nodes.filter((n) => !reachableNodes.has(n.id) && n.type !== 'trigger');

  if (unreachable.length > 0) {
    unreachable.forEach((node) => {
      warnings.push({
        nodeId: node.id,
        message: `Node is not reachable from trigger`,
      });
    });
  }

  return { errors, warnings };
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if the flow graph contains a cycle
 */
function hasCycle(nodes: FlowNode[], edges: FlowEdge[]): boolean {
  const visited = new Set<string>();
  const recursionStack = new Set<string>();

  function dfs(nodeId: string): boolean {
    visited.add(nodeId);
    recursionStack.add(nodeId);

    const outgoingEdges = edges.filter((e) => e.source === nodeId);
    for (const edge of outgoingEdges) {
      if (!visited.has(edge.target)) {
        if (dfs(edge.target)) return true;
      } else if (recursionStack.has(edge.target)) {
        return true; // Cycle detected
      }
    }

    recursionStack.delete(nodeId);
    return false;
  }

  for (const node of nodes) {
    if (!visited.has(node.id)) {
      if (dfs(node.id)) return true;
    }
  }

  return false;
}

/**
 * Get all nodes reachable from trigger
 */
function getReachableNodes(nodes: FlowNode[], edges: FlowEdge[]): Set<string> {
  const reachable = new Set<string>();
  const trigger = nodes.find((n) => n.type === 'trigger');

  if (!trigger) return reachable;

  function dfs(nodeId: string): void {
    if (reachable.has(nodeId)) return;
    reachable.add(nodeId);

    const outgoingEdges = edges.filter((e) => e.source === nodeId);
    for (const edge of outgoingEdges) {
      dfs(edge.target);
    }
  }

  dfs(trigger.id);
  return reachable;
}

// ============================================================================
// Readiness Checks
// ============================================================================

/**
 * Check if flow can be saved (basic validation passed)
 */
export function canSaveFlow(flowState: FlowState): boolean {
  // Must have name
  if (!flowState.name || flowState.name.trim().length === 0) {
    return false;
  }

  // Must have trigger
  const hasTrigger = flowState.nodes.some((n) => n.type === 'trigger');
  if (!hasTrigger) {
    return false;
  }

  return true;
}

/**
 * Check if flow can be tested (all nodes are valid)
 */
export function canTestFlow(flowState: FlowState): boolean {
  if (!canSaveFlow(flowState)) return false;

  const validation = validateFlow(flowState);

  // Can test if there are no critical errors
  return validation.errors.length === 0;
}

/**
 * Check if flow can be deployed (all validations passed, no warnings for critical issues)
 */
export function canDeployFlow(flowState: FlowState): boolean {
  if (!canTestFlow(flowState)) return false;

  const validation = validateFlow(flowState);

  // No critical warnings
  const criticalWarnings = validation.warnings.filter((w) =>
    w.message.includes('not be validated') || w.message.includes('DLQ is disabled')
  );

  return criticalWarnings.length === 0;
}
