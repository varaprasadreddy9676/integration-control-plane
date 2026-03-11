/**
 * Event Types & Field Schema Routes
 * API endpoints for discovering event types and their field schemas
 */

const express = require('express');
const { log } = require('../logger');
const asyncHandler = require('../utils/async-handler');
const {
  getFieldSchema,
  getAllFieldSchemas,
  getAllEventTypes,
  getEventType
} = require('../services/field-schema');

const router = express.Router();

/**
 * GET /api/v1/field-schemas/event-types
 * Get all event types with their metadata and field schemas
 * This is the primary endpoint for populating event type dropdowns
 * Query params:
 *   - includeInactive: Set to 'true' to include inactive event types (default: false)
 */
router.get('/event-types', asyncHandler(async (req, res) => {
  try {
    const includeInactive = req.query.includeInactive === 'true';
    const eventTypes = await getAllEventTypes({ activeOnly: !includeInactive });

    res.json({
      eventTypes,
      count: eventTypes.length,
      activeOnly: !includeInactive
    });
  } catch (error) {
    log('error', 'Failed to get event types', { error: error.message });
    res.status(500).json({
      error: 'Failed to retrieve event types',
      code: 'INTERNAL_ERROR'
    });
  }
}));

/**
 * GET /api/v1/field-schemas/event-types/:eventType
 * Get a specific event type with its field schema
 */
router.get('/event-types/:eventType', asyncHandler(async (req, res) => {
  try {
    const { eventType } = req.params;
    const eventTypeData = await getEventType(eventType);

    if (!eventTypeData) {
      return res.status(404).json({
        error: 'Event type not found',
        code: 'NOT_FOUND'
      });
    }

    res.json(eventTypeData);
  } catch (error) {
    log('error', 'Failed to get event type', { error: error.message, eventType: req.params.eventType });
    res.status(500).json({
      error: 'Failed to retrieve event type',
      code: 'INTERNAL_ERROR'
    });
  }
}));

/**
 * GET /api/v1/field-schemas
 * Get all field schemas or for a specific event type
 * (Backward compatibility endpoint)
 */
router.get('/', asyncHandler(async (req, res) => {
  try {
    const { eventType } = req.query;

    if (eventType) {
      // Get schema for specific event type
      const fields = await getFieldSchema(eventType);

      return res.json({
        eventType,
        fields,
        count: fields.length
      });
    }

    // Get all schemas
    const schemas = await getAllFieldSchemas();

    res.json({
      schemas,
      eventTypes: Object.keys(schemas)
    });
  } catch (error) {
    log('error', 'Failed to get field schemas', { error: error.message });
    res.status(500).json({
      error: 'Failed to retrieve field schemas',
      code: 'INTERNAL_ERROR'
    });
  }
}));


/**
 * POST /api/v1/field-schemas/event-types
 * Manually create or update an event type with its schema
 */
router.post('/event-types', asyncHandler(async (req, res) => {
  try {
    const { eventType, label, description, fields } = req.body;

    if (!eventType) {
      return res.status(400).json({
        error: 'eventType is required',
        code: 'MISSING_PARAMETER'
      });
    }

    if (!fields || !Array.isArray(fields)) {
      return res.status(400).json({
        error: 'fields array is required',
        code: 'MISSING_PARAMETER'
      });
    }

    const mongodb = require('../mongodb');
    const mongoDb = await mongodb.getDbSafe();

    const eventTypeEntry = {
      eventType,
      label: label || eventType,
      description: description || 'Manually configured event type',
      fields,
      updatedAt: new Date()
    };

    const result = await mongoDb.collection('event_types').updateOne(
      { eventType },
      {
        $set: eventTypeEntry,
        $setOnInsert: { createdAt: new Date() }
      },
      { upsert: true }
    );

    log('info', 'Event type schema saved', {
      eventType,
      fieldCount: fields.length,
      isNew: result.upsertedCount > 0
    });

    res.json({
      success: true,
      eventType,
      fieldCount: fields.length,
      message: result.upsertedCount > 0 ? 'Event type created' : 'Event type updated'
    });
  } catch (error) {
    log('error', 'Failed to save event type schema', { error: error.message });
    res.status(500).json({
      error: 'Failed to save event type schema',
      code: 'INTERNAL_ERROR'
    });
  }
}));

module.exports = router;
