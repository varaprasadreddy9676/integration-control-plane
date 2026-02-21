/**
 * Daily Reports Scheduler
 * Orchestrates daily dashboard email reports using cron
 */

const cron = require('node-cron');
const config = require('../config');
const { log, logError } = require('../logger');
const emailService = require('./email-service');
const dashboardCaptureService = require('./dashboard-capture');
const mongodb = require('../mongodb');

class DailyReportsScheduler {
  constructor() {
    this.cronJob = null;
    this.isRunning = false;
  }

  /**
   * Start the daily reports scheduler
   */
  start() {
    const dailyReportsConfig = config.dailyReports || {};

    if (!dailyReportsConfig.enabled) {
      log('info', '[DailyReports] Daily reports scheduler is disabled');
      return;
    }

    // Default to 11:59 PM (23:59) if not specified
    const cronExpression = dailyReportsConfig.cronSchedule || '59 23 * * *';

    try {
      // Validate cron expression
      if (!cron.validate(cronExpression)) {
        log('error', `[DailyReports] Invalid cron expression: ${cronExpression}`);
        return;
      }

      this.cronJob = cron.schedule(cronExpression, async () => {
        await this.runDailyReports();
      });

      log('info', `[DailyReports] Scheduler started with cron expression: ${cronExpression}`);
    } catch (error) {
      logError(error, { scope: 'DailyReports', action: 'start' });
    }
  }

  /**
   * Stop the scheduler
   */
  stop() {
    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = null;
      log('info', '[DailyReports] Scheduler stopped');
    }
  }

  /**
   * Run daily reports for all configured orgs
   */
  async runDailyReports() {
    if (this.isRunning) {
      log('warn', '[DailyReports] Previous execution still running, skipping...');
      return;
    }

    this.isRunning = true;
    const startTime = Date.now();

    log('info', '[DailyReports] Starting daily reports execution');

    try {
      const db = mongodb.getDb();

      // Fetch all orgs that have daily reports enabled
      const reportConfigs = await db
        .collection('daily_report_config')
        .find({ enabled: true })
        .toArray();

      if (reportConfigs.length === 0) {
        log('info', '[DailyReports] No orgs configured for daily reports');
        return;
      }

      log('info', `[DailyReports] Processing ${reportConfigs.length} report configurations`);

      const results = [];

      // Process each org
      for (const reportConfig of reportConfigs) {
        try {
          const result = await this.sendDailyReport(reportConfig);
          results.push(result);
        } catch (error) {
          await logError(error, { scope: 'DailyReports', action: 'processOrg', orgId: reportConfig.orgId || reportConfig.entityParentRid });
          results.push({
            orgId: reportConfig.orgId || reportConfig.entityParentRid,
            success: false,
            error: error.message
          });
        }
      }

      // Log execution summary
      const successful = results.filter((r) => r.success).length;
      const failed = results.filter((r) => !r.success).length;
      const duration = Date.now() - startTime;

      log('info', `[DailyReports] Execution completed in ${duration}ms - Success: ${successful}, Failed: ${failed}`);

      // Store execution log
      await this.logExecution({
        timestamp: new Date(),
        duration,
        totalReports: reportConfigs.length,
        successful,
        failed,
        results
      });
    } catch (error) {
      await logError(error, { scope: 'DailyReports', action: 'runDailyReports' });
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Send daily report for a single org
   * @param {Object} reportConfig - Report configuration
   * @returns {Promise<Object>} Result
   */
  async sendDailyReport(reportConfig) {
    const orgId = reportConfig.orgId || reportConfig.entityParentRid;
    const { entityName, recipients } = reportConfig;

    log('info', `[DailyReports] Generating report for org ${orgId} (${entityName})`);

    try {
      const dailyReportsConfig = config.dailyReports || {};
      const apiKey = dailyReportsConfig.apiKey || config.security?.apiKey;

      if (!apiKey) {
        throw new Error('API key not configured for dashboard summary');
      }

      // Fetch dashboard summary data via API
      const summary = await dashboardCaptureService.getDashboardSummary({
        orgId,
        apiKey,
        days: 1
      });

      // Generate dashboard URL from config
      const frontendUrl = config.frontendUrl || process.env.FRONTEND_URL || 'http://localhost:5174';
      const dashboardUrl = `${frontendUrl}/dashboard?orgId=${orgId}&days=1`;

      // Optionally generate PDF attachment
      let pdfBuffer = null;
      if (dailyReportsConfig.includePdf) {
        try {
          log('info', `[DailyReports] Generating PDF for org ${orgId}`);
          pdfBuffer = await dashboardCaptureService.captureDashboard({
            orgId,
            apiKey,
            days: 1
          });
          log('info', `[DailyReports] PDF generated successfully (${pdfBuffer.length} bytes)`);
        } catch (pdfError) {
          await logError(pdfError, { scope: 'DailyReports', action: 'generatePDF', orgId });
          // Continue without PDF - send summary-only email
        }
      }

      // Send email with optional PDF attachment
      const emailResult = await emailService.sendDailyReport({
        to: recipients,
        orgId,
        entityName,
        dashboardUrl,
        summary,
        pdfBuffer
      });

      if (!emailResult.success) {
        throw new Error(emailResult.error || 'Failed to send email');
      }

      log('info', `[DailyReports] Report sent successfully for org ${orgId}`);

      return {
        orgId,
        entityName,
        success: true,
        recipients: emailResult.recipients,
        messageId: emailResult.messageId
      };
    } catch (error) {
      await logError(error, { scope: 'DailyReports', action: 'sendDailyReport', orgId });
      return {
        orgId,
        entityName,
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Log execution to database
   */
  async logExecution(executionData) {
    try {
      const db = mongodb.getDb();
      await db.collection('daily_report_logs').insertOne({
        ...executionData,
        createdAt: new Date()
      });
    } catch (error) {
      await logError(error, { scope: 'DailyReports', action: 'logExecution' });
    }
  }

  /**
   * Manually trigger daily reports (for testing)
   */
  async triggerNow() {
    log('info', '[DailyReports] Manual trigger requested');
    await this.runDailyReports();
  }
}

// Singleton instance
const dailyReportsScheduler = new DailyReportsScheduler();

module.exports = dailyReportsScheduler;
