# Dead Letter Queue (DLQ) Guide

The Dead Letter Queue stores delivery attempts that have exhausted all automatic retries. It is the last line of defense before an event is permanently abandoned, giving operators visibility and control over every failure.

## Table of Contents

- [How Deliveries Enter the DLQ](#how-deliveries-enter-the-dlq)
- [DLQ Entry Lifecycle](#dlq-entry-lifecycle)
- [Automatic Retry (DLQ Worker)](#automatic-retry-dlq-worker)
- [Manual Operations via UI](#manual-operations-via-ui)
- [API Endpoints](#api-endpoints)
- [Error Categories](#error-categories)
- [DLQ vs Delivery Logs](#dlq-vs-delivery-logs)
- [Configuration](#configuration)
- [Monitoring & Alerts](#monitoring--alerts)
- [Troubleshooting](#troubleshooting)

---

## How Deliveries Enter the DLQ

A delivery enters the DLQ when **all inline retry attempts fail**. The inline retry count is configured per integration (`retryCount` field, default: 3).

```
Event delivered → FAILED → Retry 1 → FAILED → Retry 2 → FAILED → Retry 3 → DLQ
```

**What triggers a DLQ entry:**
- HTTP 5xx responses from the target endpoint after max inline retries
- Network errors (ETIMEDOUT, ECONNREFUSED, ENOTFOUND) after max retries
- HTTP 408 (Request Timeout) after max retries
- HTTP 429 (Rate Limited) with no `Retry-After` header after max retries

**What does NOT go to DLQ:**
- HTTP 4xx errors (except 408/429) — these are treated as permanent failures (bad payload/config)
- Transformation errors — logged but not queued for DLQ retry
- Integrations that are disabled before delivery

---

## DLQ Entry Lifecycle

```
PENDING_RETRY → RETRYING → SUCCESS (removed) / FAILED → ABANDONED
```

| Status | Description |
|--------|-------------|
| `PENDING_RETRY` | Waiting for next automatic retry attempt |
| `RETRYING` | DLQ worker is actively attempting delivery |
| `ABANDONED` | Exceeded max DLQ retries; requires manual action |

---

## Automatic Retry (DLQ Worker)

The DLQ worker runs every **60 seconds** and processes up to **50 entries per cycle**.

**Retry strategy — exponential backoff with jitter:**

```
Delay = min(baseDelay × 2^attemptCount, maxDelay) + jitter(±20%)

baseDelay = 1000ms
maxDelay  = 5 minutes
```

| Attempt | Approximate delay |
|---------|-----------------|
| 1st DLQ retry | ~2 seconds |
| 2nd DLQ retry | ~4 seconds |
| 3rd DLQ retry | ~8 seconds (+ jitter) |
| After max retries | → ABANDONED |

**Max DLQ retries** default: `3` (configurable in `backend/config.json` under `worker.dlq.maxRetries`).

When an entry is ABANDONED, an alert is sent to the org's configured notification channel.

---

## Manual Operations via UI

Navigate to **DLQ** in the sidebar.

### Viewing entries

The DLQ list shows:
- Integration name and event type
- Last error message and error category
- Attempt count and next retry time
- Status badge (PENDING_RETRY / ABANDONED)

Click any entry to see the full **original payload**, **target URL**, **last error response**, and **execution trace**.

### Retrying entries

**Single retry** — click the retry button on any entry. This immediately triggers a delivery attempt regardless of `nextRetryAt`.

**Bulk retry** — select up to 100 entries and click "Retry Selected". The system queues all selected entries for immediate delivery.

**Clear DLQ** — removes all ABANDONED entries. Does not affect PENDING_RETRY entries.

### Deleting entries

Individual entries can be deleted permanently from the detail view. Use this only when you've confirmed the event should not be delivered (e.g., test data, superseded events).

---

## API Endpoints

All endpoints require authentication (`X-API-Key` or `Authorization: Bearer`).

```
GET    /api/v1/dlq                    List DLQ entries (paginated, filterable)
GET    /api/v1/dlq/stats              Aggregate statistics (count by status/category)
GET    /api/v1/dlq/:id                Single entry details + execution trace
POST   /api/v1/dlq/:id/retry         Retry a single entry immediately
POST   /api/v1/dlq/bulk-retry        Retry multiple entries { ids: [...] }
DELETE /api/v1/dlq/:id               Delete a single entry
POST   /api/v1/dlq/clear             Delete all ABANDONED entries for the org
```

**List query parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `status` | string | Filter by `PENDING_RETRY` or `ABANDONED` |
| `integrationId` | string | Filter by integration |
| `eventType` | string | Filter by event type |
| `search` | string | Full-text search across payload and error |
| `page` | number | Page number (default: 1) |
| `limit` | number | Items per page (default: 20, max: 100) |

---

## Error Categories

Each DLQ entry is tagged with an error category to help diagnose and prioritize:

| Category | HTTP Status / Cause | Recommended Action |
|----------|--------------------|--------------------|
| `NETWORK` | Connection refused, DNS failure, TCP timeout | Check target URL is reachable from your server |
| `TIMEOUT` | Response exceeded deadline | Increase `timeoutMs` on the integration or check target latency |
| `RATE_LIMIT` | 429 Too Many Requests | Back off or configure per-integration rate limits |
| `SERVER_ERROR` | 5xx responses | Check target service health |
| `AUTH` | 401/403 responses | Rotate credentials; check auth config on integration |
| `VALIDATION` | 400/422 responses | Review payload structure and transformation script |
| `TRANSFORMATION` | Script execution error | Fix the transformation script and retry |

---

## DLQ vs Delivery Logs

| | Delivery Logs | DLQ |
|---|---|---|
| **Purpose** | Record of every delivery attempt | Entries awaiting retry after exhausting inline retries |
| **Retention** | 30 days (configurable) | Until manually deleted or auto-abandoned |
| **Auto-cleared** | By TTL index | Only ABANDONED entries via "Clear DLQ" |
| **Contains** | All attempts (success + failure) | Failed deliveries only |
| **Retry from** | No — read-only | Yes — single or bulk |

---

## Configuration

In `backend/config.json`:

```json
{
  "worker": {
    "dlq": {
      "enabled": true,
      "intervalMs": 60000,
      "batchSize": 50,
      "maxRetries": 3
    }
  }
}
```

| Field | Default | Description |
|-------|---------|-------------|
| `enabled` | `true` | Enable/disable DLQ auto-retry worker |
| `intervalMs` | `60000` | How often the DLQ worker polls (ms) |
| `batchSize` | `50` | Max entries processed per cycle |
| `maxRetries` | `3` | Max DLQ retry attempts before ABANDONED |

---

## Monitoring & Alerts

**DLQ size alert** — an alert is generated when the DLQ size exceeds the configured threshold. Configure in org settings under Alert Center.

**ABANDONED alert** — each time an entry is abandoned, an alert is sent to the org's notification channel (email or Slack).

**Dashboard** — the main dashboard shows the current DLQ count as a KPI card. A rising DLQ count indicates a systemic issue with a target endpoint.

---

## Troubleshooting

**DLQ entries not being retried**
- Check that the DLQ worker is running: `GET /health` should show `dlqWorker: running`
- Check `worker.dlq.enabled` is `true` in `config.json`
- Verify the entry is in `PENDING_RETRY` status (ABANDONED entries are not auto-retried)

**All retries failing with AUTH category**
- The integration's auth credentials have likely expired or been rotated
- Update the integration's auth config and then manually retry

**DLQ growing faster than it drains**
- Your target endpoint is consistently failing — fix the underlying issue first
- Consider temporarily disabling the affected integration to stop new entries
- After fixing, use bulk retry to requeue all ABANDONED entries

**Accidentally cleared the DLQ**
- ABANDONED entries deleted via "Clear DLQ" cannot be recovered
- PENDING_RETRY entries are not affected by "Clear DLQ"
- For critical events, check delivery logs which retain the original payload for 30 days
