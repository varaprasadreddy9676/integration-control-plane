/**
 * Integrations Route Handler
 *
 * Handles INBOUND integrations - real-time API calls from the client app to external systems
 * POST /api/v1/integrations/:type?orgId=<rid>
 */

const express = require('express');
const router = express.Router();
const axios = require('axios');
const mongodb = require('../mongodb');
const data = require('../data');
const { buildAuthHeaders } = require('../processor/auth-helper');
const { applyTransform, applyResponseTransform } = require('../services/transformer');
const { maskSensitiveData } = require('../utils/mask');
const { log } = require('../logger');
const { ObjectId } = require('mongodb');
const { createExecutionLogger } = require('../utils/execution-logger');
const { checkRateLimit } = require('../middleware/rate-limiter');
const adapterRegistry = require('../services/communication/adapter-registry');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const STREAM_HEADER_BLOCKLIST = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade'
]);

const filterStreamHeaders = (headers = {}) => {
  const filtered = {};
  Object.entries(headers).forEach(([key, value]) => {
    if (!key) return;
    const lowerKey = key.toLowerCase();
    if (STREAM_HEADER_BLOCKLIST.has(lowerKey)) return;
    filtered[key] = value;
  });
  return filtered;
};

const readStreamBody = (stream, limit = 5000) => new Promise((resolve) => {
  if (!stream || typeof stream.on !== 'function') {
    resolve(null);
    return;
  }

  const chunks = [];
  let total = 0;

  stream.on('data', (chunk) => {
    if (!chunk || total >= limit) return;
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    const remaining = limit - total;
    if (buffer.length > remaining) {
      chunks.push(buffer.slice(0, remaining));
      total = limit;
    } else {
      chunks.push(buffer);
      total += buffer.length;
    }
  });

  stream.on('end', () => {
    resolve(Buffer.concat(chunks).toString('utf8'));
  });

  stream.on('error', () => resolve('[stream read error]'));
});

const computeRetryDelayMs = (attempt, baseMs = 1000, capMs = 5000) => {
  const jitter = Math.floor(Math.random() * 250);
  const delay = Math.min(baseMs * Math.pow(2, Math.max(0, attempt - 1)), capMs);
  return delay + jitter;
};

const isRetryableStatus = (status) => status === 408 || status === 429 || status >= 500;

const isRetryableError = (error) => {
  const code = error?.code;
  return code === 'ECONNABORTED' || code === 'ETIMEDOUT' || code === 'ENOTFOUND' || code === 'ECONNREFUSED';
};

const mapIntegrationConfig = (integration) => {
  if (!integration) return integration;
  const mapped = { ...integration };
  if (integration._id) {
    mapped.id = integration._id.toString();
    mapped._id = integration._id.toString();
  }
  return mapped;
};

function validateCommunicationAction(action) {
  if (!action || action.kind !== 'COMMUNICATION') {
    return null;
  }

  const cfg = action.communicationConfig || {};
  if (!cfg.channel) return 'communicationConfig.channel is required';
  if (!cfg.provider) return 'communicationConfig.provider is required';

  if (cfg.channel === 'EMAIL' && cfg.provider === 'SMTP') {
    const smtp = cfg.smtp || {};
    if (!smtp.host) return 'communicationConfig.smtp.host is required';
    if (!smtp.port || !Number.isFinite(Number(smtp.port))) {
      return 'communicationConfig.smtp.port is required and must be numeric';
    }
    const port = Number(smtp.port);
    if (port <= 0 || port > 65535) {
      return 'communicationConfig.smtp.port must be between 1 and 65535';
    }
    if (!smtp.username) return 'communicationConfig.smtp.username is required';
    if (!smtp.password) return 'communicationConfig.smtp.password is required';
    if (!smtp.fromEmail) return 'communicationConfig.smtp.fromEmail is required';
  }

  return null;
}

function validateInboundPayload(payload) {
  if (!payload?.name || !payload?.type) {
    return 'Missing required fields: name, type';
  }

  const actions = Array.isArray(payload.actions) ? payload.actions : [];
  const communicationActions = actions.filter((a) => a?.kind === 'COMMUNICATION');
  const hasCommunicationAction = communicationActions.length > 0;

  if (!hasCommunicationAction && !payload?.targetUrl) {
    return 'Missing required field: targetUrl (required for HTTP integrations)';
  }

  for (const action of communicationActions) {
    const err = validateCommunicationAction(action);
    if (err) return err;
  }

  return null;
}

function buildOrgScopeQuery(orgId) {
  return {
    $or: [
      { orgId },
      { entityRid: orgId },
      { entityParentRid: orgId }
    ]
  };
}

/**
 * CRUD Endpoints for Inbound Integration Management
 */

// GET /api/v1/inbound-integrations - List all inbound integrations
router.get('/', async (req, res) => {
  try {
    const db = await mongodb.getDbSafe();
    const integrations = await db.collection('integration_configs')
      .find({
        ...buildOrgScopeQuery(req.orgId),
        direction: 'INBOUND'
      })
      .sort({ createdAt: -1 })
      .toArray();

    res.json(integrations.map(mapIntegrationConfig));
  } catch (error) {
    log('error', 'Failed to fetch inbound integrations', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch inbound integrations'
    });
  }
});

// GET /api/v1/inbound-integrations/:id - Get single inbound integration
router.get('/:id([0-9a-fA-F]{24})', async (req, res) => {
  try {
    const { id } = req.params;

    const db = await mongodb.getDbSafe();
    const integration = await db.collection('integration_configs').findOne({
      _id: new ObjectId(id),
      ...buildOrgScopeQuery(req.orgId),
      direction: 'INBOUND'
    });

    if (!integration) {
      return res.status(404).json({
        success: false,
        error: 'Inbound integration not found'
      });
    }

    res.json(mapIntegrationConfig(integration));
  } catch (error) {
    log('error', 'Failed to fetch inbound integration', { error: error.message, id: req.params.id });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch inbound integration'
    });
  }
});

// POST /api/v1/inbound-integrations - Create inbound integration
router.post('/', async (req, res) => {
  try {
    const {
      name,
      type,
      targetUrl,
      httpMethod = 'POST',
      inboundAuthType = 'NONE',
      inboundAuthConfig = {},
      outgoingAuthType = 'NONE',
      outgoingAuthConfig = {},
      requestTransformation = { mode: 'SCRIPT', script: '' },
      responseTransformation = { mode: 'SCRIPT', script: '' },
      streamResponse = false,
      rateLimits = null,
      timeout = 10000,
      retryCount = 3,
      contentType = 'application/json',
      isActive = true,
      actions = null // NEW: Support actions array for COMMUNICATION integrations
    } = req.body;

    const validationError = validateInboundPayload(req.body);
    if (validationError) {
      return res.status(400).json({
        success: false,
        error: validationError
      });
    }

    // Check for duplicate type
    const db = await mongodb.getDbSafe();
    const existing = await db.collection('integration_configs').findOne({
      ...buildOrgScopeQuery(req.orgId),
      type: type,
      direction: 'INBOUND'
    });

    if (existing) {
      return res.status(409).json({
        success: false,
        error: `Inbound integration with type '${type}' already exists for this tenant`
      });
    }

    const integrationConfig = {
      orgId: req.orgId,
      name,
      type,
      direction: 'INBOUND',
      targetUrl,
      httpMethod,
      inboundAuthType,
      inboundAuthConfig,
      outgoingAuthType,
      outgoingAuthConfig,
      requestTransformation,
      responseTransformation,
      streamResponse: !!streamResponse,
      rateLimits,
      timeout,
      retryCount,
      contentType,
      isActive,
      actions: actions || null, // NEW: Support actions array
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: req.user?.username || 'system'
    };

    const result = await db.collection('integration_configs').insertOne(integrationConfig);

    log('info', 'Inbound integration created', {
      id: result.insertedId.toString(),
      name,
      type,
      orgId: req.orgId
    });

    res.status(201).json({
      success: true,
      id: result.insertedId.toString(),
      message: 'Inbound integration created successfully'
    });
  } catch (error) {
    log('error', 'Failed to create inbound integration', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to create inbound integration'
    });
  }
});

// PUT /api/v1/inbound-integrations/:id - Update inbound integration
router.put('/:id([0-9a-fA-F]{24})', async (req, res) => {
  try {
    const { id } = req.params;

    const validationError = validateInboundPayload(req.body);
    if (validationError) {
      return res.status(400).json({
        success: false,
        error: validationError
      });
    }

    const updateData = { ...req.body };
    delete updateData._id; // Remove _id if present
    updateData.updatedAt = new Date();

    const db = await mongodb.getDbSafe();
    const result = await db.collection('integration_configs').updateOne(
      {
        _id: new ObjectId(id),
        ...buildOrgScopeQuery(req.orgId),
        direction: 'INBOUND'
      },
      { $set: updateData }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({
        success: false,
        error: 'Inbound integration not found'
      });
    }

    log('info', 'Inbound integration updated', {
      id,
      orgId: req.orgId
    });

    res.json({
      success: true,
      message: 'Inbound integration updated successfully'
    });
  } catch (error) {
    log('error', 'Failed to update inbound integration', { error: error.message, id: req.params.id });
    res.status(500).json({
      success: false,
      error: 'Failed to update inbound integration'
    });
  }
});

// DELETE /api/v1/inbound-integrations/:id - Delete inbound integration
router.delete('/:id([0-9a-fA-F]{24})', async (req, res) => {
  try {
    const { id } = req.params;

    const db = await mongodb.getDbSafe();
    const result = await db.collection('integration_configs').deleteOne({
      _id: new ObjectId(id),
      ...buildOrgScopeQuery(req.orgId),
      direction: 'INBOUND'
    });

    if (result.deletedCount === 0) {
      return res.status(404).json({
        success: false,
        error: 'Inbound integration not found'
      });
    }

    log('info', 'Inbound integration deleted', {
      id,
      orgId: req.orgId
    });

    res.json({
      success: true,
      message: 'Inbound integration deleted successfully'
    });
  } catch (error) {
    log('error', 'Failed to delete inbound integration', { error: error.message, id: req.params.id });
    res.status(500).json({
      success: false,
      error: 'Failed to delete inbound integration'
    });
  }
});

// POST /api/v1/inbound-integrations/:id/test - Test inbound integration
router.post('/:id([0-9a-fA-F]{24})/test', async (req, res) => {
  try {
    const { id } = req.params;
    const testPayload = req.body || { test: true, timestamp: new Date().toISOString() };

    const db = await mongodb.getDbSafe();
    const integration = await db.collection('integration_configs').findOne({
      _id: new ObjectId(id),
      ...buildOrgScopeQuery(req.orgId),
      direction: 'INBOUND'
    });

    if (!integration) {
      return res.status(404).json({
        success: false,
        error: 'Inbound integration not found'
      });
    }

    // Check if this is a COMMUNICATION integration
    const isCommunication = integration.actions && integration.actions.length > 0;

    // Build request transformation
    let transformedPayload = testPayload;
    const hasTransformScript = integration.requestTransformation &&
                               integration.requestTransformation.script &&
                               integration.requestTransformation.script.trim().length > 0;

    if (hasTransformScript) {
      try {
        const result = await applyTransform(
          { transformation: integration.requestTransformation, transformationMode: 'SCRIPT' },
          testPayload,
          {
            eventType: integration.type,
            orgId: integration.orgId || req.orgId
          }
        );
        // Only use transformed result if it's not undefined/null
        if (result !== undefined && result !== null) {
          transformedPayload = result;
        }
      } catch (error) {
        return res.status(400).json({
          success: false,
          error: 'Request transformation failed',
          details: error.message
        });
      }
    }

    // Handle COMMUNICATION integrations differently
    if (isCommunication) {
      const startTime = Date.now();
      try {
        const action = integration.actions[0]; // Get first action
        const { channel, provider, smtp } = action.communicationConfig;

        // Build provider config based on provider type
        let providerConfig;
        if (provider === 'SMTP') {
          providerConfig = smtp; // Use the nested smtp config
        } else {
          providerConfig = action.communicationConfig;
        }

        log('debug', 'Test endpoint - sending email', {
          id,
          channel,
          provider,
          transformedPayload,
          hasTo: !!transformedPayload?.to,
          payloadKeys: Object.keys(transformedPayload || {})
        });

        // Send via adapter registry
        const result = await adapterRegistry.send(
          channel,
          provider,
          transformedPayload,
          providerConfig
        );

        const responseTime = Date.now() - startTime;

        return res.json({
          success: true,
          status: 200,
          responseTime: `${responseTime}ms`,
          response: result,
          message: `Test ${channel} sent successfully via ${provider}`,
          messageId: result.messageId
        });
      } catch (error) {
        const responseTime = Date.now() - startTime;
        return res.status(500).json({
          success: false,
          error: 'Communication send failed',
          details: error.message,
          responseTime: `${responseTime}ms`
        });
      }
    }

    // Handle HTTP integrations (existing logic)
    // Build auth headers
    let authHeaders = {};
    try {
      authHeaders = await buildAuthHeaders(
        integration,
        integration.httpMethod || 'POST',
        integration.targetUrl
      );
    } catch (error) {
      return res.status(400).json({
        success: false,
        error: 'Authentication failed',
        details: error.message
      });
    }

    // Call external API
    const startTime = Date.now();
    try {
      const response = await axios({
        method: integration.httpMethod || 'POST',
        url: integration.targetUrl,
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        data: transformedPayload,
        timeout: integration.timeout || 10000,
        validateStatus: null
      });

      const responseTime = Date.now() - startTime;

      // Apply response transformation if configured
      let transformedResponse = response.data;
      if (integration.responseTransformation && integration.responseTransformation.script) {
        try {
          transformedResponse = await applyResponseTransform(
            { responseTransformation: integration.responseTransformation },
            { data: response.data, status: response.status, headers: response.headers },
            { orgId: integration.orgId || req.orgId }
          );
        } catch (error) {
          return res.status(400).json({
            success: false,
            error: 'Response transformation failed',
            details: error.message
          });
        }
      }

      res.json({
        success: response.status < 400,
        status: response.status,
        responseTime: `${responseTime}ms`,
        response: transformedResponse,
        message: 'Test request sent successfully (with transformations applied)'
      });
    } catch (error) {
      const responseTime = Date.now() - startTime;
      res.status(500).json({
        success: false,
        error: 'Test request failed',
        details: error.message,
        responseTime: `${responseTime}ms`
      });
    }
  } catch (error) {
    log('error', 'Failed to test inbound integration', { error: error.message, id: req.params.id });
    res.status(500).json({
      success: false,
      error: 'Failed to test inbound integration'
    });
  }
});

// POST /api/v1/inbound-integrations/:id/refresh-token - Manually refresh cached OAuth/Custom token
router.post('/:id([0-9a-fA-F]{24})/refresh-token', async (req, res) => {
  try {
    const { id } = req.params;
    const { clearCachedToken } = require('../processor/auth-helper');

  const db = await mongodb.getDbSafe();
  const integration = await db.collection('integration_configs').findOne({
    _id: new ObjectId(id),
    ...buildOrgScopeQuery(req.orgId)
  });

    if (!integration) {
      return res.status(404).json({
        success: false,
        error: 'Integration not found'
      });
    }

    // Check if integration uses OAuth2 or Custom auth
    if (integration.outgoingAuthType !== 'OAUTH2' && integration.outgoingAuthType !== 'CUSTOM') {
      return res.status(400).json({
        success: false,
        error: 'Token refresh only supported for OAUTH2 and CUSTOM auth types',
        authType: integration.outgoingAuthType
      });
    }

    // Clear the cached token
    await clearCachedToken(new ObjectId(id));

    log('info', 'Manually refreshed integration token', {
      integrationId: id,
      authType: integration.outgoingAuthType,
      requestedBy: req.user?.email
    });

    res.json({
      success: true,
      message: 'Token cache cleared. Next API call will fetch a fresh token.',
      authType: integration.outgoingAuthType
    });
  } catch (error) {
    log('error', 'Failed to refresh token', {
      integrationId: req.params.id,
      error: error.message,
      stack: error.stack
    });
    res.status(500).json({
      success: false,
      error: 'Failed to refresh token',
      details: error.message
    });
  }
});

/**
 * Generic inbound integration endpoint (Runtime Proxy)
 * POST/GET /api/v1/integrations/:type?orgId=<rid>
 */
const handleInboundRuntime = async (req, res) => {
  const { type } = req.params;
  const { orgId, ...queryParams } = req.query;
  const requestBody = req.body || {};
  const correlationId = req.id; // From request-id middleware
  const resolvedOrgId = Number(orgId || req.orgId);
  let executionLogger = null;

  log('info', 'Inbound integration request received', {
    type,
    orgId,
    correlationId
  });

  try {
    if (!Number.isFinite(resolvedOrgId) || resolvedOrgId <= 0) {
      return res.status(400).json({
        error: 'INVALID_TENANT',
        message: 'Missing or invalid orgId'
      });
    }

    // 1. Find integration config
    const db = await mongodb.getDbSafe();
    const config = await db.collection('integration_configs').findOne(Object.assign({
      type: type,
      direction: 'INBOUND',
      isActive: true
    }, buildOrgScopeQuery(resolvedOrgId)));

    if (!config) {
      log('warn', 'Integration not found', {
        type,
        orgId,
        correlationId
      });

      return res.status(404).json({
        error: 'INTEGRATION_NOT_FOUND',
        message: `No active integration found for type '${type}' and orgId ${orgId}`
      });
    }

    log('debug', 'Integration config found', {
      configId: config._id.toString(),
      name: config.name,
      targetUrl: config.targetUrl
    });

    executionLogger = createExecutionLogger({
      traceId: correlationId,
      direction: 'INBOUND',
      triggerType: 'MANUAL',
      integrationConfigId: config._id,
      integrationName: config.name,
      orgId: resolvedOrgId,
      messageId: correlationId || null,
      request: {
        url: req.originalUrl,
        method: req.method,
        headers: req.headers || {},
        body: requestBody || {}
      }
    });

    await executionLogger.start().catch(err => {
      log('warn', 'Failed to start execution logger', { error: err.message, correlationId });
    });

    // 2. Validate inbound authentication (if configured)
    if (config.inboundAuthType && config.inboundAuthType !== 'NONE') {
      const isAuthorized = validateInboundAuth(config, req.headers);
      if (!isAuthorized) {
        await executionLogger.addStep('inbound_auth', {
          status: 'failed',
          durationMs: 0,
          error: { message: 'Authentication failed' }
        }).catch(() => {});

        await logIntegration(config, 'FAILED', {
          request: { body: requestBody, query: queryParams, headers: maskSensitiveData(req.headers) },
          response: { status: 401 },
          error: {
            error: 'AUTHENTICATION_FAILED',
            message: 'Invalid or missing authentication credentials'
          },
          correlationId
        });

        const authError = new Error('Authentication failed');
        authError.code = 'AUTHENTICATION_FAILED';
        await executionLogger.fail(authError, {
          createDLQ: false,
          statusCode: 401
        }).catch(() => {});

        log('warn', 'Inbound authentication failed', {
          type,
          orgId,
          authType: config.inboundAuthType,
          correlationId
        });

        return res.status(401).json({
          error: 'AUTHENTICATION_FAILED',
          message: 'Invalid or missing authentication credentials for this integration'
        });
      }

      await executionLogger.addStep('inbound_auth', {
        status: 'success',
        durationMs: 0,
        metadata: { authType: config.inboundAuthType }
      }).catch(() => {});

      log('debug', 'Inbound authentication successful', {
        correlationId,
        authType: config.inboundAuthType
      });
    }

    // 2.5 Rate limit check (if configured) - MUST run before COMMUNICATION branch
    if (config.rateLimits && config.rateLimits.enabled) {
      const rateStart = Date.now();
      try {
        const rateResult = await checkRateLimit(config._id.toString(), resolvedOrgId, config.rateLimits);
        const durationMs = Date.now() - rateStart;
        const maxRequests = config.rateLimits.maxRequests || 100;
        const windowSeconds = config.rateLimits.windowSeconds || 60;

        res.set({
          'X-RateLimit-Limit': maxRequests,
          'X-RateLimit-Remaining': rateResult.remaining,
          'X-RateLimit-Reset': rateResult.resetAt ? Math.floor(rateResult.resetAt.getTime() / 1000) : ''
        });

        if (!rateResult.allowed) {
          await executionLogger.addStep('rate_limit', {
            status: 'failed',
            durationMs,
            metadata: {
              remaining: rateResult.remaining,
              resetAt: rateResult.resetAt,
              maxRequests,
              windowSeconds
            },
            error: { message: 'Rate limit exceeded' }
          }).catch(() => {});

          if (rateResult.retryAfter) {
            res.set('Retry-After', rateResult.retryAfter);
          }

          await logIntegration(config, 'FAILED', {
            request: { body: requestBody, query: queryParams, headers: maskSensitiveData(req.headers) },
            response: { status: 429 },
            error: {
              error: 'RATE_LIMIT_EXCEEDED',
              message: 'Rate limit exceeded',
              retryAfter: rateResult.retryAfter
            },
            correlationId
          });

          const rateError = new Error('Rate limit exceeded');
          rateError.code = 'RATE_LIMIT_EXCEEDED';
          await executionLogger.fail(rateError, {
            createDLQ: false,
            statusCode: 429
          }).catch(() => {});

          return res.status(429).json({
            error: 'RATE_LIMIT_EXCEEDED',
            message: 'Too many requests for this integration. Please try again later.',
            retryAfter: rateResult.retryAfter,
            resetAt: rateResult.resetAt
          });
        }

        await executionLogger.addStep('rate_limit', {
          status: 'success',
          durationMs,
          metadata: {
            remaining: rateResult.remaining,
            resetAt: rateResult.resetAt,
            maxRequests,
            windowSeconds
          }
        }).catch(() => {});
      } catch (error) {
        log('warn', 'Rate limit check failed', { error: error.message, correlationId });
      }
    }

    // 2.75 Check if this integration has COMMUNICATION actions (async delivery)
    const hasCommunicationAction = config.actions && Array.isArray(config.actions) && config.actions.some(a => a.kind === 'COMMUNICATION');

    if (hasCommunicationAction) {
      log('info', 'INBOUND COMMUNICATION integration - creating async job', {
        type,
        orgId,
        correlationId
      });

      // Transform request payload
      const basePayload = req.method === 'GET' ? queryParams : requestBody;
      let transformedRequest = basePayload;
      const transformStart = Date.now();

      try {
        if (config.requestTransformation && config.requestTransformation.script) {
          const requestContext = {
            body: requestBody,
            query: queryParams,
            headers: req.headers
          };

          transformedRequest = await applyTransform(
            { transformation: config.requestTransformation, transformationMode: 'SCRIPT' },
            basePayload,
            {
              eventType: type,
              orgId: resolvedOrgId,
              ...requestContext
            }
          );

          await executionLogger.addStep('request_transformation', {
            status: 'success',
            durationMs: Date.now() - transformStart
          }).catch(() => {});
        }
      } catch (error) {
        log('error', 'Request transformation failed', {
          correlationId,
          error: error.message
        });

        await executionLogger.addStep('request_transformation', {
          status: 'failed',
          durationMs: Date.now() - transformStart,
          error: { message: error.message }
        }).catch(() => {});

        const transformError = new Error(`Request transformation failed: ${error.message}`);
        transformError.code = 'TRANSFORMATION_ERROR';
        await executionLogger.fail(transformError, {
          createDLQ: false,
          statusCode: 500
        }).catch(() => {});

        return res.status(500).json({
          error: 'TRANSFORMATION_ERROR',
          message: `Request transformation failed: ${error.message}`
        });
      }

      // Create pending delivery job for worker
      try {
        const db = await mongodb.getDbSafe();
        const pendingDelivery = {
          integrationConfigId: config._id,
          orgId: resolvedOrgId,
          eventType: type,
          direction: 'COMMUNICATION',  // Use COMMUNICATION direction for filtering
          triggerType: 'MANUAL',
          payload: transformedRequest,
          originalPayload: basePayload,
          traceId: correlationId,
          createdAt: new Date(),
          status: 'PENDING',
          retryCount: 0,
          maxRetries: config.retryCount || 3
        };

        const result = await db.collection('pending_deliveries').insertOne(pendingDelivery);

        await executionLogger.addStep('job_creation', {
          status: 'success',
          durationMs: 0,
          metadata: {
            jobId: result.insertedId.toString(),
            traceId: correlationId
          }
        }).catch(() => {});

        await executionLogger.updateStatus('queued').catch(() => {});

        log('info', 'INBOUND COMMUNICATION job created', {
          jobId: result.insertedId.toString(),
          traceId: correlationId,
          type,
          orgId
        });

        return res.status(202).json({
          success: true,
          status: 'queued',
          traceId: correlationId,
          jobId: result.insertedId.toString(),
          message: 'Communication job created successfully. Check execution logs for status.'
        });
      } catch (error) {
        log('error', 'Failed to create COMMUNICATION job', {
          correlationId,
          error: error.message
        });

        const jobError = new Error(`Failed to create job: ${error.message}`);
        jobError.code = 'JOB_CREATION_ERROR';
        await executionLogger.fail(jobError, {
          createDLQ: false,
          statusCode: 500
        }).catch(() => {});

        return res.status(500).json({
          error: 'JOB_CREATION_ERROR',
          message: `Failed to create communication job: ${error.message}`
        });
      }
    }

    // 3. Transform request (client app → External API) - for HTTP integrations only
    // SCRIPT transforms: body is payload for POST/PUT/PATCH, query is payload for GET
    const requestContext = {
      body: requestBody,
      query: queryParams,
      headers: req.headers
    };

    const basePayload = req.method === 'GET' ? queryParams : requestBody;
    let transformedRequest = basePayload;
    const transformStart = Date.now();
    try {
      if (config.requestTransformation && config.requestTransformation.script) {
        transformedRequest = await applyTransform(
          { transformation: config.requestTransformation, transformationMode: 'SCRIPT' },
          basePayload,  // Transform body for non-GET, query for GET
          {
            eventType: type,
            orgId: resolvedOrgId,
            ...requestContext  // SCRIPT transforms can access query/headers via context
          }
        );

        log('debug', 'Request transformation successful', {
          correlationId,
          hasTransformation: true,
          mode: 'SCRIPT'
        });

        await executionLogger.addStep('request_transformation', {
          status: 'success',
          durationMs: Date.now() - transformStart
        }).catch(() => {});
      }
    } catch (error) {
      log('error', 'Request transformation failed', {
        correlationId,
        error: error.message
      });

      await executionLogger.addStep('request_transformation', {
        status: 'failed',
        durationMs: Date.now() - transformStart,
        error: { message: error.message }
      }).catch(() => {});

      await logIntegration(config, 'FAILED', {
        request: { body: requestBody, query: queryParams, headers: maskSensitiveData(outboundHeaders || req.headers), transformed: transformedRequest },
        response: { status: 500 },
        error: {
          error: 'TRANSFORMATION_ERROR',
          message: error.message
        },
        correlationId
      });

      const transformError = new Error(`Request transformation failed: ${error.message}`);
      transformError.code = 'TRANSFORMATION_ERROR';
      await executionLogger.fail(transformError, {
        createDLQ: false,
        statusCode: 500
      }).catch(() => {});

      return res.status(500).json({
        error: 'TRANSFORMATION_ERROR',
        message: `Request transformation failed: ${error.message}`,
        details: {
          script: 'requestTransformation',
          error: error.message
        }
      });
    }

    // 4. Build auth headers for external API
    let authHeaders;
    let outboundHeaders;
    try {
      authHeaders = await buildAuthHeaders(
        config,
        config.httpMethod || 'POST',
        config.targetUrl
      );
      outboundHeaders = {
        ...authHeaders,
        'Content-Type': 'application/json'
      };

      log('debug', 'Auth headers built', {
        correlationId,
        authType: config.outgoingAuthType
      });

      await executionLogger.addStep('outbound_auth', {
        status: 'success',
        durationMs: 0,
        metadata: { authType: config.outgoingAuthType }
      }).catch(() => {});
    } catch (error) {
      log('error', 'Failed to build auth headers', {
        correlationId,
        error: error.message
      });

      await executionLogger.addStep('outbound_auth', {
        status: 'failed',
        durationMs: 0,
        error: { message: error.message }
      }).catch(() => {});

      await logIntegration(config, 'FAILED', {
        request: { body: requestBody, query: queryParams, headers: maskSensitiveData(outboundHeaders || req.headers), transformed: transformedRequest },
        response: { status: 500 },
        error: {
          error: 'AUTHENTICATION_ERROR',
          message: error.message
        },
        correlationId
      });

      const authError = new Error(`Failed to build authentication: ${error.message}`);
      authError.code = 'AUTHENTICATION_ERROR';
      await executionLogger.fail(authError, {
        createDLQ: false,
        statusCode: 500
      }).catch(() => {});

      return res.status(500).json({
        error: 'AUTHENTICATION_ERROR',
        message: `Failed to build authentication: ${error.message}`
      });
    }

    // 5. Call external API (with retry support)
    const startTime = Date.now();
    let upstreamResponse;
    let lastError = null;
    let attemptsUsed = 0;
    const maxAttempts = Math.max(1, Number(config.retryCount || 1));

    // Check if streaming is enabled
    const isStreamingEnabled = config.streamResponse === true;

    // If streaming is enabled and response transformation is configured, log a warning
    if (isStreamingEnabled && config.responseTransformation && config.responseTransformation.script) {
      log('warn', 'Streaming enabled with response transformation configured - transformation will be skipped', {
        correlationId,
        configId: config._id.toString()
      });
    }

    // === STREAMING PATH: Direct pipe to client ===
    if (isStreamingEnabled) {
      try {
        log('info', 'Starting streaming response', {
          correlationId,
          method: config.httpMethod || 'POST',
          url: config.targetUrl
        });

        const httpStart = Date.now();

        // Make streaming request
        const streamResponse = await axios({
          method: config.httpMethod || 'POST',
          url: config.targetUrl,
          headers: { ...authHeaders, 'Content-Type': 'application/json' },
          params: config.httpMethod === 'GET' ? transformedRequest : undefined,
          data: config.httpMethod !== 'GET' ? transformedRequest : undefined,
          timeout: config.timeoutMs || 30000,
          responseType: 'stream', // Enable streaming
          validateStatus: null
        });

        const httpDuration = Date.now() - httpStart;

        await executionLogger.addStep('http_request', {
          status: streamResponse.status < 400 ? 'success' : 'failed',
          durationMs: httpDuration,
          metadata: {
            statusCode: streamResponse.status,
            method: config.httpMethod || 'POST',
            url: config.targetUrl,
            streaming: true
          }
        }).catch(() => {});

        // Check for upstream errors
        if (streamResponse.status >= 400) {
          // For errors, we need to read the stream body for logging
          const errorBody = await readStreamBody(streamResponse.data, 5000);

          await logIntegration(config, 'FAILED', {
            request: { body: requestBody, query: queryParams, headers: maskSensitiveData(outboundHeaders || req.headers), transformed: transformedRequest },
            upstream: {
              url: config.targetUrl,
              method: config.httpMethod || 'POST',
              status: streamResponse.status,
              responseTime: httpDuration,
              response: errorBody
            },
            error: {
              error: 'UPSTREAM_ERROR',
              message: 'External API returned error'
            },
            correlationId
          });

          const upstreamError = new Error('External API returned error');
          upstreamError.code = 'UPSTREAM_ERROR';
          upstreamError.statusCode = streamResponse.status;
          await executionLogger.fail(upstreamError, {
            createDLQ: false,
            statusCode: streamResponse.status
          }).catch(() => {});

          return res.status(502).json({
            error: 'UPSTREAM_ERROR',
            message: 'External API returned error',
            details: {
              upstream: {
                status: streamResponse.status,
                body: errorBody
              }
            }
          });
        }

        // Stream successful response directly to client
        res.status(streamResponse.status);
        res.set(filterStreamHeaders(streamResponse.headers));

        // Pipe the stream
        streamResponse.data.pipe(res);

        // Handle stream completion
        streamResponse.data.on('end', async () => {
          const responseTime = Date.now() - startTime;

          log('info', 'Streaming response completed', {
            correlationId,
            status: streamResponse.status,
            responseTime
          });

          await executionLogger.addStep('response_streaming', {
            status: 'success',
            durationMs: responseTime,
            metadata: { streamed: true }
          }).catch(() => {});

          await logIntegration(config, 'SUCCESS', {
            request: {
              body: maskSensitiveData(requestBody),
              query: queryParams,
              headers: maskSensitiveData(outboundHeaders || req.headers),
              transformed: maskSensitiveData(transformedRequest)
            },
            upstream: {
              url: config.targetUrl,
              method: config.httpMethod || 'POST',
              status: streamResponse.status,
              responseTime,
              response: '[STREAMED - not logged]'
            },
            response: {
              status: streamResponse.status,
              body: '[STREAMED - not logged]'
            },
            correlationId
          });

          await executionLogger.success({
            response: {
              statusCode: streamResponse.status,
              headers: filterStreamHeaders(streamResponse.headers),
              body: '[STREAMED]'
            }
          }).catch(() => {});
        });

        // Handle stream errors
        streamResponse.data.on('error', async (error) => {
          log('error', 'Streaming error', {
            correlationId,
            error: error.message
          });

          await executionLogger.addStep('response_streaming', {
            status: 'failed',
            durationMs: Date.now() - startTime,
            error: { message: error.message }
          }).catch(() => {});

          await logIntegration(config, 'FAILED', {
            request: { body: requestBody, query: queryParams, headers: maskSensitiveData(outboundHeaders || req.headers), transformed: transformedRequest },
            upstream: {
              url: config.targetUrl,
              method: config.httpMethod || 'POST',
              status: streamResponse.status,
              responseTime: Date.now() - startTime
            },
            error: {
              error: 'STREAMING_ERROR',
              message: error.message
            },
            correlationId
          });

          const streamError = new Error(`Streaming failed: ${error.message}`);
          streamError.code = 'STREAMING_ERROR';
          await executionLogger.fail(streamError, {
            createDLQ: false,
            statusCode: 500
          }).catch(() => {});

          if (!res.headersSent) {
            res.status(500).json({
              error: 'STREAMING_ERROR',
              message: `Failed to stream response: ${error.message}`
            });
          }
        });

        // Exit early - streaming is handled asynchronously
        return;

      } catch (error) {
        log('error', 'Failed to initiate streaming', {
          correlationId,
          error: error.message
        });

        await executionLogger.addStep('http_request', {
          status: 'failed',
          durationMs: Date.now() - startTime,
          error: { message: error.message, code: error.code }
        }).catch(() => {});

        await logIntegration(config, 'FAILED', {
          request: { body: requestBody, query: queryParams, headers: maskSensitiveData(outboundHeaders || req.headers), transformed: transformedRequest },
          error: {
            error: 'STREAMING_SETUP_ERROR',
            message: error.message
          },
          correlationId
        });

        const setupError = new Error(`Failed to setup streaming: ${error.message}`);
        setupError.code = 'STREAMING_SETUP_ERROR';
        await executionLogger.fail(setupError, {
          createDLQ: false,
          statusCode: 500
        }).catch(() => {});

        return res.status(500).json({
          error: 'STREAMING_SETUP_ERROR',
          message: `Failed to setup streaming: ${error.message}`
        });
      }
    }

    // === BUFFERED PATH: Original behavior with transformations ===
    try {

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const httpStart = Date.now();
      attemptsUsed = attempt;
      try {
        log('debug', 'Calling external API', {
          correlationId,
          method: config.httpMethod || 'POST',
          url: config.targetUrl,
          timeout: config.timeoutMs || 30000,
          attempt,
          maxAttempts
        });

        upstreamResponse = await axios({
          method: config.httpMethod || 'POST',
          url: config.targetUrl,
          headers: { ...authHeaders, 'Content-Type': 'application/json' },
          params: config.httpMethod === 'GET' ? transformedRequest : undefined,
          data: config.httpMethod !== 'GET' ? transformedRequest : undefined,
          timeout: config.timeoutMs || 30000,
          validateStatus: null // Don't throw on non-2xx status
        });

        const responseTime = Date.now() - startTime;
        const httpDuration = Date.now() - httpStart;

        log('info', 'External API responded', {
          correlationId,
          status: upstreamResponse.status,
          responseTime,
          attempt,
          maxAttempts
        });

        await executionLogger.addStep('http_request', {
          status: upstreamResponse.status < 400 ? 'success' : 'failed',
          durationMs: httpDuration,
          metadata: {
            statusCode: upstreamResponse.status,
            method: config.httpMethod || 'POST',
            url: config.targetUrl,
            attempt,
            maxAttempts
          },
          error: upstreamResponse.status < 400 ? null : { message: `HTTP ${upstreamResponse.status}` }
        }).catch(() => {});

        if (upstreamResponse.status >= 400 && isRetryableStatus(upstreamResponse.status) && attempt < maxAttempts) {
          const delayMs = computeRetryDelayMs(attempt);
          log('warn', 'Retrying inbound integration call', {
            correlationId,
            status: upstreamResponse.status,
            attempt,
            maxAttempts,
            delayMs
          });
          await sleep(delayMs);
          continue;
        }

        break;
      } catch (error) {
        lastError = error;

        await executionLogger.addStep('http_request', {
          status: 'failed',
          durationMs: Date.now() - httpStart,
          metadata: {
            method: config.httpMethod || 'POST',
            url: config.targetUrl,
            attempt,
            maxAttempts
          },
          error: { message: error.message, code: error.code }
        }).catch(() => {});

        if (isRetryableError(error) && attempt < maxAttempts) {
          const delayMs = computeRetryDelayMs(attempt);
          log('warn', 'Retrying inbound integration call after error', {
            correlationId,
            code: error.code,
            attempt,
            maxAttempts,
            delayMs
          });
          await sleep(delayMs);
          continue;
        }

        throw error;
      }
    }

    if (!upstreamResponse && lastError) {
      throw lastError;
    }

    const responseTime = Date.now() - startTime;

    // 6. Check for upstream errors
    if (upstreamResponse.status >= 400) {
      const error = {
        error: 'UPSTREAM_ERROR',
        message: 'External API returned error',
        details: {
          upstream: {
            status: upstreamResponse.status,
            body: upstreamResponse.data
          }
        }
      };

      // Log failure
      await logIntegration(config, 'FAILED', {
        request: { body: requestBody, query: queryParams, headers: maskSensitiveData(outboundHeaders || req.headers), transformed: transformedRequest },
        upstream: {
          url: config.targetUrl,
          method: config.httpMethod || 'POST',
          status: upstreamResponse.status,
          responseTime,
          response: maskSensitiveData(upstreamResponse.data)
        },
        attempts: attemptsUsed,
        error: error,
        correlationId
      });

      const upstreamError = new Error('External API returned error');
      upstreamError.code = 'UPSTREAM_ERROR';
      upstreamError.statusCode = upstreamResponse.status;
      await executionLogger.fail(upstreamError, {
        createDLQ: false,
        statusCode: upstreamResponse.status,
        response: {
          statusCode: upstreamResponse.status,
          body: maskSensitiveData(upstreamResponse.data)
        }
      }).catch(() => {});

      return res.status(502).json(error);
    }

    // 7. Transform response (External API → client app)
    // Pass full response context for transformations to access data, status, headers
    const responseContext = {
      data: upstreamResponse.data,
      status: upstreamResponse.status,
      headers: upstreamResponse.headers
    };

    let transformedResponse = upstreamResponse.data;
    try {
      if (config.responseTransformation) {
        transformedResponse = await applyResponseTransform(
          config,
          responseContext,
          {
            orgId: resolvedOrgId
          }
        );

        log('debug', 'Response transformation successful', {
          correlationId,
          hasTransformation: !!config.responseTransformation,
          mode: config.responseTransformation.mode
        });

        await executionLogger.addStep('response_transformation', {
          status: 'success',
          durationMs: 0
        }).catch(() => {});
      }
    } catch (error) {
      log('error', 'Response transformation failed', {
        correlationId,
        error: error.message
      });

      await executionLogger.addStep('response_transformation', {
        status: 'failed',
        durationMs: 0,
        error: { message: error.message }
      }).catch(() => {});

      // Log failure
      await logIntegration(config, 'FAILED', {
        request: { body: requestBody, query: queryParams, headers: maskSensitiveData(outboundHeaders || req.headers), transformed: transformedRequest },
        upstream: {
          url: config.targetUrl,
          method: config.httpMethod || 'POST',
          status: upstreamResponse.status,
          responseTime,
          response: maskSensitiveData(upstreamResponse.data)
        },
        error: {
          error: 'TRANSFORMATION_ERROR',
          message: error.message
        },
        correlationId
      });

      const transformError = new Error(`Response transformation failed: ${error.message}`);
      transformError.code = 'TRANSFORMATION_ERROR';
      await executionLogger.fail(transformError, {
        createDLQ: false,
        statusCode: 500,
        response: {
          statusCode: upstreamResponse.status,
          body: maskSensitiveData(upstreamResponse.data)
        }
      }).catch(() => {});

      return res.status(500).json({
        error: 'TRANSFORMATION_ERROR',
        message: `Response transformation failed: ${error.message}`,
        details: {
          script: 'responseTransformation',
          error: error.message
        }
      });
    }

    // 8. Log success
    await logIntegration(config, 'SUCCESS', {
      request: {
        body: maskSensitiveData(requestBody),
        query: queryParams,
        headers: maskSensitiveData(outboundHeaders || req.headers),
        transformed: maskSensitiveData(transformedRequest)
      },
      upstream: {
        url: config.targetUrl,
        method: config.httpMethod || 'POST',
        status: upstreamResponse.status,
        responseTime,
        response: maskSensitiveData(upstreamResponse.data)
      },
      attempts: attemptsUsed,
      response: {
        status: 200,
        body: maskSensitiveData(transformedResponse)
      },
      correlationId
    });

    log('info', 'Inbound integration completed successfully', {
      correlationId,
      type,
      orgId: config.orgId || resolvedOrgId,
      responseTime
    });

    await executionLogger.success({
      response: {
        statusCode: upstreamResponse.status,
        headers: upstreamResponse.headers,
        body: maskSensitiveData(transformedResponse)
      }
    }).catch(() => {});

    // 9. Return to the client app
    res.json(transformedResponse);

    } catch (error) {
      const responseTime = Date.now() - startTime;

      // Handle timeout errors
      if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
        log('error', 'External API timeout', {
          correlationId,
          timeout: config.timeoutMs || 30000,
          responseTime
        });

        await logIntegration(config, 'TIMEOUT', {
          request: { body: requestBody, query: queryParams, headers: maskSensitiveData(outboundHeaders || req.headers), transformed: transformedRequest },
          response: { status: 504 },
          upstream: {
            url: config.targetUrl,
            method: config.httpMethod || 'POST',
            responseTime
          },
          error: {
            error: 'UPSTREAM_TIMEOUT',
            message: 'External API did not respond in time'
          },
          correlationId
        });

        const timeoutError = new Error('External API did not respond in time');
        timeoutError.code = 'UPSTREAM_TIMEOUT';
        await executionLogger.fail(timeoutError, {
          createDLQ: false,
          statusCode: 504
        }).catch(() => {});

        return res.status(504).json({
          error: 'UPSTREAM_TIMEOUT',
          message: 'External API did not respond in time',
          details: {
            timeout: config.timeoutMs || 30000
          }
        });
      }

      // Handle network errors
      if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
        log('error', 'External API connection failed', {
          correlationId,
          error: error.message,
          code: error.code
        });

        await logIntegration(config, 'FAILED', {
          request: { body: requestBody, query: queryParams, headers: maskSensitiveData(outboundHeaders || req.headers), transformed: transformedRequest },
          response: { status: 502 },
          upstream: {
            url: config.targetUrl,
            method: config.httpMethod || 'POST',
            responseTime
          },
          error: {
            error: 'UPSTREAM_ERROR',
            message: error.message
          },
          correlationId
        });

        const upstreamError = new Error(error.message);
        upstreamError.code = 'UPSTREAM_ERROR';
        await executionLogger.fail(upstreamError, {
          createDLQ: false,
          statusCode: 502
        }).catch(() => {});

        return res.status(502).json({
          error: 'UPSTREAM_ERROR',
          message: `Failed to connect to external API: ${error.message}`
        });
      }

      // Generic error
      throw error;
    }

  } catch (error) {
    log('error', 'Inbound integration failed', {
      correlationId,
      type,
      orgId,
      error: error.message,
      stack: error.stack
    });

    if (executionLogger) {
      const internalError = new Error(error.message || 'Internal server error');
      internalError.code = 'INTERNAL_ERROR';
      await executionLogger.fail(internalError, {
        createDLQ: false,
        statusCode: 500
      }).catch(() => {});
    }

    // Generic error
    res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: error.message || 'Internal server error'
    });
  }
};

router.post('/:type', handleInboundRuntime);
router.get('/:type', handleInboundRuntime);

/**
 * Validate inbound authentication
 * Checks if the request has valid credentials based on integration's inboundAuthType
 */
function validateInboundAuth(integration, headers) {
  if (!integration.inboundAuthType || integration.inboundAuthType === 'NONE') {
    return true; // No auth required
  }

  const authConfig = integration.inboundAuthConfig || {};

  switch (integration.inboundAuthType) {
    case 'API_KEY': {
      const headerName = authConfig.headerName || 'x-api-key';
      const expectedKey = authConfig.value || authConfig.key;
      const providedKey = headers[headerName.toLowerCase()];
      return providedKey && providedKey === expectedKey;
    }

    case 'BEARER': {
      const expectedToken = authConfig.token || authConfig.value;
      const providedAuth = headers.authorization || headers.Authorization;
      return (
        providedAuth &&
        providedAuth.startsWith('Bearer ') &&
        providedAuth.substring(7) === expectedToken
      );
    }

    case 'BASIC': {
      const expectedUsername = authConfig.username;
      const expectedPassword = authConfig.password;
      const providedAuth = headers.authorization || headers.Authorization;

      if (!providedAuth || !providedAuth.startsWith('Basic ')) {
        return false;
      }

      try {
        const credentials = Buffer.from(
          providedAuth.substring(6),
          'base64'
        ).toString('utf-8');
        const [username, password] = credentials.split(':');
        return username === expectedUsername && password === expectedPassword;
      } catch (error) {
        log('error', 'Failed to decode Basic auth', { error: error.message });
        return false;
      }
    }

    default:
      log('warn', 'Unknown inbound auth type', {
        authType: integration.inboundAuthType
      });
      return false;
  }
}

/**
 * Log integration request/response
 */
async function logIntegration(config, status, details) {
  try {
    const requestBody = maskSensitiveData(details?.request?.body || {});
    const transformedBody = maskSensitiveData(details?.request?.transformed || requestBody);
    const responseBody = details?.upstream?.response ?? details?.response?.body ?? null;
    const errorMessage = details?.error?.message || details?.error?.error || null;

    let responseBodyText = responseBody;
    if (responseBody && typeof responseBody !== 'string') {
      responseBodyText = JSON.stringify(maskSensitiveData(responseBody), null, 2);
    }
    if (typeof responseBodyText === 'string' && responseBodyText.length > 5000) {
      responseBodyText = responseBodyText.slice(0, 5000);
    }

    const normalizedStatus = status === 'TIMEOUT' ? 'FAILED' : status;
    const responseStatus = details?.upstream?.status
      || details?.response?.status
      || (status === 'TIMEOUT' ? 504 : null);

    await data.recordLog(config.orgId, {
      __KEEP___KEEP_integrationConfig__Id__: config._id,
      __KEEP_integrationName__: config.name,
      eventType: config.type,
      integrationType: config.type,
      direction: 'INBOUND',
      triggerType: 'MANUAL',
      status: normalizedStatus,
      responseStatus,
      responseTimeMs: details?.upstream?.responseTime || details?.response?.responseTime || null,
      attemptCount: Number(details?.attempts || 1),
      originalPayload: requestBody,
      requestPayload: transformedBody,
      responseBody: responseBodyText || null,
      errorMessage,
      targetUrl: config.targetUrl,
      httpMethod: config.httpMethod || 'POST',
      correlationId: details?.correlationId || null,
      traceId: details?.correlationId || null,
      requestHeaders: details?.request?.headers || null,
      shouldRetry: false
    });
  } catch (error) {
    log('error', 'Failed to log integration', {
      error: error.message,
      configId: config._id.toString()
    });
  }
}

module.exports = router;
