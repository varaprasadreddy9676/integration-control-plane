import type { Node, Edge } from 'reactflow';

/**
 * Integration modes supported by the Flow Builder
 */
export type IntegrationMode = 'INBOUND' | 'OUTBOUND_EVENT' | 'OUTBOUND_SCHEDULED';

export type IntegrationDirection = 'INBOUND' | 'OUTBOUND';

/**
 * Node types available in the Flow Builder
 */
export type FlowNodeType =
  | 'trigger'           // Entry point node
  | 'inboundAuth'       // Inbound authentication (validates incoming requests)
  | 'outboundAuth'      // Outbound authentication (for external API calls)
  | 'http'              // HTTP request node
  | 'transform'         // Data transformation node
  | 'filter'            // Conditional filtering node
  | 'scheduleScript'    // Schedule script node (OUTBOUND_SCHEDULED)
  | 'delay'             // Delay node (for SCHEDULED)
  | 'multiAction'       // Multiple parallel actions
  | 'response'          // Response node (for INBOUND)
  | 'integration';          // Integration delivery node (for OUTBOUND)

/**
 * Authentication types (matches backend schema)
 */
export type AuthType = 'NONE' | 'API_KEY' | 'BEARER' | 'BASIC' | 'OAUTH2';

/**
 * Transform modes (matches backend schema)
 */
export type TransformMode = 'NONE' | 'SIMPLE' | 'SCRIPT';

/**
 * HTTP methods
 */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * Base node data shared by all node types
 */
export interface BaseNodeData {
  label: string;
  description?: string;
  isValid: boolean;
  errors?: string[];
}

/**
 * Trigger node - Entry point for the flow
 */
export interface TriggerNodeData extends BaseNodeData {
  nodeType: 'trigger';
  triggerType: IntegrationMode;

  // For INBOUND: integration identifier used in API path
  inboundType?: string; // e.g., 'clevertap', 'salesforce', 'zoho-crm'

  // For OUTBOUND_EVENT: event listener
  eventName?: string;
  eventFilter?: {
    enabled: boolean;
    conditions?: Array<{
      field: string;
      operator: 'equals' | 'contains' | 'gt' | 'lt' | 'gte' | 'lte' | 'exists' | 'notExists';
      value: any;
    }>;
    matchMode?: 'all' | 'any'; // AND vs OR
  };

  // For OUTBOUND_SCHEDULED: cron schedule
  scheduleType?: 'CRON' | 'DELAYED' | 'RECURRING';
  cronExpression?: string;
  cronTimezone?: string;
  delaySeconds?: number;
  recurringInterval?: number;
  recurringUnit?: 'SECONDS' | 'MINUTES' | 'HOURS' | 'DAYS';
}

/**
 * Inbound Auth node - Validates incoming API requests
 */
export interface InboundAuthNodeData extends BaseNodeData {
  nodeType: 'inboundAuth';
  authType: AuthType;

  // API Key configuration
  apiKeyHeader?: string; // Default: 'X-API-Key'
  expectedApiKey?: string; // For validation

  // Bearer token
  expectedBearerToken?: string;

  // Basic auth
  expectedUsername?: string;
  expectedPassword?: string;

  // OAuth2 validation
  oauth2Config?: {
    validateTokenUrl?: string;
    requiredScopes?: string[];
  };
}

/**
 * Outbound Auth node - Adds authentication to outgoing API requests
 */
export interface OutboundAuthNodeData extends BaseNodeData {
  nodeType: 'outboundAuth';
  authType: AuthType;

  // API Key configuration
  apiKey?: string;
  apiKeyHeader?: string; // Default: 'X-API-Key'
  apiKeyLocation?: 'header' | 'query';

  // Bearer token
  bearerToken?: string;

  // Basic auth
  basicUsername?: string;
  basicPassword?: string;

  // OAuth2
  oauth2Config?: {
    tokenUrl: string;
    clientId: string;
    clientSecret: string;
    scope?: string;
    cachedToken?: string;
    tokenExpiry?: number;
  };
}

/**
 * HTTP request node - Make external API calls
 */
export interface HttpNodeData extends BaseNodeData {
  nodeType: 'http';
  url: string;
  method: HttpMethod;
  headers?: Record<string, string>;

  // Body configuration
  bodyType?: 'none' | 'json' | 'form' | 'raw';
  bodyTemplate?: string; // Template string with {{variable}} placeholders
  bodyJson?: Record<string, any>; // JSON object for json type

  // Request settings
  timeout?: number; // Default: 10000ms
  followRedirects?: boolean; // Default: true

  // Retry configuration
  retryEnabled?: boolean; // Default: true
  retryCount?: number; // Default: 3
  retryDelay?: number; // Default: 1000ms
  retryStrategy?: 'EXPONENTIAL' | 'LINEAR' | 'FIXED';
  retryOn?: ('timeout' | 'network_error' | '5xx' | '4xx')[]; // Default: timeout, network_error, 5xx

  // Response handling
  expectedStatusCodes?: number[]; // Default: [200-299]
  saveResponseTo?: string; // Variable name to store response
}

/**
 * Transform node - Data transformation (Request or Response)
 */
export interface TransformNodeData extends BaseNodeData {
  nodeType: 'transform';
  transformMode: TransformMode;
  transformDirection: 'request' | 'response'; // Which payload to transform

  // SIMPLE mode - Visual field mapping
  simpleMapping?: {
    fieldMappings: Array<{
      id: string; // Unique ID for this mapping
      sourcePath: string; // JSONPath to source field
      targetPath: string; // JSONPath to target field
      defaultValue?: any; // Default if source is missing
      transform?: 'none' | 'uppercase' | 'lowercase' | 'trim' | 'date_format';
    }>;
    staticFields?: Record<string, any>; // Hard-coded fields to add
    removeUnmapped?: boolean; // If true, only include mapped fields
  };

  // SCRIPT mode - JavaScript transformation
  scriptCode?: string; // JavaScript code: function transform(input) { return output; }
  scriptTimeout?: number; // Max execution time in ms

  // Legacy support for backward compatibility
  expression?: string;
  inputPath?: string;
  outputPath?: string;
}

/**
 * Schedule Script node - Script used for DELAYED/RECURRING scheduling
 */
export interface ScheduleScriptNodeData extends BaseNodeData {
  nodeType: 'scheduleScript';
  script: string;
}

/**
 * Filter node - Conditional branching
 */
export interface FilterNodeData extends BaseNodeData {
  nodeType: 'filter';
  conditions: Array<{
    id: string;
    field: string; // JSONPath to field
    operator: 'equals' | 'contains' | 'gt' | 'lt' | 'gte' | 'lte' | 'exists' | 'notExists' | 'matches';
    value?: any;
    caseSensitive?: boolean;
  }>;
  matchMode: 'all' | 'any'; // AND vs OR

  // Advanced mode: custom expression
  useCustomExpression?: boolean;
  customExpression?: string;
  expressionType?: 'JAVASCRIPT';
}

/**
 * Multi-Action node - Execute multiple HTTP calls in parallel
 */
export interface MultiActionNodeData extends BaseNodeData {
  nodeType: 'multiAction';
  executeInParallel: boolean; // True = parallel, false = sequential
  continueOnError: boolean; // If one fails, continue with others?

  actions: Array<{
    id: string;
    name: string;
    enabled: boolean;
    url: string;
    method: HttpMethod;
    headers?: Record<string, string>;
    bodyTemplate?: string;
    timeout?: number;
  }>;

  // Aggregation strategy for results
  resultAggregation: 'all' | 'first_success' | 'all_success';
}

/**
 * Delay node - Time delay
 */
export interface DelayNodeData extends BaseNodeData {
  nodeType: 'delay';
  delayMs: number;
  delayType: 'FIXED' | 'DYNAMIC'; // Dynamic uses expression
  delayExpression?: string;
}

/**
 * Response node - Return response (INBOUND only)
 */
export interface ResponseNodeData extends BaseNodeData {
  nodeType: 'response';
  statusCode: number; // HTTP status code
  headers?: Record<string, string>;

  // Body configuration
  bodyType: 'json' | 'text' | 'html' | 'xml' | 'template';
  bodyTemplate?: string; // Template with {{variable}} placeholders
  bodyJson?: Record<string, any>; // Direct JSON object
  bodyText?: string; // Plain text

  // Transform the response body before sending
  useTransform?: boolean;
  transformSource?: string; // JSONPath to data source
}

/**
 * Integration node - Deliver integration (OUTBOUND only)
 */
export interface IntegrationNodeData extends BaseNodeData {
  nodeType: 'integration';
  __KEEP_integrationName__?: string; // Optional name for this integration
  url: string;
  method: HttpMethod;
  headers?: Record<string, string>;

  // Body configuration
  bodyType?: 'json' | 'form' | 'raw';
  bodyTemplate?: string;
  bodyJson?: Record<string, any>;

  // Delivery settings
  timeout?: number; // Default: 10000ms
  retryEnabled?: boolean; // Default: true
  retryCount?: number; // Default: 3
  retryDelay?: number; // Default: 1000ms
  retryStrategy?: 'EXPONENTIAL' | 'LINEAR' | 'FIXED';

  // DLQ configuration
  enableDLQ?: boolean; // Default: true
  dlqMaxRetries?: number; // Default: 5
  dlqRetryStrategy?: 'EXPONENTIAL_BACKOFF' | 'FIXED_DELAY';

  // Validation
  expectedStatusCodes?: number[]; // Default: [200-299]
}

/**
 * Union type for all node data types
 */
export type FlowNodeData =
  | TriggerNodeData
  | InboundAuthNodeData
  | OutboundAuthNodeData
  | HttpNodeData
  | TransformNodeData
  | FilterNodeData
  | ScheduleScriptNodeData
  | DelayNodeData
  | MultiActionNodeData
  | ResponseNodeData
  | IntegrationNodeData;

/**
 * Custom edge data
 */
export interface FlowEdgeData {
  label?: string;
  condition?: string; // For conditional branches
  isErrorPath?: boolean; // For error handling paths
}

/**
 * Flow node (ReactFlow Node with our custom data)
 */
export type FlowNode = Node<FlowNodeData>;

/**
 * Flow edge (ReactFlow Edge with our custom data)
 */
export type FlowEdge = Edge<FlowEdgeData>;

/**
 * Rate limit configuration
 */
export interface RateLimitConfig {
  enabled: boolean;
  maxRequests: number;
  windowSeconds: number;
}

/**
 * Complete flow state
 */
export interface FlowState {
  id?: string; // Integration ID (if editing existing)
  name: string;
  description?: string;
  mode: IntegrationMode;
  orgId: number;
  nodes: FlowNode[];
  edges: FlowEdge[];
  rateLimits: RateLimitConfig;
  isActive: boolean;
  isValid: boolean;
  errors: string[];
  warnings: string[];
  isDirty: boolean;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Flow validation result
 */
export interface FlowValidationResult {
  isValid: boolean;
  errors: FlowValidationError[];
  warnings: FlowValidationWarning[];
}

export interface FlowValidationError {
  nodeId?: string;
  message: string;
  field?: string;
}

export interface FlowValidationWarning {
  nodeId?: string;
  message: string;
  field?: string;
}

export interface NodeValidationResult {
  nodeId: string;
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Node palette item
 */
export interface NodePaletteItem {
  type: FlowNodeType;
  label: string;
  description: string;
  icon: string; // Ant Design icon name
  category: 'trigger' | 'action' | 'logic' | 'output';
  allowedModes: IntegrationMode[];
}

/**
 * Flow execution result (for testing)
 */
export interface FlowExecutionResult {
  success: boolean;
  executionTime: number;
  steps: FlowExecutionStep[];
  output?: any;
  error?: {
    message: string;
    nodeId?: string;
    stack?: string;
  };
}

export interface FlowExecutionStep {
  nodeId: string;
  nodeType: FlowNodeType;
  status: 'success' | 'failed' | 'skipped';
  durationMs: number;
  input?: any;
  output?: any;
  error?: string;
}

/**
 * Backend Integration Payload (matches backend/src/routes/integrations.js schema)
 */
export interface BackendIntegrationPayload {
  // Basic info (matches backend integration_configs schema)
  name: string;
  type?: string; // For INBOUND integrations and OUTBOUND event type
  eventType?: string; // Backward compatibility for outbound
  direction: 'INBOUND' | 'OUTBOUND';
  tenantId: number;
  targetUrl?: string;
  httpMethod?: HttpMethod;
  headers?: Record<string, string>;
  contentType?: string;
  scope?: 'INCLUDE_CHILDREN' | 'ENTITY_ONLY';
  excludedEntityRids?: number[];
  isActive: boolean;

  // Authentication (inbound and outbound)
  inboundAuthType?: AuthType | 'CUSTOM_HEADERS';
  inboundAuthConfig?: {
    headerName?: string;
    value?: string;
    token?: string;
    username?: string;
    password?: string;
  } | null;
  outgoingAuthType?: AuthType | 'CUSTOM_HEADERS';
  outgoingAuthConfig?: {
    headerName?: string;
    value?: string;
    token?: string;
    username?: string;
    password?: string;
    apiKey?: string;
    apiKeyHeader?: string;
    bearerToken?: string;
    basicAuth?: {
      username: string;
      password: string;
    };
    oauth2?: {
      tokenUrl: string;
      clientId: string;
      clientSecret: string;
      scope?: string;
    };
  } | null;

  // Transformations
  requestTransformation?: {
    mode: TransformMode;
    script?: string;
    simpleMapping?: {
      fieldMappings?: Array<{
        source: string;
        target: string;
        defaultValue?: any;
      }>;
      staticFields?: Record<string, any>;
    };
  } | null;
  responseTransformation?: {
    mode: TransformMode;
    script?: string;
    simpleMapping?: {
      fieldMappings?: Array<{
        source: string;
        target: string;
        defaultValue?: any;
      }>;
      staticFields?: Record<string, any>;
    };
  } | null;

  // Outbound transform fields (legacy/outbound config)
  transformationMode?: TransformMode;
  transformation?: {
    mode?: TransformMode;
    script?: string;
    simpleMapping?: {
      fieldMappings?: Array<{
        source: string;
        target: string;
        defaultValue?: any;
      }>;
      staticFields?: Record<string, any>;
    };
  } | null;

  // Rate limiting
  rateLimits?: {
    enabled: boolean;
    maxRequests: number;
    windowSeconds: number;
  } | null;

  // HTTP settings
  timeoutMs?: number;
  retryCount?: number;
  retryDelay?: number;

  // Scheduling (for delayed/recurring outbound)
  deliveryMode?: 'IMMEDIATE' | 'DELAYED' | 'RECURRING';
  schedulingConfig?: {
    script?: string;
    timezone?: string;
    description?: string;
  } | null;

  // Multi-action delivery
  actions?: Array<{
    name: string;
    url: string;
    method: HttpMethod;
    headers?: Record<string, string>;
  }>;
}

/**
 * Flow validation context - provides context for validation rules
 */
export interface FlowValidationContext {
  mode: IntegrationMode;
  hasInboundAuth: boolean;
  hasOutboundAuth: boolean;
  hasRequestTransform: boolean;
  hasResponseTransform: boolean;
  httpCallCount: number;
  integrationCount: number;
  triggerCount: number;
  responseCount: number;
}

/**
 * Node connection rules - defines which nodes can connect to which
 */
export interface NodeConnectionRules {
  [key: string]: {
    allowedSources: FlowNodeType[];
    allowedTargets: FlowNodeType[];
    maxIncoming: number; // -1 = unlimited
    maxOutgoing: number; // -1 = unlimited
    requiredInMode: IntegrationMode[];
    forbiddenInMode: IntegrationMode[];
  };
}

/**
 * Flow Builder UI preferences
 */
export interface FlowBuilderPreferences {
  theme: 'light' | 'dark' | 'system';
  autoSave: boolean;
  autoSaveInterval: number; // seconds
  snapToGrid: boolean;
  gridSize: number;
  showMinimap: boolean;
  showControls: boolean;
  defaultZoom: number;
}

/**
 * Flow Builder error types
 */
export type FlowBuilderErrorType =
  | 'VALIDATION_ERROR'
  | 'SAVE_ERROR'
  | 'LOAD_ERROR'
  | 'TEST_ERROR'
  | 'DEPLOY_ERROR'
  | 'NETWORK_ERROR'
  | 'CONVERSION_ERROR';

export interface FlowBuilderError {
  type: FlowBuilderErrorType;
  message: string;
  details?: string;
  nodeId?: string;
  field?: string;
  timestamp: number;
}

/**
 * Flow test request/response
 */
export interface FlowTestRequest {
  flowState: FlowState;
  testPayload: any; // Input data for testing
  dryRun?: boolean; // If true, don't actually call external APIs
}

export interface FlowTestResponse {
  success: boolean;
  executionResult: FlowExecutionResult;
  logs: string[];
  warnings: string[];
}

/**
 * Node template for quick creation
 */
export interface NodeTemplate {
  id: string;
  name: string;
  description: string;
  nodeType: FlowNodeType;
  defaultData: Partial<FlowNodeData>;
  tags: string[];
}

/**
 * Flow template for quick start
 */
export interface FlowTemplate {
  id: string;
  name: string;
  description: string;
  mode: IntegrationMode;
  thumbnail?: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
  category: 'healthcare' | 'integration' | 'api_proxy' | 'scheduled' | 'custom';
  tags: string[];
}
