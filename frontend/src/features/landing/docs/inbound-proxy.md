# Inbound API Proxy

The inbound proxy lets external systems call a single gateway endpoint. The gateway validates the caller, optionally transforms the request, forwards it to your internal API, and returns the response — all with full execution tracing.

---

## How It Works

1. External system sends a request to:
   `POST /api/v1/integrations/:type?orgId=<orgId>`
2. Gateway looks up the active inbound integration config matching `type` + `orgId`.
3. **Inbound authentication** is validated (API key, Bearer token, or Basic auth).
4. **Rate limit** is checked. Standard rate-limit headers are returned.
5. **Request transformation** is applied — reshape or enrich the incoming payload.
6. **HTTP request** is forwarded to your internal `targetUrl`.
7. **Response transformation** is applied to the upstream response.
8. Transformed response is returned to the caller.
9. Full execution trace is written.

---

## Inbound Authentication

Callers must authenticate using the method you configure on the integration:

| Type | How to Call |
|------|------------|
| `NONE` | No auth required |
| `API_KEY` | Send key in a custom header (e.g. `X-API-Key: <key>`) |
| `BEARER` | `Authorization: Bearer <token>` |
| `BASIC` | `Authorization: Basic <base64(username:password)>` |

---

## Outgoing Authentication (to your backend)

After validating the caller, the gateway adds authentication headers before forwarding to your internal API. Supported types are the same as outbound: `NONE`, `API_KEY`, `BEARER`, `BASIC`, `OAUTH2`, `CUSTOM`.

For `OAUTH2` and `CUSTOM`, tokens are cached and refreshed automatically. You can also manually clear the cache via the refresh-token endpoint.

---

## Request Transformation

Before forwarding to your backend, the payload can be reshaped:

- **SIMPLE mode** — field mapping with dot notation
- **SCRIPT mode** — custom JS in a secure sandboxed VM (60s timeout, async/await supported)

The script context includes the original `body`, `query`, and `headers`. Returning `null` from a script will skip the delivery entirely.

---

## Response Transformation

The upstream response is passed back through the same transformation engine before being returned to the caller:

- Input: `{ data, status, headers }` from your backend
- Output: Reshaped response returned to the original caller

---

## Streaming Mode

Set `streamResponse: true` to pipe the upstream response directly to the caller without buffering or transformation. Useful for large payloads or binary data.

Hop-by-hop headers (`connection`, `transfer-encoding`, `upgrade`, etc.) are stripped automatically before piping.

---

## Asynchronous (COMMUNICATION) Mode

For email/SMS integrations, the gateway accepts the request immediately and queues it:
- Returns **HTTP 202 Accepted** with a `jobId`
- A background worker picks up the job and processes it
- Retries are handled by the worker (up to `maxRetries`, default 3)

---

## Rate Limiting

| Header Returned | Meaning |
|-----------------|---------|
| `X-RateLimit-Limit` | Configured max requests |
| `X-RateLimit-Remaining` | Remaining requests in current window |
| `X-RateLimit-Reset` | Unix timestamp when window resets |
| `Retry-After` | Seconds to wait (on 429 response) |

---

## Error Codes

| Code | HTTP Status | Meaning |
|------|-------------|---------|
| `INVALID_TENANT` | 400 | Missing or invalid `orgId` |
| `INTEGRATION_NOT_FOUND` | 404 | No active integration for this `type` |
| `AUTHENTICATION_FAILED` | 401 | Caller credentials are wrong |
| `RATE_LIMIT_EXCEEDED` | 429 | Too many requests |
| `TRANSFORMATION_ERROR` | 500 | Transform script failed |
| `UPSTREAM_ERROR` | 502 | Your backend returned 4xx/5xx |
| `UPSTREAM_TIMEOUT` | 504 | Your backend timed out |
| `JOB_CREATION_ERROR` | 500 | Failed to queue async job |

---

## Execution Tracing

Every inbound request produces a full execution trace:
- `traceId` — unique per request
- Steps logged: `inbound_auth`, `rate_limit`, `request_transformation`, `http_request`, `response_transformation`
- Attempt count, response time, status code, request/response bodies all recorded

---

## Configuration Reference

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `type` | string | — | Unique identifier per tenant (used in URL) |
| `targetUrl` | string | — | Your internal API endpoint |
| `httpMethod` | string | `POST` | HTTP verb for forwarding |
| `inboundAuthType` | string | `NONE` | How callers authenticate |
| `outgoingAuthType` | string | `NONE` | How gateway authenticates to your backend |
| `streamResponse` | boolean | `false` | Stream response without buffering |
| `timeout` | number | `10000` | Timeout for upstream call (ms) |
| `retryCount` | number | `3` | Retry attempts on upstream failure |
| `rateLimits.enabled` | boolean | `false` | Enable rate limiting |
| `rateLimits.maxRequests` | number | `100` | Max requests per window |
| `rateLimits.windowSeconds` | number | `60` | Window size in seconds |
