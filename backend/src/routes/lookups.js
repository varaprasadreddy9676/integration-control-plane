const express = require('express');
const multer = require('multer');
const router = express.Router();
const {
  listLookups,
  getLookup,
  addLookup,
  updateLookup,
  deleteLookup,
  bulkCreateLookups,
  bulkDeleteLookups,
  resolveLookup,
  reverseLookup,
  getLookupStats,
  getLookupTypes,
} = require('../data');
const { validateLookupEntry, validateBulkImport } = require('../services/lookup-validator');
const { testLookups } = require('../services/lookup-service');
const {
  parseImportFile,
  generateExportFile,
  generateSimpleCSV,
  generateImportTemplate,
} = require('../services/lookup-import-export');
const { log } = require('../logger');
const asyncHandler = require('../utils/async-handler');
const { auditLookup } = require('../middleware/audit');

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (_req, file, cb) => {
    // Accept Excel and CSV files
    const allowedMimes = [
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/csv',
    ];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only Excel (.xlsx, .xls) and CSV files are allowed.'));
    }
  },
});

/**
 * @route GET /api/v1/lookups
 * @desc List lookups with filters
 * @query orgId (required), type, orgUnitRid (optional), category, isActive, search, limit
 */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { orgId } = req.query;

    if (!orgId) {
      return res.status(400).json({
        success: false,
        error: 'orgId query parameter is required',
      });
    }
    if (Object.hasOwn(req.query, 'tenantId')) {
      return res.status(400).json({
        success: false,
        error: 'tenantId query parameter is not supported. Use orgUnitRid or orgId.',
        code: 'TENANT_ID_NOT_ALLOWED',
      });
    }

    const filters = {
      type: req.query.type,
      orgUnitRid: req.query.orgUnitRid !== undefined ? parseInt(req.query.orgUnitRid, 10) : undefined,
      category: req.query.category,
      isActive: req.query.isActive !== undefined ? req.query.isActive === 'true' : undefined,
      search: req.query.search,
      limit: req.query.limit ? parseInt(req.query.limit, 10) : 1000,
    };

    const lookups = await listLookups(parseInt(orgId, 10), filters);

    res.json({
      success: true,
      data: lookups,
      count: lookups.length,
    });
  })
);

/**
 * @route GET /api/v1/lookups/stats
 * @desc Get lookup statistics
 * @query orgId (required), type (optional)
 */
router.get(
  '/stats',
  asyncHandler(async (req, res) => {
    const { orgId, type } = req.query;

    if (!orgId) {
      return res.status(400).json({
        success: false,
        error: 'orgId query parameter is required',
      });
    }

    const filters = { type };
    const stats = await getLookupStats(parseInt(orgId, 10), filters);

    res.json({
      success: true,
      data: stats,
    });
  })
);

/**
 * @route GET /api/v1/lookups/types
 * @desc Get available lookup types for an entity
 * @query orgId (required)
 */
router.get(
  '/types',
  asyncHandler(async (req, res) => {
    const { orgId } = req.query;

    if (!orgId) {
      return res.status(400).json({
        success: false,
        error: 'orgId query parameter is required',
      });
    }

    const types = await getLookupTypes(parseInt(orgId, 10));

    res.json({
      success: true,
      data: types,
    });
  })
);

/**
 * @route GET /api/v1/lookups/export
 * @desc Export lookups to Excel/CSV file
 * @query orgId (required), type (optional), format (optional: "xlsx" or "csv")
 */
router.get(
  '/export',
  asyncHandler(async (req, res) => {
    const { orgId, type, format = 'xlsx' } = req.query;

    if (!orgId) {
      return res.status(400).json({
        success: false,
        error: 'orgId query parameter is required',
      });
    }

    const filters = {
      type,
      isActive: true, // Only export active lookups
    };

    const lookups = await listLookups(parseInt(orgId, 10), filters);

    if (lookups.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'No lookups found to export',
      });
    }

    let buffer;
    let contentType;
    let filename;

    if (format === 'csv') {
      buffer = generateSimpleCSV(lookups);
      contentType = 'text/csv';
      filename = `lookups_${type || 'all'}_${Date.now()}.csv`;
    } else {
      buffer = generateExportFile(lookups, 'xlsx');
      contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      filename = `lookups_${type || 'all'}_${Date.now()}.xlsx`;
    }

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  })
);

/**
 * @route GET /api/v1/lookups/import/template
 * @desc Download import template (empty Excel file with headers)
 */
router.get(
  '/import/template',
  asyncHandler(async (_req, res) => {
    const buffer = generateImportTemplate();

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="lookups_import_template.xlsx"');
    res.send(buffer);
  })
);

/**
 * @route GET /api/v1/lookups/:id
 * @desc Get single lookup by ID
 * @query orgId (required)
 */
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const { orgId } = req.query;
    const { id } = req.params;

    if (!orgId) {
      return res.status(400).json({
        success: false,
        error: 'orgId query parameter is required',
      });
    }

    const lookup = await getLookup(id);

    if (!lookup || lookup.orgId !== parseInt(orgId, 10)) {
      return res.status(404).json({
        success: false,
        error: 'Lookup not found',
      });
    }

    res.json({
      success: true,
      data: lookup,
    });
  })
);

/**
 * @route POST /api/v1/lookups
 * @desc Create new lookup
 * @query orgId (required)
 * @body type, source, target, description, category, orgUnitRid, isActive
 */
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const { orgId } = req.query;

    if (!orgId) {
      return res.status(400).json({
        success: false,
        error: 'orgId query parameter is required',
      });
    }

    const payload = {
      ...req.body,
      orgId: parseInt(orgId, 10),
    };

    // Validate
    try {
      validateLookupEntry(payload);
    } catch (err) {
      return res.status(400).json({
        success: false,
        error: err.message,
      });
    }

    try {
      const lookup = await addLookup(parseInt(orgId, 10), payload);

      await auditLookup.created(req, lookup);

      res.status(201).json({
        success: true,
        data: lookup,
      });
    } catch (err) {
      if (err.message.includes('Duplicate lookup')) {
        return res.status(409).json({
          success: false,
          error: err.message,
        });
      }
      throw err;
    }
  })
);

/**
 * @route PUT /api/v1/lookups/:id
 * @desc Update existing lookup
 * @query orgId (required)
 * @body type, source, target, description, category, isActive
 */
router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const { orgId } = req.query;
    const { id } = req.params;

    if (!orgId) {
      return res.status(400).json({
        success: false,
        error: 'orgId query parameter is required',
      });
    }

    try {
      const beforeLookup = await getLookup(id).catch(() => null);

      const updated = await updateLookup(parseInt(orgId, 10), id, req.body);

      if (!updated) {
        return res.status(404).json({
          success: false,
          error: 'Lookup not found',
        });
      }

      await auditLookup.updated(req, id, { before: beforeLookup, after: updated });

      res.json({
        success: true,
        data: updated,
      });
    } catch (err) {
      if (err.message.includes('Duplicate lookup')) {
        return res.status(409).json({
          success: false,
          error: err.message,
        });
      }
      throw err;
    }
  })
);

/**
 * @route DELETE /api/v1/lookups/:id
 * @desc Delete lookup
 * @query orgId (required)
 */
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const { orgId } = req.query;
    const { id } = req.params;

    if (!orgId) {
      return res.status(400).json({
        success: false,
        error: 'orgId query parameter is required',
      });
    }

    const beforeLookup = await getLookup(id).catch(() => null);

    const deleted = await deleteLookup(parseInt(orgId, 10), id);

    if (!deleted) {
      return res.status(404).json({
        success: false,
        error: 'Lookup not found',
      });
    }

    await auditLookup.deleted(req, id, beforeLookup);

    res.json({
      success: true,
      message: 'Lookup deleted successfully',
    });
  })
);

/**
 * @route POST /api/v1/lookups/bulk
 * @desc Bulk create or update lookups (for import)
 * @query orgId (required), mode (optional: "replace"), type, orgUnitRid
 * @body Array of lookup objects
 */
router.post(
  '/bulk',
  asyncHandler(async (req, res) => {
    const { orgId, mode, type } = req.query;
    const orgUnitRid = req.query.orgUnitRid;

    if (!orgId) {
      return res.status(400).json({
        success: false,
        error: 'orgId query parameter is required',
      });
    }

    if (!type) {
      return res.status(400).json({
        success: false,
        error: 'type query parameter is required for bulk operations',
      });
    }

    const lookups = req.body;

    // Validate
    try {
      validateBulkImport(lookups);
    } catch (err) {
      return res.status(400).json({
        success: false,
        error: err.message,
      });
    }

    const options = {
      mode,
      type,
      orgUnitRid: orgUnitRid !== undefined ? parseInt(orgUnitRid, 10) : undefined,
    };

    const result = await bulkCreateLookups(parseInt(orgId, 10), lookups, options);

    await auditLookup.bulkImported(req, type, result.inserted || result.count || result.created || lookups.length);

    res.json({
      success: true,
      data: result,
    });
  })
);

/**
 * @route DELETE /api/v1/lookups/bulk
 * @desc Bulk delete lookups
 * @query orgId (required)
 * @body { ids: ["id1", "id2", ...] }
 */
router.delete(
  '/bulk',
  asyncHandler(async (req, res) => {
    const { orgId } = req.query;
    const { ids } = req.body;

    if (!orgId) {
      return res.status(400).json({
        success: false,
        error: 'orgId query parameter is required',
      });
    }

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'ids array is required',
      });
    }

    const result = await bulkDeleteLookups(parseInt(orgId, 10), ids);

    await auditLookup.bulkDeleted(req, null, result.deletedCount || ids.length);

    res.json({
      success: true,
      data: result,
    });
  })
);

/**
 * @route POST /api/v1/lookups/resolve
 * @desc Resolve single code (forward lookup)
 * @query orgId (required), orgUnitRid (optional)
 * @body { type, sourceId }
 */
router.post(
  '/resolve',
  asyncHandler(async (req, res) => {
    const { orgId } = req.query;
    const orgUnitRid = req.query.orgUnitRid;
    const { type, sourceId } = req.body;

    if (!orgId) {
      return res.status(400).json({
        success: false,
        error: 'orgId query parameter is required',
      });
    }

    if (!type || !sourceId) {
      return res.status(400).json({
        success: false,
        error: 'type and sourceId are required in request body',
      });
    }

    const targetId = await resolveLookup(
      sourceId,
      type,
      parseInt(orgId, 10),
      orgUnitRid ? parseInt(orgUnitRid, 10) : null
    );

    if (targetId === null) {
      return res.status(404).json({
        success: false,
        error: 'No mapping found',
      });
    }

    res.json({
      success: true,
      data: {
        sourceId,
        targetId,
        type,
      },
    });
  })
);

/**
 * @route POST /api/v1/lookups/resolve-bulk
 * @desc Resolve multiple codes
 * @query orgId (required), orgUnitRid (optional)
 * @body { type, sourceIds: ["id1", "id2", ...] }
 */
router.post(
  '/resolve-bulk',
  asyncHandler(async (req, res) => {
    const { orgId } = req.query;
    const orgUnitRid = req.query.orgUnitRid;
    const { type, sourceIds } = req.body;

    if (!orgId) {
      return res.status(400).json({
        success: false,
        error: 'orgId query parameter is required',
      });
    }

    if (!type || !Array.isArray(sourceIds)) {
      return res.status(400).json({
        success: false,
        error: 'type and sourceIds array are required in request body',
      });
    }

    const results = [];
    const parentRid = parseInt(orgId, 10);
    const scopedOrgUnitRid = orgUnitRid ? parseInt(orgUnitRid, 10) : null;

    for (const sourceId of sourceIds) {
      const targetId = await resolveLookup(sourceId, type, parentRid, scopedOrgUnitRid);
      results.push({
        sourceId,
        targetId,
        found: targetId !== null,
      });
    }

    res.json({
      success: true,
      data: results,
    });
  })
);

/**
 * @route POST /api/v1/lookups/reverse
 * @desc Reverse lookup (target -> source)
 * @query orgId (required), orgUnitRid (optional)
 * @body { type, targetId }
 */
router.post(
  '/reverse',
  asyncHandler(async (req, res) => {
    const { orgId } = req.query;
    const orgUnitRid = req.query.orgUnitRid;
    const { type, targetId } = req.body;

    if (!orgId) {
      return res.status(400).json({
        success: false,
        error: 'orgId query parameter is required',
      });
    }

    if (!type || !targetId) {
      return res.status(400).json({
        success: false,
        error: 'type and targetId are required in request body',
      });
    }

    const result = await reverseLookup(
      targetId,
      type,
      parseInt(orgId, 10),
      orgUnitRid ? parseInt(orgUnitRid, 10) : null
    );

    if (!result) {
      return res.status(404).json({
        success: false,
        error: 'No mapping found',
      });
    }

    res.json({
      success: true,
      data: {
        targetId,
        sourceId: result.sourceId,
        scope: result.scope,
        type,
      },
    });
  })
);

/**
 * @route POST /api/v1/lookups/test
 * @desc Test lookup configurations against sample payload
 * @query orgId (required), orgUnitRid (optional), type (required)
 * @body { lookupConfigs: [...], samplePayload: {...} }
 */
router.post(
  '/test',
  asyncHandler(async (req, res) => {
    const { orgId, type } = req.query;
    const orgUnitRid = req.query.orgUnitRid;
    const { lookupConfigs, samplePayload } = req.body;

    if (!orgId || !type) {
      return res.status(400).json({
        success: false,
        error: 'orgId and type query parameters are required',
      });
    }

    if (!lookupConfigs || !samplePayload) {
      return res.status(400).json({
        success: false,
        error: 'lookupConfigs and samplePayload are required in request body',
      });
    }

    const result = await testLookups(
      samplePayload,
      lookupConfigs,
      parseInt(orgId, 10),
      orgUnitRid ? parseInt(orgUnitRid, 10) : null
    );

    res.json({
      success: true,
      data: result,
    });
  })
);

/**
 * @route POST /api/v1/lookups/import
 * @desc Import lookups from Excel/CSV file
 * @query orgId (required), type (required), orgUnitRid (optional), mode (optional: "replace")
 * @body multipart/form-data with 'file' field
 */
router.post(
  '/import',
  upload.single('file'),
  asyncHandler(async (req, res) => {
    const { orgId, type, mode } = req.query;
    const orgUnitRid = req.query.orgUnitRid;

    if (!orgId || !type) {
      return res.status(400).json({
        success: false,
        error: 'orgId and type query parameters are required',
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No file uploaded',
      });
    }

    try {
      // Parse the uploaded file
      const parseResult = parseImportFile(
        req.file.buffer,
        type,
        parseInt(orgId, 10),
        orgUnitRid ? parseInt(orgUnitRid, 10) : null,
        req.file.originalname
      );

      if (parseResult.lookups.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'No valid lookups found in file',
          errors: parseResult.errors,
        });
      }

      // Validate
      try {
        validateBulkImport(parseResult.lookups);
      } catch (err) {
        return res.status(400).json({
          success: false,
          error: err.message,
          parseErrors: parseResult.errors,
        });
      }

      // Import
      const options = {
        mode,
        type,
        orgUnitRid: orgUnitRid ? parseInt(orgUnitRid, 10) : undefined,
      };

      const importResult = await bulkCreateLookups(parseInt(orgId, 10), parseResult.lookups, options);

      await auditLookup.bulkImported(
        req,
        type,
        importResult.inserted || importResult.count || importResult.created || parseResult.lookups.length
      );

      res.json({
        success: true,
        data: {
          ...importResult,
          totalRows: parseResult.totalRows,
          parseErrors: parseResult.errors,
        },
      });
    } catch (err) {
      log('error', 'Import failed', { error: err.message });
      res.status(400).json({
        success: false,
        error: err.message,
      });
    }
  })
);

module.exports = router;
