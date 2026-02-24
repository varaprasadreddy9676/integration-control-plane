# Webhook Security

Every outbound delivery can be cryptographically signed so your receiver can verify the request originated from the gateway — not a third party.

---

## HMAC-SHA256 Signing

**Algorithm:** HMAC-SHA256
**Secret format:** `whsec_` + base64-encoded 32 bytes (256 bits of entropy)
**Signature format:** `v1,<base64_signature>`

For each delivery, the gateway computes:

```
HMAC-SHA256(signingSecret, "${messageId}.${timestamp}.${rawPayload}")
```

Three headers are added to every outbound request:

| Header | Value |
|--------|-------|
| `X-Integration-Signature` | `v1,<base64_signature>` |
| `X-Integration-Timestamp` | Unix timestamp (seconds) |
| `X-Integration-ID` | Unique per-delivery message ID |

**Enable signing:** Integration detail → Security tab → Enable Signing. The secret is shown once — save it immediately.

---

## Zero-Downtime Secret Rotation

Rotating a signing secret without downtime is a two-step process:

**Step 1 — Rotate** (new secret generated, old secret stays active):

```http
POST /api/v1/outbound-integrations/:id/signing/rotate
```

During rotation, the gateway signs requests with **both** the old and new secrets (space-separated in `X-Integration-Signature`). Your receiver can validate against either.

**Step 2 — Remove old secret** (after updating your receiver):

```http
POST /api/v1/outbound-integrations/:id/signing/remove
```

---

## Verifying Signatures (Receiver Side)

```javascript
const crypto = require('crypto');

function verifyWebhook(req, signingSecret) {
  const messageId  = req.headers['x-integration-id'];
  const timestamp  = req.headers['x-integration-timestamp'];
  const signature  = req.headers['x-integration-signature'];

  // 1. Reject stale requests (replay protection — 5 minute window)
  if (Math.abs(Math.floor(Date.now() / 1000) - parseInt(timestamp)) > 300) {
    throw new Error('Request timestamp too old');
  }

  // 2. Compute expected signature
  const secretBytes = Buffer.from(signingSecret.replace('whsec_', ''), 'base64');
  const signed = `${messageId}.${timestamp}.${req.rawBody}`;
  const expected = 'v1,' + crypto.createHmac('sha256', secretBytes)
    .update(signed, 'utf8').digest('base64');

  // 3. Verify (supports multiple signatures during rotation)
  const valid = signature.split(' ').some(sig =>
    crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
  );

  if (!valid) throw new Error('Signature mismatch');
}
```

> **Important:** Use the raw request body bytes, not the parsed JSON object. Use `express.raw()` or preserve `req.rawBody` before parsing middleware runs.

---

## Replay Attack Prevention

The gateway includes a **300-second (5-minute) timestamp tolerance**. Your receiver should enforce the same check — requests older than 5 minutes should be rejected even if the signature is valid.

---

## Outgoing Authentication Types

In addition to signing, each integration configures how it authenticates to the target:

| Type | Description |
|------|-------------|
| `NONE` | No auth header |
| `API_KEY` | Custom header + key value |
| `BASIC` | HTTP Basic (username + password) |
| `BEARER` | `Authorization: Bearer <token>` |
| `OAUTH2` | Client credentials — token fetched and cached automatically |
| `OAUTH1` | OAuth 1.0a signed requests |
| `CUSTOM_HEADERS` | Arbitrary key-value headers on every request |

---

## SSRF Protection

All target URLs are validated before saving and before each delivery. Blocked destinations:

| Category | Blocked ranges |
|----------|---------------|
| Private IPv4 | 10.x.x.x, 172.16-31.x.x, 192.168.x.x |
| Loopback | 127.x.x.x, ::1 |
| Link-local | 169.254.x.x, fe80::/10 |
| Localhost | `localhost` hostname |

HTTPS is enforced by default — HTTP target URLs are rejected in production.
