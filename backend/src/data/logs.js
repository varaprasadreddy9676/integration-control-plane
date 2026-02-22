'use strict';
const { log, logError } = require('../logger');
const mongodb = require('../mongodb');
const {
  useMongo,
  normalizeOrgId,
  buildOrgScopeQuery,
  addOrgScope,
  fallbackDisabledError,
  mapLogFromMongo,
  mapIntegrationFromMongo,
} = require('./helpers');

/**
 * Build query object for delivery logs filtering
 * Extracted for reuse across listLogs, countLogs, getLogStatsSummary, and streamLogsForExport
 */
function buildLogsQuery(orgId, filters = {}) {
  const query = addOrgScope({}, orgId);
  const andConditions = [];

  if (filters.status) {
    const statusValue = String(filters.status).toUpperCase();
    // Handle comma-separated status values (e.g., "FAILED,SKIPPED,ABANDONED")
    if (statusValue.includes(',')) {
      query.status = { $in: statusValue.split(',').map((s) => s.trim()) };
    } else {
      query.status = statusValue;
    }
  }
  if (filters.direction) {
    query.direction = filters.direction;
  }
  if (filters.triggerType) {
    query.triggerType = filters.triggerType;
  }
  const integrationFilterId =
    filters.__KEEP___KEEP_integrationConfig__Id__ || filters.integrationConfigId || filters.webhookId;
  if (integrationFilterId) {
    const integrationIdObj = mongodb.toObjectId(integrationFilterId);
    if (integrationIdObj) {
      andConditions.push({
        $or: [
          { __KEEP___KEEP_integrationConfig__Id__: integrationIdObj },
          { __KEEP___KEEP_integrationConfig__Id__: integrationFilterId },
          { integrationConfigId: integrationIdObj },
          { integrationConfigId: integrationFilterId },
          { webhookConfigId: integrationIdObj },
          { webhookConfigId: integrationFilterId },
        ],
      });
    } else {
      andConditions.push({
        $or: [
          { __KEEP___KEEP_integrationConfig__Id__: integrationFilterId },
          { integrationConfigId: integrationFilterId },
          { webhookConfigId: integrationFilterId },
        ],
      });
    }
  }
  if (filters.eventType) {
    query.eventType = filters.eventType;
  }
  if (filters.search) {
    // Use regex search for flexible full-text search across multiple fields
    // This searches: __KEEP_integrationName__, eventType, errorMessage, targetUrl, responseBody
    // Case-insensitive regex search
    const searchRegex = { $regex: filters.search, $options: 'i' };
    andConditions.push({
      $or: [
        { __KEEP_integrationName__: searchRegex },
        { eventType: searchRegex },
        { errorMessage: searchRegex },
        { targetUrl: searchRegex },
        { responseBody: searchRegex },
        { 'requestPayload.mrn': searchRegex },
        { 'requestPayload.patient_name': searchRegex },
        { 'requestPayload.phone': searchRegex },
      ],
    });

    // Note: For better search performance on large datasets,
    // consider creating a text index and using $text search
  }

  // Combine $and conditions if any exist
  if (andConditions.length > 0) {
    query.$and = query.$and ? [...query.$and, ...andConditions] : andConditions;
  }

  // Add date range filtering
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
}

/**
 * Count delivery logs matching filters (for pagination metadata)
 * @param {number} orgId - Parent entity ID
 * @param {object} filters - Same filters as listLogs
 * @returns {Promise<number>} Total count of matching logs
 */
async function countLogs(orgId, filters = {}) {
  if (useMongo()) {
    try {
      const db = await mongodb.getDbSafe();
      const query = buildLogsQuery(orgId, filters);
      return await db.collection('execution_logs').countDocuments(query);
    } catch (err) {
      logError(err, { scope: 'countLogs', filters });
      throw err;
    }
  }
  return fallbackDisabledError('countLogs:fallback');
}

/**
 * List delivery logs with server-side pagination support
 * @param {number} orgId - Parent entity ID
 * @param {object} filters - Filtering and pagination options
 *   - status: Filter by delivery status
 *   - __KEEP___KEEP_integrationConfig__Id__: Filter by integration configuration
 *   - eventType: Filter by event type
 *   - search: Full-text search
 *   - startDate/endDate: Date range filtering
 *   - page: Page number (1-indexed, default: 1)
 *   - limit: Results per page (default: 500, max: 1000)
 * @returns {Promise<Array>} Array of delivery log objects
 */
async function listLogs(orgId, filters = {}) {
  if (useMongo()) {
    try {
      const db = await mongodb.getDbSafe();
      const query = buildLogsQuery(orgId, filters);

      // Pagination with validation
      const page = Math.max(1, parseInt(filters.page) || 1);
      const limit = Math.min(1000, Math.max(1, parseInt(filters.limit) || 500));
      const skip = (page - 1) * limit;

      const logs = await db
        .collection('execution_logs')
        .find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .toArray();

      return logs.map(mapLogFromMongo);
    } catch (err) {
      logError(err, { scope: 'listLogs', filters });
      throw err; // Re-throw the actual error for better debugging
    }
  }
  return fallbackDisabledError('listLogs:fallback');
}

/**
 * Get delivery log statistics summary using unbounded MongoDB aggregation
 * This does NOT use listLogs() to avoid the row limit cap
 * @param {number} orgId - Parent entity ID
 * @param {object} filters - Filtering options (__KEEP___KEEP_integrationConfig__Id__, eventType, dateRange)
 * @returns {Promise<object>} Statistics summary with total, success, failed, pending counts
 */
async function getLogStatsSummary(orgId, filters = {}) {
  if (useMongo()) {
    try {
      const db = await mongodb.getDbSafe();

      // Build match stage for aggregation (similar to buildLogsQuery but for aggregation pipeline)
      const matchStage = addOrgScope({}, orgId);

      if (filters.__KEEP___KEEP_integrationConfig__Id__) {
        const integrationIdObj = mongodb.toObjectId(filters.__KEEP___KEEP_integrationConfig__Id__);
        if (integrationIdObj) {
          matchStage.$and = matchStage.$and || [];
          matchStage.$and.push({
            $or: [
              { __KEEP___KEEP_integrationConfig__Id__: integrationIdObj },
              { __KEEP___KEEP_integrationConfig__Id__: filters.__KEEP___KEEP_integrationConfig__Id__ },
              { integrationConfigId: integrationIdObj },
              { integrationConfigId: filters.__KEEP___KEEP_integrationConfig__Id__ },
            ],
          });
        } else {
          matchStage.$and = matchStage.$and || [];
          matchStage.$and.push({
            $or: [
              { __KEEP___KEEP_integrationConfig__Id__: filters.__KEEP___KEEP_integrationConfig__Id__ },
              { integrationConfigId: filters.__KEEP___KEEP_integrationConfig__Id__ },
            ],
          });
        }
      }
      if (filters.eventType) {
        matchStage.eventType = filters.eventType;
      }
      if (filters.direction) {
        matchStage.direction = filters.direction;
      }
      if (filters.triggerType) {
        matchStage.triggerType = filters.triggerType;
      }
      if (filters.startDate || filters.endDate) {
        matchStage.createdAt = {};
        if (filters.startDate) {
          matchStage.createdAt.$gte = new Date(filters.startDate);
        }
        if (filters.endDate) {
          matchStage.createdAt.$lte = new Date(filters.endDate);
        }
      }

      const stats = await db
        .collection('execution_logs')
        .aggregate([
          { $match: matchStage },
          {
            $group: {
              _id: null,
              total: { $sum: 1 },
              success: { $sum: { $cond: [{ $eq: ['$status', 'SUCCESS'] }, 1, 0] } },
              failed: { $sum: { $cond: [{ $in: ['$status', ['FAILED', 'ABANDONED']] }, 1, 0] } },
              pending: {
                $sum: {
                  $cond: [{ $or: [{ $eq: ['$status', 'PENDING'] }, { $eq: ['$status', 'RETRYING'] }] }, 1, 0],
                },
              },
            },
          },
        ])
        .toArray();

      const result = stats[0] || { total: 0, success: 0, failed: 0, pending: 0 };
      return {
        total: result.total,
        success: result.success,
        failed: result.failed,
        pending: result.pending,
        refreshedAt: new Date().toISOString(),
      };
    } catch (err) {
      logError(err, { scope: 'getLogStatsSummary', filters });
      throw err;
    }
  }
  return fallbackDisabledError('getLogStatsSummary:fallback');
}

/**
 * Stream delivery logs for export using cursor-based iteration
 * Handles millions of rows efficiently without loading all into memory
 * @param {number} orgId - Parent entity ID
 * @param {object} filters - Same filters as listLogs (excluding page/limit)
 * @param {function} onLog - Callback function called for each log entry
 * @returns {Promise<number>} Total count of exported logs
 */
async function streamLogsForExport(orgId, filters = {}, onLog, options = {}) {
  if (useMongo()) {
    let cursor;
    try {
      const db = await mongodb.getDbSafe();
      const query = buildLogsQuery(orgId, filters);

      let count = 0;
      cursor = db
        .collection('execution_logs')
        .find(query)
        .sort({ createdAt: -1 })
        .batchSize(100) // Process 100 documents at a time for memory efficiency
        .noCursorTimeout(); // Prevent cursor timeout for large exports

      for await (const doc of cursor) {
        if (options.shouldStop && options.shouldStop()) {
          break;
        }
        const logEntry = mapLogFromMongo(doc);
        await onLog(logEntry);
        count++;
      }

      return count;
    } catch (err) {
      logError(err, { scope: 'streamLogsForExport', filters });
      throw err;
    } finally {
      // Ensure cursor is closed even if export is aborted
      if (cursor) {
        try {
          await cursor.close();
        } catch (closeErr) {
          // Cursor might already be closed, ignore error
        }
      }
    }
  }
  return fallbackDisabledError('streamLogsForExport:fallback');
}

async function getLogById(orgId, id) {
  const normalizedOrgId = normalizeOrgId(orgId);
  if (!normalizedOrgId) return undefined;

  if (useMongo()) {
    try {
      const db = await mongodb.getDbSafe();
      const logDoc = await db.collection('execution_logs').findOne({
        _id: mongodb.toObjectId(id),
        ...buildOrgScopeQuery(normalizedOrgId),
      });

      if (!logDoc) return undefined;

      const mappedLog = mapLogFromMongo(logDoc);

      // Fetch integration config for enhanced UI (curl command generation)
      try {
        if (mappedLog.__KEEP___KEEP_integrationConfig__Id__) {
          const integration = await db.collection('integration_configs').findOne({
            _id: mongodb.toObjectId(mappedLog.__KEEP___KEEP_integrationConfig__Id__),
          });
          if (integration) {
            mappedLog.__KEEP_integrationConfig__ = mapIntegrationFromMongo(integration);
          }
        }
      } catch (integrationErr) {
        log('warn', 'Failed to fetch integration config', {
          logId: id,
          error: integrationErr.message,
        });
      }

      // Fetch detailed retry attempts for enhanced UI
      try {
        const attempts = await db
          .collection('delivery_attempts')
          .find({
            deliveryLogId: id,
            ...buildOrgScopeQuery(normalizedOrgId),
          })
          .sort({ attemptNumber: 1 })
          .toArray();

        if (attempts && attempts.length > 0) {
          mappedLog.retryAttempts = attempts.map((attempt) => ({
            attemptNumber: attempt.attemptNumber,
            status: attempt.status,
            responseStatus: attempt.responseStatus,
            responseBody: attempt.responseBody,
            responseTimeMs: attempt.responseTimeMs,
            errorMessage: attempt.errorMessage,
            requestPayload: attempt.requestPayload,
            requestHeaders: attempt.requestHeaders,
            targetUrl: attempt.targetUrl,
            httpMethod: attempt.httpMethod,
            attemptedAt: attempt.attemptedAt?.toISOString(),
            retryReason: attempt.retryReason,
          }));
        }
      } catch (attemptErr) {
        log('warn', 'Failed to fetch retry attempts', {
          logId: id,
          error: attemptErr.message,
        });
        mappedLog.retryAttempts = [];
      }

      return mappedLog;
    } catch (err) {
      logError(err, { scope: 'getLogById', id });
    }
  }
  return fallbackDisabledError('getLogById:fallback');
}

async function recordLog(orgId, logPayload) {
  const normalizedOrgId = normalizeOrgId(orgId);
  if (!normalizedOrgId) {
    throw new Error('orgId is required');
  }

  if (useMongo()) {
    try {
      const db = await mongodb.getDbSafe();
      const errorCategory = logPayload.errorCategory || logPayload.error?.category || null;
      const integrationConfigId =
        logPayload.__KEEP___KEEP_integrationConfig__Id__ ||
        logPayload.integrationConfigId ||
        logPayload.webhookConfigId;

      // Normalize status to uppercase for consistency
      const normalizeStatus = (status) => {
        if (!status) return 'PENDING';
        const statusMap = {
          SUCCESS: 'SUCCESS',
          FAILED: 'FAILED',
          PENDING: 'PENDING',
          RETRYING: 'RETRYING',
          ABANDONED: 'ABANDONED',
          SKIPPED: 'SKIPPED',
        };
        return statusMap[status.toUpperCase()] || status.toUpperCase();
      };

      // Extract searchable patient data from requestPayload for fast text search
      const requestPayload = logPayload.requestPayload || {};
      const payloadData = requestPayload.d?.[0] || {};
      const profileData = payloadData.profileData || {};
      const evtData = payloadData.evtData || {};

      const searchableText = [
        payloadData.identity,
        profileData.Name,
        profileData.Phone,
        profileData.MRN,
        evtData['Patient Name'],
        evtData['MRN'],
      ]
        .filter(Boolean)
        .join(' ');

      // If an existing log ID is provided (retries or execution logger), update instead of inserting a new document
      // The ID can be either a MongoDB ObjectId (for retries) or a traceId string (from execution logger)
      let existingLogId = null;
      let queryField = '_id';
      if (logPayload.id) {
        // If id is a valid ObjectId, update by _id; otherwise treat it as traceId.
        // This supports req_* correlation IDs in addition to trc_* IDs.
        const asObjectId = mongodb.toObjectId(logPayload.id);
        if (asObjectId) {
          existingLogId = asObjectId;
          queryField = '_id';
        } else if (typeof logPayload.id === 'string') {
          existingLogId = logPayload.id;
          queryField = 'traceId';
        }
      }
      const __KEEP___KEEP_integrationConfig__Id__Obj = mongodb.toObjectId(integrationConfigId);
      if (existingLogId) {
        const attemptCount = logPayload.attemptCount || 1;

        // Fetch integration config to populate missing fields
        let integrationName =
          logPayload.__KEEP_integrationName__ || logPayload.integrationName || logPayload.webhookName;
        let eventType = logPayload.eventType;

        if ((!integrationName || !eventType) && __KEEP___KEEP_integrationConfig__Id__Obj) {
          try {
            const integrationConfig = await db.collection('integration_configs').findOne({
              _id: __KEEP___KEEP_integrationConfig__Id__Obj,
            });
            if (integrationConfig) {
              integrationName = integrationName || integrationConfig.name;
              eventType = eventType || integrationConfig.eventType;
            }
          } catch (err) {
            // If integration config fetch fails, continue with null values
            log('warn', 'Failed to fetch integration config for log update', {
              integrationConfigId: __KEEP___KEEP_integrationConfig__Id__Obj?.toString(),
              error: err.message,
            });
          }
        }

        const updateDoc = {
          eventId: logPayload.eventId || null,
          status: normalizeStatus(logPayload.status),
          'response.statusCode': logPayload.responseStatus,
          'response.body': logPayload.responseBody || null,
          responseStatus: logPayload.responseStatus,
          responseBody: logPayload.responseBody || null,
          responseTimeMs: logPayload.responseTimeMs || null,
          attemptCount,
          deliveredAt: logPayload.deliveredAt || null,
          finishedAt: logPayload.deliveredAt || null,
          errorMessage: logPayload.errorMessage || null,
          errorCategory,
          error:
            logPayload.error ||
            (logPayload.errorMessage || errorCategory
              ? { message: logPayload.errorMessage || null, category: errorCategory }
              : null),
          originalPayload: logPayload.originalPayload || {},
          requestPayload: logPayload.requestPayload || {},
          'request.body': logPayload.requestPayload || {},
          webhookName: integrationName || null,
          __KEEP_integrationName__: integrationName || null,
          webhookConfigId: __KEEP___KEEP_integrationConfig__Id__Obj || integrationConfigId || null,
          transformedPayload: logPayload.requestPayload || {},
          orgUnitRid: logPayload.orgUnitRid || logPayload.entityRid || normalizedOrgId,
          targetUrl: logPayload.targetUrl,
          httpMethod: logPayload.httpMethod,
          'request.url': logPayload.targetUrl,
          'request.method': logPayload.httpMethod,
          correlationId: logPayload.correlationId || null,
          traceId: logPayload.traceId || logPayload.correlationId || null,
          'request.headers': logPayload.requestHeaders || {},
          requestHeaders: logPayload.requestHeaders || null,
          shouldRetry: logPayload.shouldRetry || false,
          integrationConfigId: __KEEP___KEEP_integrationConfig__Id__Obj || integrationConfigId || null,
          __KEEP___KEEP_integrationConfig__Id__:
            __KEEP___KEEP_integrationConfig__Id__Obj || integrationConfigId || null,
          searchableText,
          lastAttemptAt: new Date(),
          updatedAt: new Date(),
        };

        if (logPayload.direction) {
          updateDoc.direction = logPayload.direction;
        }
        if (logPayload.triggerType) {
          updateDoc.triggerType = logPayload.triggerType;
        }
        // Set eventType from logPayload or fetched integration config
        if (eventType) {
          updateDoc.eventType = eventType;
          updateDoc.integrationType = eventType;
        }
        if (logPayload.actionName !== undefined) {
          updateDoc.actionName = logPayload.actionName;
        }
        if (logPayload.actionIndex !== undefined) {
          updateDoc.actionIndex = logPayload.actionIndex;
        }

        const updateQuery =
          queryField === 'traceId'
            ? { traceId: existingLogId, orgId: normalizedOrgId }
            : { _id: existingLogId, orgId: normalizedOrgId };

        const updateResult = await db.collection('execution_logs').updateOne(updateQuery, { $set: updateDoc });

        // If the document was not found (edge case), fall back to insert
        if (updateResult.matchedCount === 0) {
          log('warn', 'Existing log not found for update, inserting new log', {
            logId: logPayload.id,
            orgId: normalizedOrgId,
          });
        } else {
          // Record attempt details for retries
          if (logPayload.attemptDetails) {
            const attemptDoc = {
              deliveryLogId: existingLogId.toString(),
              orgId: normalizedOrgId,
              __KEEP___KEEP_integrationConfig__Id__: logPayload.__KEEP___KEEP_integrationConfig__Id__,
              attemptNumber: logPayload.attemptDetails.attemptNumber || attemptCount,
              status: normalizeStatus(logPayload.status),
              responseStatus: logPayload.responseStatus,
              responseBody: logPayload.responseBody || null,
              responseTimeMs: logPayload.responseTimeMs || null,
              errorMessage: logPayload.errorMessage || null,
              requestPayload: logPayload.requestPayload || {},
              requestHeaders: logPayload.attemptDetails.requestHeaders || {},
              targetUrl: logPayload.attemptDetails.targetUrl,
              httpMethod: logPayload.attemptDetails.httpMethod || 'POST',
              attemptedAt: logPayload.createdAt || new Date(),
              retryReason: logPayload.attemptDetails.retryReason || null,
            };

            await db.collection('delivery_attempts').insertOne(attemptDoc);
          }

          return existingLogId.toString();
        }
      }

      // Fetch integration config to populate missing fields
      let integrationName = logPayload.__KEEP_integrationName__ || logPayload.integrationName || logPayload.webhookName;
      let eventType = logPayload.eventType;

      if ((!integrationName || !eventType) && __KEEP___KEEP_integrationConfig__Id__Obj) {
        try {
          const integrationConfig = await db.collection('integration_configs').findOne({
            _id: __KEEP___KEEP_integrationConfig__Id__Obj,
          });
          if (integrationConfig) {
            integrationName = integrationName || integrationConfig.name;
            eventType = eventType || integrationConfig.eventType;
          }
        } catch (err) {
          // If integration config fetch fails, continue with null values
          log('warn', 'Failed to fetch integration config for log', {
            integrationConfigId: __KEEP___KEEP_integrationConfig__Id__Obj?.toString(),
            error: err.message,
          });
        }
      }

      // Insert new execution log
      const logDoc = {
        traceId:
          logPayload.traceId ||
          logPayload.correlationId ||
          `trc_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
        messageId: logPayload.messageId || null,
        orgId: normalizedOrgId,
        orgUnitRid: logPayload.orgUnitRid || logPayload.entityRid || normalizedOrgId,
        webhookName: integrationName || null,
        webhookConfigId: __KEEP___KEEP_integrationConfig__Id__Obj || integrationConfigId || null,
        transformedPayload: logPayload.requestPayload || {},
        direction: logPayload.direction || 'OUTBOUND',
        triggerType: logPayload.triggerType || 'EVENT',
        integrationConfigId: __KEEP___KEEP_integrationConfig__Id__Obj || integrationConfigId || null,
        __KEEP___KEEP_integrationConfig__Id__: __KEEP___KEEP_integrationConfig__Id__Obj || integrationConfigId || null,
        __KEEP_integrationName__: integrationName,
        eventId: logPayload.eventId || null,
        eventType: eventType,
        actionName: logPayload.actionName || null,
        actionIndex: Number.isFinite(logPayload.actionIndex) ? logPayload.actionIndex : null,
        status: normalizeStatus(logPayload.status),
        responseStatus: logPayload.responseStatus,
        responseBody: logPayload.responseBody || null,
        responseTimeMs: logPayload.responseTimeMs || null,
        attemptCount: logPayload.attemptCount || 1,
        shouldRetry: logPayload.shouldRetry || false,
        lastAttemptAt: new Date(),
        startedAt: logPayload.createdAt || new Date(),
        finishedAt: logPayload.deliveredAt || null,
        deliveredAt: logPayload.deliveredAt || null,
        durationMs: logPayload.responseTimeMs || null,
        errorMessage: logPayload.errorMessage || null,
        errorCategory,
        error:
          logPayload.error ||
          (logPayload.errorMessage || errorCategory
            ? { message: logPayload.errorMessage || null, category: errorCategory }
            : null),
        originalPayload: logPayload.originalPayload || {},
        requestPayload: logPayload.requestPayload || {},
        targetUrl: logPayload.targetUrl,
        httpMethod: logPayload.httpMethod,
        correlationId: logPayload.correlationId || null,
        requestHeaders: logPayload.requestHeaders || null,
        searchableText,
        request: {
          url: logPayload.targetUrl,
          method: logPayload.httpMethod,
          headers: logPayload.requestHeaders || {},
          body: logPayload.requestPayload || {},
        },
        response: {
          statusCode: logPayload.responseStatus,
          headers: {},
          body: logPayload.responseBody || {},
        },
        steps: [],
        metadata: {},
        createdAt: logPayload.createdAt || new Date(),
        updatedAt: new Date(),
      };

      const result = await db.collection('execution_logs').insertOne(logDoc);

      // Record detailed attempt information for enhanced UI
      if (logPayload.attemptDetails) {
        const attemptDoc = {
          deliveryLogId: result.insertedId.toString(),
          orgId: normalizedOrgId,
          __KEEP___KEEP_integrationConfig__Id__: logPayload.__KEEP___KEEP_integrationConfig__Id__,
          attemptNumber: logPayload.attemptDetails.attemptNumber || 1,
          status: logPayload.status,
          responseStatus: logPayload.responseStatus,
          responseBody: logPayload.responseBody || null,
          responseTimeMs: logPayload.responseTimeMs || null,
          errorMessage: logPayload.errorMessage || null,
          requestPayload: logPayload.requestPayload || {},
          requestHeaders: logPayload.attemptDetails.requestHeaders || {},
          targetUrl: logPayload.attemptDetails.targetUrl,
          httpMethod: logPayload.attemptDetails.httpMethod || 'POST',
          attemptedAt: logPayload.createdAt || new Date(),
          retryReason: logPayload.attemptDetails.retryReason || null,
        };

        await db.collection('delivery_attempts').insertOne(attemptDoc);
      }

      return result.insertedId.toString();
    } catch (err) {
      logError(err, { scope: 'recordLog' });
    }
  }
  return fallbackDisabledError('recordLog:fallback');
}

// Bulk retry logs - Mark multiple failed logs for retry
async function bulkRetryLogs(orgId, ids) {
  if (useMongo()) {
    try {
      const db = await mongodb.getDbSafe();

      // Convert string IDs to ObjectIds and track failed conversions
      const objectIds = [];
      const failedIds = [];

      for (const id of ids) {
        try {
          objectIds.push(mongodb.toObjectId(id));
        } catch (err) {
          failedIds.push(id);
          log('warn', 'Invalid log ID in bulk retry', { id, error: err.message });
        }
      }

      if (objectIds.length === 0) {
        return { retriedCount: 0, failedIds };
      }

      // Only retry logs that are FAILED
      const result = await db.collection('execution_logs').updateMany(
        {
          _id: { $in: objectIds },
          orgId,
          status: 'FAILED',
        },
        {
          $set: {
            status: 'RETRYING',
            shouldRetry: true,
            lastAttemptAt: new Date(),
            updatedAt: new Date(),
          },
        }
      );

      log('info', 'Bulk retry completed', {
        scope: 'bulkRetryLogs',
        requested: ids.length,
        retried: result.modifiedCount,
        failed: failedIds.length,
      });

      return {
        retriedCount: result.modifiedCount,
        failedIds,
      };
    } catch (err) {
      logError(err, { scope: 'bulkRetryLogs' });
      return { retriedCount: 0, failedIds: ids };
    }
  }

  return fallbackDisabledError('bulkRetryLogs:fallback');
}

// Bulk delete logs
async function bulkDeleteLogs(orgId, ids) {
  if (useMongo()) {
    try {
      const db = await mongodb.getDbSafe();

      // Convert string IDs to ObjectIds and track failed conversions
      const objectIds = [];
      const failedIds = [];

      for (const id of ids) {
        try {
          objectIds.push(mongodb.toObjectId(id));
        } catch (err) {
          failedIds.push(id);
          log('warn', 'Invalid log ID in bulk delete', { id, error: err.message });
        }
      }

      if (objectIds.length === 0) {
        return { deletedCount: 0, failedIds };
      }

      // Delete delivery logs
      const result = await db.collection('execution_logs').deleteMany({
        _id: { $in: objectIds },
        orgId,
      });

      // Also delete associated delivery attempts
      await db.collection('delivery_attempts').deleteMany({
        deliveryLogId: { $in: ids },
        ...buildOrgScopeQuery(orgId),
      });

      log('info', 'Bulk delete completed', {
        scope: 'bulkDeleteLogs',
        requested: ids.length,
        deleted: result.deletedCount,
        failed: failedIds.length,
      });

      return {
        deletedCount: result.deletedCount,
        failedIds,
      };
    } catch (err) {
      logError(err, { scope: 'bulkDeleteLogs' });
      return { deletedCount: 0, failedIds: ids };
    }
  }

  return fallbackDisabledError('bulkDeleteLogs:fallback');
}

module.exports = {
  buildLogsQuery,
  countLogs,
  listLogs,
  getLogStatsSummary,
  streamLogsForExport,
  getLogById,
  recordLog,
  bulkRetryLogs,
  bulkDeleteLogs,
};
