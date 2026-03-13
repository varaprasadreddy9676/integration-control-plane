# Analytics & Reports

The platform computes analytics directly from execution logs, event audit data, scheduled job history, and alert activity. The dashboard and logs views now share the same filter model, so drill-downs stay consistent instead of showing mismatched counts.

---

## Dashboard Summary

The dashboard is split into scoped views:

- `All`
- `Outbound`
- `Inbound`
- `Scheduled`

Each scope shows:

| Metric | Description |
|--------|-------------|
| `totalDeliveries24h` | Total matching executions in the last 24 hours |
| `successRate24h` | Success percentage for the current scope |
| `failedCount24h` | Count of `FAILED` and `ABANDONED` executions |
| `avgResponseTimeMs24h` | Average response time for matching executions |
| Integration Health | Per-integration health status with last activity |
| Recent Failures | Recent failed or abandoned executions |

`SKIPPED` executions are tracked separately and are **not counted as failures**.

---

## Drill-Down Behaviour

All dashboard drill-downs now open the delivery logs page with matching filters applied:

- status
- integration
- event type
- direction / flow
- trigger type
- error category
- hour
- day of week
- date range

The logs page also shows the active filters as removable chips, so the drill-down state is visible and editable.

---

## Execution Statistics

Queryable over any date range and filterable by:

- integration
- event type
- direction
- trigger type
- status
- error category
- hour / weekday

### Status Breakdown

Common execution statuses:

- `SUCCESS`
- `FAILED`
- `ABANDONED`
- `PENDING`
- `RETRYING`
- `SKIPPED`

### Direction Breakdown

- `OUTBOUND`
- `INBOUND`
- `COMMUNICATION`
- `SCHEDULE`
- `SCHEDULED`

Scheduled trigger aliases are normalized in the analytics and logs views, so scheduled drill-downs are consistent even when historical data uses both labels.

### Performance

- `avg` — Average response time
- `min` / `max` — Fastest and slowest execution
- `p50` / `p95` / `p99` — Percentiles where available

### Top Errors

Grouped by category and message, for example:

- `SERVER_ERROR`
- `TIMEOUT`
- `TRANSFORMATION_ERROR`
- `NETWORK_ERROR`
- `AUTH`

---

## Event Audit Statistics

The event audit pipeline provides upstream visibility separate from execution logs.

### Delivery Outcomes

| Field | Description |
|-------|-------------|
| `totalReceived` | Total source events received |
| `delivered` | Events with at least one successful downstream delivery |
| `skipped` | Events intentionally skipped |
| `failed` | Events that failed processing |
| `stuck` | Events still incomplete past the expected window |

### Skip & Duplicate Breakdown

- `skipReasons` — grouped skip categories such as `DUPLICATE` or `NO_MATCH`
- `duplicateTypes` — duplicate classifications where enabled

### Traffic Breakdown

- `bySource` — source system counts such as `mysql`, `kafka`, `webhook`
- `byEventType` — event counts grouped by event type

### Processing Percentiles

| Metric | Description |
|--------|-------------|
| `avgProcessingTimeMs` | Mean processing time |
| `p50ProcessingTimeMs` | Median |
| `p95ProcessingTimeMs` | 95th percentile |
| `p99ProcessingTimeMs` | 99th percentile |

---

## Logs Stats Summary

The delivery logs page uses the same filters for both the table and summary cards.

| Field | Description |
|-------|-------------|
| `total` | Total logs matching current filters |
| `success` | Matching rows with `SUCCESS` |
| `failed` | Matching rows with `FAILED` or `ABANDONED` |
| `pending` | Matching rows with `PENDING` or `RETRYING` |
| `skipped` | Matching rows with `SKIPPED` |

This keeps drill-downs and summary metrics aligned.

---

## Reports and Alerts

The platform supports scheduled failure reporting and alert summaries:

- configurable lookback windows
- minimum failure thresholds
- capped item counts per report
- email / webhook / Slack alert delivery

See [Email Notifications](./email-notifications) and [Alert Center](./alert-center) for the operational side.

---

## Operational Monitoring

Analytics is complemented by:

- `System Status` for worker, adapter, and process health
- `System Logs` for application, access, and process output
- `Alert Center` for dispatched failure notifications

Use analytics for trends and logs/system status for runtime diagnosis.
