/**
 * AI Configuration Routes
 *
 * Manage per-org AI provider settings and API keys.
 * Only accessible to SUPER_ADMIN, ADMIN, and ORG_ADMIN.
 */

const express = require('express');
const router = express.Router();
const asyncHandler = require('../utils/async-handler');
const { requireFeature } = require('../middleware/feature-permission');
const { FEATURES } = require('../rbac/features');
const { ValidationError } = require('../utils/errors');
const aiConfigData = require('../data/ai-config');
const AIProviderFactory = require('../services/ai/provider-factory');
const { log } = require('../logger');
const { getOrgIdFromRequest } = require('../utils/org-context');
const { auditConfig } = require('../middleware/audit');

const VALID_PROVIDERS = ['openai', 'claude', 'kimi', 'zai'];

const PROVIDER_MODELS = {
  openai: ['gpt-4o-mini', 'gpt-4o', 'gpt-4-turbo', 'gpt-4', 'gpt-3.5-turbo'],
  claude: ['claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022', 'claude-3-opus-20240229'],
  kimi: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'],
  zai: ['glm-4.7', 'glm-4-flash', 'glm-4'],
};

/**
 * GET /api/v1/ai-config
 * Get AI configuration for the org (masked - no raw API key)
 */
router.get(
  '/',
  requireFeature(FEATURES.AI_CONFIG, 'read'),
  asyncHandler(async (req, res) => {
    const orgId = getOrgIdFromRequest(req);

    if (!orgId) {
      throw new ValidationError('orgId is required');
    }

    let entityConfig = null;
    try {
      entityConfig = await aiConfigData.getAIConfig(orgId);
    } catch (err) {
      log('warn', 'Could not fetch entity AI config from MongoDB', { error: err.message });
    }

    // Return entity config if it exists, otherwise sensible defaults
    res.json({
      success: true,
      data: entityConfig || {
        provider: 'openai',
        model: 'gpt-4o-mini',
        dailyLimit: 100,
        enabled: false,
        hasApiKey: false,
      },
      providerModels: PROVIDER_MODELS,
    });
  })
);

/**
 * PUT /api/v1/ai-config
 * Save AI configuration for the org
 */
router.put(
  '/',
  requireFeature(FEATURES.AI_CONFIG, 'configure'),
  asyncHandler(async (req, res) => {
    const orgId = getOrgIdFromRequest(req);
    const { provider, apiKey, model, maxTokens, dailyLimit, enabled } = req.body;

    if (!orgId) {
      throw new ValidationError('orgId is required');
    }

    if (provider && !VALID_PROVIDERS.includes(provider)) {
      throw new ValidationError(`Invalid provider. Must be one of: ${VALID_PROVIDERS.join(', ')}`);
    }

    if (model && provider && PROVIDER_MODELS[provider] && !PROVIDER_MODELS[provider].includes(model)) {
      throw new ValidationError(
        `Invalid model "${model}" for provider "${provider}". Valid models: ${PROVIDER_MODELS[provider].join(', ')}`
      );
    }

    if (dailyLimit !== undefined && (typeof dailyLimit !== 'number' || dailyLimit < 0 || dailyLimit > 10000)) {
      throw new ValidationError('dailyLimit must be a number between 0 (unlimited) and 10000');
    }

    const beforeConfig = await aiConfigData.getAIConfig(orgId).catch(() => null);

    const saved = await aiConfigData.saveAIConfig(orgId, {
      provider,
      apiKey,
      model,
      maxTokens: typeof maxTokens === 'number' ? maxTokens : undefined,
      dailyLimit: typeof dailyLimit === 'number' ? dailyLimit : undefined,
      enabled,
    });

    // Invalidate the provider cache in AIService
    const aiService = require('../services/ai');
    if (aiService.invalidateProviderCache) {
      aiService.invalidateProviderCache(orgId);
    }

    await auditConfig.aiConfigUpdated(req, { before: beforeConfig, after: saved });

    res.json({
      success: true,
      message: 'AI configuration saved successfully',
      data: saved,
    });
  })
);

/**
 * POST /api/v1/ai-config/test
 * Test the AI connection for this org
 */
router.post(
  '/test',
  requireFeature(FEATURES.AI_CONFIG, 'configure'),
  asyncHandler(async (req, res) => {
    const orgId = getOrgIdFromRequest(req);

    if (!orgId) {
      throw new ValidationError('orgId is required');
    }

    const providerConfig = await aiConfigData.getProviderConfig(orgId);
    if (!providerConfig) {
      return res.status(400).json({
        success: false,
        error: 'No AI API key configured for this organization. Save your settings first.',
      });
    }

    const provider = AIProviderFactory.create({
      enabled: true,
      provider: providerConfig.provider,
      [providerConfig.provider]: providerConfig,
    });

    if (!provider) {
      return res.status(400).json({
        success: false,
        error: 'Could not initialize AI provider',
      });
    }

    try {
      const start = Date.now();
      const result = await provider.testConnection();
      const latencyMs = Date.now() - start;

      res.json({
        success: true,
        data: {
          connected: true,
          provider: providerConfig.provider,
          model: result.model || providerConfig.model,
          latencyMs,
        },
      });
    } catch (err) {
      res.status(400).json({
        success: false,
        error: `Connection test failed: ${err.message}`,
      });
    }
  })
);

/**
 * DELETE /api/v1/ai-config/api-key
 * Remove API key (disables AI for this entity)
 */
router.delete(
  '/api-key',
  requireFeature(FEATURES.AI_CONFIG, 'configure'),
  asyncHandler(async (req, res) => {
    const orgId = getOrgIdFromRequest(req);

    if (!orgId) {
      throw new ValidationError('orgId is required');
    }

    await aiConfigData.deleteAIKey(orgId);

    // Invalidate provider cache
    const aiService = require('../services/ai');
    if (aiService.invalidateProviderCache) {
      aiService.invalidateProviderCache(orgId);
    }

    await auditConfig.aiConfigUpdated(req, {
      before: { hasApiKey: true },
      after: { hasApiKey: false, enabled: false },
    });

    res.json({
      success: true,
      message: 'API key removed. AI features are now disabled for this organization.',
    });
  })
);

/**
 * GET /api/v1/ai-config/providers
 * List available providers and their supported models (public metadata)
 */
router.get(
  '/providers',
  asyncHandler(async (_req, res) => {
    res.json({
      success: true,
      data: {
        providers: VALID_PROVIDERS,
        models: PROVIDER_MODELS,
      },
    });
  })
);

module.exports = router;
