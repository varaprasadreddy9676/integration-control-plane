# Outbound Event Delivery

Outbound delivery is the core of the gateway. When an event is received, the system finds all matching active integrations and either delivers, schedules, or holds the payload based on the configured delivery mode.

---

## How It Works

1. **Event arrives** in the queue with an `orgId`, `eventType`, and `payload`.
2. **Matching integrations** are fetched — all `OUTBOUND` configs that match the event type and are active.
3. **Payload transformation** is applied (field mapping or custom JS script).
4. Depending on `deliveryMode`, the system either:
   - sends immediately,
   - creates scheduled rows,
   - or stores a held payload for later release.
5. **Authentication headers** are attached based on the configured auth type.
6. **HTTP request** is sent to the `targetUrl` with the configured `httpMethod`.
7. **Response is logged** with full request/response body, status, and timing.
8. On failure, **retry logic** kicks in with exponential backoff.
9. If retries are exhausted, the event is written to the **Dead Letter Queue (DLQ)**.

---

## HTTP Methods Supported

`POST` (default), `PUT`, `PATCH`, `GET`

---

## Delivery Modes

| Mode | Behavior |
|------|----------|
| `IMMEDIATE` | Transform and deliver now |
| `DELAYED` | Transform now, schedule one future delivery |
| `RECURRING` | Transform now, schedule a recurring series |
| `WAIT_FOR_CONDITION` | Transform now, hold the payload until a release/discard event arrives |

`WAIT_FOR_EVENT` is accepted as a legacy alias and is normalized internally to `WAIT_FOR_CONDITION`.

Lifecycle and hold/release details are documented in [Outbound Lifecycle & Gated Delivery](/docs/outbound-lifecycle).

---

## Authentication Types

| Type | How It Works |
|------|-------------|
| `NONE` | No auth header added |
| `API_KEY` | Custom header with key/value you configure |
| `BEARER` | `Authorization: Bearer <token>` |
| `BASIC` | `Authorization: Basic <base64(user:pass)>` |
| `OAUTH2` | Client credentials flow — token fetched and cached automatically |
| `CUSTOM` | Custom JS script in a secure VM to build auth headers |

**Token caching:** For `OAUTH2` and `CUSTOM`, tokens are cached in memory. The cache is cleared automatically on 401/403 responses or when a token-expiration pattern is detected in the response body.

---

## Retry Logic

| Scenario | Retried? |
|----------|----------|
| `5xx` server error | Yes |
| `429` rate limited | Yes |
| `401` / `403` auth failure | Yes (also clears token cache) |
| `408` request timeout | Yes |
| `4xx` client error (other) | No |
| Network error (`ECONNREFUSED`, `ETIMEDOUT`, etc.) | Yes |
| Test events | No |

**Backoff formula:** `min(1000ms × 2^(attempt−1), 5000ms) + jitter(0–250ms)`

Default max retries: **3 attempts**. On final failure the status is set to `ABANDONED` and a DLQ entry is created.

---

## Dead Letter Queue (DLQ)

A DLQ entry is created when delivery permanently fails after all retries. It stores the original payload, error details, and correlation IDs so you can replay or inspect the failure.

**DLQ error codes:**

| Code | Meaning |
|------|---------|
| `INVALID_URL` | Target URL failed validation |
| `TRANSFORMATION_ERROR` | Payload transform script failed |
| `RATE_LIMIT` | Downstream returned 429 |
| `SERVER_ERROR` | Downstream returned 5xx |
| `CLIENT_ERROR` | Downstream returned 4xx (non-auth) |
| `TIMEOUT` | Connection timed out |
| `NETWORK_ERROR` | Host unreachable / DNS failure |
| `COMMUNICATION_ERROR` | Email/SMS delivery failed |

---

## Request Signing

If `enableSigning` is turned on, each request gets three additional headers:

```
X-Integration-Signature: sha256=<base64_hmac>
X-Message-ID: <uuid>
X-Timestamp: <unix_seconds>
```

The signature is HMAC-SHA256 over the JSON-serialized payload. Multiple signing secrets are supported for key rotation — the recipient can verify against any active secret.

---

## Multi-Action Integrations

A single integration can run a sequence of actions in order. Each action can have its own `targetUrl`, `httpMethod`, and transformation. Actions can also have conditions — a skipped action does not count as a failure.

**Overall status logic:**

| Actions Result | Final Status |
|----------------|-------------|
| All succeeded | `SUCCESS` |
| Mix of success + failure | `PARTIAL_SUCCESS` |
| All failed | `FAILED` |
| All skipped | `SKIPPED` |

---

## Execution Tracing

Every delivery attempt produces a full execution trace record with:
- `traceId` — unique per event delivery
- `correlationId` — same as traceId, included as `X-Correlation-ID` / `X-Trace-ID` headers on every outgoing request
- Request payload, response body, status code, response time
- Step-by-step log (transformation → auth → HTTP call)
- `attemptCount` — how many tries were made

---

## Rate Limiting

Each integration can have a rate limit configured:
- `maxRequests` — requests allowed per window (default: 100)
- `windowSeconds` — time window size (default: 60 seconds)

If the limit is hit, the delivery is paused and retried. The downstream is not hammered.

---

## Target URL Validation

Outbound targets are validated both at save time and at delivery time.

Current rules:

| Rule | Behavior |
|------|----------|
| Scheme | Only `http://` and `https://` are allowed |
| HTTPS-only mode | Optional, controlled by system config `security.enforceHttps` |
| Private network blocking | Optional, controlled by `security.blockPrivateNetworks` |

This means local HTTP services are supported when your deployment allows them, while SSRF-related private-network restrictions remain a separate control.

---

## Configuration Reference

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `targetUrl` | string | — | HTTP endpoint to deliver to |
| `httpMethod` | string | `POST` | HTTP verb |
| `timeoutMs` | number | `10000` | Request timeout in ms |
| `retryCount` | number | `3` | Max delivery attempts |
| `outgoingAuthType` | string | `NONE` | Auth mechanism |
| `enableSigning` | boolean | `false` | HMAC request signing |
| `rateLimits.enabled` | boolean | `false` | Enable rate limiting |
| `rateLimits.maxRequests` | number | `100` | Requests per window |
| `rateLimits.windowSeconds` | number | `60` | Window size in seconds |
