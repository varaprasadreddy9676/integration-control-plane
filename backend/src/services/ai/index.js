/**
 * AI Service - Main Entry Point
 * Provider-agnostic AI service with per-entity dynamic providers and rate limiting.
 */

const AIProviderFactory = require('./provider-factory');
const AIRateLimiter = require('./rate-limiter');
const interactionLogger = require('./interaction-logger');
const { log } = require('../../logger');
const { normalizeErrorAnalysis, normalizeExplainTransformation } = require('./prompts');
const { parsePositiveInt } = require('../../utils/org-context');

// Provider cache: orgId → { provider, expiresAt }
const PROVIDER_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const providerCache = new Map();

function normalizeOrgId(value) {
  return parsePositiveInt(value);
}

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function mergeObjects(base, override) {
  const result = { ...(base || {}) };
  for (const [key, value] of Object.entries(override || {})) {
    if (isPlainObject(value) && isPlainObject(result[key])) {
      result[key] = mergeObjects(result[key], value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

function stripUiConfig(doc) {
  if (!doc || typeof doc !== 'object') return {};
  const { _id, orgId, entityParentRid, createdAt, updatedAt, ...rest } = doc;
  return rest;
}

class AIService {
  constructor() {
    this.rateLimiter = new AIRateLimiter();
  }

  /**
   * Get the AI provider for a specific organization.
   * Reads entirely from MongoDB — no config.json fallback.
   * Results are cached for 5 minutes.
   */
  async getProviderForEntity(orgId) {
    const normalizedOrgId = normalizeOrgId(orgId);
    if (!normalizedOrgId) return null;

    // Check cache
    const cached = providerCache.get(normalizedOrgId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.provider;
    }

    // Load entity-specific config from MongoDB — no config.json fallback
    try {
      const aiConfigData = require('../../data/ai-config');
      const providerConfig = await aiConfigData.getProviderConfig(normalizedOrgId);

      if (providerConfig) {
        const provider = AIProviderFactory.create({
          enabled: true,
          provider: providerConfig.provider,
          [providerConfig.provider]: providerConfig,
        });

        if (provider?.isConfigured()) {
          providerCache.set(normalizedOrgId, { provider, expiresAt: Date.now() + PROVIDER_CACHE_TTL_MS });
          return provider;
        }
      }
    } catch (err) {
      log('warn', 'Could not load entity AI config from DB', {
        orgId: normalizedOrgId,
        error: err.message,
      });
    }

    return null;
  }

  /**
   * Invalidate cached provider for an entity (call after config change)
   */
  invalidateProviderCache(orgId) {
    const normalizedOrgId = normalizeOrgId(orgId);
    if (normalizedOrgId) {
      providerCache.delete(normalizedOrgId);
    }
  }

  /**
   * Check if AI features are available for an organization
   */
  async isAvailable(orgId = null) {
    const normalizedOrgId = normalizeOrgId(orgId);
    if (!normalizedOrgId) return false;

    // If entity explicitly disabled AI in ai_configs, stop immediately
    try {
      const aiConfigData = require('../../data/ai-config');
      const entityConfig = await aiConfigData.getAIConfig(normalizedOrgId);
      if (entityConfig && entityConfig.enabled === false) {
        return false;
      }
    } catch (_err) {
      // Non-fatal - proceed
    }

    const provider = await this.getProviderForEntity(normalizedOrgId);
    if (!provider) return false;

    // Also check ui_config entity-level disable flag
    try {
      const mongodb = require('../../mongodb');
      if (mongodb.isConnected()) {
        const db = await mongodb.getDbSafe();
        // entityParentRid fallback: legacy alias for orgId used in pre-migration documents
        const uiConfig = await db.collection('ui_config').findOne({
          $or: [{ orgId: normalizedOrgId }, { entityParentRid: normalizedOrgId }],
        });
        const aiAssistantFlag = uiConfig?.features?.aiAssistant;
        const aiAssistantLegacyFlag = uiConfig?.features?.ai_assistant;
        if (aiAssistantFlag === false || aiAssistantLegacyFlag === false) {
          return false;
        }
      }
    } catch (_err) {
      // Non-fatal - proceed
    }

    return true;
  }

  async checkRateLimit(orgId) {
    const normalizedOrgId = normalizeOrgId(orgId);
    if (!normalizedOrgId) {
      return {
        allowed: false,
        usage: 0,
        limit: 0,
        remaining: 0,
      };
    }
    return this.rateLimiter.checkLimit(normalizedOrgId);
  }

  async getProviderNameForEntity(orgId) {
    const provider = await this.getProviderForEntity(orgId);
    return provider ? provider.getName() : 'none';
  }

  // ---------------------------------------------------------------------------
  // Core operations
  // ---------------------------------------------------------------------------

  async _requireAvailable(orgId) {
    const normalizedOrgId = normalizeOrgId(orgId);
    if (!normalizedOrgId) {
      throw new Error(
        'AI is not configured for this organization. Go to Settings → AI Configuration to add your API key.'
      );
    }

    const available = await this.isAvailable(normalizedOrgId);
    if (!available) {
      throw new Error(
        'AI is not configured for this organization. Go to Settings → AI Configuration to add your API key.'
      );
    }
    const rateCheck = await this.rateLimiter.checkLimit(normalizedOrgId);
    if (!rateCheck.allowed) {
      const limitDisplay = rateCheck.limit === 0 ? 'unlimited' : rateCheck.limit;
      throw new Error(
        `Daily AI limit exceeded. Used ${rateCheck.usage}/${limitDisplay} requests today. Resets tomorrow.`
      );
    }
    return await this.getProviderForEntity(normalizedOrgId);
  }

  async _logAndRun(orgId, operation, providerFn, requestData = {}) {
    const normalizedOrgId = normalizeOrgId(orgId);
    const provider = await this._requireAvailable(normalizedOrgId);
    const startTime = Date.now();
    const logData = {
      orgId: normalizedOrgId,
      operation,
      provider: provider.getName(),
      request: { data: requestData },
      response: {},
      metadata: {},
      success: false,
    };

    try {
      const result = await providerFn(provider);
      logData.response.data = result;
      logData.response.raw = typeof result === 'string' ? result : JSON.stringify(result);
      logData.metadata.latencyMs = Date.now() - startTime;
      logData.success = true;

      await this.rateLimiter.recordUsage(normalizedOrgId, operation, {
        provider: provider.getName(),
        ...requestData,
      });
      await interactionLogger.logInteraction(logData);

      return result;
    } catch (error) {
      logData.success = false;
      logData.error = error.message;
      logData.metadata.latencyMs = Date.now() - startTime;
      await interactionLogger.logInteraction(logData).catch(() => {});
      log('error', `AI ${operation} failed`, { orgId: normalizedOrgId, error: error.message });
      throw error;
    }
  }

  async generateTransformation(orgId, inputExample, outputExample, eventType) {
    return this._logAndRun(
      orgId,
      'generate_transformation',
      (p) => p.generateTransformation(inputExample, outputExample, eventType),
      { inputExample, outputExample, eventType }
    );
  }

  async analyzeDocumentation(orgId, documentation, eventType) {
    return this._logAndRun(orgId, 'analyze_documentation', (p) => p.analyzeDocumentation(documentation, eventType), {
      eventType,
      docLength: documentation.length,
    });
  }

  async suggestFieldMappings(orgId, sourceFields, targetFields, apiContext) {
    return this._logAndRun(
      orgId,
      'suggest_mappings',
      (p) => p.suggestFieldMappings(sourceFields, targetFields, apiContext),
      { sourceFields, targetFields, apiContext }
    );
  }

  async generateTestPayload(orgId, eventType) {
    const normalizedOrgId = normalizeOrgId(orgId);
    return this._logAndRun(
      normalizedOrgId,
      'generate_test_payload',
      (p) => p.generateTestPayload(eventType, normalizedOrgId),
      { eventType }
    );
  }

  async generateSchedulingScript(orgId, description, mode, eventType) {
    return this._logAndRun(
      orgId,
      'generate_scheduling_script',
      (p) => p.generateSchedulingScript(description, mode, eventType),
      { description, mode, eventType }
    );
  }

  /**
   * Analyze a delivery error and suggest a fix.
   * @param {number} orgId
   * @param {object} errorContext - { logEntry, integrationConfig, payload, errorMessage }
   */
  async analyzeError(orgId, errorContext) {
    const raw = await this._logAndRun(orgId, 'analyze_error', (p) => p.analyzeError(errorContext), {
      integrationId: errorContext.integrationConfig?._id,
    });
    return normalizeErrorAnalysis(raw);
  }

  /**
   * Conversational chat with org context injected.
   * @param {number} orgId
   * @param {Array} messages - [{role: 'user'|'assistant', content: string}]
   * @param {object} pageContext - { integrationId?, logId?, eventType?, page? }
   */
  async chat(orgId, messages, pageContext = {}) {
    const normalizedOrgId = normalizeOrgId(orgId);
    const provider = await this._requireAvailable(normalizedOrgId);

    // Build entity context from MongoDB
    const entityContext = await this._buildEntityContext(normalizedOrgId, pageContext);
    const groundedContext = [entityContext, this._buildGroundingContract()].filter(Boolean).join('\n\n');

    const startTime = Date.now();
    const logData = {
      orgId: normalizedOrgId,
      operation: 'chat',
      provider: provider.getName(),
      request: { data: { messageCount: messages.length, pageContext } },
      response: {},
      metadata: {},
      success: false,
    };

    try {
      const reply = await provider.chat(messages, groundedContext);
      logData.response.raw = reply;
      logData.metadata.latencyMs = Date.now() - startTime;
      logData.success = true;

      await this.rateLimiter.recordUsage(normalizedOrgId, 'chat', { provider: provider.getName() });
      await interactionLogger.logInteraction(logData);

      return reply;
    } catch (error) {
      logData.success = false;
      logData.error = error.message;
      logData.metadata.latencyMs = Date.now() - startTime;
      await interactionLogger.logInteraction(logData).catch(() => {});
      log('error', 'AI chat failed', { orgId: normalizedOrgId, error: error.message });
      throw error;
    }
  }

  /**
   * Explain or fix a transformation script.
   * @param {number} orgId
   * @param {object} params - { code, errorMessage?, eventType? }
   */
  async explainTransformation(orgId, params) {
    const raw = await this._logAndRun(orgId, 'explain_transformation', (p) => p.explainTransformation(params), {
      eventType: params.eventType,
      hasError: !!params.errorMessage,
    });
    return normalizeExplainTransformation(raw);
  }

  async getUsageStats(orgId, days = 30) {
    const normalizedOrgId = normalizeOrgId(orgId);
    if (!normalizedOrgId) {
      return {
        totalUsage: 0,
        byOperation: {},
        byDay: {},
        period: `${days} days`,
      };
    }
    return this.rateLimiter.getUsageStats(normalizedOrgId, days);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  _buildGroundingContract() {
    return [
      '## Response Contract (Strict Grounding)',
      '- Only claim facts that are explicitly present in the provided context or the user message.',
      '- If evidence is missing, say exactly: "Unknown from available context."',
      '- Do NOT invent integrations, statuses, URLs, events, or configuration values.',
      '- Separate your answer into exactly these sections in order:',
      '  1) `Known Facts`',
      '  2) `Unknowns`',
      '  3) `Recommended Next Checks`',
      '- Keep each bullet concise and operational.',
    ].join('\n');
  }

  async _buildEntityContext(orgId, pageContext = {}) {
    const normalizedOrgId = normalizeOrgId(orgId);
    if (!normalizedOrgId) return '';

    const parts = [];
    const errorStatuses = ['FAILED', 'ABANDONED', 'ERROR', 'failed', 'abandoned', 'error'];
    // Legacy field aliases included so existing log documents stored under old field names are still found
    const orgScope = {
      $or: [
        { orgId: normalizedOrgId },
        { entityRid: normalizedOrgId }, // legacy alias
        { entityParentRid: normalizedOrgId }, // legacy alias
      ],
    };
    const errorScope = orgScope;

    try {
      const mongodb = require('../../mongodb');
      if (!mongodb.isConnected()) return '';

      const db = await mongodb.getDbSafe();

      // Fetch entity's integrations
      const integrations = await db
        .collection('integration_configs')
        .find({ ...orgScope, deletedAt: { $exists: false } })
        .project({
          name: 1,
          direction: 1,
          type: 1,
          targetUrl: 1,
          httpMethod: 1,
          isActive: 1,
          eventType: 1,
          updatedAt: 1,
        })
        .sort({ updatedAt: -1 })
        .limit(25)
        .toArray();

      if (integrations.length > 0) {
        const activeCount = integrations.filter((i) => i.isActive !== false).length;
        const inactiveCount = integrations.length - activeCount;
        const byDirection = integrations.reduce((acc, i) => {
          const key = (i.direction || i.type || 'outbound').toLowerCase();
          acc[key] = (acc[key] || 0) + 1;
          return acc;
        }, {});

        parts.push(`## This Organization's Integrations (sample: ${integrations.length} most recently updated)`);
        parts.push(`- Active: ${activeCount}`);
        parts.push(`- Inactive: ${inactiveCount}`);
        parts.push(
          `- Direction mix: ${Object.entries(byDirection)
            .map(([k, v]) => `${k}=${v}`)
            .join(', ')}`
        );
        integrations.slice(0, 12).forEach((i) => {
          parts.push(
            `- **${i.name}** (${(i.direction || i.type || 'outbound').toLowerCase()}) → ${i.targetUrl || 'N/A'} [${i.isActive !== false ? 'enabled' : 'disabled'}]`
          );
        });
        if (integrations.length > 12) {
          parts.push(`- ...and ${integrations.length - 12} more integrations in context window`);
        }
      }

      // Fetch recent errors
      const recentErrors = await db
        .collection('execution_logs')
        .find({ ...errorScope, status: { $in: errorStatuses } })
        .sort({ createdAt: -1 })
        .limit(8)
        .project({
          __KEEP_integrationName__: 1,
          __KEEP___KEEP_integrationConfig__Id__: 1,
          eventType: 1,
          errorMessage: 1,
          status: 1,
          createdAt: 1,
          targetUrl: 1,
        })
        .toArray();

      if (recentErrors.length > 0) {
        parts.push(`\n## Recent Delivery Errors`);
        recentErrors.forEach((e) => {
          const errMsg = String(e.errorMessage || 'Unknown error').substring(0, 150);
          parts.push(
            `- **${e.__KEEP_integrationName__ || 'Unknown'}** [${e.eventType || '*'} | ${e.status || 'FAILED'}]: ${errMsg}`
          );
        });
      }

      const topFailingIntegrations = await db
        .collection('execution_logs')
        .aggregate([
          { $match: { ...errorScope, status: { $in: errorStatuses } } },
          {
            $group: {
              _id: {
                integrationId: '$__KEEP___KEEP_integrationConfig__Id__',
                integrationName: '$__KEEP_integrationName__',
              },
              count: { $sum: 1 },
              latestError: { $max: '$createdAt' },
            },
          },
          { $sort: { count: -1, latestError: -1 } },
          { $limit: 5 },
        ])
        .toArray();

      if (topFailingIntegrations.length > 0) {
        parts.push(`\n## Most Error-Prone Integrations (current context window)`);
        topFailingIntegrations.forEach((row) => {
          parts.push(`- **${row._id.integrationName || 'Unknown'}**: ${row.count} recent failures`);
        });
      }

      // Effective UI config: default + org override (safe subset only)
      // entityParentRid fallback: legacy alias for orgId used in pre-migration documents
      const defaultUiDoc = await db.collection('ui_config').findOne({ _id: 'default' });
      const orgUiDoc = await db.collection('ui_config').findOne({
        $or: [{ orgId: normalizedOrgId }, { entityParentRid: normalizedOrgId }],
      });
      const effectiveUiConfig = mergeObjects(stripUiConfig(defaultUiDoc), stripUiConfig(orgUiDoc));

      if (Object.keys(effectiveUiConfig).length > 0) {
        const failureReports = effectiveUiConfig?.notifications?.failureEmailReports || {};
        const aiAssistantEnabled =
          effectiveUiConfig?.features?.aiAssistant !== false && effectiveUiConfig?.features?.ai_assistant !== false;
        parts.push(`\n## Effective UI Config (safe summary)`);
        parts.push(`- AI assistant feature flag: ${aiAssistantEnabled ? 'enabled' : 'disabled'}`);
        parts.push(
          `- Failure reports: ${failureReports.enabled ? 'enabled' : 'disabled'} (interval: ${failureReports.intervalMinutes ?? 'n/a'} min, lookback: ${failureReports.lookbackMinutes ?? 'n/a'} min)`
        );
        parts.push(`- Failure report recipient override: ${failureReports.email ? 'configured' : 'not configured'}`);
        parts.push(`- Multi-action delay: ${effectiveUiConfig?.worker?.multiActionDelayMs ?? 0} ms`);
        parts.push(`- Dashboard auto-refresh: ${effectiveUiConfig?.dashboard?.autoRefreshSeconds ?? 30} sec`);
      }

      // Effective system runtime config: safe operational subset only
      const runtimeConfig = require('../../config');
      parts.push(`\n## Effective System Config (safe summary)`);
      parts.push(`- Event source: ${runtimeConfig?.eventSource?.type || 'unknown'}`);
      parts.push(
        `- Worker: enabled=${runtimeConfig?.worker?.enabled !== false}, intervalMs=${runtimeConfig?.worker?.intervalMs ?? 'n/a'}, batchSize=${runtimeConfig?.worker?.batchSize ?? 'n/a'}, timeoutMs=${runtimeConfig?.worker?.timeoutMs ?? 'n/a'}`
      );
      parts.push(
        `- Scheduler: enabled=${runtimeConfig?.scheduler?.enabled !== false}, intervalMs=${runtimeConfig?.scheduler?.intervalMs ?? 'n/a'}, batchSize=${runtimeConfig?.scheduler?.batchSize ?? 'n/a'}`
      );
      parts.push(
        `- Security flags: enforceHttps=${runtimeConfig?.security?.enforceHttps !== false}, blockPrivateNetworks=${runtimeConfig?.security?.blockPrivateNetworks !== false}`
      );
      parts.push(
        `- Event audit: enabled=${runtimeConfig?.eventAudit?.enabled !== false}, retentionDays=${runtimeConfig?.eventAudit?.retentionDays ?? 'n/a'}`
      );

      // Specific page context
      if (pageContext.integrationId) {
        try {
          const { ObjectId } = require('mongodb');
          const integrationObjectId = new ObjectId(pageContext.integrationId);
          const integration = await db
            .collection('integration_configs')
            .findOne(
              { _id: integrationObjectId, ...orgScope },
              { projection: { name: 1, direction: 1, type: 1, targetUrl: 1, eventType: 1, transformation: 1 } }
            );
          if (integration) {
            parts.push(`\n## Currently Viewing Integration: "${integration.name}"`);
            parts.push(`- Type: ${(integration.direction || integration.type || 'outbound').toLowerCase()}`);
            parts.push(`- Target: ${integration.targetUrl}`);
            parts.push(`- Event: ${integration.eventType || '*'}`);
            if (integration.transformation?.script) {
              parts.push(`- Has transformation script: yes`);
            }

            const integrationRecentErrors = await db
              .collection('execution_logs')
              .find({
                ...errorScope,
                status: { $in: errorStatuses },
                $or: [
                  { __KEEP___KEEP_integrationConfig__Id__: integrationObjectId },
                  { __KEEP___KEEP_integrationConfig__Id__: pageContext.integrationId },
                ],
              })
              .sort({ createdAt: -1 })
              .limit(5)
              .project({ eventType: 1, status: 1, errorMessage: 1, createdAt: 1 })
              .toArray();

            if (integrationRecentErrors.length > 0) {
              parts.push(`- Recent failures for this integration:`);
              integrationRecentErrors.forEach((err) => {
                parts.push(
                  `  - [${err.status || 'FAILED'} | ${err.eventType || '*'}] ${String(err.errorMessage || 'Unknown error').substring(0, 140)}`
                );
              });
            }
          }
        } catch (_e) {
          /* ignore invalid ObjectId */
        }
      }

      if (pageContext.logId) {
        try {
          const { ObjectId } = require('mongodb');
          const logEntry = await db.collection('execution_logs').findOne({
            _id: new ObjectId(pageContext.logId),
            orgId: normalizedOrgId,
          });
          if (logEntry) {
            parts.push(`\n## Currently Viewing Log Entry`);
            parts.push(`- Integration: ${logEntry.__KEEP_integrationName__ || 'Unknown'}`);
            parts.push(`- Status: ${logEntry.status}`);
            parts.push(`- Error: ${String(logEntry.errorMessage || 'none').substring(0, 200)}`);
          }
        } catch (_e) {
          /* ignore */
        }
      }

      if (pageContext.eventType) {
        const eventTypeErrors = await db
          .collection('execution_logs')
          .find({
            ...errorScope,
            status: { $in: errorStatuses },
            eventType: pageContext.eventType,
          })
          .sort({ createdAt: -1 })
          .limit(5)
          .project({ __KEEP_integrationName__: 1, status: 1, errorMessage: 1, createdAt: 1 })
          .toArray();

        if (eventTypeErrors.length > 0) {
          parts.push(`\n## Recent Errors for Event Type: ${pageContext.eventType}`);
          eventTypeErrors.forEach((err) => {
            parts.push(
              `- **${err.__KEEP_integrationName__ || 'Unknown'}** [${err.status || 'FAILED'}]: ${String(err.errorMessage || 'Unknown error').substring(0, 140)}`
            );
          });
        }
      }
    } catch (err) {
      log('warn', 'Could not build entity context for AI chat', { error: err.message });
    }

    if (parts.length === 0) return '';

    return ['## Integration Gateway Context for This Organization', ...parts].join('\n');
  }
}

// Singleton instance
const aiServiceInstance = new AIService();
module.exports = aiServiceInstance;
