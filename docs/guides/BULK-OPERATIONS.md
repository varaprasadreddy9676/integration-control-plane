# Bulk Operations Guide

The platform supports bulk creation, updates, enable/disable, deletion, and import/export of integrations. All bulk endpoints are designed for automation — CI/CD pipelines, org onboarding, and migration scenarios.

## Table of Contents

- [Bulk Create Integrations](#bulk-create-integrations)
- [Bulk Create from Templates](#bulk-create-from-templates)
- [Bulk Update Integrations](#bulk-update-integrations)
- [Bulk Enable / Disable](#bulk-enable--disable)
- [Bulk Delete](#bulk-delete)
- [Import & Export](#import--export)
- [Bulk DLQ Retry](#bulk-dlq-retry)
- [Result Format](#result-format)
- [API Reference](#api-reference)

---

## Bulk Create Integrations

Create up to **100 integrations** in a single request.

```http
POST /api/v1/bulk/outbound-integrations
Content-Type: application/json

{
  "validateFirst": true,
  "continueOnError": false,
  "integrations": [
    {
      "name": "Appointment Webhook - Clinic A",
      "eventType": "appointment.created",
      "targetUrl": "https://clinica.example.com/webhooks",
      "httpMethod": "POST",
      "outgoingAuthType": "BEARER",
      "authConfig": { "token": "token-a" },
      "timeoutMs": 10000,
      "retryCount": 3,
      "scope": "ALL_ENTITIES"
    },
    {
      "name": "Appointment Webhook - Clinic B",
      "eventType": "appointment.created",
      "targetUrl": "https://clinicb.example.com/webhooks",
      "httpMethod": "POST",
      "outgoingAuthType": "BEARER",
      "authConfig": { "token": "token-b" },
      "timeoutMs": 10000,
      "retryCount": 3,
      "scope": "ALL_ENTITIES"
    }
  ]
}
```

**Options:**

| Field | Default | Description |
|-------|---------|-------------|
| `validateFirst` | `true` | Validate all items before creating any. If any fail, nothing is created. |
| `continueOnError` | `false` | Skip failed items and continue creating the rest |

**Required fields per integration:** `name`, `eventType`, `targetUrl`, `httpMethod`, `scope`, `outgoingAuthType`, `timeoutMs`, `retryCount`

---

## Bulk Create from Templates

Create up to **50 integrations** using existing templates as the base:

```http
POST /api/v1/bulk/outbound-integrations/from-templates
Content-Type: application/json

{
  "validateFirst": true,
  "continueOnError": false,
  "integrations": [
    {
      "templateId": "65f3a1b2c3d4e5f6a7b8c9d0",
      "overrides": {
        "name": "Appointment Webhook - Clinic A",
        "targetUrl": "https://clinica.example.com/webhooks",
        "authConfig": { "token": "token-a" }
      }
    },
    {
      "templateId": "65f3a1b2c3d4e5f6a7b8c9d0",
      "overrides": {
        "name": "Appointment Webhook - Clinic B",
        "targetUrl": "https://clinicb.example.com/webhooks",
        "authConfig": { "token": "token-b" }
      }
    }
  ]
}
```

The `overrides` object is deep-merged over the template's base config. Use this to deploy the same integration type across many endpoints.

---

## Bulk Update Integrations

Update up to **100 integrations** in one request:

```http
PUT /api/v1/bulk/outbound-integrations
Content-Type: application/json

{
  "validateFirst": true,
  "continueOnError": true,
  "updates": [
    {
      "id": "65f3a1b2c3d4e5f6a7b8c9d0",
      "timeoutMs": 15000,
      "retryCount": 5
    },
    {
      "id": "65f3a1b2c3d4e5f6a7b8c9d1",
      "targetUrl": "https://new-endpoint.example.com/webhooks"
    }
  ]
}
```

**Updatable fields:** `name`, `targetUrl`, `httpMethod`, `outgoingAuthType`, `authConfig`, `headers`, `timeoutMs`, `retryCount`, `transformationMode`, `transformation`, `isActive`, `eventType`, `description`, `scope`

---

## Bulk Enable / Disable

Enable or disable multiple integrations at once:

```http
PATCH /api/v1/bulk/outbound-integrations/status
Content-Type: application/json

{
  "integrationIds": [
    "65f3a1b2c3d4e5f6a7b8c9d0",
    "65f3a1b2c3d4e5f6a7b8c9d1"
  ],
  "isActive": false,
  "continueOnError": true
}
```

Response includes the previous and new status for each integration:

```json
{
  "successful": [
    { "id": "65f3...", "previousStatus": true, "newStatus": false }
  ],
  "failed": [],
  "summary": { "total": 2, "successful": 2, "failed": 0 }
}
```

**In the UI:** Integrations list → select multiple → **Enable Selected** / **Disable Selected**.

---

## Bulk Delete

Delete up to **100 integrations** permanently:

```http
DELETE /api/v1/bulk/outbound-integrations
Content-Type: application/json

{
  "integrationIds": [
    "65f3a1b2c3d4e5f6a7b8c9d0",
    "65f3a1b2c3d4e5f6a7b8c9d1"
  ],
  "confirm": true
}
```

The `confirm: true` field is required as a safety check. This operation is **not reversible**.

---

## Import & Export

Import and export integration configurations as JSON or CSV for backup, migration, and cross-org deployment.

### Export as JSON

```http
GET /api/v1/import-export/outbound-integrations.json
```

**Query parameters:**

| Parameter | Default | Description |
|-----------|---------|-------------|
| `includeInactive` | `false` | Include disabled integrations |
| `includeSensitive` | `false` | Include auth credentials (partially masked) |
| `integrationIds` | all | Comma-separated IDs to export specific integrations |

Response format:

```json
{
  "metadata": {
    "exportedAt": "2026-02-24T10:00:00.000Z",
    "exportedBy": "user-id",
    "orgId": "org-id",
    "format": "standard",
    "version": "1.0",
    "totalIntegrations": 12
  },
  "integrations": [ ... ]
}
```

> **Sensitive data masking:** By default, auth credentials are masked (first 4 + last 4 characters visible, rest replaced with `****`). Set `includeSensitive=true` to include partial credentials — full secrets are never exported.

### Export as CSV

```http
GET /api/v1/import-export/outbound-integrations.csv
```

CSV columns: `id`, `name`, `description`, `targetUrl`, `httpMethod`, `authType`, `eventType`, `isActive`, `timeoutMs`, `retryCount`, `transformationMode`, `createdAt`, `updatedAt`, `orgId`, `scope`, `templateId`

### Validate before importing

Dry-run validation without committing:

```http
POST /api/v1/import-export/validate
Content-Type: application/json

{
  "importData": { ... }   // Same format as JSON export
}
```

Returns validation results per integration without creating anything.

### Import from JSON

```http
POST /api/v1/import-export/outbound-integrations.json
Content-Type: application/json

{
  "importData": { ... },
  "options": {
    "validateFirst": true,
    "continueOnError": false,
    "updateExisting": false,
    "preserveIds": false,
    "activateImported": false
  }
}
```

**Import options:**

| Option | Default | Description |
|--------|---------|-------------|
| `validateFirst` | `true` | Validate all before importing any |
| `continueOnError` | `false` | Skip failures and continue |
| `updateExisting` | `false` | Update integrations that match by ID |
| `preserveIds` | `false` | Keep original MongoDB IDs (use for same-org restore only) |
| `activateImported` | `false` | Set `isActive: true` on all imported integrations |

### Export templates

```http
GET /api/v1/import-export/templates
```

### Import from templates

```http
POST /api/v1/import-export/outbound-integrations.from-templates
```

Uses the same format as bulk create from templates, but accepts an export file as input.

---

## Bulk DLQ Retry

Retry multiple Dead Letter Queue entries simultaneously.

```http
POST /api/v1/dlq/bulk/retry
Content-Type: application/json

{
  "dlqIds": [
    "65f3a1b2c3d4e5f6a7b8c9d0",
    "65f3a1b2c3d4e5f6a7b8c9d1"
  ]
}
```

Up to **100 entries** per request. Returns:

```json
{
  "success": ["65f3a1b2...", "65f3a1b2..."],
  "failed": []
}
```

**Abandon multiple DLQ entries** (mark as permanently abandoned):

```http
POST /api/v1/dlq/bulk/abandon
Content-Type: application/json

{
  "dlqIds": ["65f3a1b2...", "65f3a1b2..."],
  "notes": "Test data — not for delivery"
}
```

**In the UI:** DLQ list → select entries → **Retry Selected** or **Abandon Selected**.

---

## Result Format

All bulk operations return a consistent result structure:

```json
{
  "successful": [
    {
      "index": 0,
      "integrationId": "65f3a1b2c3d4e5f6a7b8c9d0",
      "integration": { ... }
    }
  ],
  "failed": [
    {
      "index": 1,
      "integrationId": "65f3a1b2c3d4e5f6a7b8c9d1",
      "error": "targetUrl must be a valid HTTPS URL",
      "errors": ["targetUrl must be a valid HTTPS URL"]
    }
  ],
  "updated": [...],
  "summary": {
    "total": 10,
    "successful": 9,
    "failed": 1,
    "updated": 0
  }
}
```

Use `summary.failed > 0` to detect partial failures when `continueOnError: true`.

---

## API Reference

```
POST   /api/v1/bulk/outbound-integrations                     Bulk create
POST   /api/v1/bulk/outbound-integrations/from-templates      Bulk create from templates
PUT    /api/v1/bulk/outbound-integrations                     Bulk update
PATCH  /api/v1/bulk/outbound-integrations/status              Bulk enable/disable
DELETE /api/v1/bulk/outbound-integrations                     Bulk delete

GET    /api/v1/import-export/outbound-integrations.json       Export as JSON
GET    /api/v1/import-export/outbound-integrations.csv        Export as CSV
GET    /api/v1/import-export/templates                        Export templates
POST   /api/v1/import-export/outbound-integrations.json       Import from JSON
POST   /api/v1/import-export/outbound-integrations.from-templates  Import from templates
POST   /api/v1/import-export/validate                         Validate without importing

POST   /api/v1/dlq/bulk/retry                                 Bulk DLQ retry
POST   /api/v1/dlq/bulk/abandon                               Bulk DLQ abandon
```

All bulk endpoints require authentication and are rate-limited to prevent abuse. Requests exceeding 100 items are rejected with `400 Bad Request`.
