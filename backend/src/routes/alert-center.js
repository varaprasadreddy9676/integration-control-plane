const express = require('express');
const data = require('../data');
const asyncHandler = require('../utils/async-handler');

const router = express.Router();

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

    const logs = await data.listAlertCenterLogs(orgId, filters);
    const csv = buildCsv(logs);
    const filename = `alert-center-${new Date().toISOString().split('T')[0]}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  })
);

module.exports = router;
