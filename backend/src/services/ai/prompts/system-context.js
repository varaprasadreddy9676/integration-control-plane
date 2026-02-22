/**
 * System context and base documentation
 */
const FALLBACK_SYSTEM_PROMPT = `You are an expert assistant for Integration Gateway.

Your role:
- Help users configure integrations, transformations, scheduling, auth, and troubleshooting.
- Prefer precise, production-safe guidance with robust null checks and fallback handling.
- Do not invent configuration values or runtime state.

When data is missing, explicitly say it is unknown and suggest the next concrete check.`;

function loadDefaultSystemPrompt() {
  try {
    const seeded = require('../../../../seed-system-prompt');
    const prompt = seeded?.SYSTEM_PROMPT;
    if (typeof prompt === 'string' && prompt.trim().length > 0) {
      return prompt;
    }
  } catch (_err) {
    // Optional file not present in some environments; fallback prompt is used.
  }
  return FALLBACK_SYSTEM_PROMPT;
}

const DEFAULT_SYSTEM_PROMPT = loadDefaultSystemPrompt();

// ---------------------------------------------------------------------------
// In-memory prompt cache — keeps getSystemPrompt() synchronous while
// allowing the prompt content to be updated in DB without a code deploy.
// ---------------------------------------------------------------------------

const _cache = {
  content: null, // null means "use hardcoded default"
  loadedAt: 0, // epoch ms
};

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Load the system prompt from MongoDB into the in-memory cache.
 * Falls back silently to hardcoded default if DB is unavailable.
 */
async function _loadFromDB() {
  try {
    const aiConfigData = require('../../data/ai-config');
    const doc = await aiConfigData.getSystemPromptFromDB();
    _cache.content = doc ? doc.content : null;
    _cache.loadedAt = Date.now();
  } catch (_err) {
    // DB unavailable — keep whatever is cached (or null → hardcoded fallback)
  }
}

/**
 * Call once at app startup to pre-warm the cache.
 * Also starts the background refresh interval.
 */
async function initSystemPromptCache() {
  await _loadFromDB();
  // Background refresh — keeps the running process in sync without restarts
  setInterval(_loadFromDB, CACHE_TTL_MS).unref();
}

/**
 * Force-clear the cache (called immediately after admin saves a new prompt).
 * Next call to getSystemPrompt() will return the hardcoded default until the
 * background refresh fires — but callers should trigger _loadFromDB() after
 * invalidating so the update is reflected immediately.
 */
async function invalidateSystemPromptCache() {
  _cache.content = null;
  _cache.loadedAt = 0;
  await _loadFromDB(); // reload immediately so the change is live right away
}

/**
 * Build comprehensive system context about Integration Gateway
 */
function buildSystemContext() {
  return `## ABOUT INTEGRATION GATEWAY

**Platform**: Integration Gateway - Multi-Tenant Event Integration Platform
**Purpose**: Routes real-time events from source systems to external destinations (CRMs, ERPs, WhatsApp, SMS, custom APIs)
**Architecture**: Event-driven, processes events from configurable source adapters (SQL, Kafka, HTTP Push, etc.)
**Transformation**: JavaScript-based payload transformation with sandboxed execution

**EVENT STRUCTURE**:
Every event has a core metadata envelope plus event-specific data. The exact fields depend on your org's source system schema. A typical structure looks like:
\`\`\`javascript
{
  // Core metadata — field names match your org's event source config
  type: "ORDER_PLACED",           // Event type identifier
  datetime: "24/01/2026 06:14 PM", // Event timestamp
  orgUnitRid: 1001,               // Org/entity identifier from source system
  entityCode: "ORG-001",          // Entity code
  entityName: "Acme Corporation", // Organization name
  entityPhone: "+1-555-0100",     // Organization phone
  entityParentID: 1001,           // Parent entity ID (for multi-location orgs)
  enterpriseCode: "ENT-001",      // Enterprise code
  description: "Order Placed",    // Human-readable description
  unitRID: 42,                    // Department/unit ID
  userRID: 10001,                 // User who triggered the event

  // Event-specific objects (schema depends on your source system)
  // Access these with optional chaining since fields vary by event type
  customer: { ... },  // e.g. customer data
  order: { ... },     // e.g. order/transaction data
  items: [ ... ]      // e.g. line items (may be an array)
}
\`\`\`

**COMMON EVENT TYPE EXAMPLES** (your org defines its own catalogue):
- ORDER_PLACED - New order created
- ORDER_UPDATED - Order status changed
- CUSTOMER_REGISTERED - New customer/user registration
- PAYMENT_RECEIVED - Payment confirmed
- APPOINTMENT_BOOKED - Appointment scheduled
- APPOINTMENT_CANCELLED - Appointment cancelled
- ALERT_TRIGGERED - Threshold or condition alert
- RECORD_CREATED / RECORD_UPDATED - Generic record lifecycle events

**TRANSFORMATION FUNCTION**:
Your generated code will be executed as:
\`\`\`javascript
function transform(payload, context) {
  // YOUR GENERATED CODE HERE
  return { ... }; // Must return the transformed object
}
\`\`\`

**Available Parameters**:
- \`payload\`: The full event object (structure defined by your org's event catalogue)
- \`context\`: { eventType, orgUnitRid, __KEEP___KEEP_integrationConfig__Id__, deliveryAttempt }

**Critical Rules**:
1. ALWAYS use optional chaining (?.) for nested properties: \`payload.customer?.email\`
2. ALWAYS provide fallback values: \`|| ''\`, \`|| 0\`, \`|| false\`
3. Source data may be incomplete — expect missing fields
4. Return ONLY the transformed object, no function wrapper
5. Keep code under 40 lines for readability`;
}

/**
 * System prompt for AI providers.
 * Returns the DB-stored custom prompt if one is cached, otherwise the shared default.
 * Stays synchronous so providers can call it without async changes.
 */
function getSystemPrompt() {
  if (_cache.content) return _cache.content;
  return DEFAULT_SYSTEM_PROMPT;
}

module.exports = {
  buildSystemContext,
  getSystemPrompt,
  initSystemPromptCache,
  invalidateSystemPromptCache,
};
