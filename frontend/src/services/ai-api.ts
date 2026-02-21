/**
 * AI Service API Client
 * Provides methods for interacting with AI-powered integration configuration features
 */

import axios from 'axios';
import { getAuthToken } from '../utils/auth-storage';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000';
const API_KEY = import.meta.env.VITE_API_KEY;

const sharedHeaders = {
  'Content-Type': 'application/json',
  'X-API-Key': API_KEY
};

const authInterceptor = (config: any) => {
  const token = getAuthToken();
  if (token) {
    config.headers = config.headers || {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
};

// Client for AI assistant operations: /api/v1/ai/*
const aiClient = axios.create({
  baseURL: `${API_BASE}/ai`,
  headers: sharedHeaders
});
aiClient.interceptors.request.use(authInterceptor);

// Separate client for AI config management: /api/v1/ai-config/*
const aiConfigClient = axios.create({
  baseURL: `${API_BASE}/ai-config`,
  headers: sharedHeaders
});
aiConfigClient.interceptors.request.use(authInterceptor);

export interface AITransformationRequest {
  inputExample: Record<string, any>;
  outputExample: Record<string, any>;
  eventType?: string;
}

export interface AITransformationResponse {
  script: string;
  rateLimit: {
    allowed: boolean;
    usage: number;
    limit: number;
    remaining: number;
  };
}

export interface AIDocumentationRequest {
  documentation: string;
  eventType?: string;
}

export interface AIDocumentationResponse {
  config: {
    targetUrl: string;
    httpMethod: string;
    authType: string;
    authConfig: Record<string, any>;
    transformationScript: string;
    actions?: Array<{
      name: string;
      targetUrl: string;
      transformationMode: string;
      transformation: {
        script: string;
      };
      condition?: string;
    }>;
    confidence: number;
    notes: string;
  };
  rateLimit: {
    allowed: boolean;
    usage: number;
    limit: number;
    remaining: number;
  };
}

export interface AIFieldMappingRequest {
  sourceFields: Record<string, any> | Array<{ path: string; type: string; description?: string }>;
  targetFields: Record<string, any> | string[];
  apiContext?: string;
}

export interface AIFieldMapping {
  targetField: string;
  sourceField: string;
  transformation: string | null;
  confidence: number;
  fallback: string;
}

export interface AIFieldMappingResponse {
  mappings: AIFieldMapping[];
  rateLimit: {
    allowed: boolean;
    usage: number;
    limit: number;
    remaining: number;
  };
}

export interface AIStatusResponse {
  available: boolean;
  provider: string;
  enabled: boolean;
}

export interface AIUsageResponse {
  totalUsage: number;
  byOperation: Record<string, number>;
  byDay: Record<string, number>;
  period: string;
  rateLimit: {
    allowed: boolean;
    usage: number;
    limit: number;
    remaining: number;
  };
}

/**
 * Check if AI service is available
 */
export async function checkAIStatus(orgId: number): Promise<AIStatusResponse> {
  const response = await aiClient.get('/status', {
    params: { orgId }
  });
  return response.data.data;
}

/**
 * Get AI usage statistics for entity
 */
export async function getAIUsage(
  orgId: number,
  days: number = 30
): Promise<AIUsageResponse> {
  const response = await aiClient.get('/usage', {
    params: { orgId, days }
  });
  return response.data.data;
}

/**
 * Generate transformation script from input/output examples
 */
export async function generateTransformation(
  orgId: number,
  request: AITransformationRequest,
  signal?: AbortSignal
): Promise<AITransformationResponse> {
  const response = await aiClient.post('/generate-transformation', request, {
    params: { orgId },
    signal
  });
  return response.data.data;
}

/**
 * Analyze API documentation and suggest integration configuration
 */
export async function analyzeDocumentation(
  orgId: number,
  request: AIDocumentationRequest,
  signal?: AbortSignal
): Promise<AIDocumentationResponse> {
  const response = await aiClient.post('/analyze-documentation', request, {
    params: { orgId },
    signal
  });
  return response.data.data;
}

/**
 * Suggest field mappings between source and target fields
 */
export async function suggestFieldMappings(
  orgId: number,
  request: AIFieldMappingRequest,
  signal?: AbortSignal
): Promise<AIFieldMappingResponse> {
  const response = await aiClient.post('/suggest-mappings', request, {
    params: { orgId },
    signal
  });
  return response.data.data;
}

export interface AITestPayloadRequest {
  eventType: string;
}

export interface AITestPayloadResponse {
  payload: Record<string, any>;
  rateLimit: {
    allowed: boolean;
    usage: number;
    limit: number;
    remaining: number;
  };
}

/**
 * Generate realistic test payload for event type
 */
export async function generateTestPayload(
  orgId: number,
  request: AITestPayloadRequest,
  signal?: AbortSignal
): Promise<AITestPayloadResponse> {
  const response = await aiClient.post('/generate-test-payload', request, {
    params: { orgId },
    signal
  });
  return response.data.data;
}

export interface AISchedulingScriptRequest {
  description: string;
  mode: 'DELAYED' | 'RECURRING';
  eventType?: string;
}

export interface AISchedulingScriptResponse {
  script: string;
  rateLimit: {
    allowed: boolean;
    usage: number;
    limit: number;
    remaining: number;
  };
}

/**
 * Generate scheduling script from description
 */
export async function generateSchedulingScript(
  orgId: number,
  request: AISchedulingScriptRequest,
  signal?: AbortSignal
): Promise<AISchedulingScriptResponse> {
  const response = await aiClient.post('/generate-scheduling-script', request, {
    params: { orgId },
    signal
  });
  return response.data.data;
}

/**
 * Error types for AI API
 */
export class AIRateLimitError extends Error {
  constructor(message: string, public usage: number, public limit: number) {
    super(message);
    this.name = 'AIRateLimitError';
  }
}

export class AIServiceUnavailableError extends Error {
  constructor(message: string = 'AI service is not available') {
    super(message);
    this.name = 'AIServiceUnavailableError';
  }
}

/**
 * Handle AI API errors
 */
export function handleAIError(error: any): never {
  if (error.response?.status === 429) {
    const data = error.response?.data;
    throw new AIRateLimitError(
      data?.error || 'Daily AI limit exceeded',
      data?.usage || 0,
      data?.limit || 100
    );
  }

  if (error.response?.status === 503) {
    throw new AIServiceUnavailableError(error.response?.data?.error);
  }

  throw error;
}

// ─── AI Config Management ─────────────────────────────────────────────────────

export interface AIConfigData {
  orgId?: number;
  provider: string;
  model: string;
  hasApiKey: boolean;
  dailyLimit: number;
  enabled: boolean;
  providerModels?: Record<string, string[]>;
}

export interface AIConfigSaveRequest {
  provider: string;
  apiKey?: string;
  model?: string;
  dailyLimit?: number;
  enabled?: boolean;
}

export interface AIConnectionTestResult {
  latencyMs: number;
  model: string;
}

/**
 * Get AI configuration for the current entity
 */
export async function getAIConfig(orgId: number): Promise<AIConfigData> {
  const response = await aiConfigClient.get('/', { params: { orgId } });
  return {
    ...response.data.data,
    providerModels: response.data.providerModels
  };
}

/**
 * Save AI configuration for the current entity
 */
export async function saveAIConfig(orgId: number, config: AIConfigSaveRequest): Promise<AIConfigData> {
  const response = await aiConfigClient.put('/', config, { params: { orgId } });
  return response.data.data;
}

/**
 * Test the AI connection using the saved config
 */
export async function testAIConnection(orgId: number): Promise<AIConnectionTestResult> {
  const response = await aiConfigClient.post('/test', {}, { params: { orgId } });
  return response.data.data;
}

/**
 * Delete the saved AI API key for the current entity
 */
export async function deleteAIKey(orgId: number): Promise<void> {
  await aiConfigClient.delete('/api-key', { params: { orgId } });
}

/**
 * Get available providers and their model lists
 */
export async function getAIProviders(orgId: number): Promise<Record<string, string[]>> {
  const response = await aiConfigClient.get('/providers', { params: { orgId } });
  return response.data.data.models;
}

// ─── New AI Operations ────────────────────────────────────────────────────────

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatContext {
  integrationId?: string;
  logId?: string;
  eventType?: string;
}

export interface ChatAction {
  type: 'CREATE_INTEGRATION';
  config: Record<string, any>;
}

export interface ChatResponse {
  reply: string;
  action?: ChatAction;
  rateLimit: {
    allowed: boolean;
    usage: number;
    limit: number;
    remaining: number;
  };
}

export interface ErrorAnalysisRequest {
  errorMessage: string;
  logId?: string;
  integrationId?: string;
  transformationCode?: string;
  payload?: any;
}

export interface ErrorAnalysisResult {
  rootCause: string;
  explanation: string;
  suggestedFix: string;
  codeChange?: string;
  configPatch?: Record<string, any>;
  severity: 'low' | 'medium' | 'high' | 'critical';
  rateLimit?: {
    allowed: boolean;
    usage: number;
    limit: number;
    remaining: number;
  };
}

export interface ExplainTransformationRequest {
  code: string;
  errorMessage?: string;
  eventType?: string;
}

export interface ExplainTransformationResult {
  explanation: string;
  fixedCode?: string;
  whatChanged?: string;
  suggestions?: string[];
  dataFlow?: string;
  rateLimit?: {
    allowed: boolean;
    usage: number;
    limit: number;
    remaining: number;
  };
}

export interface DiagnoseLogFixPatch {
  script?: {
    path: string;
    before: string;
    after: string;
    diff: string;
  } | null;
  config?: {
    patch: Record<string, any>;
    changes: Array<{
      path: string;
      before: any;
      after: any;
    }>;
  } | null;
}

export interface DiagnoseLogFixResult {
  logId: string;
  integrationId: string | null;
  analysis: ErrorAnalysisResult;
  patchable: boolean;
  patch: DiagnoseLogFixPatch;
}

export interface ApplyLogFixRequest {
  logId: string;
  integrationId?: string;
  codeChange?: string;
  scriptPath?: string;
  configPatch?: Record<string, any>;
}

export interface ApplyLogFixResult {
  integrationId: string | null;
  applied: {
    scriptPath: string | null;
    configKeys: string[];
  };
}

/**
 * Multi-turn chat with entity context automatically injected from MongoDB
 */
export async function chatWithAI(
  orgId: number,
  messages: ChatMessage[],
  context?: ChatContext,
  signal?: AbortSignal
): Promise<ChatResponse> {
  const response = await aiClient.post('/chat', { messages, context }, { params: { orgId }, signal });
  return response.data.data;
}

/**
 * Analyze a delivery error and get root cause + fix suggestion
 */
export async function analyzeError(
  orgId: number,
  request: ErrorAnalysisRequest,
  signal?: AbortSignal
): Promise<ErrorAnalysisResult> {
  const response = await aiClient.post('/analyze-error', request, { params: { orgId }, signal });
  return response.data.data;
}

/**
 * Diagnose a failed log and return exact script/config patch suggestions with diff.
 */
export async function diagnoseLogFix(
  orgId: number,
  request: { logId: string; integrationId?: string },
  signal?: AbortSignal
): Promise<DiagnoseLogFixResult> {
  const response = await aiClient.post('/diagnose-log-fix', request, { params: { orgId }, signal });
  return response.data.data;
}

/**
 * Apply an AI-suggested fix for a failed log directly to integration config.
 */
export async function applyLogFix(
  orgId: number,
  request: ApplyLogFixRequest,
  signal?: AbortSignal
): Promise<ApplyLogFixResult> {
  const response = await aiClient.post('/apply-log-fix', request, { params: { orgId }, signal });
  return response.data.data;
}

/**
 * Explain or fix a transformation script
 */
export async function explainTransformation(
  orgId: number,
  request: ExplainTransformationRequest,
  signal?: AbortSignal
): Promise<ExplainTransformationResult> {
  const response = await aiClient.post('/explain-transformation', request, { params: { orgId }, signal });
  return response.data.data;
}
