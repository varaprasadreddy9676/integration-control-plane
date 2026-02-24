/**
 * Event Source Config Routes
 *
 * Admin API to manage per-org event source configurations.
 * Requires SUPER_ADMIN or ADMIN role.
 *
 * POST   /event-sources/test           — test a config without saving (validates connection + mapping)
 * GET    /event-sources/:orgId/columns — discover table columns for a saved org config
 * GET    /event-sources               — list all configs
 * GET    /event-sources/:orgId        — get config for org
 * PUT    /event-sources/:orgId        — upsert config for org
 * DELETE /event-sources/:orgId        — deactivate config for org
 *
 * IMPORTANT: /test and /:orgId/columns are declared BEFORE /:orgId so Express
 * does not match the literal string "test" as an orgId param.
 */

const express = require('express');
const asyncHandler = require('../utils/async-handler');
const eventSourceData = require('../data/event-sources');
const { requirePermission } = require('../middleware/permission');
const { getDeliveryWorkerManager } = require('../processor/delivery-worker-manager');
const { testConnection, describeTable } = require('../services/event-source-tester');
const { auditEventSource } = require('../middleware/audit');
const { log } = require('../logger');
const { sanitizeMysqlSourceConfig } = require('../utils/mysql-safety');

const router = express.Router();

const ALLOWED_TYPES = ['mysql', 'kafka', 'http_push'];
const REQUIRED_MYSQL_MAPPING_FIELDS = Object.freeze([
  { key: 'id', label: 'Row ID' },
  { key: 'orgId', label: 'Org ID' },
  { key: 'eventType', label: 'Event Type' },
  { key: 'payload', label: 'Payload' },
]);

// ---------------------------------------------------------------------------
// Org-scoping helper
// ORG_ADMIN can only manage their own org. SUPER_ADMIN / ADMIN can manage any.
// ---------------------------------------------------------------------------
function assertOrgAccess(req, res, targetOrgId) {
  const { role, orgId: userOrgId } = req.user;
  if (role === 'SUPER_ADMIN' || role === 'ADMIN') return true; // global access
  if (userOrgId && Number(userOrgId) === targetOrgId) return true; // own org
  res.status(403).json({
    error: 'You can only manage event source config for your own organization',
    code: 'FORBIDDEN',
  });
  return false;
}

// ---------------------------------------------------------------------------
// POST /event-sources/test
// Test a connection + mapping before saving the config.
// Body: { type: 'mysql'|'kafka'|'http_push', config: { ... } }
// Returns: { success, message, tableColumns, validatedMapping, sampleEvent }
//       or { success: false, code, error, hint }
// Never saves anything; always cleans up the connection.
// ---------------------------------------------------------------------------
router.post(
  '/test',
  requirePermission('event_source:manage'),
  asyncHandler(async (req, res) => {
    const { type, config: sourceConfig } = req.body || {};

    if (!type || !ALLOWED_TYPES.includes(type)) {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION_ERROR',
        error: `type must be one of: ${ALLOWED_TYPES.join(', ')}`,
      });
    }

    if (!sourceConfig || typeof sourceConfig !== 'object') {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION_ERROR',
        error: 'config must be a non-null object',
      });
    }

    const effectiveConfig = type === 'mysql' ? sanitizeMysqlSourceConfig(sourceConfig) : sourceConfig;

    const result = await testConnection(type, effectiveConfig);

    // Audit the test attempt (pass/fail) asynchronously so it never blocks the response
    auditEventSource.tested(req, type, result.success, result.code).catch(() => {});

    // Test failures are always 200 with success:false — never 5xx.
    // This lets the UI display the specific error message without exception handling.
    return res.json(result);
  })
);

// ---------------------------------------------------------------------------
// GET /event-sources/:orgId/columns
// Discover the columns of the table configured for a specific org.
// Loads the org's saved config from event_source_configs and runs DESCRIBE.
// Returns: { success, table, columns: [{name, type, nullable, key, default}] }
// ---------------------------------------------------------------------------
router.get(
  '/:orgId/columns',
  requirePermission('event_source:view'),
  asyncHandler(async (req, res) => {
    const orgId = parseInt(req.params.orgId, 10);
    if (!Number.isFinite(orgId)) {
      return res.status(400).json({ success: false, code: 'VALIDATION_ERROR', error: 'Invalid orgId' });
    }

    if (!assertOrgAccess(req, res, orgId)) return;

    const savedConfig = await eventSourceData.getConfigForOrg(orgId);
    if (!savedConfig) {
      return res.status(404).json({
        success: false,
        code: 'NOT_FOUND',
        error: `No event source config found for org ${orgId}`,
        hint: 'Save a config first via PUT /event-sources/:orgId, or use POST /event-sources/test to explore a config without saving',
      });
    }

    if (savedConfig.type !== 'mysql') {
      return res.status(400).json({
        success: false,
        code: 'UNSUPPORTED_TYPE',
        error: `Column discovery is only supported for mysql sources (org has type: ${savedConfig.type})`,
        hint: 'Kafka and HTTP Push do not have discoverable columns',
      });
    }

    const result = await describeTable(savedConfig.config || {});
    return res.json(result);
  })
);

// GET /event-sources
// ORG_ADMIN only sees their own org's config; ADMIN/SUPER_ADMIN see all.
router.get(
  '/',
  requirePermission('event_source:view'),
  asyncHandler(async (req, res) => {
    const { role, orgId: userOrgId } = req.user;
    if (role === 'SUPER_ADMIN' || role === 'ADMIN') {
      return res.json(await eventSourceData.listActiveConfigs());
    }
    // ORG_ADMIN — return only their own org's config (as an array for consistency)
    const config = userOrgId ? await eventSourceData.getConfigForOrg(Number(userOrgId)) : null;
    return res.json(config ? [config] : []);
  })
);

// GET /event-sources/:orgId
router.get(
  '/:orgId',
  requirePermission('event_source:view'),
  asyncHandler(async (req, res) => {
    const orgId = parseInt(req.params.orgId, 10);
    if (!Number.isFinite(orgId)) {
      return res.status(400).json({ error: 'Invalid orgId', code: 'VALIDATION_ERROR' });
    }

    if (!assertOrgAccess(req, res, orgId)) return;

    const config = await eventSourceData.getConfigForOrg(orgId);
    if (!config) {
      return res.status(404).json({ error: 'No config found for this org', code: 'NOT_FOUND' });
    }

    return res.json(config);
  })
);

// PUT /event-sources/:orgId
router.put(
  '/:orgId',
  requirePermission('event_source:manage'),
  asyncHandler(async (req, res) => {
    const orgId = parseInt(req.params.orgId, 10);
    if (!Number.isFinite(orgId)) {
      return res.status(400).json({ error: 'Invalid orgId', code: 'VALIDATION_ERROR' });
    }

    if (!assertOrgAccess(req, res, orgId)) return;

    const { type, config: sourceConfig } = req.body || {};

    if (!type || !ALLOWED_TYPES.includes(type)) {
      return res.status(400).json({
        error: `type must be one of: ${ALLOWED_TYPES.join(', ')}`,
        code: 'VALIDATION_ERROR',
      });
    }

    if (sourceConfig !== undefined && (sourceConfig === null || typeof sourceConfig !== 'object' || Array.isArray(sourceConfig))) {
      return res.status(400).json({
        error: 'config must be a non-null object',
        code: 'VALIDATION_ERROR',
      });
    }

    // Snapshot before-state for the audit diff
    const before = await eventSourceData.getConfigForOrg(orgId).catch(() => null);

    const effectiveConfig = type === 'mysql' ? sanitizeMysqlSourceConfig(sourceConfig || {}) : sourceConfig || {};

    if (type === 'mysql') {
      const mapping = effectiveConfig.columnMapping || {};
      const missingFields = REQUIRED_MYSQL_MAPPING_FIELDS.filter(({ key }) => {
        const value = mapping[key];
        return typeof value !== 'string' || value.trim().length === 0;
      });

      if (missingFields.length > 0) {
        return res.status(400).json({
          code: 'VALIDATION_ERROR',
          error: missingFields.map(({ label }) => `${label} column is required`).join(', '),
          missingFields: missingFields.map(({ key }) => key),
        });
      }
    }

    const result = await eventSourceData.upsertConfig(orgId, { type, config: effectiveConfig });

    // Trigger adapter refresh so changes take effect immediately
    const manager = getDeliveryWorkerManager();
    manager
      ._syncAdapters()
      .catch((err) => log('warn', 'Adapter sync after config update failed', { error: err.message }));

    log('info', 'Event source config updated', { orgId, type, updatedBy: req.user?.id });

    // Audit asynchronously — never block the response
    auditEventSource.configured(req, orgId, type, before, result).catch(() => {});

    return res.json(result);
  })
);

// DELETE /event-sources/:orgId
router.delete(
  '/:orgId',
  requirePermission('event_source:manage'),
  asyncHandler(async (req, res) => {
    const orgId = parseInt(req.params.orgId, 10);
    if (!Number.isFinite(orgId)) {
      return res.status(400).json({ error: 'Invalid orgId', code: 'VALIDATION_ERROR' });
    }

    if (!assertOrgAccess(req, res, orgId)) return;

    // Snapshot before-state for the audit record
    const before = await eventSourceData.getConfigForOrg(orgId).catch(() => null);

    await eventSourceData.deactivateConfig(orgId);

    // Trigger adapter refresh so the adapter for this org is stopped
    const manager = getDeliveryWorkerManager();
    manager
      ._syncAdapters()
      .catch((err) => log('warn', 'Adapter sync after config delete failed', { error: err.message }));

    log('info', 'Event source config deactivated', { orgId, deactivatedBy: req.user?.id });

    auditEventSource.deleted(req, orgId, before).catch(() => {});

    return res.json({ success: true });
  })
);

module.exports = router;
