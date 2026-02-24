const express = require('express');
const data = require('../data');
const { log } = require('../logger');
const asyncHandler = require('../utils/async-handler');

const router = express.Router();

const writeWithBackpressure = (req, res, chunk, isAborted) => {
  if (isAborted()) {
    return Promise.resolve(false);
  }

  const ok = res.write(chunk);
  if (ok) {
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    const onDrain = () => cleanup(true);
    const onClose = () => cleanup(false);
    const cleanup = (canContinue) => {
      res.off('drain', onDrain);
      req.off('close', onClose);
      req.off('aborted', onClose);
      resolve(canContinue);
    };

    res.once('drain', onDrain);
    req.once('close', onClose);
    req.once('aborted', onClose);
  });
};

// Bulk operations - Must be defined BEFORE /:id routes to avoid parameter matching
router.post(
  '/bulk/retry',
  asyncHandler(async (req, res) => {
    const { ids } = req.body;

    // Validation
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({
        error: 'ids must be a non-empty array',
        code: 'VALIDATION_ERROR',
      });
    }

    if (ids.length > 100) {
      return res.status(400).json({
        error: 'Cannot retry more than 100 logs at once',
        code: 'VALIDATION_ERROR',
      });
    }

    const result = await data.bulkRetryLogs(req.orgId, ids);

    log('info', 'Bulk log retry', {
      orgId: req.orgId,
      idsCount: ids.length,
      retriedCount: result.retriedCount,
    });

    return res.json({
      message: `Successfully queued ${result.retriedCount} log(s) for retry`,
      retriedCount: result.retriedCount,
      failedIds: result.failedIds,
    });
  })
);

router.delete(
  '/bulk',
  asyncHandler(async (req, res) => {
    const { ids } = req.body;

    // Validation
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({
        error: 'ids must be a non-empty array',
        code: 'VALIDATION_ERROR',
      });
    }

    if (ids.length > 100) {
      return res.status(400).json({
        error: 'Cannot delete more than 100 logs at once',
        code: 'VALIDATION_ERROR',
      });
    }

    const result = await data.bulkDeleteLogs(req.orgId, ids);

    log('info', 'Bulk log delete', {
      orgId: req.orgId,
      idsCount: ids.length,
      deletedCount: result.deletedCount,
    });

    return res.json({
      message: `Successfully deleted ${result.deletedCount} log(s)`,
      deletedCount: result.deletedCount,
      failedIds: result.failedIds,
    });
  })
);

// Cleanup stuck RETRYING logs
router.post(
  '/cleanup/stuck-retrying',
  asyncHandler(async (req, res) => {
    const { hoursThreshold } = req.body;

    // Default to 4 hours if not specified
    const threshold = hoursThreshold && hoursThreshold > 0 ? hoursThreshold : 4;

    // Prevent unreasonably low thresholds
    if (threshold < 1) {
      return res.status(400).json({
        error: 'hoursThreshold must be at least 1 hour',
        code: 'VALIDATION_ERROR',
      });
    }

    const result = await data.cleanupStuckRetryingLogs(threshold);

    log('info', 'Cleaned up stuck RETRYING logs', {
      orgId: req.orgId,
      hoursThreshold: threshold,
      logsUpdated: result.logsUpdated,
    });

    return res.json({
      success: true,
      message: `Successfully marked ${result.logsUpdated} stuck log(s) as ABANDONED`,
      logsUpdated: result.logsUpdated,
      hoursThreshold: result.hoursThreshold,
    });
  })
);

router.get(
  '/stats/summary',
  asyncHandler(async (req, res) => {
    // Use dedicated aggregation function for unbounded stats calculation
    // This does NOT use listLogs() to avoid the 500-row cap
    const filters = {
      __KEEP___KEEP_integrationConfig__Id__: req.query.integrationId || req.query.integrationId,
      eventType: req.query.eventType,
      direction: req.query.direction,
      triggerType: req.query.triggerType,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
    };

    const stats = await data.getLogStatsSummary(req.orgId, filters);
    res.json(stats);
  })
);

router.post(
  '/:id/replay',
  asyncHandler(async (req, res) => {
    try {
      const logEntry = await data.getLogById(req.orgId, req.params.id);
      if (!logEntry) {
        return res.status(404).json({ error: 'Log not found', code: 'NOT_FOUND' });
      }

      if (logEntry.status !== 'FAILED') {
        return res.status(400).json({
          error: 'Can only replay failed deliveries',
          code: 'INVALID_REPLAY',
        });
      }

      // Get integration configuration
      const integration = await data.getIntegrationById(logEntry.__KEEP___KEEP_integrationConfig__Id__);
      if (!integration || !integration.isActive) {
        return res.status(400).json({
          error: 'Integration configuration not found or inactive',
          code: 'WEBHOOK_INACTIVE',
        });
      }

      // Create replay event with marker
      const replayData = {
        id: logEntry.id,
        event_type: logEntry.eventType,
        entity_rid: req.orgId,
        payload: logEntry.requestPayload,
        replayed: true,
        original_log_id: req.params.id,
        replay_reason: req.body.reason || 'Manual replay by user',
      };

      // Process replay using existing delivery logic
      const { replayEvent } = require('../processor/retry-handler');
      const forceReplay = Boolean(req.body?.force);
      await replayEvent(req.params.id, req.orgId, { ...req.body, force: forceReplay });

      log('info', 'Event replayed', {
        originalLogId: req.params.id,
        __KEEP___KEEP_integrationConfig__Id__: logEntry.__KEEP___KEEP_integrationConfig__Id__,
        eventType: logEntry.eventType,
        reason: req.body.reason || 'Manual replay',
        force: forceReplay,
      });

      res.json({
        message: 'Event replay initiated',
        replayId: replayData.id,
        status: 'queued',
      });
    } catch (error) {
      log('error', 'Replay failed', { error: error.message, scope: 'replay-event' });
      res.status(500).json({
        error: 'Replay failed',
        code: 'INTERNAL_ERROR',
      });
    }
  })
);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const filters = {
      status: req.query.status,
      __KEEP___KEEP_integrationConfig__Id__: req.query.integrationId || req.query.integrationId,
      eventType: req.query.eventType,
      direction: req.query.direction,
      triggerType: req.query.triggerType,
      search: req.query.search,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      page: req.query.page,
      limit: req.query.limit,
    };

    // Fetch logs and total count in parallel for pagination
    const [logs, total] = await Promise.all([data.listLogs(req.orgId, filters), data.countLogs(req.orgId, filters)]);

    // Calculate pagination metadata
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(1000, Math.max(1, parseInt(req.query.limit, 10) || 500));
    const totalPages = Math.ceil(total / limit);

    res.json({
      data: logs,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
    });
  })
);

router.get(
  '/export',
  asyncHandler(async (req, res) => {
    let aborted = false;

    try {
      const filters = {
        status: req.query.status,
        __KEEP___KEEP_integrationConfig__Id__: req.query.integrationId || req.query.integrationId,
        eventType: req.query.eventType,
        direction: req.query.direction,
        triggerType: req.query.triggerType,
        search: req.query.search,
        startDate: req.query.startDate,
        endDate: req.query.endDate,
      };

      const markAborted = () => {
        aborted = true;
      };
      req.on('close', markAborted);
      req.on('aborted', markAborted);

      const isAborted = () => aborted;

      // Set headers for streaming CSV download
      const filename = `integration-delivery-logs-${new Date().toISOString().split('T')[0]}.csv`;
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Transfer-Encoding', 'chunked');

      // Enhanced CSV headers with more details
      const headers = [
        'Log ID',
        'Timestamp',
        'Integration Name',
        'Event Type',
        'Flow',
        'Status',
        'HTTP Status',
        'Response Time (ms)',
        'Attempt Count',
        'Target URL',
        'HTTP Method',
        'cURL Command',
        'Request Payload (JSON)',
        'Response Body',
        'Error Message',
      ];

      // Helper function to escape CSV cells
      const escapeCsvCell = (cell) => {
        if (cell == null) return '';
        // Serialize objects (e.g. responseBody stored as object in MongoDB)
        const str = typeof cell === 'object' ? JSON.stringify(cell) : String(cell);
        // Replace newlines with a space — raw newlines inside cells create phantom
        // blank rows in Excel because Excel can't distinguish them from row boundaries
        const sanitized = str.replace(/\r\n/g, ' ').replace(/[\r\n]/g, ' ');
        if (sanitized.includes(',') || sanitized.includes('"')) {
          return `"${sanitized.replace(/"/g, '""')}"`;
        }
        return sanitized;
      };

      // Helper function to generate curl command
      const generateCurlCommand = (integration, payload) => {
        if (!integration) return 'N/A';

        let curl = `curl -X ${integration.httpMethod} "${integration.targetUrl}"`;
        curl += ` -H "Content-Type: application/json"`;

        // Add auth headers
        if (integration.outgoingAuthType === 'API_KEY' && integration.outgoingAuthConfig) {
          const headerName = integration.outgoingAuthConfig.headerName || 'X-API-Key';
          const value = integration.outgoingAuthConfig.value || '[REDACTED]';
          curl += ` -H "${headerName}: ${value.substring(0, 8)}..."`;
        } else if (integration.outgoingAuthType === 'BEARER' && integration.outgoingAuthConfig) {
          curl += ` -H "Authorization: Bearer ${(integration.outgoingAuthConfig.value || '[REDACTED]').substring(0, 12)}..."`;
        } else if (integration.outgoingAuthType === 'BASIC' && integration.outgoingAuthConfig) {
          curl += ` -H "Authorization: Basic [REDACTED]"`;
        }

        curl += ` -d '${JSON.stringify(payload || {}).substring(0, 200)}${JSON.stringify(payload || {}).length > 200 ? '...' : ''}'`;

        return curl;
      };

      // Write CSV header row — use \r\n (RFC 4180) so Excel treats it as a row boundary
      const headerWritten = await writeWithBackpressure(
        req,
        res,
        `${headers.map(escapeCsvCell).join(',')}\r\n`,
        isAborted
      );
      if (!headerWritten) {
        return;
      }

      // Cache for integration configs to avoid duplicate fetches
      const integrationCache = new Map();

      let exportCount = 0;

      // Stream logs using cursor-based iteration
      await data.streamLogsForExport(
        req.orgId,
        filters,
        async (logEntry) => {
          if (isAborted()) {
            return;
          }

          // Fetch integration config if not cached
          let integration = null;
          if (logEntry.__KEEP___KEEP_integrationConfig__Id__) {
            if (integrationCache.has(logEntry.__KEEP___KEEP_integrationConfig__Id__)) {
              integration = integrationCache.get(logEntry.__KEEP___KEEP_integrationConfig__Id__);
            } else {
              try {
                integration = await data.getIntegrationById(logEntry.__KEEP___KEEP_integrationConfig__Id__);
                if (integration) {
                  integrationCache.set(logEntry.__KEEP___KEEP_integrationConfig__Id__, integration);
                }
              } catch (_err) {
                // Integration might be deleted, use null
              }
            }
          }

          // Build CSV row
          const flowLabel =
            logEntry.direction === 'OUTBOUND' && logEntry.triggerType === 'SCHEDULED'
              ? 'SCHEDULED'
              : logEntry.direction || 'OUTBOUND';
          const row = [
            logEntry.id,
            logEntry.createdAt,
            logEntry.__KEEP_integrationName__,
            logEntry.eventType,
            flowLabel,
            logEntry.status,
            logEntry.responseStatus ?? 'N/A',
            logEntry.responseTimeMs ?? 'N/A',
            logEntry.attemptCount ?? 0,
            integration?.targetUrl ?? 'N/A',
            integration?.httpMethod ?? 'N/A',
            generateCurlCommand(integration, logEntry.requestPayload),
            logEntry.requestPayload,   // escapeCsvCell serializes objects
            logEntry.responseBody,     // escapeCsvCell serializes objects + sanitizes newlines
            logEntry.errorMessage ?? '',
          ];

          // Write row to stream with backpressure handling
          const canContinue = await writeWithBackpressure(req, res, `${row.map(escapeCsvCell).join(',')}\r\n`, isAborted);
          if (!canContinue) return;

          exportCount++;

          // Yield control to event loop every 100 rows for better performance
          if (exportCount % 100 === 0) {
            await new Promise((resolve) => setImmediate(resolve));
          }
        },
        { shouldStop: isAborted }
      );

      // End the stream
      if (!isAborted()) {
        res.end();

        log('info', 'CSV export completed', {
          orgId: req.orgId,
          exportCount,
          filters,
        });
      } else {
        log('warn', 'CSV export aborted by client', {
          orgId: req.orgId,
          filters,
        });
      }
    } catch (error) {
      log('error', 'CSV export failed', { error: error.message, aborted });
      // If headers not sent yet, send error response
      if (!res.headersSent) {
        res.status(500).json({ error: 'Export failed', code: 'INTERNAL_ERROR' });
      } else if (!aborted) {
        // If streaming already started but not aborted, end the stream
        res.end();
      }
    }
  })
);

// Export selected logs by IDs (POST for bulk IDs)
router.post(
  '/export/selected',
  asyncHandler(async (req, res) => {
    try {
      const { ids, format = 'json' } = req.body;

      // Validation
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({
          error: 'ids must be a non-empty array',
          code: 'VALIDATION_ERROR',
        });
      }

      if (ids.length > 1000) {
        return res.status(400).json({
          error: 'Cannot export more than 1000 logs at once',
          code: 'VALIDATION_ERROR',
        });
      }

      // Fetch logs by IDs
      const logPromises = ids.map((id) => data.getLogById(req.orgId, id));
      const logs = (await Promise.all(logPromises)).filter(Boolean); // Remove nulls

      if (logs.length === 0) {
        return res.status(404).json({
          error: 'No logs found for the provided IDs',
          code: 'NOT_FOUND',
        });
      }

      // Fetch integration configs to enrich log data
      const integrationCache = new Map();
      for (const logEntry of logs) {
        if (
          logEntry.__KEEP___KEEP_integrationConfig__Id__ &&
          !integrationCache.has(logEntry.__KEEP___KEEP_integrationConfig__Id__)
        ) {
          try {
            const integration = await data.getIntegrationById(logEntry.__KEEP___KEEP_integrationConfig__Id__);
            if (integration) {
              integrationCache.set(logEntry.__KEEP___KEEP_integrationConfig__Id__, integration);
            }
          } catch (_err) {
            // Integration might be deleted
          }
        }
      }

      if (format === 'csv') {
        // CSV export
        const headers = [
          'Log ID',
          'Timestamp',
          'Integration Name',
          'Event Type',
          'Flow',
          'Status',
          'HTTP Status',
          'Response Time (ms)',
          'Attempt Count',
          'Target URL',
          'HTTP Method',
          'Request Payload (JSON)',
          'Response Body',
          'Error Message',
        ];

        const escapeCsvCell = (cell) => {
          if (cell == null) return '';
          const str = typeof cell === 'object' ? JSON.stringify(cell) : String(cell);
          const sanitized = str.replace(/\r\n/g, ' ').replace(/[\r\n]/g, ' ');
          if (sanitized.includes(',') || sanitized.includes('"')) {
            return `"${sanitized.replace(/"/g, '""')}"`;
          }
          return sanitized;
        };

        const csvRows = logs.map((logEntry) => {
          const integration = integrationCache.get(logEntry.__KEEP___KEEP_integrationConfig__Id__);
          const flowLabel =
            logEntry.direction === 'OUTBOUND' && logEntry.triggerType === 'SCHEDULED'
              ? 'SCHEDULED'
              : logEntry.direction || 'OUTBOUND';
          return [
            logEntry.id,
            logEntry.createdAt,
            logEntry.__KEEP_integrationName__,
            logEntry.eventType,
            flowLabel,
            logEntry.status,
            logEntry.responseStatus ?? 'N/A',
            logEntry.responseTimeMs ?? 'N/A',
            logEntry.attemptCount ?? 0,
            integration?.targetUrl ?? 'N/A',
            integration?.httpMethod ?? 'N/A',
            logEntry.requestPayload,
            logEntry.responseBody,
            logEntry.errorMessage ?? '',
          ];
        });

        const csvContent = [
          headers.map(escapeCsvCell).join(','),
          ...csvRows.map((row) => row.map(escapeCsvCell).join(',')),
        ].join('\r\n');

        const filename = `integration-logs-selected-${logs.length}-${new Date().toISOString().split('T')[0]}.csv`;
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(csvContent);
      } else {
        // JSON export
        const cleanLogs = logs.map(({ tenantId, ...rest }) => {
          const flow =
            rest.direction === 'OUTBOUND' && rest.triggerType === 'SCHEDULED'
              ? 'SCHEDULED'
              : rest.direction || 'OUTBOUND';
          return { ...rest, flow };
        });
        const filename = `integration-logs-selected-${logs.length}-${new Date().toISOString().split('T')[0]}.json`;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.json(cleanLogs);
      }

      log('info', 'Selected logs exported', {
        orgId: req.orgId,
        count: logs.length,
        format,
      });
    } catch (error) {
      log('error', 'Selected export failed', { error: error.message });
      res.status(500).json({ error: 'Export failed', code: 'INTERNAL_ERROR' });
    }
  })
);

router.get(
  '/export/json',
  asyncHandler(async (req, res) => {
    try {
      const filters = {
        status: req.query.status,
        __KEEP___KEEP_integrationConfig__Id__: req.query.integrationId || req.query.integrationId,
        eventType: req.query.eventType,
        direction: req.query.direction,
        triggerType: req.query.triggerType,
        search: req.query.search,
        startDate: req.query.startDate,
        endDate: req.query.endDate,
      };

      let aborted = false;
      const markAborted = () => {
        aborted = true;
      };
      req.on('close', markAborted);
      req.on('aborted', markAborted);

      const isAborted = () => aborted;

      // Set headers for JSON file download
      const filename = `integration-delivery-logs-${new Date().toISOString().split('T')[0]}.json`;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

      const opened = await writeWithBackpressure(req, res, '[', isAborted);
      if (!opened) {
        return;
      }

      let isFirst = true;
      await data.streamLogsForExport(
        req.orgId,
        filters,
        async (logEntry) => {
          if (isAborted()) {
            return;
          }

          const { tenantId, ...rest } = logEntry;
          const flow =
            rest.direction === 'OUTBOUND' && rest.triggerType === 'SCHEDULED'
              ? 'SCHEDULED'
              : rest.direction || 'OUTBOUND';
          const chunk = (isFirst ? '' : ',') + JSON.stringify({ ...rest, flow });
          isFirst = false;

          const wrote = await writeWithBackpressure(req, res, chunk, isAborted);
          if (!wrote) {
            return;
          }
        },
        { shouldStop: isAborted }
      );

      if (!isAborted()) {
        await writeWithBackpressure(req, res, ']', isAborted);
        res.end();
      }
    } catch (error) {
      log('error', 'JSON export failed', { error: error.message });
      res.status(500).json({ error: 'Export failed', code: 'INTERNAL_ERROR' });
    }
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const logEntry = await data.getLogById(req.orgId, req.params.id);
    if (!logEntry) {
      return res.status(404).json({ error: 'Log not found', code: 'NOT_FOUND' });
    }

    // Include integration configuration details for enhanced UI
    let __KEEP_integrationConfig__ = null;
    if (logEntry.__KEEP___KEEP_integrationConfig__Id__) {
      try {
        __KEEP_integrationConfig__ = await data.getIntegrationById(logEntry.__KEEP___KEEP_integrationConfig__Id__);
        // Remove sensitive information from auth config
        if (__KEEP_integrationConfig__?.outgoingAuthConfig) {
          const sanitizedAuth = { ...__KEEP_integrationConfig__.outgoingAuthConfig };
          if (sanitizedAuth.value) {
            sanitizedAuth.value = `${sanitizedAuth.value.substring(0, 8)}...`;
          }
          __KEEP_integrationConfig__.outgoingAuthConfig = sanitizedAuth;
        }
      } catch (_err) {
        // Integration might be deleted, ignore error
      }
    }

    return res.json({
      ...logEntry,
      __KEEP_integrationConfig__,
    });
  })
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const payload = req.body;
    if (!payload.__KEEP___KEEP_integrationConfig__Id__) {
      return res
        .status(400)
        .json({ error: '__KEEP___KEEP_integrationConfig__Id__ is required', code: 'VALIDATION_ERROR' });
    }
    await data.recordLog(req.orgId, payload);
    log('info', 'Log recorded', {
      __KEEP___KEEP_integrationConfig__Id__: payload.__KEEP___KEEP_integrationConfig__Id__,
    });
    return res.status(201).json({ message: 'Logged' });
  })
);

module.exports = router;
