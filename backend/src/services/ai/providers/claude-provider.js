/**
 * Claude AI Provider (Anthropic)
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

class ClaudeProvider extends BaseAIProvider {
  constructor(config) {
    super(config);
    this.client = null;

    if (this.isConfigured()) {
      try {
        const Anthropic = require('@anthropic-ai/sdk');
        this.client = new Anthropic({ apiKey: config.apiKey });
      } catch (_error) {
        log('warn', 'Claude SDK not installed. Run: npm install @anthropic-ai/sdk');
      }
    }
  }

  getName() {
    return 'claude';
  }

  get model() {
    return this.config.model || 'claude-3-5-sonnet-20241022';
  }

  /**
   * Core completion method.
   * Claude places the system prompt in a top-level `system` field, not inside
   * the messages array.  The `jsonMode` flag is honoured via explicit prompt
   * wording (Anthropic models reliably follow "respond with valid JSON only").
   *
   * @param {string} userContent   - The full user-turn prompt text
   * @param {object} opts
   * @param {string} opts.systemContent - System prompt text
   * @param {number} opts.maxTokens
   * @param {number} opts.temperature
   */
  async _complete(userContent, { systemContent, maxTokens = 2048, temperature = 0.3 } = {}) {
    if (!this.client) throw new Error('Claude provider not configured or SDK not installed');
    const params = {
      model: this.model,
      max_tokens: maxTokens,
      temperature,
      messages: [{ role: 'user', content: userContent }],
    };
    if (systemContent) params.system = systemContent;
    const response = await this.client.messages.create(params);
    return response.content[0].text.trim();
  }

  async testConnection() {
    if (!this.client) throw new Error('Claude provider not configured or SDK not installed');
    try {
      await this._complete('Reply with just: ok', { maxTokens: 10 });
      return { model: this.model };
    } catch (error) {
      throw new Error(`Claude connection failed: ${error.message}`);
    }
  }

  async generateTransformation(inputExample, outputExample, eventType) {
    const prompt = await buildTransformationPrompt(inputExample, outputExample, eventType);
    try {
      return await this._complete(prompt, { systemContent: getSystemPrompt(), maxTokens: 2048 });
    } catch (error) {
      log('error', 'Claude generateTransformation failed', { error: error.message });
      throw new Error(`Claude API failed: ${error.message}`);
    }
  }

  async analyzeDocumentation(documentation, eventType) {
    const prompt = buildDocumentationAnalysisPrompt(documentation, eventType);
    try {
      const text = await this._complete(prompt, { systemContent: getSystemPrompt(), maxTokens: 4096 });
      return extractJson(text);
    } catch (error) {
      log('error', 'Claude analyzeDocumentation failed', { error: error.message });
      throw new Error(`Claude API failed: ${error.message}`);
    }
  }

  async suggestFieldMappings(sourceFields, targetFields, apiContext) {
    const prompt = buildFieldMappingPrompt(sourceFields, targetFields, apiContext);
    try {
      const text = await this._complete(prompt, { systemContent: getSystemPrompt(), maxTokens: 2048 });
      return extractJson(text, true);
    } catch (error) {
      log('error', 'Claude suggestFieldMappings failed', { error: error.message });
      throw new Error(`Claude API failed: ${error.message}`);
    }
  }

  async generateTestPayload(eventType, orgId) {
    const prompt = await buildTestPayloadPrompt(eventType, orgId);
    try {
      const text = await this._complete(prompt, { systemContent: getSystemPrompt(), maxTokens: 3072 });
      return extractJson(text);
    } catch (error) {
      log('error', 'Claude generateTestPayload failed', { error: error.message });
      throw new Error(`Claude API failed: ${error.message}`);
    }
  }

  async generateSchedulingScript(description, mode, eventType) {
    const prompt = await buildSchedulingScriptPrompt(description, mode, eventType);
    try {
      return await this._complete(prompt, { systemContent: getSystemPrompt(), maxTokens: 1024 });
    } catch (error) {
      log('error', 'Claude generateSchedulingScript failed', { error: error.message });
      throw new Error(`Claude API failed: ${error.message}`);
    }
  }

  async analyzeError(errorContext) {
    const prompt = buildErrorAnalysisPrompt(errorContext);
    try {
      const text = await this._complete(prompt, { systemContent: getSystemPrompt(), maxTokens: 2048 });
      return extractJson(text);
    } catch (error) {
      log('error', 'Claude analyzeError failed', { error: error.message });
      throw new Error(`Claude API failed: ${error.message}`);
    }
  }

  async chat(messages, entityContext) {
    // Merge system + entity context into a single system string (Anthropic spec)
    const systemContent = entityContext ? `${getSystemPrompt()}\n\n${entityContext}` : getSystemPrompt();

    if (!this.client) throw new Error('Claude provider not configured or SDK not installed');
    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 2048,
        temperature: 0.2,
        system: systemContent,
        messages,
      });
      return response.content[0].text.trim();
    } catch (error) {
      log('error', 'Claude chat failed', { error: error.message });
      throw new Error(`Claude API failed: ${error.message}`);
    }
  }

  async explainTransformation(params) {
    const prompt = buildExplainTransformationPrompt(params);
    try {
      const text = await this._complete(prompt, { systemContent: getSystemPrompt(), maxTokens: 2048 });
      return extractJson(text);
    } catch (error) {
      log('error', 'Claude explainTransformation failed', { error: error.message });
      throw new Error(`Claude API failed: ${error.message}`);
    }
  }
}

module.exports = ClaudeProvider;
