/**
 * AI Assistant API Routes
 */

const express = require('express');
const router = express.Router();
const aiService = require('../services/ai');
const interactionLogger = require('../services/ai/interaction-logger');
const asyncHandler = require('../utils/async-handler');
const { requireFeature } = require('../middleware/feature-permission');
const { FEATURES } = require('../rbac/features');
const config = require('../config');
const { validateTargetUrl } = require('../utils/url-check');
const { validateScript } = require('../services/transformer');
const { ObjectId } = require('mongodb');
const { getOrgIdFromRequest } = require('../utils/org-context');

const ALLOWED_CONFIG_PATCH_KEYS = new Set([
  'targetUrl',
  'httpMethod',
  'outgoingAuthType',
  'outgoingAuthConfig',
  'inboundAuthType',
  'inboundAuthConfig',
  'timeoutMs',
  'retryCount',
  'timeout',
  'contentType',
  'streamResponse',
  'rateLimits',
]);

function toObjectIdOrNull(value) {
  try {
    if (!value) return null;
    if (value instanceof ObjectId) return value;
    return new ObjectId(value);
  } catch (_) {
    return null;
  }
}

function getValueByPath(obj, path) {
  if (!obj || !path) return undefined;
  return path.split('.').reduce((acc, key) => (acc === undefined || acc === null ? undefined : acc[key]), obj);
}

function _setValueByPath(target, path, value) {
  const parts = path.split('.');
  let ref = target;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!ref[parts[i]] || typeof ref[parts[i]] !== 'object') {
      ref[parts[i]] = {};
    }
    ref = ref[parts[i]];
  }
  ref[parts[parts.length - 1]] = value;
}

function buildOrgScopeQuery(orgId) {
  return { orgId };
}

function buildSimpleUnifiedDiff(beforeText = '', afterText = '') {
  const beforeLines = String(beforeText || '').split('\n');
  const afterLines = String(afterText || '').split('\n');
  const max = Math.max(beforeLines.length, afterLines.length);
  const lines = ['--- before', '+++ after'];

  for (let i = 0; i < max; i++) {
    const before = beforeLines[i];
    const after = afterLines[i];
    if (before === after) {
      if (before !== undefined) lines.push(` ${before}`);
      continue;
    }
    if (before !== undefined) lines.push(`-${before}`);
    if (after !== undefined) lines.push(`+${after}`);
  }
  return lines.join('\n');
}

function sanitizeConfigPatch(rawPatch = {}) {
  if (!rawPatch || typeof rawPatch !== 'object' || Array.isArray(rawPatch)) {
    return {};
  }
  const patch = {};
  for (const [key, value] of Object.entries(rawPatch)) {
    if (!ALLOWED_CONFIG_PATCH_KEYS.has(key)) continue;
    patch[key] = value;
  }
  return patch;
}

function getScriptPatchTarget(integrationConfig) {
  if (!integrationConfig || typeof integrationConfig !== 'object') return null;

  if (integrationConfig.direction === 'INBOUND') {
    return {
      path: 'requestTransformation.script',
      preconditions: {
        'requestTransformation.mode': 'SCRIPT',
      },
    };
  }

  if (integrationConfig.transformation && typeof integrationConfig.transformation === 'object') {
    return {
      path: 'transformation.script',
      preconditions: {
        transformationMode: 'SCRIPT',
      },
    };
  }

  if (integrationConfig.responseTransformation && typeof integrationConfig.responseTransformation === 'object') {
    return {
      path: 'responseTransformation.script',
      preconditions: {
        'responseTransformation.mode': 'SCRIPT',
      },
    };
  }

  return null;
}

async function loadLogAndIntegration(orgId, logId, integrationId) {
  const mongodb = require('../mongodb');
  if (!mongodb.isConnected()) return { logEntry: null, integrationConfig: null };

  const db = await mongodb.getDbSafe();
  let logEntry = null;
  let integrationConfig = null;

  const logObjectId = toObjectIdOrNull(logId);
  if (logObjectId) {
    logEntry = await db.collection('execution_logs').findOne({
      _id: logObjectId,
      ...buildOrgScopeQuery(orgId),
    });
  }

  const fromLogIntegrationId = logEntry?.__KEEP___KEEP_integrationConfig__Id__;
  const targetIntegrationId = integrationId || fromLogIntegrationId;
  const integrationObjectId = toObjectIdOrNull(targetIntegrationId);
  if (integrationObjectId) {
    integrationConfig = await db.collection('integration_configs').findOne({
      _id: integrationObjectId,
      ...buildOrgScopeQuery(orgId),
    });
  }

  return { logEntry, integrationConfig };
}

const requireAIEnabled = asyncHandler(async (req, res, next) => {
  const orgId = getOrgIdFromRequest(req);
  if (!orgId) {
    return res.status(400).json({
      success: false,
      error: 'orgId is required',
    });
  }

  const available = await aiService.isAvailable(orgId);
  if (!available) {
    return res.status(403).json({
      success: false,
      code: 'AI_DISABLED',
      error: 'AI features are disabled for this organization. Enable AI in Settings -> AI Configuration.',
    });
  }

  return next();
});

/**
 * GET /api/v1/ai/status
 * Check if AI features are available for the current org
 * Query params: orgId (required)
 */
router.get(
  '/status',
  requireFeature(FEATURES.AI, 'read'),
  asyncHandler(async (req, res) => {
    const orgId = getOrgIdFromRequest(req);

    if (!orgId) {
      return res.status(400).json({
        success: false,
        error: 'orgId is required',
      });
    }

    const available = await aiService.isAvailable(orgId);
    const provider = await aiService.getProviderNameForEntity(orgId);

    res.json({
      success: true,
      data: {
        available,
        provider,
        enabled: available,
      },
    });
  })
);

/**
 * GET /api/v1/ai/usage
 * Get AI usage statistics for current org
 * Query params: orgId (required)
 */
router.get(
  '/usage',
  requireFeature(FEATURES.AI, 'read'),
  asyncHandler(async (req, res) => {
    const orgId = getOrgIdFromRequest(req);
    const days = parseInt(req.query.days, 10) || 30;

    if (!orgId) {
      return res.status(400).json({
        success: false,
        error: 'orgId is required',
      });
    }

    const stats = await aiService.getUsageStats(orgId, days);
    const rateLimit = await aiService.checkRateLimit(orgId);

    res.json({
      success: true,
      data: {
        ...stats,
        rateLimit,
      },
    });
  })
);

/**
 * POST /api/v1/ai/generate-transformation
 * Generate transformation script from input/output examples
 */
router.post(
  '/generate-transformation',
  requireFeature(FEATURES.AI, 'execute'),
  requireAIEnabled,
  asyncHandler(async (req, res) => {
    const orgId = getOrgIdFromRequest(req);
    const { inputExample, outputExample, eventType } = req.body;

    // Validation
    if (!orgId) {
      return res.status(400).json({
        success: false,
        error: 'orgId is required',
      });
    }

    if (!inputExample || !outputExample) {
      return res.status(400).json({
        success: false,
        error: 'Both inputExample and outputExample are required',
      });
    }

    // Validate JSON
    let inputObj;
    let outputObj;
    try {
      inputObj = typeof inputExample === 'string' ? JSON.parse(inputExample) : inputExample;
      outputObj = typeof outputExample === 'string' ? JSON.parse(outputExample) : outputExample;
    } catch (_error) {
      return res.status(400).json({
        success: false,
        error: 'Invalid JSON in examples',
      });
    }

    try {
      const script = await aiService.generateTransformation(orgId, inputObj, outputObj, eventType || '*');

      // Get updated rate limit
      const rateLimit = await aiService.checkRateLimit(orgId);

      res.json({
        success: true,
        data: {
          script,
          rateLimit,
        },
      });
    } catch (error) {
      // Check if it's a rate limit error
      if (error.message.includes('Daily AI limit exceeded')) {
        const rateLimit = await aiService.checkRateLimit(orgId);
        return res.status(429).json({
          success: false,
          error: error.message,
          code: 'RATE_LIMIT_EXCEEDED',
          usage: rateLimit.usage,
          limit: rateLimit.limit,
        });
      }

      throw error;
    }
  })
);

/**
 * POST /api/v1/ai/analyze-documentation
 * Analyze API documentation and suggest integration configuration
 * Supports: URL, Postman JSON, OpenAPI/Swagger JSON, plain text
 */
router.post(
  '/analyze-documentation',
  requireFeature(FEATURES.AI, 'execute'),
  requireAIEnabled,
  asyncHandler(async (req, res) => {
    const orgId = getOrgIdFromRequest(req);
    const { documentation, eventType, isURL } = req.body;

    if (!orgId) {
      return res.status(400).json({
        success: false,
        error: 'orgId is required',
      });
    }

    if (!documentation) {
      return res.status(400).json({
        success: false,
        error: 'API documentation is required',
      });
    }

    try {
      // If it's a URL or looks like a URL, validate then fetch it
      let finalDocumentation = documentation;
      const docRef = documentation.trim();
      if (isURL || docRef.startsWith('http://') || docRef.startsWith('https://')) {
        const urlCheck = validateTargetUrl(docRef, config.security);
        if (!urlCheck.valid) {
          return res.status(400).json({
            success: false,
            error: `Invalid documentation URL: ${urlCheck.reason}`,
          });
        }

        const { fetchAPIDocumentation } = require('../services/ai/url-fetcher');
        try {
          finalDocumentation = await fetchAPIDocumentation(docRef);
        } catch (fetchError) {
          return res.status(400).json({
            success: false,
            error: `Failed to fetch documentation from URL: ${fetchError.message}`,
          });
        }
      }

      const suggestedConfig = await aiService.analyzeDocumentation(orgId, finalDocumentation, eventType || '*');

      // Get updated rate limit
      const rateLimit = await aiService.checkRateLimit(orgId);

      res.json({
        success: true,
        data: {
          config: suggestedConfig,
          rateLimit,
        },
      });
    } catch (error) {
      if (error.message.includes('Daily AI limit exceeded')) {
        const rateLimit = await aiService.checkRateLimit(orgId);
        return res.status(429).json({
          success: false,
          error: error.message,
          code: 'RATE_LIMIT_EXCEEDED',
          usage: rateLimit.usage,
          limit: rateLimit.limit,
        });
      }

      throw error;
    }
  })
);

/**
 * POST /api/v1/ai/suggest-mappings
 * Suggest field mappings between source and target fields
 */
router.post(
  '/suggest-mappings',
  requireFeature(FEATURES.AI, 'execute'),
  requireAIEnabled,
  asyncHandler(async (req, res) => {
    const orgId = getOrgIdFromRequest(req);
    const { sourceFields, targetFields, apiContext } = req.body;

    if (!orgId) {
      return res.status(400).json({
        success: false,
        error: 'orgId is required',
      });
    }

    if (!sourceFields || !targetFields) {
      return res.status(400).json({
        success: false,
        error: 'Both sourceFields and targetFields are required',
      });
    }

    try {
      const mappings = await aiService.suggestFieldMappings(orgId, sourceFields, targetFields, apiContext || '');

      // Get updated rate limit
      const rateLimit = await aiService.checkRateLimit(orgId);

      res.json({
        success: true,
        data: {
          mappings,
          rateLimit,
        },
      });
    } catch (error) {
      if (error.message.includes('Daily AI limit exceeded')) {
        const rateLimit = await aiService.checkRateLimit(orgId);
        return res.status(429).json({
          success: false,
          error: error.message,
          code: 'RATE_LIMIT_EXCEEDED',
          usage: rateLimit.usage,
          limit: rateLimit.limit,
        });
      }

      throw error;
    }
  })
);

/**
 * POST /api/v1/ai/generate-test-payload
 * Generate realistic test payload for event type
 */
router.post(
  '/generate-test-payload',
  requireFeature(FEATURES.AI, 'execute'),
  requireAIEnabled,
  asyncHandler(async (req, res) => {
    const orgId = getOrgIdFromRequest(req);
    const { eventType } = req.body;

    if (!orgId) {
      return res.status(400).json({
        success: false,
        error: 'orgId is required',
      });
    }

    if (!eventType) {
      return res.status(400).json({
        success: false,
        error: 'eventType is required',
      });
    }

    try {
      const payload = await aiService.generateTestPayload(orgId, eventType);

      // Get updated rate limit
      const rateLimit = await aiService.checkRateLimit(orgId);

      res.json({
        success: true,
        data: {
          payload,
          rateLimit,
        },
      });
    } catch (error) {
      if (error.message.includes('Daily AI limit exceeded')) {
        const rateLimit = await aiService.checkRateLimit(orgId);
        return res.status(429).json({
          success: false,
          error: error.message,
          code: 'RATE_LIMIT_EXCEEDED',
          usage: rateLimit.usage,
          limit: rateLimit.limit,
        });
      }

      throw error;
    }
  })
);

/**
 * POST /api/v1/ai/generate-scheduling-script
 * Generate scheduling script from description
 */
router.post(
  '/generate-scheduling-script',
  requireFeature(FEATURES.AI, 'execute'),
  requireAIEnabled,
  asyncHandler(async (req, res) => {
    const orgId = getOrgIdFromRequest(req);
    const { description, mode, eventType } = req.body;

    if (!orgId) {
      return res.status(400).json({
        success: false,
        error: 'orgId is required',
      });
    }

    if (!description || !mode) {
      return res.status(400).json({
        success: false,
        error: 'description and mode are required',
      });
    }

    try {
      const script = await aiService.generateSchedulingScript(orgId, description, mode, eventType || '*');

      const rateLimit = await aiService.checkRateLimit(orgId);

      res.json({
        success: true,
        data: {
          script,
          rateLimit,
        },
      });
    } catch (error) {
      if (error.message.includes('Daily AI limit exceeded')) {
        const rateLimit = await aiService.checkRateLimit(orgId);
        return res.status(429).json({
          success: false,
          error: error.message,
          code: 'RATE_LIMIT_EXCEEDED',
          usage: rateLimit.usage,
          limit: rateLimit.limit,
        });
      }

      throw error;
    }
  })
);

/**
 * GET /api/v1/ai/interactions
 * Get AI interaction logs for debugging
 * Query params: orgId (required), operation (optional), limit (optional)
 */
router.get(
  '/interactions',
  requireFeature(FEATURES.AI, 'read'),
  asyncHandler(async (req, res) => {
    const orgId = getOrgIdFromRequest(req);
    const { operation, limit } = req.query;

    if (!orgId) {
      return res.status(400).json({
        success: false,
        error: 'orgId is required',
      });
    }

    const options = {
      limit: limit ? parseInt(limit, 10) : 50,
      operation: operation || undefined,
    };

    const interactions = await interactionLogger.getInteractions(orgId, options);

    res.json({
      success: true,
      data: {
        interactions,
        count: interactions.length,
      },
    });
  })
);

/**
 * GET /api/v1/ai/interactions/stats
 * Get AI interaction statistics
 * Query params: orgId (required), days (optional, default: 7)
 */
router.get(
  '/interactions/stats',
  requireFeature(FEATURES.AI, 'read'),
  asyncHandler(async (req, res) => {
    const orgId = getOrgIdFromRequest(req);
    const days = parseInt(req.query.days, 10) || 7;

    if (!orgId) {
      return res.status(400).json({
        success: false,
        error: 'orgId is required',
      });
    }

    const stats = await interactionLogger.getStats(orgId, days);

    res.json({
      success: true,
      data: stats,
    });
  })
);

/**
 * POST /api/v1/ai/analyze-error
 * Analyze a delivery error and suggest fixes
 * Body: { logId?, integrationId?, errorMessage, transformationCode?, payload? }
 */
router.post(
  '/analyze-error',
  requireFeature(FEATURES.AI, 'execute'),
  requireAIEnabled,
  asyncHandler(async (req, res) => {
    const orgId = getOrgIdFromRequest(req);
    const { logId, integrationId, errorMessage, transformationCode, payload } = req.body;

    if (!orgId) {
      return res.status(400).json({ success: false, error: 'orgId is required' });
    }
    if (!errorMessage) {
      return res.status(400).json({ success: false, error: 'errorMessage is required' });
    }

    // Build context from MongoDB if IDs are provided
    let logEntry = null;
    let integrationConfig = null;

    try {
      const mongodb = require('../mongodb');
      if (mongodb.isConnected()) {
        const db = await mongodb.getDbSafe();

        if (logId) {
          const { ObjectId } = require('mongodb');
          try {
            logEntry = await db.collection('execution_logs').findOne({
              _id: new ObjectId(logId),
              ...buildOrgScopeQuery(orgId),
            });
          } catch (_) {
            /* invalid ObjectId - skip */
          }
        }

        if (integrationId) {
          const { ObjectId } = require('mongodb');
          try {
            integrationConfig = await db.collection('integration_configs').findOne({
              _id: new ObjectId(integrationId),
              ...buildOrgScopeQuery(orgId),
            });
          } catch (_) {
            /* invalid ObjectId - skip */
          }
        }
      }
    } catch (_) {
      /* DB unavailable - proceed without context */
    }

    try {
      const result = await aiService.analyzeError(orgId, {
        errorMessage,
        logEntry,
        integrationConfig,
        transformationCode: transformationCode || integrationConfig?.transformationScript,
        payload,
      });

      const rateLimit = await aiService.checkRateLimit(orgId);
      res.json({ success: true, data: { ...result, rateLimit } });
    } catch (error) {
      if (error.message.includes('Daily AI limit exceeded')) {
        const rateLimit = await aiService.checkRateLimit(orgId);
        return res.status(429).json({
          success: false,
          error: error.message,
          code: 'RATE_LIMIT_EXCEEDED',
          usage: rateLimit.usage,
          limit: rateLimit.limit,
        });
      }
      throw error;
    }
  })
);

/**
 * POST /api/v1/ai/diagnose-log-fix
 * Diagnose a failed log, return exact script/config diff, and patch payload for one-click apply.
 * Body: { logId, integrationId? }
 */
router.post(
  '/diagnose-log-fix',
  requireFeature(FEATURES.AI, 'execute'),
  requireAIEnabled,
  asyncHandler(async (req, res) => {
    const orgId = getOrgIdFromRequest(req);
    const { logId, integrationId } = req.body || {};

    if (!orgId) {
      return res.status(400).json({ success: false, error: 'orgId is required' });
    }
    if (!logId) {
      return res.status(400).json({ success: false, error: 'logId is required' });
    }

    const { logEntry, integrationConfig } = await loadLogAndIntegration(orgId, logId, integrationId);
    if (!logEntry) {
      return res.status(404).json({ success: false, error: 'Log not found for this organization' });
    }

    if (!integrationConfig) {
      return res.status(404).json({ success: false, error: 'Linked integration not found for this organization' });
    }

    const scriptTarget = getScriptPatchTarget(integrationConfig);
    const existingScript = scriptTarget ? getValueByPath(integrationConfig, scriptTarget.path) : null;

    try {
      const analysis = await aiService.analyzeError(orgId, {
        errorMessage: logEntry.errorMessage || 'Unknown delivery error',
        logEntry,
        integrationConfig,
        transformationCode: existingScript || null,
        payload: logEntry.requestPayload || logEntry.originalPayload || null,
      });

      const normalizedPatch = sanitizeConfigPatch(analysis.configPatch || {});
      const configChanges = Object.entries(normalizedPatch)
        .map(([key, value]) => {
          const before = integrationConfig[key];
          const changed = JSON.stringify(before) !== JSON.stringify(value);
          return changed ? { path: key, before, after: value } : null;
        })
        .filter(Boolean);

      let scriptPatch = null;
      if (analysis.codeChange && scriptTarget) {
        const beforeScript = String(existingScript || '');
        const afterScript = String(analysis.codeChange || '');
        if (beforeScript !== afterScript) {
          scriptPatch = {
            path: scriptTarget.path,
            before: beforeScript,
            after: afterScript,
            diff: buildSimpleUnifiedDiff(beforeScript, afterScript),
          };
        }
      }

      const patchable = !!scriptPatch || configChanges.length > 0;
      const rateLimit = await aiService.checkRateLimit(orgId);

      res.json({
        success: true,
        data: {
          logId,
          integrationId: integrationConfig._id?.toString?.() || null,
          analysis,
          patchable,
          patch: {
            script: scriptPatch,
            config: configChanges.length > 0 ? { patch: normalizedPatch, changes: configChanges } : null,
          },
          rateLimit,
        },
      });
    } catch (error) {
      if (error.message.includes('Daily AI limit exceeded')) {
        const rateLimit = await aiService.checkRateLimit(orgId);
        return res.status(429).json({
          success: false,
          error: error.message,
          code: 'RATE_LIMIT_EXCEEDED',
          usage: rateLimit.usage,
          limit: rateLimit.limit,
        });
      }
      throw error;
    }
  })
);

/**
 * POST /api/v1/ai/apply-log-fix
 * Apply script/config patch from diagnose-log-fix to the linked integration.
 * Body: { logId, integrationId?, codeChange?, scriptPath?, configPatch? }
 */
router.post(
  '/apply-log-fix',
  requireFeature(FEATURES.AI, 'execute'),
  requireAIEnabled,
  asyncHandler(async (req, res) => {
    const orgId = getOrgIdFromRequest(req);
    const { logId, integrationId, codeChange, scriptPath, configPatch } = req.body || {};

    if (!orgId) {
      return res.status(400).json({ success: false, error: 'orgId is required' });
    }
    if (!logId) {
      return res.status(400).json({ success: false, error: 'logId is required' });
    }

    const { integrationConfig } = await loadLogAndIntegration(orgId, logId, integrationId);
    if (!integrationConfig) {
      return res.status(404).json({ success: false, error: 'Linked integration not found for this organization' });
    }

    const safeConfigPatch = sanitizeConfigPatch(configPatch || {});
    const hasConfigPatch = Object.keys(safeConfigPatch).length > 0;
    const hasCodeChange = typeof codeChange === 'string' && codeChange.trim().length > 0;

    if (!hasCodeChange && !hasConfigPatch) {
      return res.status(400).json({ success: false, error: 'Nothing to apply (missing codeChange/configPatch)' });
    }

    const mongodb = require('../mongodb');
    if (!mongodb.isConnected()) {
      return res.status(503).json({ success: false, error: 'Database not available' });
    }
    const db = await mongodb.getDbSafe();

    const updates = { updatedAt: new Date() };
    let appliedScriptPath = null;

    if (hasCodeChange) {
      if (!validateScript(codeChange)) {
        return res
          .status(400)
          .json({ success: false, error: 'Proposed codeChange is not valid JavaScript transformation code' });
      }

      const defaultTarget = getScriptPatchTarget(integrationConfig);
      const resolvedPath = scriptPath || defaultTarget?.path;
      const allowedScriptPaths = new Set([
        'transformation.script',
        'requestTransformation.script',
        'responseTransformation.script',
      ]);

      if (!resolvedPath || !allowedScriptPaths.has(resolvedPath)) {
        return res.status(400).json({ success: false, error: 'No valid script target found for this integration' });
      }

      updates[resolvedPath] = codeChange;
      if (resolvedPath === 'transformation.script') {
        updates.transformationMode = 'SCRIPT';
      } else if (resolvedPath === 'requestTransformation.script') {
        updates['requestTransformation.mode'] = 'SCRIPT';
      } else if (resolvedPath === 'responseTransformation.script') {
        updates['responseTransformation.mode'] = 'SCRIPT';
      }
      appliedScriptPath = resolvedPath;
    }

    if (hasConfigPatch) {
      if (safeConfigPatch.targetUrl) {
        const urlCheck = validateTargetUrl(safeConfigPatch.targetUrl, config.security);
        if (!urlCheck.valid) {
          return res.status(400).json({
            success: false,
            error: `Invalid targetUrl in configPatch: ${urlCheck.reason}`,
          });
        }
      }

      for (const [key, value] of Object.entries(safeConfigPatch)) {
        updates[key] = value;
      }
    }

    const integrationObjectId = toObjectIdOrNull(integrationConfig._id);
    const result = await db
      .collection('integration_configs')
      .updateOne({ _id: integrationObjectId, ...buildOrgScopeQuery(orgId) }, { $set: updates });

    if (!result.matchedCount) {
      return res.status(404).json({ success: false, error: 'Integration not found while applying fix' });
    }

    return res.json({
      success: true,
      data: {
        integrationId: integrationConfig._id?.toString?.() || null,
        applied: {
          scriptPath: appliedScriptPath,
          configKeys: Object.keys(safeConfigPatch),
        },
      },
    });
  })
);

/**
 * POST /api/v1/ai/chat
 * Multi-turn chat with entity context injected from MongoDB
 * Body: { messages: [{role, content}], context?: { integrationId?, logId?, eventType? } }
 */
router.post(
  '/chat',
  requireFeature(FEATURES.AI, 'execute'),
  requireAIEnabled,
  asyncHandler(async (req, res) => {
    const orgId = getOrgIdFromRequest(req);
    const { messages, context } = req.body;

    if (!orgId) {
      return res.status(400).json({ success: false, error: 'orgId is required' });
    }
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ success: false, error: 'messages array is required' });
    }

    // Validate message structure
    const validRoles = ['user', 'assistant'];
    for (const msg of messages) {
      if (!validRoles.includes(msg.role) || typeof msg.content !== 'string') {
        return res.status(400).json({
          success: false,
          error: 'Each message must have role (user|assistant) and string content',
        });
      }
    }

    try {
      const rawReply = await aiService.chat(orgId, messages, context || {});
      const rateLimit = await aiService.checkRateLimit(orgId);

      // Extract [INTEGRATION_DRAFT]{json}[/INTEGRATION_DRAFT] block if present
      const DRAFT_RE = /\[INTEGRATION_DRAFT\]([\s\S]*?)\[\/INTEGRATION_DRAFT\]/;
      let action = null;
      let reply = rawReply;
      const draftMatch = rawReply.match(DRAFT_RE);
      if (draftMatch) {
        try {
          action = { type: 'CREATE_INTEGRATION', config: JSON.parse(draftMatch[1].trim()) };
          reply = rawReply.replace(DRAFT_RE, '').trim();
        } catch (_) {
          // JSON malformed — send reply as-is without action
        }
      }

      res.json({ success: true, data: { reply, action, rateLimit } });
    } catch (error) {
      if (error.message.includes('Daily AI limit exceeded')) {
        const rateLimit = await aiService.checkRateLimit(orgId);
        return res.status(429).json({
          success: false,
          error: error.message,
          code: 'RATE_LIMIT_EXCEEDED',
          usage: rateLimit.usage,
          limit: rateLimit.limit,
        });
      }
      throw error;
    }
  })
);

/**
 * POST /api/v1/ai/explain-transformation
 * Explain what a transformation script does, or fix it if an error is provided
 * Body: { code, errorMessage?, eventType? }
 */
router.post(
  '/explain-transformation',
  requireFeature(FEATURES.AI, 'execute'),
  requireAIEnabled,
  asyncHandler(async (req, res) => {
    const orgId = getOrgIdFromRequest(req);
    const { code, errorMessage, eventType } = req.body;

    if (!orgId) {
      return res.status(400).json({ success: false, error: 'orgId is required' });
    }
    if (!code || typeof code !== 'string') {
      return res.status(400).json({ success: false, error: 'code (string) is required' });
    }

    try {
      const result = await aiService.explainTransformation(orgId, {
        code,
        errorMessage,
        eventType,
      });

      const rateLimit = await aiService.checkRateLimit(orgId);
      res.json({ success: true, data: { ...result, rateLimit } });
    } catch (error) {
      if (error.message.includes('Daily AI limit exceeded')) {
        const rateLimit = await aiService.checkRateLimit(orgId);
        return res.status(429).json({
          success: false,
          error: error.message,
          code: 'RATE_LIMIT_EXCEEDED',
          usage: rateLimit.usage,
          limit: rateLimit.limit,
        });
      }
      throw error;
    }
  })
);

/**
 * GET /api/v1/ai/interactions/:id
 * Get a specific AI interaction by ID
 */
router.get(
  '/interactions/:id',
  requireFeature(FEATURES.AI, 'read'),
  asyncHandler(async (req, res) => {
    const orgId = getOrgIdFromRequest(req);
    const { id } = req.params;

    if (!orgId) {
      return res.status(400).json({
        success: false,
        error: 'orgId is required',
      });
    }

    const mongodb = require('../mongodb');
    const { ObjectId } = require('mongodb');

    if (!mongodb.isConnected()) {
      return res.status(503).json({
        success: false,
        error: 'Database not available',
      });
    }

    const db = await mongodb.getDbSafe();
    const interaction = await db.collection('ai_interactions').findOne({
      _id: new ObjectId(id),
      $or: [{ orgId }, { entityParentRid: orgId }],
    });

    if (!interaction) {
      return res.status(404).json({
        success: false,
        error: 'Interaction not found',
      });
    }

    res.json({
      success: true,
      data: interaction,
    });
  })
);

module.exports = router;
