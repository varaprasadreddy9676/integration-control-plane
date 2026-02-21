# Analytics & Reports

The gateway collects detailed metrics on every delivery, inbound request, and scheduled job. All metrics are computed from the actual execution log data — no separate analytics pipeline needed.

---

## Dashboard Summary (24-Hour View)

The dashboard shows a real-time overview of the last 24 hours:

| Metric | Description |
|--------|-------------|
| `totalDeliveries24h` | Total execution log entries in the last 24 hours |
| `successRate24h` | Percentage of successful deliveries (1 decimal precision) |
| `failedCount24h` | Count of `FAILED`, `ABANDONED`, and `SKIPPED` statuses |
| `avgResponseTimeMs24h` | Average response time across all deliveries |
| Integration Health | Top 5 integrations with `GREEN` / `RED` status |
| Recent Failures | Last 5 failed executions |

---

## Execution Statistics

Queryable stats over any date range, filterable by direction and integration:

### Status Breakdown
Count by status: `SUCCESS`, `FAILED`, `PENDING`, `RETRYING`, `ABANDONED`

### Direction Breakdown
Count by direction: `OUTBOUND`, `INBOUND`, `SCHEDULED`, `COMMUNICATION`

### Performance
- `avg` — Average `durationMs` across all executions
- `min` / `max` — Fastest and slowest execution

### Top Errors
Top 10 error codes from failed executions, sorted by frequency:
- `SERVER_ERROR`, `TIMEOUT`, `TRANSFORMATION_ERROR`, `NETWORK_ERROR`, etc.

---

## Event Audit Statistics

Deeper metrics on the event pipeline, configurable lookback window (default 24 hours):

### Delivery Outcomes
| Field | Description |
|-------|-------------|
| `totalReceived` | Total events received |
| `delivered` | Count with status `DELIVERED` |
| `skipped` | Count with status `SKIPPED` |
| `failed` | Count with status `FAILED` |
| `stuck` | Count with status `STUCK` |

### Skip & Duplicate Breakdown
- `skipReasons` — Map of skip category → count (e.g. `{ "DUPLICATE": 45, "NO_MATCH": 12 }`)
- `duplicateTypes` — Map of duplicate type → count

### Traffic Breakdown
- `bySource` — Event count grouped by source system (e.g. `{ "mysql": 100, "webhook": 75 }`)
- `byEventType` — Event count grouped by type (e.g. `{ "appointment.created": 60 }`)

### Processing Percentiles

| Metric | Description |
|--------|-------------|
| `avgProcessingTimeMs` | Mean processing time |
| `p50ProcessingTimeMs` | Median (50th percentile) |
| `p95ProcessingTimeMs` | 95th percentile |
| `p99ProcessingTimeMs` | 99th percentile |

**How percentiles are calculated:** Sort all processing times, take `array[length × 0.5 / 0.95 / 0.99]`.

### Delivery Quality Metrics
- `avgIntegrationsMatched` — Average integrations matched per event
- `avgDeliveredCount` — Average successful deliveries per event
- `avgFailedCount` — Average failed deliveries per event
- `successRate` — `avgDeliveredCount / avgIntegrationsMatched` (0–1 decimal)

---

## Log Stats Summary

Lightweight counters queryable from the logs page:

| Field | Description |
|-------|-------------|
| `total` | Total logs matching current filters |
| `success` | Count with status `SUCCESS` |
| `failed` | Count with status `FAILED` or `ABANDONED` |
| `pending` | Count with status `PENDING` or `RETRYING` |

**Supported filters:** integration ID, event type, direction, trigger type, date range.

---

## Daily Email Reports

The gateway can automatically send daily (or interval-based) failure reports via email:

- Configurable interval (default: 60 minutes)
- Configurable lookback window (default: 60 minutes)
- Minimum failure threshold before a report is sent (default: 1)
- Maximum items per report (default: 25)
- All report runs logged in `alert_center_logs` with status, recipients, and failure count

See [Email Notifications](./email-notifications) for setup details.

---

## Rate Limit Monitoring (Admin)

Admins can view rate limit status across all integrations:

| Field | Description |
|-------|-------------|
| `current` | Current request count in the active window |
| `limit` | Configured max requests |
| `remaining` | Requests remaining in window |
| `resetAt` | Timestamp when the window resets |

---

## Admin Audit Analytics

The admin audit log includes trend analysis:

- **Top 5 actions** by frequency
- **Top 5 admins** by activity
- **Action breakdown** — top 10 action types with counts
- **Daily counts** — trend over configurable number of days (1–365, default 7)

Query filters: action type, admin role, admin ID, date range, full-text search.

---

## Data Retention

| Data | Retention |
|------|-----------|
| Event audit logs | 90 days (configurable) |
| Execution logs | TTL index (minimum 7 days if configured) |
| Admin audit logs | Queryable, exported up to 5,000 records |

---

## Pagination Defaults

| Context | Default Limit | Max Limit |
|---------|--------------|-----------|
| Execution logs | 50 | 1,000 |
| Admin views | 50 | 200 |
| CSV export | — | 5,000 |
