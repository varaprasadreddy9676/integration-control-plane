const cron = require('node-cron');
const { uuidv4 } = require('../utils/runtime');
const { log } = require('../logger');
const { getDb } = require('../mongodb');
const { executeDataSource } = require('../services/data-source-executor');
const { applyTransform } = require('../services/transformer');
const { buildAuthHeaders } = require('./auth-helper');
const axios = require('axios');
const { createExecutionLogger } = require('../utils/execution-logger');

/**
 * Scheduled Job Worker
 * Manages cron-based and interval-based scheduled jobs
 * Reuses existing transformation, authentication, and delivery logic
 */

class ScheduledJobWorker {
  constructor() {
    this.scheduledTasks = new Map(); // jobId -> cron task
    this.isRunning = false;
  }

  /**
   * Initialize worker and load all active scheduled jobs
   */
  async start() {
    if (this.isRunning) {
      log('warn', 'Scheduled job worker already running');
      return;
    }

    this.isRunning = true;
    log('info', 'Starting scheduled job worker');

    try {
      await this.loadActiveJobs();
      log('info', 'Scheduled job worker started successfully');
    } catch (error) {
      log('error', 'Failed to start scheduled job worker', { error: error.message });
      this.isRunning = false;
      throw error;
    }
  }

  /**
   * Load all active SCHEDULED integrations from database
   */
  async loadActiveJobs() {
    try {
      const db = await getDb();
      const collection = db.collection('integration_configs');

      const scheduledJobs = await collection
        .find({
          direction: 'SCHEDULED',
          isActive: true,
        })
        .toArray();

      log('info', `Found ${scheduledJobs.length} active scheduled jobs`);

      for (const job of scheduledJobs) {
        this.scheduleJob(job);
      }
    } catch (error) {
      log('error', 'Failed to load active jobs', { error: error.message });
      throw error;
    }
  }

  /**
   * Schedule a single job using cron or interval
   */
  scheduleJob(jobConfig) {
    const jobId = jobConfig._id.toString();

    // Remove existing schedule if present
    this.unscheduleJob(jobId);

    try {
      const { schedule } = jobConfig;

      if (schedule.type === 'CRON') {
        // Validate cron expression
        if (!cron.validate(schedule.expression)) {
          log('error', 'Invalid cron expression', {
            jobId,
            expression: schedule.expression,
          });
          return;
        }

        // Schedule with node-cron
        const task = cron.schedule(schedule.expression, () => this.executeJob(jobConfig), {
          scheduled: true,
          timezone: schedule.timezone || 'UTC',
        });

        this.scheduledTasks.set(jobId, task);

        log('info', 'Job scheduled with cron', {
          jobId,
          name: jobConfig.name,
          expression: schedule.expression,
          timezone: schedule.timezone || 'UTC',
        });
      } else if (schedule.type === 'INTERVAL') {
        // Schedule with setInterval
        const intervalMs = schedule.intervalMs;

        if (intervalMs < 60000) {
          log('error', 'Interval too short (minimum 1 minute)', {
            jobId,
            intervalMs,
          });
          return;
        }

        const intervalId = setInterval(() => this.executeJob(jobConfig), intervalMs);

        this.scheduledTasks.set(jobId, intervalId);

        log('info', 'Job scheduled with interval', {
          jobId,
          name: jobConfig.name,
          intervalMs,
        });
      }
    } catch (error) {
      log('error', 'Failed to schedule job', {
        jobId,
        error: error.message,
      });
    }
  }

  /**
   * Unschedule a job
   */
  unscheduleJob(jobId) {
    const task = this.scheduledTasks.get(jobId);

    if (task) {
      if (typeof task.stop === 'function') {
        // node-cron task
        task.stop();
      } else {
        // setInterval
        clearInterval(task);
      }

      this.scheduledTasks.delete(jobId);

      log('info', 'Job unscheduled', { jobId });
    }
  }

  /**
   * Execute a scheduled job
   * REUSES existing transformation, auth, and delivery logic
   */
  async executeJob(jobConfig) {
    const correlationId = uuidv4();
    const startTime = Date.now();

    log('info', 'Executing scheduled job', {
      jobId: jobConfig._id.toString(),
      name: jobConfig.name,
      correlationId,
    });

    // Create execution logger for scheduled jobs
    const executionLogger = createExecutionLogger({
      traceId: correlationId,
      direction: 'SCHEDULED',
      triggerType: 'SCHEDULE',
      integrationConfigId: jobConfig._id,
      // These fields are used by the Delivery Logs UI. Without them scheduled
      // logs show blank "Integration" / "Event" labels.
      __KEEP_integrationName__: jobConfig.name,
      integrationName: jobConfig.name,
      eventType: jobConfig.eventType || jobConfig.type || null,
      orgId: jobConfig.orgId,
      messageId: `job_${jobConfig._id}_${Date.now()}`,
      request: {
        url: jobConfig.targetUrl,
        method: jobConfig.httpMethod || 'POST',
        headers: {},
        body: {},
      },
    });

    // Start execution logging
    await executionLogger.start().catch((err) => {
      log('warn', 'Failed to start execution logger', { error: err.message, correlationId });
    });

    const executionLog = {
      integrationId: jobConfig._id,
      integrationName: jobConfig.name,
      orgId: jobConfig.orgId,
      correlationId,
      startedAt: new Date(),
      status: 'RUNNING',
    };

    try {
      // Step 1: Execute data source query (NEW - only part unique to SCHEDULED)
      const queryStart = Date.now();
      const queryResult = await executeDataSource(jobConfig.dataSource, jobConfig);

      executionLog.recordsFetched = Array.isArray(queryResult) ? queryResult.length : 1;
      executionLog.queryExecutedAt = new Date();

      // Store the actual data fetched (with size limit for logging)
      const dataFetchedForLog = JSON.stringify(queryResult);
      executionLog.dataFetched =
        dataFetchedForLog.length > 50000 ? `${dataFetchedForLog.substring(0, 50000)}...(truncated)` : queryResult;

      // Log data source execution
      await executionLogger
        .addStep('data_source_query', {
          status: 'success',
          durationMs: Date.now() - queryStart,
          metadata: {
            recordsFetched: executionLog.recordsFetched,
            dataSourceType: jobConfig.dataSource?.type,
            sampleData: Array.isArray(queryResult) ? queryResult.slice(0, 3) : queryResult,
          },
        })
        .catch(() => {});

      log('info', 'Data source executed', {
        correlationId,
        recordsFetched: executionLog.recordsFetched,
      });

      // Step 2: Apply transformation (REUSE - existing transformer service)
      const transformStart = Date.now();
      const eventPayload = {
        data: queryResult,
        metadata: {
          jobId: jobConfig._id.toString(),
          jobName: jobConfig.name,
          executedAt: new Date().toISOString(),
          recordCount: executionLog.recordsFetched,
        },
      };

      const transformedPayload = await applyTransform(jobConfig, eventPayload);

      executionLog.transformedAt = new Date();

      // Store the transformed payload (with size limit for logging)
      const transformedForLog = JSON.stringify(transformedPayload);
      executionLog.transformedPayload =
        transformedForLog.length > 50000
          ? `${transformedForLog.substring(0, 50000)}...(truncated)`
          : transformedPayload;

      // Log transformation
      await executionLogger
        .addStep('transformation', {
          status: 'success',
          durationMs: Date.now() - transformStart,
          metadata: {
            payloadSize: transformedForLog.length,
          },
        })
        .catch(() => {});

      log('info', 'Transformation applied', { correlationId });

      // Step 3: Build authentication headers (REUSE - existing auth-helper)
      const authHeaders = buildAuthHeaders(jobConfig.outgoingAuthType, jobConfig.outgoingAuthConfig);

      // Step 4: Deliver integration (REUSE - existing delivery logic)
      const httpStart = Date.now();
      const requestHeaders = {
        'Content-Type': 'application/json',
        ...authHeaders,
        ...(jobConfig.customHeaders || {}),
      };

      const deliveryResult = await this.deliverIntegration({
        targetUrl: jobConfig.targetUrl,
        httpMethod: jobConfig.httpMethod || 'POST',
        headers: requestHeaders,
        payload: transformedPayload,
        timeout: jobConfig.timeoutMs || 10000,
      });

      executionLog.deliveredAt = new Date();
      executionLog.responseStatus = deliveryResult.status;
      executionLog.responseBody = deliveryResult.data;
      executionLog.status = 'SUCCESS';

      // Store full HTTP request details for debugging
      executionLog.httpRequest = {
        method: jobConfig.httpMethod || 'POST',
        url: jobConfig.targetUrl,
        headers: requestHeaders,
        body: transformedPayload,
      };

      // Generate curl command for easy debugging
      const curlHeaders = Object.entries(requestHeaders)
        .map(([key, value]) => `-H "${key}: ${value}"`)
        .join(' ');
      executionLog.curlCommand = `curl -X ${jobConfig.httpMethod || 'POST'} ${curlHeaders} -d '${JSON.stringify(transformedPayload).replace(/'/g, "'\\''")}' "${jobConfig.targetUrl}"`;

      // Log HTTP request
      await executionLogger
        .addStep('http_request', {
          status: deliveryResult.status >= 200 && deliveryResult.status < 300 ? 'success' : 'failed',
          durationMs: Date.now() - httpStart,
          metadata: {
            statusCode: deliveryResult.status,
            method: jobConfig.httpMethod || 'POST',
            url: jobConfig.targetUrl,
            requestHeaders: requestHeaders,
            responseHeaders: deliveryResult.headers || {},
          },
        })
        .catch(() => {});

      // Mark execution as successful with detailed execution data
      await executionLogger
        .success({
          response: {
            statusCode: deliveryResult.status,
            headers: deliveryResult.headers,
            body: deliveryResult.data,
          },
          metadata: {
            recordsFetched: executionLog.recordsFetched,
            dataFetched: executionLog.dataFetched,
            transformedPayload: executionLog.transformedPayload,
            httpRequest: executionLog.httpRequest,
            curlCommand: executionLog.curlCommand,
          },
        })
        .catch(() => {});

      log('info', 'Job executed successfully', {
        correlationId,
        duration: Date.now() - startTime,
        status: deliveryResult.status,
      });
    } catch (error) {
      executionLog.status = 'FAILED';
      executionLog.error = {
        message: error.message,
        stack: error.stack,
        code: error.code,
        details: error.details || {},
        timestamp: new Date(),
      };

      // Store what we had so far for debugging
      if (executionLog.httpRequest) {
        executionLog.errorContext = {
          stage: 'http_delivery',
          request: executionLog.httpRequest,
        };
      } else if (executionLog.transformedPayload) {
        executionLog.errorContext = {
          stage: 'transformation',
          transformedPayload: executionLog.transformedPayload,
        };
      } else if (executionLog.dataFetched) {
        executionLog.errorContext = {
          stage: 'data_fetch',
          dataFetched: executionLog.dataFetched,
        };
      }

      // Mark execution as failed with DLQ entry
      const err = new Error(error.message);
      err.code = error.code || 'JOB_EXECUTION_ERROR';
      err.stack = error.stack;
      err.statusCode = error.statusCode || 500;
      await executionLogger
        .fail(err, {
          payload: executionLog,
          statusCode: err.statusCode,
          metadata: {
            recordsFetched: executionLog.recordsFetched,
            dataFetched: executionLog.dataFetched,
            transformedPayload: executionLog.transformedPayload,
            httpRequest: executionLog.httpRequest,
            curlCommand: executionLog.curlCommand,
            errorContext: executionLog.errorContext,
          },
        })
        .catch(() => {});

      log('error', 'Job execution failed', {
        correlationId,
        error: error.message,
        errorStage: executionLog.errorContext?.stage,
        duration: Date.now() - startTime,
      });
    } finally {
      executionLog.completedAt = new Date();
      executionLog.durationMs = Date.now() - startTime;

      // Save execution log (REUSE - existing logging pattern)
      await this.saveExecutionLog(executionLog);
    }
  }

  /**
   * Deliver integration using axios
   * REUSES existing delivery logic pattern
   */
  async deliverIntegration({ targetUrl, httpMethod, headers, payload, timeout }) {
    try {
      const response = await axios({
        method: httpMethod,
        url: targetUrl,
        headers,
        data: payload,
        timeout,
        validateStatus: () => true, // Don't throw on non-2xx
      });

      return {
        status: response.status,
        headers: response.headers,
        data: response.data,
      };
    } catch (error) {
      // If axios throws (network error, timeout, etc), capture details
      const errorDetails = {
        message: error.message,
        code: error.code,
        stack: error.stack,
      };

      if (error.response) {
        // Server responded with error status
        return {
          status: error.response.status,
          headers: error.response.headers,
          data: error.response.data,
        };
      }

      // Network error or timeout - throw with details
      const err = new Error(`Integration delivery failed: ${error.message}`);
      err.details = errorDetails;
      throw err;
    }
  }

  /**
   * Save execution log to database
   */
  async saveExecutionLog(executionLog) {
    try {
      const db = await getDb();
      const collection = db.collection('scheduled_job_logs');

      await collection.insertOne(executionLog);
    } catch (error) {
      log('error', 'Failed to save execution log', {
        error: error.message,
        correlationId: executionLog.correlationId,
      });
    }
  }

  /**
   * Reload jobs (called when config changes)
   */
  async reloadJobs() {
    log('info', 'Reloading scheduled jobs');

    // Clear all existing schedules
    for (const jobId of this.scheduledTasks.keys()) {
      this.unscheduleJob(jobId);
    }

    // Load fresh jobs from database
    await this.loadActiveJobs();
  }

  /**
   * Stop worker
   */
  stop() {
    log('info', 'Stopping scheduled job worker');

    for (const jobId of this.scheduledTasks.keys()) {
      this.unscheduleJob(jobId);
    }

    this.isRunning = false;
    log('info', 'Scheduled job worker stopped');
  }
}

// Singleton instance
let workerInstance = null;

const getScheduledJobWorker = () => {
  if (!workerInstance) {
    workerInstance = new ScheduledJobWorker();
  }
  return workerInstance;
};

module.exports = {
  getScheduledJobWorker,
  ScheduledJobWorker,
};
