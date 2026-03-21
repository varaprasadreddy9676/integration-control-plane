# Webhook Security Guide

The platform provides multiple layers of outbound and inbound security: outbound HMAC-SHA256 payload signing, native inbound HMAC verification, SSRF protection, incoming request-policy controls, outgoing authentication options, and replay attack prevention. This guide covers each mechanism.

## Table of Contents

- [HMAC Payload Signing](#hmac-payload-signing)
- [Inbound HMAC Verification](#inbound-hmac-verification)
- [Signing Secret Rotation](#signing-secret-rotation)
- [Verifying Signatures (Receiver-Side)](#verifying-signatures-receiver-side)
- [Authentication Types](#authentication-types)
- [Inbound Request Policy](#inbound-request-policy)
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

If signing is enabled and the gateway cannot generate signature headers, the delivery is failed immediately. It is not sent unsigned.

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

## Inbound HMAC Verification

Inbound integrations can now require HMAC signatures as a native `inboundAuthType`.

Use this when a third-party webhook sender or partner system can sign requests but should not need the gateway's admin API key.

### Runtime path

Inbound HMAC integrations use the public runtime endpoint:

```text
POST /api/v1/public/integrations/:type?orgId=...
```

The request is still protected by the per-integration HMAC verification step. No gateway `X-API-Key` is required for this runtime path.

### Example config

```json
{
  "inboundAuthType": "HMAC",
  "inboundAuthConfig": {
    "secret": "whsec_<base64>",
    "signatureHeader": "X-Integration-Signature",
    "timestampHeader": "X-Integration-Timestamp",
    "messageIdHeader": "X-Integration-ID",
    "toleranceSeconds": 300
  }
}
```

Defaults:
- `signatureHeader`: `X-Integration-Signature`
- `timestampHeader`: `X-Integration-Timestamp`
- `messageIdHeader`: `X-Integration-ID`
- `toleranceSeconds`: `300`

### Verification behavior

For inbound HMAC auth, the gateway:

1. preserves the raw request body before JSON parsing changes it
2. extracts message ID, timestamp, and signature from configured headers
3. verifies `HMAC-SHA256(secret, "${messageId}.${timestamp}.${rawBody}")`
4. rejects stale requests outside the replay window
5. supports multiple signatures in the header so rotated sender secrets can still be verified

If verification fails, the request is rejected with `401 AUTHENTICATION_FAILED` before any transformation or upstream call.

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

## Authentication Types

Outbound integrations configure how the gateway authenticates to the target endpoint:

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

Inbound integrations support:

| Auth Type | Description |
|-----------|-------------|
| `NONE` | No integration-specific auth |
| `API_KEY` | Header-based shared secret |
| `BEARER` | Bearer token check |
| `BASIC` | HTTP Basic Auth |
| `HMAC` | Raw-body signature verification with replay protection |

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

## Inbound Request Policy

Inbound integrations can enforce a reusable request policy without custom middleware per endpoint.

Current controls:

| Control | Purpose |
|--------|---------|
| `allowedIpCidrs` | Restrict server-to-server callers by source IP/CIDR |
| `allowedBrowserOrigins` | Restrict browser-origin traffic by exact `Origin` |
| `rateLimit` | Per-integration inbound request throttling |

Important:
- IP allowlisting is the primary server-to-server restriction.
- Browser origin restriction is useful for browser-based traffic only.
- “Domain restriction” should be modeled as exact allowed browser origins, not as a generic security guarantee for backend callers.

Typical inbound policy shape:

```json
{
  "requestPolicy": {
    "allowedIpCidrs": ["203.0.113.10/32", "198.51.100.0/24"],
    "allowedBrowserOrigins": ["https://app.example.com"],
    "rateLimit": {
      "enabled": true,
      "maxRequests": 60,
      "windowSeconds": 60
    }
  }
}
```

Behavior:
- blocked IPs are rejected before provider processing
- blocked origins are rejected before provider processing
- policy denials are written to app/system logs for operator visibility
- the same policy model is reusable across inbound integrations

Request policy and inbound authentication are independent:
- use `HMAC` when the caller can cryptographically sign the request
- use `API_KEY`, `BEARER`, or `BASIC` when the caller supports shared credentials
- combine any of the above with IP allowlists and rate limiting when needed

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

Only `http://` and `https://` target URLs are allowed. HTTPS is recommended, and strict HTTPS-only behavior can be enabled through `security.enforceHttps: true`. Private-network blocking remains a separate control through `security.blockPrivateNetworks`.

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
GET    /api/v1/public/integrations/:type                   Public inbound runtime with optional HMAC/auth checks
POST   /api/v1/public/integrations/:type                   Public inbound runtime with optional HMAC/auth checks
PUT    /api/v1/public/integrations/:type                   Public inbound runtime with optional HMAC/auth checks
```

Both endpoints require `INTEGRATION_EDITOR` role or above and are recorded in the audit log.
