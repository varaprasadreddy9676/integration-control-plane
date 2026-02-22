/**
 * Kimi (Moonshot AI) Provider - OpenAI-compatible API
 */

const BaseAIProvider = require('./base-provider');
const { log } = require('../../../logger');
const { extractJson } = require('../utils/extract-json');
const {
  buildTransformationPrompt,
  buildDocumentationAnalysisPrompt,
  buildFieldMappingPrompt,
  buildTestPayloadPrompt,
  buildSchedulingScriptPrompt,
  buildErrorAnalysisPrompt,
  buildExplainTransformationPrompt,
  getSystemPrompt,
} = require('../prompts');

class KimiProvider extends BaseAIProvider {
  constructor(config) {
    super(config);
    this.client = null;

    if (this.isConfigured()) {
      try {
        const OpenAI = require('openai');
        this.client = new OpenAI({
          apiKey: config.apiKey,
          baseURL: 'https://api.moonshot.ai/v1',
        });
      } catch (_error) {
        log('warn', 'OpenAI SDK not installed (required for Kimi). Run: npm install openai');
      }
    }
  }

  getName() {
    return 'kimi';
  }

  get model() {
    return this.config.model || 'moonshot-v1-8k';
  }

  /**
   * Core completion method.
   * @param {Array}   messages
   * @param {object}  opts
   * @param {boolean} opts.jsonMode - request JSON output via response_format
   */
  async _complete(messages, { temperature = 0.3, maxTokens, jsonMode = false } = {}) {
    if (!this.client) throw new Error('Kimi provider not configured or OpenAI SDK not installed');
    const params = {
      model: this.model,
      messages,
      temperature,
      max_tokens: maxTokens || this.config.maxTokens || 2048,
    };
    if (jsonMode) params.response_format = { type: 'json_object' };
    const response = await this.client.chat.completions.create(params);
    return response.choices[0].message.content.trim();
  }

  async testConnection() {
    if (!this.client) throw new Error('Kimi provider not configured or OpenAI SDK not installed');
    try {
      await this._complete([{ role: 'user', content: 'Reply with just: ok' }], { temperature: 0, maxTokens: 10 });
      return { model: this.model };
    } catch (error) {
      throw new Error(`Kimi connection failed: ${error.message}`);
    }
  }

  async generateTransformation(inputExample, outputExample, eventType) {
    const prompt = await buildTransformationPrompt(inputExample, outputExample, eventType);
    try {
      return await this._complete(
        [
          { role: 'system', content: getSystemPrompt() },
          { role: 'user', content: prompt },
        ],
        { temperature: 0.3 }
      );
    } catch (error) {
      log('error', 'Kimi generateTransformation failed', { error: error.message });
      throw new Error(`Kimi API failed: ${error.message}`);
    }
  }

  async analyzeDocumentation(documentation, eventType) {
    const prompt = buildDocumentationAnalysisPrompt(documentation, eventType);
    try {
      const text = await this._complete(
        [
          { role: 'system', content: getSystemPrompt() },
          { role: 'user', content: prompt },
        ],
        { temperature: 0.3, maxTokens: 4096, jsonMode: true }
      );
      return extractJson(text);
    } catch (error) {
      log('error', 'Kimi analyzeDocumentation failed', { error: error.message });
      throw new Error(`Kimi API failed: ${error.message}`);
    }
  }

  async suggestFieldMappings(sourceFields, targetFields, apiContext) {
    const prompt = buildFieldMappingPrompt(sourceFields, targetFields, apiContext);
    try {
      const text = await this._complete(
        [
          { role: 'system', content: getSystemPrompt() },
          { role: 'user', content: prompt },
        ],
        { temperature: 0.3, jsonMode: true }
      );
      return extractJson(text, true);
    } catch (error) {
      log('error', 'Kimi suggestFieldMappings failed', { error: error.message });
      throw new Error(`Kimi API failed: ${error.message}`);
    }
  }

  async generateTestPayload(eventType, orgId) {
    const prompt = await buildTestPayloadPrompt(eventType, orgId);
    try {
      const text = await this._complete(
        [
          { role: 'system', content: getSystemPrompt() },
          { role: 'user', content: prompt },
        ],
        { temperature: 1.0, maxTokens: 3072, jsonMode: true }
      );
      return extractJson(text);
    } catch (error) {
      log('error', 'Kimi generateTestPayload failed', { error: error.message });
      throw new Error(`Kimi API failed: ${error.message}`);
    }
  }

  async generateSchedulingScript(description, mode, eventType) {
    const prompt = await buildSchedulingScriptPrompt(description, mode, eventType);
    try {
      return await this._complete(
        [
          { role: 'system', content: getSystemPrompt() },
          { role: 'user', content: prompt },
        ],
        { temperature: 0.3, maxTokens: 1024 }
      );
    } catch (error) {
      log('error', 'Kimi generateSchedulingScript failed', { error: error.message });
      throw new Error(`Kimi API failed: ${error.message}`);
    }
  }

  async analyzeError(errorContext) {
    const prompt = buildErrorAnalysisPrompt(errorContext);
    try {
      const text = await this._complete(
        [
          { role: 'system', content: getSystemPrompt() },
          { role: 'user', content: prompt },
        ],
        { temperature: 0.2, maxTokens: 2048, jsonMode: true }
      );
      return extractJson(text);
    } catch (error) {
      log('error', 'Kimi analyzeError failed', { error: error.message });
      throw new Error(`Kimi API failed: ${error.message}`);
    }
  }

  async chat(messages, entityContext) {
    // Merge system + entity context into a single system message
    const systemContent = entityContext ? `${getSystemPrompt()}\n\n${entityContext}` : getSystemPrompt();
    try {
      return await this._complete([{ role: 'system', content: systemContent }, ...messages], {
        temperature: 0.2,
        maxTokens: 2048,
      });
    } catch (error) {
      log('error', 'Kimi chat failed', { error: error.message });
      throw new Error(`Kimi API failed: ${error.message}`);
    }
  }

  async explainTransformation(params) {
    const prompt = buildExplainTransformationPrompt(params);
    try {
      const text = await this._complete(
        [
          { role: 'system', content: getSystemPrompt() },
          { role: 'user', content: prompt },
        ],
        { temperature: 0.2, maxTokens: 2048, jsonMode: true }
      );
      return extractJson(text);
    } catch (error) {
      log('error', 'Kimi explainTransformation failed', { error: error.message });
      throw new Error(`Kimi API failed: ${error.message}`);
    }
  }
}

module.exports = KimiProvider;
