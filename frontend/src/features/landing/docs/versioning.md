# Versioning & Templates

Integrations support full **semantic version history** — every configuration change can be saved as a named version, and you can roll back to any previous version at any time. Templates let you create reusable blueprints and deploy them with one click.

---

## Semantic Versioning

Versions follow `MAJOR.MINOR.PATCH[-prerelease]` (e.g., `1.0.0`, `2.1.0-beta`).

All versions for an integration share the same `integrationName`. Only one version is the **default** (active for event processing) at a time.

**Creating a versioned integration:**

```http
POST /api/v1/versions
{
  "integrationName": "appointment-webhook",
  "version": "1.0.0",
  "versionNotes": "Initial release",
  "isDefault": true,
  ...integration config
}
```

---

## Version Lifecycle

| Action | Endpoint |
|--------|----------|
| List all versions | `GET /api/v1/versions/integration/:name/versions` |
| Get a specific version | `GET /api/v1/versions/integration/:name/version/:version` |
| Update + optionally activate | `PUT /api/v1/versions/integration/:name/version/:version` |
| Set as default | `PUT /api/v1/versions/integration/:name/default` |
| Activate / deactivate | `PATCH /api/v1/versions/integration/:name/version/:version/status` |
| Delete version | `DELETE /api/v1/versions/integration/:name/version/:version` |

---

## Comparing Versions

Diff any two versions to see exactly what changed before deploying:

```http
GET /api/v1/versions/integration/:name/compare/1.0.0/2.0.0
```

**In the UI:** Versions list → select two versions → **Compare** — shows added, removed, and changed fields side-by-side.

---

## Rolling Back

```http
POST /api/v1/versions/integration/:name/rollback/1.0.0
{ "reason": "v2.0.0 causing 500 errors" }
```

- Can only roll back to an older semver (set `force: true` to override)
- Current default is deactivated automatically
- Rollback reason is recorded in the audit log

**In the UI:** Versions list → version row → **Rollback** → enter reason → confirm.

---

## Compatibility Modes

Each version declares its compatibility contract:

| Mode | Meaning |
|------|---------|
| `BACKWARD_COMPATIBLE` | Default — minor/patch bumps are safe for existing receivers |
| `STRICT` | No compatibility guarantees — receivers must update explicitly |
| `NONE` | Compatibility checking disabled |

Check compatibility before deploying:

```http
GET /api/v1/versions/integration/:name/compatibility/2.0.0
```

Returns `FULLY_COMPATIBLE`, `COMPATIBLE`, `BREAKING`, or `INCOMPATIBLE`.

---

## Deactivating Previous Versions

When updating to a new version, choose how to handle the previous one:

| Mode | Behaviour |
|------|-----------|
| `IMMEDIATE` | Previous version deactivated immediately |
| `SCHEDULED` | Deactivation queued for background processing |
| `NEVER` | Previous version stays active alongside the new one |

---

## Templates

Templates are reusable integration blueprints. Create one from any integration and deploy it across many endpoints with per-deployment overrides.

### Creating a template

**Via UI:** Integration detail → **Save as Template**

**Via API:**

```http
POST /api/v1/templates
{
  "name": "EHR Webhook Template",
  "category": "healthcare",
  "config": {
    "eventType": "appointment.created",
    "httpMethod": "POST",
    "outgoingAuthType": "BEARER",
    "timeoutMs": 10000,
    "retryCount": 3
  }
}
```

### One-click deploy

**Via UI:** Templates list → **Deploy** → fill in target URL + credentials → save.

**Via API:**

```http
POST /api/v1/templates/:id/deploy
{
  "name": "Clinic A Webhook",
  "targetUrl": "https://clinica.example.com/webhooks",
  "authConfig": { "token": "..." }
}
```

The `overrides` object is merged over the template's base config.
