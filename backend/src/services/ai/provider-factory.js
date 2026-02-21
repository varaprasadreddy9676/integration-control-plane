/**
 * AI Provider Factory
 * Creates the appropriate AI provider based on configuration
 */

const ClaudeProvider = require('./providers/claude-provider');
const OpenAIProvider = require('./providers/openai-provider');
const ZAIProvider = require('./providers/zai-provider');
const KimiProvider = require('./providers/kimi-provider');
const { log } = require('../../logger');

class AIProviderFactory {
  static create(config) {
    if (!config || !config.enabled) {
      log('info', 'AI features disabled in configuration');
      return null;
    }

    const provider = config.provider?.toLowerCase() || 'zai';

    // Extract provider-specific config
    let providerConfig;
    switch (provider) {
      case 'claude':
      case 'anthropic':
        providerConfig = config.claude || config;
        return new ClaudeProvider(providerConfig);

      case 'openai':
      case 'gpt':
        providerConfig = config.openai || config;
        // Support environment variable for API key (recommended for security)
        if (providerConfig.apiKey === 'USE_ENVIRONMENT_VARIABLE_OPENAI_API_KEY') {
          providerConfig.apiKey = process.env.OPENAI_API_KEY || null;
        }
        return new OpenAIProvider(providerConfig);

      case 'zai':
      case 'z.ai':
      case 'glm':
        providerConfig = config.zai || config;
        return new ZAIProvider(providerConfig);

      case 'kimi':
      case 'kimik2':
      case 'moonshot':
        providerConfig = config.kimi || config;
        return new KimiProvider(providerConfig);

      default:
        log('warn', 'Unknown AI provider, defaulting to Z.ai', { provider });
        return new ZAIProvider(config.zai || config);
    }
  }
}

module.exports = AIProviderFactory;
