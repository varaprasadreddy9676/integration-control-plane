# Webhook Security

The platform separates **outbound delivery security** from **inbound request protection**. Both matter, and they are configured differently.

---

## Outbound Signing

Outbound integrations can be cryptographically signed so receivers can verify the request came from the gateway.

### HMAC-SHA256 Signing

**Algorithm:** HMAC-SHA256  
**Secret format:** `whsec_` + base64-encoded 32 bytes  
**Signature format:** `v1,<base64_signature>`

The signature is calculated over:

```text
${messageId}.${timestamp}.${rawPayload}
```

Headers added:

| Header | Value |
|--------|-------|
| `X-Integration-Signature` | `v1,<base64_signature>` |
| `X-Integration-Timestamp` | Unix timestamp (seconds) |
| `X-Integration-ID` | Unique per-delivery message ID |

If signing is enabled and the gateway cannot generate those headers, the request is failed immediately. It is not sent unsigned.

### Receiver Verification

- reject stale requests
- verify against raw body, not parsed JSON
- support dual secrets during rotation

### Secret Rotation

Rotation remains two-step:

1. rotate and keep both secrets active
2. remove old secret after receiver update

---

## Inbound HMAC Verification

Inbound integrations can also use `HMAC` as a native authentication type.

Use this when the caller can sign webhook requests but should not need the gateway's admin API key.

How it works:
- the integration runs on `/api/v1/public/integrations/:type`
- the gateway reads the raw request body
- it verifies `HMAC-SHA256(secret, "${messageId}.${timestamp}.${rawBody}")`
- it rejects stale timestamps outside the configured replay window

Default inbound HMAC headers:

| Header | Default |
|--------|---------|
| Signature | `X-Integration-Signature` |
| Timestamp | `X-Integration-Timestamp` |
| Message ID | `X-Integration-ID` |

Replay tolerance defaults to `300` seconds and can be configured per integration.

---

## Inbound Request Policy

Inbound integrations now support a dedicated **Request Policy** section. This is the primary protection layer for inbound APIs and public webhook-style routes.

Supported controls:

### IP Allowlist

Restrict inbound traffic to exact IPs or CIDR ranges.

Use this for:

- server-to-server integrations
- fixed vendor IPs
- internal network callers

### Browser Origin Allowlist

Restrict browser-origin traffic using exact `Origin` matches.

Use this only for browser-based traffic. It is not a replacement for IP restrictions in backend-to-backend flows.

### Per-Integration Rate Limits

Rate limiting is now part of the same request policy object.

Use it to:

- cap abusive traffic
- protect public routes
- prevent accidental burst loads

Denied requests are visible in logs and system logs for auditability.

---

## Authentication Types

Outbound authentication:

| Type | Description |
|------|-------------|
| `NONE` | No auth header |
| `API_KEY` | Custom header + key value |
| `BASIC` | HTTP Basic |
| `BEARER` | Bearer token |
| `OAUTH2` | Client credentials with token caching |
| `OAUTH1` | OAuth 1.0a signed requests |
| `CUSTOM_HEADERS` | Arbitrary static headers |

Inbound authentication is configured separately per inbound integration and can be used together with request policy controls.

Inbound types:

| Type | Description |
|------|-------------|
| `NONE` | No integration-specific auth |
| `API_KEY` | Header-based shared secret |
| `BASIC` | HTTP Basic |
| `BEARER` | Bearer token |
| `HMAC` | Raw-body signature verification with replay protection |

---

## SSRF Protection

All outbound target URLs are validated before save and before delivery.

Blocked targets include:

| Category | Examples |
|----------|----------|
| Private IPv4 | `10.x.x.x`, `172.16-31.x.x`, `192.168.x.x` |
| Loopback | `127.x.x.x`, `::1` |
| Link-local | `169.254.x.x`, `fe80::/10` |
| Localhost names | `localhost` |

Both `http://` and `https://` targets are supported. HTTPS is still recommended, and admins can re-enable strict HTTPS-only enforcement through system config if required.

---

## Recommended Pattern

For robust webhook/API security:

1. outbound: HMAC signing
2. inbound: auth + request policy
   - use `HMAC` for signed webhook senders
   - use `API_KEY`, `BASIC`, or `BEARER` when the caller supports shared credentials
3. request policy
   - IP allowlist where possible
   - origin allowlist only for browser traffic
   - rate limiting on public routes

This gives both transport verification and request admission control.
