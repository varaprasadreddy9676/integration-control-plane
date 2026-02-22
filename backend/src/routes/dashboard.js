const express = require('express');
const data = require('../data');
const asyncHandler = require('../utils/async-handler');
const emailService = require('../services/email-service');
const dashboardCaptureService = require('../services/dashboard-capture');
const config = require('../config');
const { log, logError } = require('../logger');

const router = express.Router();

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const summary = await data.getDashboardSummary(req.orgId);
    res.json(summary);
  })
);

/**
 * POST /dashboard/send-email
 * Send dashboard report to specified email addresses
 */
router.post(
  '/send-email',
  asyncHandler(async (req, res) => {
    const { recipients, days = 1, includePdf = false } = req.body;
    const orgId = req.orgId;

    // Validate recipients
    if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Recipients array is required',
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const invalidEmails = recipients.filter((email) => !emailRegex.test(email));
    if (invalidEmails.length > 0) {
      return res.status(400).json({
        success: false,
        error: `Invalid email addresses: ${invalidEmails.join(', ')}`,
      });
    }

    try {
      // Get entity name
      const tenantInfo = await data.getTenant(orgId);
      const entityName = tenantInfo?.tenantName || `Entity ${orgId}`;

      // Get API key from config
      const apiKey = config.dailyReports?.apiKey || config.security?.apiKey;
      if (!apiKey) {
        return res.status(500).json({
          success: false,
          error: 'API key not configured',
        });
      }

      // Fetch dashboard summary
      log('info', `[Dashboard] Fetching summary for entity ${orgId} (days: ${days})`);
      const summary = await dashboardCaptureService.getDashboardSummary({
        orgId,
        apiKey,
        days,
      });

      // Generate dashboard URL
      const frontendUrl = config.frontendUrl || process.env.FRONTEND_URL || 'http://localhost:5174';
      const dashboardUrl = `${frontendUrl}/dashboard?orgId=${orgId}&days=${days}`;

      // Optionally generate PDF
      let pdfBuffer = null;
      if (includePdf) {
        try {
          log('info', `[Dashboard] Generating PDF for entity ${orgId}`);
          pdfBuffer = await dashboardCaptureService.captureDashboard({
            orgId,
            apiKey,
            days,
          });
          log('info', `[Dashboard] PDF generated successfully (${pdfBuffer.length} bytes)`);
        } catch (pdfError) {
          await logError(pdfError, { scope: 'Dashboard', action: 'generatePDF', orgId });
          // Continue without PDF
        }
      }

      // Send email
      log('info', `[Dashboard] Sending email to ${recipients.join(', ')}`);
      const emailResult = await emailService.sendDailyReport({
        to: recipients,
        orgId,
        entityName,
        dashboardUrl,
        summary,
        pdfBuffer,
      });

      if (!emailResult.success) {
        return res.status(500).json({
          success: false,
          error: emailResult.error || 'Failed to send email',
        });
      }

      res.json({
        success: true,
        message: 'Dashboard email sent successfully',
        recipients: emailResult.recipients,
        messageId: emailResult.messageId,
        includedPdf: !!pdfBuffer,
      });
    } catch (error) {
      await logError(error, { scope: 'Dashboard', action: 'sendEmail', orgId });
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  })
);

module.exports = router;
