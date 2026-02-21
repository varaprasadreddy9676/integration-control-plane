/**
 * Prompt builders and response normalizers for error analysis.
 *
 * Normalizers guarantee a consistent shape regardless of which AI provider
 * generated the response and what casing/field-naming convention it chose.
 */

const { buildSystemContext } = require('./system-context');

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

function buildErrorAnalysisPrompt(errorContext) {
  const { logEntry, integrationConfig, transformationCode, payload, errorMessage } = errorContext;

  const parts = [buildSystemContext(), '\n'];

  parts.push('## TASK: Analyze Delivery Error\n');
  parts.push('A webhook delivery failed. Analyze the error and provide a diagnosis with fix.\n');

  if (errorMessage) {
    parts.push(`## Error Message\n\`\`\`\n${errorMessage}\n\`\`\`\n`);
  }

  if (logEntry) {
    parts.push('## Delivery Log Entry');
    parts.push(`- Status: ${logEntry.status || 'failed'}`);
    parts.push(`- Target URL: ${logEntry.targetUrl || 'N/A'}`);
    parts.push(`- HTTP Status: ${logEntry.httpStatus || 'N/A'}`);
    parts.push(`- Attempt: ${logEntry.attempt || 1}`);
    if (logEntry.responseBody) {
      parts.push(`- Server Response: ${String(logEntry.responseBody).substring(0, 500)}`);
    }
    parts.push('');
  }

  if (integrationConfig) {
    parts.push('## Integration Configuration');
    parts.push(`- Name: ${integrationConfig.name || 'Unknown'}`);
    parts.push(`- Type: ${integrationConfig.type || 'outbound'}`);
    parts.push(`- Target URL: ${integrationConfig.targetUrl || 'N/A'}`);
    parts.push(`- Event Type: ${integrationConfig.eventType || '*'}`);
    if (integrationConfig.headers) {
      parts.push(`- Custom Headers: ${JSON.stringify(integrationConfig.headers)}`);
    }
    if (integrationConfig.transformation?.mode === 'SCRIPT' && integrationConfig.transformation?.script) {
      parts.push(`\n## Transformation Script\n\`\`\`javascript\n${integrationConfig.transformation.script}\n\`\`\``);
    }
    parts.push('');
  } else if (transformationCode) {
    // Fallback: caller supplied the script text directly without a full integration config
    parts.push(`\n## Transformation Script\n\`\`\`javascript\n${transformationCode}\n\`\`\``);
    parts.push('');
  }

  if (payload) {
    const payloadStr = JSON.stringify(payload, null, 2);
    parts.push(`## Event Payload (truncated to 1000 chars)\n\`\`\`json\n${payloadStr.substring(0, 1000)}\n\`\`\``);
    parts.push('');
  }

  parts.push(`## Required Output Format
Respond with ONLY valid JSON - no markdown, no prose before or after:
{
  "rootCause": "One-line summary of what caused the failure",
  "explanation": "2-3 sentence explanation of what went wrong and why",
  "suggestedFix": "Specific actionable steps to fix this",
  "codeChange": "If transformation script needs fixing, the corrected JavaScript code. Otherwise null.",
  "configPatch": {
    "targetUrl": "optional new URL",
    "httpMethod": "optional new method",
    "outgoingAuthType": "optional auth type",
    "outgoingAuthConfig": { "optional": "auth config object" },
    "inboundAuthType": "optional inbound auth type",
    "inboundAuthConfig": { "optional": "inbound auth config object" },
    "timeoutMs": 10000,
    "retryCount": 3,
    "timeout": 10000
  },
  "severity": "critical|high|medium|low"
}`);

  return parts.join('\n');
}

function buildExplainTransformationPrompt(params) {
  const { code, errorMessage, eventType } = params;

  const parts = [buildSystemContext(), '\n'];

  if (errorMessage) {
    parts.push('## TASK: Fix Transformation Error\n');
    parts.push(`The following transformation script failed with this error:\n\`\`\`\n${errorMessage}\n\`\`\`\n`);
  } else {
    parts.push('## TASK: Explain Transformation Script\n');
    parts.push('Explain what this transformation script does in plain English.\n');
  }

  if (eventType && eventType !== '*') {
    parts.push(`## Event Type: ${eventType}\n`);
  }

  parts.push(`## Transformation Script\n\`\`\`javascript\n${code}\n\`\`\`\n`);

  if (errorMessage) {
    parts.push(`## Required Output Format
Respond with ONLY valid JSON - no markdown, no prose before or after:
{
  "explanation": "What this code does and where the bug is",
  "rootCause": "One-line description of the bug",
  "fixedCode": "The corrected JavaScript transformation code (full version)",
  "whatChanged": "Brief description of what was changed to fix it"
}`);
  } else {
    parts.push(`## Required Output Format
Respond with ONLY valid JSON - no markdown, no prose before or after:
{
  "explanation": "Plain English explanation of what this transformation does, field by field",
  "suggestions": ["Optional improvement 1", "Optional improvement 2"],
  "dataFlow": "Describe: input fields -> output fields mapping"
}`);
  }

  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Response normalizers
// ---------------------------------------------------------------------------

const VALID_SEVERITIES = new Set(['critical', 'high', 'medium', 'low']);

/**
 * Normalize the AI response for analyzeError() to a guaranteed shape.
 * Handles common field-naming variations from different providers.
 */
function normalizeErrorAnalysis(raw) {
  if (!raw || typeof raw !== 'object') {
    return {
      rootCause: 'Unable to determine root cause',
      explanation: 'The AI returned an unexpected response format.',
      suggestedFix: 'Please try again or check the error manually.',
      codeChange: null,
      severity: 'medium'
    };
  }

  const severity = VALID_SEVERITIES.has(raw.severity) ? raw.severity : 'medium';

  return {
    rootCause:    raw.rootCause    || raw.root_cause   || raw.cause      || raw.summary    || 'Unknown cause',
    explanation:  raw.explanation  || raw.description  || raw.details    || raw.analysis   || 'No explanation provided',
    suggestedFix: raw.suggestedFix || raw.suggested_fix || raw.fix       || raw.solution   || 'No specific fix suggested',
    codeChange:   raw.codeChange   || raw.code_change  || raw.fixedCode  || raw.fixed_code || null,
    configPatch:  (raw.configPatch || raw.config_patch || {}),
    severity
  };
}

/**
 * Normalize the AI response for explainTransformation() to a guaranteed shape.
 * Handles both the "explain" and "fix" variants.
 */
function normalizeExplainTransformation(raw) {
  if (!raw || typeof raw !== 'object') {
    return {
      explanation: 'The AI returned an unexpected response format.',
      rootCause: null,
      fixedCode: null,
      whatChanged: null,
      suggestions: [],
      dataFlow: null
    };
  }

  return {
    explanation:  raw.explanation  || raw.description  || raw.details    || 'No explanation provided',
    rootCause:    raw.rootCause    || raw.root_cause   || raw.cause      || null,
    fixedCode:    raw.fixedCode    || raw.fixed_code   || raw.codeChange || null,
    whatChanged:  raw.whatChanged  || raw.what_changed || raw.changes    || null,
    suggestions:  Array.isArray(raw.suggestions) ? raw.suggestions : [],
    dataFlow:     raw.dataFlow     || raw.data_flow    || null
  };
}

module.exports = {
  buildErrorAnalysisPrompt,
  buildExplainTransformationPrompt,
  normalizeErrorAnalysis,
  normalizeExplainTransformation
};
