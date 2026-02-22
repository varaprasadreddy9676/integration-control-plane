/**
 * Scheduling script generation prompt builder
 */

const { buildSystemContext } = require('./system-context');
const { getEventSchema } = require('./transformation'); // Fetches from event_types

/**
 * Build prompt for generating scheduling script
 */
async function buildSchedulingScriptPrompt(description, mode, eventType) {
  const systemContext = buildSystemContext();

  // Try to get event-specific schema from MongoDB event_types
  const eventSchema = await getEventSchema(eventType);
  let eventSpecificContext = '';

  if (eventSchema) {
    const fieldPaths = eventSchema.fields?.map((f) => f.path).join(', ') || '';
    eventSpecificContext = `\n**EVENT-SPECIFIC CONTEXT for ${eventType}** (from MongoDB event_types):
${eventSchema.description || eventSchema.label || `Event type: ${eventType}`}
Category: ${eventSchema.category || 'N/A'}
Available fields in payload: ${fieldPaths || 'See sample below'}
`;
  }

  // Try to get event-specific sample payload
  const dataLayer = require('../../../data');
  let samplePayload = null;
  let samplePayloadContext = '';

  try {
    samplePayload = await dataLayer.getEventTypeSamplePayload(eventType);
    if (samplePayload) {
      samplePayloadContext = `\n**SAMPLE EVENT PAYLOAD** (actual structure your script will receive):
\`\`\`json
${JSON.stringify(samplePayload, null, 2)}
\`\`\`

**IMPORTANT**: Use the EXACT field paths from this sample. For example:
${samplePayload.appt?.apptDate ? `- For appointment date: \`event.appt.apptDate\` (value: "${samplePayload.appt.apptDate}")` : ''}
${samplePayload.appt?.apptTime ? `- For appointment time: \`event.appt.apptTime\` (value: "${samplePayload.appt.apptTime}")` : ''}
${samplePayload.visit?.date ? `- For visit date: \`event.visit.date\` (value: "${samplePayload.visit.date}")` : ''}
${samplePayload.visit?.time ? `- For visit time: \`event.visit.time\` (value: "${samplePayload.visit.time}")` : ''}
${samplePayload.appointmentDateTime ? `- For appointment datetime: \`event.appointmentDateTime\` (value: "${samplePayload.appointmentDateTime}")` : ''}
${samplePayload.datetime ? `- For event datetime: \`event.datetime\` (value: "${samplePayload.datetime}")` : ''}
${samplePayload.createdAt ? `- For created time: \`event.createdAt\` (value: "${samplePayload.createdAt}")` : ''}
${samplePayload.arrivedAt ? `- For arrival time: \`event.arrivedAt\` (value: "${samplePayload.arrivedAt}")` : ''}
`;
    }
  } catch (err) {
    // Log error but continue without sample
    console.error('Failed to fetch sample payload for scheduling prompt:', err.message);
  }

  // Real working examples from production (luma-qikberry-configs)
  const delayedExample = `// Send 24 hours before appointment (PRODUCTION-TESTED)
const apptDate = event?.appt?.apptDate || event?.appt?.fromDate || event?.apptDate;
const apptTime = event?.appt?.apptTime || event?.appt?.fromTime || event?.apptTime;

// Check for combined datetime first
const combinedDateTime = event?.appointmentDateTime || event?.scheduledDateTime;
let apptAt;

if (combinedDateTime) {
  apptAt = parseDate(combinedDateTime);
} else {
  if (!apptDate || !apptTime) {
    throw new Error('Missing appointment date/time');
  }
  // Use ISO format with T separator and timezone
  const timeWithSeconds = apptTime.length === 5 ? \`\${apptTime}:00\` : apptTime;
  const apptDateTime = \`\${apptDate}T\${timeWithSeconds}+05:30\`;
  apptAt = parseDate(apptDateTime);
}

// Calculate scheduled time
const scheduledTime = subtractHours(apptAt, 24);
return toTimestamp(scheduledTime);`;

  const recurringExample = `// Send daily at 9 AM for 7 days (PRODUCTION-TESTED)
const firstTime = addHours(now(), 1);
return {
  firstOccurrence: toTimestamp(firstTime),
  intervalMs: 24 * 60 * 60 * 1000,
  maxOccurrences: 7
};`;

  return `${systemContext}
${eventSpecificContext}${samplePayloadContext}
---
## YOUR TASK
Generate a **scheduling script** for ${mode} delivery mode.

**User's requirement**: "${description}"
**Event type**: ${eventType}

**Available utility functions**:
- \`parseDate(dateString)\` - Parse date string to Date object (handles multiple formats: YYYY-MM-DD, DD/MM/YYYY, ISO 8601)
- \`addHours(date, hours)\`, \`addDays(date, days)\`, \`addMinutes(date, minutes)\`
- \`subtractHours(date, hours)\`, \`subtractDays(date, days)\`, \`subtractMinutes(date, minutes)\`
- \`now()\` - Current Date object
- \`toTimestamp(date)\` - Convert Date to Unix timestamp (milliseconds)

**CRITICAL REQUIREMENTS**:
1. **ALWAYS use optional chaining** (?.) everywhere: \`event?.appt?.apptDate\`, \`event?.visit?.date\`
2. **Use ISO format** for combining date+time: \`\${apptDate}T\${apptTime}+05:30\` (T separator, timezone)
3. **Check combined fields first**: \`event?.appointmentDateTime\` before splitting date/time
4. **Provide fallbacks**: \`event?.appt?.apptDate || event?.appt?.fromDate || event?.apptDate\`
5. **Validate required fields**: Throw error if critical date/time missing
6. **${mode === 'DELAYED' ? 'Return a Unix timestamp (number) using return statement' : 'Return a config object with: firstOccurrence, intervalMs, maxOccurrences/endDate'}**
7. **Handle time format**: Add \`:00\` if time is HH:mm format (length 5)
8. ${samplePayload ? 'Use the EXACT field paths shown in the sample payload above' : 'Use multiple fallback paths as shown in examples'}
9. Keep it under 20 lines with clear comments

**${mode === 'DELAYED' ? 'DELAYED' : 'RECURRING'} PRODUCTION EXAMPLE**:
\`\`\`javascript
${mode === 'DELAYED' ? delayedExample : recurringExample}
\`\`\`

**COMMON MISTAKES TO AVOID**:
❌ BAD: \`event.appt.apptDate\` (crashes if appt is undefined)
✅ GOOD: \`event?.appt?.apptDate\` (optional chaining)

❌ BAD: \`apptDate + ' ' + apptTime\` (won't parse correctly)
✅ GOOD: \`\${apptDate}T\${apptTime}+05:30\` (ISO format)

❌ BAD: No error handling for missing fields
✅ GOOD: \`if (!apptDate || !apptTime) throw new Error('Missing appointment date/time');\`

❌ BAD: Single field path \`event.appt.apptDate\`
✅ GOOD: Multiple fallbacks \`event?.appt?.apptDate || event?.appt?.fromDate\`

**IMPORTANT**: Return ONLY the JavaScript code - NO markdown blocks, NO explanations, NO extra text.

NOW GENERATE THE SCHEDULING SCRIPT:`;
}

module.exports = {
  buildSchedulingScriptPrompt,
};
