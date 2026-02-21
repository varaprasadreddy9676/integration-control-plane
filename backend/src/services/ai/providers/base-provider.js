/**
 * Base AI Provider Interface
 * All AI providers must implement this interface
 */

class BaseAIProvider {
  constructor(config) {
    this.config = config;
  }

  async generateTransformation(inputExample, outputExample, eventType) {
    throw new Error('generateTransformation() must be implemented by provider');
  }

  async analyzeDocumentation(documentation, eventType) {
    throw new Error('analyzeDocumentation() must be implemented by provider');
  }

  async suggestFieldMappings(sourceFields, targetFields, apiContext) {
    throw new Error('suggestFieldMappings() must be implemented by provider');
  }

  async generateTestPayload(eventType, orgId) {
    throw new Error('generateTestPayload() must be implemented by provider');
  }

  async generateSchedulingScript(description, mode, eventType) {
    throw new Error('generateSchedulingScript() must be implemented by provider');
  }

  /**
   * Send a minimal request to verify API key and connectivity.
   * @returns {Promise<{ model: string }>}
   */
  async testConnection() {
    throw new Error('testConnection() must be implemented by provider');
  }

  /**
   * Analyze a delivery error and suggest a fix.
   * @param {object} errorContext - { logEntry, integrationConfig, payload, errorMessage }
   * @returns {Promise<{ rootCause, explanation, suggestedFix, codeChange? }>}
   */
  async analyzeError(errorContext) {
    throw new Error('analyzeError() must be implemented by provider');
  }

  /**
   * Conversational chat with organization context.
   * @param {Array} messages - [{role: 'user'|'assistant', content: string}]
   * @param {string} entityContext - Injected context about the entity's integrations/errors
   * @returns {Promise<string>} AI reply
   */
  async chat(messages, entityContext) {
    throw new Error('chat() must be implemented by provider');
  }

  /**
   * Explain or fix a transformation script.
   * @param {object} params - { code, errorMessage?, eventType? }
   * @returns {Promise<{ explanation, fixedCode?, suggestions }>}
   */
  async explainTransformation(params) {
    throw new Error('explainTransformation() must be implemented by provider');
  }

  isConfigured() {
    return !!this.config.apiKey;
  }

  getName() {
    throw new Error('getName() must be implemented by provider');
  }
}

module.exports = BaseAIProvider;
