/**
 * AI Service - Main Entry Point
 * Provider-agnostic AI service with per-entity dynamic providers and rate limiting.
 */

const AIProviderFactory = require('./provider-factory');
const AIRateLimiter = require('./rate-limiter');
const interactionLogger = require('./interaction-logger');
const config = require('../../config');
const { log } = require('../../logger');
const { normalizeErrorAnalysis, normalizeExplainTransformation } = require('./prompts');

// Provider cache: entityParentRid → { provider, expiresAt }
const PROVIDER_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const providerCache = new Map();

class AIService {
  constructor() {
    this.globalConfig = config.ai || { enabled: false };
    this.globalProvider = AIProviderFactory.create(this.globalConfig);
    this.rateLimiter = new AIRateLimiter(this.globalConfig);
  }

  /**
   * Get the AI provider for a specific entity.
   * Checks entity-specific MongoDB config first, falls back to global config.
   * Results are cached for 5 minutes.
   */
  async getProviderForEntity(entityParentRid) {
    // Check cache
    const cached = providerCache.get(entityParentRid);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.provider;
    }

    // Try entity-specific config from MongoDB
    try {
      const aiConfigData = require('../../data/ai-config');
      const providerConfig = await aiConfigData.getProviderConfig(entityParentRid);

      if (providerConfig) {
        const provider = AIProviderFactory.create({
          enabled: true,
          provider: providerConfig.provider,
          [providerConfig.provider]: providerConfig
        });

        if (provider && provider.isConfigured()) {
          providerCache.set(entityParentRid, { provider, expiresAt: Date.now() + PROVIDER_CACHE_TTL_MS });
          return provider;
        }
      }
    } catch (err) {
      log('warn', 'Could not load entity AI config, falling back to global', {
        entityParentRid,
        error: err.message
      });
    }

    // Fall back to global provider
    if (this.globalProvider && this.globalProvider.isConfigured()) {
      providerCache.set(entityParentRid, {
        provider: this.globalProvider,
        expiresAt: Date.now() + PROVIDER_CACHE_TTL_MS
      });
      return this.globalProvider;
    }

    return null;
  }

  /**
   * Invalidate cached provider for an entity (call after config change)
   */
  invalidateProviderCache(entityParentRid) {
    providerCache.delete(entityParentRid);
  }

  /**
   * Check if AI features are available for an entity
   */
  async isAvailable(entityParentRid = null) {
    if (!entityParentRid) {
      return !!(this.globalProvider && this.globalProvider.isConfigured() && this.globalConfig.enabled);
    }

    // If entity explicitly disabled AI in ai_configs, do not fall back to global
    try {
      const aiConfigData = require('../../data/ai-config');
      const entityConfig = await aiConfigData.getAIConfig(entityParentRid);
      if (entityConfig && entityConfig.enabled === false) {
        return false;
      }
    } catch (err) {
      // Non-fatal - proceed
    }

    const provider = await this.getProviderForEntity(entityParentRid);
    if (!provider) return false;

    // Also check ui_config entity-level disable flag
    try {
      const mongodb = require('../../mongodb');
      if (mongodb.isConnected()) {
        const db = await mongodb.getDbSafe();
        const uiConfig = await db.collection('ui_config').findOne({ entityParentRid });
        if (uiConfig && uiConfig.features && uiConfig.features.aiAssistant === false) {
          return false;
        }
      }
    } catch (err) {
      // Non-fatal - proceed
    }

    return true;
  }

  async checkRateLimit(entityParentRid) {
    return this.rateLimiter.checkLimit(entityParentRid);
  }

  getProviderName() {
    return this.globalProvider ? this.globalProvider.getName() : 'none';
  }

  // ---------------------------------------------------------------------------
  // Core operations
  // ---------------------------------------------------------------------------

  async _requireAvailable(entityParentRid) {
    const available = await this.isAvailable(entityParentRid);
    if (!available) {
      throw new Error('AI is not configured for this organization. Go to Settings → AI Configuration to add your API key.');
    }
    const rateCheck = await this.rateLimiter.checkLimit(entityParentRid);
    if (!rateCheck.allowed) {
      throw new Error(`Daily AI limit exceeded. Used ${rateCheck.usage}/${rateCheck.limit} requests today. Resets tomorrow.`);
    }
    return await this.getProviderForEntity(entityParentRid);
  }

  async _logAndRun(entityParentRid, operation, providerFn, requestData = {}) {
    const provider = await this._requireAvailable(entityParentRid);
    const startTime = Date.now();
    const logData = {
      entityParentRid,
      operation,
      provider: provider.getName(),
      request: { data: requestData },
      response: {},
      metadata: {},
      success: false
    };

    try {
      const result = await providerFn(provider);
      logData.response.data = result;
      logData.response.raw = typeof result === 'string' ? result : JSON.stringify(result);
      logData.metadata.latencyMs = Date.now() - startTime;
      logData.success = true;

      await this.rateLimiter.recordUsage(entityParentRid, operation, {
        provider: provider.getName(),
        ...requestData
      });
      await interactionLogger.logInteraction(logData);

      return result;
    } catch (error) {
      logData.success = false;
      logData.error = error.message;
      logData.metadata.latencyMs = Date.now() - startTime;
      await interactionLogger.logInteraction(logData).catch(() => {});
      log('error', `AI ${operation} failed`, { entityParentRid, error: error.message });
      throw error;
    }
  }

  async generateTransformation(entityParentRid, inputExample, outputExample, eventType) {
    return this._logAndRun(
      entityParentRid,
      'generate_transformation',
      (p) => p.generateTransformation(inputExample, outputExample, eventType),
      { inputExample, outputExample, eventType }
    );
  }

  async analyzeDocumentation(entityParentRid, documentation, eventType) {
    return this._logAndRun(
      entityParentRid,
      'analyze_documentation',
      (p) => p.analyzeDocumentation(documentation, eventType),
      { eventType, docLength: documentation.length }
    );
  }

  async suggestFieldMappings(entityParentRid, sourceFields, targetFields, apiContext) {
    return this._logAndRun(
      entityParentRid,
      'suggest_mappings',
      (p) => p.suggestFieldMappings(sourceFields, targetFields, apiContext),
      { sourceFields, targetFields, apiContext }
    );
  }

  async generateTestPayload(entityParentRid, eventType) {
    return this._logAndRun(
      entityParentRid,
      'generate_test_payload',
      (p) => p.generateTestPayload(eventType, entityParentRid),
      { eventType }
    );
  }

  async generateSchedulingScript(entityParentRid, description, mode, eventType) {
    return this._logAndRun(
      entityParentRid,
      'generate_scheduling_script',
      (p) => p.generateSchedulingScript(description, mode, eventType),
      { description, mode, eventType }
    );
  }

  /**
   * Analyze a delivery error and suggest a fix.
   * @param {number} entityParentRid
   * @param {object} errorContext - { logEntry, integrationConfig, payload, errorMessage }
   */
  async analyzeError(entityParentRid, errorContext) {
    const raw = await this._logAndRun(
      entityParentRid,
      'analyze_error',
      (p) => p.analyzeError(errorContext),
      { integrationId: errorContext.integrationConfig?._id }
    );
    return normalizeErrorAnalysis(raw);
  }

  /**
   * Conversational chat with entity context injected.
   * @param {number} entityParentRid
   * @param {Array} messages - [{role: 'user'|'assistant', content: string}]
   * @param {object} pageContext - { integrationId?, logId?, eventType?, page? }
   */
  async chat(entityParentRid, messages, pageContext = {}) {
    const provider = await this._requireAvailable(entityParentRid);

    // Build entity context from MongoDB
    const entityContext = await this._buildEntityContext(entityParentRid, pageContext);

    const startTime = Date.now();
    const logData = {
      entityParentRid,
      operation: 'chat',
      provider: provider.getName(),
      request: { data: { messageCount: messages.length, pageContext } },
      response: {},
      metadata: {},
      success: false
    };

    try {
      const reply = await provider.chat(messages, entityContext);
      logData.response.raw = reply;
      logData.metadata.latencyMs = Date.now() - startTime;
      logData.success = true;

      await this.rateLimiter.recordUsage(entityParentRid, 'chat', { provider: provider.getName() });
      await interactionLogger.logInteraction(logData);

      return reply;
    } catch (error) {
      logData.success = false;
      logData.error = error.message;
      logData.metadata.latencyMs = Date.now() - startTime;
      await interactionLogger.logInteraction(logData).catch(() => {});
      log('error', 'AI chat failed', { entityParentRid, error: error.message });
      throw error;
    }
  }

  /**
   * Explain or fix a transformation script.
   * @param {number} entityParentRid
   * @param {object} params - { code, errorMessage?, eventType? }
   */
  async explainTransformation(entityParentRid, params) {
    const raw = await this._logAndRun(
      entityParentRid,
      'explain_transformation',
      (p) => p.explainTransformation(params),
      { eventType: params.eventType, hasError: !!params.errorMessage }
    );
    return normalizeExplainTransformation(raw);
  }

  async getUsageStats(entityParentRid, days = 30) {
    return this.rateLimiter.getUsageStats(entityParentRid, days);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  async _buildEntityContext(entityParentRid, pageContext = {}) {
    const parts = [];

    try {
      const mongodb = require('../../mongodb');
      if (!mongodb.isConnected()) return '';

      const db = await mongodb.getDbSafe();

      // Fetch entity's integrations
      const integrations = await db.collection('integration_configs')
        .find({ entityParentRid, deletedAt: { $exists: false } })
        .project({ name: 1, type: 1, targetUrl: 1, httpMethod: 1, enabled: 1, eventType: 1 })
        .limit(10)
        .toArray();

      if (integrations.length > 0) {
        parts.push(`## This Organization's Integrations (${integrations.length} total)`);
        integrations.forEach(i => {
          parts.push(`- **${i.name}** (${i.type || 'outbound'}) → ${i.targetUrl || 'N/A'} [${i.enabled !== false ? 'enabled' : 'disabled'}]`);
        });
      }

      // Fetch recent errors
      const recentErrors = await db.collection('logs')
        .find({ entityParentRid, status: { $in: ['failed', 'error'] } })
        .sort({ createdAt: -1 })
        .limit(5)
        .project({ integrationName: 1, eventType: 1, error: 1, createdAt: 1, targetUrl: 1 })
        .toArray();

      if (recentErrors.length > 0) {
        parts.push(`\n## Recent Delivery Errors`);
        recentErrors.forEach(e => {
          const errMsg = (e.error || 'Unknown error').substring(0, 150);
          parts.push(`- **${e.integrationName || 'Unknown'}** [${e.eventType || '*'}]: ${errMsg}`);
        });
      }

      // Specific page context
      if (pageContext.integrationId) {
        try {
          const { ObjectId } = require('mongodb');
          const integration = await db.collection('integration_configs').findOne({
            _id: new ObjectId(pageContext.integrationId),
            entityParentRid
          });
          if (integration) {
            parts.push(`\n## Currently Viewing Integration: "${integration.name}"`);
            parts.push(`- Type: ${integration.type || 'outbound'}`);
            parts.push(`- Target: ${integration.targetUrl}`);
            parts.push(`- Event: ${integration.eventType || '*'}`);
            if (integration.transformation?.script) {
              parts.push(`- Has transformation script: yes`);
            }
          }
        } catch (e) { /* ignore invalid ObjectId */ }
      }

      if (pageContext.logId) {
        try {
          const { ObjectId } = require('mongodb');
          const logEntry = await db.collection('logs').findOne({
            _id: new ObjectId(pageContext.logId),
            entityParentRid
          });
          if (logEntry) {
            parts.push(`\n## Currently Viewing Log Entry`);
            parts.push(`- Integration: ${logEntry.integrationName || 'Unknown'}`);
            parts.push(`- Status: ${logEntry.status}`);
            parts.push(`- Error: ${(logEntry.error || 'none').substring(0, 200)}`);
          }
        } catch (e) { /* ignore */ }
      }
    } catch (err) {
      log('warn', 'Could not build entity context for AI chat', { error: err.message });
    }

    if (parts.length === 0) return '';

    return [
      '## Integration Gateway Context for This Organization',
      ...parts
    ].join('\n');
  }
}

// Singleton instance
const aiServiceInstance = new AIService();
module.exports = aiServiceInstance;
