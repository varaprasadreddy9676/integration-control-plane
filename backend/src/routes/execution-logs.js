const express = require('express');
const asyncHandler = require('../utils/async-handler');
const executionLogsData = require('../data/execution-logs');
const { log } = require('../logger');

const router = express.Router();

/**
 * GET /api/v1/execution-logs
 * List execution logs with filters
 */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const {
      direction,
      triggerType,
      status,
      integrationConfigId,
      messageId,
      search,
      startDate,
      endDate,
      groupBy,
      page,
      limit,
      offset,
    } = req.query;

    const filters = {
      direction,
      triggerType,
      status,
      integrationConfigId,
      messageId,
      search,
      startDate,
      endDate,
    };

    // Remove undefined/null filters
    Object.keys(filters).forEach((key) => {
      if (!filters[key]) delete filters[key];
    });

    const pagination = {
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : 50,
      offset: offset ? parseInt(offset, 10) : 0,
    };
    if (!pagination.page && pagination.offset > 0 && pagination.limit > 0) {
      pagination.page = Math.floor(pagination.offset / pagination.limit) + 1;
    } else if (!pagination.page) {
      pagination.page = 1;
    }

    const groupMode = (groupBy || 'log').toLowerCase();
    const result =
      groupMode === 'log'
        ? await executionLogsData.listExecutionLogs(req.orgId, filters, pagination)
        : await executionLogsData.listExecutionTraces(req.orgId, filters, pagination);

    res.json({
      success: true,
      data: result.logs,
      pagination: {
        total: result.total,
        limit: result.limit,
        offset: (result.page - 1) * result.limit,
        hasMore: result.hasMore,
      },
    });
  })
);

/**
 * GET /api/v1/execution-logs/stats
 * Get execution statistics
 */
router.get(
  '/stats',
  asyncHandler(async (req, res) => {
    const { direction, integrationConfigId, startDate, endDate } = req.query;

    const filters = {
      direction,
      integrationConfigId,
      startDate,
      endDate,
    };

    // Remove undefined/null filters
    Object.keys(filters).forEach((key) => {
      if (!filters[key]) delete filters[key];
    });

    const stats = await executionLogsData.getExecutionStats(req.orgId, filters);

    res.json({
      success: true,
      data: stats,
    });
  })
);

/**
 * GET /api/v1/execution-logs/:traceId
 * Get detailed execution log with all steps
 */
router.get(
  '/:traceId',
  asyncHandler(async (req, res) => {
    const { traceId } = req.params;

    const executionLog = await executionLogsData.getExecutionLog(traceId, req.orgId);

    if (!executionLog) {
      return res.status(404).json({
        success: false,
        error: 'Execution log not found',
        code: 'NOT_FOUND',
      });
    }

    res.json({
      success: true,
      data: executionLog,
    });
  })
);

/**
 * GET /api/v1/execution-logs/:traceId/timeline
 * Get execution timeline visualization data
 */
router.get(
  '/:traceId/timeline',
  asyncHandler(async (req, res) => {
    const { traceId } = req.params;

    const trace = await executionLogsData.getExecutionTrace(traceId, req.orgId);
    if (!trace) {
      return res.status(404).json({
        success: false,
        error: 'Execution log not found',
        code: 'NOT_FOUND',
      });
    }

    res.json({
      success: true,
      data: trace,
    });
  })
);

/**
 * DELETE /api/v1/execution-logs/cleanup
 * Manual cleanup of old execution logs
 */
router.delete(
  '/cleanup',
  asyncHandler(async (req, res) => {
    const { daysOld } = req.body;

    if (!daysOld || daysOld < 7) {
      return res.status(400).json({
        success: false,
        error: 'daysOld must be at least 7 days',
        code: 'VALIDATION_ERROR',
      });
    }

    const deletedCount = await executionLogsData.deleteOldExecutionLogs(daysOld);

    log('info', 'Manual execution logs cleanup', {
      orgId: req.orgId,
      daysOld,
      deletedCount,
    });

    res.json({
      success: true,
      message: `Deleted ${deletedCount} execution log(s) older than ${daysOld} days`,
      deletedCount,
    });
  })
);

module.exports = router;
