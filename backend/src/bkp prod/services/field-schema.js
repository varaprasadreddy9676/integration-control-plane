/**
 * Event Type & Field Schema Service
 * Simple CRUD operations for event_types collection
 * Schemas are manually added/updated via API - no auto-discovery
 */

const { log } = require('../logger');
const mongodb = require('../mongodb');

/**
 * Get event type entry with field schema
 */
async function getEventType(eventType) {
  try {
    const db = await mongodb.getDbSafe();
    const collection = db.collection('event_types');

    const eventTypeData = await collection.findOne({ eventType });

    if (!eventTypeData) {
      log('warn', 'Event type not found', { eventType });
      return null;
    }

    log('debug', 'Retrieved event type schema', { eventType, fieldCount: eventTypeData.fields?.length || 0 });
    return eventTypeData;
  } catch (error) {
    log('error', 'Failed to get event type', { eventType, error: error.message });
    return null;
  }
}

/**
 * Get field schema for an event type (backward compatibility)
 */
async function getFieldSchema(eventType) {
  const eventTypeEntry = await getEventType(eventType);
  return eventTypeEntry?.fields || [];
}

/**
 * Get all event types with their schemas
 * @param {Object} options - Filter options
 * @param {boolean} options.activeOnly - Return only active event types (default: true)
 */
async function getAllEventTypes(options = {}) {
  try {
    const db = await mongodb.getDbSafe();
    const collection = db.collection('event_types');

    // Default to active only unless explicitly set to false
    const activeOnly = options.activeOnly !== false;
    const query = activeOnly ? { isActive: true } : {};

    const eventTypes = await collection.find(query).toArray();

    log('info', 'Retrieved all event types', { count: eventTypes.length, activeOnly });
    return eventTypes;
  } catch (error) {
    log('error', 'Failed to get all event types', { error: error.message });
    return [];
  }
}

/**
 * Get field schemas for all known event types (backward compatibility)
 */
async function getAllFieldSchemas() {
  const eventTypes = await getAllEventTypes();
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
  getEventType
};
