const { uuidv4 } = require('./runtime');

/**
 * Generate a correlation ID (trace ID) for distributed tracing
 * @returns {string} UUID v4
 */
function generateCorrelationId() {
  return uuidv4();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function generateEventKey(eventType, payload, orgId) {
  // Create a unique key for deduplication
  const payloadId = payload.id || payload.patientRID || payload.billId || JSON.stringify(payload);
  return `${eventType}-${payloadId}-${orgId}`;
}

function isTestEvent(evt) {
  const payload = evt?.payload || {};
  const nestedPayload = payload?.payload || {};
  return evt?.event_type === 'TEST_EVENT' || payload?.testMode === true || nestedPayload?.testMode === true;
}

async function safeRead(resp) {
  try {
    const text = await resp.text();
    return text.slice(0, 5000);
  } catch (err) {
    return `unable to read response: ${err.message}`;
  }
}

module.exports = {
  generateCorrelationId,
  sleep,
  generateEventKey,
  isTestEvent,
  safeRead,
};
