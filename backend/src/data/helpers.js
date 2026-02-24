'use strict';
const { log, logError } = require('../logger');
const mongodb = require('../mongodb');
const { toIso } = require('../utils/time');
const { parsePositiveInt } = require('../utils/org-context');

const useMongo = () => mongodb.isConnected();

function normalizeOrgId(value) {
  return parsePositiveInt(value);
}

function integrationOrgQuery(orgId) {
  return buildOrgScopeQuery(orgId);
}

function buildOrgScopeQuery(orgId) {
  return { orgId };
}

function addOrgScope(query, orgId) {
  const scope = buildOrgScopeQuery(orgId);
  if (!scope || Object.keys(scope).length === 0) return query;
  if (scope.$or) {
    // $or-style scoping: wrap in $and if query already has field conditions
    if (query.$and) {
      query.$and.push(scope);
    } else if (Object.keys(query).length === 0) {
      Object.assign(query, scope);
    } else {
      query.$and = [scope];
    }
  } else {
    // Simple field scoping (e.g., { orgId: 1 }) — merge directly
    Object.assign(query, scope);
  }
  return query;
}

function scheduledOrgQuery(orgId) {
  return buildOrgScopeQuery(orgId);
}

// Helper function to throw error when fallback is attempted
function fallbackDisabledError(operation) {
  const error = new Error(`Required data source unavailable for ${operation} - fallback storage is disabled`);
  error.code = 'FALLBACK_DISABLED';
  throw error;
}

// Helper to get MongoDB collection with automatic reconnection
async function getCollection(name) {
  const mongoDb = await mongodb.getDbSafe();
  return mongoDb.collection(name);
}

// Map MongoDB document to API format
function mapIntegrationFromMongo(doc) {
  const orgId = doc.orgId;
  const orgUnitRid = doc.orgUnitRid || orgId;
  return {
    id: doc._id.toString(),
    name: doc.name,
    type: doc.type || doc.eventType, // New field, fallback to eventType for backward compatibility
    eventType: doc.type || doc.eventType, // Keep eventType for backward compatibility
    direction: doc.direction || 'OUTBOUND', // Default to OUTBOUND for backward compatibility
    orgId,
    orgUnitRid,
    entityName: doc.entityName || orgId,
    scope: doc.scope,
    excludedEntityRids: doc.excludedEntityRids || [],
    targetUrl: doc.targetUrl,
    httpMethod: doc.httpMethod,
    outgoingAuthType: doc.outgoingAuthType,
    outgoingAuthConfig: doc.outgoingAuthConfig, // Already an object in MongoDB
    inboundAuthType: doc.inboundAuthType || null, // INBOUND authentication type
    inboundAuthConfig: doc.inboundAuthConfig || null, // INBOUND authentication config
    responseTransformation: doc.responseTransformation || null, // INBOUND response transformation
    streamResponse: !!doc.streamResponse, // INBOUND response streaming
    rateLimits: doc.rateLimits || null, // Per-integration rate limiting
    isActive: !!doc.isActive,
    timeoutMs: doc.timeoutMs,
    retryCount: doc.retryCount,
    transformationMode: doc.transformationMode || 'SIMPLE',
    transformation: doc.transformation, // Already an object in MongoDB
    authType: doc.outgoingAuthType,
    authConfig: doc.outgoingAuthConfig,
    transformMode: doc.transformationMode || 'SIMPLE',
    transformConfig: doc.transformation || null,
    actions: doc.actions, // Multi-action integrations support
    isInherited: !!doc.isInherited,
    sourceEntityName: doc.sourceEntityName,
    version: doc.version,
    versionNotes: doc.versionNotes,
    compatibilityMode: doc.compatibilityMode || 'BACKWARD_COMPATIBLE',
    isDefault: !!doc.isDefault,
    autoIncrement: !!doc.autoIncrement,
    versionStrategy: doc.versionStrategy || 'SEMANTIC',
    metadata: doc.metadata || {},
    // Integration signing configuration (Standard Integrations)
    signingSecret: doc.signingSecret, // Current active secret
    signingSecrets: doc.signingSecrets || [], // All active secrets (for rotation)
    enableSigning: doc.enableSigning !== false, // Default to true
    signatureVersion: doc.signatureVersion || 'v1',
    // Scheduling configuration (MVP for delayed/recurring integrations)
    deliveryMode: doc.deliveryMode || 'IMMEDIATE', // IMMEDIATE | DELAYED | RECURRING
    schedulingConfig: doc.schedulingConfig || null, // { script, timezone, description }
    createdAt: doc.createdAt?.toISOString() || new Date().toISOString(),
    updatedAt: doc.updatedAt?.toISOString() || new Date().toISOString(),
  };
}

function mapScheduledIntegrationFromMongo(doc) {
  const orgId = doc.orgId;
  const orgUnitRid = doc.orgUnitRid || orgId;
  return {
    id: doc._id.toString(),
    integrationConfigId: doc.__KEEP___KEEP_integrationConfig__Id__?.toString() || doc.integrationConfigId?.toString(),
    webhookConfigId:
      doc.webhookConfigId?.toString?.() ||
      doc.__KEEP___KEEP_integrationConfig__Id__?.toString() ||
      doc.integrationConfigId?.toString(),
    integrationName: doc.__KEEP_integrationName__ || doc.integrationName,
    webhookName: doc.webhookName || doc.__KEEP_integrationName__ || doc.integrationName,
    orgId,
    orgUnitRid,
    originalEventId: doc.originalEventId,
    eventType: doc.eventType,
    scheduledFor: doc.scheduledFor?.toISOString() || doc.scheduledFor,
    status: doc.status,
    payload: doc.payload,
    targetUrl: doc.targetUrl,
    httpMethod: doc.httpMethod,
    cancellationInfo: doc.cancellationInfo || null,
    recurringConfig: doc.recurringConfig || null,
    createdAt: doc.createdAt?.toISOString() || new Date().toISOString(),
    updatedAt: doc.updatedAt?.toISOString() || new Date().toISOString(),
  };
}

function mapLogFromMongo(doc) {
  const responseStatus = doc.responseStatus ?? doc.response?.statusCode;
  const responseBody = doc.responseBody ?? doc.response?.body;
  const requestHeaders = doc.requestHeaders ?? doc.request?.headers;
  const requestPayload = doc.requestPayload ?? doc.request?.body;
  const requestQuery = doc.request?.query;
  const targetUrl = doc.targetUrl ?? doc.request?.url;
  const httpMethod = doc.httpMethod ?? doc.request?.method;
  const createdAt = doc.createdAt || doc.startedAt;
  const deliveredAt = doc.deliveredAt || doc.finishedAt;

  return {
    id: doc._id.toString(),
    __KEEP___KEEP_integrationConfig__Id__:
      doc.__KEEP___KEEP_integrationConfig__Id__?.toString() || doc.__KEEP___KEEP_integrationConfig__Id__,
    __KEEP_integrationName__: doc.__KEEP_integrationName__,
    eventType: doc.eventType,
    integrationType: doc.integrationType || doc.eventType,
    direction: doc.direction || 'OUTBOUND',
    triggerType: doc.triggerType || 'EVENT',
    actionName: doc.actionName || null,
    actionIndex: Number.isFinite(doc.actionIndex) ? doc.actionIndex : null,
    status: doc.status,
    errorCategory: doc.errorCategory || doc.error?.category || null,
    responseStatus,
    responseTimeMs: doc.responseTimeMs,
    attemptCount: doc.attemptCount,
    createdAt: createdAt?.toISOString?.(),
    deliveredAt: deliveredAt?.toISOString?.(),
    errorMessage: doc.errorMessage,
    originalPayload: doc.originalPayload, // Original payload from notification_queue
    requestPayload, // Already an object in MongoDB
    requestQuery,
    responseBody: responseBody || undefined,
    targetUrl,
    httpMethod,
    // Distributed tracing
    correlationId: doc.correlationId,
    traceId: doc.traceId,
    // Request details
    requestHeaders,
    shouldRetry: doc.shouldRetry,
    // Integration signing details (for audit trail)
    messageId: doc.messageId, // Unique message identifier
    timestamp: doc.timestamp, // Unix timestamp when integration was sent
    signature: doc.signature, // The signature that was sent
    signatureHeaders: doc.signatureHeaders, // All signature headers sent
  };
}

function mapAlertCenterLog(doc) {
  return {
    id: doc._id.toString(),
    orgId: doc.orgId,
    type: doc.type,
    channel: doc.channel,
    status: doc.status,
    subject: doc.subject,
    recipients: doc.recipients || [],
    totalFailures: doc.totalFailures ?? null,
    windowStart: doc.windowStart?.toISOString?.() || doc.windowStart,
    windowEnd: doc.windowEnd?.toISOString?.() || doc.windowEnd,
    errorMessage: doc.errorMessage || null,
    errorStack: doc.errorStack || null,
    payload: doc.payload || null,
    providerUrl: doc.providerUrl || null,
    providerResponse: doc.providerResponse || null,
    createdAt: doc.createdAt?.toISOString?.() || new Date().toISOString(),
  };
}

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const mergeConfigs = (base, override) => {
  if (override === undefined) return base;
  if (!isPlainObject(base) || !isPlainObject(override)) {
    return override;
  }

  const merged = { ...base };
  Object.keys(override).forEach((key) => {
    merged[key] = mergeConfigs(base[key], override[key]);
  });
  return merged;
};

const stripUiConfig = (configDoc) => {
  if (!configDoc) return null;
  const { _id, orgId, createdAt, updatedAt, updatedBy, version, ...rest } = configDoc;
  return rest;
};

module.exports = {
  useMongo,
  normalizeOrgId,
  integrationOrgQuery,
  buildOrgScopeQuery,
  addOrgScope,
  scheduledOrgQuery,
  fallbackDisabledError,
  getCollection,
  mapIntegrationFromMongo,
  mapScheduledIntegrationFromMongo,
  mapLogFromMongo,
  mapAlertCenterLog,
  isPlainObject,
  mergeConfigs,
  stripUiConfig,
};
