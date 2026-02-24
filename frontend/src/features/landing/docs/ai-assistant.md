# AI Assistant

The platform includes a built-in AI assistant that helps configure, debug, and optimize integrations. All AI features are **per-org** — each organization configures its own AI provider and API key.

---

## Supported Providers

| Provider | Models |
|----------|--------|
| **OpenAI** | GPT-4o, GPT-4o mini, GPT-4 Turbo |
| **Anthropic Claude** | claude-3-5-sonnet, claude-3-haiku |
| **ZhipuAI (GLM)** | GLM-4, GLM-4 Flash |
| **Moonshot Kimi** | moonshot-v1-8k, moonshot-v1-32k |

Only one provider is active per org at a time.

---

## Setup

1. Navigate to **AI Settings** in the sidebar
2. Select your provider and enter your API key
3. Choose a model
4. Click **Test Connection** to verify the key is valid
5. Click **Save**

API keys are stored per-org and are **never returned** in API responses — only the provider name and model are shown.

---

## Features

### Transformation Generation

Describe what you need in plain English — the AI generates a JavaScript transformation script.

**In the UI:** Integration → Transformation tab → **AI Assist**

```
"Map patientId to patient_id, format dateOfBirth as YYYY-MM-DD,
and set status to 'active' if appointmentStatus is APT_SCH"
```

### Transformation Explanation

Paste any transformation script and the AI explains what it does in plain English — useful when reviewing integrations written by others.

### Field Mapping Suggestions

Given a source payload and a target schema, the AI suggests which fields map to which.

### Error Analysis

Open any failed delivery log and click **Analyse with AI**. The AI examines the payload, transformation, and error response, then explains the root cause and suggests a fix.

### Log Fix (Diagnose & Apply)

AI proposes a configuration fix for a failed delivery. You can review it and optionally apply it directly — all AI-applied changes are recorded in the audit trail.

### Test Payload Generation

Generate a realistic test payload for any event type without writing it manually.

### Scheduling Script Generation

Describe your schedule in plain English and the AI generates the scheduling script.

```
"Send every Monday at 9am IST, skip if the previous run had errors"
```

### Documentation Analysis

Paste or link to an external API's documentation. The AI extracts the endpoint structure, required fields, and auth method to pre-fill an integration config.

### AI Chat

A persistent multi-turn chat interface for complex questions. Optionally scoped to a specific integration for context-aware answers.

**In the UI:** Click the **AI** icon in the sidebar.

---

## Rate Limits & Usage

- Requests are rate-limited per org at the gateway level
- Rate limit exceeded → `429 Too Many Requests` with `Retry-After` header
- Rate limits are configurable by `SUPER_ADMIN`
- All AI interactions are stored with a **30-day TTL** (auto-purged)

View usage:

```
GET /api/v1/ai/usage          Token usage + request counts
GET /api/v1/ai/status         Active provider + model info
GET /api/v1/ai/interactions   Recent interaction history
```

---

## API Reference

```
POST   /api/v1/ai/generate-transformation    Generate JS transformation script
POST   /api/v1/ai/explain-transformation     Explain an existing script
POST   /api/v1/ai/suggest-mappings           Suggest field mappings
POST   /api/v1/ai/analyze-error              Analyse a failed delivery
POST   /api/v1/ai/diagnose-log-fix           Propose a fix for a log
POST   /api/v1/ai/apply-log-fix              Apply a proposed fix
POST   /api/v1/ai/generate-test-payload      Generate test payload
POST   /api/v1/ai/generate-scheduling-script Generate scheduling script
POST   /api/v1/ai/analyze-documentation      Analyse API docs URL
POST   /api/v1/ai/chat                       Chat interface
```
