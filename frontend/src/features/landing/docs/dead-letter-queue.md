# Dead Letter Queue (DLQ)

The Dead Letter Queue captures every delivery that exhausted all automatic retries. Instead of silently dropping failed events, the gateway preserves them so you can inspect, fix, and replay them.

---

## How Events Enter the DLQ

A delivery enters the DLQ only after all inline retry attempts fail:

```
Event → FAILED → Retry 1 → FAILED → Retry 2 → FAILED → Retry 3 → DLQ
```

**What triggers a DLQ entry:**

| Cause | Example |
|-------|---------|
| HTTP 5xx from target | Target server down |
| Network error | `ETIMEDOUT`, `ECONNREFUSED`, `ENOTFOUND` |
| HTTP 408 (timeout) | Target too slow |
| HTTP 429 with no `Retry-After` | Rate limited, no retry hint |

**What does NOT go to the DLQ:** HTTP 4xx errors (except 408/429), transformation errors, and disabled integrations.

---

## DLQ Entry Lifecycle

```
PENDING_RETRY → RETRYING → SUCCESS (removed)
                         ↘ FAILED → ABANDONED
```

| Status | Description |
|--------|-------------|
| `PENDING_RETRY` | Waiting for next automatic retry |
| `RETRYING` | DLQ worker actively attempting delivery |
| `ABANDONED` | Exceeded max retries — requires manual action |

---

## Automatic Retry

The DLQ worker runs every **60 seconds** using exponential backoff with jitter:

```
Delay = min(1000ms × 2^attempt, 5 min) ± 20% jitter
```

| Attempt | Approx. delay |
|---------|--------------|
| 1st | ~2 seconds |
| 2nd | ~4 seconds |
| 3rd | ~8 seconds |
| After max | → ABANDONED |

Default max DLQ retries: **3**. Configurable per deployment.

---

## Manual Operations

**In the UI:** Navigate to **DLQ** in the sidebar.

| Action | Description |
|--------|-------------|
| Single retry | Immediately retries one entry, ignoring `nextRetryAt` |
| Bulk retry | Select up to 100 entries → retry all at once |
| Delete entry | Permanently remove (use for test data / superseded events) |
| Clear DLQ | Deletes all `ABANDONED` entries; does not touch `PENDING_RETRY` |

---

## Error Categories

Each DLQ entry is tagged to help you prioritise:

| Category | Cause | Action |
|----------|-------|--------|
| `NETWORK` | DNS failure, connection refused | Check target URL reachability |
| `TIMEOUT` | Response exceeded deadline | Increase `timeoutMs` or check target latency |
| `RATE_LIMIT` | 429 from target | Back off or increase target quota |
| `SERVER_ERROR` | 5xx from target | Check target service health |
| `AUTH` | 401/403 from target | Rotate credentials in the integration config |
| `TRANSFORMATION` | Script execution error | Fix the transformation script then retry |

---

## API Reference

```
GET    /api/v1/dlq                    List entries (filterable by status, integration, event type)
GET    /api/v1/dlq/stats              Count by status and category
GET    /api/v1/dlq/:id                Full entry details + execution trace
POST   /api/v1/dlq/:id/retry          Retry single entry immediately
POST   /api/v1/dlq/bulk-retry         Retry multiple entries { ids: [...] }
DELETE /api/v1/dlq/:id                Delete single entry
POST   /api/v1/dlq/clear              Delete all ABANDONED entries
```
