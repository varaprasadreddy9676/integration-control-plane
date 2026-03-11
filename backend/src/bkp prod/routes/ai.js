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

/**
 * GET /api/v1/ai/status
 * Check if AI features are available for the current entity
 * Query params: entityParentRid (required)
 */
router.get(
  '/status',
  requireFeature(FEATURES.AI, 'read'),
  asyncHandler(async (req, res) => {
    const { entityParentRid } = req;

    if (!entityParentRid) {
      return res.status(400).json({
        success: false,
        error: 'entityParentRid is required'
      });
    }

    const available = await aiService.isAvailable(entityParentRid);
    const provider = aiService.getProviderName();

    res.json({
      success: true,
      data: {
        available,
        provider,
        enabled: available
      }
    });
  })
);

/**
 * GET /api/v1/ai/usage
 * Get AI usage statistics for current entity
 * Query params: entityParentRid (required)
 */
router.get(
  '/usage',
  requireFeature(FEATURES.AI, 'read'),
  asyncHandler(async (req, res) => {
    const { entityParentRid } = req;
    const days = parseInt(req.query.days) || 30;

    if (!entityParentRid) {
      return res.status(400).json({
        success: false,
        error: 'entityParentRid is required'
      });
    }

    const stats = await aiService.getUsageStats(entityParentRid, days);
    const rateLimit = await aiService.checkRateLimit(entityParentRid);

    res.json({
      success: true,
      data: {
        ...stats,
        rateLimit
      }
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
  asyncHandler(async (req, res) => {
    const { entityParentRid } = req;
    const { inputExample, outputExample, eventType } = req.body;

    // Validation
    if (!entityParentRid) {
      return res.status(400).json({
        success: false,
        error: 'entityParentRid is required'
      });
    }

    if (!inputExample || !outputExample) {
      return res.status(400).json({
        success: false,
        error: 'Both inputExample and outputExample are required'
      });
    }

    // Validate JSON
    let inputObj, outputObj;
    try {
      inputObj = typeof inputExample === 'string' ? JSON.parse(inputExample) : inputExample;
      outputObj =
        typeof outputExample === 'string' ? JSON.parse(outputExample) : outputExample;
    } catch (error) {
      return res.status(400).json({
        success: false,
        error: 'Invalid JSON in examples'
      });
    }

    try {
      const script = await aiService.generateTransformation(
        entityParentRid,
        inputObj,
        outputObj,
        eventType || '*'
      );

      // Get updated rate limit
      const rateLimit = await aiService.checkRateLimit(entityParentRid);

      res.json({
        success: true,
        data: {
          script,
          rateLimit
        }
      });
    } catch (error) {
      // Check if it's a rate limit error
      if (error.message.includes('Daily AI limit exceeded')) {
        const rateLimit = await aiService.checkRateLimit(entityParentRid);
        return res.status(429).json({
          success: false,
          error: error.message,
          code: 'RATE_LIMIT_EXCEEDED',
          usage: rateLimit.usage,
          limit: rateLimit.limit
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
  asyncHandler(async (req, res) => {
    const { entityParentRid } = req;
    const { documentation, eventType, isURL } = req.body;

    if (!entityParentRid) {
      return res.status(400).json({
        success: false,
        error: 'entityParentRid is required'
      });
    }

    if (!documentation) {
      return res.status(400).json({
        success: false,
        error: 'API documentation is required'
      });
    }

    try {
      // If it's a URL or looks like a URL, fetch it
      let finalDocumentation = documentation;
      if (isURL || documentation.trim().startsWith('http://') || documentation.trim().startsWith('https://')) {
        const { fetchAPIDocumentation } = require('../services/ai/url-fetcher');
        try {
          finalDocumentation = await fetchAPIDocumentation(documentation.trim());
        } catch (fetchError) {
          return res.status(400).json({
            success: false,
            error: `Failed to fetch documentation from URL: ${fetchError.message}`
          });
        }
      }

      const config = await aiService.analyzeDocumentation(
        entityParentRid,
        finalDocumentation,
        eventType || '*'
      );

      // Get updated rate limit
      const rateLimit = await aiService.checkRateLimit(entityParentRid);

      res.json({
        success: true,
        data: {
          config,
          rateLimit
        }
      });
    } catch (error) {
      if (error.message.includes('Daily AI limit exceeded')) {
        const rateLimit = await aiService.checkRateLimit(entityParentRid);
        return res.status(429).json({
          success: false,
          error: error.message,
          code: 'RATE_LIMIT_EXCEEDED',
          usage: rateLimit.usage,
          limit: rateLimit.limit
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
  asyncHandler(async (req, res) => {
    const { entityParentRid } = req;
    const { sourceFields, targetFields, apiContext } = req.body;

    if (!entityParentRid) {
      return res.status(400).json({
        success: false,
        error: 'entityParentRid is required'
      });
    }

    if (!sourceFields || !targetFields) {
      return res.status(400).json({
        success: false,
        error: 'Both sourceFields and targetFields are required'
      });
    }

    try {
      const mappings = await aiService.suggestFieldMappings(
        entityParentRid,
        sourceFields,
        targetFields,
        apiContext || ''
      );

      // Get updated rate limit
      const rateLimit = await aiService.checkRateLimit(entityParentRid);

      res.json({
        success: true,
        data: {
          mappings,
          rateLimit
        }
      });
    } catch (error) {
      if (error.message.includes('Daily AI limit exceeded')) {
        const rateLimit = await aiService.checkRateLimit(entityParentRid);
        return res.status(429).json({
          success: false,
          error: error.message,
          code: 'RATE_LIMIT_EXCEEDED',
          usage: rateLimit.usage,
          limit: rateLimit.limit
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
  asyncHandler(async (req, res) => {
    const { entityParentRid } = req;
    const { eventType } = req.body;

    if (!entityParentRid) {
      return res.status(400).json({
        success: false,
        error: 'entityParentRid is required'
      });
    }

    if (!eventType) {
      return res.status(400).json({
        success: false,
        error: 'eventType is required'
      });
    }

    try {
      const payload = await aiService.generateTestPayload(entityParentRid, eventType);

      // Get updated rate limit
      const rateLimit = await aiService.checkRateLimit(entityParentRid);

      res.json({
        success: true,
        data: {
          payload,
          rateLimit
        }
      });
    } catch (error) {
      if (error.message.includes('Daily AI limit exceeded')) {
        const rateLimit = await aiService.checkRateLimit(entityParentRid);
        return res.status(429).json({
          success: false,
          error: error.message,
          code: 'RATE_LIMIT_EXCEEDED',
          usage: rateLimit.usage,
          limit: rateLimit.limit
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
  asyncHandler(async (req, res) => {
    const { entityParentRid } = req;
    const { description, mode, eventType } = req.body;

    if (!entityParentRid) {
      return res.status(400).json({
        success: false,
        error: 'entityParentRid is required'
      });
    }

    if (!description || !mode) {
      return res.status(400).json({
        success: false,
        error: 'description and mode are required'
      });
    }

    try {
      const script = await aiService.generateSchedulingScript(
        entityParentRid,
        description,
        mode,
        eventType || '*'
      );

      const rateLimit = await aiService.checkRateLimit(entityParentRid);

      res.json({
        success: true,
        data: {
          script,
          rateLimit
        }
      });
    } catch (error) {
      if (error.message.includes('Daily AI limit exceeded')) {
        const rateLimit = await aiService.checkRateLimit(entityParentRid);
        return res.status(429).json({
          success: false,
          error: error.message,
          code: 'RATE_LIMIT_EXCEEDED',
          usage: rateLimit.usage,
          limit: rateLimit.limit
        });
      }

      throw error;
    }
  })
);

/**
 * GET /api/v1/ai/interactions
 * Get AI interaction logs for debugging
 * Query params: entityParentRid (required), operation (optional), limit (optional)
 */
router.get(
  '/interactions',
  requireFeature(FEATURES.AI, 'read'),
  asyncHandler(async (req, res) => {
    const { entityParentRid } = req;
    const { operation, limit } = req.query;

    if (!entityParentRid) {
      return res.status(400).json({
        success: false,
        error: 'entityParentRid is required'
      });
    }

    const options = {
      limit: limit ? parseInt(limit) : 50,
      operation: operation || undefined
    };

    const interactions = await interactionLogger.getInteractions(entityParentRid, options);

    res.json({
      success: true,
      data: {
        interactions,
        count: interactions.length
      }
    });
  })
);

/**
 * GET /api/v1/ai/interactions/stats
 * Get AI interaction statistics
 * Query params: entityParentRid (required), days (optional, default: 7)
 */
router.get(
  '/interactions/stats',
  requireFeature(FEATURES.AI, 'read'),
  asyncHandler(async (req, res) => {
    const { entityParentRid } = req;
    const days = parseInt(req.query.days) || 7;

    if (!entityParentRid) {
      return res.status(400).json({
        success: false,
        error: 'entityParentRid is required'
      });
    }

    const stats = await interactionLogger.getStats(entityParentRid, days);

    res.json({
      success: true,
      data: stats
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
  asyncHandler(async (req, res) => {
    const { entityParentRid } = req;
    const { logId, integrationId, errorMessage, transformationCode, payload } = req.body;

    if (!entityParentRid) {
      return res.status(400).json({ success: false, error: 'entityParentRid is required' });
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
            logEntry = await db.collection('logs').findOne({
              _id: new ObjectId(logId),
              entityParentRid
            });
          } catch (_) { /* invalid ObjectId - skip */ }
        }

        if (integrationId) {
          const { ObjectId } = require('mongodb');
          try {
            integrationConfig = await db.collection('integration_configs').findOne({
              _id: new ObjectId(integrationId),
              entityParentRid
            });
          } catch (_) { /* invalid ObjectId - skip */ }
        }
      }
    } catch (_) { /* DB unavailable - proceed without context */ }

    try {
      const result = await aiService.analyzeError(entityParentRid, {
        errorMessage,
        logEntry,
        integrationConfig,
        transformationCode: transformationCode || integrationConfig?.transformationScript,
        payload
      });

      const rateLimit = await aiService.checkRateLimit(entityParentRid);
      res.json({ success: true, data: { ...result, rateLimit } });
    } catch (error) {
      if (error.message.includes('Daily AI limit exceeded')) {
        const rateLimit = await aiService.checkRateLimit(entityParentRid);
        return res.status(429).json({
          success: false,
          error: error.message,
          code: 'RATE_LIMIT_EXCEEDED',
          usage: rateLimit.usage,
          limit: rateLimit.limit
        });
      }
      throw error;
    }
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
  asyncHandler(async (req, res) => {
    const { entityParentRid } = req;
    const { messages, context } = req.body;

    if (!entityParentRid) {
      return res.status(400).json({ success: false, error: 'entityParentRid is required' });
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
          error: 'Each message must have role (user|assistant) and string content'
        });
      }
    }

    try {
      const rawReply = await aiService.chat(entityParentRid, messages, context || {});
      const rateLimit = await aiService.checkRateLimit(entityParentRid);

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
        const rateLimit = await aiService.checkRateLimit(entityParentRid);
        return res.status(429).json({
          success: false,
          error: error.message,
          code: 'RATE_LIMIT_EXCEEDED',
          usage: rateLimit.usage,
          limit: rateLimit.limit
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
  asyncHandler(async (req, res) => {
    const { entityParentRid } = req;
    const { code, errorMessage, eventType } = req.body;

    if (!entityParentRid) {
      return res.status(400).json({ success: false, error: 'entityParentRid is required' });
    }
    if (!code || typeof code !== 'string') {
      return res.status(400).json({ success: false, error: 'code (string) is required' });
    }

    try {
      const result = await aiService.explainTransformation(entityParentRid, {
        code,
        errorMessage,
        eventType
      });

      const rateLimit = await aiService.checkRateLimit(entityParentRid);
      res.json({ success: true, data: { ...result, rateLimit } });
    } catch (error) {
      if (error.message.includes('Daily AI limit exceeded')) {
        const rateLimit = await aiService.checkRateLimit(entityParentRid);
        return res.status(429).json({
          success: false,
          error: error.message,
          code: 'RATE_LIMIT_EXCEEDED',
          usage: rateLimit.usage,
          limit: rateLimit.limit
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
    const { entityParentRid } = req;
    const { id } = req.params;

    if (!entityParentRid) {
      return res.status(400).json({
        success: false,
        error: 'entityParentRid is required'
      });
    }

    const mongodb = require('../mongodb');
    const { ObjectId } = require('mongodb');

    if (!mongodb.isConnected()) {
      return res.status(503).json({
        success: false,
        error: 'Database not available'
      });
    }

    const db = await mongodb.getDbSafe();
    const interaction = await db.collection('ai_interactions').findOne({
      _id: new ObjectId(id),
      entityParentRid
    });

    if (!interaction) {
      return res.status(404).json({
        success: false,
        error: 'Interaction not found'
      });
    }

    res.json({
      success: true,
      data: interaction
    });
  })
);

module.exports = router;
