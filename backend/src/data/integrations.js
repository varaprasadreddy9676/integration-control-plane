'use strict';
const { log, logError } = require('../logger');
const mongodb = require('../mongodb');
const { generateSigningSecret } = require('../services/integration-signing');
const {
  useMongo,
  normalizeOrgId,
  integrationOrgQuery,
  buildOrgScopeQuery,
  addOrgScope,
  fallbackDisabledError,
  getCollection,
  mapIntegrationFromMongo
} = require('./helpers');

const allowedParentsCache = {
  values: null,
  fetchedAt: 0
};

async function getAllowedParentRids() {
  const config = require('../config');
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

module.exports = {
  allowedParentsCache,
  getAllowedParentRids,
  listIntegrations,
  listIntegrationsForDelivery,
  getParentRidForEntity,
  getIntegration,
  addIntegration,
  updateIntegration,
  getIntegrationByTypeAndDirection,
  deleteIntegration,
  bulkUpdateIntegrations,
  bulkDeleteIntegrations,
  listEventTypes,
  getIntegrationById
};
