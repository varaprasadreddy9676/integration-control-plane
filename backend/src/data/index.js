const crypto = require('crypto');
const { log, logError, setDb } = require('../logger');
const db = require('../db'); // MySQL for event source and entity data (optional, adapter-based)
const config = require('../config');
const mongodb = require('../mongodb'); // MongoDB for integration gateway data
const { toIso } = require('../utils/time');
const { generateSigningSecret } = require('../services/integration-signing');
const { parsePositiveInt } = require('../utils/org-context');

const useMongo = () => mongodb.isConnected();
const useMysql = () => db.isConfigured();

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

// Track MySQL availability
let mysqlAvailable = false;
let reconnectInterval = null;

// Helper function to throw error when fallback is attempted
function fallbackDisabledError(operation) {
  const error = new Error(`Required data source unavailable for ${operation} - fallback storage is disabled`);
  error.code = 'FALLBACK_DISABLED';
  throw error;
}

// Check if MySQL is currently available for queries
function isMysqlAvailable() {
  return mysqlAvailable && useMysql();
}

// Attempt to reconnect to MySQL
async function attemptMysqlReconnect() {
  if (!useMysql()) {
    return false;
  }

  try {
    const ok = await db.ping();
    if (ok && !mysqlAvailable) {
      log('info', 'MySQL reconnected successfully');
      mysqlAvailable = true;
    } else if (!ok && mysqlAvailable) {
      log('warn', 'MySQL connection lost');
      mysqlAvailable = false;
    }
    return ok;
  } catch (err) {
    if (mysqlAvailable) {
      log('warn', 'MySQL connection lost', { error: err.message });
      mysqlAvailable = false;
    }
    return false;
  }
}

// Start background MySQL reconnection attempts
function startMysqlReconnection(intervalMs = 30000) {
  if (process.env.NODE_ENV === 'test') {
    return;
  }
  if (reconnectInterval) {
    return; // Already running
  }

  log('info', 'Starting MySQL reconnection monitor', { intervalMs });
  reconnectInterval = setInterval(async () => {
    if (!mysqlAvailable) {
      log('debug', 'Attempting to reconnect to MySQL...');
      await attemptMysqlReconnect();
    }
  }, intervalMs);
}

// Stop background MySQL reconnection
function stopMysqlReconnection() {
  if (reconnectInterval) {
    clearInterval(reconnectInterval);
    reconnectInterval = null;
    log('info', 'MySQL reconnection monitor stopped');
  }
}

const allowedParentsCache = {
  values: null,
  fetchedAt: 0
};

async function getAllowedParentRids() {
  if (!config.worker?.allowedParentsFromIntegrations) {
    return null;
  }

  const now = Date.now();
  if (allowedParentsCache.values && now - allowedParentsCache.fetchedAt < 30000) {
    return allowedParentsCache.values;
  }

  if (!useMongo()) {
    return fallbackDisabledError('getAllowedParentRids:mongo');
  }

  const dbClient = await mongodb.getDbSafe();
  const [orgParents, legacyParents] = await Promise.all([
    dbClient.collection('integration_configs').distinct('orgId', { isActive: true }),
    dbClient.collection('integration_configs').distinct('orgId', { isActive: true })
  ]);
  allowedParentsCache.values = Array.from(new Set([...orgParents, ...legacyParents].filter(Boolean)));
  allowedParentsCache.fetchedAt = now;
  return allowedParentsCache.values;
}

// Helper to get MongoDB collection with automatic reconnection
async function getCollection(name) {
  const mongoDb = await mongodb.getDbSafe();
  return mongoDb.collection(name);
}

async function initDataLayer() {
  // Connect to MongoDB for event gateway data
  try {
    await mongodb.connect();
    log('info', 'MongoDB connection established for event gateway');

    // Inject database instance into logger for error logging
    setDb(mongodb.getDb());
    log('info', 'Logger database instance configured');

    // Create TTL index for error_logs collection (30 days retention)
    try {
      const mongoDb = await mongodb.getDbSafe();
      await mongoDb.collection('error_logs').createIndex(
        { createdAt: 1 },
        { expireAfterSeconds: 30 * 24 * 60 * 60 } // 30 days in seconds
      );
      log('info', 'TTL index created for error_logs collection (30 days retention)');
    } catch (indexErr) {
      log('warn', 'Failed to create TTL index for error_logs', { error: indexErr.message });
    }
  } catch (err) {
    logError(err, { scope: 'MongoDB connection' });
    throw new Error('MongoDB connection required - no fallback available');
  }

  // Connect to MySQL for notification_queue reading only (optional global source)
  // If not configured, the app continues normally and relies on per-org event-source configs.
  if (useMysql()) {
    mysqlAvailable = await db.ping();
    if (mysqlAvailable) {
      log('info', 'MySQL connected for notification_queue');
      // Start background reconnection monitor
      startMysqlReconnection(30000); // Check every 30 seconds
    } else {
      log('warn', 'Global MySQL source ping failed - shared-pool MySQL adapters will remain unavailable until connection is restored');
      log('warn', 'API and UI will continue to work normally');
      // Start reconnection attempts
      startMysqlReconnection(30000);
    }
  } else {
    log('info', 'Global MySQL source not configured (expected when using per-org dynamic event sources)');
    mysqlAvailable = false;
  }
}

// Map MongoDB document to API format
function mapIntegrationFromMongo(doc) {
  const orgId = doc.orgId;
  const orgUnitRid = doc.orgUnitRid || doc.entityRid || orgId;
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
    signingSecret: doc.signingSecret,              // Current active secret
    signingSecrets: doc.signingSecrets || [],      // All active secrets (for rotation)
    enableSigning: doc.enableSigning !== false,    // Default to true
    signatureVersion: doc.signatureVersion || 'v1',
    // Scheduling configuration (MVP for delayed/recurring integrations)
    deliveryMode: doc.deliveryMode || 'IMMEDIATE', // IMMEDIATE | DELAYED | RECURRING
    schedulingConfig: doc.schedulingConfig || null, // { script, timezone, description }
    createdAt: doc.createdAt?.toISOString() || new Date().toISOString(),
    updatedAt: doc.updatedAt?.toISOString() || new Date().toISOString()
  };
}

function mapScheduledIntegrationFromMongo(doc) {
  const orgId = doc.orgId;
  const orgUnitRid = doc.orgUnitRid || doc.entityRid || orgId;
  return {
    id: doc._id.toString(),
    integrationConfigId: doc.__KEEP___KEEP_integrationConfig__Id__?.toString() || doc.integrationConfigId?.toString(),
    webhookConfigId: doc.webhookConfigId?.toString?.() || doc.__KEEP___KEEP_integrationConfig__Id__?.toString() || doc.integrationConfigId?.toString(),
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
    updatedAt: doc.updatedAt?.toISOString() || new Date().toISOString()
  };
}

function mapLogFromMongo(doc) {
  const responseStatus = doc.responseStatus ?? doc.response?.statusCode;
  const responseBody = doc.responseBody ?? doc.response?.body;
  const requestHeaders = doc.requestHeaders ?? doc.request?.headers;
  const requestPayload = doc.requestPayload ?? doc.request?.body;
  const targetUrl = doc.targetUrl ?? doc.request?.url;
  const httpMethod = doc.httpMethod ?? doc.request?.method;
  const createdAt = doc.createdAt || doc.startedAt;
  const deliveredAt = doc.deliveredAt || doc.finishedAt;

  return {
    id: doc._id.toString(),
    __KEEP___KEEP_integrationConfig__Id__: doc.__KEEP___KEEP_integrationConfig__Id__?.toString() || doc.__KEEP___KEEP_integrationConfig__Id__,
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
    messageId: doc.messageId,              // Unique message identifier
    timestamp: doc.timestamp,              // Unix timestamp when integration was sent
    signature: doc.signature,              // The signature that was sent
    signatureHeaders: doc.signatureHeaders // All signature headers sent
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
    createdAt: doc.createdAt?.toISOString?.() || new Date().toISOString()
  };
}

const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

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

async function listIntegrations(orgId) {
  const normalizedOrgId = normalizeOrgId(orgId);
  if (!normalizedOrgId) return [];

  if (useMongo()) {
    try {
      const db = await mongodb.getDbSafe();
      const integrations = await db.collection('integration_configs')
        .find(integrationOrgQuery(normalizedOrgId))
        .sort({ updatedAt: -1 })
        .toArray();
      return integrations.map(mapIntegrationFromMongo);
    } catch (err) {
      logError(err, { scope: 'listIntegrations' });
    }
  }
  return fallbackDisabledError('listIntegrations:fallback');
}

async function listIntegrationsForDelivery(orgId, eventType = null) {
  const normalizedOrgId = normalizeOrgId(orgId);
  if (!normalizedOrgId) return [];

  log('debug', 'Starting integration matching', {
    scope: 'listIntegrationsForDelivery:START',
    orgId: normalizedOrgId,
    eventType
  });

  const parentRid = await getParentRidForEntity(normalizedOrgId);
  log('debug', 'Got parent RID', {
    scope: 'listIntegrationsForDelivery:PARENT',
    orgId: normalizedOrgId,
    parentRid
  });

  const direct = await listIntegrations(normalizedOrgId);
  log('debug', 'Fetched direct integrations', {
    scope: 'listIntegrationsForDelivery:DIRECT',
    orgId: normalizedOrgId,
    directCount: direct.length,
    directIntegrations: direct.map(w => ({ id: w.id, name: w.name, type: w.type, direction: w.direction, isActive: w.isActive }))
  });

  if (parentRid && parentRid !== normalizedOrgId) {
    const parentHooks = await listIntegrations(parentRid);
    // Default to inheriting parent integrations; only skip when explicitly marked ENTITY_ONLY or excluded
    const inheritableParentHooks = parentHooks.filter((wh) => {
      // Skip if integration is ENTITY_ONLY
      if (wh.scope === 'ENTITY_ONLY') {
        return false;
      }

      // Skip if current entity is in exclusion list
      if (wh.excludedEntityRids && wh.excludedEntityRids.length > 0) {
        if (wh.excludedEntityRids.includes(normalizedOrgId)) {
          log('debug', 'Integration excluded for this entity', {
            scope: 'listIntegrationsForDelivery:EXCLUDED',
            integrationId: wh.id,
            __KEEP_integrationName__: wh.name,
            orgId: normalizedOrgId,
            excludedEntityRids: wh.excludedEntityRids
          });
          return false;
        }
      }

      return true;
    });
    const allHooks = [...inheritableParentHooks, ...direct];

    log('debug', 'Combined parent and direct hooks', {
      scope: 'listIntegrationsForDelivery:PARENT_HOOKS',
      parentHooksCount: parentHooks.length,
      allHooksCount: allHooks.length
    });

    // Filter by event type if provided - Only OUTBOUND integrations for delivery
    if (eventType) {
      const filtered = allHooks.filter((wh) =>
        wh.isActive &&
        (wh.direction === 'OUTBOUND' || !wh.direction) && // Include configs without direction for backward compatibility
        (wh.type === eventType || wh.type === '*')
      );
      log('debug', 'Filtered by event type and active status', {
        scope: 'listIntegrationsForDelivery:FILTERED',
        eventType,
        beforeFilter: allHooks.length,
        afterFilter: filtered.length,
        filtered: filtered.map(w => ({ id: w.id, name: w.name, type: w.type, direction: w.direction, isActive: w.isActive }))
      });
      return filtered;
    }
    return allHooks.filter((wh) => wh.isActive && (wh.direction === 'OUTBOUND' || !wh.direction));
  }

  // Filter by event type if provided - Only OUTBOUND integrations for delivery
  if (eventType) {
    const filtered = direct.filter((wh) =>
      wh.isActive &&
      (wh.direction === 'OUTBOUND' || !wh.direction) && // Include configs without direction for backward compatibility
      (wh.type === eventType || wh.type === '*')
    );
    log('debug', 'Filtered direct integrations by event type', {
      scope: 'listIntegrationsForDelivery:DIRECT_FILTERED',
      eventType,
      beforeFilter: direct.length,
      afterFilter: filtered.length,
      filtered: filtered.map(w => ({ id: w.id, name: w.name, type: w.type, direction: w.direction, isActive: w.isActive }))
    });
    return filtered;
  }

  const active = direct.filter((wh) => wh.isActive && (wh.direction === 'OUTBOUND' || !wh.direction));
  log('debug', 'Filtered by active status and direction=OUTBOUND', {
    scope: 'listIntegrationsForDelivery:ACTIVE',
    beforeFilter: direct.length,
    afterFilter: active.length
  });
  return active;
}

async function getParentRidForEntity(orgId) {
  if (useMongo()) {
    try {
      const dbClient = await mongodb.getDbSafe();

      const org = await dbClient.collection('organizations').findOne(
        { orgId },
        { projection: { orgId: 1 } }
      );
      if (org?.orgId) {
        return org.orgId;
      }

      const unit = await dbClient.collection('org_units').findOne(
        { rid: orgId },
        { projection: { orgId: 1 } }
      );
      if (unit?.orgId) {
        return unit.orgId;
      }
    } catch (err) {
      logError(err, { scope: 'getParentRidForEntity:mongo', orgId });
    }
    return orgId;
  }

  return fallbackDisabledError('getParentRidForEntity:mongo');
}

async function getIntegration(id) {
  if (useMongo()) {
    try {
      const db = await mongodb.getDbSafe();
      const objectId = mongodb.toObjectId(id);

      // CRITICAL LOGGING: Track what ID we're looking up
      log('debug', 'getIntegration called', {
        originalId: id,
        originalIdType: typeof id,
        isObjectId: id instanceof mongodb.ObjectId,
        convertedObjectId: objectId ? objectId.toString() : null
      });

      if (!objectId) {
        log('error', 'CRITICAL: Failed to convert integration ID to ObjectId', {
          id,
          idType: typeof id,
          idValue: String(id)
        });
        return undefined;
      }

      const integration = await db.collection('integration_configs')
        .findOne({ _id: objectId });

      if (!integration) {
        log('warn', 'Integration not found in database', {
          searchedId: objectId.toString(),
          originalId: id
        });
      }

      return integration ? mapIntegrationFromMongo(integration) : undefined;
    } catch (err) {
      logError(err, { scope: 'getIntegration', id });
    }
  }
  return fallbackDisabledError('getIntegration:fallback');
}

async function addIntegration(orgId, payload) {
  const normalizedOrgId = normalizeOrgId(orgId);
  if (!normalizedOrgId) return undefined;

  if (useMongo()) {
    try {
      const now = new Date();
      const db = await mongodb.getDbSafe();

      // Handle versioning fields
      const {
        version = '1.0.0',
        versionNotes = 'Initial version',
        compatibilityMode = 'BACKWARD_COMPATIBLE',
        isDefault = false,
        autoIncrement = false,
        versionStrategy = 'SEMANTIC'
      } = payload.metadata || {};

      // Generate signing secret for integration security
      // Each integration gets a unique secret (per-endpoint, not shared)
      // Following Standard Integrations specification
      const signingSecret = generateSigningSecret();

      const integration = {
        name: payload.name,
        type: payload.type || payload.eventType, // New field, fallback to eventType for backward compatibility
        eventType: payload.type || payload.eventType, // Keep eventType for backward compatibility during transition
        direction: payload.direction || 'OUTBOUND', // Default to OUTBOUND if not specified
        orgId: normalizedOrgId,
        orgUnitRid: payload.orgUnitRid || payload.entityRid || normalizedOrgId,
        entityName: payload.entityName || 'Tenant',
        scope: payload.scope || 'INCLUDE_CHILDREN',
        excludedEntityRids: payload.excludedEntityRids || [],
        targetUrl: payload.targetUrl,
        httpMethod: payload.httpMethod,
        outgoingAuthType: payload.outgoingAuthType || 'NONE',
        outgoingAuthConfig: payload.outgoingAuthConfig || null, // Store as object
        authType: payload.outgoingAuthType || 'NONE',
        authConfig: payload.outgoingAuthConfig || null,
        inboundAuthType: payload.inboundAuthType || null, // INBOUND authentication type
        inboundAuthConfig: payload.inboundAuthConfig || null, // INBOUND authentication config
        responseTransformation: payload.responseTransformation || null, // INBOUND response transformation
        streamResponse: !!payload.streamResponse, // INBOUND response streaming
        rateLimits: payload.rateLimits || null, // Per-integration rate limiting
        isActive: payload.isActive !== false,
        timeoutMs: payload.timeoutMs,
        retryCount: payload.retryCount,
        transformationMode: payload.transformationMode || 'SIMPLE',
        transformation: payload.transformation || null, // Store as object
        transformMode: payload.transformationMode || 'SIMPLE',
        transformConfig: payload.transformation || null,
        actions: payload.actions || null, // Store actions array for multi-action integrations
        isInherited: payload.isInherited || false,
        sourceEntityName: payload.sourceEntityName || null,
        version,
        versionNotes,
        compatibilityMode,
        isDefault,
        autoIncrement,
        versionStrategy,
        // Integration signing configuration (opt-in security feature)
        signingSecret,                          // Current active secret (generated for future use)
        signingSecrets: [signingSecret],        // Array of active secrets (for rotation)
        enableSigning: false,                   // Signing disabled by default (opt-in)
        signatureVersion: 'v1',                 // Signature scheme version
        // Scheduling configuration (MVP for delayed/recurring integrations)
        deliveryMode: payload.deliveryMode || 'IMMEDIATE', // Default to immediate for backward compatibility
        schedulingConfig: payload.schedulingConfig || null, // { script, timezone, description }
        metadata: {
          ...payload.metadata,
          versioning: {
            version,
            versionNotes,
            compatibilityMode,
            isDefault,
            autoIncrement,
            versionStrategy
          }
        },
        createdAt: now,
        updatedAt: now
      };

      log('info', 'Generated signing secret for new integration', {
        __KEEP_integrationName__: payload.name,
        secretPrefix: signingSecret.substring(0, 10) + '...',
        enableSigning: true
      });

      const result = await db.collection('integration_configs').insertOne(integration);
      integration._id = result.insertedId;

      return mapIntegrationFromMongo(integration);
    } catch (err) {
      logError(err, { scope: 'addIntegration', orgId: normalizedOrgId });
    }
  }
  return fallbackDisabledError('addIntegration:fallback');
}

async function updateIntegration(orgId, id, patch) {
  const normalizedOrgId = normalizeOrgId(orgId);
  if (!normalizedOrgId) return undefined;

  if (useMongo()) {
    try {
      const now = new Date();
      const db = await mongodb.getDbSafe();

      // Normalize eventType → type for backward compatibility
      // If UI sends eventType, ensure type is also set
      const updateDoc = { ...patch, updatedAt: now };

      if (updateDoc.eventType && !updateDoc.type) {
        updateDoc.type = updateDoc.eventType;
      } else if (updateDoc.type && !updateDoc.eventType) {
        updateDoc.eventType = updateDoc.type;
      }

      // Debug: Log what we're saving
      log('debug', 'Updating integration', {
        scope: 'updateIntegration',
        id,
        excludedEntityRids: updateDoc.excludedEntityRids,
        scope: updateDoc.scope,
        type: updateDoc.type,
        eventType: updateDoc.eventType
      });

      // Don't stringify objects - MongoDB stores them natively
      // Just pass them through as-is

      await db.collection('integration_configs').updateOne(
        {
          _id: mongodb.toObjectId(id),
          ...integrationOrgQuery(normalizedOrgId)
        },
        { $set: updateDoc }
      );

      const updated = await getIntegration(id);

      // Debug: Log what we got back
      log('debug', 'Integration updated, retrieved:', {
        scope: 'updateIntegration:retrieved',
        id: updated?.id,
        excludedEntityRids: updated?.excludedEntityRids,
        type: updated?.type
      });

      return updated && updated.orgId === normalizedOrgId ? updated : undefined;
    } catch (err) {
      logError(err, { scope: 'updateIntegration', id });
    }
  }
  return fallbackDisabledError('updateIntegration:fallback');
}

/**
 * Get integration config by type and direction
 * Used for INBOUND integrations to find the correct config
 */
async function getIntegrationByTypeAndDirection(orgId, type, direction) {
  const normalizedOrgId = normalizeOrgId(orgId);
  if (!normalizedOrgId) return null;

  if (useMongo()) {
    try {
      const db = await mongodb.getDbSafe();
      const doc = await db.collection('integration_configs').findOne({
        ...integrationOrgQuery(normalizedOrgId),
        type: type,
        direction: direction,
        isActive: true
      });

      if (!doc) {
        return null;
      }

      return mapIntegrationFromMongo(doc);
    } catch (err) {
      logError(err, { scope: 'getIntegrationByTypeAndDirection', orgId: normalizedOrgId, type, direction });
    }
  }
  return fallbackDisabledError('getIntegrationByTypeAndDirection:fallback');
}

async function deleteIntegration(orgId, id) {
  const normalizedOrgId = normalizeOrgId(orgId);
  if (!normalizedOrgId) return false;

  if (useMongo()) {
    try {
      const db = await mongodb.getDbSafe();
      const result = await db.collection('integration_configs').deleteOne({
        _id: mongodb.toObjectId(id),
        ...integrationOrgQuery(normalizedOrgId)
      });
      return result.deletedCount > 0;
    } catch (err) {
      logError(err, { scope: 'deleteIntegration', id });
    }
  }
  return fallbackDisabledError('deleteIntegration:fallback');
}

// Bulk update integrations (for enable/disable operations)
async function bulkUpdateIntegrations(orgId, ids, patch) {
  const normalizedOrgId = normalizeOrgId(orgId);
  if (!normalizedOrgId) return { updatedCount: 0, failedIds: ids };

  if (useMongo()) {
    try {
      const db = await mongodb.getDbSafe();
      const now = new Date();

      // Convert string IDs to ObjectIds and track failed conversions
      const objectIds = [];
      const failedIds = [];

      for (const id of ids) {
        try {
          objectIds.push(mongodb.toObjectId(id));
        } catch (err) {
          failedIds.push(id);
          log('warn', 'Invalid integration ID in bulk update', { id, error: err.message });
        }
      }

      if (objectIds.length === 0) {
        return { updatedCount: 0, failedIds };
      }

      // Update documents
      const updateDoc = { ...patch, updatedAt: now };
      const result = await db.collection('integration_configs').updateMany(
        {
          _id: { $in: objectIds },
          ...integrationOrgQuery(normalizedOrgId)
        },
        { $set: updateDoc }
      );

      log('info', 'Bulk update completed', {
        scope: 'bulkUpdateIntegrations',
        requested: ids.length,
        updated: result.modifiedCount,
        failed: failedIds.length
      });

      return {
        updatedCount: result.modifiedCount,
        failedIds
      };
    } catch (err) {
      logError(err, { scope: 'bulkUpdateIntegrations' });
      return { updatedCount: 0, failedIds: ids };
    }
  }

  return fallbackDisabledError('bulkUpdateIntegrations:fallback');
}

// Bulk delete integrations
async function bulkDeleteIntegrations(orgId, ids) {
  const normalizedOrgId = normalizeOrgId(orgId);
  if (!normalizedOrgId) return { deletedCount: 0, failedIds: ids };

  if (useMongo()) {
    try {
      const db = await mongodb.getDbSafe();

      // Convert string IDs to ObjectIds and track failed conversions
      const objectIds = [];
      const failedIds = [];

      for (const id of ids) {
        try {
          objectIds.push(mongodb.toObjectId(id));
        } catch (err) {
          failedIds.push(id);
          log('warn', 'Invalid integration ID in bulk delete', { id, error: err.message });
        }
      }

      if (objectIds.length === 0) {
        return { deletedCount: 0, failedIds };
      }

      // Delete documents
      const result = await db.collection('integration_configs').deleteMany({
        _id: { $in: objectIds },
        ...integrationOrgQuery(normalizedOrgId)
      });

      log('info', 'Bulk delete completed', {
        scope: 'bulkDeleteIntegrations',
        requested: ids.length,
        deleted: result.deletedCount,
        failed: failedIds.length
      });

      return {
        deletedCount: result.deletedCount,
        failedIds
      };
    } catch (err) {
      logError(err, { scope: 'bulkDeleteIntegrations' });
      return { deletedCount: 0, failedIds: ids };
    }
  }

  return fallbackDisabledError('bulkDeleteIntegrations:fallback');
}

async function listEventTypes(orgId) {
  // Fetch event types from MongoDB event_types collection
  if (useMongo()) {
    try {
      const collection = await getCollection('event_types');
      // Return org-specific UNION global templates (orgId:null)
      const query = orgId
        ? { $or: [{ orgId }, { orgId: null }] }
        : { orgId: null };
      const docs = await collection.find(query, { projection: { type: 1, eventType: 1, orgId: 1, _id: 0 } })
        .sort({ type: 1, eventType: 1 })
        .toArray();
      // Deduplicate: org-specific wins over global template on same key
      const seen = new Set();
      const deduped = docs
        .sort((a, b) => {
          // org-specific (non-null orgId) sorts before global (null orgId)
          const aIsOrg = a.orgId !== null && a.orgId !== undefined;
          const bIsOrg = b.orgId !== null && b.orgId !== undefined;
          if (aIsOrg && !bIsOrg) return -1;
          if (!aIsOrg && bIsOrg) return 1;
          return 0;
        })
        .filter(d => {
          const k = d.type || d.eventType;
          if (!k || seen.has(k)) return false;
          seen.add(k);
          return true;
        });
      return deduped.map(d => d.type || d.eventType).filter(Boolean);
    } catch (err) {
      logError(err, { scope: 'listEventTypes' });
      throw err;
    }
  }
  return fallbackDisabledError('listEventTypes:fallback');
}

/**
 * Build query object for delivery logs filtering
 * Extracted for reuse across listLogs, countLogs, getLogStatsSummary, and streamLogsForExport
 */
function buildLogsQuery(orgId, filters = {}) {
  const query = addOrgScope({}, orgId);
  const andConditions = [];

  if (filters.status) {
    const statusValue = String(filters.status).toUpperCase();
    // Handle comma-separated status values (e.g., "FAILED,SKIPPED,ABANDONED")
    if (statusValue.includes(',')) {
      query.status = { $in: statusValue.split(',').map(s => s.trim()) };
    } else {
      query.status = statusValue;
    }
  }
  if (filters.direction) {
    query.direction = filters.direction;
  }
  if (filters.triggerType) {
    query.triggerType = filters.triggerType;
  }
  const integrationFilterId = filters.__KEEP___KEEP_integrationConfig__Id__ || filters.integrationConfigId || filters.webhookId;
  if (integrationFilterId) {
    const integrationIdObj = mongodb.toObjectId(integrationFilterId);
    if (integrationIdObj) {
      andConditions.push({
        $or: [
          { __KEEP___KEEP_integrationConfig__Id__: integrationIdObj },
          { __KEEP___KEEP_integrationConfig__Id__: integrationFilterId },
          { integrationConfigId: integrationIdObj },
          { integrationConfigId: integrationFilterId },
          { webhookConfigId: integrationIdObj },
          { webhookConfigId: integrationFilterId }
        ]
      });
    } else {
      andConditions.push({
        $or: [
          { __KEEP___KEEP_integrationConfig__Id__: integrationFilterId },
          { integrationConfigId: integrationFilterId },
          { webhookConfigId: integrationFilterId }
        ]
      });
    }
  }
  if (filters.eventType) {
    query.eventType = filters.eventType;
  }
  if (filters.search) {
    // Use regex search for flexible full-text search across multiple fields
    // This searches: __KEEP_integrationName__, eventType, errorMessage, targetUrl, responseBody
    // Case-insensitive regex search
    const searchRegex = { $regex: filters.search, $options: 'i' };
    andConditions.push({
      $or: [
        { __KEEP_integrationName__: searchRegex },
        { eventType: searchRegex },
        { errorMessage: searchRegex },
        { targetUrl: searchRegex },
        { responseBody: searchRegex },
        { 'requestPayload.mrn': searchRegex },
        { 'requestPayload.patient_name': searchRegex },
        { 'requestPayload.phone': searchRegex }
      ]
    });

    // Note: For better search performance on large datasets,
    // consider creating a text index and using $text search
  }

  // Combine $and conditions if any exist
  if (andConditions.length > 0) {
    query.$and = query.$and ? [...query.$and, ...andConditions] : andConditions;
  }

  // Add date range filtering
  if (filters.startDate || filters.endDate) {
    query.createdAt = {};
    if (filters.startDate) {
      query.createdAt.$gte = new Date(filters.startDate);
    }
    if (filters.endDate) {
      query.createdAt.$lte = new Date(filters.endDate);
    }
  }

  return query;
}

/**
 * Count delivery logs matching filters (for pagination metadata)
 * @param {number} orgId - Parent entity ID
 * @param {object} filters - Same filters as listLogs
 * @returns {Promise<number>} Total count of matching logs
 */
async function countLogs(orgId, filters = {}) {
  if (useMongo()) {
    try {
      const db = await mongodb.getDbSafe();
      const query = buildLogsQuery(orgId, filters);
      return await db.collection('execution_logs').countDocuments(query);
    } catch (err) {
      logError(err, { scope: 'countLogs', filters });
      throw err;
    }
  }
  return fallbackDisabledError('countLogs:fallback');
}

/**
 * List delivery logs with server-side pagination support
 * @param {number} orgId - Parent entity ID
 * @param {object} filters - Filtering and pagination options
 *   - status: Filter by delivery status
 *   - __KEEP___KEEP_integrationConfig__Id__: Filter by integration configuration
 *   - eventType: Filter by event type
 *   - search: Full-text search
 *   - startDate/endDate: Date range filtering
 *   - page: Page number (1-indexed, default: 1)
 *   - limit: Results per page (default: 500, max: 1000)
 * @returns {Promise<Array>} Array of delivery log objects
 */
async function listLogs(orgId, filters = {}) {
  if (useMongo()) {
    try {
      const db = await mongodb.getDbSafe();
      const query = buildLogsQuery(orgId, filters);

      // Pagination with validation
      const page = Math.max(1, parseInt(filters.page) || 1);
      const limit = Math.min(1000, Math.max(1, parseInt(filters.limit) || 500));
      const skip = (page - 1) * limit;

      const logs = await db.collection('execution_logs')
        .find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .toArray();

      return logs.map(mapLogFromMongo);
    } catch (err) {
      logError(err, { scope: 'listLogs', filters });
      throw err; // Re-throw the actual error for better debugging
    }
  }
  return fallbackDisabledError('listLogs:fallback');
}

/**
 * Get delivery log statistics summary using unbounded MongoDB aggregation
 * This does NOT use listLogs() to avoid the row limit cap
 * @param {number} orgId - Parent entity ID
 * @param {object} filters - Filtering options (__KEEP___KEEP_integrationConfig__Id__, eventType, dateRange)
 * @returns {Promise<object>} Statistics summary with total, success, failed, pending counts
 */
async function getLogStatsSummary(orgId, filters = {}) {
  if (useMongo()) {
    try {
      const db = await mongodb.getDbSafe();

      // Build match stage for aggregation (similar to buildLogsQuery but for aggregation pipeline)
      const matchStage = addOrgScope({}, orgId);

      if (filters.__KEEP___KEEP_integrationConfig__Id__) {
        const integrationIdObj = mongodb.toObjectId(filters.__KEEP___KEEP_integrationConfig__Id__);
        if (integrationIdObj) {
          matchStage.$and = matchStage.$and || [];
          matchStage.$and.push({
            $or: [
              { __KEEP___KEEP_integrationConfig__Id__: integrationIdObj },
              { __KEEP___KEEP_integrationConfig__Id__: filters.__KEEP___KEEP_integrationConfig__Id__ },
              { integrationConfigId: integrationIdObj },
              { integrationConfigId: filters.__KEEP___KEEP_integrationConfig__Id__ }
            ]
          });
        } else {
          matchStage.$and = matchStage.$and || [];
          matchStage.$and.push({
            $or: [
              { __KEEP___KEEP_integrationConfig__Id__: filters.__KEEP___KEEP_integrationConfig__Id__ },
              { integrationConfigId: filters.__KEEP___KEEP_integrationConfig__Id__ }
            ]
          });
        }
      }
      if (filters.eventType) {
        matchStage.eventType = filters.eventType;
      }
      if (filters.direction) {
        matchStage.direction = filters.direction;
      }
      if (filters.triggerType) {
        matchStage.triggerType = filters.triggerType;
      }
      if (filters.startDate || filters.endDate) {
        matchStage.createdAt = {};
        if (filters.startDate) {
          matchStage.createdAt.$gte = new Date(filters.startDate);
        }
        if (filters.endDate) {
          matchStage.createdAt.$lte = new Date(filters.endDate);
        }
      }

      const stats = await db.collection('execution_logs').aggregate([
        { $match: matchStage },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            success: { $sum: { $cond: [{ $eq: ['$status', 'SUCCESS'] }, 1, 0] } },
            failed: { $sum: { $cond: [{ $in: ['$status', ['FAILED', 'ABANDONED']] }, 1, 0] } },
            pending: {
              $sum: {
                $cond: [
                  { $or: [{ $eq: ['$status', 'PENDING'] }, { $eq: ['$status', 'RETRYING'] }] },
                  1,
                  0
                ]
              }
            }
          }
        }
      ]).toArray();

      const result = stats[0] || { total: 0, success: 0, failed: 0, pending: 0 };
      return {
        total: result.total,
        success: result.success,
        failed: result.failed,
        pending: result.pending,
        refreshedAt: new Date().toISOString()
      };
    } catch (err) {
      logError(err, { scope: 'getLogStatsSummary', filters });
      throw err;
    }
  }
  return fallbackDisabledError('getLogStatsSummary:fallback');
}

/**
 * Stream delivery logs for export using cursor-based iteration
 * Handles millions of rows efficiently without loading all into memory
 * @param {number} orgId - Parent entity ID
 * @param {object} filters - Same filters as listLogs (excluding page/limit)
 * @param {function} onLog - Callback function called for each log entry
 * @returns {Promise<number>} Total count of exported logs
 */
async function streamLogsForExport(orgId, filters = {}, onLog, options = {}) {
  if (useMongo()) {
    let cursor;
    try {
      const db = await mongodb.getDbSafe();
      const query = buildLogsQuery(orgId, filters);

      let count = 0;
      cursor = db.collection('execution_logs')
        .find(query)
        .sort({ createdAt: -1 })
        .batchSize(100) // Process 100 documents at a time for memory efficiency
        .noCursorTimeout(); // Prevent cursor timeout for large exports

      for await (const doc of cursor) {
        if (options.shouldStop && options.shouldStop()) {
          break;
        }
        const log = mapLogFromMongo(doc);
        await onLog(log);
        count++;
      }

      return count;
    } catch (err) {
      logError(err, { scope: 'streamLogsForExport', filters });
      throw err;
    } finally {
      // Ensure cursor is closed even if export is aborted
      if (cursor) {
        try {
          await cursor.close();
        } catch (closeErr) {
          // Cursor might already be closed, ignore error
        }
      }
    }
  }
  return fallbackDisabledError('streamLogsForExport:fallback');
}

async function getUiConfigForEntity(orgId) {
  if (useMongo()) {
    try {
      const db = await mongodb.getDbSafe();
      const defaultDoc = await db.collection('ui_config').findOne({ _id: 'default' });
      if (!defaultDoc) {
        throw new Error('UI configuration not seeded. Run: node scripts/populate-ui-config.js');
      }
      let merged = stripUiConfig(defaultDoc);

      if (orgId) {
        const entityDoc = await db.collection('ui_config').findOne({ orgId });
        if (entityDoc) {
          merged = mergeConfigs(merged, stripUiConfig(entityDoc));
        }
      }

      return merged;
    } catch (err) {
      logError(err, { scope: 'getUiConfigForEntity', orgId });
      throw err;
    }
  }
  return fallbackDisabledError('getUiConfigForEntity:fallback');
}

async function getUiConfigOverride(orgId) {
  if (useMongo()) {
    try {
      const db = await mongodb.getDbSafe();
      const entityDoc = await db.collection('ui_config').findOne({ orgId });
      return stripUiConfig(entityDoc);
    } catch (err) {
      logError(err, { scope: 'getUiConfigOverride', orgId });
      throw err;
    }
  }
  return fallbackDisabledError('getUiConfigOverride:fallback');
}

async function upsertUiConfigOverride(orgId, override) {
  if (useMongo()) {
    try {
      const db = await mongodb.getDbSafe();
      await db.collection('ui_config').updateOne(
        { orgId },
        {
          $set: {
            ...override,
            updatedAt: new Date()
          },
          $setOnInsert: {
            orgId,
            createdAt: new Date()
          }
        },
        { upsert: true }
      );
      return true;
    } catch (err) {
      logError(err, { scope: 'upsertUiConfigOverride', orgId });
      return false;
    }
  }
  return fallbackDisabledError('upsertUiConfigOverride:fallback');
}

async function clearUiConfigOverride(orgId) {
  if (useMongo()) {
    try {
      const db = await mongodb.getDbSafe();
      await db.collection('ui_config').deleteOne({ orgId });
      return true;
    } catch (err) {
      logError(err, { scope: 'clearUiConfigOverride', orgId });
      return false;
    }
  }
  return fallbackDisabledError('clearUiConfigOverride:fallback');
}

async function getSchedulerIntervalMinutes() {
  if (useMongo()) {
    try {
      const db = await mongodb.getDbSafe();
      const configs = await db.collection('ui_config')
        .find({ 'notifications.failureEmailReports.enabled': true })
        .project({ 'notifications.failureEmailReports.intervalMinutes': 1 })
        .toArray();

      const intervals = configs
        .map((doc) => Number(doc?.notifications?.failureEmailReports?.intervalMinutes))
        .filter((val) => Number.isFinite(val) && val > 0);

      if (intervals.length > 0) {
        return Math.min(...intervals);
      }
    } catch (err) {
      logError(err, { scope: 'getSchedulerIntervalMinutes' });
    }
  }
  return 15;
}

async function listAlertCenterLogs(orgId, filters = {}) {
  const normalizedOrgId = normalizeOrgId(orgId);
  if (!normalizedOrgId) return [];

  if (useMongo()) {
    try {
      const db = await mongodb.getDbSafe();
      const query = buildOrgScopeQuery(normalizedOrgId);

      if (filters.status) {
        query.status = filters.status;
      }
      if (filters.channel) {
        query.channel = filters.channel;
      }
      if (filters.type) {
        query.type = filters.type;
      }
      if (filters.search) {
        query.$or = [
          { subject: { $regex: filters.search, $options: 'i' } },
          { errorMessage: { $regex: filters.search, $options: 'i' } },
          { recipients: { $regex: filters.search, $options: 'i' } }
        ];
      }

      if (filters.startDate || filters.endDate) {
        query.createdAt = {};
        if (filters.startDate) {
          query.createdAt.$gte = new Date(filters.startDate);
        }
        if (filters.endDate) {
          query.createdAt.$lte = new Date(filters.endDate);
        }
      }

      const logs = await db.collection('alert_center_logs')
        .find(query)
        .sort({ createdAt: -1 })
        // Increased limit to avoid capping exports and status views
        // TODO: Implement pagination for alert center logs similar to delivery logs
        .limit(filters.limit || 10000)
        .toArray();

      return logs.map(mapAlertCenterLog);
    } catch (err) {
      logError(err, { scope: 'listAlertCenterLogs', filters });
      throw err;
    }
  }
  return fallbackDisabledError('listAlertCenterLogs:fallback');
}

async function recordAlertCenterLog(orgId, logPayload) {
  const normalizedOrgId = normalizeOrgId(orgId);
  if (!normalizedOrgId) return false;

  if (useMongo()) {
    try {
      const db = await mongodb.getDbSafe();
      const logDoc = {
        orgId: normalizedOrgId,
        type: logPayload.type,
        channel: logPayload.channel,
        status: logPayload.status,
        subject: logPayload.subject || null,
        recipients: logPayload.recipients || [],
        totalFailures: logPayload.totalFailures ?? null,
        windowStart: logPayload.windowStart || null,
        windowEnd: logPayload.windowEnd || null,
        errorMessage: logPayload.errorMessage || null,
        errorStack: logPayload.errorStack || null,
        payload: logPayload.payload || null,
        providerUrl: logPayload.providerUrl || null,
        providerResponse: logPayload.providerResponse || null,
        createdAt: logPayload.createdAt || new Date()
      };

      await db.collection('alert_center_logs').insertOne(logDoc);
      return true;
    } catch (err) {
      logError(err, { scope: 'recordAlertCenterLog' });
      return false;
    }
  }
  return fallbackDisabledError('recordAlertCenterLog:fallback');
}

async function getFailureReportSchedulerStatus(orgId) {
  const normalizedOrgId = normalizeOrgId(orgId);

  if (useMongo()) {
    try {
      const uiConfig = await getUiConfigForEntity(normalizedOrgId);
      const reportConfig = uiConfig?.notifications?.failureEmailReports || {};
      const enabled = reportConfig.enabled === true;
      const intervalMinutes = await getSchedulerIntervalMinutes();

      const db = await mongodb.getDbSafe();
      const state = await db.collection('scheduler_state').findOne({ _id: 'failure_email_reports' });
      const lastLog = normalizedOrgId
        ? await db.collection('alert_center_logs')
          .find(addOrgScope({ type: 'DELIVERY_FAILURE_REPORT' }, normalizedOrgId))
          .sort({ createdAt: -1 })
          .limit(1)
          .toArray()
        : [];
      const lastRunLog = lastLog?.[0] || null;
      const lastRunAt = state?.lastRunAt || null;
      const nextRunAt = enabled
        ? new Date((lastRunAt ? new Date(lastRunAt).getTime() : Date.now()) + intervalMinutes * 60 * 1000)
        : null;

      return {
        enabled,
        intervalMinutes,
        lookbackMinutes: Number(reportConfig.lookbackMinutes ?? 60),
        minFailures: Number(reportConfig.minFailures ?? 1),
        maxItems: Number(reportConfig.maxItems ?? 25),
        lastRunAt,
        nextRunAt,
        lastRunLog: lastRunLog ? {
          status: lastRunLog.status,
          createdAt: lastRunLog.createdAt,
          totalFailures: lastRunLog.totalFailures ?? null,
          recipients: lastRunLog.recipients || [],
          errorMessage: lastRunLog.errorMessage || null
        } : null
      };
    } catch (err) {
      logError(err, { scope: 'getFailureReportSchedulerStatus' });
      throw err;
    }
  }
  return fallbackDisabledError('getFailureReportSchedulerStatus:fallback');
}

async function getLogById(orgId, id) {
  const normalizedOrgId = normalizeOrgId(orgId);
  if (!normalizedOrgId) return undefined;

  if (useMongo()) {
    try {
      const db = await mongodb.getDbSafe();
      const log = await db.collection('execution_logs').findOne({
        _id: mongodb.toObjectId(id),
        ...buildOrgScopeQuery(normalizedOrgId)
      });

      if (!log) return undefined;

      const mappedLog = mapLogFromMongo(log);

      // Fetch integration config for enhanced UI (curl command generation)
      try {
        if (mappedLog.__KEEP___KEEP_integrationConfig__Id__) {
          const integration = await db.collection('integration_configs').findOne({
            _id: mongodb.toObjectId(mappedLog.__KEEP___KEEP_integrationConfig__Id__)
          });
          if (integration) {
            mappedLog.__KEEP_integrationConfig__ = mapIntegrationFromMongo(integration);
          }
        }
      } catch (integrationErr) {
        log('warn', 'Failed to fetch integration config', {
          logId: id,
          error: integrationErr.message
        });
      }

      // Fetch detailed retry attempts for enhanced UI
      try {
        const attempts = await db.collection('delivery_attempts')
          .find({
            deliveryLogId: id,
            ...buildOrgScopeQuery(normalizedOrgId)
          })
          .sort({ attemptNumber: 1 })
          .toArray();

        if (attempts && attempts.length > 0) {
          mappedLog.retryAttempts = attempts.map(attempt => ({
            attemptNumber: attempt.attemptNumber,
            status: attempt.status,
            responseStatus: attempt.responseStatus,
            responseBody: attempt.responseBody,
            responseTimeMs: attempt.responseTimeMs,
            errorMessage: attempt.errorMessage,
            requestPayload: attempt.requestPayload,
            requestHeaders: attempt.requestHeaders,
            targetUrl: attempt.targetUrl,
            httpMethod: attempt.httpMethod,
            attemptedAt: attempt.attemptedAt?.toISOString(),
            retryReason: attempt.retryReason
          }));
        }
      } catch (attemptErr) {
        log('warn', 'Failed to fetch retry attempts', {
          logId: id,
          error: attemptErr.message
        });
        mappedLog.retryAttempts = [];
      }

      return mappedLog;
    } catch (err) {
      logError(err, { scope: 'getLogById', id });
    }
  }
  return fallbackDisabledError('getLogById:fallback');
}

async function recordLog(orgId, logPayload) {
  const normalizedOrgId = normalizeOrgId(orgId);
  if (!normalizedOrgId) {
    throw new Error('orgId is required');
  }

  if (useMongo()) {
    try {
      const db = await mongodb.getDbSafe();
      const errorCategory = logPayload.errorCategory || logPayload.error?.category || null;
      const integrationConfigId = logPayload.__KEEP___KEEP_integrationConfig__Id__ || logPayload.integrationConfigId || logPayload.webhookConfigId;

      // Normalize status to uppercase for consistency
      const normalizeStatus = (status) => {
        if (!status) return 'PENDING';
        const statusMap = {
          'SUCCESS': 'SUCCESS',
          'FAILED': 'FAILED',
          'PENDING': 'PENDING',
          'RETRYING': 'RETRYING',
          'ABANDONED': 'ABANDONED',
          'SKIPPED': 'SKIPPED'
        };
        return statusMap[status.toUpperCase()] || status.toUpperCase();
      };

      // Extract searchable patient data from requestPayload for fast text search
      const requestPayload = logPayload.requestPayload || {};
      const payloadData = requestPayload.d?.[0] || {};
      const profileData = payloadData.profileData || {};
      const evtData = payloadData.evtData || {};

      const searchableText = [
        payloadData.identity,
        profileData.Name,
        profileData.Phone,
        profileData.MRN,
        evtData['Patient Name'],
        evtData['MRN']
      ].filter(Boolean).join(' ');

      // If an existing log ID is provided (retries or execution logger), update instead of inserting a new document
      // The ID can be either a MongoDB ObjectId (for retries) or a traceId string (from execution logger)
      let existingLogId = null;
      let queryField = '_id';
      if (logPayload.id) {
        // If id is a valid ObjectId, update by _id; otherwise treat it as traceId.
        // This supports req_* correlation IDs in addition to trc_* IDs.
        const asObjectId = mongodb.toObjectId(logPayload.id);
        if (asObjectId) {
          existingLogId = asObjectId;
          queryField = '_id';
        } else if (typeof logPayload.id === 'string') {
          existingLogId = logPayload.id;
          queryField = 'traceId';
        }
      }
      const __KEEP___KEEP_integrationConfig__Id__Obj = mongodb.toObjectId(integrationConfigId);
      if (existingLogId) {
        const attemptCount = logPayload.attemptCount || 1;

        // Fetch integration config to populate missing fields
        let integrationName = logPayload.__KEEP_integrationName__ || logPayload.integrationName || logPayload.webhookName;
        let eventType = logPayload.eventType;

        if ((!integrationName || !eventType) && __KEEP___KEEP_integrationConfig__Id__Obj) {
          try {
            const integrationConfig = await db.collection('integration_configs').findOne({
              _id: __KEEP___KEEP_integrationConfig__Id__Obj
            });
            if (integrationConfig) {
              integrationName = integrationName || integrationConfig.name;
              eventType = eventType || integrationConfig.eventType;
            }
          } catch (err) {
            // If integration config fetch fails, continue with null values
            log('warn', 'Failed to fetch integration config for log update', {
              integrationConfigId: __KEEP___KEEP_integrationConfig__Id__Obj?.toString(),
              error: err.message
            });
          }
        }

        const updateDoc = {
          eventId: logPayload.eventId || null,
          status: normalizeStatus(logPayload.status),
          'response.statusCode': logPayload.responseStatus,
          'response.body': logPayload.responseBody || null,
          responseStatus: logPayload.responseStatus,
          responseBody: logPayload.responseBody || null,
          responseTimeMs: logPayload.responseTimeMs || null,
          attemptCount,
          deliveredAt: logPayload.deliveredAt || null,
          finishedAt: logPayload.deliveredAt || null,
          errorMessage: logPayload.errorMessage || null,
          errorCategory,
          error: logPayload.error || ((logPayload.errorMessage || errorCategory) ? { message: logPayload.errorMessage || null, category: errorCategory } : null),
          originalPayload: logPayload.originalPayload || {},
          requestPayload: logPayload.requestPayload || {},
          'request.body': logPayload.requestPayload || {},
          webhookName: integrationName || null,
          __KEEP_integrationName__: integrationName || null,
          webhookConfigId: __KEEP___KEEP_integrationConfig__Id__Obj || integrationConfigId || null,
          transformedPayload: logPayload.requestPayload || {},
          orgUnitRid: logPayload.orgUnitRid || logPayload.entityRid || normalizedOrgId,
          targetUrl: logPayload.targetUrl,
          httpMethod: logPayload.httpMethod,
          'request.url': logPayload.targetUrl,
          'request.method': logPayload.httpMethod,
          correlationId: logPayload.correlationId || null,
          traceId: logPayload.traceId || logPayload.correlationId || null,
          'request.headers': logPayload.requestHeaders || {},
          requestHeaders: logPayload.requestHeaders || null,
          shouldRetry: logPayload.shouldRetry || false,
          integrationConfigId: __KEEP___KEEP_integrationConfig__Id__Obj || integrationConfigId || null,
          __KEEP___KEEP_integrationConfig__Id__: __KEEP___KEEP_integrationConfig__Id__Obj || integrationConfigId || null,
          searchableText,
          lastAttemptAt: new Date(),
          updatedAt: new Date()
        };

        if (logPayload.direction) {
          updateDoc.direction = logPayload.direction;
        }
        if (logPayload.triggerType) {
          updateDoc.triggerType = logPayload.triggerType;
        }
        // Set eventType from logPayload or fetched integration config
        if (eventType) {
          updateDoc.eventType = eventType;
          updateDoc.integrationType = eventType;
        }
        if (logPayload.actionName !== undefined) {
          updateDoc.actionName = logPayload.actionName;
        }
        if (logPayload.actionIndex !== undefined) {
          updateDoc.actionIndex = logPayload.actionIndex;
        }

        const updateQuery = queryField === 'traceId'
          ? { traceId: existingLogId, orgId: normalizedOrgId }
          : { _id: existingLogId, orgId: normalizedOrgId };

        const updateResult = await db.collection('execution_logs').updateOne(
          updateQuery,
          { $set: updateDoc }
        );

        // If the document was not found (edge case), fall back to insert
        if (updateResult.matchedCount === 0) {
            log('warn', 'Existing log not found for update, inserting new log', {
              logId: logPayload.id,
            orgId: normalizedOrgId
          });
        } else {
          // Record attempt details for retries
          if (logPayload.attemptDetails) {
            const attemptDoc = {
              deliveryLogId: existingLogId.toString(),
              orgId: normalizedOrgId,
              __KEEP___KEEP_integrationConfig__Id__: logPayload.__KEEP___KEEP_integrationConfig__Id__,
              attemptNumber: logPayload.attemptDetails.attemptNumber || attemptCount,
              status: normalizeStatus(logPayload.status),
              responseStatus: logPayload.responseStatus,
              responseBody: logPayload.responseBody || null,
              responseTimeMs: logPayload.responseTimeMs || null,
              errorMessage: logPayload.errorMessage || null,
              requestPayload: logPayload.requestPayload || {},
              requestHeaders: logPayload.attemptDetails.requestHeaders || {},
              targetUrl: logPayload.attemptDetails.targetUrl,
              httpMethod: logPayload.attemptDetails.httpMethod || 'POST',
              attemptedAt: logPayload.createdAt || new Date(),
              retryReason: logPayload.attemptDetails.retryReason || null
            };

            await db.collection('delivery_attempts').insertOne(attemptDoc);
          }

          return existingLogId.toString();
        }
      }

      // Fetch integration config to populate missing fields
      let integrationName = logPayload.__KEEP_integrationName__ || logPayload.integrationName || logPayload.webhookName;
      let eventType = logPayload.eventType;

      if ((!integrationName || !eventType) && __KEEP___KEEP_integrationConfig__Id__Obj) {
        try {
          const integrationConfig = await db.collection('integration_configs').findOne({
            _id: __KEEP___KEEP_integrationConfig__Id__Obj
          });
          if (integrationConfig) {
            integrationName = integrationName || integrationConfig.name;
            eventType = eventType || integrationConfig.eventType;
          }
        } catch (err) {
          // If integration config fetch fails, continue with null values
          log('warn', 'Failed to fetch integration config for log', {
            integrationConfigId: __KEEP___KEEP_integrationConfig__Id__Obj?.toString(),
            error: err.message
          });
        }
      }

      // Insert new execution log
      const logDoc = {
        traceId: logPayload.traceId || logPayload.correlationId || `trc_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
        messageId: logPayload.messageId || null,
        orgId: normalizedOrgId,
        orgUnitRid: logPayload.orgUnitRid || logPayload.entityRid || normalizedOrgId,
        webhookName: integrationName || null,
          webhookConfigId: __KEEP___KEEP_integrationConfig__Id__Obj || integrationConfigId || null,
        transformedPayload: logPayload.requestPayload || {},
        direction: logPayload.direction || 'OUTBOUND',
        triggerType: logPayload.triggerType || 'EVENT',
          integrationConfigId: __KEEP___KEEP_integrationConfig__Id__Obj || integrationConfigId || null,
          __KEEP___KEEP_integrationConfig__Id__: __KEEP___KEEP_integrationConfig__Id__Obj || integrationConfigId || null,
        __KEEP_integrationName__: integrationName,
        eventId: logPayload.eventId || null,
        eventType: eventType,
        actionName: logPayload.actionName || null,
        actionIndex: Number.isFinite(logPayload.actionIndex) ? logPayload.actionIndex : null,
        status: normalizeStatus(logPayload.status),
        responseStatus: logPayload.responseStatus,
        responseBody: logPayload.responseBody || null,
        responseTimeMs: logPayload.responseTimeMs || null,
        attemptCount: logPayload.attemptCount || 1,
        shouldRetry: logPayload.shouldRetry || false,
        lastAttemptAt: new Date(),
        startedAt: logPayload.createdAt || new Date(),
        finishedAt: logPayload.deliveredAt || null,
        deliveredAt: logPayload.deliveredAt || null,
        durationMs: logPayload.responseTimeMs || null,
        errorMessage: logPayload.errorMessage || null,
        errorCategory,
        error: logPayload.error || ((logPayload.errorMessage || errorCategory) ? { message: logPayload.errorMessage || null, category: errorCategory } : null),
        originalPayload: logPayload.originalPayload || {},
        requestPayload: logPayload.requestPayload || {},
        targetUrl: logPayload.targetUrl,
        httpMethod: logPayload.httpMethod,
        correlationId: logPayload.correlationId || null,
        requestHeaders: logPayload.requestHeaders || null,
        searchableText,
        request: {
          url: logPayload.targetUrl,
          method: logPayload.httpMethod,
          headers: logPayload.requestHeaders || {},
          body: logPayload.requestPayload || {}
        },
        response: {
          statusCode: logPayload.responseStatus,
          headers: {},
          body: logPayload.responseBody || {}
        },
        steps: [],
        metadata: {},
        createdAt: logPayload.createdAt || new Date(),
        updatedAt: new Date()
      };

      const result = await db.collection('execution_logs').insertOne(logDoc);

      // Record detailed attempt information for enhanced UI
      if (logPayload.attemptDetails) {
        const attemptDoc = {
          deliveryLogId: result.insertedId.toString(),
          orgId: normalizedOrgId,
          __KEEP___KEEP_integrationConfig__Id__: logPayload.__KEEP___KEEP_integrationConfig__Id__,
          attemptNumber: logPayload.attemptDetails.attemptNumber || 1,
          status: logPayload.status,
          responseStatus: logPayload.responseStatus,
          responseBody: logPayload.responseBody || null,
          responseTimeMs: logPayload.responseTimeMs || null,
          errorMessage: logPayload.errorMessage || null,
          requestPayload: logPayload.requestPayload || {},
          requestHeaders: logPayload.attemptDetails.requestHeaders || {},
          targetUrl: logPayload.attemptDetails.targetUrl,
          httpMethod: logPayload.attemptDetails.httpMethod || 'POST',
          attemptedAt: logPayload.createdAt || new Date(),
          retryReason: logPayload.attemptDetails.retryReason || null
        };

        await db.collection('delivery_attempts').insertOne(attemptDoc);
      }

      return result.insertedId.toString();
    } catch (err) {
      logError(err, { scope: 'recordLog' });
    }
  }
  return fallbackDisabledError('recordLog:fallback');
}

async function getDashboardSummary(orgId) {
  if (useMongo()) {
    try {
      const db = await mongodb.getDbSafe();
      const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

      // Use aggregation pipeline for efficient stats
      const stats = await db.collection('execution_logs').aggregate([
        {
          $match: {
            orgId,
            createdAt: { $gte: last24h }
          }
        },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            successful: {
              $sum: { $cond: [{ $eq: ['$status', 'SUCCESS'] }, 1, 0] }
            },
            failed: {
              $sum: { $cond: [{ $in: ['$status', ['FAILED', 'ABANDONED', 'SKIPPED']] }, 1, 0] }
            },
            avgResponseTime: { $avg: '$responseTimeMs' }
          }
        }
      ]).toArray();

      const result = stats[0] || {
        total: 0,
        successful: 0,
        failed: 0,
        avgResponseTime: 0
      };

      // Get integration health
      const integrations = await listIntegrations(orgId);
      const integrationHealth = integrations.slice(0, 5).map((wh) => ({
        id: wh.id,
        name: wh.name,
        status: wh.isActive ? 'GREEN' : 'RED',
        failureCount24h: 0 // Will be calculated from logs if needed
      }));

      // Get recent failures
      const recentFailures = await db.collection('execution_logs')
        .find({
          orgId,
          status: { $nin: ['SUCCESS', 'PENDING'] }
        })
        .sort({ createdAt: -1 })
        .limit(5)
        .toArray();

      return {
        totalDeliveries24h: result.total,
        successRate24h: result.total > 0
          ? Number(((result.successful / result.total) * 100).toFixed(1))
          : 100,
        failedCount24h: result.failed,
        avgResponseTimeMs24h: Math.round(result.avgResponseTime || 0),
        integrationHealth,
        recentFailures: recentFailures.map(mapLogFromMongo)
      };
    } catch (err) {
      logError(err, { scope: 'dashboardSummary' });
    }
  }
  return fallbackDisabledError('getDashboardSummary:fallback');
}

function mapOrgUnitDoc(doc) {
  if (!doc) return null;
  return {
    rid: doc.rid,
    name: doc.name || `ENT-${doc.rid}`,
    code: doc.code || `ENT-${doc.rid}`,
    email: doc.email || null,
    phone: doc.phone || null,
    address: doc.address || null,
    tags: Array.isArray(doc.tags) ? doc.tags : [],
    region: doc.region || 'default',
    timezone: doc.timezone || 'UTC'
  };
}

function mapOrganizationToTenant(orgDoc, units = []) {
  return {
    orgId: orgDoc.orgId,
    tenantName: orgDoc.name || `Org ${orgDoc.orgId}`,
    tenantCode: orgDoc.code || `ORG-${orgDoc.orgId}`,
    tenantEmail: orgDoc.email || null,
    tenantPhone: orgDoc.phone || null,
    tenantAddress: orgDoc.address || null,
    tenantTags: Array.isArray(orgDoc.tags) ? orgDoc.tags : [],
    region: orgDoc.region || 'default',
    timezone: orgDoc.timezone || 'UTC',
    childEntities: units.map(mapOrgUnitDoc).filter(Boolean)
  };
}

async function listOrgUnitsByOrgId(orgId) {
  const dbClient = await mongodb.getDbSafe();
  return dbClient.collection('org_units').find({ orgId }).sort({ rid: 1 }).toArray();
}

async function getTenant(orgId) {
  if (useMongo()) {
    try {
      const dbClient = await mongodb.getDbSafe();

      const org = await dbClient.collection('organizations').findOne({ orgId });
      if (org) {
        const units = await listOrgUnitsByOrgId(orgId);
        return mapOrganizationToTenant(org, units);
      }

      const unit = await dbClient.collection('org_units').findOne({ rid: orgId });
      if (unit) {
        return {
          orgId: unit.rid,
          tenantName: unit.name || `ENT-${unit.rid}`,
          tenantCode: unit.code || `ENT-${unit.rid}`,
          tenantEmail: unit.email || null,
          tenantPhone: unit.phone || null,
          tenantAddress: unit.address || null,
          tenantTags: Array.isArray(unit.tags) ? unit.tags : [],
          region: unit.region || 'default',
          timezone: unit.timezone || 'UTC',
          childEntities: []
        };
      }
    } catch (err) {
      logError(err, { scope: 'getTenant:mongo', orgId });
      throw err;
    }
    return null;
  }

  return fallbackDisabledError('getTenant:mongo');
}

async function getPendingEvents(limit = 5) {
  // This reads from MySQL event source table (configured via adapter)
  if (useMysql()) {
    try {
      const checkpoint = await getWorkerCheckpoint();
      const maxEventAgeDays = Number(config.worker?.maxEventAgeDays ?? 0);
      const cutoff = maxEventAgeDays > 0
        ? new Date(Date.now() - maxEventAgeDays * 24 * 60 * 60 * 1000)
        : null;
      const allowedParents = await getAllowedParentRids();

      if (Array.isArray(allowedParents) && allowedParents.length === 0) {
        log('info', 'No active parent entities configured; skipping event poll');
        return [];
      }

      // Do not filter by STATUS; other services may mutate it after insert, which would
      // cause us to skip records. We rely on monotonic id ordering instead.
      const whereParts = ['id > :lastId'];
      const params = { lastId: checkpoint };

      if (cutoff) {
        whereParts.push('created_at >= :cutoff');
        // Convert Date to MySQL datetime format (YYYY-MM-DD HH:MM:SS)
        // MySQL doesn't handle ISO 8601 timestamps with timezone well
        params.cutoff = cutoff.toISOString().slice(0, 19).replace('T', ' ');
      }

      if (Array.isArray(allowedParents)) {
        const parentParams = allowedParents.map((_, index) => `:parent${index}`);
        whereParts.push(`entity_parent_rid IN (${parentParams.join(', ')})`);
        allowedParents.forEach((parentRid, index) => {
          params[`parent${index}`] = parentRid;
        });
      }

      const query = `SELECT id, entity_rid, entity_parent_rid, transaction_type, message, created_at FROM notification_queue WHERE ${whereParts.join(' AND ')} ORDER BY id ASC LIMIT ${limit}`;

      log('debug', 'Querying notification_queue for pending events', {
        query,
        params
      });

      const [rows] = await db.query(query, params);

      log('debug', 'Pending events query result', {
        rowsFound: rows.length,
        limit
      });

      return rows.map((row) => {
        const eventType = row.transaction_type || row.event_type;
        return {
          id: row.id,
          orgUnitRid: row.entity_rid,
          orgId: row.entity_parent_rid,      // Renamed from entity_parent_rid
          event_type: eventType,
          // Stable idempotency key for all event sources (MySQL, Kafka, SQS)
          eventId: `${row.entity_parent_rid}-${eventType}-${row.id}`,
          created_at: row.created_at,
          payload: (() => {
            const rawPayload = row.message ?? row.payload;
            if (typeof rawPayload === 'string') {
              try {
                return JSON.parse(rawPayload || '{}');
              } catch (err) {
                log('warn', 'Failed to parse event payload JSON', {
                  error: err.message,
                  rowId: row.id
                });
                return {};
              }
            }
            return rawPayload ?? {};
          })()
        };
      });
    } catch (err) {
      logError(err, { scope: 'getPendingEvents' });
      throw err;
    }
  }

  return fallbackDisabledError('getPendingEvents:fallback');
}

async function markEventComplete(id, status = 'COMPLETED', errorMessage) {
  if (useMysql()) {
    // No-op for DB mode to keep notification_queue untouched (read-only for other apps).
    return true;
  }
  return true;
}

function cryptoRandom() {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 16);
}

async function getMaxNotificationQueueId() {
  if (!useMysql()) {
    return fallbackDisabledError('getMaxNotificationQueueId:mysql');
  }
  const [rows] = await db.query('SELECT MAX(id) AS maxId FROM notification_queue');
  return rows && rows[0] && rows[0].maxId ? Number(rows[0].maxId) : 0;
}

async function getWorkerCheckpoint() {
  if (useMongo()) {
    try {
      const db = await mongodb.getDbSafe();
      const checkpoint = await db.collection('worker_checkpoint')
        .findOne({ workerId: 'main_worker' });
      if (!checkpoint && config.worker?.bootstrapCheckpoint) {
        const maxId = await getMaxNotificationQueueId();
        await setWorkerCheckpoint(maxId);
        log('info', 'Bootstrapped worker checkpoint to latest notification_queue id', {
          maxId
        });
        return maxId;
      }
      return checkpoint?.lastProcessedId || 0;
    } catch (err) {
      logError(err, { scope: 'getWorkerCheckpoint' });
      throw err;
    }
  }
  return fallbackDisabledError('getWorkerCheckpoint:fallback');
}

async function setWorkerCheckpoint(lastProcessedId) {
  if (useMongo()) {
    try {
      const db = await mongodb.getDbSafe();
      await db.collection('worker_checkpoint').updateOne(
        { workerId: 'main_worker' },
        {
          $set: {
            lastProcessedId,
            updatedAt: new Date()
          }
        },
        { upsert: true }
      );
      return;
    } catch (err) {
      logError(err, { scope: 'setWorkerCheckpoint' });
    }
  }
  return fallbackDisabledError('setWorkerCheckpoint:fallback');
}

// New functions for retry logic
async function getFailedLogsForRetry(batchSize = 3) {
  try {
    if (useMongo()) {
      const db = await mongodb.getDbSafe();
      const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000);

      const logs = await db.collection('execution_logs')
        .find({
          status: 'RETRYING', // Only retry logs explicitly marked as RETRYING
          triggerType: { $ne: 'SCHEDULED' },
          $or: [
            { lastAttemptAt: { $gt: fourHoursAgo } }, // New logs with lastAttemptAt
            { lastAttemptAt: { $exists: false }, updatedAt: { $gt: fourHoursAgo } }, // Backward compat: old logs without lastAttemptAt
            { lastAttemptAt: { $exists: false }, updatedAt: { $exists: false }, createdAt: { $gt: fourHoursAgo } } // Very old logs
          ]
        })
        .sort({ lastAttemptAt: -1, updatedAt: -1, createdAt: 1 })
        .limit(batchSize)
        .toArray();

      // Filter logs where attemptCount < integration's retryCount
      const logsWithIntegrations = [];
      for (const log of logs) {
        const integrationId = log.__KEEP___KEEP_integrationConfig__Id__ || log.integrationConfigId;
        const integration = await getIntegration(integrationId);
        if (integration && log.attemptCount <= integration.retryCount) {
          logsWithIntegrations.push(mapLogFromMongo(log));
        }
      }
      return logsWithIntegrations;
    }
    return fallbackDisabledError('getFailedLogsForRetry:fallback');
  } catch (err) {
    logError(err, { scope: 'getFailedLogsForRetry' });
    throw err;
  }
}

// Bulk retry logs - Mark multiple failed logs for retry
async function bulkRetryLogs(orgId, ids) {
  if (useMongo()) {
    try {
      const db = await mongodb.getDbSafe();

      // Convert string IDs to ObjectIds and track failed conversions
      const objectIds = [];
      const failedIds = [];

      for (const id of ids) {
        try {
          objectIds.push(mongodb.toObjectId(id));
        } catch (err) {
          failedIds.push(id);
          log('warn', 'Invalid log ID in bulk retry', { id, error: err.message });
        }
      }

      if (objectIds.length === 0) {
        return { retriedCount: 0, failedIds };
      }

      // Only retry logs that are FAILED
      const result = await db.collection('execution_logs').updateMany(
        {
          _id: { $in: objectIds },
          orgId,
          status: 'FAILED'
        },
        {
          $set: {
            status: 'RETRYING',
            shouldRetry: true,
            lastAttemptAt: new Date(),
            updatedAt: new Date()
          }
        }
      );

      log('info', 'Bulk retry completed', {
        scope: 'bulkRetryLogs',
        requested: ids.length,
        retried: result.modifiedCount,
        failed: failedIds.length
      });

      return {
        retriedCount: result.modifiedCount,
        failedIds
      };
    } catch (err) {
      logError(err, { scope: 'bulkRetryLogs' });
      return { retriedCount: 0, failedIds: ids };
    }
  }

  return fallbackDisabledError('bulkRetryLogs:fallback');
}

// Bulk delete logs
async function bulkDeleteLogs(orgId, ids) {
  if (useMongo()) {
    try {
      const db = await mongodb.getDbSafe();

      // Convert string IDs to ObjectIds and track failed conversions
      const objectIds = [];
      const failedIds = [];

      for (const id of ids) {
        try {
          objectIds.push(mongodb.toObjectId(id));
        } catch (err) {
          failedIds.push(id);
          log('warn', 'Invalid log ID in bulk delete', { id, error: err.message });
        }
      }

      if (objectIds.length === 0) {
        return { deletedCount: 0, failedIds };
      }

      // Delete delivery logs
      const result = await db.collection('execution_logs').deleteMany({
        _id: { $in: objectIds },
        orgId
      });

      // Also delete associated delivery attempts
      await db.collection('delivery_attempts').deleteMany({
        deliveryLogId: { $in: ids },
        ...buildOrgScopeQuery(orgId)
      });

      log('info', 'Bulk delete completed', {
        scope: 'bulkDeleteLogs',
        requested: ids.length,
        deleted: result.deletedCount,
        failed: failedIds.length
      });

      return {
        deletedCount: result.deletedCount,
        failedIds
      };
    } catch (err) {
      logError(err, { scope: 'bulkDeleteLogs' });
      return { deletedCount: 0, failedIds: ids };
    }
  }

  return fallbackDisabledError('bulkDeleteLogs:fallback');
}

async function getIntegrationById(integrationId) {
  try {
    if (useMongo()) {
      const db = await mongodb.getDbSafe();
      const integration = await db.collection('integration_configs')
        .findOne({ _id: mongodb.toObjectId(integrationId) });
      return integration ? mapIntegrationFromMongo(integration) : null;
    }
    return fallbackDisabledError('getIntegrationById:fallback');
  } catch (err) {
    logError(err, { scope: 'getIntegrationById', integrationId });
    throw err;
  }
}

async function markLogAsAbandoned(logId) {
  try {
    if (useMongo()) {
      const db = await mongodb.getDbSafe();
      await db.collection('execution_logs').updateOne(
        { _id: mongodb.toObjectId(logId) },
        { $set: { status: 'ABANDONED', shouldRetry: false, updatedAt: new Date() } }
      );
    } else {
      return fallbackDisabledError('markLogAsAbandoned:fallback');
    }
    log('info', 'Log marked as abandoned', { logId });
  } catch (err) {
    logError(err, { scope: 'markLogAsAbandoned', logId });
    throw err;
  }
}

// Simple data cleanup function
async function cleanupOldData() {
  try {
    if (useMongo()) {
      // MongoDB handles cleanup automatically with TTL indexes
      // execution_logs: 90 days (7776000 seconds)
      // processed_events: 1 hour (3600 seconds)
      log('info', 'Data cleanup handled by MongoDB TTL indexes');
      return;
    }
    return fallbackDisabledError('cleanupOldData:fallback');
  } catch (err) {
    logError(err, { scope: 'cleanupOldData' });
    throw err;
  }
}

// Cleanup stuck RETRYING logs that are older than the retry window
async function cleanupStuckRetryingLogs(hoursThreshold = 4) {
  try {
    if (useMongo()) {
      const db = await mongodb.getDbSafe();
      const thresholdTime = new Date(Date.now() - hoursThreshold * 60 * 60 * 1000);

      // Find logs stuck in RETRYING status beyond the retry window
      const result = await db.collection('execution_logs').updateMany(
        {
          status: 'RETRYING',
          $or: [
            // Old logs with lastAttemptAt field
            { lastAttemptAt: { $lt: thresholdTime } },
            // Legacy logs without lastAttemptAt but with updatedAt
            { lastAttemptAt: { $exists: false }, updatedAt: { $lt: thresholdTime } },
            // Very old logs without either field
            { lastAttemptAt: { $exists: false }, updatedAt: { $exists: false }, createdAt: { $lt: thresholdTime } }
          ]
        },
        {
          $set: {
            status: 'ABANDONED',
            shouldRetry: false,
            errorMessage: `Exceeded ${hoursThreshold}-hour retry window - automatically abandoned`,
            updatedAt: new Date()
          }
        }
      );

      log('info', 'Cleaned up stuck RETRYING logs', {
        hoursThreshold,
        logsUpdated: result.modifiedCount
      });

      return {
        success: true,
        logsUpdated: result.modifiedCount,
        hoursThreshold
      };
    }
    return fallbackDisabledError('cleanupStuckRetryingLogs:fallback');
  } catch (err) {
    logError(err, { scope: 'cleanupStuckRetryingLogs' });
    throw err;
  }
}

// Template management functions (MongoDB-based)
async function listCustomTemplates(orgId) {
  const normalizedOrgId = normalizeOrgId(orgId);
  if (!normalizedOrgId) return [];

  if (useMongo()) {
    try {
      const collection = await getCollection('integration_templates');
      const templates = await collection.find(addOrgScope({}, normalizedOrgId))
        .sort({ updatedAt: -1 })
        .toArray();

      return templates.map(template => ({
        id: template._id.toString(),
        name: template.name,
        description: template.description,
        category: template.category,
        eventType: template.eventType,
        targetUrl: template.targetUrl,
        httpMethod: template.httpMethod,
        authType: template.authType,
        authConfig: template.authConfig || {},
        headers: template.headers || {},
        timeoutMs: template.timeoutMs,
        retryCount: template.retryCount,
        transformationMode: template.transformationMode,
        transformation: template.transformation || {},
        actions: template.actions || null,
        isActive: template.isActive !== false,
        metadata: template.metadata || {},
        createdAt: template.createdAt,
        updatedAt: template.updatedAt,
        isCustom: true
      }));
    } catch (err) {
      logError(err, { scope: 'listCustomTemplates' });
      return [];
    }
  }
  return [];
}

async function getCustomTemplate(orgId, templateId) {
  const normalizedOrgId = normalizeOrgId(orgId);
  if (!normalizedOrgId) return null;

  if (useMongo()) {
    try {
      const { ObjectId } = require('mongodb');
      const collection = await getCollection('integration_templates');

      const template = await collection.findOne(addOrgScope({
        _id: new ObjectId(templateId)
      }, normalizedOrgId));

      if (template) {
        return {
          id: template._id.toString(),
          name: template.name,
          description: template.description,
          category: template.category,
          eventType: template.eventType,
          targetUrl: template.targetUrl,
          httpMethod: template.httpMethod,
          authType: template.authType,
          authConfig: template.authConfig || {},
          headers: template.headers || {},
          timeoutMs: template.timeoutMs,
          retryCount: template.retryCount,
          transformationMode: template.transformationMode,
          transformation: template.transformation || {},
          actions: template.actions || null,
          isActive: template.isActive !== false,
          metadata: template.metadata || {},
          createdAt: template.createdAt,
          updatedAt: template.updatedAt,
          isCustom: true
        };
      }
    } catch (err) {
      logError(err, { scope: 'getCustomTemplate', templateId });
    }
  }
  return null;
}

async function createTemplate(orgId, template) {
  const normalizedOrgId = normalizeOrgId(orgId);
  if (!normalizedOrgId) {
    throw new Error('orgId is required');
  }

  if (useMongo()) {
    try {
      const collection = await getCollection('integration_templates');
      const now = new Date();

      const templateDoc = {
        orgId: normalizedOrgId,
        name: template.name,
        description: template.description,
        category: template.category,
        eventType: template.eventType,
        targetUrl: template.targetUrl,
        httpMethod: template.httpMethod,
        authType: template.authType,
        authConfig: template.authConfig || {},
        headers: template.headers || {},
        timeoutMs: template.timeoutMs,
        retryCount: template.retryCount,
        transformationMode: template.transformationMode,
        transformation: template.transformation || {},
        actions: template.actions || null,
        isActive: template.isActive !== false,
        metadata: template.metadata || {},
        createdAt: now,
        updatedAt: now
      };

      const result = await collection.insertOne(templateDoc);

      return {
        id: result.insertedId.toString(),
        ...template,
        isCustom: true,
        createdAt: now,
        updatedAt: now
      };
    } catch (err) {
      logError(err, { scope: 'createTemplate' });
      throw err;
    }
  }
  throw new Error('MongoDB not configured');
}

async function updateTemplate(orgId, templateId, updates) {
  const normalizedOrgId = normalizeOrgId(orgId);
  if (!normalizedOrgId) return null;

  if (useMongo()) {
    try {
      const { ObjectId } = require('mongodb');
      const collection = await getCollection('integration_templates');

      const updateDoc = {
        name: updates.name,
        description: updates.description,
        category: updates.category,
        eventType: updates.eventType,
        targetUrl: updates.targetUrl,
        httpMethod: updates.httpMethod,
        authType: updates.authType,
        authConfig: updates.authConfig || {},
        headers: updates.headers || {},
        timeoutMs: updates.timeoutMs,
        retryCount: updates.retryCount,
        transformationMode: updates.transformationMode,
        transformation: updates.transformation || {},
        actions: updates.actions || null,
        isActive: updates.isActive !== false,
        metadata: updates.metadata || {},
        updatedAt: new Date()
      };

      await collection.updateOne(
        addOrgScope({ _id: new ObjectId(templateId) }, normalizedOrgId),
        { $set: updateDoc }
      );

      return getCustomTemplate(normalizedOrgId, templateId);
    } catch (err) {
      logError(err, { scope: 'updateTemplate', templateId });
      throw err;
    }
  }
  throw new Error('MongoDB not configured');
}

async function deleteTemplate(orgId, templateId) {
  const normalizedOrgId = normalizeOrgId(orgId);
  if (!normalizedOrgId) return false;

  if (useMongo()) {
    try {
      const { ObjectId } = require('mongodb');
      const collection = await getCollection('integration_templates');

      const result = await collection.deleteOne(
        addOrgScope({ _id: new ObjectId(templateId) }, normalizedOrgId)
      );

      return result.deletedCount > 0;
    } catch (err) {
      logError(err, { scope: 'deleteTemplate', templateId });
      throw err;
    }
  }
  throw new Error('MongoDB not configured');
}

// ==========================================
// CIRCUIT BREAKER PATTERN
// ==========================================

/**
 * Check circuit breaker state for a integration
 * @param {string} integrationId - Integration configuration ID
 * @returns {Promise<{isOpen: boolean, state: string, reason: string}>}
 */
async function checkCircuitState(integrationId) {
  if (!useMongo()) {
    return { isOpen: false, state: 'CLOSED', reason: null };
  }

  try {
    const db = await mongodb.getDbSafe();
    const integration = await db.collection('integration_configs')
      .findOne({ _id: mongodb.toObjectId(integrationId) });

    if (!integration) {
      return { isOpen: false, state: 'CLOSED', reason: 'Integration not found' };
    }

    const circuitState = integration.circuitState || 'CLOSED';
    const consecutiveFailures = integration.consecutiveFailures || 0;
    const circuitBreakerThreshold = integration.circuitBreakerThreshold || 10;
    const circuitRecoveryTimeMs = integration.circuitRecoveryTimeMs || (5 * 60 * 1000); // 5 minutes
    const circuitOpenedAt = integration.circuitOpenedAt;

    // If circuit is OPEN, check if recovery time has passed
    if (circuitState === 'OPEN' && circuitOpenedAt) {
      const now = new Date();
      const timeSinceOpen = now - new Date(circuitOpenedAt);

      if (timeSinceOpen >= circuitRecoveryTimeMs) {
        // Try HALF_OPEN - allow one test request
        await db.collection('integration_configs').updateOne(
          { _id: mongodb.toObjectId(integrationId) },
          {
            $set: {
              circuitState: 'HALF_OPEN',
              updatedAt: now
            }
          }
        );
        log('info', 'Circuit breaker moved to HALF_OPEN', {
          integrationId,
          __KEEP_integrationName__: integration.name,
          timeSinceOpen: `${Math.round(timeSinceOpen / 1000)}s`
        });
        return { isOpen: false, state: 'HALF_OPEN', reason: 'Testing recovery' };
      }

      return {
        isOpen: true,
        state: 'OPEN',
        reason: `Circuit open after ${consecutiveFailures} consecutive failures. Retry in ${Math.round((circuitRecoveryTimeMs - timeSinceOpen) / 1000)}s`
      };
    }

    // Circuit is CLOSED or HALF_OPEN - allow delivery
    return { isOpen: false, state: circuitState, reason: null };
  } catch (err) {
    logError(err, { scope: 'checkCircuitState', integrationId });
    // On error, allow delivery (fail open)
    return { isOpen: false, state: 'UNKNOWN', reason: 'Circuit check failed' };
  }
}

/**
 * Record successful delivery - reset circuit breaker
 * @param {string} integrationId - Integration configuration ID
 */
async function recordDeliverySuccess(integrationId) {
  if (!useMongo()) return;

  try {
    const db = await mongodb.getDbSafe();
    const now = new Date();

    await db.collection('integration_configs').updateOne(
      { _id: mongodb.toObjectId(integrationId) },
      {
        $set: {
          circuitState: 'CLOSED',
          consecutiveFailures: 0,
          lastSuccessAt: now,
          circuitOpenedAt: null,
          updatedAt: now
        }
      }
    );

    log('debug', 'Circuit breaker reset to CLOSED', { integrationId });
  } catch (err) {
    logError(err, { scope: 'recordDeliverySuccess', integrationId });
  }
}

/**
 * Record failed delivery - increment circuit breaker counter
 * @param {string} integrationId - Integration configuration ID
 * @param {Object} options - Options for failure recording
 * @param {boolean} options.shouldTripCircuit - Whether this failure should count toward circuit breaker (default: true for backward compatibility)
 */
async function recordDeliveryFailure(integrationId, options = {}) {
  if (!useMongo()) return;

  const { shouldTripCircuit = true } = options;

  // If this is a business logic failure (validation, transformation, 4xx), don't trip circuit breaker
  if (!shouldTripCircuit) {
    log('debug', 'Failure recorded but not counting toward circuit breaker (business logic failure)', {
      integrationId
    });
    return;
  }

  try {
    const db = await mongodb.getDbSafe();
    const integration = await db.collection('integration_configs')
      .findOne({ _id: mongodb.toObjectId(integrationId) });

    if (!integration) return;

    const now = new Date();
    const currentFailures = integration.consecutiveFailures || 0;
    const newFailures = currentFailures + 1;
    const circuitBreakerThreshold = integration.circuitBreakerThreshold || 10;
    const currentState = integration.circuitState || 'CLOSED';

    // Determine new circuit state
    let newState = currentState;
    let circuitOpenedAt = integration.circuitOpenedAt;

    if (currentState === 'HALF_OPEN') {
      // Failed during HALF_OPEN test - reopen circuit
      newState = 'OPEN';
      circuitOpenedAt = now;
      log('warn', 'Circuit breaker reopened after HALF_OPEN test failure', {
        integrationId,
        __KEEP_integrationName__: integration.name,
        consecutiveFailures: newFailures
      });
    } else if (newFailures >= circuitBreakerThreshold && currentState === 'CLOSED') {
      // Threshold reached - open circuit
      newState = 'OPEN';
      circuitOpenedAt = now;
      log('warn', 'Circuit breaker OPENED', {
        integrationId,
        __KEEP_integrationName__: integration.name,
        consecutiveFailures: newFailures,
        threshold: circuitBreakerThreshold
      });
    }

    await db.collection('integration_configs').updateOne(
      { _id: mongodb.toObjectId(integrationId) },
      {
        $set: {
          circuitState: newState,
          consecutiveFailures: newFailures,
          lastFailureAt: now,
          circuitOpenedAt,
          updatedAt: now
        }
      }
    );

    log('debug', 'Circuit breaker failure recorded', {
      integrationId,
      __KEEP_integrationName__: integration.name,
      consecutiveFailures: newFailures,
      circuitState: newState
    });
  } catch (err) {
    logError(err, { scope: 'recordDeliveryFailure', integrationId });
  }
}

// ==========================================
// SCHEDULED WEBHOOKS (Delayed/Recurring)
// ==========================================

/**
 * Create a scheduled integration
 * @param {Object} data - Scheduled integration data
 * @returns {Promise<Object>} Created scheduled integration
 */
async function createScheduledIntegration(data) {
  if (!useMongo()) {
    throw new Error('MongoDB required for scheduled integrations');
  }

  try {
    const db = await mongodb.getDbSafe();
    const now = new Date();
    const integrationConfigId = data.__KEEP___KEEP_integrationConfig__Id__ || data.integrationConfigId || data.webhookConfigId;
    const integrationName = data.__KEEP_integrationName__ || data.integrationName || data.webhookName;
    const orgId = normalizeOrgId(data.orgId || data.orgUnitRid || data.entityRid);
    if (!orgId) throw new Error('orgId is required for scheduled integration');
    const integrationConfigObjectId = mongodb.toObjectId(integrationConfigId) || integrationConfigId;

    const scheduledForDate = new Date(data.scheduledFor);
    const status = scheduledForDate <= now ? 'OVERDUE' : 'PENDING';

    const scheduledIntegration = {
      __KEEP___KEEP_integrationConfig__Id__: integrationConfigObjectId,
      __KEEP_integrationName__: integrationName,
      integrationConfigId: integrationConfigObjectId,
      integrationName,
      webhookConfigId: integrationConfigObjectId,
      webhookName: integrationName,
      orgId,
      orgUnitRid: data.orgUnitRid || data.entityRid || orgId,
      originalEventId: data.originalEventId,
      eventType: data.eventType,
      scheduledFor: scheduledForDate, // Unix timestamp to Date
      status, // PENDING | SENT | FAILED | CANCELLED | OVERDUE
      payload: data.payload, // Pre-transformed payload ready to send
      originalPayload: data.originalPayload || data.payload, // CRITICAL: Store original payload for recurring integrations
      targetUrl: data.targetUrl,
      httpMethod: data.httpMethod,
      // Cancellation matching metadata
      cancellationInfo: data.cancellationInfo || null, // { patientRid, scheduledDateTime, ... }
      // Recurring integration metadata
      recurringConfig: data.recurringConfig || null, // { interval, count, endDate, occurrenceNumber }
      createdAt: now,
      updatedAt: now
    };

    const result = await db.collection('scheduled_integrations').insertOne(scheduledIntegration);
    scheduledIntegration._id = result.insertedId;

    log('info', 'Scheduled integration created', {
      id: result.insertedId.toString(),
      __KEEP_integrationName__: integrationName,
      scheduledFor: data.scheduledFor,
      eventType: data.eventType
    });

    return {
      id: result.insertedId.toString(),
      ...scheduledIntegration,
      scheduledFor: scheduledIntegration.scheduledFor.toISOString(),
      orgId: scheduledIntegration.orgId,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString()
    };
  } catch (err) {
    logError(err, { scope: 'createScheduledIntegration' });
    throw err;
  }
}

/**
 * List scheduled integrations with filters
 * @param {number} orgId - Entity parent RID
 * @param {Object} filters - Filter options
 * @returns {Promise<Array>} List of scheduled integrations
 */
async function listScheduledIntegrations(orgId, filters = {}) {
  const normalizedOrgId = normalizeOrgId(orgId);
  if (!normalizedOrgId) return [];

  if (useMongo()) {
    try {
      const db = await mongodb.getDbSafe();
      const query = scheduledOrgQuery(normalizedOrgId);

      if (filters.status) {
        query.status = filters.status;
      }
      if (filters.integrationConfigId || filters.__KEEP___KEEP_integrationConfig__Id__ || filters.webhookConfigId) {
        query.__KEEP___KEEP_integrationConfig__Id__ = mongodb.toObjectId(
          filters.integrationConfigId || filters.__KEEP___KEEP_integrationConfig__Id__ || filters.webhookConfigId
        );
      }
      if (filters.eventType) {
        query.eventType = filters.eventType;
      }

      // Add a time-based filter to only show upcoming or recently overdue events
      // Avoids loading the entire collection
      const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
      query.scheduledFor = { $gte: twoDaysAgo };

      const limit = filters.limit || 500;

      const integrations = await db.collection('scheduled_integrations')
        .find(query)
        .sort({ scheduledFor: 1 })
        .limit(limit)
        .toArray();

      return integrations.map(mapScheduledIntegrationFromMongo);
    } catch (err) {
      logError(err, { scope: 'listScheduledIntegrations', orgId, filters });
      throw err;
    }
  }
  return fallbackDisabledError('listScheduledIntegrations:fallback');
}

/**
 * Get pending scheduled integrations ready to be sent
 * @param {number} limit - Max number to fetch
 * @returns {Promise<Array>} Integrations ready to send
 */
async function getPendingScheduledIntegrations(limit = 10) {
  if (!useMongo()) {
    return [];
  }

  try {
    const db = await mongodb.getDbSafe();
    const now = new Date();
    const claimedIntegrations = [];

    // ATOMIC CLAIM: Use findOneAndUpdate to atomically claim each integration
    // This prevents race conditions where multiple worker cycles process the same integration
    for (let i = 0; i < limit; i++) {
      const result = await db.collection('scheduled_integrations')
        .findOneAndUpdate(
          {
            status: { $in: ['PENDING', 'OVERDUE'] },
            scheduledFor: { $lte: now }
          },
          {
            $set: {
              status: 'PROCESSING',
              processingStartedAt: new Date(),
              updatedAt: new Date()
            }
          },
          {
            sort: { scheduledFor: 1 },
            returnDocument: 'after'
          }
        );

      // No more pending integrations found
      // MongoDB findOneAndUpdate returns {value: document} structure
      if (!result || !result.value) {
        break;
      }

      const doc = result.value;
      claimedIntegrations.push({
        id: doc._id.toString(),
        integrationConfigId: doc.integrationConfigId?.toString() || doc.__KEEP___KEEP_integrationConfig__Id__?.toString(),
        webhookConfigId: doc.webhookConfigId?.toString?.() || doc.integrationConfigId?.toString() || doc.__KEEP___KEEP_integrationConfig__Id__?.toString(),
        __KEEP___KEEP_integrationConfig__Id__: doc.__KEEP___KEEP_integrationConfig__Id__?.toString() || doc.integrationConfigId?.toString(),
        integrationName: doc.integrationName || doc.__KEEP_integrationName__,
        webhookName: doc.webhookName || doc.integrationName || doc.__KEEP_integrationName__,
        __KEEP_integrationName__: doc.__KEEP_integrationName__,
        orgId: doc.orgId || doc.entityRid,
        orgUnitRid: doc.orgUnitRid || doc.entityRid || doc.orgId,
        originalEventId: doc.originalEventId,
        eventType: doc.eventType,
        scheduledFor: doc.scheduledFor.toISOString(),
        status: doc.status,
        payload: doc.payload,
        originalPayload: doc.originalPayload,
        targetUrl: doc.targetUrl,
        httpMethod: doc.httpMethod,
        recurringConfig: doc.recurringConfig,
        cancellationInfo: doc.cancellationInfo,
        createdAt: doc.createdAt?.toISOString(),
        attemptCount: doc.attemptCount || 0
      });
    }

    log('debug', `Atomically claimed ${claimedIntegrations.length} scheduled integrations`, {
      claimed: claimedIntegrations.length,
      requestedLimit: limit
    });

    return claimedIntegrations;
  } catch (err) {
    logError(err, { scope: 'getPendingScheduledIntegrations' });
    return [];
  }
}

/**
 * Update scheduled integration status
 * @param {string} id - Scheduled integration ID
 * @param {string} status - New status
 * @param {Object} details - Additional details (errorMessage, deliveredAt)
 * @returns {Promise<boolean>}
 */
async function updateScheduledIntegrationStatus(id, status, details = {}) {
  if (!useMongo()) {
    return false;
  }

  try {
    const db = await mongodb.getDbSafe();
    const updateDoc = {
      status,
      updatedAt: new Date()
    };

    if (details.errorMessage) {
      updateDoc.errorMessage = details.errorMessage;
    }
    if (details.deliveredAt) {
      updateDoc.deliveredAt = new Date(details.deliveredAt);
    }
    if (details.deliveryLogId) {
      updateDoc.deliveryLogId = details.deliveryLogId;
    }
    if (details.attemptCount !== undefined) {
      updateDoc.attemptCount = details.attemptCount;
    }
    // CRITICAL: Update scheduledFor when rescheduling with backoff
    if (details.scheduledFor) {
      updateDoc.scheduledFor = new Date(details.scheduledFor);
      log('debug', 'Rescheduling integration with backoff', {
        id,
        newScheduledFor: details.scheduledFor,
        attemptCount: details.attemptCount
      });
    }

    // SAFETY: Only update if currently in PROCESSING state (or PENDING/OVERDUE for cancellation)
    // This prevents race conditions where multiple workers try to update the same integration
    const query = { _id: mongodb.toObjectId(id) };

    // For SENT/FAILED, require current status to be PROCESSING
    // For CANCELLED, also allow PENDING/OVERDUE (for cancelling before delivery)
    // For PENDING (retry), require PROCESSING (already claimed by this worker)
    if (status === 'SENT' || status === 'FAILED') {
      query.status = 'PROCESSING';
    } else if (status === 'CANCELLED') {
      query.status = { $in: ['PENDING', 'OVERDUE', 'PROCESSING'] };
    } else if (status === 'PENDING' && details.scheduledFor) {
      // Retry case: must be PROCESSING (we own it)
      query.status = 'PROCESSING';
    }

    const result = await db.collection('scheduled_integrations').updateOne(
      query,
      { $set: updateDoc }
    );

    if (result.matchedCount === 0) {
      log('warn', 'Scheduled integration status update failed - integration not in expected state', {
        id,
        newStatus: status,
        details
      });
      return false;
    }

    log('debug', 'Scheduled integration status updated', { id, status });
    return true;
  } catch (err) {
    logError(err, { scope: 'updateScheduledIntegrationStatus', id });
    return false;
  }
}

/**
 * Reset stuck integrations that have been PROCESSING for too long
 * This prevents integrations from getting stuck if worker crashes during processing
 * @param {number} timeoutMinutes - How long a integration can be PROCESSING before reset (default: 10 minutes)
 * @returns {Promise<number>} Number of integrations reset
 */
async function resetStuckProcessingIntegrations(timeoutMinutes = 10) {
  if (!useMongo()) {
    return 0;
  }

  try {
    const db = await mongodb.getDbSafe();
    const timeoutMs = timeoutMinutes * 60 * 1000;
    const stuckThreshold = new Date(Date.now() - timeoutMs);

    const result = await db.collection('scheduled_integrations').updateMany(
      {
        status: 'PROCESSING',
        processingStartedAt: { $lt: stuckThreshold }
      },
      {
        $set: {
          status: 'PENDING',
          updatedAt: new Date()
        },
        $unset: {
          processingStartedAt: ''
        }
      }
    );

    if (result.modifiedCount > 0) {
      log('warn', `Reset ${result.modifiedCount} stuck PROCESSING integrations back to PENDING`, {
        modifiedCount: result.modifiedCount,
        timeoutMinutes,
        stuckThreshold: stuckThreshold.toISOString()
      });
    }

    return result.modifiedCount;
  } catch (err) {
    logError(err, { scope: 'resetStuckProcessingIntegrations' });
    return 0;
  }
}

/**
 * Cancel scheduled integration(s) by cancellation info
 * @param {number} orgId - Organization ID
 * @param {Object} matchCriteria - Match criteria (patientRid, scheduledDateTime range)
 * @returns {Promise<number>} Number of cancelled integrations
 */
async function cancelScheduledIntegrationsByMatch(orgId, matchCriteria) {
  const normalizedOrgId = normalizeOrgId(orgId);
  if (!normalizedOrgId) return 0;

  if (!useMongo()) {
    return 0;
  }

  try {
    const db = await mongodb.getDbSafe();
    const query = {
      ...scheduledOrgQuery(normalizedOrgId),
      status: 'PENDING' // Only cancel pending integrations
    };

    // Match by patientRid
    if (matchCriteria.patientRid) {
      query['cancellationInfo.patientRid'] = matchCriteria.patientRid;
    }

    // Match by scheduled datetime with tolerance (±1 hour)
    if (matchCriteria.scheduledDateTime) {
      const targetTime = new Date(matchCriteria.scheduledDateTime);
      const tolerance = 60 * 60 * 1000; // 1 hour in ms
      query['cancellationInfo.scheduledDateTime'] = {
        $gte: new Date(targetTime.getTime() - tolerance).toISOString(),
        $lte: new Date(targetTime.getTime() + tolerance).toISOString()
      };
    }

    const result = await db.collection('scheduled_integrations').updateMany(
      query,
      {
        $set: {
          status: 'CANCELLED',
          cancelledAt: new Date(),
          cancelReason: matchCriteria.reason || 'Auto-cancelled by matching event',
          updatedAt: new Date()
        }
      }
    );

    log('info', 'Scheduled integrations cancelled by match', {
      orgId: normalizedOrgId,
      matchCriteria,
      cancelledCount: result.modifiedCount
    });

    return result.modifiedCount;
  } catch (err) {
    logError(err, { scope: 'cancelScheduledIntegrationsByMatch' });
    return 0;
  }
}

/**
 * Delete/cancel a specific scheduled integration
 * @param {number|string} orgId - Entity parent RID (optional)
 * @param {string} id - Scheduled integration ID
 * @returns {Promise<boolean>}
 */
/**
 * Update a scheduled integration
 * @param {number} orgId - Organization/tenant ID
 * @param {string} id - Scheduled integration ID
 * @param {Object} updates - Fields to update
 * @returns {Promise<boolean>} Success status
 */
async function updateScheduledIntegration(orgId, id, updates) {
  const normalizedOrgId = normalizeOrgId(orgId);

  if (!useMongo()) {
    return false;
  }

  try {
    const db = await mongodb.getDbSafe();

    const query = { _id: mongodb.toObjectId(id) };
    if (normalizedOrgId) {
      query.$or = scheduledOrgQuery(normalizedOrgId).$or;
    }

    // Prepare update document
    const updateDoc = {
      ...updates,
      updatedAt: new Date()
    };

    // If scheduledFor is being updated, recalculate status
    if (updates.scheduledFor) {
      const now = Date.now();
      const scheduledTime = new Date(updates.scheduledFor).getTime();

      // Only update status if currently PENDING or OVERDUE
      const existing = await db.collection('scheduled_integrations').findOne(query);
      if (existing && (existing.status === 'PENDING' || existing.status === 'OVERDUE')) {
        updateDoc.status = scheduledTime <= now ? 'OVERDUE' : 'PENDING';
      }
    }

    const result = await db.collection('scheduled_integrations').updateOne(
      query,
      { $set: updateDoc }
    );

    return result.modifiedCount > 0;
  } catch (err) {
    logError(err, { scope: 'updateScheduledIntegration', id });
    return false;
  }
}

async function deleteScheduledIntegration(orgId, id) {
  if (id === undefined) {
    id = orgId;
    orgId = null;
  }

  const normalizedOrgId = normalizeOrgId(orgId);

  if (!useMongo()) {
    return false;
  }

  try {
    const db = await mongodb.getDbSafe();

    // Soft delete by marking as CANCELLED
    const query = { _id: mongodb.toObjectId(id) };
    if (normalizedOrgId) {
      query.$or = scheduledOrgQuery(normalizedOrgId).$or;
    }

    const result = await db.collection('scheduled_integrations').updateOne(
      query,
      {
        $set: {
          status: 'CANCELLED',
          cancelledAt: new Date(),
          cancelReason: 'Manual cancellation',
          updatedAt: new Date()
        }
      }
    );

    log('info', 'Scheduled integration cancelled', { id, orgId: normalizedOrgId });
    return result.modifiedCount > 0;
  } catch (err) {
    logError(err, { scope: 'deleteScheduledIntegration', id, orgId: normalizedOrgId });
    return false;
  }
}

/**
 * Save processed event to MongoDB for duplicate prevention
 * Uses TTL index to auto-expire after 6 hours
 *
 * @param {string} eventKey - Legacy unique event key (for backward compatibility)
 * @param {number|string} mysqlEventId - Event ID from notification_queue
 * @param {string} eventType - Event type
 * @param {number} orgId - Organization ID
 * @param {string} stableEventId - Stable event ID (orgId-eventType-id)
 * @returns {Promise<boolean>} - True if saved successfully, false if duplicate
 */
async function saveProcessedEvent(eventKey, mysqlEventId, eventType, orgId, stableEventId = null) {
  const normalizedOrgId = normalizeOrgId(orgId);
  if (!normalizedOrgId) return true;

  if (!useMongo()) {
    return true; // Skip MongoDB if not enabled
  }

  try {
    const db = await mongodb.getDbSafe();

    const doc = {
      eventKey,
      eventId: stableEventId || eventKey, // Use stable eventId if provided
      mysqlEventId,
      eventType,
      orgId: normalizedOrgId,
      processedAt: new Date(),
      expiresAt: new Date(Date.now() + 6 * 60 * 60 * 1000) // Expires in 6 hours
    };

    await db.collection('processed_events').insertOne(doc);
    return true;
  } catch (err) {
    // Duplicate key error (E11000) is expected if event was already processed
    if (err.code === 11000) {
      log('debug', 'Event already processed (duplicate key)', {
        eventKey,
        eventId: stableEventId
      });
      return false;
    }
    logError(err, { scope: 'saveProcessedEvent', eventKey, eventId: stableEventId });
    return true; // Don't block processing on DB errors
  }
}

/**
 * Check if event has already been processed
 * Checks both legacy eventKey and new stable eventId
 *
 * @param {string} eventKeyOrId - Event key or stable event ID
 * @param {string} stableEventId - Optional stable event ID
 * @returns {Promise<boolean>} - True if already processed, false otherwise
 */
async function isEventAlreadyProcessed(eventKeyOrId, stableEventId = null) {
  if (!useMongo()) {
    return false; // Skip check if MongoDB not enabled
  }

  try {
    const db = await mongodb.getDbSafe();

    // Check both eventKey (legacy) and eventId (new stable ID)
    const query = {
      $or: [
        { eventKey: eventKeyOrId },
        { eventId: eventKeyOrId }
      ]
    };

    // If stable eventId provided, also check that
    if (stableEventId && stableEventId !== eventKeyOrId) {
      query.$or.push({ eventId: stableEventId });
    }

    const doc = await db.collection('processed_events').findOne(query);
    return !!doc;
  } catch (err) {
    logError(err, {
      scope: 'isEventAlreadyProcessed',
      eventKey: eventKeyOrId,
      eventId: stableEventId
    });
    return false; // Don't block processing on DB errors
  }
}

// ==========================================
// LOOKUP TABLES (Code Mapping System)
// ==========================================

/**
 * Map MongoDB lookup document to API format
 */
function mapLookupFromMongo(doc) {
  const orgUnitRid = doc.orgUnitRid ?? doc.entityRid ?? null;
  return {
    id: doc._id.toString(),
    orgId: doc.orgId || doc.entityParentRid || null,
    orgUnitRid,
    type: doc.type,
    source: doc.source,
    target: doc.target,
    description: doc.description,
    category: doc.category,
    usageCount: doc.usageCount || 0,
    lastUsedAt: doc.lastUsedAt?.toISOString() || null,
    importedFrom: doc.importedFrom || null,
    importedAt: doc.importedAt?.toISOString() || null,
    isActive: doc.isActive !== false,
    createdAt: doc.createdAt?.toISOString() || new Date().toISOString(),
    updatedAt: doc.updatedAt?.toISOString() || new Date().toISOString()
  };
}

/**
 * List lookups with filters
 */
async function listLookups(orgId, filters = {}) {
  const normalizedOrgId = normalizeOrgId(orgId);
  if (!normalizedOrgId) return [];

  if (!useMongo()) {
    return fallbackDisabledError('listLookups:fallback');
  }

  try {
    const db = await mongodb.getDbSafe();
    const query = {};

    if (filters.type) {
      query.type = filters.type;
    }
    const filteredOrgUnitRid = filters.orgUnitRid !== undefined
      ? filters.orgUnitRid
      : (filters.entityRid !== undefined ? filters.entityRid : undefined);
    if (filteredOrgUnitRid !== undefined) {
      query.$or = [
        { orgUnitRid: filteredOrgUnitRid },
        { entityRid: filteredOrgUnitRid }
      ];
    }
    if (filters.category) {
      query.category = filters.category;
    }
    if (filters.isActive !== undefined) {
      query.isActive = filters.isActive;
    }
    if (filters.search) {
      query.$text = { $search: filters.search };
    }

    addOrgScope(query, normalizedOrgId);

    const lookups = await db.collection('lookups')
      .find(query)
      .sort({ updatedAt: -1 })
      // Increased limit to avoid capping lookups list
      // TODO: Implement pagination for lookups similar to delivery logs
      .limit(filters.limit || 10000)
      .toArray();

    return lookups.map(mapLookupFromMongo);
  } catch (err) {
    logError(err, { scope: 'listLookups', filters });
    throw err;
  }
}

/**
 * Get single lookup by ID
 */
async function getLookup(id) {
  if (!useMongo()) {
    return fallbackDisabledError('getLookup:fallback');
  }

  try {
    const db = await mongodb.getDbSafe();
    const lookup = await db.collection('lookups')
      .findOne({ _id: mongodb.toObjectId(id) });

    return lookup ? mapLookupFromMongo(lookup) : null;
  } catch (err) {
    logError(err, { scope: 'getLookup', id });
    throw err;
  }
}

/**
 * Create new lookup
 */
async function addLookup(orgId, payload) {
  const normalizedOrgId = normalizeOrgId(orgId);
  if (!normalizedOrgId) {
    throw new Error('orgId is required');
  }

  if (!useMongo()) {
    return fallbackDisabledError('addLookup:fallback');
  }

  try {
    const db = await mongodb.getDbSafe();
    const now = new Date();

    const normalizedOrgUnitRid = payload.orgUnitRid !== undefined
      ? parsePositiveInt(payload.orgUnitRid)
      : (payload.entityRid !== undefined
        ? parsePositiveInt(payload.entityRid)
        : null);

    const lookup = {
      orgId: normalizeOrgId(payload.orgId || normalizedOrgId),
      orgUnitRid: normalizedOrgUnitRid,
      type: payload.type,
      source: payload.source,
      target: payload.target,
      description: payload.description || null,
      category: payload.category || null,
      usageCount: 0,
      lastUsedAt: null,
      importedFrom: payload.importedFrom || null,
      importedAt: payload.importedAt ? new Date(payload.importedAt) : null,
      isActive: payload.isActive !== false,
      createdAt: now,
      updatedAt: now
    };

    const result = await db.collection('lookups').insertOne(lookup);
    lookup._id = result.insertedId;

    log('info', 'Lookup created', {
      id: result.insertedId.toString(),
      type: payload.type,
      sourceId: payload.source.id
    });

    return mapLookupFromMongo(lookup);
  } catch (err) {
    // Handle duplicate key error
    if (err.code === 11000) {
      throw new Error('Duplicate lookup: A mapping with the same key already exists');
    }
    logError(err, { scope: 'addLookup', orgId: normalizedOrgId });
    throw err;
  }
}

/**
 * Update existing lookup
 */
async function updateLookup(orgId, id, patch) {
  const normalizedOrgId = normalizeOrgId(orgId);
  if (!normalizedOrgId) return null;

  if (!useMongo()) {
    return fallbackDisabledError('updateLookup:fallback');
  }

  try {
    const db = await mongodb.getDbSafe();
    const now = new Date();

    const updateDoc = {
      ...patch,
      updatedAt: now
    };
    if (Object.prototype.hasOwnProperty.call(updateDoc, 'orgUnitRid') ||
      Object.prototype.hasOwnProperty.call(updateDoc, 'entityRid')) {
      const normalizedOrgUnitRid = updateDoc.orgUnitRid !== undefined
        ? parsePositiveInt(updateDoc.orgUnitRid)
        : (updateDoc.entityRid !== undefined
          ? parsePositiveInt(updateDoc.entityRid)
          : null);
      updateDoc.orgUnitRid = normalizedOrgUnitRid;
      delete updateDoc.entityRid;
    }

    await db.collection('lookups').updateOne(
      addOrgScope({ _id: mongodb.toObjectId(id) }, normalizedOrgId),
      { $set: updateDoc }
    );

    const updated = await getLookup(id);
    return updated && updated.orgId === normalizedOrgId ? updated : null;
  } catch (err) {
    // Handle duplicate key error
    if (err.code === 11000) {
      throw new Error('Duplicate lookup: A mapping with the same key already exists');
    }
    logError(err, { scope: 'updateLookup', id });
    throw err;
  }
}

/**
 * Delete lookup
 */
async function deleteLookup(orgId, id) {
  const normalizedOrgId = normalizeOrgId(orgId);
  if (!normalizedOrgId) return false;

  if (!useMongo()) {
    return fallbackDisabledError('deleteLookup:fallback');
  }

  try {
    const db = await mongodb.getDbSafe();
    const result = await db.collection('lookups').deleteOne({
      ...addOrgScope({ _id: mongodb.toObjectId(id) }, normalizedOrgId)
    });

    return result.deletedCount > 0;
  } catch (err) {
    logError(err, { scope: 'deleteLookup', id });
    throw err;
  }
}

/**
 * Bulk create or update lookups (for import)
 * Uses versioned replace: deactivate old + insert new
 */
async function bulkCreateLookups(orgId, lookups, options = {}) {
  const normalizedOrgId = normalizeOrgId(orgId);
  if (!normalizedOrgId) {
    throw new Error('orgId is required');
  }

  if (!useMongo()) {
    return fallbackDisabledError('bulkCreateLookups:fallback');
  }

  try {
    const db = await mongodb.getDbSafe();
    const now = new Date();
    const { mode, type } = options;
    const orgUnitRid = options.orgUnitRid !== undefined
      ? options.orgUnitRid
      : (options.entityRid !== undefined ? options.entityRid : undefined);

    // If mode=replace, deactivate ALL existing active mappings for this type+scope
    if (mode === 'replace' && type) {
      const query = addOrgScope({ type, isActive: true }, normalizedOrgId);
      if (orgUnitRid !== undefined) {
        query.$or = [{ orgUnitRid }, { entityRid: orgUnitRid }];
      }
      await db.collection('lookups').updateMany(
        query,
        { $set: { isActive: false, updatedAt: now } }
      );
      log('info', 'Deactivated existing lookups for replace mode', { orgId: normalizedOrgId, type, orgUnitRid });
    }

    let insertedCount = 0;
    let updatedCount = 0;
    const errors = [];

    for (const lookupData of lookups) {
      try {
        const normalizedOrgUnitRid = lookupData.orgUnitRid !== undefined
          ? parsePositiveInt(lookupData.orgUnitRid)
          : (lookupData.entityRid !== undefined
            ? parsePositiveInt(lookupData.entityRid)
            : null);
        // Check for existing active mapping
        const existingQuery = {
          $or: [
            { orgUnitRid: normalizedOrgUnitRid },
            { entityRid: normalizedOrgUnitRid }
          ],
          type: lookupData.type,
          'source.id': lookupData.source.id,
          isActive: true
        };
        addOrgScope(existingQuery, normalizeOrgId(lookupData.orgId || normalizedOrgId));

        const existing = await db.collection('lookups').findOne(existingQuery);

        if (existing) {
          // Deactivate old version
          await db.collection('lookups').updateOne(
            { _id: existing._id },
            { $set: { isActive: false, updatedAt: now } }
          );
          updatedCount++;
        }

        // Insert new version
        const lookup = {
          orgId: normalizeOrgId(lookupData.orgId || normalizedOrgId),
          orgUnitRid: normalizedOrgUnitRid,
          type: lookupData.type,
          source: lookupData.source,
          target: lookupData.target,
          description: lookupData.description || null,
          category: lookupData.category || null,
          usageCount: 0,
          lastUsedAt: null,
          importedFrom: lookupData.importedFrom || null,
          importedAt: lookupData.importedAt ? new Date(lookupData.importedAt) : now,
          isActive: true,
          createdAt: now,
          updatedAt: now
        };

        await db.collection('lookups').insertOne(lookup);
        insertedCount++;
      } catch (err) {
        errors.push({
          sourceId: lookupData.source?.id,
          error: err.message
        });
        log('warn', 'Failed to insert lookup', {
          sourceId: lookupData.source?.id,
          error: err.message
        });
      }
    }

    log('info', 'Bulk lookup import completed', {
      orgId,
      normalizedOrgId,
      requested: lookups.length,
      inserted: insertedCount,
      updated: updatedCount,
      errors: errors.length
    });

    return {
      insertedCount,
      updatedCount,
      errors
    };
  } catch (err) {
    logError(err, { scope: 'bulkCreateLookups' });
    throw err;
  }
}

/**
 * Bulk delete lookups
 */
async function bulkDeleteLookups(orgId, ids) {
  const normalizedOrgId = normalizeOrgId(orgId);
  if (!normalizedOrgId) return { deletedCount: 0, failedIds: ids };

  if (!useMongo()) {
    return fallbackDisabledError('bulkDeleteLookups:fallback');
  }

  try {
    const db = await mongodb.getDbSafe();
    const objectIds = [];
    const failedIds = [];

    for (const id of ids) {
      try {
        objectIds.push(mongodb.toObjectId(id));
      } catch (err) {
        failedIds.push(id);
        log('warn', 'Invalid lookup ID in bulk delete', { id, error: err.message });
      }
    }

    if (objectIds.length === 0) {
      return { deletedCount: 0, failedIds };
    }

    const result = await db.collection('lookups').deleteMany({
      _id: { $in: objectIds },
      ...addOrgScope({}, normalizedOrgId)
    });

    log('info', 'Bulk lookup delete completed', {
      scope: 'bulkDeleteLookups',
      requested: ids.length,
      deleted: result.deletedCount,
      failed: failedIds.length
    });

    return {
      deletedCount: result.deletedCount,
      failedIds
    };
  } catch (err) {
    logError(err, { scope: 'bulkDeleteLookups' });
    return { deletedCount: 0, failedIds: ids };
  }
}

/**
 * Resolve lookup with hierarchy support
 * Step 1: Try entity-specific mapping
 * Step 2: Fallback to parent-level mapping
 */
async function resolveLookup(sourceId, type, orgId, orgUnitRid) {
  const normalizedOrgId = normalizeOrgId(orgId);
  if (!normalizedOrgId) return null;
  const normalizedOrgUnitRid = orgUnitRid !== undefined ? parsePositiveInt(orgUnitRid) : null;

  if (!useMongo()) {
    return null;
  }

  try {
    const db = await mongodb.getDbSafe();

    // Step 1: Try entity-specific mapping (highest priority)
    if (normalizedOrgUnitRid) {
      const entitySpecific = await db.collection('lookups').findOne(addOrgScope({
        $or: [{ orgUnitRid: normalizedOrgUnitRid }, { entityRid: normalizedOrgUnitRid }],
        type,
        'source.id': sourceId,
        isActive: true
      }, normalizedOrgId));

      if (entitySpecific) {
        // Update usage tracking (non-blocking)
        db.collection('lookups').updateOne(
          { _id: entitySpecific._id },
          {
            $inc: { usageCount: 1 },
            $set: { lastUsedAt: new Date() }
          }
        ).catch(err => log('warn', 'Failed to update lookup usage', { error: err.message }));

        return entitySpecific.target.id;
      }
    }

    // Step 2: Fallback to parent-level mapping
    const parentLevel = await db.collection('lookups').findOne(addOrgScope({
      $or: [
        { orgUnitRid: null },
        { orgUnitRid: { $exists: false }, entityRid: null },
        { orgUnitRid: { $exists: false }, entityRid: { $exists: false } },
        { entityRid: null },
        { entityRid: { $exists: false } }
      ],
      type,
      'source.id': sourceId,
      isActive: true
    }, normalizedOrgId));

    if (parentLevel) {
      // Update usage tracking (non-blocking)
      db.collection('lookups').updateOne(
        { _id: parentLevel._id },
        {
          $inc: { usageCount: 1 },
          $set: { lastUsedAt: new Date() }
        }
      ).catch(err => log('warn', 'Failed to update lookup usage', { error: err.message }));

      return parentLevel.target.id;
    }

    // Step 3: No mapping found
    return null;
  } catch (err) {
    logError(err, { scope: 'resolveLookup', sourceId, type });
    return null;
  }
}

/**
 * Reverse lookup with hierarchy support
 */
async function reverseLookup(targetId, type, orgId, orgUnitRid) {
  const normalizedOrgId = normalizeOrgId(orgId);
  if (!normalizedOrgId) return null;
  const normalizedOrgUnitRid = orgUnitRid !== undefined ? parsePositiveInt(orgUnitRid) : null;

  if (!useMongo()) {
    return null;
  }

  try {
    const db = await mongodb.getDbSafe();

    // Step 1: Try entity-specific mapping
    if (normalizedOrgUnitRid) {
      const entitySpecific = await db.collection('lookups').findOne(addOrgScope({
        $or: [{ orgUnitRid: normalizedOrgUnitRid }, { entityRid: normalizedOrgUnitRid }],
        type,
        'target.id': targetId,
        isActive: true
      }, normalizedOrgId));

      if (entitySpecific) {
        return {
          sourceId: entitySpecific.source.id,
          scope: 'entity'
        };
      }
    }

    // Step 2: Fallback to parent-level mapping
    const parentLevel = await db.collection('lookups').findOne(addOrgScope({
      $or: [
        { orgUnitRid: null },
        { orgUnitRid: { $exists: false }, entityRid: null },
        { orgUnitRid: { $exists: false }, entityRid: { $exists: false } },
        { entityRid: null },
        { entityRid: { $exists: false } }
      ],
      type,
      'target.id': targetId,
      isActive: true
    }, normalizedOrgId));

    if (parentLevel) {
      return {
        sourceId: parentLevel.source.id,
        scope: 'parent'
      };
    }

    return null;
  } catch (err) {
    logError(err, { scope: 'reverseLookup', targetId, type });
    return null;
  }
}

/**
 * Get lookup statistics
 */
async function getLookupStats(orgId, filters = {}) {
  if (!useMongo()) {
    return fallbackDisabledError('getLookupStats:fallback');
  }

  try {
    const db = await mongodb.getDbSafe();
    const matchQuery = {};

    if (filters.type) {
      matchQuery.type = filters.type;
    }
    addOrgScope(matchQuery, normalizeOrgId(orgId));

    const stats = await db.collection('lookups').aggregate([
      { $match: matchQuery },
      {
        $group: {
          _id: '$type',
          total: { $sum: 1 },
          active: {
            $sum: { $cond: [{ $eq: ['$isActive', true] }, 1, 0] }
          },
          inactive: {
            $sum: { $cond: [{ $eq: ['$isActive', false] }, 1, 0] }
          },
          totalUsage: { $sum: '$usageCount' }
        }
      },
      { $sort: { _id: 1 } }
    ]).toArray();

    return stats.map(stat => ({
      type: stat._id,
      total: stat.total,
      active: stat.active,
      inactive: stat.inactive,
      totalUsage: stat.totalUsage
    }));
  } catch (err) {
    logError(err, { scope: 'getLookupStats' });
    throw err;
  }
}

/**
 * Get available lookup types for an entity
 */
async function getLookupTypes(orgId) {
  if (!useMongo()) {
    return fallbackDisabledError('getLookupTypes:fallback');
  }

  try {
    const db = await mongodb.getDbSafe();
    const types = await db.collection('lookups')
      .distinct('type', addOrgScope({}, normalizeOrgId(orgId)));

    return types.sort();
  } catch (err) {
    logError(err, { scope: 'getLookupTypes' });
    throw err;
  }
}

// ========================
// Event Audit Functions
// ========================

/**
 * Create event audit record (with uniqueness safety)
 */
async function recordEventAudit(auditData) {
  if (!useMongo()) {
    return fallbackDisabledError('recordEventAudit:mongo');
  }

  try {
    const db = await mongodb.getDbSafe();
    const retentionDays = config.eventAudit?.retentionDays || 90;

    const doc = {
      ...auditData,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + retentionDays * 24 * 60 * 60 * 1000)
    };

    const result = await db.collection('event_audit').insertOne(doc);
    return result.insertedId;
  } catch (err) {
    // Handle duplicate key error gracefully
    if (err.code === 11000) {
      log('warn', 'Duplicate event audit record', {
        source: auditData.source,
        sourceId: auditData.sourceId,
        eventKey: auditData.eventKey
      });

      // Return existing record ID
      const db = await mongodb.getDbSafe();
      const hasSourceId = auditData.sourceId !== undefined && auditData.sourceId !== null;
      const existing = hasSourceId
        ? await db.collection('event_audit').findOne({
          source: auditData.source,
          sourceId: auditData.sourceId
        })
        : await db.collection('event_audit').findOne({
          orgId: auditData.orgId,
          eventKey: auditData.eventKey,
          receivedAtBucket: auditData.receivedAtBucket
        });
      return existing?._id;
    }

    logError(err, { scope: 'recordEventAudit', auditData });
    throw err;
  }
}

/**
 * Update event audit record (supports timeline append)
 */
async function updateEventAudit(eventId, updates) {
  if (!useMongo()) {
    return fallbackDisabledError('updateEventAudit:mongo');
  }

  try {
    const db = await mongodb.getDbSafe();

    // Separate timeline updates from field updates
    const { timeline, timelinePush, ...fieldUpdates } = updates;

    const updateDoc = {
      $set: { ...fieldUpdates, updatedAt: new Date() }
    };

    const timelineEntry = timelinePush || timeline;
    if (timelineEntry) {
      updateDoc.$push = {
        timeline: Array.isArray(timelineEntry) ? { $each: timelineEntry } : timelineEntry
      };
    }

    await db.collection('event_audit').updateOne(
      { eventId },
      updateDoc
    );

    return true;
  } catch (err) {
    logError(err, { scope: 'updateEventAudit', eventId, updates });
    throw err;
  }
}

/**
 * List events (audit trail) - MUST use orgId
 */
async function listEventAudit(orgId, filters = {}) {
  if (!useMongo()) {
    return fallbackDisabledError('listEventAudit:mongo');
  }

  try {
    const db = await mongodb.getDbSafe();
    const query = { orgId }; // CRITICAL: tenant scoping

    if (filters.status) query.status = filters.status;
    if (filters.eventType) query.eventType = filters.eventType;
    if (filters.skipCategory) query.skipCategory = filters.skipCategory;
    if (filters.source) query.source = filters.source;

    // Date range
    if (filters.startDate || filters.endDate) {
      query.receivedAt = {};
      if (filters.startDate) query.receivedAt.$gte = new Date(filters.startDate);
      if (filters.endDate) query.receivedAt.$lte = new Date(filters.endDate);
    }

    // Search (event ID, source ID, or payload summary fields)
    if (filters.search) {
      query.$or = [
        { eventId: { $regex: filters.search, $options: 'i' } },
        { sourceId: { $regex: filters.search, $options: 'i' } },
        { 'payloadSummary.patientRid': parseInt(filters.search) || 0 }
      ];
    }

    const limit = filters.limit || 50;
    const page = filters.page || 1;

    const events = await db.collection('event_audit')
      .find(query)
      .sort({ receivedAt: -1 })
      .limit(limit)
      .skip((page - 1) * limit)
      .toArray();

    const total = await db.collection('event_audit').countDocuments(query);

    return {
      events,
      total,
      pages: Math.ceil(total / limit),
      page
    };
  } catch (err) {
    logError(err, { scope: 'listEventAudit', orgId, filters });
    throw err;
  }
}

/**
 * Get event audit by ID (with tenant check)
 */
async function getEventAuditById(orgId, eventId) {
  if (!useMongo()) {
    return fallbackDisabledError('getEventAuditById:mongo');
  }

  try {
    const db = await mongodb.getDbSafe();
    return db.collection('event_audit').findOne({
      orgId, // CRITICAL: prevent cross-tenant access
      eventId
    });
  } catch (err) {
    logError(err, { scope: 'getEventAuditById', orgId, eventId });
    throw err;
  }
}

/**
 * Get event audit statistics (with delivery metrics)
 */
async function getEventAuditStats(orgId, hoursBack = 24) {
  if (!useMongo()) {
    return fallbackDisabledError('getEventAuditStats:mongo');
  }

  try {
    const db = await mongodb.getDbSafe();
    const startDate = new Date(Date.now() - hoursBack * 60 * 60 * 1000);

    const stats = await db.collection('event_audit').aggregate([
      { $match: { orgId, receivedAt: { $gte: startDate } } },
      {
        $group: {
          _id: null,
          totalReceived: { $sum: 1 },
          delivered: {
            $sum: {
              $cond: [{ $eq: ['$status', 'DELIVERED'] }, 1, 0]
            }
          },
          skipped: {
            $sum: {
              $cond: [{ $eq: ['$status', 'SKIPPED'] }, 1, 0]
            }
          },
          failed: {
            $sum: {
              $cond: [{ $eq: ['$status', 'FAILED'] }, 1, 0]
            }
          },
          stuck: {
            $sum: {
              $cond: [{ $eq: ['$status', 'STUCK'] }, 1, 0]
            }
          },
          avgProcessingTimeMs: { $avg: '$processingTimeMs' },
          avgIntegrationsMatched: { $avg: '$deliveryStatus.integrationsMatched' },
          avgDeliveredCount: { $avg: '$deliveryStatus.deliveredCount' },
          avgFailedCount: { $avg: '$deliveryStatus.failedCount' }
        }
      }
    ]).toArray();

    // Get skip reasons breakdown
    const skipReasons = await db.collection('event_audit').aggregate([
      {
        $match: {
          orgId,
          receivedAt: { $gte: startDate },
          status: 'SKIPPED'
        }
      },
      { $group: { _id: '$skipCategory', count: { $sum: 1 } } }
    ]).toArray();

    // Get duplicate type breakdown
    const duplicateTypes = await db.collection('event_audit').aggregate([
      {
        $match: {
          orgId,
          receivedAt: { $gte: startDate },
          skipCategory: 'DUPLICATE'
        }
      },
      { $group: { _id: '$duplicateType', count: { $sum: 1 } } }
    ]).toArray();

    // Get source breakdown
    const bySource = await db.collection('event_audit').aggregate([
      { $match: { orgId, receivedAt: { $gte: startDate } } },
      { $group: { _id: '$source', count: { $sum: 1 } } }
    ]).toArray();

    // Get event type breakdown
    const byEventType = await db.collection('event_audit').aggregate([
      { $match: { orgId, receivedAt: { $gte: startDate } } },
      { $group: { _id: '$eventType', count: { $sum: 1 } } }
    ]).toArray();

    // Calculate processing time percentiles
    const processingTimes = await db.collection('event_audit')
      .find(
        { orgId, receivedAt: { $gte: startDate }, processingTimeMs: { $exists: true } },
        { projection: { processingTimeMs: 1 } }
      )
      .sort({ processingTimeMs: 1 })
      .toArray();

    const p50 = processingTimes[Math.floor(processingTimes.length * 0.5)]?.processingTimeMs || 0;
    const p95 = processingTimes[Math.floor(processingTimes.length * 0.95)]?.processingTimeMs || 0;
    const p99 = processingTimes[Math.floor(processingTimes.length * 0.99)]?.processingTimeMs || 0;

    const result = stats[0] || {
      totalReceived: 0,
      delivered: 0,
      skipped: 0,
      failed: 0,
      stuck: 0,
      avgProcessingTimeMs: 0,
      avgIntegrationsMatched: 0,
      avgDeliveredCount: 0,
      avgFailedCount: 0
    };

    return {
      ...result,
      skipReasons: Object.fromEntries(skipReasons.map(r => [r._id, r.count])),
      duplicateTypes: Object.fromEntries(duplicateTypes.map(r => [r._id, r.count])),
      bySource: Object.fromEntries(bySource.map(r => [r._id, r.count])),
      byEventType: Object.fromEntries(byEventType.map(r => [r._id, r.count])),
      processingMetrics: {
        avgProcessingTimeMs: result.avgProcessingTimeMs || 0,
        p50ProcessingTimeMs: p50,
        p95ProcessingTimeMs: p95,
        p99ProcessingTimeMs: p99
      },
      deliveryMetrics: {
        avgIntegrationsMatched: result.avgIntegrationsMatched || 0,
        avgDeliveredCount: result.avgDeliveredCount || 0,
        avgFailedCount: result.avgFailedCount || 0,
        successRate: result.avgIntegrationsMatched > 0
          ? result.avgDeliveredCount / result.avgIntegrationsMatched
          : 0
      }
    };
  } catch (err) {
    logError(err, { scope: 'getEventAuditStats', orgId, hoursBack });
    throw err;
  }
}

/**
 * Update source checkpoint (for gap detection)
 */
async function updateSourceCheckpoint(checkpointData) {
  if (!useMongo()) {
    return fallbackDisabledError('updateSourceCheckpoint:mongo');
  }

  try {
    const db = await mongodb.getDbSafe();
    const { source, sourceIdentifier, orgId, lastProcessedId, lastProcessedAt } = checkpointData;

    const existing = await db.collection('source_checkpoints').findOne({
      source,
      sourceIdentifier,
      orgId
    });

    // Update or insert checkpoint
    await db.collection('source_checkpoints').updateOne(
      { source, sourceIdentifier, orgId },
      {
        $set: {
          lastProcessedId,
          lastProcessedAt,
          updatedAt: new Date()
        },
        $inc: { eventsProcessedLast5Min: 1 }
      },
      { upsert: true }
    );

    // Detect gaps for sequential sources (MySQL, Kafka offset)
    if (isSequentialSource(source)) {
      const previousId = existing?.lastProcessedId;
      await detectGaps(source, sourceIdentifier, orgId, lastProcessedId, previousId);
    }

    return true;
  } catch (err) {
    logError(err, { scope: 'updateSourceCheckpoint', checkpointData });
    throw err;
  }
}

/**
 * Detect gaps in sequential sources
 */
async function detectGaps(source, sourceIdentifier, orgId, currentId, previousIdOverride) {
  if (!useMongo()) {
    return fallbackDisabledError('detectGaps:mongo');
  }

  try {
    const db = await mongodb.getDbSafe();

    const prevIdRaw = previousIdOverride !== undefined && previousIdOverride !== null
      ? previousIdOverride
      : (await db.collection('source_checkpoints').findOne({
        source,
        sourceIdentifier,
        orgId
      }))?.lastProcessedId;

    if (!prevIdRaw) return;

    const prevId = parseInt(prevIdRaw);
    const currId = parseInt(currentId);

    // Gap detected (difference > 1 for sequential IDs)
    if (currId - prevId > 1) {
      const gap = {
        start: prevId + 1,
        end: currId - 1,
        detectedAt: new Date()
      };

      log('warn', 'Gap detected in event source', {
        source,
        sourceIdentifier,
        orgId,
        gap
      });

      // Store gap
      await db.collection('source_checkpoints').updateOne(
        { source, sourceIdentifier, orgId },
        { $push: { detectedGaps: gap } }
      );
    }

    return true;
  } catch (err) {
    logError(err, { scope: 'detectGaps', source, sourceIdentifier, orgId, currentId });
    throw err;
  }
}

/**
 * Get source checkpoints (for API)
 */
async function getSourceCheckpoints(orgId) {
  if (!useMongo()) {
    return fallbackDisabledError('getSourceCheckpoints:mongo');
  }

  try {
    const db = await mongodb.getDbSafe();

    const checkpoints = await db.collection('source_checkpoints')
      .find({ orgId })
      .toArray();

    // Add health status
    const now = Date.now();
    return checkpoints.map(cp => ({
      ...cp,
      health: {
        eventsProcessedLast5Min: cp.eventsProcessedLast5Min || 0,
        lastHealthCheckAt: cp.updatedAt,
        isHealthy: now - cp.updatedAt.getTime() < 60 * 1000, // Healthy if updated < 1 min ago
        lag: cp.lastProcessedAt ? formatLag(now - cp.lastProcessedAt.getTime()) : 'unknown'
      }
    }));
  } catch (err) {
    logError(err, { scope: 'getSourceCheckpoints', orgId });
    throw err;
  }
}

/**
 * Get gaps for a specific source
 */
async function getSourceGaps(orgId, source, hoursBack = 24) {
  if (!useMongo()) {
    return fallbackDisabledError('getSourceGaps:mongo');
  }

  try {
    const db = await mongodb.getDbSafe();
    const startDate = new Date(Date.now() - hoursBack * 60 * 60 * 1000);

    const checkpoint = await db.collection('source_checkpoints').findOne({
      orgId,
      source
    });

    if (!checkpoint) {
      return {
        source,
        isSequential: false,
        totalGaps: 0,
        gaps: []
      };
    }

    // Filter gaps within time window
    const recentGaps = (checkpoint.detectedGaps || []).filter(
      gap => gap.detectedAt >= startDate
    );

    return {
      source,
      sourceIdentifier: checkpoint.sourceIdentifier,
      isSequential: checkpoint.isSequential !== false,
      totalGaps: recentGaps.length,
      gaps: recentGaps.map(gap => ({
        ...gap,
        count: gap.end - gap.start + 1
      }))
    };
  } catch (err) {
    logError(err, { scope: 'getSourceGaps', orgId, source, hoursBack });
    throw err;
  }
}

// ========================
// Helper Functions
// ========================

/**
 * Check if source has sequential IDs (can detect gaps)
 */
function isSequentialSource(source) {
  return ['mysql', 'kafka'].includes(source);
}

/**
 * Format lag duration in human-readable format
 */
function formatLag(ms) {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return 'unknown';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${Math.floor(ms / 1000)}s`;
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m`;
  return `${Math.floor(ms / 3600000)}h`;
}

/**
 * Hash payload for verification
 */
function hashPayload(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

/**
 * Extract compliance-safe payload fields (allowlist)
 */
function extractSafePayload(payload) {
  const allowedFields = config.eventAudit?.allowedSummaryFields || [
    'patientRid',
    'appointmentId',
    'orgId',
    'orgUnitRid',
    'billId',
    'eventType',
    'timestamp'
  ];

  const safe = {};
  for (const field of allowedFields) {
    if (payload && payload[field] !== undefined) {
      safe[field] = payload[field];
    }
  }
  return safe;
}

/**
 * Bucket timestamp for fallback uniqueness (5-minute buckets)
 */
function getBucketTimestamp(date, minutes = 5) {
  const ms = date.getTime();
  const bucketMs = minutes * 60 * 1000;
  return new Date(Math.floor(ms / bucketMs) * bucketMs);
}

/**
 * Extract source-specific metadata from event
 */
function extractSourceMetadata(event, sourceType) {
  const metadata = {};

  if (sourceType === 'mysql') {
    metadata.table = 'notification_queue';
    if (event.org_unit_rid || event.entity_rid) metadata.orgUnitRid = event.org_unit_rid || event.entity_rid;
    if (event.entity_parent_rid) metadata.orgId = event.entity_parent_rid;
  } else if (sourceType === 'kafka') {
    if (event.topic) metadata.topic = event.topic;
    if (event.partition !== undefined) metadata.partition = event.partition;
    if (event.offset !== undefined) metadata.offset = event.offset;
  } else if (sourceType === 'sqs') {
    if (event.messageId) metadata.messageId = event.messageId;
    if (event.receiptHandle) metadata.receiptHandle = event.receiptHandle;
  }

  return metadata;
}

function resolveOrgIdFromEvent(event) {
  if (!event) return null;
  return normalizeOrgId(
    event.orgId ||
    event.entity_parent_rid
  );
}

/**
 * Get source identifier for checkpoint tracking
 */
function getSourceIdentifier(event, sourceType) {
  const type = sourceType || config.eventSource?.type || 'unknown';

  if (type === 'mysql') {
    return 'notification_queue';
  } else if (type === 'kafka') {
    return event.topic || 'integration-events';
  } else if (type === 'sqs') {
    return event.queueName || 'integration-queue';
  }

  return 'unknown';
}

/**
 * Get event type sample payload from event_types collection
 * @param {string} eventType - Event type identifier
 * @returns {Promise<Object|null>} Sample payload or null if not found
 */
async function getEventTypeSamplePayload(eventType, orgId) {
  try {
    const db = await mongodb.getDbSafe();
    const collection = db.collection('event_types');
    const projection = { projection: { samplePayload: 1 } };

    // Prefer org-specific doc, fall back to global template
    if (orgId) {
      const orgDoc = await collection.findOne(
        { $or: [{ type: eventType, orgId, isActive: true }, { eventType, orgId, isActive: true }] },
        projection
      );
      if (orgDoc?.samplePayload) return orgDoc.samplePayload;
    }

    // Global template fallback (also handles legacy docs without orgId field)
    const globalDoc = await collection.findOne(
      {
        $or: [
          { type: eventType, isActive: true },
          { eventType, isActive: true }
        ]
      },
      projection
    );

    if (globalDoc?.samplePayload) {
      log('debug', 'Event type sample payload retrieved', { eventType, hasSamplePayload: true });
      return globalDoc.samplePayload;
    }

    log('debug', 'Event type sample payload not found', { eventType });
    return null;
  } catch (err) {
    logError(err, { scope: 'getEventTypeSamplePayload', eventType });
    return null;
  }
}

// Users (JWT auth)
async function getUserByEmail(email) {
  if (!useMongo()) {
    return fallbackDisabledError('getUserByEmail:mongo');
  }

  const normalizedEmail = (email || '').trim().toLowerCase();
  if (!normalizedEmail) {
    return null;
  }

  const dbClient = await mongodb.getDbSafe();
  return dbClient.collection('users').findOne({ email: normalizedEmail });
}

async function getUserById(userId) {
  if (!useMongo()) {
    return fallbackDisabledError('getUserById:mongo');
  }

  const objectId = mongodb.toObjectId(userId);
  if (!objectId) {
    return null;
  }

  const dbClient = await mongodb.getDbSafe();
  return dbClient.collection('users').findOne({ _id: objectId });
}

async function createUser(user) {
  if (!useMongo()) {
    return fallbackDisabledError('createUser:mongo');
  }

  const now = new Date();
  const normalizedEmail = (user.email || '').trim().toLowerCase();
  const payload = {
    email: normalizedEmail,
    passwordHash: user.passwordHash,
    role: user.role,
    orgId: user.orgId || null,
    isActive: user.isActive !== false,
    createdAt: now,
    updatedAt: now
  };

  const dbClient = await mongodb.getDbSafe();
  const result = await dbClient.collection('users').insertOne(payload);
  return { ...payload, _id: result.insertedId };
}

async function updateUser(userId, updates) {
  if (!useMongo()) {
    return fallbackDisabledError('updateUser:mongo');
  }

  const objectId = mongodb.toObjectId(userId);
  if (!objectId) {
    return null;
  }

  const updatePayload = { ...updates, updatedAt: new Date() };
  if (updatePayload.email) {
    updatePayload.email = updatePayload.email.trim().toLowerCase();
  }

  const dbClient = await mongodb.getDbSafe();
  const result = await dbClient.collection('users').updateOne(
    { _id: objectId },
    { $set: updatePayload }
  );

  if (!result.matchedCount) {
    return null;
  }

  return dbClient.collection('users').findOne({ _id: objectId });
}

async function setUserLastLogin(userId) {
  return updateUser(userId, { lastLoginAt: new Date() });
}

async function listUsers(filter = {}) {
  if (!useMongo()) {
    return fallbackDisabledError('listUsers:mongo');
  }

  const query = {};
  if (filter.orgId !== undefined && filter.orgId !== null) {
    query.orgId = filter.orgId;
  }
  if (filter.role) {
    query.role = filter.role;
  }
  if (filter.isActive !== undefined) {
    if (filter.isActive === true) {
      query.isActive = { $ne: false };
    } else {
      query.isActive = false;
    }
  }
  if (filter.search) {
    const escaped = String(filter.search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    query.email = { $regex: escaped, $options: 'i' };
  }

  const page = Number(filter.page) > 0 ? Number(filter.page) : 1;
  const limit = Number(filter.limit) > 0 ? Number(filter.limit) : 50;
  const skip = (page - 1) * limit;

  const dbClient = await mongodb.getDbSafe();
  const collection = dbClient.collection('users');

  const [users, total] = await Promise.all([
    collection.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).toArray(),
    collection.countDocuments(query)
  ]);

  return { users, total, page, limit };
}

async function countUsers(filter = {}) {
  if (!useMongo()) {
    return fallbackDisabledError('countUsers:mongo');
  }

  const query = {};
  if (filter.orgId !== undefined && filter.orgId !== null) {
    query.orgId = filter.orgId;
  }
  if (filter.role) {
    query.role = filter.role;
  }
  if (filter.isActive !== undefined) {
    if (filter.isActive === true) {
      query.isActive = { $ne: false };
    } else {
      query.isActive = false;
    }
  }
  if (filter.$or) {
    query.$or = filter.$or;
  }

  const dbClient = await mongodb.getDbSafe();
  return dbClient.collection('users').countDocuments(query);
}

function mapOrganizationSummary(doc) {
  return {
    orgId: doc.orgId,
    name: doc.name || `Org ${doc.orgId}`,
    code: doc.code || `ORG-${doc.orgId}`,
    region: doc.region || null,
    timezone: doc.timezone || null,
    email: doc.email || null,
    phone: doc.phone || null,
    address: doc.address || null,
    tags: Array.isArray(doc.tags) ? doc.tags : []
  };
}

async function listOrganizations() {
  if (!useMongo()) {
    return fallbackDisabledError('listOrganizations:mongo');
  }

  const dbClient = await mongodb.getDbSafe();
  return dbClient.collection('organizations').find({}).sort({ orgId: 1 }).toArray();
}

async function getOrganization(orgId) {
  if (!useMongo()) {
    return fallbackDisabledError('getOrganization:mongo');
  }

  const dbClient = await mongodb.getDbSafe();
  const org = await dbClient.collection('organizations').findOne({ orgId });
  if (!org) return null;
  const units = await dbClient.collection('org_units').find({ orgId }).sort({ rid: 1 }).toArray();
  return { ...org, units };
}

async function getNextSequenceValue(sequenceName) {
  const dbClient = await mongodb.getDbSafe();
  const result = await dbClient.collection('counters').findOneAndUpdate(
    { _id: sequenceName },
    { $inc: { sequence: 1 } },
    { upsert: true, returnDocument: 'after' }
  );
  return result.value.sequence;
}

async function createOrganization(payload) {
  if (!useMongo()) {
    return fallbackDisabledError('createOrganization:mongo');
  }

  const dbClient = await mongodb.getDbSafe();
  const now = new Date();

  // Auto-generate orgId if not provided
  let orgId = payload.orgId;
  if (!orgId || !Number.isFinite(Number(orgId)) || Number(orgId) <= 0) {
    orgId = await getNextSequenceValue('orgId');
  }

  const org = {
    orgId: Number(orgId),
    name: payload.name || null,
    code: payload.code || null,
    email: payload.email || null,
    phone: payload.phone || null,
    address: payload.address || null,
    tags: Array.isArray(payload.tags) ? payload.tags : [],
    region: payload.region || null,
    timezone: payload.timezone || null,
    createdAt: now,
    updatedAt: now
  };

  await dbClient.collection('organizations').insertOne(org);
  return org;
}

async function updateOrganization(orgId, updates) {
  if (!useMongo()) {
    return fallbackDisabledError('updateOrganization:mongo');
  }

  const dbClient = await mongodb.getDbSafe();
  const updateDoc = {
    $set: {
      ...updates,
      updatedAt: new Date()
    }
  };
  const result = await dbClient.collection('organizations').findOneAndUpdate(
    { orgId },
    updateDoc,
    { returnDocument: 'after' }
  );
  return result.value || null;
}

async function deleteOrganization(orgId) {
  if (!useMongo()) {
    return fallbackDisabledError('deleteOrganization:mongo');
  }

  const dbClient = await mongodb.getDbSafe();
  const result = await dbClient.collection('organizations').deleteOne({ orgId });
  await dbClient.collection('org_units').deleteMany({ orgId });
  return result.deletedCount > 0;
}

async function listOrgUnits(orgId) {
  if (!useMongo()) {
    return fallbackDisabledError('listOrgUnits:mongo');
  }

  const dbClient = await mongodb.getDbSafe();
  return dbClient.collection('org_units').find({ orgId }).sort({ rid: 1 }).toArray();
}

async function createOrgUnit(orgId, payload) {
  if (!useMongo()) {
    return fallbackDisabledError('createOrgUnit:mongo');
  }

  const dbClient = await mongodb.getDbSafe();
  const now = new Date();

  // Auto-generate rid if not provided
  let rid = payload.rid;
  if (!rid || !Number.isFinite(Number(rid)) || Number(rid) <= 0) {
    rid = await getNextSequenceValue('rid');
  }

  const unit = {
    orgId,
    rid: Number(rid),
    name: payload.name || null,
    code: payload.code || null,
    email: payload.email || null,
    phone: payload.phone || null,
    address: payload.address || null,
    tags: Array.isArray(payload.tags) ? payload.tags : [],
    region: payload.region || null,
    timezone: payload.timezone || null,
    createdAt: now,
    updatedAt: now
  };
  await dbClient.collection('org_units').insertOne(unit);
  return unit;
}

async function updateOrgUnit(orgId, rid, updates) {
  if (!useMongo()) {
    return fallbackDisabledError('updateOrgUnit:mongo');
  }

  const dbClient = await mongodb.getDbSafe();
  const result = await dbClient.collection('org_units').findOneAndUpdate(
    { orgId, rid },
    {
      $set: {
        ...updates,
        updatedAt: new Date()
      }
    },
    { returnDocument: 'after' }
  );
  return result.value || null;
}

async function deleteOrgUnit(orgId, rid) {
  if (!useMongo()) {
    return fallbackDisabledError('deleteOrgUnit:mongo');
  }

  const dbClient = await mongodb.getDbSafe();
  const result = await dbClient.collection('org_units').deleteOne({ orgId, rid });
  return result.deletedCount > 0;
}

async function listTenantIds() {
  if (!useMongo()) {
    return fallbackDisabledError('listTenantIds:mongo');
  }

  const dbClient = await mongodb.getDbSafe();
  const orgIds = await dbClient.collection('organizations').distinct('orgId');
  const cleaned = orgIds
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id) && id > 0)
    .sort((a, b) => a - b);

  if (cleaned.length > 0) {
    return cleaned;
  }

  const sources = await Promise.all([
    dbClient.collection('integration_configs').distinct('orgId'),
    dbClient.collection('integration_configs').distinct('orgId'),
    dbClient.collection('ui_config').distinct('orgId'),
    dbClient.collection('lookups').distinct('orgId'),
    dbClient.collection('event_audit').distinct('orgId'),
    dbClient.collection('execution_logs').distinct('orgId')
  ]);

  const ids = new Set();
  sources.flat().forEach((id) => {
    const num = Number(id);
    if (Number.isFinite(num) && num > 0) {
      ids.add(num);
    }
  });

  return Array.from(ids).sort((a, b) => a - b);
}

async function listTenantSummaries() {
  if (useMongo()) {
    const orgs = await listOrganizations();
    if (orgs.length > 0) {
      return orgs.map(mapOrganizationSummary);
    }
  }

  const ids = await listTenantIds();
  return ids.map((orgId) => ({
    orgId,
    name: `Org ${orgId}`,
    code: `ORG-${orgId}`,
    region: null,
    timezone: null,
    email: null
  }));
}

async function getUiConfigDefault() {
  if (!useMongo()) {
    return fallbackDisabledError('getUiConfigDefault:mongo');
  }

  const dbClient = await mongodb.getDbSafe();
  return dbClient.collection('ui_config').findOne({ _id: 'default' });
}

async function updateUiConfigDefault(update) {
  if (!useMongo()) {
    return fallbackDisabledError('updateUiConfigDefault:mongo');
  }

  const dbClient = await mongodb.getDbSafe();
  await dbClient.collection('ui_config').updateOne(
    { _id: 'default' },
    {
      $set: {
        ...update,
        updatedAt: new Date()
      },
      $setOnInsert: {
        createdAt: new Date()
      }
    },
    { upsert: true }
  );

  return dbClient.collection('ui_config').findOne({ _id: 'default' });
}

function mapLegacyWebhook(integration) {
  if (!integration) {
    return integration;
  }
  return {
    ...integration,
    entityRid: integration.entityRid || integration.orgUnitRid || integration.orgId,
    authType: integration.authType || integration.outgoingAuthType,
    authConfig: integration.authConfig || integration.outgoingAuthConfig,
    transformMode: integration.transformMode || integration.transformationMode,
    transformConfig: integration.transformConfig || integration.transformation
  };
}

function mapLegacyScheduledIntegration(integration) {
  if (!integration) {
    return integration;
  }
  return {
    ...integration,
    webhookConfigId: integration.webhookConfigId || integration.integrationConfigId || integration.__KEEP___KEEP_integrationConfig__Id__,
    webhookName: integration.webhookName || integration.integrationName || integration.__KEEP_integrationName__,
    entityRid: integration.entityRid || integration.orgUnitRid || integration.orgId
  };
}

async function addWebhook(orgId, payload) {
  const integration = await addIntegration(orgId, {
    ...payload,
    orgId: payload?.orgId || orgId
  });
  return integration?.id;
}

async function listWebhooks(orgId) {
  const integrations = await listIntegrations(orgId);
  return integrations.map(mapLegacyWebhook);
}

async function listWebhooksForDelivery(orgId, eventType) {
  const integrations = await listIntegrationsForDelivery(orgId, eventType);
  return integrations.map(mapLegacyWebhook);
}

async function getWebhook(id) {
  const integration = await getIntegration(id);
  return mapLegacyWebhook(integration);
}

async function updateWebhook(orgId, id, patch) {
  const integration = await updateIntegration(orgId, id, patch);
  return mapLegacyWebhook(integration);
}

async function deleteWebhook(orgId, id) {
  return deleteIntegration(orgId, id);
}

async function createScheduledWebhook(data) {
  const scheduled = await createScheduledIntegration({
    ...data,
    __KEEP___KEEP_integrationConfig__Id__: data.__KEEP___KEEP_integrationConfig__Id__ || data.integrationConfigId || data.webhookConfigId,
    __KEEP_integrationName__: data.__KEEP_integrationName__ || data.integrationName || data.webhookName,
    orgId: data.orgId || data.orgUnitRid || data.entityRid,
    orgUnitRid: data.orgUnitRid || data.entityRid || data.orgId
  });
  return mapLegacyScheduledIntegration(scheduled);
}

async function listScheduledWebhooks(orgId, filters = {}) {
  const scheduled = await listScheduledIntegrations(orgId, {
    ...filters,
    integrationConfigId: filters.integrationConfigId || filters.webhookConfigId
  });
  return scheduled.map(mapLegacyScheduledIntegration);
}

async function getPendingScheduledWebhooks(limit = 10) {
  const scheduled = await getPendingScheduledIntegrations(limit);
  return scheduled.map(mapLegacyScheduledIntegration);
}

async function updateScheduledWebhookStatus(id, status, details = {}) {
  return updateScheduledIntegrationStatus(id, status, details);
}

module.exports = {
  initDataLayer,
  isMysqlAvailable,
  attemptMysqlReconnect,
  // Legacy aliases
  addWebhook,
  listWebhooks,
  listWebhooksForDelivery,
  getWebhook,
  updateWebhook,
  deleteWebhook,
  createScheduledWebhook,
  listScheduledWebhooks,
  getPendingScheduledWebhooks,
  updateScheduledWebhookStatus,
  listIntegrations,
  listIntegrationsForDelivery,
  getIntegration,
  getIntegrationByTypeAndDirection,
  addIntegration,
  updateIntegration,
  deleteIntegration,
  // Bulk operations
  bulkUpdateIntegrations,
  bulkDeleteIntegrations,
  listEventTypes,
  listLogs,
  countLogs,
  getLogStatsSummary,
  streamLogsForExport,
  listAlertCenterLogs,
  getLogById,
  recordLog,
  recordAlertCenterLog,
  getUiConfigForEntity,
  getUiConfigOverride,
  upsertUiConfigOverride,
  clearUiConfigOverride,
  getSchedulerIntervalMinutes,
  getFailureReportSchedulerStatus,
  bulkRetryLogs,
  bulkDeleteLogs,
  getDashboardSummary,
  getTenant,
  getPendingEvents,
  markEventComplete,
  getWorkerCheckpoint,
  setWorkerCheckpoint,
  // New functions for retry logic
  getFailedLogsForRetry,
  getIntegrationById,
  markLogAsAbandoned,
  cleanupOldData,
  cleanupStuckRetryingLogs,
  // Template management
  listCustomTemplates,
  getCustomTemplate,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  // Circuit breaker
  checkCircuitState,
  recordDeliverySuccess,
  recordDeliveryFailure,
  // Scheduled integrations
  createScheduledIntegration,
  listScheduledIntegrations,
  getPendingScheduledIntegrations,
  updateScheduledIntegrationStatus,
  resetStuckProcessingIntegrations,
  cancelScheduledIntegrationsByMatch,
  updateScheduledIntegration,
  deleteScheduledIntegration,
  // Duplicate prevention
  saveProcessedEvent,
  isEventAlreadyProcessed,
  // Lookup tables
  listLookups,
  getLookup,
  addLookup,
  updateLookup,
  deleteLookup,
  bulkCreateLookups,
  bulkDeleteLookups,
  resolveLookup,
  reverseLookup,
  getLookupStats,
  getLookupTypes,
  // Event audit functions
  recordEventAudit,
  updateEventAudit,
  listEventAudit,
  getEventAuditById,
  getEventAuditStats,
  updateSourceCheckpoint,
  getSourceCheckpoints,
  getSourceGaps,
  hashPayload,
  extractSafePayload,
  getBucketTimestamp,
  extractSourceMetadata,
  resolveOrgIdFromEvent,
  getSourceIdentifier,
  // Event types
  getEventTypeSamplePayload,
  // Users (JWT auth)
  getUserByEmail,
  getUserById,
  createUser,
  updateUser,
  setUserLastLogin,
  listUsers,
  countUsers,
  listOrganizations,
  getOrganization,
  createOrganization,
  updateOrganization,
  deleteOrganization,
  listOrgUnits,
  createOrgUnit,
  updateOrgUnit,
  deleteOrgUnit,
  listTenantIds,
  listTenantSummaries,
  getUiConfigDefault,
  updateUiConfigDefault
};
