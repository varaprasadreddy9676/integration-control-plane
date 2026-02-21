const express = require('express');
const asyncHandler = require('../utils/async-handler');
const dlqData = require('../data/dlq');
const { log } = require('../logger');

const router = express.Router();

/**
 * GET /api/v1/dlq
 * List DLQ entries with filters
 */
router.get('/', asyncHandler(async (req, res) => {
  const {
    status,
    integrationConfigId,
    errorCategory,
    errorCode,
    direction,
    startDate,
    endDate,
    limit,
    offset
  } = req.query;

  const filters = {
    status,
    integrationConfigId,
    errorCategory,
    errorCode,
    direction,
    startDate,
    endDate
  };

  // Remove undefined/null filters
  Object.keys(filters).forEach(key => {
    if (!filters[key]) delete filters[key];
  });

  const pagination = {
    limit: limit ? parseInt(limit, 10) : 50,
    offset: offset ? parseInt(offset, 10) : 0
  };

  const result = await dlqData.listDLQEntries(req.orgId, filters, pagination);

  res.json({
    success: true,
    data: result.entries,
    pagination: {
      total: result.total,
      limit: result.limit,
      offset: result.offset,
      hasMore: result.hasMore
    }
  });
}));

/**
 * GET /api/v1/dlq/stats
 * Get DLQ statistics
 */
router.get('/stats', asyncHandler(async (req, res) => {
  const {
    integrationConfigId,
    startDate,
    endDate
  } = req.query;

  const filters = {
    integrationConfigId,
    startDate,
    endDate
  };

  // Remove undefined/null filters
  Object.keys(filters).forEach(key => {
    if (!filters[key]) delete filters[key];
  });

  const stats = await dlqData.getDLQStats(req.orgId, filters);

  res.json({
    success: true,
    data: stats
  });
}));

/**
 * GET /api/v1/dlq/:dlqId
 * Get specific DLQ entry
 */
router.get('/:dlqId', asyncHandler(async (req, res) => {
  const { dlqId } = req.params;

  const entry = await dlqData.getDLQEntry(dlqId, req.orgId);

  if (!entry) {
    return res.status(404).json({
      success: false,
      error: 'DLQ entry not found',
      code: 'NOT_FOUND'
    });
  }

  res.json({
    success: true,
    data: entry
  });
}));

/**
 * DELETE /api/v1/dlq/:dlqId
 * Delete a DLQ entry
 */
router.delete('/:dlqId', asyncHandler(async (req, res) => {
  const { dlqId } = req.params;
  const userId = req.user?.id || 'system';

  await dlqData.deleteDLQEntry(dlqId, req.orgId);

  log('info', 'DLQ entry deleted', {
    dlqId,
    userId,
    orgId: req.orgId
  });

  res.json({
    success: true,
    message: 'DLQ entry deleted',
    data: { dlqId }
  });
}));

/**
 * POST /api/v1/dlq/:dlqId/retry
 * Manually retry a DLQ entry
 */
router.post('/:dlqId/retry', asyncHandler(async (req, res) => {
  const { dlqId } = req.params;
  const userId = req.user?.id || 'system';

  const entry = await dlqData.manualRetryDLQ(dlqId, req.orgId, userId);

  // Queue the retry (implement actual retry logic based on your worker setup)
  // This will depend on how you process retries - could use a message queue, worker, etc.
  // For now, we'll just mark it as retrying

  log('info', 'DLQ manual retry initiated', {
    dlqId,
    userId,
    orgId: req.orgId,
    integrationConfigId: entry.integrationConfigId
  });

  res.json({
    success: true,
    message: 'Retry initiated',
    data: {
      dlqId,
      status: 'retrying'
    }
  });
}));

/**
 * POST /api/v1/dlq/:dlqId/abandon
 * Abandon a DLQ entry
 */
router.post('/:dlqId/abandon', asyncHandler(async (req, res) => {
  const { dlqId } = req.params;
  const { notes } = req.body;
  const userId = req.user?.id || 'system';

  await dlqData.abandonDLQEntry(dlqId, req.orgId, userId, notes);

  log('info', 'DLQ entry abandoned', {
    dlqId,
    userId,
    orgId: req.orgId,
    notes
  });

  res.json({
    success: true,
    message: 'DLQ entry abandoned',
    data: {
      dlqId,
      status: 'abandoned'
    }
  });
}));

/**
 * POST /api/v1/dlq/bulk/retry
 * Bulk retry DLQ entries
 */
router.post('/bulk/retry', asyncHandler(async (req, res) => {
  const { dlqIds } = req.body;
  const userId = req.user?.id || 'system';

  if (!Array.isArray(dlqIds) || dlqIds.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'dlqIds must be a non-empty array',
      code: 'VALIDATION_ERROR'
    });
  }

  if (dlqIds.length > 100) {
    return res.status(400).json({
      success: false,
      error: 'Cannot retry more than 100 entries at once',
      code: 'VALIDATION_ERROR'
    });
  }

  const results = {
    success: [],
    failed: []
  };

  for (const dlqId of dlqIds) {
    try {
      await dlqData.manualRetryDLQ(dlqId, req.orgId, userId);
      results.success.push(dlqId);
    } catch (error) {
      results.failed.push({
        dlqId,
        error: error.message
      });
    }
  }

  log('info', 'DLQ bulk retry', {
    userId,
    orgId: req.orgId,
    total: dlqIds.length,
    successCount: results.success.length,
    failedCount: results.failed.length
  });

  res.json({
    success: true,
    message: `Initiated retry for ${results.success.length} of ${dlqIds.length} entries`,
    data: results
  });
}));

/**
 * POST /api/v1/dlq/bulk/abandon
 * Bulk abandon DLQ entries
 */
router.post('/bulk/abandon', asyncHandler(async (req, res) => {
  const { dlqIds, notes } = req.body;
  const userId = req.user?.id || 'system';

  if (!Array.isArray(dlqIds) || dlqIds.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'dlqIds must be a non-empty array',
      code: 'VALIDATION_ERROR'
    });
  }

  if (dlqIds.length > 100) {
    return res.status(400).json({
      success: false,
      error: 'Cannot abandon more than 100 entries at once',
      code: 'VALIDATION_ERROR'
    });
  }

  const results = {
    success: [],
    failed: []
  };

  for (const dlqId of dlqIds) {
    try {
      await dlqData.abandonDLQEntry(dlqId, req.orgId, userId, notes);
      results.success.push(dlqId);
    } catch (error) {
      results.failed.push({
        dlqId,
        error: error.message
      });
    }
  }

  log('info', 'DLQ bulk abandon', {
    userId,
    orgId: req.orgId,
    total: dlqIds.length,
    successCount: results.success.length,
    failedCount: results.failed.length,
    notes
  });

  res.json({
    success: true,
    message: `Abandoned ${results.success.length} of ${dlqIds.length} entries`,
    data: results
  });
}));

/**
 * POST /api/v1/dlq/bulk/delete
 * Bulk delete DLQ entries
 */
router.post('/bulk/delete', asyncHandler(async (req, res) => {
  const { dlqIds } = req.body;
  const userId = req.user?.id || 'system';

  if (!Array.isArray(dlqIds) || dlqIds.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'dlqIds must be a non-empty array',
      code: 'VALIDATION_ERROR'
    });
  }

  if (dlqIds.length > 100) {
    return res.status(400).json({
      success: false,
      error: 'Cannot delete more than 100 entries at once',
      code: 'VALIDATION_ERROR'
    });
  }

  const results = {
    success: [],
    failed: []
  };

  for (const dlqId of dlqIds) {
    try {
      await dlqData.deleteDLQEntry(dlqId, req.orgId);
      results.success.push(dlqId);
    } catch (error) {
      results.failed.push({
        dlqId,
        error: error.message
      });
    }
  }

  log('info', 'DLQ bulk delete', {
    userId,
    orgId: req.orgId,
    total: dlqIds.length,
    successCount: results.success.length,
    failedCount: results.failed.length
  });

  res.json({
    success: true,
    message: `Deleted ${results.success.length} of ${dlqIds.length} entries`,
    data: results
  });
}));

/**
 * GET /api/v1/dlq/integration/:integrationId/summary
 * Get DLQ summary for specific integration
 */
router.get('/integration/:integrationId/summary', asyncHandler(async (req, res) => {
  const { integrationId } = req.params;

  const [stats, entries] = await Promise.all([
    dlqData.getDLQStats(req.orgId, { integrationConfigId: integrationId }),
    dlqData.listDLQEntries(req.orgId, {
      integrationConfigId: integrationId,
      status: 'pending'
    }, { limit: 10 })
  ]);

  res.json({
    success: true,
    data: {
      stats,
      recentPendingEntries: entries.entries
    }
  });
}));

module.exports = router;
