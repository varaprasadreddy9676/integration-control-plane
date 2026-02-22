/**
 * Event Type & Field Schema Service
 * Simple CRUD operations for event_types collection
 * Schemas are manually added/updated via API - no auto-discovery
 *
 * orgId: null  = global templates (platform-seeded, visible to all orgs, read-only for non-super-admins)
 * orgId: <id>  = org-specific event types (fully managed by that org)
 *
 * Reads always merge both; org-specific wins on eventType collision.
 */

const { log } = require('../logger');
const mongodb = require('../mongodb');

/**
 * Build the query that returns org-specific docs UNION global templates.
 * When orgId is falsy (e.g. unauthenticated) return only global templates.
 */
function buildOrgQuery(baseQuery, orgId) {
  if (!orgId) {
    return { ...baseQuery, orgId: null };
  }
  return { ...baseQuery, $or: [{ orgId }, { orgId: null }] };
}

/**
 * Deduplicate an array of event type docs so that an org-specific doc always
 * wins over a global template with the same eventType identifier.
 */
function deduplicateByEventType(docs) {
  const byType = new Map();
  for (const doc of docs) {
    const key = doc.eventType || doc.type;
    if (!key) continue;
    const existing = byType.get(key);
    if (
      !existing ||
      (doc.orgId !== null && doc.orgId !== undefined && (existing.orgId === null || existing.orgId === undefined))
    ) {
      byType.set(key, doc);
    }
  }
  return [...byType.values()];
}

/**
 * Get all event types with their schemas visible to an org.
 * Returns org-specific types and global templates, org-specific wins on conflict.
 * @param {Object} options - Filter options
 * @param {boolean} options.activeOnly - Return only active event types (default: true)
 * @param {number|string|null} orgId - Requesting org's ID
 */
async function getAllEventTypes(options, orgId) {
  try {
    const db = await mongodb.getDbSafe();
    const collection = db.collection('event_types');

    const activeOnly = options.activeOnly !== false;
    const baseQuery = activeOnly ? { isActive: true } : {};
    const query = buildOrgQuery(baseQuery, orgId);

    const docs = await collection.find(query).toArray();
    const eventTypes = deduplicateByEventType(docs);

    log('info', 'Retrieved all event types', { count: eventTypes.length, activeOnly, orgId });
    return eventTypes;
  } catch (error) {
    log('error', 'Failed to get all event types', { error: error.message });
    return [];
  }
}

/**
 * Get a single event type entry with field schema, org-specific preferred.
 * @param {string} eventType - Event type identifier
 * @param {number|string|null} orgId - Requesting org's ID
 */
async function getEventType(eventType, orgId) {
  try {
    const db = await mongodb.getDbSafe();
    const collection = db.collection('event_types');

    if (orgId) {
      // Try org-specific first
      const orgSpecific = await collection.findOne({ eventType, orgId });
      if (orgSpecific) return orgSpecific;
    }

    // Fall back to global template
    const global = await collection.findOne({ eventType, orgId: null });
    if (!global) {
      // Last resort: any doc with this eventType (backward compat for docs without orgId field)
      const legacy = await collection.findOne({ eventType });
      if (!legacy) {
        log('warn', 'Event type not found', { eventType, orgId });
        return null;
      }
      return legacy;
    }

    log('debug', 'Retrieved event type schema', { eventType, fieldCount: global.fields?.length || 0 });
    return global;
  } catch (error) {
    log('error', 'Failed to get event type', { eventType, error: error.message });
    return null;
  }
}

/**
 * Get field schema for an event type (backward compatibility)
 * @param {string} eventType
 * @param {number|string|null} orgId
 */
async function getFieldSchema(eventType, orgId) {
  const eventTypeEntry = await getEventType(eventType, orgId);
  return eventTypeEntry?.fields || [];
}

/**
 * Get field schemas for all known event types (backward compatibility)
 * @param {number|string|null} orgId
 */
async function getAllFieldSchemas(orgId) {
  const eventTypes = await getAllEventTypes({}, orgId);
  const schemas = {};
  for (const et of eventTypes) {
    schemas[et.eventType] = et.fields;
  }
  return schemas;
}

module.exports = {
  getFieldSchema,
  getAllFieldSchemas,
  getAllEventTypes,
  getEventType,
};
