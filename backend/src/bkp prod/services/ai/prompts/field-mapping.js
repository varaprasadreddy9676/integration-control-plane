/**
 * Field mapping suggestions prompt builder
 */

const { buildSystemContext } = require('./system-context');

/**
 * Build prompt for field mapping suggestions
 */
function buildFieldMappingPrompt(sourceFields, targetFields, apiContext) {
  const systemContext = buildSystemContext();

  return `${systemContext}
---
## YOUR TASK
Suggest field mappings between source system event fields and target API fields.

**Target API**: ${apiContext || 'Generic API'}

**Available Source Fields** (from source system events):
${JSON.stringify(sourceFields, null, 2)}

**Target Fields** (for the API):
${JSON.stringify(targetFields, null, 2)}

For each target field, suggest:
1. **targetField**: The target field name
2. **sourceField**: Best matching source field path (e.g., "patient.fullName")
3. **transformation**: Transformation to apply (none, trim, upper, lower, date) or null
4. **confidence**: Confidence score (0.0 to 1.0)
5. **fallback**: Suggested fallback value if source is missing

**CRITICAL**: Return ONLY a JSON array - NO markdown, NO explanations, NO extra text.

Example output:
\`\`\`json
[
  {
    "targetField": "patient_name",
    "sourceField": "patient.fullName",
    "transformation": "trim",
    "confidence": 0.95,
    "fallback": ""
  },
  {
    "targetField": "phone",
    "sourceField": "patient.phone",
    "transformation": null,
    "confidence": 0.9,
    "fallback": ""
  }
]
\`\`\`

NOW GENERATE THE FIELD MAPPINGS:`;
}

module.exports = {
  buildFieldMappingPrompt
};
