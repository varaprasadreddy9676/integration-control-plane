const express = require('express');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const data = require('../data');
const { log } = require('../logger');
const mongodb = require('../mongodb');
const asyncHandler = require('../utils/async-handler');

const router = express.Router();
const ALERT_CENTER_EXPORT_JOBS_COLLECTION = 'alert_center_export_jobs';
const ALERT_CENTER_EXPORT_TMP_DIR = path.join(os.tmpdir(), 'integration-control-plane-alert-center-exports');
const ALERT_CENTER_EXPORT_ASYNC_THRESHOLD = Math.max(
  1,
  Number.parseInt(process.env.ALERT_CENTER_EXPORT_ASYNC_THRESHOLD || '5000', 10)
);
const ALERT_CENTER_EXPORT_JOB_TTL_MS = Math.max(
  5 * 60 * 1000,
  Number.parseInt(process.env.ALERT_CENTER_EXPORT_JOB_TTL_MS || String(6 * 60 * 60 * 1000), 10)
);
let exportIndexesEnsured = false;

const parseBooleanQuery = (value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return false;
  return ['1', 'true', 'yes', 'y'].includes(value.trim().toLowerCase());
};

const ensureExportJobIndexes = async (db) => {
  if (exportIndexesEnsured) return;
  const collection = db.collection(ALERT_CENTER_EXPORT_JOBS_COLLECTION);
  try {
    await collection.createIndex({ jobId: 1 }, { unique: true });
    await collection.createIndex({ orgId: 1, createdAt: -1 });
    await collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  } catch (error) {
    log('warn', 'Failed to ensure alert-center export indexes', { error: error.message });
  }
  exportIndexesEnsured = true;
};

const toExportJobResponse = (job) => ({
  jobId: job.jobId,
  status: job.status,
  format: job.format,
  totalRecords: job.totalRecords || 0,
  processedRecords: job.processedRecords || 0,
  fileSizeBytes: job.fileSizeBytes || 0,
  fileName: job.fileName || null,
  errorMessage: job.errorMessage || null,
  createdAt: job.createdAt,
  startedAt: job.startedAt || null,
  finishedAt: job.finishedAt || null,
  expiresAt: job.expiresAt || null,
  statusPath: `/api/v1/alert-center/export/jobs/${encodeURIComponent(job.jobId)}`,
  downloadPath: `/api/v1/alert-center/export/jobs/${encodeURIComponent(job.jobId)}/download`,
});

const createExportJob = async (orgId, format, filters, totalRecords = 0) => {
  const db = await mongodb.getDbSafe();
  await ensureExportJobIndexes(db);
  const now = new Date();
  const jobId = `ace_${Date.now()}_${randomUUID().replace(/-/g, '').slice(0, 8)}`;
  const fileName = `alert-center-${now.toISOString().split('T')[0]}-${jobId}.${format}`;
  const doc = {
    jobId,
    orgId,
    format,
    filters,
    status: 'QUEUED',
    totalRecords: Number(totalRecords) || 0,
    processedRecords: 0,
    filePath: null,
    fileName,
    fileSizeBytes: 0,
    errorMessage: null,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    finishedAt: null,
    expiresAt: new Date(now.getTime() + ALERT_CENTER_EXPORT_JOB_TTL_MS),
  };
  await db.collection(ALERT_CENTER_EXPORT_JOBS_COLLECTION).insertOne(doc);
  return doc;
};

const getExportJob = async (orgId, jobId) => {
  const db = await mongodb.getDbSafe();
  await ensureExportJobIndexes(db);
  return db.collection(ALERT_CENTER_EXPORT_JOBS_COLLECTION).findOne({ orgId, jobId });
};

const processExportJob = async (jobId) => {
  const db = await mongodb.getDbSafe();
  await ensureExportJobIndexes(db);
  const jobs = db.collection(ALERT_CENTER_EXPORT_JOBS_COLLECTION);

  const claimed = await jobs.findOneAndUpdate(
    { jobId, status: 'QUEUED' },
    { $set: { status: 'PROCESSING', startedAt: new Date(), updatedAt: new Date() } },
    { returnDocument: 'after' }
  );

  const job = claimed.value;
  if (!job) return;

  await fsp.mkdir(ALERT_CENTER_EXPORT_TMP_DIR, { recursive: true });
  const filePath = path.join(ALERT_CENTER_EXPORT_TMP_DIR, `${job.jobId}.${job.format}`);

  try {
    const logs = await data.listAlertCenterLogs(job.orgId, job.filters || {});
    if (job.format === 'json') {
      await fsp.writeFile(filePath, JSON.stringify(logs), 'utf8');
    } else {
      const csv = buildCsv(logs);
      await fsp.writeFile(filePath, csv, 'utf8');
    }
    const stat = await fsp.stat(filePath);
    await jobs.updateOne(
      { jobId },
      {
        $set: {
          status: 'COMPLETED',
          processedRecords: logs.length,
          filePath,
          fileSizeBytes: stat.size,
          finishedAt: new Date(),
          updatedAt: new Date(),
          expiresAt: new Date(Date.now() + ALERT_CENTER_EXPORT_JOB_TTL_MS),
        },
      }
    );
  } catch (error) {
    try {
      await fsp.rm(filePath, { force: true });
    } catch (_err) {
      // ignore
    }
    await jobs.updateOne(
      { jobId },
      {
        $set: {
          status: 'FAILED',
          processedRecords: 0,
          errorMessage: error.message,
          finishedAt: new Date(),
          updatedAt: new Date(),
          expiresAt: new Date(Date.now() + ALERT_CENTER_EXPORT_JOB_TTL_MS),
        },
      }
    );
  }
};

const startExportJob = async (orgId, format, filters, totalRecords) => {
  const job = await createExportJob(orgId, format, filters, totalRecords);
  setImmediate(() => {
    processExportJob(job.jobId).catch((error) => {
      log('error', 'Unhandled alert-center export job failure', { jobId: job.jobId, error: error.message });
    });
  });
  return job;
};

const toCsvValue = (value) => {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes('"') || str.includes(',') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
};

const buildCsv = (rows) => {
  const headers = [
    'Alert ID',
    'Timestamp',
    'Status',
    'Channel',
    'Type',
    'Subject',
    'Recipients',
    'Total Failures',
    'Window Start',
    'Window End',
    'Error Message',
    'Error Stack',
  ];

  const lines = [headers.join(',')];
  rows.forEach((row) => {
    lines.push(
      [
        toCsvValue(row.id),
        toCsvValue(row.createdAt),
        toCsvValue(row.status),
        toCsvValue(row.channel),
        toCsvValue(row.type),
        toCsvValue(row.subject),
        toCsvValue((row.recipients || []).join('; ')),
        toCsvValue(row.totalFailures),
        toCsvValue(row.windowStart),
        toCsvValue(row.windowEnd),
        toCsvValue(row.errorMessage),
        toCsvValue(row.errorStack),
      ].join(',')
    );
  });

  return lines.join('\n');
};

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const orgId = req.orgId;
    if (!orgId) {
      return res.status(400).json({ error: 'orgId missing', code: 'VALIDATION_ERROR' });
    }

    const filters = {
      status: req.query.status,
      channel: req.query.channel,
      type: req.query.type,
      search: req.query.search,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    };

    const logs = await data.listAlertCenterLogs(orgId, filters);
    return res.json({ logs });
  })
);

router.get(
  '/status',
  asyncHandler(async (req, res) => {
    const orgId = req.orgId;
    const status = await data.getFailureReportSchedulerStatus(orgId);
    return res.json(status);
  })
);

router.get(
  '/export/json',
  asyncHandler(async (req, res) => {
    const orgId = req.orgId;
    if (!orgId) {
      return res.status(400).json({ error: 'orgId missing', code: 'VALIDATION_ERROR' });
    }

    const filters = {
      status: req.query.status,
      channel: req.query.channel,
      type: req.query.type,
      search: req.query.search,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      limit: req.query.limit ? Number(req.query.limit) : 5000,
    };

    const useAsyncExport =
      parseBooleanQuery(req.query.async) || (filters.limit && filters.limit >= ALERT_CENTER_EXPORT_ASYNC_THRESHOLD);
    if (useAsyncExport) {
      const job = await startExportJob(orgId, 'json', filters, filters.limit || 0);
      return res.status(202).json({
        ...toExportJobResponse(job),
        message: 'Alert center export queued.',
      });
    }

    const logs = await data.listAlertCenterLogs(orgId, filters);
    const filename = `alert-center-${new Date().toISOString().split('T')[0]}.json`;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.json(logs);
  })
);

router.get(
  '/export/csv',
  asyncHandler(async (req, res) => {
    const orgId = req.orgId;
    if (!orgId) {
      return res.status(400).json({ error: 'orgId missing', code: 'VALIDATION_ERROR' });
    }

    const filters = {
      status: req.query.status,
      channel: req.query.channel,
      type: req.query.type,
      search: req.query.search,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      limit: req.query.limit ? Number(req.query.limit) : 5000,
    };

    const useAsyncExport =
      parseBooleanQuery(req.query.async) || (filters.limit && filters.limit >= ALERT_CENTER_EXPORT_ASYNC_THRESHOLD);
    if (useAsyncExport) {
      const job = await startExportJob(orgId, 'csv', filters, filters.limit || 0);
      return res.status(202).json({
        ...toExportJobResponse(job),
        message: 'Alert center export queued.',
      });
    }

    const logs = await data.listAlertCenterLogs(orgId, filters);
    const csv = buildCsv(logs);
    const filename = `alert-center-${new Date().toISOString().split('T')[0]}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  })
);

router.get(
  '/export/jobs/:jobId',
  asyncHandler(async (req, res) => {
    const orgId = req.orgId;
    if (!orgId) {
      return res.status(400).json({ error: 'orgId missing', code: 'VALIDATION_ERROR' });
    }
    const job = await getExportJob(orgId, req.params.jobId);
    if (!job) {
      return res.status(404).json({ error: 'Export job not found', code: 'NOT_FOUND' });
    }
    return res.json(toExportJobResponse(job));
  })
);

router.get(
  '/export/jobs/:jobId/download',
  asyncHandler(async (req, res) => {
    const orgId = req.orgId;
    if (!orgId) {
      return res.status(400).json({ error: 'orgId missing', code: 'VALIDATION_ERROR' });
    }
    const job = await getExportJob(orgId, req.params.jobId);
    if (!job) {
      return res.status(404).json({ error: 'Export job not found', code: 'NOT_FOUND' });
    }
    if (job.status !== 'COMPLETED') {
      return res.status(409).json({ error: 'Export job is not ready', code: 'EXPORT_NOT_READY' });
    }
    if (!job.filePath) {
      return res.status(500).json({ error: 'Export file path missing', code: 'EXPORT_FILE_MISSING' });
    }

    try {
      await fsp.access(job.filePath, fs.constants.R_OK);
    } catch (_err) {
      return res.status(410).json({ error: 'Export file expired', code: 'EXPORT_FILE_EXPIRED' });
    }

    const contentType = job.format === 'csv' ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${job.fileName || path.basename(job.filePath)}"`);

    return new Promise((resolve, reject) => {
      const stream = fs.createReadStream(job.filePath);
      const onClose = () => {
        cleanup();
        resolve();
      };
      const onEnd = () => {
        cleanup();
        resolve();
      };
      const onError = (err) => {
        cleanup();
        if (res.headersSent) {
          resolve();
          return;
        }
        reject(err);
      };
      const cleanup = () => {
        stream.off('error', onError);
        stream.off('end', onEnd);
        res.off('close', onClose);
      };
      stream.on('error', onError);
      stream.on('end', onEnd);
      res.on('close', onClose);
      stream.pipe(res);
    });
  })
);

module.exports = router;
