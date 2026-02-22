/**
 * Event Types & Field Schema Routes
 * API endpoints for discovering event types and their field schemas.
 *
 * Per-org model:
 *   orgId: null  = global templates (seeded, read-only for non-super-admins)
 *   orgId: <id>  = org-specific entries (managed by that org)
 *
 * GET endpoints return the union of org-specific + global (org-specific wins on conflict).
 * POST/PUT/DELETE always operate on org-specific entries only.
 */

const express = require('express');
const { log } = require('../logger');
const asyncHandler = require('../utils/async-handler');
const { requirePermission } = require('../middleware/permission');
const { getFieldSchema, getAllFieldSchemas, getAllEventTypes, getEventType } = require('../services/field-schema');

const router = express.Router();

// ---------------------------------------------------------------------------
// GET /api/v1/field-schemas/event-types
// Get all event types visible to this org (global templates + org-specific)
// ---------------------------------------------------------------------------
router.get(
  '/event-types',
  requirePermission('event_catalogue:view'),
  asyncHandler(async (req, res) => {
    try {
      const orgId = req.user?.orgId;
      const includeInactive = req.query.includeInactive === 'true';
      const eventTypes = await getAllEventTypes({ activeOnly: !includeInactive }, orgId);

      res.json({
        eventTypes,
        count: eventTypes.length,
        activeOnly: !includeInactive,
      });
    } catch (error) {
      log('error', 'Failed to get event types', { error: error.message });
      res.status(500).json({ error: 'Failed to retrieve event types', code: 'INTERNAL_ERROR' });
    }
  })
);

// ---------------------------------------------------------------------------
// GET /api/v1/field-schemas/event-types/:eventType
// Get a specific event type (org-specific preferred, falls back to global)
// ---------------------------------------------------------------------------
router.get(
  '/event-types/:eventType',
  requirePermission('event_catalogue:view'),
  asyncHandler(async (req, res) => {
    try {
      const { eventType } = req.params;
      const orgId = req.user?.orgId;
      const eventTypeData = await getEventType(eventType, orgId);

      if (!eventTypeData) {
        return res.status(404).json({ error: 'Event type not found', code: 'NOT_FOUND' });
      }

      res.json(eventTypeData);
    } catch (error) {
      log('error', 'Failed to get event type', { error: error.message, eventType: req.params.eventType });
      res.status(500).json({ error: 'Failed to retrieve event type', code: 'INTERNAL_ERROR' });
    }
  })
);

// ---------------------------------------------------------------------------
// POST /api/v1/field-schemas/event-types
// Create or update an org-specific event type
// ---------------------------------------------------------------------------
router.post(
  '/event-types',
  requirePermission('event_catalogue:manage'),
  asyncHandler(async (req, res) => {
    try {
      const orgId = req.user?.orgId;
      if (!orgId) {
        return res.status(403).json({ error: 'Org context required', code: 'ORG_REQUIRED' });
      }

      const { eventType, label, description, category, isActive, fields, samplePayload } = req.body;

      if (!eventType) {
        return res.status(400).json({ error: 'eventType is required', code: 'MISSING_PARAMETER' });
      }
      if (!fields || !Array.isArray(fields)) {
        return res.status(400).json({ error: 'fields array is required', code: 'MISSING_PARAMETER' });
      }

      const mongodb = require('../mongodb');
      const mongoDb = await mongodb.getDbSafe();

      const eventTypeEntry = {
        eventType,
        orgId,
        label: label || eventType,
        description: description || '',
        category: category || 'Custom',
        isActive: isActive !== false,
        fields,
        ...(samplePayload !== undefined && { samplePayload }),
        updatedAt: new Date(),
      };

      const result = await mongoDb.collection('event_types').updateOne(
        { eventType, orgId },
        {
          $set: eventTypeEntry,
          $setOnInsert: { createdAt: new Date() },
        },
        { upsert: true }
      );

      log('info', 'Org-specific event type saved', {
        eventType,
        orgId,
        fieldCount: fields.length,
        isNew: result.upsertedCount > 0,
      });

      res.json({
        success: true,
        eventType,
        orgId,
        fieldCount: fields.length,
        message: result.upsertedCount > 0 ? 'Event type created' : 'Event type updated',
      });
    } catch (error) {
      log('error', 'Failed to save event type schema', { error: error.message });
      res.status(500).json({ error: 'Failed to save event type schema', code: 'INTERNAL_ERROR' });
    }
  })
);

// ---------------------------------------------------------------------------
// PUT /api/v1/field-schemas/event-types/:eventType
// Update an existing org-specific event type
// ---------------------------------------------------------------------------
router.put(
  '/event-types/:eventType',
  requirePermission('event_catalogue:manage'),
  asyncHandler(async (req, res) => {
    try {
      const orgId = req.user?.orgId;
      if (!orgId) {
        return res.status(403).json({ error: 'Org context required', code: 'ORG_REQUIRED' });
      }

      const { eventType } = req.params;
      const { label, description, category, isActive, fields, samplePayload } = req.body;

      const mongodb = require('../mongodb');
      const mongoDb = await mongodb.getDbSafe();

      const updateFields = { updatedAt: new Date() };
      if (label !== undefined) updateFields.label = label;
      if (description !== undefined) updateFields.description = description;
      if (category !== undefined) updateFields.category = category;
      if (isActive !== undefined) updateFields.isActive = isActive;
      if (fields !== undefined) {
        if (!Array.isArray(fields)) {
          return res.status(400).json({ error: 'fields must be an array', code: 'INVALID_PARAMETER' });
        }
        updateFields.fields = fields;
      }
      if (samplePayload !== undefined) updateFields.samplePayload = samplePayload;

      const result = await mongoDb.collection('event_types').updateOne({ eventType, orgId }, { $set: updateFields });

      if (result.matchedCount === 0) {
        return res.status(404).json({
          error: 'Event type not found in your org catalogue. Use POST to create it.',
          code: 'NOT_FOUND',
        });
      }

      log('info', 'Org-specific event type updated', { eventType, orgId });
      res.json({ success: true, eventType, orgId, message: 'Event type updated' });
    } catch (error) {
      log('error', 'Failed to update event type', { error: error.message });
      res.status(500).json({ error: 'Failed to update event type', code: 'INTERNAL_ERROR' });
    }
  })
);

// ---------------------------------------------------------------------------
// DELETE /api/v1/field-schemas/event-types/:eventType
// Delete an org-specific event type (cannot delete global templates)
// ---------------------------------------------------------------------------
router.delete(
  '/event-types/:eventType',
  requirePermission('event_catalogue:manage'),
  asyncHandler(async (req, res) => {
    try {
      const orgId = req.user?.orgId;
      if (!orgId) {
        return res.status(403).json({ error: 'Org context required', code: 'ORG_REQUIRED' });
      }

      const { eventType } = req.params;

      const mongodb = require('../mongodb');
      const mongoDb = await mongodb.getDbSafe();

      const result = await mongoDb.collection('event_types').deleteOne({ eventType, orgId });

      if (result.deletedCount === 0) {
        return res.status(404).json({
          error: 'Org-specific event type not found. Global templates cannot be deleted.',
          code: 'NOT_FOUND',
        });
      }

      log('info', 'Org-specific event type deleted', { eventType, orgId });
      res.json({ success: true, eventType, message: 'Event type deleted' });
    } catch (error) {
      log('error', 'Failed to delete event type', { error: error.message });
      res.status(500).json({ error: 'Failed to delete event type', code: 'INTERNAL_ERROR' });
    }
  })
);

// ---------------------------------------------------------------------------
// POST /api/v1/field-schemas/event-types/import-templates
// Copy all global templates (orgId: null) into the requesting org's catalogue.
// Skips event types the org already has a custom entry for.
// ---------------------------------------------------------------------------
router.post(
  '/event-types/import-templates',
  requirePermission('event_catalogue:manage'),
  asyncHandler(async (req, res) => {
    try {
      const orgId = req.user?.orgId;
      if (!orgId) {
        return res.status(403).json({ error: 'Org context required', code: 'ORG_REQUIRED' });
      }

      const mongodb = require('../mongodb');
      const mongoDb = await mongodb.getDbSafe();
      const collection = mongoDb.collection('event_types');

      // Fetch all global templates
      const globalTemplates = await collection.find({ orgId: null }).toArray();
      if (globalTemplates.length === 0) {
        return res.json({ success: true, imported: 0, skipped: 0, message: 'No global templates found' });
      }

      let imported = 0;
      let skipped = 0;

      for (const template of globalTemplates) {
        // Only import if org doesn't already have a custom version
        const existing = await collection.findOne({ eventType: template.eventType, orgId });
        if (existing) {
          skipped++;
          continue;
        }

        const { _id, orgId: _globalOrgId, createdAt: _c, updatedAt: _u, ...templateData } = template;
        await collection.insertOne({
          ...templateData,
          orgId,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        imported++;
      }

      log('info', 'Global templates imported into org', { orgId, imported, skipped });
      res.json({
        success: true,
        imported,
        skipped,
        message: `Imported ${imported} template(s), skipped ${skipped} already customized`,
      });
    } catch (error) {
      log('error', 'Failed to import templates', { error: error.message });
      res.status(500).json({ error: 'Failed to import templates', code: 'INTERNAL_ERROR' });
    }
  })
);

// ---------------------------------------------------------------------------
// GET /api/v1/field-schemas
// Backward compatibility endpoint — get all schemas or for a specific event type
// ---------------------------------------------------------------------------
router.get(
  '/',
  requirePermission('event_catalogue:view'),
  asyncHandler(async (req, res) => {
    try {
      const orgId = req.user?.orgId;
      const { eventType } = req.query;

      if (eventType) {
        const fields = await getFieldSchema(eventType, orgId);
        return res.json({ eventType, fields, count: fields.length });
      }

      const schemas = await getAllFieldSchemas(orgId);
      res.json({ schemas, eventTypes: Object.keys(schemas) });
    } catch (error) {
      log('error', 'Failed to get field schemas', { error: error.message });
      res.status(500).json({ error: 'Failed to retrieve field schemas', code: 'INTERNAL_ERROR' });
    }
  })
);

module.exports = router;
