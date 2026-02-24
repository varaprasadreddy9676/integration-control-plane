# Webhook Security Guide

The platform provides multiple layers of outbound webhook security: HMAC-SHA256 payload signing, SSRF protection, outgoing authentication options, and replay attack prevention. This guide covers each mechanism.

## Table of Contents

- [HMAC Payload Signing](#hmac-payload-signing)
- [Signing Secret Rotation](#signing-secret-rotation)
- [Verifying Signatures (Receiver-Side)](#verifying-signatures-receiver-side)
- [Outgoing Authentication Types](#outgoing-authentication-types)
- [SSRF Protection](#ssrf-protection)
- [Replay Attack Prevention](#replay-attack-prevention)
- [API Reference](#api-reference)

---

## HMAC Payload Signing

Every outbound delivery can include cryptographic proof that the request originated from the gateway — not a third party.

**Algorithm:** HMAC-SHA256
**Secret format:** `whsec_` + base64-encoded 32-byte (256-bit) random value
**Signature format:** `v1,<base64_signature>`

### How it works

For each delivery, the gateway computes:

```
HMAC-SHA256(signingSecret, "${messageId}.${timestamp}.${rawPayload}")
```

Three headers are added to the outbound HTTP request:

| Header | Value | Description |
|--------|-------|-------------|
| `X-Integration-Signature` | `v1,<base64_signature>` | The HMAC signature |
| `X-Integration-Timestamp` | Unix timestamp (seconds) | When the request was made |
| `X-Integration-ID` | Unique message ID | Per-delivery identifier |

### Enabling signing

**Via UI:** Integration detail → Security tab → Enable Signing → a signing secret is generated automatically.

**Via API** when creating/updating an integration:

```http
PUT /api/v1/outbound-integrations/:id
Content-Type: application/json

{
  "signingEnabled": true
}
```

The signing secret is generated server-side. It is shown once in the UI immediately after creation — **save it immediately**. It is never returned in GET responses.

---

## Signing Secret Rotation

Zero-downtime secret rotation is supported. During rotation, the gateway signs requests with **both** the old and new secrets simultaneously. Your receiver can validate against either until you complete the rotation.

### Rotation flow

**Step 1 — Initiate rotation** (generates a new secret, keeps old active):

```http
POST /api/v1/outbound-integrations/:id/signing/rotate
```

Response:

```json
{
  "newSecret": "whsec_<base64>",
  "message": "New secret active. Old secret still valid. Call /signing/remove when ready."
}
```

**Step 2 — Update your receiver** to accept the new secret.

**Step 3 — Remove the old secret** (once your receiver is updated):

```http
POST /api/v1/outbound-integrations/:id/signing/remove
```

This removes all old secrets from rotation, leaving only the current one active.

> **Note:** Up to 3 secrets can be active simultaneously during rotation. The gateway signs requests with all active secrets and sends them as space-separated values in `X-Integration-Signature`.

---

## Verifying Signatures (Receiver-Side)

Your receiving endpoint should verify the signature before processing the payload.

### Verification steps

1. Extract `X-Integration-Signature`, `X-Integration-Timestamp`, and `X-Integration-ID` from the request headers
2. Reject requests where the timestamp is older than **300 seconds** (5 minutes) — this prevents replay attacks
3. Compute the expected signature:
   ```
   HMAC-SHA256(yourSigningSecret, "${messageId}.${timestamp}.${rawBody}")
   ```
   Use the **raw request body bytes**, not the parsed JSON.
4. Compare the computed signature with the received signature using constant-time comparison

### Example (Node.js)

```javascript
const crypto = require('crypto');

function verifyWebhookSignature(req, signingSecret) {
  const signature = req.headers['x-integration-signature'];
  const timestamp  = req.headers['x-integration-timestamp'];
  const messageId  = req.headers['x-integration-id'];

  if (!signature || !timestamp || !messageId) {
    throw new Error('Missing signature headers');
  }

  // Replay attack check
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parseInt(timestamp)) > 300) {
    throw new Error('Request timestamp too old');
  }

  // Compute expected signature
  const rawBody = req.rawBody; // must be the raw bytes
  const signed = `${messageId}.${timestamp}.${rawBody}`;
  const expected = crypto
    .createHmac('sha256', signingSecret.replace('whsec_', ''))
    .update(signed)
    .digest('base64');

  // Compare — support multiple signatures (rotation)
  const receivedSigs = signature.split(' ').map(s => s.replace('v1,', ''));
  const valid = receivedSigs.some(sig =>
    crypto.timingSafeEqual(Buffer.from(sig, 'base64'), Buffer.from(expected, 'base64'))
  );

  if (!valid) throw new Error('Signature mismatch');
  return true;
}
```

> **Important:** Always read the raw body before parsing. Middleware that parses JSON before your handler will modify the body, breaking signature verification. Use `express.raw()` or preserve `req.rawBody`.

---

## Outgoing Authentication Types

Each integration configures how the gateway authenticates to the target endpoint:

| Auth Type | Description |
|-----------|-------------|
| `NONE` | No authentication header |
| `API_KEY` | Custom header name + API key value |
| `BASIC` | HTTP Basic Auth (username + password, base64-encoded) |
| `BEARER` | `Authorization: Bearer <token>` |
| `OAUTH2` | Client credentials flow — gateway fetches and caches tokens automatically |
| `OAUTH1` | OAuth 1.0a signed requests (for NetSuite, legacy APIs) |
| `CUSTOM` | Custom token endpoint with configurable request body |
| `CUSTOM_HEADERS` | Arbitrary set of key-value headers added to every request |

### OAuth2 (client credentials)

When `outgoingAuthType` is `OAUTH2`, configure:

```json
{
  "outgoingAuthType": "OAUTH2",
  "authConfig": {
    "tokenUrl": "https://auth.example.com/oauth/token",
    "clientId": "...",
    "clientSecret": "...",
    "scope": "integrations:write"
  }
}
```

The gateway caches the access token and refreshes it before expiry. No manual token management required.

### API Key header

```json
{
  "outgoingAuthType": "API_KEY",
  "authConfig": {
    "headerName": "X-API-Key",
    "apiKey": "your-api-key"
  }
}
```

---

## SSRF Protection

The gateway validates all target URLs before saving integrations and before each delivery to prevent Server-Side Request Forgery attacks.

**Blocked destinations:**

| Category | Ranges blocked |
|----------|---------------|
| Private IPv4 | 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16 |
| Loopback | 127.0.0.0/8, ::1/128 |
| Link-local | 169.254.0.0/16, fe80::/10 |
| Unique local (IPv6) | fc00::/7 |
| Zero address | 0.0.0.0/8 |
| Localhost hostname | `localhost` |

**HTTPS enforcement** is enabled by default. HTTP target URLs are rejected unless explicitly overridden in `config.json` under `security.enforceHttps: false` (not recommended for production).

Validation runs at:
1. Integration create/update (prevents saving bad URLs)
2. Delivery time (re-validates before each HTTP call)

---

## Replay Attack Prevention

The gateway includes a **300-second (5-minute) timestamp tolerance** in signature verification. Requests with `X-Integration-Timestamp` older than 5 minutes are rejected.

This prevents an attacker who captures a valid signed request from replaying it minutes or hours later.

Your receiver should enforce the same check:

```javascript
const age = Math.abs(Math.floor(Date.now() / 1000) - parseInt(timestamp));
if (age > 300) {
  return res.status(400).json({ error: 'Request too old' });
}
```

---

## API Reference

```
POST   /api/v1/outbound-integrations/:id/signing/rotate    Rotate signing secret (zero-downtime)
POST   /api/v1/outbound-integrations/:id/signing/remove    Remove old secrets after rotation complete
```

Both endpoints require `INTEGRATION_EDITOR` role or above and are recorded in the audit log.
