# Bulk Operations & Import/Export

The platform supports bulk create, update, enable/disable, delete, and JSON/CSV import/export for integrations — designed for CI/CD pipelines, org onboarding, and migration scenarios.

---

## Bulk Create

Create up to **100 integrations** in one request:

```http
POST /api/v1/bulk/outbound-integrations
{
  "validateFirst": true,
  "continueOnError": false,
  "integrations": [
    { "name": "Clinic A", "targetUrl": "https://clinica.example.com/webhooks", ... },
    { "name": "Clinic B", "targetUrl": "https://clinicb.example.com/webhooks", ... }
  ]
}
```

| Option | Default | Description |
|--------|---------|-------------|
| `validateFirst` | `true` | Validate all before creating any. On any failure, nothing is created. |
| `continueOnError` | `false` | Skip failed items and create the rest |

### Bulk Create from Templates

Create up to **50 integrations** using a template as the base:

```http
POST /api/v1/bulk/outbound-integrations/from-templates
{
  "integrations": [
    { "templateId": "...", "overrides": { "name": "Clinic A", "targetUrl": "..." } }
  ]
}
```

---

## Bulk Update

Update up to **100 integrations** in one request. Only include fields you want to change:

```http
PUT /api/v1/bulk/outbound-integrations
{
  "updates": [
    { "id": "...", "timeoutMs": 15000 },
    { "id": "...", "targetUrl": "https://new-endpoint.example.com" }
  ]
}
```

---

## Bulk Enable / Disable

```http
PATCH /api/v1/bulk/outbound-integrations/status
{
  "integrationIds": ["id1", "id2", "id3"],
  "isActive": false
}
```

**In the UI:** Integrations list → select multiple → **Enable Selected** / **Disable Selected**.

---

## Bulk Delete

```http
DELETE /api/v1/bulk/outbound-integrations
{
  "integrationIds": ["id1", "id2"],
  "confirm": true
}
```

`confirm: true` is required. This operation is irreversible.

---

## Import & Export

### Export as JSON

```http
GET /api/v1/import-export/outbound-integrations.json?includeInactive=true
```

Returns a metadata envelope + full integration configs. Auth credentials are **masked by default** (first 4 + last 4 chars).

### Export as CSV

```http
GET /api/v1/import-export/outbound-integrations.csv
```

Columns: `id`, `name`, `targetUrl`, `httpMethod`, `authType`, `eventType`, `isActive`, `timeoutMs`, `retryCount`, `transformationMode`, `createdAt`

### Validate before importing

```http
POST /api/v1/import-export/validate
{ "importData": { ...export payload... } }
```

Dry-run — validates all integrations without creating anything.

### Import from JSON

```http
POST /api/v1/import-export/outbound-integrations.json
{
  "importData": { ...export payload... },
  "options": {
    "validateFirst": true,
    "updateExisting": false,
    "preserveIds": false,
    "activateImported": false
  }
}
```

| Option | Description |
|--------|-------------|
| `updateExisting` | Update integrations that match by ID |
| `preserveIds` | Keep original MongoDB IDs (same-org restore only) |
| `activateImported` | Set `isActive: true` on all imported integrations |

---

## Result Format

All bulk operations return a consistent structure:

```json
{
  "successful": [{ "index": 0, "integrationId": "...", "integration": {} }],
  "failed":     [{ "index": 1, "error": "targetUrl required", "errors": [] }],
  "summary":    { "total": 10, "successful": 9, "failed": 1 }
}
```

---

## Bulk DLQ Retry

Retry up to **100** Dead Letter Queue entries at once:

```http
POST /api/v1/dlq/bulk-retry
{ "ids": ["dlq-id-1", "dlq-id-2"] }
```

**In the UI:** DLQ list → select entries → **Retry Selected**.
