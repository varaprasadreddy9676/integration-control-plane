/**
 * AI Prompts - Modular structure
 * Main exports for backward compatibility
 */

const { buildSystemContext, getSystemPrompt, initSystemPromptCache, invalidateSystemPromptCache } = require('./system-context');
const { buildTransformationPrompt } = require('./transformation');
const { buildDocumentationAnalysisPrompt } = require('./documentation');
const { buildFieldMappingPrompt } = require('./field-mapping');
const { buildTestPayloadPrompt } = require('./test-payload');
const { buildSchedulingScriptPrompt } = require('./scheduling');
const {
  buildErrorAnalysisPrompt,
  buildExplainTransformationPrompt,
  normalizeErrorAnalysis,
  normalizeExplainTransformation
} = require('./error-analysis');

module.exports = {
  // Main prompt builders
  buildTransformationPrompt,
  buildDocumentationAnalysisPrompt,
  buildFieldMappingPrompt,
  buildTestPayloadPrompt,
  buildSchedulingScriptPrompt,
  buildErrorAnalysisPrompt,
  buildExplainTransformationPrompt,

  // Response normalizers
  normalizeErrorAnalysis,
  normalizeExplainTransformation,

  // System context
  getSystemPrompt,
  buildSystemContext,
  initSystemPromptCache,
  invalidateSystemPromptCache
};
