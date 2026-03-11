/**
 * Daily Reports API Routes
 * Manage daily dashboard email report configurations
 */

const express = require('express');
const mongodb = require('../mongodb');
const auth = require('../middleware/auth');
const asyncHandler = require('../utils/async-handler');
const { APIError } = require('../utils/errors');
const dailyReportsScheduler = require('../services/daily-reports-scheduler');
const logger = require('../logger');

const router = express.Router();

/**
 * GET /daily-reports/config
 * Get daily report configuration for entity
 */
router.get(
  '/config',
  auth.requireEntity,
  asyncHandler(async (req, res) => {
    const { entityParentRid } = req;
    const db = mongodb.getDb();

    const config = await db.collection('daily_report_config').findOne({
      entityParentRid
    });

    if (!config) {
      // Return default config if not found
      return res.json({
        entityParentRid,
        enabled: false,
        recipients: [],
        format: 'pdf'
      });
    }

    res.json(config);
  })
);

/**
 * PUT /daily-reports/config
 * Update daily report configuration for entity
 */
router.put(
  '/config',
  auth.requireEntity,
  asyncHandler(async (req, res) => {
    const { entityParentRid, entityName } = req;
    const { enabled, recipients, format = 'pdf' } = req.body;

    // Validate recipients
    if (!Array.isArray(recipients) || recipients.length === 0) {
      throw new APIError('At least one recipient email is required', 400);
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    for (const email of recipients) {
      if (!emailRegex.test(email)) {
        throw new APIError(`Invalid email format: ${email}`, 400);
      }
    }

    // Validate format
    if (!['pdf', 'png'].includes(format)) {
      throw new APIError('Format must be either "pdf" or "png"', 400);
    }

    const db = mongodb.getDb();

    const config = {
      entityParentRid,
      entityName: entityName || `Entity ${entityParentRid}`,
      enabled: enabled === true,
      recipients,
      format,
      updatedAt: new Date(),
      updatedBy: req.apiKeyInfo?._id || null
    };

    // Upsert configuration
    await db.collection('daily_report_config').updateOne(
      { entityParentRid },
      {
        $set: config,
        $setOnInsert: { createdAt: new Date() }
      },
      { upsert: true }
    );

    logger.info(`[DailyReports] Configuration updated for entity ${entityParentRid}`, {
      enabled,
      recipients: recipients.length,
      format
    });

    res.json({
      success: true,
      message: 'Daily report configuration updated successfully',
      config
    });
  })
);

/**
 * POST /daily-reports/test
 * Send a test report immediately
 */
router.post(
  '/test',
  auth.requireEntity,
  asyncHandler(async (req, res) => {
    const { entityParentRid } = req;
    const db = mongodb.getDb();

    // Get configuration
    const config = await db.collection('daily_report_config').findOne({
      entityParentRid
    });

    if (!config) {
      throw new APIError('Daily report configuration not found. Please configure first.', 404);
    }

    if (!config.enabled) {
      throw new APIError('Daily reports are disabled for this entity', 400);
    }

    logger.info(`[DailyReports] Test report requested for entity ${entityParentRid}`);

    // Send report immediately
    const result = await dailyReportsScheduler.sendDailyReport(config);

    if (!result.success) {
      throw new APIError(`Failed to send test report: ${result.error}`, 500);
    }

    res.json({
      success: true,
      message: 'Test report sent successfully',
      recipients: result.recipients,
      messageId: result.messageId
    });
  })
);

/**
 * GET /daily-reports/logs
 * Get execution logs for daily reports
 */
router.get(
  '/logs',
  auth.requireEntity,
  asyncHandler(async (req, res) => {
    const { entityParentRid } = req;
    const { limit = 30, offset = 0 } = req.query;

    const db = mongodb.getDb();

    // Get logs that include this entity
    const logs = await db
      .collection('daily_report_logs')
      .find({
        'results.entityParentRid': entityParentRid
      })
      .sort({ timestamp: -1 })
      .skip(parseInt(offset))
      .limit(parseInt(limit))
      .toArray();

    // Filter results to only show this entity's data
    const filteredLogs = logs.map((log) => ({
      ...log,
      results: log.results.filter((r) => r.entityParentRid === entityParentRid)
    }));

    const total = await db.collection('daily_report_logs').countDocuments({
      'results.entityParentRid': entityParentRid
    });

    res.set('X-Total-Count', total);
    res.json(filteredLogs);
  })
);

/**
 * GET /daily-reports/status
 * Get status of daily reports system
 */
router.get(
  '/status',
  asyncHandler(async (req, res) => {
    const db = mongodb.getDb();

    // Count configurations
    const totalConfigs = await db.collection('daily_report_config').countDocuments();
    const enabledConfigs = await db.collection('daily_report_config').countDocuments({ enabled: true });

    // Get last execution
    const lastExecution = await db
      .collection('daily_report_logs')
      .findOne({}, { sort: { timestamp: -1 } });

    res.json({
      totalConfigurations: totalConfigs,
      enabledConfigurations: enabledConfigs,
      schedulerRunning: dailyReportsScheduler.cronJob !== null,
      lastExecution: lastExecution
        ? {
            timestamp: lastExecution.timestamp,
            duration: lastExecution.duration,
            successful: lastExecution.successful,
            failed: lastExecution.failed
          }
        : null
    });
  })
);

module.exports = router;
