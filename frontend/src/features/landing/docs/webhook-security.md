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

### Receiver Verification

- reject stale requests
- verify against raw body, not parsed JSON
- support dual secrets during rotation

### Secret Rotation

Rotation remains two-step:

1. rotate and keep both secrets active
2. remove old secret after receiver update

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

HTTPS enforcement remains the production default.

---

## Recommended Pattern

For robust webhook/API security:

1. outbound: HMAC signing
2. inbound: request policy
   - IP allowlist where possible
   - origin allowlist only for browser traffic
   - rate limiting on public routes
3. add auth on top where the upstream supports it

This gives both transport verification and request admission control.
