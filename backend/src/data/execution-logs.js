const { getDbSafe, ObjectId, toObjectId } = require('../mongodb');
const { log } = require('../logger');
const { uuidv4 } = require('../utils/runtime');

/**
 * Execution Logs Data Access Layer
 * Unified logging for OUTBOUND, INBOUND, and SCHEDULED integrations
 */

const normalizeStatus = (status) => {
  if (!status) return 'PENDING';
  const statusMap = {
    'SUCCESS': 'SUCCESS',
    'FAILED': 'FAILED',
    'PENDING': 'PENDING',
    'RETRYING': 'RETRYING',
    'ABANDONED': 'ABANDONED'
  };
  return statusMap[String(status).toUpperCase()] || String(status).toUpperCase();
};

const normalizeStatusFilter = (status) => {
  if (!status) return status;
  return normalizeStatus(status);
};

const buildIdMatch = (id) => {
  if (!id) return null;
  const idObj = toObjectId(id);
  if (idObj) {
    return {
      $or: [
        { integrationConfigId: idObj },
        { integrationConfigId: id },
        { __KEEP___KEEP_integrationConfig__Id__: idObj },
        { __KEEP___KEEP_integrationConfig__Id__: id }
      ]
    };
  }
  return {
    $or: [
      { integrationConfigId: id },
      { __KEEP___KEEP_integrationConfig__Id__: id }
    ]
  };
};

const mapExecutionLog = (log) => ({
  ...log,
  id: log._id.toString(),
  responseStatus: log.response?.statusCode || log.responseStatus,
  responseBody: log.response?.body || log.responseBody,
  requestHeaders: log.request?.headers || log.requestHeaders
});

const buildOrgScopeQuery = (orgId) => ({ orgId });

const buildExecutionLogsQuery = (orgId, filters = {}) => {
  const query = buildOrgScopeQuery(orgId);

  if (filters.direction) {
    query.direction = filters.direction;
  }
  if (filters.triggerType) {
    query.triggerType = filters.triggerType;
  }
  if (filters.status) {
    query.status = normalizeStatusFilter(filters.status);
  }
  if (filters.integrationConfigId || filters.__KEEP___KEEP_integrationConfig__Id__) {
    const id = filters.integrationConfigId || filters.__KEEP___KEEP_integrationConfig__Id__;
    const idMatch = buildIdMatch(id);
    if (idMatch) {
      Object.assign(query, idMatch);
    }
  }
  if (filters.eventType) {
    query.eventType = filters.eventType;
  }
  if (filters.messageId) {
    query.messageId = filters.messageId;
  }
  if (filters.search) {
    query.$text = { $search: filters.search };
  }
  if (filters.startDate || filters.endDate) {
    query.createdAt = {};
    if (filters.startDate) {
      query.createdAt.$gte = new Date(filters.startDate);
    }
    if (filters.endDate) {
      query.createdAt.$lte = new Date(filters.endDate);
    }
  }

  return query;
};


const safeDateMs = (value) => {
  if (!value) return null;
  const date = new Date(value);
  const ms = date.getTime();
  return Number.isFinite(ms) ? ms : null;
};

const getTraceStatus = (docs = []) => {
  const statuses = new Set(docs.map(d => normalizeStatus(d.status)));
  if (statuses.has('FAILED') || statuses.has('ABANDONED')) return 'FAILED';
  if (statuses.has('RETRYING')) return 'RETRYING';
  if (statuses.has('PENDING') || statuses.has('QUEUED')) return 'PENDING';
  if (statuses.has('SUCCESS')) return 'SUCCESS';
  return docs[docs.length - 1]?.status || 'PENDING';
};

const getStageName = (logDoc, index) => {
  if (logDoc.actionName) {
    return `action_delivery:${logDoc.actionName}`;
  }

  if (logDoc.direction === 'INBOUND') {
    return 'request_received';
  }

  if (logDoc.direction === 'COMMUNICATION' && normalizeStatus(logDoc.status) === 'PENDING') {
    return 'job_queued';
  }

  if (logDoc.direction === 'COMMUNICATION' && normalizeStatus(logDoc.status) === 'SUCCESS') {
    return 'vendor_delivery_success';
  }

  if (logDoc.direction === 'COMMUNICATION' && normalizeStatus(logDoc.status) === 'FAILED') {
    return 'vendor_delivery_failed';
  }

  return `stage_${index + 1}`;
};

const parseJsonSafely = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch (err) {
    return value;
  }
};

/**
 * Create a new execution log entry
 * @param {Object} logData - The log data
 * @returns {Promise<string>} The traceId of the created log
 */
async function createExecutionLog(logData) {
  const db = await getDbSafe();

  // Validate required fields
  if (!logData.orgId) {
    throw new Error('orgId is required to create execution log');
  }
  if (!logData.direction) {
    throw new Error('direction is required to create execution log (OUTBOUND/INBOUND/SCHEDULED)');
  }
  if (!logData.triggerType) {
    log('warn', 'triggerType not provided, defaulting to EVENT', { orgId: logData.orgId });
  }

  const traceId = logData.traceId || `trc_${uuidv4().replace(/-/g, '')}`;
  const now = new Date();

  const executionLog = {
    traceId,
    messageId: logData.messageId || null,
    direction: logData.direction, // 'OUTBOUND' | 'INBOUND' | 'SCHEDULED'
    triggerType: logData.triggerType, // 'EVENT' | 'SCHEDULE' | 'MANUAL' | 'REPLAY'
    integrationConfigId: toObjectId(logData.integrationConfigId) || logData.integrationConfigId || null,
    orgId: logData.orgId,

    // Integration/Integration details (for UI display)
    __KEEP___KEEP_integrationConfig__Id__: logData.__KEEP___KEEP_integrationConfig__Id__
      ? (toObjectId(logData.__KEEP___KEEP_integrationConfig__Id__) || logData.__KEEP___KEEP_integrationConfig__Id__)
      : (toObjectId(logData.integrationConfigId) || logData.integrationConfigId || null),
    __KEEP_integrationName__: logData.__KEEP_integrationName__ || logData.integrationName || null,

    // Event details (for OUTBOUND integrations)
    eventId: logData.eventId || null,
    eventType: logData.eventType || null,

    // Status tracking
    status: normalizeStatus(logData.status),

    // Retry management
    attemptCount: logData.attemptCount || 1,
    shouldRetry: logData.shouldRetry || false,
    lastAttemptAt: logData.lastAttemptAt || now,

    // Timing
    startedAt: logData.startedAt || now,
    finishedAt: logData.finishedAt || null,
    deliveredAt: logData.deliveredAt || null,
    durationMs: logData.durationMs || null,
    responseTimeMs: logData.responseTimeMs || logData.durationMs || null,

    // Step-by-step execution trace
    steps: logData.steps || [],

    // Request/Response data (with optional redaction)
    request: {
      headers: logData.request?.headers || logData.requestHeaders || {},
      body: logData.request?.body || {},
      url: logData.request?.url || logData.targetUrl || null,
      method: logData.request?.method || logData.httpMethod || null
    },
    response: {
      statusCode: logData.response?.statusCode || logData.responseStatus || null,
      headers: logData.response?.headers || {},
      body: logData.response?.body || logData.responseBody || {}
    },

    // Payload tracking (for OUTBOUND integrations)
    originalPayload: logData.originalPayload || {},
    requestPayload: logData.requestPayload || logData.request?.body || {},

    // Error details
    error: logData.error || (logData.errorMessage ? { message: logData.errorMessage } : null),
    errorMessage: logData.errorMessage || null,

    // Multi-action integration tracking
    actionName: logData.actionName || null,
    actionIndex: logData.actionIndex !== undefined ? logData.actionIndex : null,

    // Searchable text for patient/MRN/phone lookup
    searchableText: logData.searchableText || '',

    // Distributed tracing
    correlationId: logData.correlationId || traceId,

    // Target URL and HTTP method (top-level for easy access)
    targetUrl: logData.targetUrl || logData.request?.url || null,
    httpMethod: logData.httpMethod || logData.request?.method || null,

    // Metadata
    metadata: logData.metadata || {},

    // Timestamps
    createdAt: now,
    updatedAt: now
  };

  await db.collection('execution_logs').insertOne(executionLog);

  return traceId;
}

/**
 * Update an existing execution log
 * @param {string} traceId - The trace ID
 * @param {Object} updates - Fields to update
 */
async function updateExecutionLog(traceId, updates) {
  const db = await getDbSafe();

  const updateDoc = {
    ...updates,
    updatedAt: new Date()
  };

  if (updates.status) {
    updateDoc.status = normalizeStatus(updates.status);
  }

  // Calculate duration if finishedAt is being set
  if (updates.finishedAt) {
    const existingLog = await db.collection('execution_logs').findOne({ traceId });
    if (existingLog && existingLog.startedAt) {
      updateDoc.durationMs = updates.finishedAt - existingLog.startedAt;
    }
  }

  await db.collection('execution_logs').updateOne(
    { traceId },
    { $set: updateDoc }
  );
}

/**
 * Add a step to an execution log
 * @param {string} traceId - The trace ID
 * @param {Object} step - The step to add
 */
async function addExecutionStep(traceId, step) {
  const db = await getDbSafe();

  const stepWithTimestamp = {
    name: step.name,
    timestamp: step.timestamp || new Date(),
    durationMs: step.durationMs || null,
    status: step.status || 'success', // 'success' | 'error' | 'warning'
    metadata: step.metadata || {},
    error: step.error || null
  };

  await db.collection('execution_logs').updateOne(
    { traceId },
    {
      $push: { steps: stepWithTimestamp },
      $set: { updatedAt: new Date() }
    }
  );
}

/**
 * Get execution log by trace ID
 * @param {string} traceId - The trace ID
 * @param {number} orgId - Organization ID for security
 * @returns {Promise<Object|null>}
 */
async function getExecutionLog(traceId, orgId) {
  const db = await getDbSafe();

  const logDoc = await db.collection('execution_logs').findOne(
    { traceId, ...buildOrgScopeQuery(orgId) },
    { sort: { createdAt: -1 } }
  );

  return logDoc ? mapExecutionLog(logDoc) : null;
}

/**
 * List execution logs with filters and pagination
 * @param {number} orgId - Organization ID
 * @param {Object} filters - Filter options
 * @param {Object} pagination - Pagination options
 * @returns {Promise<Object>} { logs, total, hasMore }
 */
async function listExecutionLogs(orgId, filters = {}, pagination = {}) {
  const db = await getDbSafe();
  const query = buildExecutionLogsQuery(orgId, filters);

  const limit = Math.min(pagination.limit || 50, 1000);
  const page = pagination.page || 1;
  const skip = (page - 1) * limit;

  const [logs, total] = await Promise.all([
    db.collection('execution_logs')
      .find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .toArray(),
    db.collection('execution_logs').countDocuments(query)
  ]);

  const mappedLogs = logs.map(mapExecutionLog);

  return {
    logs: mappedLogs,
    total,
    hasMore: skip + logs.length < total,
    page,
    pages: Math.ceil(total / limit),
    limit
  };
}

async function listExecutionTraces(orgId, filters = {}, pagination = {}) {
  const db = await getDbSafe();
  const query = buildExecutionLogsQuery(orgId, filters);

  const limit = Math.min(pagination.limit || 50, 1000);
  const page = pagination.page || 1;
  const skip = (page - 1) * limit;

  const pipeline = [
    { $match: query },
    { $sort: { createdAt: 1, _id: 1 } },
    {
      $group: {
        _id: '$traceId',
        traceId: { $first: '$traceId' },
        createdAt: { $first: '$createdAt' },
        updatedAt: { $max: '$updatedAt' },
        startedAt: { $min: '$startedAt' },
        latestAt: { $max: '$createdAt' },
        docs: { $push: '$$ROOT' }
      }
    },
    { $sort: { latestAt: -1, _id: -1 } },
    {
      $facet: {
        rows: [
          { $skip: skip },
          { $limit: limit }
        ],
        meta: [
          { $count: 'total' }
        ]
      }
    }
  ];

  const aggregated = await db.collection('execution_logs').aggregate(pipeline).toArray();
  const rows = aggregated[0]?.rows || [];
  const total = aggregated[0]?.meta?.[0]?.total || 0;

  const traces = rows.map((row) => {
    const docs = row.docs || [];
    const first = docs[0] || {};
    const last = docs[docs.length - 1] || first;
    const traceStatus = getTraceStatus(docs);

    const stageTimeline = docs.map((doc, index) => ({
      name: getStageName(doc, index),
      status: normalizeStatus(doc.status),
      direction: doc.direction || null,
      actionName: doc.actionName || null,
      actionIndex: doc.actionIndex ?? null,
      timestamp: doc.createdAt || doc.startedAt || null,
      responseStatus: doc.response?.statusCode || doc.responseStatus || null,
      durationMs: doc.durationMs || doc.responseTimeMs || null
    }));

    const startedAtMs = safeDateMs(first.startedAt || first.createdAt);
    const finishedAtMs = safeDateMs(last.finishedAt || last.updatedAt || last.createdAt);
    const totalDuration = startedAtMs !== null && finishedAtMs !== null && finishedAtMs >= startedAtMs
      ? finishedAtMs - startedAtMs
      : null;

    return {
      traceId: row.traceId,
      status: traceStatus,
      direction: first.direction || null,
      triggerType: first.triggerType || null,
      integrationConfigId: first.integrationConfigId || null,
      integrationName: first.__KEEP_integrationName__ || null,
      eventType: first.eventType || null,
      messageId: first.messageId || last.messageId || null,
      startedAt: first.startedAt || first.createdAt || null,
      finishedAt: last.finishedAt || null,
      durationMs: totalDuration,
      stageCount: docs.length,
      stageTimeline,
      latestResponseStatus: last.response?.statusCode || last.responseStatus || null,
      latestResponseBody: last.response?.body || last.responseBody || null,
      latestActionName: last.actionName || null,
      latestTarget: last.targetUrl || null,
      createdAt: row.createdAt || null,
      updatedAt: row.updatedAt || row.latestAt || null
    };
  });

  return {
    logs: traces,
    total,
    hasMore: skip + traces.length < total,
    page,
    pages: Math.ceil(total / limit),
    limit
  };
}

async function getExecutionTrace(traceId, orgId) {
  const db = await getDbSafe();

  const docs = await db.collection('execution_logs')
    .find({ traceId, ...buildOrgScopeQuery(orgId) })
    .sort({ createdAt: 1, _id: 1 })
    .toArray();

  if (!docs.length) {
    return null;
  }

  const first = docs[0];
  const last = docs[docs.length - 1];
  const traceStatus = getTraceStatus(docs);

  const timeline = docs.map((doc, index) => {
    const timestamp = doc.createdAt || doc.startedAt || new Date();
    const providerHeaders = doc.request?.headers || doc.requestHeaders || {};
    const responseStatus = doc.response?.statusCode || doc.responseStatus || null;
    const stageStatus = normalizeStatus(doc.status);
    const stageName = getStageName(doc, index);

    return {
      step: stageName,
      name: stageName,
      timestamp,
      durationMs: doc.durationMs || doc.responseTimeMs || null,
      status: stageStatus,
      error: doc.error || (doc.errorMessage ? { message: doc.errorMessage } : null),
      metadata: {
        direction: doc.direction || null,
        triggerType: doc.triggerType || null,
        actionName: doc.actionName || null,
        actionIndex: doc.actionIndex ?? null,
        integrationName: doc.__KEEP_integrationName__ || null,
        responseStatus,
        targetUrl: doc.targetUrl || doc.request?.url || null,
        messageId: doc.messageId || null,
        provider: providerHeaders.provider || null,
        channel: providerHeaders.channel || null
      },
      request: doc.request || null,
      response: doc.response || null
    };
  }).map((item, index, all) => ({
    ...item,
    gapMs: index < all.length - 1
      ? Math.max(0, (safeDateMs(all[index + 1].timestamp) || 0) - (safeDateMs(item.timestamp) || 0))
      : null
  }));

  const vendorResponses = docs
    .filter(doc => doc.direction === 'COMMUNICATION')
    .map((doc) => {
      const responseBody = doc.response?.body || doc.responseBody || null;
      const parsedResponseBody = parseJsonSafely(responseBody);
      const headers = doc.request?.headers || doc.requestHeaders || {};
      return {
        stage: doc.actionName || getStageName(doc, 0),
        status: normalizeStatus(doc.status),
        timestamp: doc.createdAt || doc.startedAt || null,
        provider: headers.provider || null,
        channel: headers.channel || null,
        responseStatus: doc.response?.statusCode || doc.responseStatus || null,
        messageId: doc.messageId || null,
        target: doc.targetUrl || doc.request?.url || null,
        responseBody: parsedResponseBody
      };
    });

  const startedAtMs = safeDateMs(first.startedAt || first.createdAt);
  const finishedAtMs = safeDateMs(last.finishedAt || last.updatedAt || last.createdAt);
  const totalDuration = startedAtMs !== null && finishedAtMs !== null && finishedAtMs >= startedAtMs
    ? finishedAtMs - startedAtMs
    : null;

  const errorStep = timeline.find(step => ['FAILED', 'ABANDONED', 'ERROR'].includes(normalizeStatus(step.status)));

  return {
    summary: {
      traceId,
      status: traceStatus,
      direction: first.direction || null,
      triggerType: first.triggerType || null,
      totalDuration,
      startedAt: first.startedAt || first.createdAt || null,
      finishedAt: last.finishedAt || null,
      stepCount: timeline.length,
      errorStep: errorStep?.name || null
    },
    timeline,
    request: first.request || null,
    response: last.response || null,
    error: errorStep?.error || last.error || (last.errorMessage ? { message: last.errorMessage } : null),
    vendorResponses,
    records: docs.map(mapExecutionLog)
  };
}

/**
 * Get execution statistics
 * @param {number} orgId - Organization ID
 * @param {Object} filters - Filter options
 * @returns {Promise<Object>} Statistics object
 */
async function getExecutionStats(orgId, filters = {}) {
  const db = await getDbSafe();

  const matchStage = { orgId };

  if (filters.direction) matchStage.direction = filters.direction;
  if (filters.integrationConfigId) {
    const idMatch = buildIdMatch(filters.integrationConfigId);
    if (idMatch) {
      Object.assign(matchStage, idMatch);
    }
  }
  if (filters.startDate || filters.endDate) {
    matchStage.startedAt = {};
    if (filters.startDate) matchStage.startedAt.$gte = new Date(filters.startDate);
    if (filters.endDate) matchStage.startedAt.$lte = new Date(filters.endDate);
  }

  const stats = await db.collection('execution_logs').aggregate([
    { $match: matchStage },
    {
      $facet: {
        statusBreakdown: [
          { $group: { _id: '$status', count: { $sum: 1 } } }
        ],
        directionBreakdown: [
          { $group: { _id: '$direction', count: { $sum: 1 } } }
        ],
        avgDuration: [
          {
            $match: { durationMs: { $ne: null } }
          },
          {
            $group: {
              _id: null,
              avg: { $avg: '$durationMs' },
              min: { $min: '$durationMs' },
              max: { $max: '$durationMs' }
            }
          }
        ],
        errorBreakdown: [
          {
            $match: { status: 'FAILED', 'error.code': { $exists: true } }
          },
          {
            $group: { _id: '$error.code', count: { $sum: 1 } }
          },
          { $sort: { count: -1 } },
          { $limit: 10 }
        ]
      }
    }
  ]).toArray();

  const result = stats[0];

  return {
    statusBreakdown: result.statusBreakdown.reduce((acc, item) => {
      acc[item._id] = item.count;
      return acc;
    }, {}),
    directionBreakdown: result.directionBreakdown.reduce((acc, item) => {
      acc[item._id] = item.count;
      return acc;
    }, {}),
    performance: result.avgDuration[0] || { avg: null, min: null, max: null },
    topErrors: result.errorBreakdown
  };
}

/**
 * Get execution log by ID (for backward compatibility with getLogById)
 * @param {string} id - The log ID
 * @param {number} orgId - Organization ID for security
 * @returns {Promise<Object|null>}
 */
async function getExecutionLogById(id, orgId) {
  const db = await getDbSafe();

  const log = await db.collection('execution_logs').findOne({
    _id: toObjectId(id),
    orgId
  });

  if (!log) return null;

  // Normalize log fields for consistent API response
  return {
    ...log,
    id: log._id.toString(),
    responseStatus: log.response?.statusCode || log.responseStatus,
    responseBody: log.response?.body || log.responseBody,
    requestHeaders: log.request?.headers || log.requestHeaders
  };
}

/**
 * Get failed logs for retry
 * @param {number} batchSize - Number of logs to retrieve
 * @returns {Promise<Array>} Failed logs ready for retry
 */
async function getFailedLogsForRetry(batchSize = 10) {
  const db = await getDbSafe();

  const logs = await db.collection('execution_logs')
    .find({
      status: { $in: ['RETRYING', 'FAILED'] },
      shouldRetry: true
    })
    .sort({ lastAttemptAt: 1 })
    .limit(batchSize)
    .toArray();

  // Normalize log fields for consistent API response
  return logs.map(log => ({
    ...log,
    id: log._id.toString(),
    responseStatus: log.response?.statusCode || log.responseStatus,
    responseBody: log.response?.body || log.responseBody,
    requestHeaders: log.request?.headers || log.requestHeaders
  }));
}

/**
 * Mark log as abandoned (max retries reached)
 * @param {string} logId - The log ID
 */
async function markLogAsAbandoned(logId) {
  const db = await getDbSafe();

  await db.collection('execution_logs').updateOne(
    { _id: toObjectId(logId) },
    {
      $set: {
        status: 'ABANDONED',
        shouldRetry: false,
        updatedAt: new Date()
      }
    }
  );
}

/**
 * Get log statistics summary
 * @param {number} orgId - Organization ID
 * @param {Object} filters - Filter options
 * @returns {Promise<Object>} Statistics summary
 */
async function getExecutionLogStats(orgId, filters = {}) {
  const db = await getDbSafe();

  const matchStage = { orgId };

  if (filters.direction) matchStage.direction = filters.direction;
  if (filters.__KEEP___KEEP_integrationConfig__Id__) {
    const idMatch = buildIdMatch(filters.__KEEP___KEEP_integrationConfig__Id__);
    if (idMatch) {
      Object.assign(matchStage, idMatch);
    }
  }
  if (filters.eventType) matchStage.eventType = filters.eventType;
  if (filters.startDate || filters.endDate) {
    matchStage.createdAt = {};
    if (filters.startDate) matchStage.createdAt.$gte = new Date(filters.startDate);
    if (filters.endDate) matchStage.createdAt.$lte = new Date(filters.endDate);
  }

  const stats = await db.collection('execution_logs').aggregate([
    { $match: matchStage },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        success: {
          $sum: { $cond: [{ $eq: ['$status', 'SUCCESS'] }, 1, 0] }
        },
        failed: {
          $sum: { $cond: [{ $in: ['$status', ['FAILED', 'ABANDONED']] }, 1, 0] }
        },
        retrying: {
          $sum: { $cond: [{ $eq: ['$status', 'RETRYING'] }, 1, 0] }
        },
        pending: {
          $sum: { $cond: [{ $eq: ['$status', 'PENDING'] }, 1, 0] }
        },
        avgResponseTime: { $avg: '$responseTimeMs' }
      }
    }
  ]).toArray();

  if (stats.length === 0) {
    return {
      total: 0,
      success: 0,
      failed: 0,
      retrying: 0,
      pending: 0,
      avgResponseTime: 0
    };
  }

  return stats[0];
}

/**
 * Stream execution logs for export (CSV, etc.)
 * @param {number} orgId - Organization ID
 * @param {Object} filters - Filter options
 * @param {Function} callback - Callback function called for each log
 */
async function* streamExecutionLogsForExport(orgId, filters = {}) {
  const db = await getDbSafe();

  const query = { orgId };

  if (filters.status) query.status = normalizeStatusFilter(filters.status);
  if (filters.eventType) query.eventType = filters.eventType;
  if (filters.__KEEP___KEEP_integrationConfig__Id__) {
    const idMatch = buildIdMatch(filters.__KEEP___KEEP_integrationConfig__Id__);
    if (idMatch) {
      Object.assign(query, idMatch);
    }
  }
  if (filters.direction) query.direction = filters.direction;
  if (filters.startDate || filters.endDate) {
    query.createdAt = {};
    if (filters.startDate) query.createdAt.$gte = new Date(filters.startDate);
    if (filters.endDate) query.createdAt.$lte = new Date(filters.endDate);
  }

  const limit = filters.limit || 1000;

  const cursor = db.collection('execution_logs')
    .find(query)
    .sort({ createdAt: -1 })
    .limit(limit)
    .batchSize(100);

  for await (const log of cursor) {
    // Normalize log fields for consistent API response
    yield {
      ...log,
      id: log._id.toString(),
      responseStatus: log.response?.statusCode || log.responseStatus,
      responseBody: log.response?.body || log.responseBody,
      requestHeaders: log.request?.headers || log.requestHeaders
    };
  }
}

/**
 * Delete old execution logs (manual cleanup if TTL is disabled)
 * @param {number} daysOld - Delete logs older than this many days
 * @returns {Promise<number>} Number of deleted logs
 */
async function deleteOldExecutionLogs(daysOld = 30) {
  const db = await getDbSafe();

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysOld);

  const result = await db.collection('execution_logs').deleteMany({
    startedAt: { $lt: cutoffDate }
  });

  return result.deletedCount;
}

module.exports = {
  createExecutionLog,
  updateExecutionLog,
  addExecutionStep,
  getExecutionLog,
  getExecutionTrace,
  getExecutionLogById,
  listExecutionLogs,
  listExecutionTraces,
  getExecutionStats,
  getExecutionLogStats,
  getFailedLogsForRetry,
  markLogAsAbandoned,
  streamExecutionLogsForExport,
  deleteOldExecutionLogs
};
