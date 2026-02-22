/**
 * Transformation script prompt builder
 */

const { buildSystemContext } = require('./system-context');
const {
  buildPatientObjectDoc,
  buildVisitObjectDoc,
  buildApptObjectDoc,
  buildBillObjectDoc,
} = require('./data-structures');
const { buildTransformationExamples } = require('./examples');
const mongodb = require('../../../mongodb');

/**
 * Get event schema from MongoDB event_types collection
 */
async function getEventSchema(eventType) {
  const db = await mongodb.getDbSafe();
  const schema = await db.collection('event_types').findOne({ eventType });
  return schema;
}

/**
 * Generate transformation script prompt
 */
async function buildTransformationPrompt(inputExample, outputExample, eventType) {
  const systemContext = buildSystemContext();
  const patientDoc = buildPatientObjectDoc();
  const visitDoc = buildVisitObjectDoc();
  const apptDoc = buildApptObjectDoc();
  const billDoc = buildBillObjectDoc();
  const examples = buildTransformationExamples();

  // Try to get event-specific schema from MongoDB
  const eventSchema = await getEventSchema(eventType);
  let eventSpecificContext = '';

  if (eventSchema) {
    // Pass the entire schema object to AI
    const schemaPreview = {
      eventType: eventSchema.eventType,
      label: eventSchema.label,
      description: eventSchema.description,
      category: eventSchema.category,
      fieldCount: eventSchema.fields?.length || 0,
      fields: eventSchema.fields || [],
      hasSamplePayload: !!eventSchema.samplePayload,
    };

    eventSpecificContext = `\n**EVENT-SPECIFIC SCHEMA for ${eventType}** (from MongoDB event_types):
\`\`\`json
${JSON.stringify(schemaPreview, null, 2)}
\`\`\`
`;

    // If samplePayload exists, include it
    if (eventSchema.samplePayload) {
      eventSpecificContext += `\n**SAMPLE EVENT PAYLOAD** (actual structure from production):
\`\`\`json
${JSON.stringify(eventSchema.samplePayload, null, 2)}
\`\`\`
`;
    }
  }

  return `${systemContext}

${eventSpecificContext}

## AVAILABLE DATA STRUCTURES

${patientDoc}

${visitDoc}

${apptDoc}

${billDoc}

${examples}

---

## YOUR TASK

Generate JavaScript transformation code that converts:

**INPUT EVENT** (from source system):
\`\`\`json
${JSON.stringify(inputExample, null, 2)}
\`\`\`

**DESIRED OUTPUT** (for target API):
\`\`\`json
${JSON.stringify(outputExample, null, 2)}
\`\`\`

**EVENT TYPE**: ${eventType}

---

## CRITICAL REQUIREMENTS

1. **Return ONLY the transformation code** - NO function wrapper, NO markdown, NO comments
   ❌ BAD: \`function transform(payload, context) { ... }\`
   ❌ BAD: \`\`\`javascript ... \`\`\`
   ✅ GOOD: \`const name = payload.patient?.fullName || '';\\nreturn { name };\`

2. **Use optional chaining** (?.) for ALL nested properties
   ✅ \`payload.patient?.phone\`
   ✅ \`payload.appt?.patientName\`
   ✅ \`payload.Bill?.[0]?.billNumber\`

3. **Provide fallback values** - Healthcare data is incomplete
   ✅ \`|| ''\` for strings
   ✅ \`|| 0\` for numbers
   ✅ \`|| false\` for booleans

4. **Handle arrays correctly** - Bill is an array
   ✅ \`const bill = payload.Bill?.[0];\`

5. **Match output structure exactly** - Field names and data types must match the DESIRED OUTPUT

6. **Keep it concise** - Under 40 lines of code

7. **Handle missing data gracefully** - Never assume fields exist

NOW GENERATE THE TRANSFORMATION CODE:`;
}

module.exports = {
  buildTransformationPrompt,
  getEventSchema,
};
