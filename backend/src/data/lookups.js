'use strict';
const { log, logError } = require('../logger');
const mongodb = require('../mongodb');
const { parsePositiveInt } = require('../utils/org-context');
const { useMongo, normalizeOrgId, addOrgScope, fallbackDisabledError } = require('./helpers');

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
    updatedAt: doc.updatedAt?.toISOString() || new Date().toISOString(),
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
    const filteredOrgUnitRid =
      filters.orgUnitRid !== undefined
        ? filters.orgUnitRid
        : filters.entityRid !== undefined
          ? filters.entityRid
          : undefined;
    if (filteredOrgUnitRid !== undefined) {
      query.$or = [{ orgUnitRid: filteredOrgUnitRid }, { entityRid: filteredOrgUnitRid }];
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

    const lookups = await db
      .collection('lookups')
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
    const lookup = await db.collection('lookups').findOne({ _id: mongodb.toObjectId(id) });

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

    const normalizedOrgUnitRid =
      payload.orgUnitRid !== undefined
        ? parsePositiveInt(payload.orgUnitRid)
        : payload.entityRid !== undefined
          ? parsePositiveInt(payload.entityRid)
          : null;

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
      updatedAt: now,
    };

    const result = await db.collection('lookups').insertOne(lookup);
    lookup._id = result.insertedId;

    log('info', 'Lookup created', {
      id: result.insertedId.toString(),
      type: payload.type,
      sourceId: payload.source.id,
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
      updatedAt: now,
    };
    if (
      Object.prototype.hasOwnProperty.call(updateDoc, 'orgUnitRid') ||
      Object.prototype.hasOwnProperty.call(updateDoc, 'entityRid')
    ) {
      const normalizedOrgUnitRid =
        updateDoc.orgUnitRid !== undefined
          ? parsePositiveInt(updateDoc.orgUnitRid)
          : updateDoc.entityRid !== undefined
            ? parsePositiveInt(updateDoc.entityRid)
            : null;
      updateDoc.orgUnitRid = normalizedOrgUnitRid;
      delete updateDoc.entityRid;
    }

    await db
      .collection('lookups')
      .updateOne(addOrgScope({ _id: mongodb.toObjectId(id) }, normalizedOrgId), { $set: updateDoc });

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
      ...addOrgScope({ _id: mongodb.toObjectId(id) }, normalizedOrgId),
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
    const orgUnitRid =
      options.orgUnitRid !== undefined
        ? options.orgUnitRid
        : options.entityRid !== undefined
          ? options.entityRid
          : undefined;

    // If mode=replace, deactivate ALL existing active mappings for this type+scope
    if (mode === 'replace' && type) {
      const query = addOrgScope({ type, isActive: true }, normalizedOrgId);
      if (orgUnitRid !== undefined) {
        query.$or = [{ orgUnitRid }, { entityRid: orgUnitRid }];
      }
      await db.collection('lookups').updateMany(query, { $set: { isActive: false, updatedAt: now } });
      log('info', 'Deactivated existing lookups for replace mode', { orgId: normalizedOrgId, type, orgUnitRid });
    }

    let insertedCount = 0;
    let updatedCount = 0;
    const errors = [];

    for (const lookupData of lookups) {
      try {
        const normalizedOrgUnitRid =
          lookupData.orgUnitRid !== undefined
            ? parsePositiveInt(lookupData.orgUnitRid)
            : lookupData.entityRid !== undefined
              ? parsePositiveInt(lookupData.entityRid)
              : null;
        // Check for existing active mapping
        const existingQuery = {
          $or: [{ orgUnitRid: normalizedOrgUnitRid }, { entityRid: normalizedOrgUnitRid }],
          type: lookupData.type,
          'source.id': lookupData.source.id,
          isActive: true,
        };
        addOrgScope(existingQuery, normalizeOrgId(lookupData.orgId || normalizedOrgId));

        const existing = await db.collection('lookups').findOne(existingQuery);

        if (existing) {
          // Deactivate old version
          await db
            .collection('lookups')
            .updateOne({ _id: existing._id }, { $set: { isActive: false, updatedAt: now } });
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
          updatedAt: now,
        };

        await db.collection('lookups').insertOne(lookup);
        insertedCount++;
      } catch (err) {
        errors.push({
          sourceId: lookupData.source?.id,
          error: err.message,
        });
        log('warn', 'Failed to insert lookup', {
          sourceId: lookupData.source?.id,
          error: err.message,
        });
      }
    }

    log('info', 'Bulk lookup import completed', {
      orgId,
      normalizedOrgId,
      requested: lookups.length,
      inserted: insertedCount,
      updated: updatedCount,
      errors: errors.length,
    });

    return {
      insertedCount,
      updatedCount,
      errors,
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
      ...addOrgScope({}, normalizedOrgId),
    });

    log('info', 'Bulk lookup delete completed', {
      scope: 'bulkDeleteLookups',
      requested: ids.length,
      deleted: result.deletedCount,
      failed: failedIds.length,
    });

    return {
      deletedCount: result.deletedCount,
      failedIds,
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
      const entitySpecific = await db.collection('lookups').findOne(
        addOrgScope(
          {
            $or: [{ orgUnitRid: normalizedOrgUnitRid }, { entityRid: normalizedOrgUnitRid }],
            type,
            'source.id': sourceId,
            isActive: true,
          },
          normalizedOrgId
        )
      );

      if (entitySpecific) {
        // Update usage tracking (non-blocking)
        db.collection('lookups')
          .updateOne(
            { _id: entitySpecific._id },
            {
              $inc: { usageCount: 1 },
              $set: { lastUsedAt: new Date() },
            }
          )
          .catch((err) => log('warn', 'Failed to update lookup usage', { error: err.message }));

        return entitySpecific.target.id;
      }
    }

    // Step 2: Fallback to parent-level mapping
    const parentLevel = await db.collection('lookups').findOne(
      addOrgScope(
        {
          $or: [
            { orgUnitRid: null },
            { orgUnitRid: { $exists: false }, entityRid: null },
            { orgUnitRid: { $exists: false }, entityRid: { $exists: false } },
            { entityRid: null },
            { entityRid: { $exists: false } },
          ],
          type,
          'source.id': sourceId,
          isActive: true,
        },
        normalizedOrgId
      )
    );

    if (parentLevel) {
      // Update usage tracking (non-blocking)
      db.collection('lookups')
        .updateOne(
          { _id: parentLevel._id },
          {
            $inc: { usageCount: 1 },
            $set: { lastUsedAt: new Date() },
          }
        )
        .catch((err) => log('warn', 'Failed to update lookup usage', { error: err.message }));

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
      const entitySpecific = await db.collection('lookups').findOne(
        addOrgScope(
          {
            $or: [{ orgUnitRid: normalizedOrgUnitRid }, { entityRid: normalizedOrgUnitRid }],
            type,
            'target.id': targetId,
            isActive: true,
          },
          normalizedOrgId
        )
      );

      if (entitySpecific) {
        return {
          sourceId: entitySpecific.source.id,
          scope: 'entity',
        };
      }
    }

    // Step 2: Fallback to parent-level mapping
    const parentLevel = await db.collection('lookups').findOne(
      addOrgScope(
        {
          $or: [
            { orgUnitRid: null },
            { orgUnitRid: { $exists: false }, entityRid: null },
            { orgUnitRid: { $exists: false }, entityRid: { $exists: false } },
            { entityRid: null },
            { entityRid: { $exists: false } },
          ],
          type,
          'target.id': targetId,
          isActive: true,
        },
        normalizedOrgId
      )
    );

    if (parentLevel) {
      return {
        sourceId: parentLevel.source.id,
        scope: 'parent',
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

    const stats = await db
      .collection('lookups')
      .aggregate([
        { $match: matchQuery },
        {
          $group: {
            _id: '$type',
            total: { $sum: 1 },
            active: {
              $sum: { $cond: [{ $eq: ['$isActive', true] }, 1, 0] },
            },
            inactive: {
              $sum: { $cond: [{ $eq: ['$isActive', false] }, 1, 0] },
            },
            totalUsage: { $sum: '$usageCount' },
          },
        },
        { $sort: { _id: 1 } },
      ])
      .toArray();

    return stats.map((stat) => ({
      type: stat._id,
      total: stat.total,
      active: stat.active,
      inactive: stat.inactive,
      totalUsage: stat.totalUsage,
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
    const types = await db.collection('lookups').distinct('type', addOrgScope({}, normalizeOrgId(orgId)));

    return types.sort();
  } catch (err) {
    logError(err, { scope: 'getLookupTypes' });
    throw err;
  }
}

module.exports = {
  mapLookupFromMongo,
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
};
