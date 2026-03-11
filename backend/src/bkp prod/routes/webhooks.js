const express = require('express');
const data = require('../data');
const { log } = require('../logger');
const { validateScript, applyTransform } = require('../services/transformer');
const { validateTargetUrl } = require('../utils/url-check');
const config = require('../config');
const { buildAuthHeaders } = require('../processor/auth-helper');
const asyncHandler = require('../utils/async-handler');
const { generateSigningSecret } = require('../services/webhook-signing');
const { validateLookupConfigs } = require('../services/lookup-validator');
const { fetch, AbortController } = require('../utils/runtime');
const { executeSchedulingScript, validateRecurringConfig } = require('../services/scheduler');

const router = express.Router();

router.get('/', asyncHandler(async (req, res) => {
  const webhooks = await data.listWebhooks(req.entityParentRid);
  res.json(webhooks);
}));

router.get('/event-types', asyncHandler(async (_req, res) => {
  const eventTypes = await data.listEventTypes();
  res.json({ eventTypes });
}));

// Bulk operations - Must be defined BEFORE /:id routes to avoid parameter matching
router.patch('/bulk', asyncHandler(async (req, res) => {
  const { action, ids } = req.body;

  // Validation
  if (!action || !['enable', 'disable'].includes(action)) {
    return res.status(400).json({
      error: 'Invalid action. Must be "enable" or "disable"',
      code: 'VALIDATION_ERROR'
    });
  }

  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({
      error: 'ids must be a non-empty array',
      code: 'VALIDATION_ERROR'
    });
  }

  if (ids.length > 100) {
    return res.status(400).json({
      error: 'Cannot update more than 100 webhooks at once',
      code: 'VALIDATION_ERROR'
    });
  }

  const isActive = action === 'enable';
  const result = await data.bulkUpdateWebhooks(req.entityParentRid, ids, { isActive });

  log('info', 'Bulk webhook update', {
    entityRid: req.entityParentRid,
    action,
    idsCount: ids.length,
    updatedCount: result.updatedCount
  });

  return res.json({
    message: `Successfully ${action}d ${result.updatedCount} webhook(s)`,
    updatedCount: result.updatedCount,
    failedIds: result.failedIds
  });
}));

router.delete('/bulk', asyncHandler(async (req, res) => {
  const { ids } = req.body;

  // Validation
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({
      error: 'ids must be a non-empty array',
      code: 'VALIDATION_ERROR'
    });
  }

  if (ids.length > 100) {
    return res.status(400).json({
      error: 'Cannot delete more than 100 webhooks at once',
      code: 'VALIDATION_ERROR'
    });
  }

  const result = await data.bulkDeleteWebhooks(req.entityParentRid, ids);

  log('info', 'Bulk webhook delete', {
    entityRid: req.entityParentRid,
    idsCount: ids.length,
    deletedCount: result.deletedCount
  });

  return res.json({
    message: `Successfully deleted ${result.deletedCount} webhook(s)`,
    deletedCount: result.deletedCount,
    failedIds: result.failedIds
  });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const webhook = await data.getWebhook(req.params.id);
  if (!webhook || webhook.entityRid !== req.entityParentRid) {
    return res.status(404).json({ error: 'Webhook not found', code: 'NOT_FOUND' });
  }
  return res.json(webhook);
}));

// Duplicate webhook - Must be before POST / to avoid parameter matching
router.post('/:id/duplicate', asyncHandler(async (req, res) => {
  const webhook = await data.getWebhook(req.params.id);
  if (!webhook || webhook.entityRid !== req.entityParentRid) {
    return res.status(404).json({ error: 'Webhook not found', code: 'NOT_FOUND' });
  }

  // Create duplicate data - remove fields that should be auto-generated
  const { id, entityRid, entityName, createdAt, updatedAt, ...duplicateData } = webhook;

  // Append " (Copy)" to the name
  duplicateData.name = `${webhook.name} (Copy)`;

  // Set as active by default
  duplicateData.isActive = true;

  // Create the new webhook
  const newWebhook = await data.addWebhook(req.entityParentRid, duplicateData);
  log('info', 'Webhook duplicated', {
    originalId: req.params.id,
    newId: newWebhook.id,
    entityRid: req.entityParentRid
  });

  return res.status(201).json(newWebhook);
}));

router.post('/', asyncHandler(async (req, res) => {
  // Check if this is a multi-action webhook
  const isMultiAction = req.body.actions && Array.isArray(req.body.actions) && req.body.actions.length > 0;

  if (isMultiAction) {
    // Multi-action webhook validation
    const required = ['name', 'eventType', 'scope', 'outgoingAuthType', 'timeoutMs', 'retryCount', 'actions'];
    const missing = required.filter((field) => req.body[field] === undefined || req.body[field] === null);
    if (missing.length) {
      return res.status(400).json({ error: `Missing fields: ${missing.join(', ')}`, code: 'VALIDATION_ERROR' });
    }

    // Validate each action
    for (let i = 0; i < req.body.actions.length; i++) {
      const action = req.body.actions[i];

      // Action must have targetUrl (can fall back to webhook-level targetUrl if provided)
      if (!action.targetUrl && !req.body.targetUrl) {
        return res.status(400).json({
          error: `Action ${i + 1} (${action.name || 'unnamed'}) requires targetUrl`,
          code: 'VALIDATION_ERROR'
        });
      }

      // Validate action's target URL if present
      if (action.targetUrl) {
        const urlCheck = validateTargetUrl(action.targetUrl, config.security);
        if (!urlCheck.valid) {
          return res.status(400).json({
            error: `Action ${i + 1}: ${urlCheck.reason}`,
            code: 'TARGET_URL_INVALID'
          });
        }
      }

      // Validate action's transformation script if present
      if (action.transformationMode === 'SCRIPT' && action.transformation?.script) {
        if (!validateScript(action.transformation.script)) {
          return res.status(400).json({
            error: `Action ${i + 1}: Invalid transformation script`,
            code: 'SCRIPT_INVALID'
          });
        }
      }
    }

    // Validate webhook-level targetUrl if provided
    if (req.body.targetUrl) {
      const urlCheck = validateTargetUrl(req.body.targetUrl, config.security);
      if (!urlCheck.valid) {
        return res.status(400).json({ error: urlCheck.reason, code: 'TARGET_URL_INVALID' });
      }
    }
  } else {
    // Legacy single-action webhook validation
    const required = ['name', 'eventType', 'targetUrl', 'httpMethod', 'scope', 'outgoingAuthType', 'timeoutMs', 'retryCount'];
    const missing = required.filter((field) => req.body[field] === undefined || req.body[field] === null);
    if (missing.length) {
      return res.status(400).json({ error: `Missing fields: ${missing.join(', ')}`, code: 'VALIDATION_ERROR' });
    }

    const urlCheck = validateTargetUrl(req.body.targetUrl, config.security);
    if (!urlCheck.valid) {
      return res.status(400).json({ error: urlCheck.reason, code: 'TARGET_URL_INVALID' });
    }
  }

  // Validate webhook-level transformation script if present
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
        code: 'LOOKUP_VALIDATION_ERROR'
      });
    }
  }

  // Validate excludedEntityRids if provided
  if (req.body.excludedEntityRids && Array.isArray(req.body.excludedEntityRids) && req.body.excludedEntityRids.length > 0) {
    if (req.body.scope === 'INCLUDE_CHILDREN') {
      try {
        const tenant = await data.getTenant(req.entityParentRid);
        const childRids = tenant.childEntities.map(c => c.rid);

        const invalidRids = req.body.excludedEntityRids.filter(rid =>
          !childRids.includes(rid) && rid !== req.entityParentRid
        );

        if (invalidRids.length > 0) {
          return res.status(400).json({
            error: `Invalid excluded entity RIDs: ${invalidRids.join(', ')}. These are not children of parent entity ${req.entityParentRid}`,
            code: 'VALIDATION_ERROR'
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
        code: 'VALIDATION_ERROR'
      });
    }
  }

  const webhook = await data.addWebhook(req.entityParentRid, req.body);
  log('info', 'Webhook created', { id: webhook.id, entityRid: req.entityParentRid, isMultiAction });
  return res.status(201).json(webhook);
}));

router.put('/:id', asyncHandler(async (req, res) => {
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
        code: 'LOOKUP_VALIDATION_ERROR'
      });
    }
  }

  // Validate excludedEntityRids if provided
  if (req.body.excludedEntityRids && Array.isArray(req.body.excludedEntityRids) && req.body.excludedEntityRids.length > 0) {
    // Get existing webhook to check current scope
    const existingWebhook = await data.getWebhook(req.params.id);
    const scope = req.body.scope || existingWebhook?.scope;

    if (scope === 'INCLUDE_CHILDREN') {
      try {
        const tenant = await data.getTenant(req.entityParentRid);
        const childRids = tenant.childEntities.map(c => c.rid);

        const invalidRids = req.body.excludedEntityRids.filter(rid =>
          !childRids.includes(rid) && rid !== req.entityParentRid
        );

        if (invalidRids.length > 0) {
          return res.status(400).json({
            error: `Invalid excluded entity RIDs: ${invalidRids.join(', ')}. These are not children of parent entity ${req.entityParentRid}`,
            code: 'VALIDATION_ERROR'
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
        code: 'VALIDATION_ERROR'
      });
    }
  }

  const webhook = await data.updateWebhook(req.entityParentRid, req.params.id, req.body);
  if (!webhook) {
    return res.status(404).json({ error: 'Webhook not found', code: 'NOT_FOUND' });
  }
  log('info', 'Webhook updated', { id: webhook.id, entityRid: req.entityParentRid });
  return res.json(webhook);
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const removed = await data.deleteWebhook(req.entityParentRid, req.params.id);
  if (!removed) {
    return res.status(404).json({ error: 'Webhook not found', code: 'NOT_FOUND' });
  }
  log('info', 'Webhook deleted', { id: req.params.id, entityRid: req.entityParentRid });
  return res.json({ message: 'Webhook deleted' });
}));

/**
 * POST /api/v1/webhooks/validate-transformation
 * Validate a transformation script without saving
 */
router.post('/validate-transformation', asyncHandler(async (req, res) => {
  const { script, samplePayload } = req.body;

  if (!script) {
    return res.status(400).json({
      success: false,
      error: 'Script is required',
      code: 'VALIDATION_ERROR'
    });
  }

  // Use provided sample or create a default one
  const payload = samplePayload || {
    testMode: true,
    timestamp: new Date().toISOString(),
    sampleData: 'Sample transformation test'
  };

  try {
    // Create a mock webhook config for transformation
    const mockWebhook = {
      transformation: {
        script,
        mappings: [],
        staticFields: []
      }
    };

    const context = {
      eventType: 'TEST_EVENT',
      entityRid: req.entityParentRid || 1,
      entityParentRid: req.entityParentRid || 1,
      entityName: 'Test Entity'
    };

    // Execute transformation
    const result = await applyTransform(mockWebhook, payload, context);

    log('info', 'Transformation script validated', {
      entityRid: req.entityParentRid,
      inputSize: JSON.stringify(payload).length,
      outputSize: JSON.stringify(result).length
    });

    return res.json({
      success: true,
      message: 'Transformation script executed successfully',
      result: {
        input: payload,
        output: result,
        inputSize: JSON.stringify(payload).length,
        outputSize: JSON.stringify(result).length
      }
    });
  } catch (err) {
    log('error', 'Transformation script validation failed', {
      entityRid: req.entityParentRid,
      error: err.message
    });

    return res.status(400).json({
      success: false,
      error: err.message || 'Script execution failed',
      code: 'SCRIPT_ERROR'
    });
  }
}));

router.post('/:id/test', asyncHandler(async (req, res) => {
  const webhook = await data.getWebhook(req.params.id);
  if (!webhook || webhook.entityRid !== req.entityParentRid) {
    return res.status(404).json({ error: 'Webhook not found', code: 'NOT_FOUND' });
  }

  const incomingPayload = req.body?.payload || {
    sample: true,
    testMode: true,
    timestamp: new Date().toISOString()
  };

  const start = Date.now();
  const isMultiAction = webhook.actions && Array.isArray(webhook.actions) && webhook.actions.length > 0;

  // Handle multi-action webhooks
  if (isMultiAction) {
    const actionResults = [];

    for (const action of webhook.actions) {
      const actionStart = Date.now();
      let actionStatus = 'FAILED';
      let actionResponseStatus = 500;
      let actionResponseBody = null;
      let actionError = null;
      let transformed = incomingPayload;

      try {
        // Validate action target URL
        const targetUrl = action.targetUrl || webhook.targetUrl;
        if (!targetUrl) {
          throw new Error('No target URL specified for action');
        }

        const urlCheck = validateTargetUrl(targetUrl, config.security);
        if (!urlCheck.valid) {
          throw new Error(urlCheck.reason);
        }

        // Apply action transformation
        if (action.transformationMode === 'SCRIPT' && action.transformation?.script) {
          const actionWebhook = { ...webhook, transformation: action.transformation };
          transformed = await applyTransform(actionWebhook, incomingPayload, {
            eventType: webhook.eventType,
            entityRid: webhook.entityRid
          });
        }

        // Execute action
        const controller = new AbortController();
        const timeout = webhook.timeoutMs || config.worker?.timeoutMs || 10000;
        const timer = setTimeout(() => controller.abort(), timeout);

        const httpMethod = action.httpMethod || webhook.httpMethod || 'POST';
        const headers = await buildAuthHeaders(webhook, httpMethod, targetUrl);
        headers['Content-Type'] = 'application/json';

        const resp = await fetch(targetUrl, {
          method: httpMethod,
          headers,
          body: JSON.stringify(transformed),
          signal: controller.signal
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
        errorMessage: actionError
      });
    }

    const totalResponseTimeMs = Date.now() - start;
    const overallStatus = actionResults.every(r => r.status === 'SUCCESS') ? 'SUCCESS' : 'FAILED';

    // Record log
    await data.recordLog(req.entityParentRid, {
      webhookConfigId: webhook.id,
      webhookName: webhook.name,
      eventType: webhook.eventType,
      status: overallStatus,
      responseStatus: actionResults[0]?.responseStatus || 500,
      responseTimeMs: totalResponseTimeMs,
      attemptCount: 1,
      requestPayload: incomingPayload,
      actionResults
    });

    return res.json({
      id: webhook.id,
      status: overallStatus.toLowerCase(),
      deliveredAt: new Date().toISOString(),
      responseTimeMs: totalResponseTimeMs,
      actionResults
    });
  }

  // Handle traditional single-action webhooks
  // Validate target URL
  const urlCheck = validateTargetUrl(webhook.targetUrl, config.security);
  if (!urlCheck.valid) {
    return res.status(400).json({
      error: urlCheck.reason,
      code: 'TARGET_URL_INVALID'
    });
  }

  let transformed = incomingPayload;
  let errorMessage = null;
  let deliveryStatus = 'FAILED';
  let responseStatus = 500;
  let responseBody = null;

  // Step 1: Apply transformation
  try {
    transformed = await applyTransform(webhook, incomingPayload, {
      eventType: webhook.eventType,
      entityRid: webhook.entityRid
    });
  } catch (err) {
    errorMessage = `Transformation failed: ${err.message}`;
    log('warn', 'Test webhook transformation failed', {
      id: webhook.id,
      error: err.message
    });

    // Record transformation failure
    await data.recordLog(req.entityParentRid, {
      webhookConfigId: webhook.id,
      webhookName: webhook.name,
      eventType: webhook.eventType,
      status: 'FAILED',
      responseStatus: 500,
      responseTimeMs: Date.now() - start,
      attemptCount: 1,
      requestPayload: incomingPayload,
      errorMessage
    });

    return res.status(400).json({
      id: webhook.id,
      status: 'failed',
      error: errorMessage,
      responseStatus: 500
    });
  }

  // Step 2: Actually deliver the webhook (like worker.js does)
  try {
    const controller = new AbortController();
    const timeout = webhook.timeoutMs || config.worker?.timeoutMs || 10000;
    const timer = setTimeout(() => controller.abort(), timeout);

    // Build headers with authentication
    const httpMethod = webhook.httpMethod || 'POST';
    const headers = await buildAuthHeaders(webhook, httpMethod, webhook.targetUrl);
    headers['Content-Type'] = 'application/json';

    // Make the actual HTTP request
    const resp = await fetch(webhook.targetUrl, {
      method: httpMethod,
      headers,
      body: JSON.stringify(transformed),
      signal: controller.signal
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
    await data.recordLog(req.entityParentRid, {
      webhookConfigId: webhook.id,
      webhookName: webhook.name,
      eventType: webhook.eventType,
      status: deliveryStatus,
      responseStatus,
      responseBody,
      responseTimeMs,
      attemptCount: 1,
      requestPayload: transformed,
      errorMessage
    });

    log('info', 'Test webhook delivered', {
      id: webhook.id,
      entityRid: req.entityParentRid,
      status: deliveryStatus,
      responseStatus,
      responseTimeMs
    });

    return res.json({
      id: webhook.id,
      status: deliveryStatus.toLowerCase(),
      deliveredAt: new Date().toISOString(),
      responseStatus,
      responseBody,
      responseTimeMs,
      errorMessage
    });

  } catch (err) {
    // Handle network errors, timeouts, etc.
    const responseTimeMs = Date.now() - start;
    errorMessage = err.name === 'AbortError'
      ? `Request timeout after ${timeout}ms`
      : err.message;

    await data.recordLog(req.entityParentRid, {
      webhookConfigId: webhook.id,
      webhookName: webhook.name,
      eventType: webhook.eventType,
      status: 'FAILED',
      responseStatus: 500,
      responseTimeMs,
      attemptCount: 1,
      requestPayload: transformed,
      errorMessage
    });

    log('error', 'Test webhook delivery failed', {
      id: webhook.id,
      error: err.message
    });

    return res.status(500).json({
      id: webhook.id,
      status: 'failed',
      error: errorMessage,
      responseStatus: 500,
      responseTimeMs
    });
  }
}));

// Test scheduling script (dry-run)
router.post('/:id/test-schedule', asyncHandler(async (req, res) => {
  // Accept script, deliveryMode, eventType, and payload from request body for testing unsaved changes
  const {
    script: requestScript,
    deliveryMode: requestDeliveryMode,
    payload: requestPayload,
    eventType: requestEventType
  } = req.body || {};

  // For existing webhooks, fetch from database; for new webhooks (id='new'), skip DB fetch
  let webhook = null;
  if (req.params.id !== 'new') {
    webhook = await data.getWebhook(req.params.id);
    if (!webhook || webhook.entityRid !== req.entityParentRid) {
      return res.status(404).json({ error: 'Webhook not found', code: 'NOT_FOUND' });
    }
  }

  // Use request body values if provided, otherwise fall back to saved webhook config
  const deliveryMode = requestDeliveryMode || webhook?.deliveryMode;
  const script = requestScript || webhook?.schedulingConfig?.script;
  const eventType = requestEventType || webhook?.eventType;

  // Check if we have a valid delivery mode
  if (!deliveryMode || deliveryMode === 'IMMEDIATE') {
    return res.status(400).json({
      error: 'Webhook is not configured for scheduling',
      code: 'NOT_SCHEDULED',
      message: 'deliveryMode must be DELAYED or RECURRING to test scheduling script'
    });
  }

  // Check if we have a script
  if (!script) {
    return res.status(400).json({
      error: 'No scheduling script configured',
      code: 'MISSING_SCRIPT',
      message: 'schedulingConfig.script is required for DELAYED/RECURRING webhooks'
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
        createdAt: eventTypeSample.createdAt || new Date().toISOString()
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
        reasonForVisit: 'new consult'
      },
      patient: {
        fullName: 'Test Patient',
        phone: '9876543210',
        uhid: 'TEST_UHID_001'
      },
      appointmentDateTime: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString()
    };
    log('debug', 'Using generic appointment sample payload for scheduling test', { eventType });
  }

  try {
    const start = Date.now();

    // Execute scheduling script
    const scheduleResult = await executeSchedulingScript(
      script,
      samplePayload,
      {
        eventType: webhook?.eventType || 'TEST_EVENT',
        entityRid: webhook?.entityRid || req.entityParentRid,
        webhookConfig: webhook || { name: 'Test Webhook' }
      }
    );

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
          resultType: typeof scheduleResult
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
          isPastDue: delayMs < 0
        },
        executionTimeMs: executionTime,
        samplePayload
      });

    } else if (deliveryMode === 'RECURRING') {
      // RECURRING mode: result should be a config object
      if (typeof scheduleResult !== 'object' || scheduleResult === null) {
        return res.status(400).json({
          error: 'Invalid scheduling script result',
          code: 'INVALID_RESULT',
          message: 'RECURRING mode script must return an object with firstOccurrence, intervalMs, and maxOccurrences/endDate',
          result: scheduleResult,
          resultType: typeof scheduleResult
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
          result: scheduleResult
        });
      }

      const firstOccurrence = new Date(scheduleResult.firstOccurrence);
      const intervalHours = Math.floor(scheduleResult.intervalMs / (1000 * 60 * 60));
      const intervalMinutes = Math.floor((scheduleResult.intervalMs % (1000 * 60 * 60)) / (1000 * 60));

      // Calculate sample occurrences
      const sampleOccurrences = [];
      for (let i = 1; i <= Math.min(5, scheduleResult.maxOccurrences || 5); i++) {
        const occurrenceTime = scheduleResult.firstOccurrence + (scheduleResult.intervalMs * (i - 1));
        sampleOccurrences.push({
          occurrence: i,
          scheduledFor: new Date(occurrenceTime).toISOString()
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
          sampleOccurrences
        },
        executionTimeMs: executionTime,
        samplePayload
      });
    }

  } catch (err) {
    log('error', 'Scheduling script test failed', {
      webhookId: webhook?.id || 'new',
      error: err.message,
      stack: err.stack
    });

    return res.status(500).json({
      success: false,
      error: 'Scheduling script execution failed',
      code: 'EXECUTION_ERROR',
      message: err.message,
      deliveryMode: deliveryMode
    });
  }
}));

// Webhook signing: Rotate secret (zero-downtime)
router.post('/:id/signing/rotate', asyncHandler(async (req, res) => {
  const webhook = await data.getWebhook(req.params.id);
  if (!webhook || webhook.entityRid !== req.entityParentRid) {
    return res.status(404).json({ error: 'Webhook not found', code: 'NOT_FOUND' });
  }

  // Generate new secret
  const newSecret = generateSigningSecret();
  const currentSecrets = webhook.signingSecrets || [];

  // Add new secret to the array (keep old ones for zero-downtime rotation)
  const updatedSecrets = [newSecret, ...currentSecrets].slice(0, 3); // Max 3 secrets

  // Update webhook with new secret
  await data.updateWebhook(req.entityParentRid, req.params.id, {
    signingSecret: newSecret,          // New primary secret
    signingSecrets: updatedSecrets     // All active secrets
  });

  log('info', 'Webhook signing secret rotated', {
    webhookId: req.params.id,
    webhookName: webhook.name,
    secretCount: updatedSecrets.length
  });

  res.json({
    message: 'New signing secret generated successfully',
    newSecret,
    signingSecrets: updatedSecrets
  });
}));

// Webhook signing: Remove old secret
router.post('/:id/signing/remove', asyncHandler(async (req, res) => {
  const { secret } = req.body;

  if (!secret) {
    return res.status(400).json({ error: 'secret is required', code: 'VALIDATION_ERROR' });
  }

  const webhook = await data.getWebhook(req.params.id);
  if (!webhook || webhook.entityRid !== req.entityParentRid) {
    return res.status(404).json({ error: 'Webhook not found', code: 'NOT_FOUND' });
  }

  const currentSecrets = webhook.signingSecrets || [];

  // Cannot remove the primary secret
  if (secret === webhook.signingSecret) {
    return res.status(400).json({
      error: 'Cannot remove the primary signing secret',
      code: 'VALIDATION_ERROR'
    });
  }

  // Cannot remove if it's the only secret
  if (currentSecrets.length <= 1) {
    return res.status(400).json({
      error: 'Cannot remove the last signing secret',
      code: 'VALIDATION_ERROR'
    });
  }

  // Remove the secret from the array
  const updatedSecrets = currentSecrets.filter(s => s !== secret);

  // Update webhook
  await data.updateWebhook(req.entityParentRid, req.params.id, {
    signingSecrets: updatedSecrets
  });

  log('info', 'Webhook signing secret removed', {
    webhookId: req.params.id,
    webhookName: webhook.name,
    secretCount: updatedSecrets.length
  });

  res.json({
    message: 'Signing secret removed successfully',
    signingSecrets: updatedSecrets
  });
}));

module.exports = router;
