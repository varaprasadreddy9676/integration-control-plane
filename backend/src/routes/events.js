const express = require('express');
const data = require('../data');
const { log } = require('../logger');
const asyncHandler = require('../utils/async-handler');
const db = require('../db');
const fs = require('fs');
const path = require('path');
const eventSourceData = require('../data/event-sources');

const router = express.Router();

// GET /events/stats - Get event audit statistics
router.get(
  '/stats',
  asyncHandler(async (req, res) => {
    const hoursBack = parseInt(req.query.hoursBack, 10) || 24;

    const stats = await data.getEventAuditStats(req.orgId, hoursBack);

    return res.json(stats);
  })
);

// GET /events/checkpoints - Get source checkpoints for health monitoring
router.get(
  '/checkpoints',
  asyncHandler(async (req, res) => {
    const { source } = req.query;

    let checkpoints = await data.getSourceCheckpoints(req.orgId);

    // Filter by source if provided
    if (source) {
      checkpoints = checkpoints.filter((cp) => cp.source === source);
    }

    return res.json(checkpoints);
  })
);

// GET /events/gaps - Get gap detection results
router.get(
  '/gaps',
  asyncHandler(async (req, res) => {
    const { source } = req.query;
    const hoursBack = parseInt(req.query.hoursBack, 10) || 24;

    if (!source) {
      return res.status(400).json({
        error: 'source query parameter is required',
        code: 'VALIDATION_ERROR',
      });
    }

    const gaps = await data.getSourceGaps(req.orgId, source, hoursBack);

    return res.json(gaps);
  })
);

// GET /events/export - Export events to CSV
router.get(
  '/export',
  asyncHandler(async (req, res) => {
    try {
      const exportTimeoutMs = Math.max(parseInt(req.query.timeoutMs, 10) || 120000, 10000); // default 2 min, min 10s
      const exportTimeout = setTimeout(() => {
        if (!res.headersSent) {
          res.status(408).json({ error: 'Export timed out', code: 'EXPORT_TIMEOUT' });
        } else {
          res.end();
        }
      }, exportTimeoutMs);

      const filters = {
        status: req.query.status,
        eventType: req.query.eventType,
        source: req.query.source,
        skipCategory: req.query.skipCategory,
        startDate: req.query.startDate,
        endDate: req.query.endDate,
        limit: parseInt(req.query.limit, 10) || 1000,
        page: 1,
      };

      // CSV headers
      const headers = [
        'Event ID',
        'Received At',
        'Source',
        'Source ID',
        'Event Type',
        'Org ID',
        'Status',
        'Skip Category',
        'Skip Reason',
        'Integrations Matched',
        'Delivered Count',
        'Failed Count',
        'Processing Time (ms)',
        'Payload Hash',
        'Payload Size',
      ];

      // Set headers for file download
      const filename = `event-audit-${new Date().toISOString().split('T')[0]}.csv`;
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Transfer-Encoding', 'chunked');

      const writeRow = async (row) => {
        const line = `${row
          .map((cell) => {
            const str = String(cell ?? '');
            if (str.includes(',') || str.includes('\n') || str.includes('"')) {
              return `"${str.replace(/"/g, '""')}"`;
            }
            return str;
          })
          .join(',')}\n`;
        if (!res.write(line)) {
          await new Promise((resolve) => res.once('drain', resolve));
        }
      };

      // Write header
      await writeRow(headers);

      let page = 1;
      let totalPages = 1;

      do {
        const result = await data.listEventAudit(req.orgId, { ...filters, page });
        totalPages = result.pages || 1;

        for (const event of result.events) {
          await writeRow([
            event.eventId || '',
            event.receivedAt || '',
            event.source || '',
            event.sourceId || '',
            event.eventType || '',
            event.orgId || '',
            event.status || '',
            event.skipCategory || '',
            event.skipReason || '',
            event.deliveryStatus?.integrationsMatched || 0,
            event.deliveryStatus?.deliveredCount || 0,
            event.deliveryStatus?.failedCount || 0,
            event.processingTimeMs || 0,
            event.payloadHash || '',
            event.payloadSize || 0,
          ]);
        }

        page += 1;
      } while (page <= totalPages);

      clearTimeout(exportTimeout);
      res.end();

      log('info', 'Event audit exported to CSV', {
        orgId: req.orgId,
        pages: totalPages,
      });
    } catch (error) {
      if (error.code === 'ERR_STREAM_PREMATURE_CLOSE') {
        log('warn', 'CSV export aborted by client', { orgId: req.orgId });
        return;
      }
      log('error', 'CSV export failed', { error: error.message });
      res.status(500).json({ error: 'Export failed', code: 'INTERNAL_ERROR' });
    }
  })
);

// POST /events/test-notification-queue - Insert test events into notification_queue
router.post(
  '/test-notification-queue',
  asyncHandler(async (req, res) => {
    if (!db.isConfigured()) {
      return res.status(400).json({
        error: 'Database is not configured',
        code: 'DB_NOT_CONFIGURED',
      });
    }

    const {
      orgId: bodyEntityParentRid,
      orgUnitRid: bodyOrgUnitRid,
      phone,
      mrn,
      datetime,
      createdAt,
      limit,
      eventTypes,
      topic,
      status,
      randomizeDates,
      randomDaysBack,
      randomDaysForward,
    } = req.body || {};

    const resolvedOrgId = Number.isFinite(Number(bodyEntityParentRid)) ? Number(bodyEntityParentRid) : req.orgId;
    const resolvedOrgUnitRid = Number.isFinite(Number(bodyOrgUnitRid)) ? Number(bodyOrgUnitRid) : resolvedOrgId;

    if (!resolvedOrgUnitRid || !resolvedOrgId) {
      return res.status(400).json({
        error: 'orgUnitRid and orgId are required',
        code: 'VALIDATION_ERROR',
      });
    }

    const clevertapPath = path.join(__dirname, '..', '..', 'setup', 'clevertap-integrations.json');
    const eventTypesPath = path.join(__dirname, '..', '..', 'setup', 'event-types.json');
    const clevertap = JSON.parse(fs.readFileSync(clevertapPath, 'utf8'));
    const eventTypeConfig = JSON.parse(fs.readFileSync(eventTypesPath, 'utf8'));
    const sampleMap = new Map(eventTypeConfig.map((entry) => [entry.eventType, entry.samplePayload]));

    const eventTypeList = [...new Set(clevertap.map((entry) => entry.type || entry.eventType))].filter(Boolean);
    const filteredEventTypes =
      Array.isArray(eventTypes) && eventTypes.length > 0
        ? eventTypeList.filter((type) => eventTypes.includes(type))
        : eventTypeList;

    const maxLimit = Number.isFinite(Number(limit)) ? Number(limit) : 0;
    const selectedEventTypes = maxLimit > 0 ? filteredEventTypes.slice(0, maxLimit) : filteredEventTypes;

    const nowMysql = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
    const createdAtValue = createdAt || nowMysql();
    const statusValue = status || 'PENDING';
    const topicValue = topic || 'notification';
    const shouldRandomizeDates = Boolean(randomizeDates);
    const daysBack = Number.isFinite(Number(randomDaysBack)) ? Number(randomDaysBack) : 7;
    const daysForward = Number.isFinite(Number(randomDaysForward)) ? Number(randomDaysForward) : 7;

    const pad2 = (value) => String(value).padStart(2, '0');
    const formatDmy = (date) => `${pad2(date.getDate())}/${pad2(date.getMonth() + 1)}/${date.getFullYear()}`;
    const formatYmd = (date) => `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
    const formatHm12 = (date) => {
      let hours = date.getHours();
      const minutes = pad2(date.getMinutes());
      const suffix = hours >= 12 ? 'PM' : 'AM';
      hours = hours % 12;
      hours = hours === 0 ? 12 : hours;
      return `${pad2(hours)}:${minutes} ${suffix}`;
    };
    const _formatHms24 = (date) => `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;

    const randomDateInRange = () => {
      const now = new Date();
      const start = new Date(now);
      start.setDate(start.getDate() - Math.max(0, daysBack));
      const end = new Date(now);
      end.setDate(end.getDate() + Math.max(0, daysForward));
      const range = Math.max(0, end.getTime() - start.getTime());
      const ts = start.getTime() + Math.random() * range;
      return new Date(ts);
    };

    const randomizeDateString = (value) => {
      if (typeof value !== 'string') return value;
      const trimmed = value.trim();
      if (!trimmed) return value;

      const timeOnly = /^\d{1,2}:\d{2}\s*(AM|PM)$/i;
      const dmyDate = /^\d{2}\/\d{2}\/\d{4}$/;
      const dmyDateTime = /^\d{2}\/\d{2}\/\d{4}\s+\d{1,2}:\d{2}\s*(AM|PM)$/i;
      const ymdDate = /^\d{4}-\d{2}-\d{2}$/;
      const ymdDateTime = /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}$/;
      const ymdDateTimeNoSpace = /^\d{4}-\d{2}-\d{2}\d{2}:\d{2}:\d{2}$/;

      if (timeOnly.test(trimmed)) {
        return formatHm12(randomDateInRange());
      }
      if (dmyDateTime.test(trimmed)) {
        const timePart = trimmed.split(' ').slice(1).join(' ');
        return `${formatDmy(randomDateInRange())} ${timePart}`;
      }
      if (dmyDate.test(trimmed)) {
        return formatDmy(randomDateInRange());
      }
      if (ymdDateTime.test(trimmed)) {
        const timePart = trimmed.split(' ')[1];
        return `${formatYmd(randomDateInRange())} ${timePart}`;
      }
      if (ymdDateTimeNoSpace.test(trimmed)) {
        const timePart = trimmed.slice(10);
        return `${formatYmd(randomDateInRange())}${timePart}`;
      }
      if (ymdDate.test(trimmed)) {
        return formatYmd(randomDateInRange());
      }

      return value;
    };

    const randomizePayloadDates = (input) => {
      if (!shouldRandomizeDates) return input;
      if (Array.isArray(input)) {
        return input.map((item) => randomizePayloadDates(item));
      }
      if (input && typeof input === 'object') {
        const next = {};
        Object.entries(input).forEach(([key, value]) => {
          next[key] = randomizePayloadDates(value);
        });
        return next;
      }
      return randomizeDateString(input);
    };

    const applyOverrides = (payload) => {
      const next = payload || {};
      if (!next.type) next.type = next.eventType || next.transaction_type;
      if (!next.datetime) next.datetime = datetime || nowMysql();
      if (datetime) next.datetime = datetime;

      next.entityRID = resolvedOrgUnitRid;
      next.entityParentID = resolvedOrgId;
      next.enterpriseEntityRID = resolvedOrgId;

      next.patient = next.patient || {};
      next.patient.mrn = next.patient.mrn || {};

      if (phone) {
        next.patient.phone = phone;
        next.patientPhone = phone;
        next.phone = phone;
      }
      if (mrn) {
        next.patient.mrn.documentNumber = mrn;
        next.patientMRN = mrn;
      }

      const randomized = randomizePayloadDates(next);
      if (datetime) randomized.datetime = datetime;
      return randomized;
    };

    const rows = selectedEventTypes.map((eventType) => {
      const basePayload = sampleMap.get(eventType)
        ? JSON.parse(JSON.stringify(sampleMap.get(eventType)))
        : { type: eventType };
      const payload = applyOverrides(basePayload);
      return {
        topic: topicValue || 'notification',
        transactionType: eventType || 'UNKNOWN',
        message: JSON.stringify(payload),
        orgUnitRid: resolvedOrgUnitRid || null,
        orgId: resolvedOrgId || null,
        status: statusValue || 'PENDING',
        createdAt: createdAtValue || nowMysql(),
        deliveredAt: null,
        lastCheckedAt: null,
        retryCount: 0,
        errorMessage: null,
      };
    });

    const sql = `INSERT INTO notification_queue (topic, transaction_type, message, entity_rid, entity_parent_rid, \`STATUS\`, created_at, delivered_at, last_checked_at, retry_count, error_message)
    VALUES (:topic, :transactionType, :message, :orgUnitRid, :orgId, :status, :createdAt, :deliveredAt, :lastCheckedAt, :retryCount, :errorMessage)`;

    let inserted = 0;
    for (const row of rows) {
      // Validate that no parameters are undefined
      const hasUndefined = Object.entries(row).find(([_key, value]) => value === undefined);
      if (hasUndefined) {
        log('error', 'Row contains undefined value', {
          field: hasUndefined[0],
          row: JSON.stringify(row, null, 2),
        });
        throw new Error(`Field '${hasUndefined[0]}' is undefined. Must use null for SQL NULL.`);
      }

      await db.query(sql, row);
      inserted += 1;
    }

    log('info', 'Inserted test events into notification_queue', {
      orgId: resolvedOrgId,
      orgUnitRid: resolvedOrgUnitRid,
      inserted,
    });

    return res.json({
      inserted,
      eventTypes: selectedEventTypes,
    });
  })
);

// GET /events/:eventId - Get event detail by eventId
router.get(
  '/:eventId',
  asyncHandler(async (req, res) => {
    const event = await data.getEventAuditById(req.orgId, req.params.eventId);

    if (!event) {
      return res.status(404).json({
        error: 'Event not found',
        code: 'NOT_FOUND',
      });
    }

    return res.json(event);
  })
);

// GET /events - List events with filters
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const filters = {
      status: req.query.status,
      eventType: req.query.eventType,
      source: req.query.source,
      skipCategory: req.query.skipCategory,
      search: req.query.search,
      startDate: req.query.startDate ? new Date(req.query.startDate) : undefined,
      endDate: req.query.endDate ? new Date(req.query.endDate) : undefined,
      limit: parseInt(req.query.limit, 10) || 50,
      page: parseInt(req.query.page, 10) || 1,
    };

    const result = await data.listEventAudit(req.orgId, filters);

    return res.json(result); // Returns { events, total, pages, page }
  })
);

// ============================================================================
// Bulk Event Import Endpoints
// ============================================================================

const multer = require('multer');
const { uuidv4 } = require('../utils/runtime');
const { parseImportFile, generateImportTemplate } = require('../services/event-import');
const { validateEvent, validateEventCount } = require('../services/event-validator');

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
  },
  fileFilter: (_req, file, cb) => {
    const allowedTypes = [
      'application/json',
      'text/csv',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JSON, CSV, and Excel files are allowed'));
    }
  },
});

/**
 * Process bulk import of events
 * @param {Array} events - Array of event objects to import
 * @param {Number} orgId - Organization ID from auth
 * @param {Object} options - Processing options
 * @returns {Object} Import results with summary and details
 */
async function processImport(events, orgId, options = {}) {
  const { dryRun = false, continueOnError = true } = options;

  const results = {
    successful: [],
    failed: [],
    duplicates: [],
  };

  const summary = {
    total: events.length,
    successful: 0,
    failed: 0,
    duplicates: 0,
  };

  for (let i = 0; i < events.length; i++) {
    const eventData = events[i];

    try {
      // Validate event
      const validation = validateEvent(eventData, i);
      if (!validation.valid) {
        const errorMsg = validation.errors
          .map((e) => {
            if (typeof e === 'string') return e;
            return e.message || JSON.stringify(e);
          })
          .join('; ');

        results.failed.push({
          index: i,
          eventType: eventData.eventType,
          error: errorMsg,
          code: 'VALIDATION_ERROR',
        });
        summary.failed++;

        if (!continueOnError) break;
        continue;
      }

      // Skip if dry run (validation only)
      if (dryRun) {
        results.successful.push({
          index: i,
          eventType: eventData.eventType,
          status: 'VALIDATED',
        });
        summary.successful++;
        continue;
      }

      // Generate event audit record
      const eventId = `BULK_IMPORT-${uuidv4()}`;

      // Generate eventKey for deduplication
      const payloadId =
        eventData.payload.id ||
        eventData.payload.patientRid ||
        eventData.payload.appointmentId ||
        eventData.payload.billId ||
        eventData.payload.mrn ||
        JSON.stringify(eventData.payload).substring(0, 100);
      const eventKey = `${eventData.eventType}-${payloadId}-${eventData.orgId}`;

      const auditRecord = {
        eventId,
        source: eventData.source || 'BULK_IMPORT',
        sourceId: eventData.sourceId || `bulk-${Date.now()}-${i}`,
        orgId: eventData.orgId || orgId,
        eventType: eventData.eventType,
        eventKey,
        status: 'RECEIVED',
        receivedAt: new Date(),
        receivedAtBucket: data.getBucketTimestamp(new Date()),
        payloadHash: data.hashPayload(eventData.payload),
        payloadSize: JSON.stringify(eventData.payload).length,
        payloadSummary: data.extractSafePayload(eventData.payload),
        payload: eventData.payload,
        sourceMetadata: {
          importedVia: 'BULK_IMPORT',
          batchIndex: i,
          importedAt: new Date(),
        },
        timeline: [
          {
            ts: new Date(),
            stage: 'RECEIVED',
            details: 'Event imported via bulk import',
          },
        ],
      };

      // Insert into MongoDB (handles duplicates gracefully)
      try {
        await data.recordEventAudit(auditRecord);

        results.successful.push({
          index: i,
          eventId,
          eventType: eventData.eventType,
          status: 'RECEIVED',
        });
        summary.successful++;
      } catch (error) {
        if (error.code === 11000) {
          // Duplicate key error from MongoDB unique index
          results.duplicates.push({
            index: i,
            eventType: eventData.eventType,
            error: 'Duplicate event',
            code: 'DUPLICATE_EVENT',
          });
          summary.duplicates++;
        } else {
          throw error;
        }
      }
    } catch (error) {
      results.failed.push({
        index: i,
        eventType: eventData.eventType,
        error: error.message,
        code: error.code || 'INSERT_ERROR',
      });
      summary.failed++;

      if (!continueOnError) break;
    }
  }

  return {
    success: summary.failed === 0,
    summary,
    results,
  };
}

// POST /events/import - Bulk import events from file or JSON
router.post(
  '/import',
  upload.single('file'),
  asyncHandler(async (req, res) => {
    const { dryRun = 'false', continueOnError = 'true' } = req.query;
    const orgId = req.orgId;

    try {
      let events = [];
      let parseErrors = [];

      // Parse input (file or JSON body)
      if (req.file) {
        const parsed = await parseImportFile(req.file);
        events = parsed.events;
        parseErrors = parsed.errors;
      } else if (req.body && (req.body.events || Array.isArray(req.body))) {
        events = req.body.events || req.body;
      } else {
        return res.status(400).json({
          success: false,
          error: 'No events provided. Send file or JSON body with events array',
          code: 'NO_INPUT',
        });
      }

      // Validate event count
      try {
        validateEventCount(events, 1000);
      } catch (error) {
        return res.status(400).json({
          success: false,
          error: error.message,
          code: 'INVALID_COUNT',
          parseErrors,
        });
      }

      // Process import
      const result = await processImport(events, orgId, {
        dryRun: dryRun === 'true',
        continueOnError: continueOnError === 'true',
      });

      // Add parse errors to response if any
      if (parseErrors.length > 0) {
        result.parseErrors = parseErrors;
      }

      const statusCode = result.success ? 200 : 207; // 207 Multi-Status for partial success

      res.status(statusCode).json({
        success: result.success,
        summary: result.summary,
        results: result.results,
        ...(parseErrors.length > 0 && { parseErrors }),
      });

      log('info', 'Bulk event import completed', {
        orgId,
        summary: result.summary,
        dryRun: dryRun === 'true',
      });
    } catch (error) {
      log('error', 'Bulk import failed', {
        orgId,
        error: error.message,
      });

      res.status(500).json({
        success: false,
        error: 'Import failed',
        code: 'IMPORT_ERROR',
        details: error.message,
      });
    }
  })
);

// GET /events/import/template - Download import template
router.get(
  '/import/template',
  asyncHandler(async (req, res) => {
    const format = req.query.format || 'xlsx'; // xlsx, csv, or json

    try {
      const buffer = generateImportTemplate(format);

      const contentTypes = {
        csv: 'text/csv',
        json: 'application/json',
        xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      };

      const contentType = contentTypes[format] || contentTypes.xlsx;
      const filename = `event-import-template.${format}`;

      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(buffer);

      log('info', 'Import template downloaded', {
        orgId: req.orgId,
        format,
      });
    } catch (error) {
      log('error', 'Template generation failed', {
        error: error.message,
      });

      res.status(500).json({
        error: 'Failed to generate template',
        code: 'TEMPLATE_ERROR',
      });
    }
  })
);

// ---------------------------------------------------------------------------
// POST /events/push
// Push a single event into the gateway from any external system.
// Events are queued in pending_events and processed by HttpPushAdapter.
//
// Body: { eventType: string, payload: object }
// The orgId is resolved from the authenticated JWT / API-key context.
// ---------------------------------------------------------------------------
router.post(
  '/push',
  asyncHandler(async (req, res) => {
    const orgId = req.orgId;

    if (!orgId) {
      return res.status(400).json({ error: 'orgId is required', code: 'ORG_ID_REQUIRED' });
    }

    const { eventType, payload } = req.body || {};

    if (!eventType || typeof eventType !== 'string' || !eventType.trim()) {
      return res.status(400).json({ error: 'eventType is required', code: 'VALIDATION_ERROR' });
    }

    if (payload !== undefined && typeof payload !== 'object') {
      return res.status(400).json({ error: 'payload must be an object', code: 'VALIDATION_ERROR' });
    }

    const eventId = `push-${orgId}-${eventType}-${uuidv4()}`;

    await eventSourceData.enqueuePushEvent({
      orgId,
      eventId,
      eventType: eventType.trim(),
      payload: payload || {},
      source: 'http_push',
    });

    log('info', 'Event pushed', { orgId, eventId, eventType });

    return res.status(202).json({ eventId, status: 'accepted' });
  })
);

module.exports = router;
