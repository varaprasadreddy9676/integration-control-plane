const express = require('express');
const router = express.Router();
const { getDb } = require('../mongodb');
const { log, logError } = require('../logger');
const { getScheduledJobWorker } = require('../processor/scheduled-job-worker');
const { executeDataSource } = require('../services/data-source-executor');
const cron = require('node-cron');
const { auditScheduledJob } = require('../middleware/audit');

function buildOrgScopeQuery(orgId) {
  return { orgId };
}

/**
 * Scheduled Jobs API Routes
 * Manage cron-based and interval-based batch integrations
 */

/**
 * GET /scheduled-jobs
 * List all scheduled jobs for a tenant
 */
router.get('/', async (req, res) => {
  try {
    const orgId = req.orgId || req.entityParentRid;
    if (!orgId) {
      return res.status(400).json({ error: 'orgId is required' });
    }

    const db = await getDb();
    const collection = db.collection('integration_configs');

    const jobs = await collection
      .find({
        direction: 'SCHEDULED',
        ...buildOrgScopeQuery(orgId),
      })
      .sort({ createdAt: -1 })
      .toArray();

    // Fetch latest execution status for each job
    const logsCollection = db.collection('scheduled_job_logs');

    for (const job of jobs) {
      const latestLog = await logsCollection.findOne({ integrationId: job._id }, { sort: { startedAt: -1 } });

      job.lastExecution = latestLog
        ? {
            status: latestLog.status,
            startedAt: latestLog.startedAt,
            completedAt: latestLog.completedAt,
            durationMs: latestLog.durationMs,
            recordsFetched: latestLog.recordsFetched,
          }
        : null;
    }

    res.json(jobs);
  } catch (error) {
    logError(error, { scope: 'GET /scheduled-jobs' });
    res.status(500).json({ error: 'Failed to fetch scheduled jobs' });
  }
});

/**
 * POST /scheduled-jobs
 * Create a new scheduled job
 */
router.post('/', async (req, res) => {
  try {
    const orgId = req.orgId || req.entityParentRid;
    if (!orgId) {
      return res.status(400).json({ error: 'orgId is required' });
    }
    const jobConfig = req.body;

    // Validate required fields
    if (!jobConfig.name) {
      return res.status(400).json({ error: 'Job name is required' });
    }

    if (!jobConfig.schedule || !jobConfig.schedule.type) {
      return res.status(400).json({ error: 'Schedule configuration is required' });
    }

    if (!jobConfig.dataSource || !jobConfig.dataSource.type) {
      return res.status(400).json({ error: 'Data source configuration is required' });
    }

    if (!jobConfig.targetUrl) {
      return res.status(400).json({ error: 'Target URL is required' });
    }

    // Validate cron expression if type is CRON
    if (jobConfig.schedule.type === 'CRON') {
      if (!cron.validate(jobConfig.schedule.expression)) {
        return res.status(400).json({ error: 'Invalid cron expression' });
      }
    }

    // Validate interval if type is INTERVAL
    if (jobConfig.schedule.type === 'INTERVAL') {
      if (!jobConfig.schedule.intervalMs || jobConfig.schedule.intervalMs < 60000) {
        return res.status(400).json({
          error: 'Interval must be at least 60000ms (1 minute)',
        });
      }
    }

    // Set defaults
    const newJob = {
      ...jobConfig,
      direction: 'SCHEDULED',
      orgId,
      isActive: jobConfig.isActive !== undefined ? jobConfig.isActive : true,
      httpMethod: jobConfig.httpMethod || 'POST',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Save to database
    const db = await getDb();
    const collection = db.collection('integration_configs');

    const result = await collection.insertOne(newJob);
    newJob._id = result.insertedId;

    // Schedule the job if active
    if (newJob.isActive) {
      const worker = getScheduledJobWorker();
      worker.scheduleJob(newJob);
    }

    log('info', 'Scheduled job created', {
      jobId: newJob._id.toString(),
      name: newJob.name,
      orgId,
    });

    await auditScheduledJob.created(req, newJob);

    res.status(201).json(newJob);
  } catch (error) {
    logError(error, { scope: 'POST /scheduled-jobs' });
    res.status(500).json({ error: 'Failed to create scheduled job' });
  }
});

/**
 * GET /scheduled-jobs/:id
 * Get scheduled job details
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const orgId = req.orgId || req.entityParentRid;
    if (!orgId) {
      return res.status(400).json({ error: 'orgId is required' });
    }
    const { ObjectId } = require('mongodb');

    const db = await getDb();
    const collection = db.collection('integration_configs');

    const job = await collection.findOne({
      _id: new ObjectId(id),
      direction: 'SCHEDULED',
      ...buildOrgScopeQuery(orgId),
    });

    if (!job) {
      return res.status(404).json({ error: 'Scheduled job not found' });
    }

    res.json(job);
  } catch (error) {
    logError(error, { scope: 'GET /scheduled-jobs/:id' });
    res.status(500).json({ error: 'Failed to fetch scheduled job' });
  }
});

/**
 * PUT /scheduled-jobs/:id
 * Update scheduled job
 */
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const orgId = req.orgId || req.entityParentRid;
    if (!orgId) {
      return res.status(400).json({ error: 'orgId is required' });
    }
    const updates = req.body;
    const { ObjectId } = require('mongodb');

    // Validate cron expression if being updated
    if (updates.schedule?.type === 'CRON' && updates.schedule?.expression) {
      if (!cron.validate(updates.schedule.expression)) {
        return res.status(400).json({ error: 'Invalid cron expression' });
      }
    }

    // Validate interval if being updated
    if (updates.schedule?.type === 'INTERVAL' && updates.schedule?.intervalMs) {
      if (updates.schedule.intervalMs < 60000) {
        return res.status(400).json({
          error: 'Interval must be at least 60000ms (1 minute)',
        });
      }
    }

    const db = await getDb();
    const collection = db.collection('integration_configs');

    const beforeJob = await collection.findOne({
      _id: new ObjectId(id),
      direction: 'SCHEDULED',
      ...buildOrgScopeQuery(orgId),
    });

    // Remove fields that shouldn't be updated
    delete updates._id;
    delete updates.direction;
    if (Object.hasOwn(updates, 'tenantId')) {
      return res.status(400).json({ error: 'tenantId is not supported. Use orgId.' });
    }
    delete updates.createdAt;

    updates.updatedAt = new Date();

    const result = await collection.findOneAndUpdate(
      {
        _id: new ObjectId(id),
        direction: 'SCHEDULED',
        ...buildOrgScopeQuery(orgId),
      },
      { $set: updates },
      { returnDocument: 'after' }
    );

    if (!result) {
      return res.status(404).json({ error: 'Scheduled job not found' });
    }

    // Reschedule the job
    const worker = getScheduledJobWorker();

    if (result.isActive) {
      worker.scheduleJob(result);
    } else {
      worker.unscheduleJob(id);
    }

    log('info', 'Scheduled job updated', {
      jobId: id,
      orgId,
    });

    await auditScheduledJob.updated(req, id, { before: beforeJob, after: result });

    res.json(result);
  } catch (error) {
    logError(error, { scope: 'PUT /scheduled-jobs/:id' });
    res.status(500).json({ error: 'Failed to update scheduled job' });
  }
});

/**
 * DELETE /scheduled-jobs/:id
 * Delete scheduled job
 */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const orgId = req.orgId || req.entityParentRid;
    if (!orgId) {
      return res.status(400).json({ error: 'orgId is required' });
    }
    const { ObjectId } = require('mongodb');

    const db = await getDb();
    const collection = db.collection('integration_configs');

    const beforeJob = await collection.findOne({
      _id: new ObjectId(id),
      direction: 'SCHEDULED',
      ...buildOrgScopeQuery(orgId),
    });

    const result = await collection.deleteOne({
      _id: new ObjectId(id),
      direction: 'SCHEDULED',
      ...buildOrgScopeQuery(orgId),
    });

    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'Scheduled job not found' });
    }

    // Unschedule the job
    const worker = getScheduledJobWorker();
    worker.unscheduleJob(id);

    log('info', 'Scheduled job deleted', {
      jobId: id,
      orgId,
    });

    await auditScheduledJob.deleted(req, id, beforeJob);

    res.json({ message: 'Scheduled job deleted successfully' });
  } catch (error) {
    logError(error, { scope: 'DELETE /scheduled-jobs/:id' });
    res.status(500).json({ error: 'Failed to delete scheduled job' });
  }
});

/**
 * POST /scheduled-jobs/:id/execute
 * Manually trigger job execution
 */
router.post('/:id/execute', async (req, res) => {
  try {
    const { id } = req.params;
    const orgId = req.orgId || req.entityParentRid;
    if (!orgId) {
      return res.status(400).json({ error: 'orgId is required' });
    }
    const { ObjectId } = require('mongodb');

    const db = await getDb();
    const collection = db.collection('integration_configs');

    const job = await collection.findOne({
      _id: new ObjectId(id),
      direction: 'SCHEDULED',
      ...buildOrgScopeQuery(orgId),
    });

    if (!job) {
      return res.status(404).json({ error: 'Scheduled job not found' });
    }

    // Execute job immediately
    const worker = getScheduledJobWorker();
    worker.executeJob(job); // Fire and forget

    log('info', 'Scheduled job manually triggered', {
      jobId: id,
      orgId,
    });

    await auditScheduledJob.executed(req, id);

    res.json({ message: 'Job execution triggered' });
  } catch (error) {
    logError(error, { scope: 'POST /scheduled-jobs/:id/execute' });
    res.status(500).json({ error: 'Failed to trigger job execution' });
  }
});

/**
 * GET /scheduled-jobs/:id/logs
 * Get execution logs for a job
 */
router.get('/:id/logs', async (req, res) => {
  try {
    const { id } = req.params;
    const orgId = req.orgId || req.entityParentRid;
    if (!orgId) {
      return res.status(400).json({ error: 'orgId is required' });
    }
    const { ObjectId } = require('mongodb');
    const { limit = 50, offset = 0, status } = req.query;

    const db = await getDb();
    const logsCollection = db.collection('scheduled_job_logs');

    const filter = {
      integrationId: new ObjectId(id),
      orgId,
    };

    if (status) {
      filter.status = status;
    }

    const [logs, total] = await Promise.all([
      logsCollection
        .find(filter)
        .sort({ startedAt: -1 })
        .skip(parseInt(offset, 10))
        .limit(parseInt(limit, 10))
        .toArray(),
      logsCollection.countDocuments(filter),
    ]);

    res.set('X-Total-Count', total.toString());
    res.json(logs);
  } catch (error) {
    logError(error, { scope: 'GET /scheduled-jobs/:id/logs' });
    res.status(500).json({ error: 'Failed to fetch execution logs' });
  }
});

/**
 * GET /scheduled-jobs/:id/logs/:logId
 * Get single execution log detail
 */
router.get('/:id/logs/:logId', async (req, res) => {
  try {
    const { id, logId } = req.params;
    const orgId = req.orgId || req.entityParentRid;
    if (!orgId) {
      return res.status(400).json({ error: 'orgId is required' });
    }
    const { ObjectId } = require('mongodb');

    const db = await getDb();
    const logsCollection = db.collection('scheduled_job_logs');

    const log = await logsCollection.findOne({
      _id: new ObjectId(logId),
      integrationId: new ObjectId(id),
      orgId,
    });

    if (!log) {
      return res.status(404).json({ error: 'Execution log not found' });
    }

    res.json(log);
  } catch (error) {
    logError(error, { scope: 'GET /scheduled-jobs/:id/logs/:logId' });
    res.status(500).json({ error: 'Failed to fetch execution log' });
  }
});

/**
 * POST /scheduled-jobs/test-datasource
 * Test data source configuration and return sample data
 */
router.post('/test-datasource', async (req, res) => {
  try {
    const orgId = req.orgId || req.entityParentRid;
    if (!orgId) {
      return res.status(400).json({ error: 'orgId is required' });
    }
    const { dataSource } = req.body;

    if (!dataSource || !dataSource.type) {
      return res.status(400).json({ error: 'Data source configuration is required' });
    }

    // Create a mock integration config for testing
    const mockIntegrationConfig = {
      orgId,
      name: 'Test Data Source',
      _id: 'test',
    };

    log('info', 'Testing data source', {
      type: dataSource.type,
      orgId,
    });

    // Execute data source with 30 second timeout
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Data source test timed out after 30 seconds')), 30000)
    );

    const executePromise = executeDataSource(dataSource, mockIntegrationConfig);

    const result = await Promise.race([executePromise, timeout]);

    // Limit result size for response
    let sampleData = result;
    const totalRecords = Array.isArray(result) ? result.length : 1;
    let limitedRecords = false;

    if (Array.isArray(result) && result.length > 10) {
      sampleData = result.slice(0, 10);
      limitedRecords = true;
    }

    // Check data size and truncate if needed
    const dataString = JSON.stringify(sampleData);
    if (dataString.length > 100000) {
      // Truncate large data
      sampleData = { message: 'Data too large to display', size: dataString.length };
      limitedRecords = true;
    }

    log('info', 'Data source test successful', {
      type: dataSource.type,
      recordsFetched: totalRecords,
      orgId,
    });

    res.json({
      success: true,
      message: 'Data source connected successfully',
      recordsFetched: totalRecords,
      sampleData,
      limitedRecords,
    });
  } catch (error) {
    logError(error, { scope: 'POST /scheduled-jobs/test-datasource' });

    // Return detailed error information
    res.status(400).json({
      success: false,
      error: error.message || 'Failed to test data source',
      details: {
        code: error.code,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      },
    });
  }
});

module.exports = router;
