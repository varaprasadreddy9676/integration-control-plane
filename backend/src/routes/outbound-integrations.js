const express = require('express');
const data = require('../data');
const { log } = require('../logger');
const { validateScript, applyTransform } = require('../services/transformer');
const { validateTargetUrl } = require('../utils/url-check');
const config = require('../config');
const { buildAuthHeaders } = require('../processor/auth-helper');
const asyncHandler = require('../utils/async-handler');
const { generateSigningSecret } = require('../services/integration-signing');
const { validateLookupConfigs } = require('../services/lookup-validator');
const { fetch, AbortController } = require('../utils/runtime');
const { executeSchedulingScript, validateRecurringConfig } = require('../services/scheduler');
const { generateMaskedCurlCommand } = require('../utils/curl-generator');
const { auditIntegration } = require('../middleware/audit');

const router = express.Router();

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const integrations = await data.listIntegrations(req.orgId);
    res.json(integrations);
  })
);

router.get(
  '/event-types',
  asyncHandler(async (_req, res) => {
    const eventTypes = await data.listEventTypes();
    res.json({ eventTypes });
  })
);

// Bulk operations - Must be defined BEFORE /:id routes to avoid parameter matching
router.patch(
  '/bulk',
  asyncHandler(async (req, res) => {
    const { action, ids } = req.body;

    // Validation
    if (!action || !['enable', 'disable'].includes(action)) {
      return res.status(400).json({
        error: 'Invalid action. Must be "enable" or "disable"',
        code: 'VALIDATION_ERROR',
      });
    }

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({
        error: 'ids must be a non-empty array',
        code: 'VALIDATION_ERROR',
      });
    }

    if (ids.length > 100) {
      return res.status(400).json({
        error: 'Cannot update more than 100 integrations at once',
        code: 'VALIDATION_ERROR',
      });
    }

    const isActive = action === 'enable';
    const result = await data.bulkUpdateIntegrations(req.orgId, ids, { isActive });

    log('info', 'Bulk integration update', {
      orgId: req.orgId,
      action,
      idsCount: ids.length,
      updatedCount: result.updatedCount,
    });

    if (action === 'enable') {
      await auditIntegration.bulkEnabled(req, ids);
    } else {
      await auditIntegration.bulkDisabled(req, ids);
    }

    return res.json({
      message: `Successfully ${action}d ${result.updatedCount} integration(s)`,
      updatedCount: result.updatedCount,
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
        error: 'Cannot delete more than 100 integrations at once',
        code: 'VALIDATION_ERROR',
      });
    }

    const result = await data.bulkDeleteIntegrations(req.orgId, ids);

    log('info', 'Bulk integration delete', {
      orgId: req.orgId,
      idsCount: ids.length,
      deletedCount: result.deletedCount,
    });

    await auditIntegration.bulkDeleted(req, ids);

    return res.json({
      message: `Successfully deleted ${result.deletedCount} integration(s)`,
      deletedCount: result.deletedCount,
      failedIds: result.failedIds,
    });
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const integration = await data.getIntegration(req.params.id);
    if (!integration || integration.orgId !== req.orgId) {
      return res.status(404).json({ error: 'Integration not found', code: 'NOT_FOUND' });
    }
    return res.json(integration);
  })
);

// Get curl command for INBOUND integration
router.get(
  '/:id/curl',
  asyncHandler(async (req, res) => {
    const integration = await data.getIntegration(req.params.id);
    if (!integration || integration.orgId !== req.orgId) {
      return res.status(404).json({ error: 'Integration not found', code: 'NOT_FOUND' });
    }

    // Only generate curl for INBOUND integrations
    if (integration.direction !== 'INBOUND') {
      return res.status(400).json({
        error: 'Curl generation only available for INBOUND integrations',
        code: 'INVALID_DIRECTION',
      });
    }

    // Generate curl command with masked credentials
    const baseUrl = req.query.baseUrl || `${req.protocol}://${req.get('host')}`;

    // Sample payload can be provided via query param as JSON string
    let samplePayload;
    if (req.query.samplePayload) {
      try {
        samplePayload = JSON.parse(req.query.samplePayload);
      } catch (e) {
        log('warn', 'Failed to parse samplePayload query param', { error: e.message });
      }
    }

    const curlCommand = generateMaskedCurlCommand(integration, {
      baseUrl,
      samplePayload,
    });

    return res.json({
      curlCommand,
      integration: {
        id: integration.id,
        name: integration.name,
        type: integration.type,
        direction: integration.direction,
      },
    });
  })
);

// Duplicate integration - Must be before POST / to avoid parameter matching
router.post(
  '/:id/duplicate',
  asyncHandler(async (req, res) => {
    const integration = await data.getIntegration(req.params.id);
    if (!integration || integration.orgId !== req.orgId) {
      return res.status(404).json({ error: 'Integration not found', code: 'NOT_FOUND' });
    }

    // Create duplicate data - remove fields that should be auto-generated
    const { id, entityName, createdAt, updatedAt, ...duplicateData } = integration;

    // Append " (Copy)" to the name
    duplicateData.name = `${integration.name} (Copy)`;

    // Set as active by default
    duplicateData.isActive = true;

    // Create the new integration
    const newIntegration = await data.addIntegration(req.orgId, duplicateData);
    log('info', 'Integration duplicated', {
      originalId: req.params.id,
      newId: newIntegration.id,
      orgId: req.orgId,
    });

    await auditIntegration.duplicated(req, req.params.id, newIntegration);
    return res.status(201).json(newIntegration);
  })
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    // Normalize eventType ↔ type for backward compatibility
    if (req.body.type && !req.body.eventType) {
      req.body.eventType = req.body.type;
    } else if (req.body.eventType && !req.body.type) {
      req.body.type = req.body.eventType;
    }

    // Check if this is a multi-action integration
    const isMultiAction = req.body.actions && Array.isArray(req.body.actions) && req.body.actions.length > 0;

    if (isMultiAction) {
      // Multi-action integration validation
      const required = ['name', 'eventType', 'scope', 'outgoingAuthType', 'timeoutMs', 'retryCount', 'actions'];
      const missing = required.filter((field) => req.body[field] === undefined || req.body[field] === null);
      if (missing.length) {
        return res.status(400).json({ error: `Missing fields: ${missing.join(', ')}`, code: 'VALIDATION_ERROR' });
      }

      // Validate each action
      for (let i = 0; i < req.body.actions.length; i++) {
        const action = req.body.actions[i];

        // Action must have targetUrl (can fall back to integration-level targetUrl if provided)
        if (!action.targetUrl && !req.body.targetUrl) {
          return res.status(400).json({
            error: `Action ${i + 1} (${action.name || 'unnamed'}) requires targetUrl`,
            code: 'VALIDATION_ERROR',
          });
        }

        // Validate action's target URL if present
        if (action.targetUrl) {
          const urlCheck = validateTargetUrl(action.targetUrl, config.security);
          if (!urlCheck.valid) {
            return res.status(400).json({
              error: `Action ${i + 1}: ${urlCheck.reason}`,
              code: 'TARGET_URL_INVALID',
            });
          }
        }

        // Validate action's transformation script if present
        if (action.transformationMode === 'SCRIPT' && action.transformation?.script) {
          if (!validateScript(action.transformation.script)) {
            return res.status(400).json({
              error: `Action ${i + 1}: Invalid transformation script`,
              code: 'SCRIPT_INVALID',
            });
          }
        }
      }

      // Validate integration-level targetUrl if provided
      if (req.body.targetUrl) {
        const urlCheck = validateTargetUrl(req.body.targetUrl, config.security);
        if (!urlCheck.valid) {
          return res.status(400).json({ error: urlCheck.reason, code: 'TARGET_URL_INVALID' });
        }
      }
    } else {
      // Legacy single-action integration validation
      const required = [
        'name',
        'eventType',
        'targetUrl',
        'httpMethod',
        'scope',
        'outgoingAuthType',
        'timeoutMs',
        'retryCount',
      ];
      const missing = required.filter((field) => req.body[field] === undefined || req.body[field] === null);
      if (missing.length) {
        return res.status(400).json({ error: `Missing fields: ${missing.join(', ')}`, code: 'VALIDATION_ERROR' });
      }

      const urlCheck = validateTargetUrl(req.body.targetUrl, config.security);
      if (!urlCheck.valid) {
        return res.status(400).json({ error: urlCheck.reason, code: 'TARGET_URL_INVALID' });
      }
    }

    // Validate integration-level transformation script if present
    if (req.body.transformationMode === 'SCRIPT' && req.body.transformation?.script) {
      if (!validateScript(req.body.transformation.script)) {
        return res.status(400).json({ error: 'Invalid transformation script', code: 'SCRIPT_INVALID' });
      }
    }

    // Validate lookup configurations if present
    if (req.body.lookups && Array.isArray(req.body.lookups) && req.body.lookups.length > 0) {
      try {
        validateLookupConfigs(req.body.lookups);
      } catch (err) {
        return res.status(400).json({
          error: `Invalid lookup configuration: ${err.message}`,
          code: 'LOOKUP_VALIDATION_ERROR',
        });
      }
    }

    // Validate excludedEntityRids if provided
    if (
      req.body.excludedEntityRids &&
      Array.isArray(req.body.excludedEntityRids) &&
      req.body.excludedEntityRids.length > 0
    ) {
      if (req.body.scope === 'INCLUDE_CHILDREN') {
        try {
          const tenant = await data.getTenant(req.orgId);
          const childRids = tenant.childEntities.map((c) => c.rid);

          const invalidRids = req.body.excludedEntityRids.filter(
            (rid) => !childRids.includes(rid) && rid !== req.orgId
          );

          if (invalidRids.length > 0) {
            return res.status(400).json({
              error: `Invalid excluded entity RIDs: ${invalidRids.join(', ')}. These are not children of parent entity ${req.orgId}`,
              code: 'VALIDATION_ERROR',
            });
          }
        } catch (err) {
          log('warn', 'Failed to validate excludedEntityRids', { error: err.message });
          // Continue anyway - tenant might not be found in database
        }
      } else if (req.body.scope === 'ENTITY_ONLY') {
        // Excluded entities don't make sense for ENTITY_ONLY scope
        return res.status(400).json({
          error: 'excludedEntityRids can only be used with scope "INCLUDE_CHILDREN"',
          code: 'VALIDATION_ERROR',
        });
      }
    }

    const integration = await data.addIntegration(req.orgId, req.body);
    log('info', 'Integration created', { id: integration.id, orgId: req.orgId, isMultiAction });
    await auditIntegration.created(req, integration);
    return res.status(201).json(integration);
  })
);

router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const beforeIntegration = await data.getIntegration(req.params.id);
    if (req.body.targetUrl) {
      const urlCheck = validateTargetUrl(req.body.targetUrl, config.security);
      if (!urlCheck.valid) {
        return res.status(400).json({ error: urlCheck.reason, code: 'TARGET_URL_INVALID' });
      }
    }
    if (req.body.transformationMode === 'SCRIPT' && req.body.transformation?.script) {
      if (!validateScript(req.body.transformation.script)) {
        return res.status(400).json({ error: 'Invalid transformation script', code: 'SCRIPT_INVALID' });
      }
    }

    // Validate lookup configurations if present
    if (req.body.lookups && Array.isArray(req.body.lookups) && req.body.lookups.length > 0) {
      try {
        validateLookupConfigs(req.body.lookups);
      } catch (err) {
        return res.status(400).json({
          error: `Invalid lookup configuration: ${err.message}`,
          code: 'LOOKUP_VALIDATION_ERROR',
        });
      }
    }

    // Validate excludedEntityRids if provided
    if (
      req.body.excludedEntityRids &&
      Array.isArray(req.body.excludedEntityRids) &&
      req.body.excludedEntityRids.length > 0
    ) {
      // Get existing integration to check current scope
      const existingIntegration = await data.getIntegration(req.params.id);
      const scope = req.body.scope || existingIntegration?.scope;

      if (scope === 'INCLUDE_CHILDREN') {
        try {
          const tenant = await data.getTenant(req.orgId);
          const childRids = tenant.childEntities.map((c) => c.rid);

          const invalidRids = req.body.excludedEntityRids.filter(
            (rid) => !childRids.includes(rid) && rid !== req.orgId
          );

          if (invalidRids.length > 0) {
            return res.status(400).json({
              error: `Invalid excluded entity RIDs: ${invalidRids.join(', ')}. These are not children of parent entity ${req.orgId}`,
              code: 'VALIDATION_ERROR',
            });
          }
        } catch (err) {
          log('warn', 'Failed to validate excludedEntityRids', { error: err.message });
          // Continue anyway - tenant might not be found in database
        }
      } else if (scope === 'ENTITY_ONLY') {
        // Excluded entities don't make sense for ENTITY_ONLY scope
        return res.status(400).json({
          error: 'excludedEntityRids can only be used with scope "INCLUDE_CHILDREN"',
          code: 'VALIDATION_ERROR',
        });
      }
    }

    const integration = await data.updateIntegration(req.orgId, req.params.id, req.body);
    if (!integration) {
      return res.status(404).json({ error: 'Integration not found', code: 'NOT_FOUND' });
    }
    log('info', 'Integration updated', { id: integration.id, orgId: req.orgId });
    await auditIntegration.updated(req, req.params.id, { before: beforeIntegration, after: integration });
    return res.json(integration);
  })
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const beforeIntegration = await data.getIntegration(req.params.id);
    const removed = await data.deleteIntegration(req.orgId, req.params.id);
    if (!removed) {
      return res.status(404).json({ error: 'Integration not found', code: 'NOT_FOUND' });
    }
    log('info', 'Integration deleted', { id: req.params.id, orgId: req.orgId });
    await auditIntegration.deleted(req, req.params.id, beforeIntegration);
    return res.json({ message: 'Integration deleted' });
  })
);

/**
 * POST /api/v1/outbound-integrations/validate-transformation
 * Validate a transformation script without saving
 */
router.post(
  '/validate-transformation',
  asyncHandler(async (req, res) => {
    const { script, samplePayload } = req.body;

    if (!script) {
      return res.status(400).json({
        success: false,
        error: 'Script is required',
        code: 'VALIDATION_ERROR',
      });
    }

    // Use provided sample or create a default one
    const payload = samplePayload || {
      testMode: true,
      timestamp: new Date().toISOString(),
      sampleData: 'Sample transformation test',
    };

    try {
      // Create a mock integration config for transformation
      const mockIntegration = {
        transformation: {
          script,
          mappings: [],
          staticFields: [],
        },
      };

      const context = {
        eventType: 'TEST_EVENT',
        orgId: req.orgId || 1,
        entityName: 'Test Entity',
      };

      // Execute transformation
      const result = await applyTransform(mockIntegration, payload, context);

      log('info', 'Transformation script validated', {
        orgId: req.orgId,
        inputSize: JSON.stringify(payload).length,
        outputSize: JSON.stringify(result).length,
      });

      return res.json({
        success: true,
        message: 'Transformation script executed successfully',
        result: {
          input: payload,
          output: result,
          inputSize: JSON.stringify(payload).length,
          outputSize: JSON.stringify(result).length,
        },
      });
    } catch (err) {
      log('error', 'Transformation script validation failed', {
        orgId: req.orgId,
        error: err.message,
      });

      return res.status(400).json({
        success: false,
        error: err.message || 'Script execution failed',
        code: 'SCRIPT_ERROR',
      });
    }
  })
);

router.post(
  '/:id/test',
  asyncHandler(async (req, res) => {
    const integration = await data.getIntegration(req.params.id);
    if (!integration || integration.orgId !== req.orgId) {
      return res.status(404).json({ error: 'Integration not found', code: 'NOT_FOUND' });
    }

    const incomingPayload = req.body?.payload || {
      sample: true,
      testMode: true,
      timestamp: new Date().toISOString(),
    };

    const start = Date.now();
    const isMultiAction = integration.actions && Array.isArray(integration.actions) && integration.actions.length > 0;

    // Handle multi-action integrations
    if (isMultiAction) {
      const actionResults = [];

      for (const action of integration.actions) {
        const actionStart = Date.now();
        let actionStatus = 'FAILED';
        let actionResponseStatus = 500;
        let actionResponseBody = null;
        let actionError = null;
        let transformed = incomingPayload;

        try {
          // Validate action target URL
          const targetUrl = action.targetUrl || integration.targetUrl;
          if (!targetUrl) {
            throw new Error('No target URL specified for action');
          }

          const urlCheck = validateTargetUrl(targetUrl, config.security);
          if (!urlCheck.valid) {
            throw new Error(urlCheck.reason);
          }

          // Apply action transformation
          if (action.transformationMode === 'SCRIPT' && action.transformation?.script) {
            const actionIntegration = { ...integration, transformation: action.transformation };
            transformed = await applyTransform(actionIntegration, incomingPayload, {
              eventType: integration.type,
              orgId: integration.orgId,
            });
          }

          // Execute action
          const controller = new AbortController();
          const timeout = integration.timeoutMs || config.worker?.timeoutMs || 10000;
          const timer = setTimeout(() => controller.abort(), timeout);

          const httpMethod = action.httpMethod || integration.httpMethod || 'POST';
          const headers = await buildAuthHeaders(integration, httpMethod, targetUrl);
          headers['Content-Type'] = 'application/json';

          const resp = await fetch(targetUrl, {
            method: httpMethod,
            headers,
            body: JSON.stringify(transformed),
            signal: controller.signal,
          });

          clearTimeout(timer);
          actionResponseStatus = resp.status;

          try {
            const text = await resp.text();
            actionResponseBody = text.slice(0, 5000);
          } catch (err) {
            actionResponseBody = `Unable to read response: ${err.message}`;
          }

          if (resp.status >= 200 && resp.status < 300) {
            actionStatus = 'SUCCESS';
          } else if (resp.status >= 400 && resp.status < 500) {
            actionStatus = 'FAILED';
            actionError = `Client error: ${resp.status}`;
          } else {
            actionStatus = 'FAILED';
            actionError = `Server error: ${resp.status}`;
          }
        } catch (err) {
          actionError = err.message;
          actionStatus = 'FAILED';
        }

        actionResults.push({
          action: action.name,
          status: actionStatus,
          responseStatus: actionResponseStatus,
          responseBody: actionResponseBody,
          responseTimeMs: Date.now() - actionStart,
          errorMessage: actionError,
        });
      }

      const totalResponseTimeMs = Date.now() - start;
      const overallStatus = actionResults.every((r) => r.status === 'SUCCESS') ? 'SUCCESS' : 'FAILED';

      // Record log
      await data.recordLog(req.orgId, {
        __KEEP___KEEP_integrationConfig__Id__: integration.id,
        __KEEP_integrationName__: integration.name,
        eventType: integration.type,
        status: overallStatus,
        responseStatus: actionResults[0]?.responseStatus || 500,
        responseTimeMs: totalResponseTimeMs,
        attemptCount: 1,
        requestPayload: incomingPayload,
        actionResults,
      });

      return res.json({
        id: integration.id,
        status: overallStatus.toLowerCase(),
        deliveredAt: new Date().toISOString(),
        responseTimeMs: totalResponseTimeMs,
        actionResults,
      });
    }

    // Handle traditional single-action integrations
    // Validate target URL
    const urlCheck = validateTargetUrl(integration.targetUrl, config.security);
    if (!urlCheck.valid) {
      return res.status(400).json({
        error: urlCheck.reason,
        code: 'TARGET_URL_INVALID',
      });
    }

    let transformed = incomingPayload;
    let errorMessage = null;
    let deliveryStatus = 'FAILED';
    let responseStatus = 500;
    let responseBody = null;

    // Step 1: Apply transformation
    try {
      transformed = await applyTransform(integration, incomingPayload, {
        eventType: integration.type,
        orgId: integration.orgId,
      });
    } catch (err) {
      errorMessage = `Transformation failed: ${err.message}`;
      log('warn', 'Test integration transformation failed', {
        id: integration.id,
        error: err.message,
      });

      // Record transformation failure
      await data.recordLog(req.orgId, {
        __KEEP___KEEP_integrationConfig__Id__: integration.id,
        __KEEP_integrationName__: integration.name,
        eventType: integration.type,
        status: 'FAILED',
        responseStatus: 500,
        responseTimeMs: Date.now() - start,
        attemptCount: 1,
        requestPayload: incomingPayload,
        errorMessage,
      });

      return res.status(400).json({
        id: integration.id,
        status: 'failed',
        error: errorMessage,
        responseStatus: 500,
      });
    }

    // Step 2: Actually deliver the integration (like worker.js does)
    try {
      const controller = new AbortController();
      const timeout = integration.timeoutMs || config.worker?.timeoutMs || 10000;
      const timer = setTimeout(() => controller.abort(), timeout);

      // Build headers with authentication
      const httpMethod = integration.httpMethod || 'POST';
      const headers = await buildAuthHeaders(integration, httpMethod, integration.targetUrl);
      headers['Content-Type'] = 'application/json';

      // Make the actual HTTP request
      const resp = await fetch(integration.targetUrl, {
        method: httpMethod,
        headers,
        body: JSON.stringify(transformed),
        signal: controller.signal,
      });

      clearTimeout(timer);
      const responseTimeMs = Date.now() - start;
      const statusOk = resp.status >= 200 && resp.status < 300;

      // Read response body (limit to 5000 chars)
      try {
        const text = await resp.text();
        responseBody = text.slice(0, 5000);
      } catch (err) {
        responseBody = `Unable to read response: ${err.message}`;
      }

      // Determine status using same logic as worker
      if (statusOk) {
        deliveryStatus = 'SUCCESS';
        errorMessage = null;
      } else if (resp.status >= 500) {
        deliveryStatus = 'FAILED'; // For tests, don't retry
        errorMessage = `Server error: ${resp.status}`;
      } else if (resp.status === 429) {
        deliveryStatus = 'FAILED'; // For tests, don't retry
        errorMessage = 'Rate limited';
      } else if (resp.status >= 400 && resp.status < 500) {
        deliveryStatus = 'FAILED';
        errorMessage = `Client error: ${resp.status}`;
      }

      responseStatus = resp.status;

      // Record the actual delivery result
      await data.recordLog(req.orgId, {
        __KEEP___KEEP_integrationConfig__Id__: integration.id,
        __KEEP_integrationName__: integration.name,
        eventType: integration.type,
        status: deliveryStatus,
        responseStatus,
        responseBody,
        responseTimeMs,
        attemptCount: 1,
        requestPayload: transformed,
        errorMessage,
      });

      log('info', 'Test integration delivered', {
        id: integration.id,
        orgId: req.orgId,
        status: deliveryStatus,
        responseStatus,
        responseTimeMs,
      });

      return res.json({
        id: integration.id,
        status: deliveryStatus.toLowerCase(),
        deliveredAt: new Date().toISOString(),
        responseStatus,
        responseBody,
        responseTimeMs,
        errorMessage,
      });
    } catch (err) {
      // Handle network errors, timeouts, etc.
      const responseTimeMs = Date.now() - start;
      errorMessage = err.name === 'AbortError' ? `Request timeout after ${timeout}ms` : err.message;

      await data.recordLog(req.orgId, {
        __KEEP___KEEP_integrationConfig__Id__: integration.id,
        __KEEP_integrationName__: integration.name,
        eventType: integration.type,
        status: 'FAILED',
        responseStatus: 500,
        responseTimeMs,
        attemptCount: 1,
        requestPayload: transformed,
        errorMessage,
      });

      log('error', 'Test integration delivery failed', {
        id: integration.id,
        error: err.message,
      });

      return res.status(500).json({
        id: integration.id,
        status: 'failed',
        error: errorMessage,
        responseStatus: 500,
        responseTimeMs,
      });
    }
  })
);

// Test scheduling script (dry-run)
router.post(
  '/:id/test-schedule',
  asyncHandler(async (req, res) => {
    // Accept script, deliveryMode, eventType, and payload from request body for testing unsaved changes
    const {
      script: requestScript,
      deliveryMode: requestDeliveryMode,
      payload: requestPayload,
      eventType: requestEventType,
    } = req.body || {};

    // For existing integrations, fetch from database; for new integrations (id='new'), skip DB fetch
    let integration = null;
    if (req.params.id !== 'new') {
      integration = await data.getIntegration(req.params.id);
      const integrationOrgId = integration?.orgId;
      if (!integration || integrationOrgId !== req.orgId) {
        return res.status(404).json({ error: 'Integration not found', code: 'NOT_FOUND' });
      }
    }

    // Use request body values if provided, otherwise fall back to saved integration config
    const deliveryMode = requestDeliveryMode || integration?.deliveryMode;
    const script = requestScript || integration?.schedulingConfig?.script;
    const eventType = requestEventType || integration?.eventType;

    // Check if we have a valid delivery mode
    if (!deliveryMode || deliveryMode === 'IMMEDIATE') {
      return res.status(400).json({
        error: 'Integration is not configured for scheduling',
        code: 'NOT_SCHEDULED',
        message: 'deliveryMode must be DELAYED or RECURRING to test scheduling script',
      });
    }

    // Check if we have a script
    if (!script) {
      return res.status(400).json({
        error: 'No scheduling script configured',
        code: 'MISSING_SCRIPT',
        message: 'schedulingConfig.script is required for DELAYED/RECURRING integrations',
      });
    }

    // Get sample payload: custom > event-specific > generic fallback
    let samplePayload = requestPayload;

    if (!samplePayload && eventType) {
      // Try to get event-specific sample payload from event_types collection
      const eventTypeSample = await data.getEventTypeSamplePayload(eventType);
      if (eventTypeSample) {
        samplePayload = {
          ...eventTypeSample,
          sample: true,
          testMode: true,
          timestamp: eventTypeSample.timestamp || new Date().toISOString(),
          createdAt: eventTypeSample.createdAt || new Date().toISOString(),
        };
        log('info', 'Using event-specific sample payload for scheduling test', { eventType });
      }
    }

    // Fallback to generic appointment-based sample if no event-specific sample found
    if (!samplePayload) {
      samplePayload = {
        sample: true,
        testMode: true,
        timestamp: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        arrivedAt: new Date().toISOString(),
        // Generic appointment data (for templates when event type is unknown)
        appt: {
          apptDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // 3 days from now
          fromDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          apptTime: '14:00:00',
          fromTime: '14:00:00',
          patientName: 'Test Patient',
          reasonForVisit: 'new consult',
        },
        patient: {
          fullName: 'Test Patient',
          phone: '9876543210',
          uhid: 'TEST_UHID_001',
        },
        appointmentDateTime: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
      };
      log('debug', 'Using generic appointment sample payload for scheduling test', { eventType });
    }

    try {
      const start = Date.now();

      // Execute scheduling script
      const scheduleResult = await executeSchedulingScript(script, samplePayload, {
        eventType: integration?.eventType || 'TEST_EVENT',
        orgId: integration?.orgId || req.orgId,
        __KEEP_integrationConfig__: integration || { name: 'Test Integration' },
      });

      const executionTime = Date.now() - start;

      // Validate and format result based on delivery mode
      if (deliveryMode === 'DELAYED') {
        // DELAYED mode: result should be a Unix timestamp
        if (typeof scheduleResult !== 'number') {
          return res.status(400).json({
            error: 'Invalid scheduling script result',
            code: 'INVALID_RESULT',
            message: 'DELAYED mode script must return a number (Unix timestamp in milliseconds)',
            result: scheduleResult,
            resultType: typeof scheduleResult,
          });
        }

        const scheduledDate = new Date(scheduleResult);
        const now = new Date();
        const delayMs = scheduleResult - now.getTime();
        const delayHours = Math.floor(delayMs / (1000 * 60 * 60));
        const delayMinutes = Math.floor((delayMs % (1000 * 60 * 60)) / (1000 * 60));

        return res.json({
          success: true,
          deliveryMode: 'DELAYED',
          result: {
            timestamp: scheduleResult,
            scheduledFor: scheduledDate.toISOString(),
            delayFromNow: `${delayHours}h ${delayMinutes}m`,
            delayMs: delayMs,
            isPastDue: delayMs < 0,
          },
          executionTimeMs: executionTime,
          samplePayload,
        });
      } else if (deliveryMode === 'RECURRING') {
        // RECURRING mode: result should be a config object
        if (typeof scheduleResult !== 'object' || scheduleResult === null) {
          return res.status(400).json({
            error: 'Invalid scheduling script result',
            code: 'INVALID_RESULT',
            message:
              'RECURRING mode script must return an object with firstOccurrence, intervalMs, and maxOccurrences/endDate',
            result: scheduleResult,
            resultType: typeof scheduleResult,
          });
        }

        // Validate recurring config
        try {
          validateRecurringConfig(scheduleResult);
        } catch (validationErr) {
          return res.status(400).json({
            error: 'Invalid recurring configuration',
            code: 'INVALID_CONFIG',
            message: validationErr.message,
            result: scheduleResult,
          });
        }

        const firstOccurrence = new Date(scheduleResult.firstOccurrence);
        const intervalHours = Math.floor(scheduleResult.intervalMs / (1000 * 60 * 60));
        const intervalMinutes = Math.floor((scheduleResult.intervalMs % (1000 * 60 * 60)) / (1000 * 60));

        // Calculate sample occurrences
        const sampleOccurrences = [];
        for (let i = 1; i <= Math.min(5, scheduleResult.maxOccurrences || 5); i++) {
          const occurrenceTime = scheduleResult.firstOccurrence + scheduleResult.intervalMs * (i - 1);
          sampleOccurrences.push({
            occurrence: i,
            scheduledFor: new Date(occurrenceTime).toISOString(),
          });
        }

        return res.json({
          success: true,
          deliveryMode: 'RECURRING',
          result: {
            firstOccurrence: scheduleResult.firstOccurrence,
            firstOccurrenceDate: firstOccurrence.toISOString(),
            intervalMs: scheduleResult.intervalMs,
            intervalHuman: `${intervalHours}h ${intervalMinutes}m`,
            maxOccurrences: scheduleResult.maxOccurrences,
            endDate: scheduleResult.endDate,
            endDateFormatted: scheduleResult.endDate ? new Date(scheduleResult.endDate).toISOString() : null,
            totalOccurrences: scheduleResult.maxOccurrences || 'Until endDate',
            sampleOccurrences,
          },
          executionTimeMs: executionTime,
          samplePayload,
        });
      }
    } catch (err) {
      log('error', 'Scheduling script test failed', {
        integrationId: integration?.id || 'new',
        error: err.message,
        stack: err.stack,
      });

      return res.status(500).json({
        success: false,
        error: 'Scheduling script execution failed',
        code: 'EXECUTION_ERROR',
        message: err.message,
        deliveryMode: deliveryMode,
      });
    }
  })
);

// Integration signing: Rotate secret (zero-downtime)
router.post(
  '/:id/signing/rotate',
  asyncHandler(async (req, res) => {
    const integration = await data.getIntegration(req.params.id);
    if (!integration || integration.orgId !== req.orgId) {
      return res.status(404).json({ error: 'Integration not found', code: 'NOT_FOUND' });
    }

    // Generate new secret
    const newSecret = generateSigningSecret();
    const currentSecrets = integration.signingSecrets || [];

    // Add new secret to the array (keep old ones for zero-downtime rotation)
    const updatedSecrets = [newSecret, ...currentSecrets].slice(0, 3); // Max 3 secrets

    // Update integration with new secret
    await data.updateIntegration(req.orgId, req.params.id, {
      signingSecret: newSecret, // New primary secret
      signingSecrets: updatedSecrets, // All active secrets
    });

    log('info', 'Integration signing secret rotated', {
      integrationId: req.params.id,
      __KEEP_integrationName__: integration.name,
      secretCount: updatedSecrets.length,
    });

    await auditIntegration.secretRotated(req, req.params.id);
    res.json({
      message: 'New signing secret generated successfully',
      newSecret,
      signingSecrets: updatedSecrets,
    });
  })
);

// Integration signing: Remove old secret
router.post(
  '/:id/signing/remove',
  asyncHandler(async (req, res) => {
    const { secret } = req.body;

    if (!secret) {
      return res.status(400).json({ error: 'secret is required', code: 'VALIDATION_ERROR' });
    }

    const integration = await data.getIntegration(req.params.id);
    const integrationOrgId = integration?.orgId;
    if (!integration || integrationOrgId !== req.orgId) {
      return res.status(404).json({ error: 'Integration not found', code: 'NOT_FOUND' });
    }

    const currentSecrets = integration.signingSecrets || [];

    // Cannot remove the primary secret
    if (secret === integration.signingSecret) {
      return res.status(400).json({
        error: 'Cannot remove the primary signing secret',
        code: 'VALIDATION_ERROR',
      });
    }

    // Cannot remove if it's the only secret
    if (currentSecrets.length <= 1) {
      return res.status(400).json({
        error: 'Cannot remove the last signing secret',
        code: 'VALIDATION_ERROR',
      });
    }

    // Remove the secret from the array
    const updatedSecrets = currentSecrets.filter((s) => s !== secret);

    // Update integration
    await data.updateIntegration(req.orgId, req.params.id, {
      signingSecrets: updatedSecrets,
    });

    log('info', 'Integration signing secret removed', {
      integrationId: req.params.id,
      __KEEP_integrationName__: integration.name,
      secretCount: updatedSecrets.length,
    });

    await auditIntegration.secretRemoved(req, req.params.id);
    res.json({
      message: 'Signing secret removed successfully',
      signingSecrets: updatedSecrets,
    });
  })
);

module.exports = router;
