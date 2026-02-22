/**
 * Base AI Provider Interface
 * All AI providers must implement this interface
 */

class BaseAIProvider {
  constructor(config) {
    this.config = config;
  }

  async generateTransformation(_inputExample, _outputExample, _eventType) {
    throw new Error('generateTransformation() must be implemented by provider');
  }

  async analyzeDocumentation(_documentation, _eventType) {
    throw new Error('analyzeDocumentation() must be implemented by provider');
  }

  async suggestFieldMappings(_sourceFields, _targetFields, _apiContext) {
    throw new Error('suggestFieldMappings() must be implemented by provider');
  }

  async generateTestPayload(_eventType, _orgId) {
    throw new Error('generateTestPayload() must be implemented by provider');
  }

  async generateSchedulingScript(_description, _mode, _eventType) {
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
  async analyzeError(_errorContext) {
    throw new Error('analyzeError() must be implemented by provider');
  }

  /**
   * Conversational chat with organization context.
   * @param {Array} messages - [{role: 'user'|'assistant', content: string}]
   * @param {string} entityContext - Injected context about the entity's integrations/errors
   * @returns {Promise<string>} AI reply
   */
  async chat(_messages, _entityContext) {
    throw new Error('chat() must be implemented by provider');
  }

  /**
   * Explain or fix a transformation script.
   * @param {object} params - { code, errorMessage?, eventType? }
   * @returns {Promise<{ explanation, fixedCode?, suggestions }>}
   */
  async explainTransformation(_params) {
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
