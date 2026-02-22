const express = require('express');
const data = require('../data');
const { log } = require('../logger');
const asyncHandler = require('../utils/async-handler');
const { executeSchedulingScript } = require('../services/scheduler');
const { auditScheduledIntegration } = require('../middleware/audit');

const router = express.Router();

/**
 * GET /api/v1/scheduled-integrations
 * List scheduled integrations with optional filters
 */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const filters = {
      status: req.query.status, // PENDING | SENT | FAILED | CANCELLED | OVERDUE
      integrationConfigId: req.query.integrationConfigId,
      eventType: req.query.eventType,
      limit: parseInt(req.query.limit, 10) || 500,
    };

    const scheduledIntegrations = await data.listScheduledIntegrations(req.orgId, filters);

    log('info', 'Listed scheduled integrations', {
      orgId: req.orgId,
      count: scheduledIntegrations.length,
      filters,
    });

    res.json({ scheduledIntegrations });
  })
);

/**
 * POST /api/v1/scheduled-integrations/validate
 * Validate a scheduling script without saving
 */
router.post(
  '/validate',
  asyncHandler(async (req, res) => {
    const { script, deliveryMode, timezone = 'UTC', eventType } = req.body;

    if (!script) {
      return res.status(400).json({
        success: false,
        error: 'Script is required',
        code: 'VALIDATION_ERROR',
      });
    }

    if (!deliveryMode || !['DELAYED', 'RECURRING'].includes(deliveryMode)) {
      return res.status(400).json({
        success: false,
        error: 'deliveryMode must be DELAYED or RECURRING',
        code: 'VALIDATION_ERROR',
      });
    }

    // Get event-specific sample payload if eventType is provided
    let mockEvent = null;
    if (eventType) {
      const eventTypeSample = await data.getEventTypeSamplePayload(eventType);
      if (eventTypeSample) {
        mockEvent = {
          ...eventTypeSample,
          sample: true,
          testMode: true,
          timestamp: eventTypeSample.timestamp || new Date().toISOString(),
          createdAt: eventTypeSample.createdAt || new Date().toISOString(),
        };
        log('info', 'Using event-specific sample payload for validation', { eventType });
      }
    }

    // Fallback to generic appointment-based sample if no event-specific sample found
    if (!mockEvent) {
      const futureApptTime = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000); // 3 days from now
      mockEvent = {
        sample: true,
        testMode: true,
        timestamp: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        arrivedAt: new Date().toISOString(),
        // Generic appointment data (for templates when event type is unknown)
        appt: {
          apptDate: futureApptTime.toISOString().split('T')[0],
          fromDate: futureApptTime.toISOString().split('T')[0],
          apptTime: '14:00:00',
          fromTime: '14:00:00',
          patientName: 'Test Patient',
          reasonForVisit: 'new consult',
        },
        patient: {
          fullName: 'Test Patient',
          phone: '9876543210',
          uhid: 'TEST_UHID_001',
        },
        appointmentDateTime: futureApptTime.toISOString(),
        patientRid: 12345,
        eventType: 'TEST_EVENT',
        patientName: 'Test Patient',
      };
      log('debug', 'Using generic appointment sample payload for validation', { eventType });
    }

    try {
      const result = await executeSchedulingScript(script, mockEvent, { timezone });

      // Validate result based on delivery mode
      if (deliveryMode === 'DELAYED') {
        if (typeof result !== 'number') {
          return res.status(400).json({
            success: false,
            error: `DELAYED mode must return a number (timestamp). Got: ${typeof result}`,
            code: 'VALIDATION_ERROR',
          });
        }
        const isOverdue = result <= Date.now();

        log('info', 'Scheduling script validated (DELAYED)', {
          orgId: req.orgId,
          scheduledFor: new Date(result).toISOString(),
          isOverdue,
        });

        return res.json({
          success: true,
          message: isOverdue
            ? `Valid DELAYED script. Sample calculation shows scheduled time in the past (would be marked OVERDUE): ${new Date(result).toISOString()}`
            : `Valid DELAYED script. Sample calculation schedules for: ${new Date(result).toISOString()} (actual time depends on real event data)`,
          result: {
            type: 'DELAYED',
            scheduledFor: new Date(result).toISOString(),
            timestamp: result,
            isOverdue,
          },
        });
      }

      if (deliveryMode === 'RECURRING') {
        if (typeof result !== 'object' || result === null) {
          return res.status(400).json({
            success: false,
            error: `RECURRING mode must return an object. Got: ${typeof result}`,
            code: 'VALIDATION_ERROR',
          });
        }
        if (!result.firstOccurrence || typeof result.firstOccurrence !== 'number') {
          return res.status(400).json({
            success: false,
            error: 'RECURRING config missing valid firstOccurrence (number)',
            code: 'VALIDATION_ERROR',
          });
        }
        if (!result.intervalMs || typeof result.intervalMs !== 'number' || result.intervalMs < 60000) {
          return res.status(400).json({
            success: false,
            error: 'RECURRING config missing valid intervalMs (number >= 60000)',
            code: 'VALIDATION_ERROR',
          });
        }
        if (!result.maxOccurrences && !result.endDate) {
          return res.status(400).json({
            success: false,
            error: 'RECURRING config must have either maxOccurrences or endDate',
            code: 'VALIDATION_ERROR',
          });
        }
        if (result.maxOccurrences && (result.maxOccurrences < 2 || result.maxOccurrences > 365)) {
          return res.status(400).json({
            success: false,
            error: 'RECURRING maxOccurrences must be between 2-365',
            code: 'VALIDATION_ERROR',
          });
        }

        log('info', 'Scheduling script validated (RECURRING)', {
          orgId: req.orgId,
          firstOccurrence: new Date(result.firstOccurrence).toISOString(),
          intervalMs: result.intervalMs,
          maxOccurrences: result.maxOccurrences,
        });

        return res.json({
          success: true,
          message: `Valid RECURRING script. Sample calculation - First: ${new Date(result.firstOccurrence).toISOString()}, Interval: ${result.intervalMs}ms, Max: ${result.maxOccurrences || 'until endDate'} (actual times depend on real event data)`,
          result: {
            type: 'RECURRING',
            firstOccurrence: new Date(result.firstOccurrence).toISOString(),
            intervalMs: result.intervalMs,
            maxOccurrences: result.maxOccurrences,
            endDate: result.endDate ? new Date(result.endDate).toISOString() : null,
          },
        });
      }
    } catch (err) {
      log('error', 'Scheduling script validation failed', {
        orgId: req.orgId,
        error: err.message,
      });

      return res.status(400).json({
        success: false,
        error: err.message || 'Script execution failed',
        code: 'SCRIPT_ERROR',
      });
    }
  })
);

/**
 * DELETE /api/v1/scheduled-integrations/bulk
 * Bulk delete/cancel scheduled integrations
 * NOTE: Must be before /:id route to avoid matching "bulk" as an ID
 */
router.delete(
  '/bulk',
  asyncHandler(async (req, res) => {
    const { ids } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({
        error: 'ids array is required',
        code: 'VALIDATION_ERROR',
      });
    }

    let deletedCount = 0;
    const failedIds = [];

    for (const id of ids) {
      try {
        const success = await data.deleteScheduledIntegration(req.orgId, id);
        if (success) {
          deletedCount++;
        } else {
          failedIds.push(id);
        }
      } catch (_err) {
        failedIds.push(id);
      }
    }

    log('info', 'Bulk scheduled integrations deletion', {
      orgId: req.orgId,
      total: ids.length,
      deleted: deletedCount,
      failed: failedIds.length,
    });

    const succeededIds = ids.filter((id) => !failedIds.includes(id));
    await auditScheduledIntegration.bulkCancelled(req, succeededIds);

    res.json({
      message: `Successfully deleted ${deletedCount} scheduled integration(s)`,
      deletedCount,
      failedIds,
    });
  })
);

/**
 * PATCH /api/v1/scheduled-integrations/:id
 * Update a scheduled integration (e.g., change scheduled time)
 */
router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { scheduledFor } = req.body;

    if (!scheduledFor) {
      return res.status(400).json({
        error: 'scheduledFor is required',
        code: 'VALIDATION_ERROR',
      });
    }

    // Validate scheduledFor is a valid date
    const scheduledForDate = new Date(scheduledFor);
    if (Number.isNaN(scheduledForDate.getTime())) {
      return res.status(400).json({
        error: 'Invalid scheduledFor date',
        code: 'VALIDATION_ERROR',
      });
    }

    const success = await data.updateScheduledIntegration(req.orgId, id, {
      scheduledFor: scheduledForDate,
    });

    if (!success) {
      return res.status(404).json({
        error: 'Scheduled integration not found',
        code: 'NOT_FOUND',
      });
    }

    log('info', 'Scheduled integration updated', {
      orgId: req.orgId,
      scheduledIntegrationId: id,
      scheduledFor: scheduledForDate.toISOString(),
    });

    res.json({
      message: 'Scheduled integration updated successfully',
      scheduledFor: scheduledForDate.toISOString(),
    });
  })
);

/**
 * DELETE /api/v1/scheduled-integrations/:id
 * Cancel a scheduled integration
 */
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    const success = await data.deleteScheduledIntegration(req.orgId, id);

    if (!success) {
      return res.status(404).json({
        error: 'Scheduled integration not found',
        code: 'NOT_FOUND',
      });
    }

    log('info', 'Scheduled integration cancelled', {
      orgId: req.orgId,
      scheduledIntegrationId: id,
    });

    await auditScheduledIntegration.cancelled(req, id);

    res.json({
      message: 'Scheduled integration cancelled successfully',
    });
  })
);

module.exports = router;
