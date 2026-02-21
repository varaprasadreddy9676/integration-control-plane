/**
 * Test payload generation prompt builder
 */

const { buildSystemContext } = require('./system-context');
const { buildPatientObjectDoc, buildVisitObjectDoc, buildApptObjectDoc, buildBillObjectDoc } = require('./data-structures');
const { getEventSchema } = require('./transformation');

/**
 * Build prompt for generating test payload
 */
async function buildTestPayloadPrompt(eventType, orgId) {
  const systemContext = buildSystemContext();
  const patientDoc = buildPatientObjectDoc();
  const visitDoc = buildVisitObjectDoc();
  const apptDoc = buildApptObjectDoc();
  const billDoc = buildBillObjectDoc();

  // Fetch REAL entity details from database
  let entityContext = '';
  if (orgId) {
    try {
      const dataLayer = require('../../../data');
      const tenant = await dataLayer.getTenant(orgId);

      if (tenant) {
        entityContext = `\n**🔒 CRITICAL - USE THESE EXACT ORG DETAILS (DO NOT RANDOMIZE)**:
- orgUnitRid: ${tenant.entityParentRid}
- orgUnitCode: "${tenant.tenantCode}"
- orgUnitName: "${tenant.tenantName}"
- orgUnitPhone: "${tenant.tenantPhone || '0000000000'}"
- orgId: ${tenant.entityParentRid}
- enterpriseCode: "${tenant.tenantCode}"
- enterpriseOrgUnitRid: ${tenant.entityParentRid}

**⚠️ SECURITY WARNING**: You MUST use the above org details EXACTLY as provided.
DO NOT generate random hospital names, codes, or phone numbers for org metadata.
Users will think there is a data breach if you use wrong entity information!

`;
      }
    } catch (err) {
      // Log error but continue with generic prompt
      console.error('Failed to fetch entity details for AI prompt:', err.message);
    }
  }

  // Try to get event-specific schema from MongoDB event_types
  const eventSchema = await getEventSchema(eventType);
  let eventSpecificContext = '';
  if (eventSchema) {
    eventSpecificContext = `\n**EVENT-SPECIFIC CONTEXT for ${eventType}** (from MongoDB event_types):
${eventSchema.description || eventSchema.label || 'No description available'}
Category: ${eventSchema.category || 'N/A'}
Available fields: ${eventSchema.fields?.map(f => f.path).join(', ') || 'See examples below'}`;
  }

  return `${systemContext}
${entityContext}${eventSpecificContext}
## AVAILABLE DATA STRUCTURES
${patientDoc}
${visitDoc}
${apptDoc}
${billDoc}
---
## YOUR TASK
Generate a **realistic test payload** for the event type: **${eventType}**

The payload should:
1. **Include all core metadata fields** (type, datetime, orgUnitRid, orgUnitCode, orgUnitName, orgId, etc.) - **USE THE EXACT ORG DETAILS PROVIDED ABOVE**
2. **Include event-specific objects** (patient, visit, appt, Bill as appropriate for this event type)
3. **Use RANDOM, VARIED, REALISTIC Indian names** - Generate different names each time (NOT the example names from above) - **FOR PATIENT DATA ONLY**
4. **Use RANDOM phone numbers** - 10-digit Indian mobile numbers (7/8/9 prefix) - **FOR PATIENT DATA ONLY**
5. **Use RANDOM MRNs** - Format: HOSPITAL_CODE/RANDOM_NUMBER/YEAR (e.g., "HYD/745891/26", "BLR/982341/26")
6. **Use CURRENT or RECENT dates** - Use today's date or recent dates, NOT dates from examples above
7. **Include nested objects** where appropriate
8. **Be complete and valid JSON**
9. **Follow the structure** shown above but with DIFFERENT data values

**CRITICAL INSTRUCTIONS**:
- Return ONLY the JSON payload - NO markdown code blocks, NO explanations, NO comments
- **USE THE EXACT ORG DETAILS provided above** (orgUnitRid, orgUnitCode, orgUnitName, orgUnitPhone, orgId, etc.)
- DO NOT generate random org/hospital information - this causes security concerns
- DO randomize patient/appointment/billing data (names, phone numbers, dates, amounts)
- Generate FRESH, UNIQUE patient data for each request
- Make it look like real production data with variety

NOW GENERATE THE TEST PAYLOAD:`;
}

module.exports = {
  buildTestPayloadPrompt
};
