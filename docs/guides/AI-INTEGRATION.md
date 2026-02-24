# AI Integration Guide

The platform includes a built-in AI assistant that helps configure, debug, and optimize integrations. All AI operations are **per-org** — each organization configures its own AI provider and API key. AI features require explicit setup before use.

## Table of Contents

- [Supported Providers](#supported-providers)
- [Setting Up AI for an Org](#setting-up-ai-for-an-org)
- [AI Features](#ai-features)
- [AI Chat Assistant](#ai-chat-assistant)
- [Usage & Rate Limits](#usage--rate-limits)
- [API Endpoints](#api-endpoints)
- [Security & Privacy](#security--privacy)
- [Troubleshooting](#troubleshooting)

---

## Supported Providers

| Provider | Models | Notes |
|----------|--------|-------|
| **OpenAI** | GPT-4o, GPT-4o mini, GPT-4 Turbo | Best for transformation generation |
| **Anthropic Claude** | claude-3-5-sonnet, claude-3-haiku | Strong at code analysis and debugging |
| **ZhipuAI (GLM)** | GLM-4, GLM-4 Flash | Good for Chinese-language orgs |
| **Moonshot Kimi** | moonshot-v1-8k, moonshot-v1-32k | Long-context analysis |

Only one provider is active per org at a time.

---

## Setting Up AI for an Org

### Via UI

1. Navigate to **AI Settings** (sidebar)
2. Select your provider from the dropdown
3. Enter your API key for that provider
4. Select the model to use
5. Click **Test Connection** — this makes a small test call to confirm the key is valid
6. Click **Save**

### Via API

```http
POST /api/v1/ai-config
Content-Type: application/json

{
  "provider": "openai",
  "model": "gpt-4o-mini",
  "apiKey": "sk-...",
  "enabled": true
}
```

**Updating the config:**
```http
PUT /api/v1/ai-config
Content-Type: application/json

{ "model": "gpt-4o", "enabled": true }
```

**Deleting the API key** (disables AI for the org):
```http
DELETE /api/v1/ai-config/api-key
```

API keys are stored in MongoDB and are **not** returned in GET responses — only the provider name and model are returned.

---

## AI Features

### Transformation Generation

Generate a JavaScript transformation script from a natural-language description.

**In the UI:** Open an integration → Transformation tab → click **AI Assist** → describe what you need.

**Via API:**
```http
POST /api/v1/ai/generate-transformation
Content-Type: application/json

{
  "description": "Map patientId to patient_id, format dateOfBirth as YYYY-MM-DD, and set status to 'active' if appointmentStatus is APT_SCH",
  "samplePayload": { "patientId": "P001", "dateOfBirth": "1990-01-15", "appointmentStatus": "APT_SCH" }
}
```

Response includes the generated JavaScript script and an explanation.

---

### Field Mapping Suggestions

Given a source payload and a target schema, AI suggests field mappings.

```http
POST /api/v1/ai/suggest-mappings
Content-Type: application/json

{
  "sourcePayload": { "patient_id": "P001", "appt_date": "2026-02-15" },
  "targetSchema": { "patientIdentifier": "string", "appointmentDate": "ISO8601" }
}
```

---

### Error Analysis

Diagnose a failed delivery — AI analyses the payload, transformation, and error response to explain what went wrong and suggest a fix.

**In the UI:** Open a failed delivery log → click **Analyse with AI**.

**Via API:**
```http
POST /api/v1/ai/analyze-error
Content-Type: application/json

{
  "logId": "65f3a1b2c3d4e5f6a7b8c9d0",
  "includePayload": true
}
```

---

### Log Fix (Diagnose & Apply)

AI proposes a fix for a failed delivery and can optionally apply it to the integration config.

```http
POST /api/v1/ai/diagnose-log-fix
{ "logId": "..." }

POST /api/v1/ai/apply-log-fix
{ "logId": "...", "fixId": "...", "confirmed": true }
```

> **Note:** `apply-log-fix` modifies the integration configuration. It requires `INTEGRATION_EDITOR` role or above, and all AI-applied changes are recorded in the audit trail.

---

### Test Payload Generation

Generate a realistic test payload for a given event type.

```http
POST /api/v1/ai/generate-test-payload
Content-Type: application/json

{
  "eventType": "appointment.created",
  "schema": { ... }   // optional — AI infers from event type name if omitted
}
```

---

### Transformation Explanation

Explain what an existing transformation script does in plain English.

```http
POST /api/v1/ai/explain-transformation
Content-Type: application/json

{
  "script": "const out = {}; out.patient_id = payload.patientId; out.date = new Date(payload.dob).toISOString().split('T')[0]; return out;"
}
```

---

### Documentation Analysis

Paste or link to an external API's documentation. AI extracts the endpoint structure, required fields, and auth method to pre-fill an integration config.

```http
POST /api/v1/ai/analyze-documentation
Content-Type: application/json

{
  "url": "https://vendor.example.com/api-docs",
  "context": "We're sending appointment events to their booking endpoint"
}
```

---

### Scheduling Script Generation

Generate a scheduling script (for SCHEDULED integrations) based on a natural-language description.

```http
POST /api/v1/ai/generate-scheduling-script
Content-Type: application/json

{
  "description": "Send every Monday at 9am IST, skip if the previous run had errors"
}
```

---

## AI Chat Assistant

The chat interface provides a persistent session-like experience for complex, multi-turn questions.

**In the UI:** Click the **AI** icon in the sidebar to open the AI drawer.

**Via API:**
```http
POST /api/v1/ai/chat
Content-Type: application/json

{
  "message": "Why is my appointment.created integration failing with a 400 error?",
  "context": {
    "integrationId": "65f3a1b2c3d4e5f6a7b8c9d0"  // optional — adds integration context
  }
}
```

---

## Usage & Rate Limits

**Rate limiting** is applied per org to prevent excessive API spend:

- Requests are rate-limited at the gateway level before reaching your AI provider
- If rate limited, the API returns `429 Too Many Requests` with a `Retry-After` header
- Rate limits are configurable per org by SUPER_ADMIN

**Viewing usage:**
```http
GET /api/v1/ai/usage      // Token usage and request counts for the org
GET /api/v1/ai/status     // Provider status and model info
```

**Interaction history:**
```http
GET /api/v1/ai/interactions    // Recent AI interactions with inputs/outputs
```

All AI interactions are stored with a **TTL index** — they are automatically purged after 30 days.

---

## API Endpoints — Full Reference

```
GET    /api/v1/ai/status                    Provider status + model
GET    /api/v1/ai/usage                     Token usage statistics
GET    /api/v1/ai/interactions              Recent interaction history
POST   /api/v1/ai/generate-transformation   Generate JS transformation script
POST   /api/v1/ai/analyze-documentation     Analyse API docs URL
POST   /api/v1/ai/suggest-mappings          Suggest field mappings
POST   /api/v1/ai/generate-test-payload     Generate test payload
POST   /api/v1/ai/generate-scheduling-script Generate scheduling script
POST   /api/v1/ai/analyze-error             Analyse a failed delivery
POST   /api/v1/ai/diagnose-log-fix          Propose a fix for a log
POST   /api/v1/ai/apply-log-fix             Apply a proposed fix
POST   /api/v1/ai/chat                      Chat interface
POST   /api/v1/ai/explain-transformation    Explain a script

GET    /api/v1/ai-config                    Get AI config (no API key returned)
POST   /api/v1/ai-config                    Create AI config
PUT    /api/v1/ai-config                    Update AI config
POST   /api/v1/ai-config/test               Test provider connection
DELETE /api/v1/ai-config/api-key            Remove API key (disables AI)
GET    /api/v1/ai-config/providers          List supported providers + models
```

---

## Security & Privacy

**API key storage** — provider API keys are stored in MongoDB per org and are never returned in API responses. Keys are only used server-side.

**Data sent to providers** — AI requests may include integration configuration snippets, payload samples, and error messages. Do NOT send actual PHI (Protected Health Information) or PCI data in payload samples. Redact sensitive fields before using AI features.

**Audit trail** — all AI-applied changes (via `apply-log-fix`) are recorded in the audit log with the user ID, action, and before/after state.

**Provider isolation** — each org's AI config is isolated. One org cannot use another org's provider or API key.

---

## Troubleshooting

**"AI provider not configured" error**
- The org has no AI config set up. Complete [Setting Up AI for an Org](#setting-up-ai-for-an-org)

**Test connection fails**
- Verify the API key is correct and has not been revoked
- Check that your key has the required permissions (some OpenAI keys are restricted by IP or endpoint)
- For GLM/Kimi, ensure the key is for the correct region

**AI responses are slow**
- Large context (long scripts, large payloads) increases latency
- Consider switching to a faster model (e.g., GPT-4o mini, claude-3-haiku)
- The first request after a 5-minute idle period may be slower (provider instance warmup in AI orchestrator)

**Rate limit errors from AI provider**
- The gateway's rate limiter should prevent this, but provider-side limits can still be hit
- Check your provider's usage dashboard for quota limits
- Consider upgrading your provider tier or switching to a model with higher rate limits
