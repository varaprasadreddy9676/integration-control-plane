/**
 * OpenAI Provider (GPT-4o-mini default)
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
  getSystemPrompt
} = require('../prompts');

class OpenAIProvider extends BaseAIProvider {
  constructor(config) {
    super(config);
    this.client = null;

    if (this.isConfigured()) {
      try {
        const OpenAI = require('openai');
        this.client = new OpenAI({ apiKey: config.apiKey });
      } catch (error) {
        log('warn', 'OpenAI SDK not installed. Run: npm install openai');
      }
    }
  }

  getName() { return 'openai'; }

  get model() { return this.config.model || 'gpt-4o-mini'; }

  /**
   * Core completion method.
   * @param {Array}   messages   - [{role, content}]
   * @param {object}  opts
   * @param {number}  opts.temperature
   * @param {number}  opts.maxTokens
   * @param {boolean} opts.jsonMode - request JSON output via response_format
   */
  async _complete(messages, { temperature = 0.3, maxTokens, jsonMode = false } = {}) {
    if (!this.client) throw new Error('OpenAI provider not configured or SDK not installed');
    const params = {
      model: this.model,
      messages,
      temperature,
      max_tokens: maxTokens || this.config.maxTokens || 2048
    };
    if (jsonMode) params.response_format = { type: 'json_object' };
    const response = await this.client.chat.completions.create(params);
    return response.choices[0].message.content.trim();
  }

  async testConnection() {
    if (!this.client) throw new Error('OpenAI provider not configured or SDK not installed');
    try {
      await this._complete(
        [{ role: 'user', content: 'Reply with just: ok' }],
        { temperature: 0, maxTokens: 5 }
      );
      return { model: this.model };
    } catch (error) {
      throw new Error(`OpenAI connection failed: ${error.message}`);
    }
  }

  async generateTransformation(inputExample, outputExample, eventType) {
    const prompt = await buildTransformationPrompt(inputExample, outputExample, eventType);
    try {
      return await this._complete([
        { role: 'system', content: getSystemPrompt() },
        { role: 'user', content: prompt }
      ], { temperature: 0.3 });
    } catch (error) {
      log('error', 'OpenAI generateTransformation failed', { error: error.message });
      throw new Error(`OpenAI API failed: ${error.message}`);
    }
  }

  async analyzeDocumentation(documentation, eventType) {
    const prompt = buildDocumentationAnalysisPrompt(documentation, eventType);
    try {
      const text = await this._complete([
        { role: 'system', content: getSystemPrompt() },
        { role: 'user', content: prompt }
      ], { temperature: 0.3, maxTokens: 4096, jsonMode: true });
      return extractJson(text);
    } catch (error) {
      log('error', 'OpenAI analyzeDocumentation failed', { error: error.message });
      throw new Error(`OpenAI API failed: ${error.message}`);
    }
  }

  async suggestFieldMappings(sourceFields, targetFields, apiContext) {
    const prompt = buildFieldMappingPrompt(sourceFields, targetFields, apiContext);
    try {
      const text = await this._complete([
        { role: 'system', content: getSystemPrompt() },
        { role: 'user', content: prompt }
      ], { temperature: 0.3, jsonMode: true });
      return extractJson(text, true);
    } catch (error) {
      log('error', 'OpenAI suggestFieldMappings failed', { error: error.message });
      throw new Error(`OpenAI API failed: ${error.message}`);
    }
  }

  async generateTestPayload(eventType, orgId) {
    const prompt = await buildTestPayloadPrompt(eventType, orgId);
    try {
      const text = await this._complete([
        { role: 'system', content: getSystemPrompt() },
        { role: 'user', content: prompt }
      ], { temperature: 1.0, maxTokens: 3072, jsonMode: true });
      return extractJson(text);
    } catch (error) {
      log('error', 'OpenAI generateTestPayload failed', { error: error.message });
      throw new Error(`OpenAI API failed: ${error.message}`);
    }
  }

  async generateSchedulingScript(description, mode, eventType) {
    const prompt = await buildSchedulingScriptPrompt(description, mode, eventType);
    try {
      return await this._complete([
        { role: 'system', content: getSystemPrompt() },
        { role: 'user', content: prompt }
      ], { temperature: 0.3, maxTokens: 1024 });
    } catch (error) {
      log('error', 'OpenAI generateSchedulingScript failed', { error: error.message });
      throw new Error(`OpenAI API failed: ${error.message}`);
    }
  }

  async analyzeError(errorContext) {
    const prompt = buildErrorAnalysisPrompt(errorContext);
    try {
      const text = await this._complete([
        { role: 'system', content: getSystemPrompt() },
        { role: 'user', content: prompt }
      ], { temperature: 0.2, maxTokens: 2048, jsonMode: true });
      return extractJson(text);
    } catch (error) {
      log('error', 'OpenAI analyzeError failed', { error: error.message });
      throw new Error(`OpenAI API failed: ${error.message}`);
    }
  }

  async chat(messages, entityContext) {
    // Merge system + entity context into a single system message
    const systemContent = entityContext
      ? `${getSystemPrompt()}\n\n${entityContext}`
      : getSystemPrompt();
    try {
      return await this._complete(
        [{ role: 'system', content: systemContent }, ...messages],
        { temperature: 0.2, maxTokens: 2048 }
      );
    } catch (error) {
      log('error', 'OpenAI chat failed', { error: error.message });
      throw new Error(`OpenAI API failed: ${error.message}`);
    }
  }

  async explainTransformation(params) {
    const prompt = buildExplainTransformationPrompt(params);
    try {
      const text = await this._complete([
        { role: 'system', content: getSystemPrompt() },
        { role: 'user', content: prompt }
      ], { temperature: 0.2, maxTokens: 2048, jsonMode: true });
      return extractJson(text);
    } catch (error) {
      log('error', 'OpenAI explainTransformation failed', { error: error.message });
      throw new Error(`OpenAI API failed: ${error.message}`);
    }
  }
}

module.exports = OpenAIProvider;
