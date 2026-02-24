# Integration Versioning Guide

Integrations support full **semantic version history** — every configuration change can be saved as a new version, and you can roll back to any previous version at any time. Versioning is separate from the standard integration CRUD and lives under the `/api/v1/versions` namespace.

## Table of Contents

- [Concepts](#concepts)
- [Creating a Versioned Integration](#creating-a-versioned-integration)
- [Listing & Viewing Versions](#listing--viewing-versions)
- [Comparing Versions](#comparing-versions)
- [Setting the Default Version](#setting-the-default-version)
- [Activating & Deactivating Versions](#activating--deactivating-versions)
- [Rolling Back](#rolling-back)
- [Compatibility Modes](#compatibility-modes)
- [Templates](#templates)
- [API Reference](#api-reference)

---

## Concepts

| Term | Description |
|------|-------------|
| **Version** | A named snapshot of an integration's full configuration |
| **Semantic version** | Standard `MAJOR.MINOR.PATCH[-prerelease]` label (e.g., `1.0.0`, `2.1.0-beta`) |
| **Default version** | The version that is active for processing — only one per integration name |
| **Integration name** | Stable identifier that groups all versions together (e.g., `appointment-webhook`) |
| **Pre-release** | Versions labelled `-alpha`, `-beta`, etc. — treated as non-production |

All versions for an integration share the same `integrationName`. Versions are sorted by semver in descending order (newest first).

---

## Creating a Versioned Integration

```http
POST /api/v1/versions
Content-Type: application/json

{
  "integrationName": "appointment-webhook",
  "version": "1.0.0",
  "versionNotes": "Initial release",
  "isDefault": true,
  "name": "Appointment Webhook",
  "eventType": "appointment.created",
  "targetUrl": "https://ehr.example.com/webhooks/appointments",
  "httpMethod": "POST",
  "outgoingAuthType": "BEARER",
  "authConfig": { "token": "..." },
  "timeoutMs": 10000,
  "retryCount": 3,
  "scope": "ALL_ENTITIES"
}
```

**Version string rules:**
- Format: `MAJOR.MINOR.PATCH` or `MAJOR.MINOR.PATCH-prerelease`
- Both `v1.0.0` and `1.0.0` are accepted (prefix stripped automatically)
- Duplicate versions are rejected unless the previous one is a pre-release

---

## Listing & Viewing Versions

**List all versions for an integration:**

```http
GET /api/v1/versions/integration/appointment-webhook/versions
```

Returns versions sorted newest-first by semver. Query params:
- `limit` — Max versions to return (default: 50)
- `includeInactive` — Include deactivated versions (default: true)

**Get a specific version:**

```http
GET /api/v1/versions/integration/appointment-webhook/version/1.0.0
```

Returns full integration config plus version metadata:

```json
{
  "integrationName": "appointment-webhook",
  "version": "1.0.0",
  "isDefault": true,
  "isPrerelease": false,
  "versionNotes": "Initial release",
  "compatibilityMode": "BACKWARD_COMPATIBLE",
  "tags": [],
  "createdAt": "2026-02-01T10:00:00.000Z",
  "versioning": {
    "strategy": "SEMANTIC",
    "major": 1,
    "minor": 0,
    "patch": 0
  }
}
```

---

## Comparing Versions

Diff any two versions to see exactly what changed:

```http
GET /api/v1/versions/integration/appointment-webhook/compare/1.0.0/2.0.0
```

Returns a structured diff of all configuration fields that differ between `v1` and `v2`. Useful before deploying a breaking change.

**In the UI:** Versions list → select two versions → click **Compare**.

The diff view highlights added, removed, and changed fields side-by-side.

---

## Setting the Default Version

Only one version is the "default" (active for event processing) at a time.

```http
PUT /api/v1/versions/integration/appointment-webhook/default
Content-Type: application/json

{ "version": "2.0.0" }
```

This swaps the default atomically — the previous default is deactivated and the new version becomes active.

---

## Activating & Deactivating Versions

**Update and activate a new version:**

```http
PUT /api/v1/versions/integration/appointment-webhook/version/2.0.0
Content-Type: application/json

{
  "targetUrl": "https://ehr.example.com/webhooks/v2/appointments",
  "versionNotes": "Updated to v2 endpoint",
  "deactivatePrevious": "IMMEDIATE"
}
```

**`deactivatePrevious` options:**

| Mode | Behaviour |
|------|-----------|
| `IMMEDIATE` | Previous version is deactivated as soon as this update is saved |
| `SCHEDULED` | Previous version deactivation is queued (logged for background processing) |
| `NEVER` | Previous version remains active alongside the new one |

**Toggle status directly:**

```http
PATCH /api/v1/versions/integration/appointment-webhook/version/2.0.0/status
Content-Type: application/json

{ "isActive": false }
```

---

## Rolling Back

Roll back to a previous version:

```http
POST /api/v1/versions/integration/appointment-webhook/rollback/1.0.0
Content-Type: application/json

{
  "reason": "v2.0.0 causing 500 errors from target",
  "force": false
}
```

**Rollback rules:**
- You can only roll back to an **older** semver than the current default
- Set `force: true` to override this guard (e.g., rolling forward after a mistake)
- The current default version is automatically deactivated
- The rollback reason is recorded in the audit log

**In the UI:** Versions list → version row → **Rollback** button → enter reason → confirm.

---

## Compatibility Modes

Each version declares its compatibility contract:

| Mode | Meaning |
|------|---------|
| `BACKWARD_COMPATIBLE` (default) | Minor/patch bumps are safe for receivers already on this integration |
| `STRICT` | No compatibility guarantees — receivers must be updated explicitly |
| `NONE` | Compatibility checking disabled |

**Compatibility check** (for your own reference before deploying):

```http
GET /api/v1/versions/integration/appointment-webhook/compatibility/2.0.0
```

Returns the compatibility type between the current default and the specified version:

| Result | Meaning |
|--------|---------|
| `FULLY_COMPATIBLE` | Same major, minor, patch — identical config |
| `COMPATIBLE` | Same major — backward-compatible change |
| `BREAKING` | Major version bump — consumers may break |
| `INCOMPATIBLE` | Strict mode — no guarantees |

---

## Templates

Templates are reusable integration blueprints. They are separate from versioned integrations but integrate closely:

### Creating a template

**Via UI:** Integrations → any integration → **Save as Template**.

**Via API:**

```http
POST /api/v1/templates
Content-Type: application/json

{
  "name": "EHR Webhook Template",
  "description": "Standard webhook for EHR appointment events",
  "category": "healthcare",
  "isPublic": false,
  "config": {
    "eventType": "appointment.created",
    "httpMethod": "POST",
    "outgoingAuthType": "BEARER",
    "timeoutMs": 10000,
    "retryCount": 3
  }
}
```

### Using a template

**One-click deploy from UI:** Templates list → **Deploy** → fill in org-specific values (target URL, auth credentials) → save.

**Via API:**

```http
POST /api/v1/templates/:id/deploy
Content-Type: application/json

{
  "name": "My EHR Webhook",
  "targetUrl": "https://ehr.yourdomain.com/webhooks",
  "authConfig": { "token": "my-bearer-token" }
}
```

### Template API endpoints

```
GET    /api/v1/templates              List templates (filterable by category)
GET    /api/v1/templates/:id          Get template details
POST   /api/v1/templates              Create template
PUT    /api/v1/templates/:id          Update template
DELETE /api/v1/templates/:id          Delete template
POST   /api/v1/templates/:id/deploy   Deploy template as a new integration
```

---

## API Reference

```
POST   /api/v1/versions                                                  Create versioned integration
GET    /api/v1/versions/integration/:name/versions                       List all versions
GET    /api/v1/versions/integration/:name/version/:version               Get specific version
PUT    /api/v1/versions/integration/:name/version/:version               Update + optionally activate
PATCH  /api/v1/versions/integration/:name/version/:version/status        Activate / deactivate
PUT    /api/v1/versions/integration/:name/default                        Set default version
DELETE /api/v1/versions/integration/:name/version/:version               Delete version
GET    /api/v1/versions/integration/:name/compare/:v1/:v2                Diff two versions
GET    /api/v1/versions/integration/:name/compatibility/:version         Compatibility check
POST   /api/v1/versions/integration/:name/rollback/:version              Roll back to version
```

**Notes:**
- Deleting the default version requires `?force=true`
- All version mutations are recorded in the audit log with user ID and before/after state
- Pre-release versions (e.g., `1.0.0-alpha`) can co-exist with their release counterpart
