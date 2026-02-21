const executionLogsData = require('../data/execution-logs');
const dlqData = require('../data/dlq');
const { log } = require('../logger');

/**
 * Execution Logger Utility
 *
 * Helper module to integrate execution logging and DLQ into existing workers
 * without major refactoring. Provides a simple API to track execution.
 */

class ExecutionLogger {
  constructor(options) {
    this.traceId = options.traceId || null;
    this.direction = options.direction; // 'OUTBOUND' | 'INBOUND' | 'SCHEDULED'
    this.triggerType = options.triggerType || 'EVENT'; // 'EVENT' | 'SCHEDULE' | 'MANUAL' | 'REPLAY'
    this.integrationConfigId = options.integrationConfigId;
    this.integrationName = options.integrationName || null;
    this.eventType = options.eventType || null;
    this.eventId = options.eventId || null;
    this.orgId = options.orgId;
    this.messageId = options.messageId || null;
    this.request = options.request || {};
    this.startTime = Date.now();
  }

  /**
   * Initialize execution log (call at start of execution)
   */
  async start() {
    try {
      this.traceId = await executionLogsData.createExecutionLog({
        traceId: this.traceId,
        direction: this.direction,
        triggerType: this.triggerType,
        integrationConfigId: this.integrationConfigId,
        __KEEP_integrationName__: this.integrationName,
        integrationName: this.integrationName,
        eventType: this.eventType,
        eventId: this.eventId,
        orgId: this.orgId,
        messageId: this.messageId,
        request: this.request,
        status: 'pending',
        startedAt: new Date(this.startTime)
      });

      log('debug', 'Execution log started', {
        traceId: this.traceId,
        direction: this.direction,
        integrationName: this.integrationName,
        orgId: this.orgId
      });

      return this.traceId;
    } catch (error) {
      log('error', 'Failed to create execution log', {
        error: error.message,
        direction: this.direction,
        orgId: this.orgId
      });
      // Don't fail the main execution if logging fails
      return null;
    }
  }

  /**
   * Add a step to the execution log
   */
  async addStep(name, options = {}) {
    if (!this.traceId) return;

    try {
      await executionLogsData.addExecutionStep(this.traceId, {
        name,
        timestamp: options.timestamp || new Date(),
        durationMs: options.durationMs || null,
        status: options.status || 'success',
        metadata: options.metadata || {},
        error: options.error || null
      });
    } catch (error) {
      log('error', 'Failed to add execution step', {
        traceId: this.traceId,
        stepName: name,
        error: error.message
      });
    }
  }

  /**
   * Mark execution as successful
   */
  async success(options = {}) {
    if (!this.traceId) return;

    try {
      const finishedAt = new Date();
      const durationMs = finishedAt - this.startTime;

      await executionLogsData.updateExecutionLog(this.traceId, {
        status: 'success',
        finishedAt,
        durationMs,
        response: options.response || {},
        metadata: options.metadata || {}
      });

      log('debug', 'Execution log completed successfully', {
        traceId: this.traceId,
        durationMs
      });
    } catch (error) {
      log('error', 'Failed to mark execution as success', {
        traceId: this.traceId,
        error: error.message
      });
    }
  }

  /**
   * Mark execution as failed and create DLQ entry
   */
  async fail(error, options = {}) {
    if (!this.traceId) return;

    try {
      const finishedAt = new Date();
      const durationMs = finishedAt - this.startTime;

      // Update execution log
      await executionLogsData.updateExecutionLog(this.traceId, {
        status: 'failed',
        finishedAt,
        durationMs,
        error: {
          message: error.message || 'Unknown error',
          stack: error.stack || null,
          code: error.code || 'UNKNOWN_ERROR'
        },
        response: options.response || {}
      });

      // Create DLQ entry for automatic retry (unless disabled)
      if (options.createDLQ !== false) {
        await dlqData.createDLQEntry({
          traceId: this.traceId,
          messageId: this.messageId,
          integrationConfigId: this.integrationConfigId,
          orgId: this.orgId,
          direction: this.direction,
          payload: options.payload || this.request.body || {},
          error: {
            message: error.message || 'Unknown error',
            stack: error.stack || null,
            code: error.code || 'UNKNOWN_ERROR',
            statusCode: error.statusCode || options.statusCode || null
          },
          maxRetries: options.maxRetries || 5,
          retryStrategy: options.retryStrategy || 'exponential',
          metadata: options.metadata || {}
        });

        log('info', 'DLQ entry created for failed execution', {
          traceId: this.traceId,
          errorCode: error.code
        });
      }
    } catch (logError) {
      log('error', 'Failed to mark execution as failed', {
        traceId: this.traceId,
        error: logError.message
      });
    }
  }

  /**
   * Update execution status (for custom states)
   */
  async updateStatus(status) {
    if (!this.traceId) return;

    try {
      await executionLogsData.updateExecutionLog(this.traceId, {
        status,
        updatedAt: new Date()
      });
    } catch (error) {
      log('error', 'Failed to update execution status', {
        traceId: this.traceId,
        status,
        error: error.message
      });
    }
  }
}

/**
 * Factory function to create an execution logger
 *
 * @param {Object} options - Logger configuration
 * @returns {ExecutionLogger} Logger instance
 *
 * @example
 * const logger = createExecutionLogger({
 *   direction: 'OUTBOUND',
 *   triggerType: 'EVENT',
 *   integrationConfigId: integration._id,
 *   integrationName: integration.name,
 *   eventType: 'appointment.created',
 *   eventId: event._id,
 *   orgId: integration.orgId,
 *   messageId: eventId,
 *   request: { url, method: 'POST', headers, body: payload }
 * });
 *
 * await logger.start();
 * await logger.addStep('validation', { status: 'success', durationMs: 5 });
 * await logger.addStep('transformation', { status: 'success', durationMs: 50 });
 *
 * // On success:
 * await logger.success({ response: { statusCode: 200, body: result } });
 *
 * // On failure:
 * await logger.fail(error, { payload, statusCode: 500 });
 */
function createExecutionLogger(options) {
  return new ExecutionLogger(options);
}

/**
 * Simple wrapper for one-off execution logging
 * (for cases where you don't need step tracking)
 *
 * @example
 * await logExecution({
 *   direction: 'OUTBOUND',
 *   integrationConfigId,
 *   orgId,
 *   request,
 *   response,
 *   status: 'success',
 *   durationMs: 250
 * });
 */
async function logExecution(options) {
  try {
    await executionLogsData.createExecutionLog({
      direction: options.direction,
      triggerType: options.triggerType || 'EVENT',
      integrationConfigId: options.integrationConfigId,
      orgId: options.orgId,
      messageId: options.messageId || null,
      status: options.status || 'success',
      startedAt: options.startedAt || new Date(),
      finishedAt: options.finishedAt || new Date(),
      durationMs: options.durationMs || null,
      steps: options.steps || [],
      request: options.request || {},
      response: options.response || {},
      error: options.error || null,
      metadata: options.metadata || {}
    });
  } catch (error) {
    log('error', 'Failed to log execution', {
      error: error.message,
      direction: options.direction,
      orgId: options.orgId
    });
  }
}

module.exports = {
  ExecutionLogger,
  createExecutionLogger,
  logExecution
};
