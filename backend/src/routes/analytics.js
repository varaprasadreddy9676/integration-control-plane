const express = require('express');
const { log } = require('../logger');
const mongodb = require('../mongodb');
const asyncHandler = require('../utils/async-handler');

const router = express.Router();

const RESPONSE_BUCKETS = [0, 100, 500, 1000, 2000, 5000, 10000, 30000, 60000, 120000, 300000, 600000, 1000000000];
const RESPONSE_BUCKET_LABELS = [
  '< 100ms',
  '100-500ms',
  '500ms-1s',
  '1-2s',
  '2-5s',
  '5-10s',
  '10-30s',
  '30-60s',
  '1-2m',
  '2-5m',
  '5-10m',
  '> 10m',
];

function normalizeStatus(status) {
  if (!status) return '';
  return String(status).toUpperCase();
}

function addCount(map, key, value) {
  if (!key) return;
  map[key] = (map[key] || 0) + value;
}

function mergeBuckets(target, buckets) {
  for (const bucket of buckets) {
    const idx = bucket.index;
    target[idx] = (target[idx] || 0) + bucket.count;
  }
}

function computePercentileFromBuckets(bucketCounts, total, percentile) {
  if (!total || total <= 0) return 0;
  const target = total * percentile;
  let cumulative = 0;
  for (let i = 0; i < bucketCounts.length; i++) {
    cumulative += bucketCounts[i] || 0;
    if (cumulative >= target) {
      return RESPONSE_BUCKETS[i + 1] || RESPONSE_BUCKETS[RESPONSE_BUCKETS.length - 1];
    }
  }
  return RESPONSE_BUCKETS[RESPONSE_BUCKETS.length - 1];
}

function getDateRange(days) {
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - days);
  return { start, end };
}

function parseDateFilters(req) {
  const { startDate, endDate } = req.query;
  let start;
  let end;

  if (startDate) {
    start = new Date(startDate);
    if (Number.isNaN(start.getTime())) {
      throw new Error('Invalid startDate format');
    }
  }

  if (endDate) {
    end = new Date(endDate);
    if (Number.isNaN(end.getTime())) {
      throw new Error('Invalid endDate format');
    }
  }

  return { start, end };
}

function normalizeTriggerTypeFilter(triggerType) {
  if (!triggerType) return null;
  if (triggerType === 'SCHEDULED') {
    return { $in: ['SCHEDULED', 'SCHEDULE'] };
  }
  return triggerType;
}

// buildDeliveryMatchStage removed - now using unified buildExecutionMatchStage only

function buildExecutionMatchStage(req, { start, end }) {
  const matchStage = { orgId: req.orgId };

  if (start || end) {
    matchStage.startedAt = {};
    if (start) matchStage.startedAt.$gte = start;
    if (end) matchStage.startedAt.$lte = end;
  }

  if (req.query.direction) {
    matchStage.direction = req.query.direction;
  }

  if (req.query.triggerType) {
    matchStage.triggerType = normalizeTriggerTypeFilter(req.query.triggerType);
  }

  const integrationId = req.query.integrationId || req.query.integrationId;
  if (integrationId) {
    const integrationIdObj = mongodb.toObjectId(integrationId);
    if (integrationIdObj) {
      matchStage.$or = [
        { integrationConfigId: integrationIdObj },
        { integrationConfigId: integrationId },
        { __KEEP___KEEP_integrationConfig__Id__: integrationIdObj },
        { __KEEP___KEEP_integrationConfig__Id__: integrationId },
      ];
    } else {
      matchStage.$or = [
        { integrationConfigId: integrationId },
        { __KEEP___KEEP_integrationConfig__Id__: integrationId },
      ];
    }
  }

  return matchStage;
}

function buildErrorCategories(message, statusCode) {
  if (!message && !statusCode) return 'Other';
  const msg = (message || '').toLowerCase();

  if (statusCode) {
    if (statusCode >= 500) return 'Server Error';
    if (statusCode === 429) return 'Rate Limited';
    if (statusCode >= 400) return 'Client Error';
  }

  if (msg.includes('timeout')) return 'Timeout';
  if (msg.includes('network') || msg.includes('connection')) return 'Network';
  if (msg.includes('dns') || msg.includes('resolve')) return 'DNS';
  if (msg.includes('ssl') || msg.includes('tls') || msg.includes('certificate')) return 'SSL/TLS';
  if (msg.includes('transform') || msg.includes('script')) return 'Transformation';
  if (msg.includes('auth')) return 'Authentication';

  return 'Other';
}

async function aggregateOverviewCollection(db, collection, match, fields) {
  const statusAgg = await db
    .collection(collection)
    .aggregate([{ $match: match }, { $group: { _id: `$${fields.statusField}`, count: { $sum: 1 } } }])
    .toArray();

  const totalAgg = await db
    .collection(collection)
    .aggregate([{ $match: match }, { $count: 'total' }])
    .toArray();

  const eventTypeAgg = await db
    .collection(collection)
    .aggregate([
      { $match: match },
      { $group: { _id: `$${fields.eventTypeField}`, count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ])
    .toArray();

  const integrationAgg = await db
    .collection(collection)
    .aggregate([
      { $match: match },
      {
        $group: {
          _id: `$${fields.integrationIdField}`,
          integrationName: { $max: `$${fields.integrationNameField}` },
          total: { $sum: 1 },
          successful: {
            $sum: {
              $cond: [{ $in: [`$${fields.statusField}`, ['SUCCESS', 'success']] }, 1, 0],
            },
          },
          failed: {
            $sum: {
              $cond: [
                {
                  $in: [`$${fields.statusField}`, ['FAILED', 'failed', 'SKIPPED', 'skipped', 'ABANDONED', 'abandoned']],
                },
                1,
                0,
              ],
            },
          },
          responseTimeSum: {
            $sum: {
              $cond: [{ $gt: [`$${fields.responseTimeField}`, 0] }, `$${fields.responseTimeField}`, 0],
            },
          },
          responseTimeCount: {
            $sum: {
              $cond: [{ $gt: [`$${fields.responseTimeField}`, 0] }, 1, 0],
            },
          },
        },
      },
    ])
    .toArray();

  const responseAgg = await db
    .collection(collection)
    .aggregate([
      { $match: match },
      { $match: { [fields.responseTimeField]: { $gt: 0 } } },
      {
        $group: {
          _id: null,
          avgResponseTime: { $avg: `$${fields.responseTimeField}` },
          responseTimeCount: { $sum: 1 },
        },
      },
    ])
    .toArray();

  const bucketAgg = await db
    .collection(collection)
    .aggregate([
      { $match: match },
      { $match: { [fields.responseTimeField]: { $gt: 0 } } },
      {
        $bucket: {
          groupBy: `$${fields.responseTimeField}`,
          boundaries: RESPONSE_BUCKETS,
          default: RESPONSE_BUCKETS[RESPONSE_BUCKETS.length - 1],
          output: { count: { $sum: 1 } },
        },
      },
    ])
    .toArray();

  return {
    statusAgg,
    total: totalAgg[0]?.total || 0,
    eventTypeAgg,
    integrationAgg,
    responseAgg: responseAgg[0] || { avgResponseTime: 0, responseTimeCount: 0 },
    bucketAgg,
  };
}

async function aggregateTimeseriesCollection(db, collection, match, fields, interval) {
  const format = interval === 'day' ? '%Y-%m-%dT00:00:00.000Z' : '%Y-%m-%dT%H:00:00.000Z';

  return db
    .collection(collection)
    .aggregate([
      { $match: match },
      {
        $group: {
          _id: {
            $dateToString: { format, date: `$${fields.timeField}` },
          },
          total: { $sum: 1 },
          successful: {
            $sum: {
              $cond: [{ $in: [`$${fields.statusField}`, ['SUCCESS', 'success']] }, 1, 0],
            },
          },
          failed: {
            $sum: {
              $cond: [
                {
                  $in: [`$${fields.statusField}`, ['FAILED', 'failed', 'SKIPPED', 'skipped', 'ABANDONED', 'abandoned']],
                },
                1,
                0,
              ],
            },
          },
          responseTimeSum: {
            $sum: {
              $cond: [{ $gt: [`$${fields.responseTimeField}`, 0] }, `$${fields.responseTimeField}`, 0],
            },
          },
          responseTimeCount: {
            $sum: {
              $cond: [{ $gt: [`$${fields.responseTimeField}`, 0] }, 1, 0],
            },
          },
        },
      },
      { $sort: { _id: 1 } },
    ])
    .toArray();
}

async function aggregateErrorCollection(db, collection, match, fields) {
  const errorMatch = {
    ...match,
    [fields.statusField]: { $in: ['FAILED', 'failed'] },
  };

  return db
    .collection(collection)
    .aggregate([
      { $match: errorMatch },
      {
        $group: {
          _id: {
            message: { $ifNull: [`$${fields.errorMessageField}`, 'Unknown error'] },
            status: `$${fields.responseStatusField}`,
          },
          count: { $sum: 1 },
          lastSeen: { $max: `$${fields.timeField}` },
        },
      },
      { $sort: { count: -1 } },
    ])
    .toArray();
}

async function aggregatePerformanceCollection(db, collection, match, fields) {
  const totalAgg = await db
    .collection(collection)
    .aggregate([{ $match: match }, { $count: 'totalRequests' }])
    .toArray();

  const successAgg = await db
    .collection(collection)
    .aggregate([
      { $match: match },
      { $match: { [fields.statusField]: { $in: ['SUCCESS', 'success'] } } },
      { $count: 'successfulRequests' },
    ])
    .toArray();

  const responseAgg = await db
    .collection(collection)
    .aggregate([
      { $match: match },
      { $match: { [fields.statusField]: { $in: ['SUCCESS', 'success'] } } },
      { $match: { [fields.responseTimeField]: { $gt: 0 } } },
      {
        $group: {
          _id: null,
          avgResponseTime: { $avg: `$${fields.responseTimeField}` },
          minResponseTime: { $min: `$${fields.responseTimeField}` },
          maxResponseTime: { $max: `$${fields.responseTimeField}` },
          responseTimeCount: { $sum: 1 },
        },
      },
    ])
    .toArray();

  const bucketAgg = await db
    .collection(collection)
    .aggregate([
      { $match: match },
      { $match: { [fields.statusField]: { $in: ['SUCCESS', 'success'] } } },
      { $match: { [fields.responseTimeField]: { $gt: 0 } } },
      {
        $bucket: {
          groupBy: `$${fields.responseTimeField}`,
          boundaries: RESPONSE_BUCKETS,
          default: RESPONSE_BUCKETS[RESPONSE_BUCKETS.length - 1],
          output: { count: { $sum: 1 } },
        },
      },
    ])
    .toArray();

  return {
    totalRequests: totalAgg[0]?.totalRequests || 0,
    successfulRequests: successAgg[0]?.successfulRequests || 0,
    responseAgg: responseAgg[0] || { avgResponseTime: 0, minResponseTime: 0, maxResponseTime: 0, responseTimeCount: 0 },
    bucketAgg,
  };
}

function bucketAggToIndexCounts(bucketAgg) {
  return bucketAgg
    .map((bucket) => {
      const idx = RESPONSE_BUCKETS.indexOf(bucket._id);
      return { index: Math.max(0, idx - 1), count: bucket.count || 0 };
    })
    .filter((item) => item.index >= 0);
}

// deliveryFields removed - now using unified executionFields only

const executionFields = {
  statusField: 'status',
  responseTimeField: 'durationMs',
  eventTypeField: 'metadata.eventType',
  integrationIdField: 'integrationConfigId',
  integrationNameField: 'metadata.integrationName',
  errorMessageField: 'error.message',
  responseStatusField: 'response.statusCode',
  timeField: 'startedAt',
};

router.get(
  '/overview',
  asyncHandler(async (req, res) => {
    try {
      const { days = 30 } = req.query;
      const parsedDays = parseInt(days, 10);
      const { start: startOverride, end: endOverride } = parseDateFilters(req);
      const { start: defaultStart, end: defaultEnd } = getDateRange(parsedDays);
      const start = startOverride || defaultStart;
      const end = endOverride || defaultEnd;

      const db = await mongodb.getDbSafe();
      const executionMatch = buildExecutionMatchStage(req, { start, end });

      const execution = await aggregateOverviewCollection(db, 'execution_logs', executionMatch, executionFields);

      const statusCounts = {};
      const eventTypeCounts = {};
      const integrationMap = {};

      for (const item of execution.statusAgg) {
        addCount(statusCounts, normalizeStatus(item._id), item.count);
      }

      const total = execution.total;

      for (const item of execution.eventTypeAgg) {
        addCount(eventTypeCounts, item._id, item.count);
      }

      for (const item of execution.integrationAgg) {
        const id = item._id ? String(item._id) : null;
        if (!id) continue;
        if (!integrationMap[id]) {
          integrationMap[id] = {
            __KEEP___KEEP_integrationConfig__Id__: id,
            __KEEP_integrationName__: item.integrationName || null,
            total: 0,
            successful: 0,
            failed: 0,
            responseTimeSum: 0,
            responseTimeCount: 0,
          };
        }
        integrationMap[id].__KEEP_integrationName__ =
          integrationMap[id].__KEEP_integrationName__ || item.integrationName || null;
        integrationMap[id].total += item.total || 0;
        integrationMap[id].successful += item.successful || 0;
        integrationMap[id].failed += item.failed || 0;
        integrationMap[id].responseTimeSum += item.responseTimeSum || 0;
        integrationMap[id].responseTimeCount += item.responseTimeCount || 0;
      }

      const integrationPerformance = Object.values(integrationMap)
        .map((perf) => ({
          __KEEP___KEEP_integrationConfig__Id__: perf.__KEEP___KEEP_integrationConfig__Id__,
          __KEEP_integrationName__: perf.__KEEP_integrationName__,
          total: perf.total,
          successful: perf.successful,
          failed: perf.failed,
          avgResponseTime: perf.responseTimeCount > 0 ? Math.round(perf.responseTimeSum / perf.responseTimeCount) : 0,
          successRate: perf.total > 0 ? Math.round((perf.successful / perf.total) * 10000) / 100 : 0,
        }))
        .sort((a, b) => b.total - a.total);

      const mergedBuckets = new Array(RESPONSE_BUCKETS.length - 1).fill(0);
      mergeBuckets(mergedBuckets, bucketAggToIndexCounts(execution.bucketAgg));

      const responseTimeCount = execution.responseAgg.responseTimeCount || 0;
      const responseTimeSum =
        (execution.responseAgg.avgResponseTime || 0) * (execution.responseAgg.responseTimeCount || 0);

      const avgResponseTime = responseTimeCount > 0 ? Math.round(responseTimeSum / responseTimeCount) : 0;
      const p95ResponseTime = computePercentileFromBuckets(mergedBuckets, responseTimeCount, 0.95);

      const successful = statusCounts.SUCCESS || 0;
      const failed = (statusCounts.FAILED || 0) + (statusCounts.SKIPPED || 0) + (statusCounts.ABANDONED || 0);
      const retrying = statusCounts.RETRYING || 0;
      const pending = statusCounts.PENDING || 0;
      const successRate = total > 0 ? Math.round((successful / total) * 10000) / 100 : 0;

      res.json({
        period: {
          start: start?.toISOString?.() || null,
          end: end?.toISOString?.() || null,
          days: parsedDays,
        },
        summary: {
          total,
          successful,
          failed,
          retrying,
          pending,
          successRate,
        },
        performance: {
          avgResponseTime,
          p95ResponseTime,
          totalRequests: total,
        },
        eventTypes: eventTypeCounts,
        integrationPerformance,
      });
    } catch (error) {
      log('error', 'Analytics overview failed', {
        error: error.message,
        orgId: req.orgId,
      });
      res.status(500).json({
        error: 'Analytics overview failed',
        code: 'ANALYTICS_ERROR',
      });
    }
  })
);

router.get(
  '/timeseries',
  asyncHandler(async (req, res) => {
    try {
      const { days = 7, interval = 'hour' } = req.query;
      const parsedDays = parseInt(days, 10);
      const { start: startOverride, end: endOverride } = parseDateFilters(req);
      const { start: defaultStart, end: defaultEnd } = getDateRange(parsedDays);
      const start = startOverride || defaultStart;
      const end = endOverride || defaultEnd;

      const db = await mongodb.getDbSafe();
      const executionMatch = buildExecutionMatchStage(req, { start, end });

      const executionSeries = await aggregateTimeseriesCollection(
        db,
        'execution_logs',
        executionMatch,
        executionFields,
        interval
      );

      const seriesMap = new Map();

      for (const row of executionSeries) {
        const key = row._id;
        if (!seriesMap.has(key)) {
          seriesMap.set(key, {
            timestamp: key,
            total: 0,
            successful: 0,
            failed: 0,
            responseTimeSum: 0,
            responseTimeCount: 0,
          });
        }
        const entry = seriesMap.get(key);
        entry.total += row.total || 0;
        entry.successful += row.successful || 0;
        entry.failed += row.failed || 0;
        entry.responseTimeSum += row.responseTimeSum || 0;
        entry.responseTimeCount += row.responseTimeCount || 0;
      }

      const timeseries = Array.from(seriesMap.values())
        .map((row) => ({
          timestamp: row.timestamp,
          total: row.total,
          successful: row.successful,
          failed: row.failed,
          avgResponseTime: row.responseTimeCount > 0 ? Math.round(row.responseTimeSum / row.responseTimeCount) : 0,
          successRate: row.total > 0 ? Math.round((row.successful / row.total) * 10000) / 100 : 0,
        }))
        .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

      res.json({
        period: {
          start: start?.toISOString?.() || null,
          end: end?.toISOString?.() || null,
          interval,
        },
        data: timeseries,
      });
    } catch (error) {
      log('error', 'Time series analytics failed', {
        error: error.message,
        orgId: req.orgId,
      });
      res.status(500).json({
        error: 'Time series analytics failed',
        code: 'TIMESERIES_ERROR',
      });
    }
  })
);

router.get(
  '/errors',
  asyncHandler(async (req, res) => {
    try {
      const { days = 7 } = req.query;
      const parsedDays = parseInt(days, 10);
      const { start: startOverride, end: endOverride } = parseDateFilters(req);
      const { start: defaultStart, end: defaultEnd } = getDateRange(parsedDays);
      const start = startOverride || defaultStart;
      const end = endOverride || defaultEnd;

      const db = await mongodb.getDbSafe();
      const executionMatch = buildExecutionMatchStage(req, { start, end });

      const executionErrors = await aggregateErrorCollection(db, 'execution_logs', executionMatch, executionFields);

      const errorCategories = {};
      const errorMap = new Map();

      for (const item of executionErrors) {
        const message = item._id.message || 'Unknown error';
        const statusCode = item._id.status;
        const category = buildErrorCategories(message, statusCode);
        addCount(errorCategories, category, item.count || 0);

        if (!errorMap.has(message)) {
          errorMap.set(message, { message, count: 0, lastSeen: null });
        }
        const entry = errorMap.get(message);
        entry.count += item.count || 0;
        if (!entry.lastSeen || new Date(item.lastSeen) > new Date(entry.lastSeen)) {
          entry.lastSeen = item.lastSeen;
        }
      }

      const topErrors = Array.from(errorMap.values())
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);

      const totalErrors = Array.from(errorMap.values()).reduce((sum, entry) => sum + entry.count, 0);

      res.json({
        period: {
          start: start?.toISOString?.() || null,
          end: end?.toISOString?.() || null,
        },
        summary: {
          totalErrors,
          errorCategories,
          topErrors,
        },
        integrationBreakdown: [],
      });
    } catch (error) {
      log('error', 'Error analytics failed', {
        error: error.message,
        orgId: req.orgId,
      });
      res.status(500).json({
        error: 'Error analytics failed',
        code: 'ERROR_ANALYTICS_ERROR',
      });
    }
  })
);

router.get(
  '/performance',
  asyncHandler(async (req, res) => {
    try {
      const { days = 30 } = req.query;
      const parsedDays = parseInt(days, 10);
      const { start: startOverride, end: endOverride } = parseDateFilters(req);
      const { start: defaultStart, end: defaultEnd } = getDateRange(parsedDays);
      const start = startOverride || defaultStart;
      const end = endOverride || defaultEnd;

      const db = await mongodb.getDbSafe();
      const executionMatch = buildExecutionMatchStage(req, { start, end });

      const executionPerf = await aggregatePerformanceCollection(db, 'execution_logs', executionMatch, executionFields);

      const totalRequests = executionPerf.totalRequests;
      const successfulRequests = executionPerf.successfulRequests;

      const mergedBuckets = new Array(RESPONSE_BUCKETS.length - 1).fill(0);
      mergeBuckets(mergedBuckets, bucketAggToIndexCounts(executionPerf.bucketAgg));

      const responseTimeCount = executionPerf.responseAgg.responseTimeCount || 0;
      const responseTimeSum =
        (executionPerf.responseAgg.avgResponseTime || 0) * (executionPerf.responseAgg.responseTimeCount || 0);

      const avgResponseTime = responseTimeCount > 0 ? Math.round(responseTimeSum / responseTimeCount) : 0;
      const minResponseTime = executionPerf.responseAgg.minResponseTime || 0;
      const maxResponseTime = executionPerf.responseAgg.maxResponseTime || 0;

      const metrics = {
        totalRequests,
        successfulRequests,
        avgResponseTime,
        minResponseTime: minResponseTime === Infinity ? 0 : minResponseTime,
        maxResponseTime,
        p50ResponseTime: computePercentileFromBuckets(mergedBuckets, responseTimeCount, 0.5),
        p90ResponseTime: computePercentileFromBuckets(mergedBuckets, responseTimeCount, 0.9),
        p95ResponseTime: computePercentileFromBuckets(mergedBuckets, responseTimeCount, 0.95),
        p99ResponseTime: computePercentileFromBuckets(mergedBuckets, responseTimeCount, 0.99),
      };

      const buckets = mergedBuckets.map((count, index) => ({
        label: RESPONSE_BUCKET_LABELS[index] || '> 10m',
        count,
      }));

      res.json({
        period: { start: start?.toISOString?.() || null, end: end?.toISOString?.() || null },
        metrics,
        distribution: { buckets },
      });
    } catch (error) {
      log('error', 'Performance analytics failed', {
        error: error.message,
        orgId: req.orgId,
      });
      res.status(500).json({
        error: 'Performance analytics failed',
        code: 'PERFORMANCE_ERROR',
      });
    }
  })
);

module.exports = router;
