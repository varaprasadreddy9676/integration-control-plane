# Alert Center

The Alert Center is the org-level notification hub. It logs every alert dispatched by the platform and provides a searchable, exportable history of all notification events.

---

## How Alerts Work

Background workers monitor integration health and generate alerts when thresholds are breached. Each alert is:

1. **Generated** by the delivery worker, DLQ worker, or failure report scheduler
2. **Sent** to the org's configured notification channel (email, Slack, webhook)
3. **Logged** to the alert center with full metadata, provider response, and error details

The Alert Center shows the history of sent (and failed) alerts — not a real-time feed.

---

## Alert Categories

| Category | Trigger |
|----------|---------|
| Integration delivery failures | High failure rate in a configurable window |
| Connection errors | Network timeouts, DNS failures after retries |
| Transformation errors | Script execution failures |
| Authentication failures | 401/403 responses — credentials expired |
| Rate limiting | 429 responses from target endpoints |
| DLQ size threshold | Too many entries in the dead letter queue |
| DLQ entry abandoned | Single event hit max DLQ retries and was abandoned |

---

## Notification Channels

| Channel | Description |
|---------|-------------|
| `EMAIL` | Email to one or more recipients |
| `SLACK` | Slack channel message or DM |
| `WEBHOOK` | HTTP POST to a custom endpoint |

The gateway delivers alerts to a configurable `communicationServiceUrl`. That service handles final delivery to email/Slack.

---

## Failure Report Configuration

The failure report is a recurring alert summarising delivery failures within a time window. Configure it in **Settings → Alert Center**.

| Field | Default | Description |
|-------|---------|-------------|
| `enabled` | `false` | Enable automatic failure reports |
| `intervalMinutes` | `15` | How often the scheduler runs |
| `lookbackMinutes` | `60` | How far back to look for failures |
| `minFailures` | `1` | Minimum failure count to trigger an alert |
| `maxItems` | `25` | Max failures included in one report |

**Example:** With `intervalMinutes: 15` and `lookbackMinutes: 60`, the scheduler runs every 15 minutes and reports failures from the last hour.

---

## Viewing Alert Logs

**In the UI:** Navigate to **Alert Center** in the sidebar.

Filter by status, channel, type, recipient, or date range. Click any entry to see the full payload, provider response, and error stack.

**Via API:**

```http
GET /api/v1/alert-center?status=FAILED&channel=EMAIL&startDate=2026-02-01
```

| Filter | Options |
|--------|---------|
| `status` | `SENT`, `FAILED`, `PENDING`, `RETRY` |
| `channel` | `EMAIL`, `SLACK`, `WEBHOOK` |
| `type` | Alert category |
| `search` | Subject, error message, recipients |
| `startDate` / `endDate` | ISO date range |

---

## Exporting Alerts

**JSON export** — full alert details including error stacks:

```http
GET /api/v1/alert-center/export/json
```

**CSV export** — tabular format with columns: Alert ID, Timestamp, Status, Channel, Type, Subject, Recipients, Total Failures, Window Start, Window End, Error Message:

```http
GET /api/v1/alert-center/export/csv
```

Both endpoints accept the same query filters as the list endpoint.

---

## API Reference

```
GET    /api/v1/alert-center               Alert log (filterable, paginated)
GET    /api/v1/alert-center/status        Failure report scheduler status + config
GET    /api/v1/alert-center/export/json   Export as JSON
GET    /api/v1/alert-center/export/csv    Export as CSV
```
