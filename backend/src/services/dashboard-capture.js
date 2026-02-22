/**
 * Dashboard Capture Service
 * Captures dashboard as PDF using Puppeteer for daily email reports
 */

const puppeteer = require('puppeteer');
const config = require('../config');
const { log, logError } = require('../logger');

class DashboardCaptureService {
  constructor() {
    this.browser = null;
  }

  /**
   * Initialize browser instance (reusable for better performance)
   */
  async initializeBrowser() {
    if (this.browser) {
      return this.browser;
    }

    try {
      this.browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
      });

      log('info', '[DashboardCapture] Browser initialized successfully');
      return this.browser;
    } catch (error) {
      await logError(error, { scope: 'DashboardCapture', action: 'initializeBrowser' });
      throw error;
    }
  }

  /**
   * Close browser instance
   */
  async closeBrowser() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      log('info', '[DashboardCapture] Browser closed');
    }
  }

  /**
   * Capture dashboard as PDF
   * @param {Object} options
   * @param {number} options.orgId - Org ID
   * @param {string} options.apiKey - API key for authentication
   * @param {number} options.days - Time range (1 for today)
   * @returns {Promise<Buffer>} PDF buffer
   */
  async captureDashboard({ orgId, entityParentRid, apiKey, days = 1 }) {
    const resolvedOrgId = orgId || entityParentRid;
    const browser = await this.initializeBrowser();
    let page = null;

    try {
      page = await browser.newPage();

      // Set viewport for consistent rendering
      await page.setViewport({
        width: 1920,
        height: 1080,
        deviceScaleFactor: 2, // High DPI for better quality
      });

      // Construct dashboard URL from config
      const frontendUrl = config.frontendUrl || process.env.FRONTEND_URL || 'http://localhost:5174';
      const dashboardUrl = `${frontendUrl}/dashboard?orgId=${resolvedOrgId}&days=${days}`;

      log('info', `[DashboardCapture] Navigating to dashboard: ${dashboardUrl}`);

      // Set API key in localStorage before navigation
      await page.evaluateOnNewDocument((key) => {
        localStorage.setItem('apiKey', key);
      }, apiKey);

      // Navigate to dashboard
      await page.goto(dashboardUrl, {
        waitUntil: 'networkidle2',
        timeout: 60000,
      });

      // Wait for dashboard container to be visible
      await page.waitForSelector('[data-dashboard-container]', { timeout: 30000 });

      // Wait for charts to render (give time for React Query to fetch data)
      await page.waitForTimeout(5000);

      // Get dashboard container element
      const dashboardElement = await page.$('[data-dashboard-container]');

      if (!dashboardElement) {
        throw new Error('Dashboard container not found');
      }

      // Get dimensions of dashboard container
      const boundingBox = await dashboardElement.boundingBox();

      if (!boundingBox) {
        throw new Error('Could not get dashboard container dimensions');
      }

      // Capture as PDF with proper dimensions
      const pdfBuffer = await page.pdf({
        width: `${boundingBox.width}px`,
        height: `${boundingBox.height + 100}px`, // Add some padding
        printBackground: true,
        margin: {
          top: '20px',
          right: '20px',
          bottom: '20px',
          left: '20px',
        },
      });

      log('info', `[DashboardCapture] Dashboard captured successfully for org ${resolvedOrgId}`);

      return pdfBuffer;
    } catch (error) {
      await logError(error, { scope: 'DashboardCapture', action: 'captureDashboard', orgId: resolvedOrgId });
      throw error;
    } finally {
      if (page) {
        await page.close();
      }
    }
  }

  /**
   * Capture dashboard as PNG (alternative format)
   * @param {Object} options
   * @param {number} options.orgId - Org ID
   * @param {string} options.apiKey - API key for authentication
   * @param {number} options.days - Time range (1 for today)
   * @returns {Promise<Buffer>} PNG buffer
   */
  async captureDashboardPNG({ orgId, entityParentRid, apiKey, days = 1 }) {
    const resolvedOrgId = orgId || entityParentRid;
    const browser = await this.initializeBrowser();
    let page = null;

    try {
      page = await browser.newPage();

      await page.setViewport({
        width: 1920,
        height: 1080,
        deviceScaleFactor: 2,
      });

      const frontendUrl = config.frontendUrl || process.env.FRONTEND_URL || 'http://localhost:5174';
      const dashboardUrl = `${frontendUrl}/dashboard?orgId=${resolvedOrgId}&days=${days}`;

      await page.evaluateOnNewDocument((key) => {
        localStorage.setItem('apiKey', key);
      }, apiKey);

      await page.goto(dashboardUrl, {
        waitUntil: 'networkidle2',
        timeout: 60000,
      });

      await page.waitForSelector('[data-dashboard-container]', { timeout: 30000 });
      await page.waitForTimeout(5000);

      const dashboardElement = await page.$('[data-dashboard-container]');

      if (!dashboardElement) {
        throw new Error('Dashboard container not found');
      }

      // Capture as PNG
      const pngBuffer = await dashboardElement.screenshot({
        type: 'png',
        omitBackground: false,
      });

      log('info', `[DashboardCapture] Dashboard PNG captured successfully for org ${resolvedOrgId}`);

      return pngBuffer;
    } catch (error) {
      await logError(error, { scope: 'DashboardCapture', action: 'captureDashboardPNG', orgId: resolvedOrgId });
      throw error;
    } finally {
      if (page) {
        await page.close();
      }
    }
  }

  /**
   * Get dashboard summary data
   * @param {Object} options
   * @param {number} options.orgId - Org ID
   * @param {string} options.apiKey - API key for authentication (not used - for backward compatibility)
   * @param {number} options.days - Time range (1 for today)
   * @returns {Promise<Object>} Dashboard summary
   */
  async getDashboardSummary({ orgId, entityParentRid, apiKey, days = 1 }) {
    const resolvedOrgId = orgId || entityParentRid;
    try {
      // Use internal data layer directly instead of making HTTP request
      const data = require('../data');
      const dashboardData = await data.getDashboardSummary(resolvedOrgId);

      log('info', `[DashboardCapture] Summary fetched for org ${resolvedOrgId}`);

      // Map field names from data layer format to email template format
      const summary = {
        totalDeliveries: dashboardData?.totalDeliveries24h || 0,
        successfulDeliveries: (dashboardData?.totalDeliveries24h || 0) - (dashboardData?.failedCount24h || 0),
        failedDeliveries: dashboardData?.failedCount24h || 0,
        successRate: dashboardData?.successRate24h || 0,
        avgLatency: dashboardData?.avgResponseTimeMs24h || 0,
      };

      return summary;
    } catch (error) {
      await logError(error, { scope: 'DashboardCapture', action: 'getDashboardSummary', orgId: resolvedOrgId });
      return {
        totalDeliveries: 0,
        successfulDeliveries: 0,
        failedDeliveries: 0,
        successRate: 0,
        avgLatency: 0,
      };
    }
  }
}

// Singleton instance
const dashboardCaptureService = new DashboardCaptureService();

module.exports = dashboardCaptureService;
