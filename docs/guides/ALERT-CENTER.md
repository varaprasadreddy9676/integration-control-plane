# Alert Center Guide

The Alert Center is the org-level notification hub. It logs every alert sent to external channels and provides a searchable, exportable history of all notification events. Alerts are generated automatically by the platform for integration failures, DLQ growth, and other threshold-based conditions.

## Table of Contents

- [How Alerts Work](#how-alerts-work)
- [Alert Categories](#alert-categories)
- [Notification Channels](#notification-channels)
- [Configuring the Failure Report](#configuring-the-failure-report)
- [Viewing Alert Logs](#viewing-alert-logs)
- [Exporting Alerts](#exporting-alerts)
- [API Endpoints](#api-endpoints)
- [Troubleshooting](#troubleshooting)

---

## How Alerts Work

The platform's background workers monitor integration health and generate alerts when configured thresholds are breached. Each alert is:

1. **Generated** by a worker (delivery worker, DLQ worker, or failure report scheduler)
2. **Sent** to the org's configured notification channel (email, Slack, webhook)
3. **Logged** to the `alert_center_logs` collection with full metadata

The Alert Center UI and API surface the log of sent (and failed) alerts — it is a history view, not a real-time feed.

---

## Alert Categories

| Category | Trigger | Description |
|----------|---------|-------------|
| Integration delivery failures | Configurable failure count in window | High rate of delivery failures for one or more integrations |
| Connection errors | Network-level failures | ETIMEDOUT, ECONNREFUSED, ENOTFOUND after retries |
| Transformation errors | Script execution errors | Transformation script throws or returns invalid output |
| Authentication failures | 401/403 responses | Outgoing auth credentials have expired or are invalid |
| Rate limiting | 429 responses | Target endpoint is rate-limiting the gateway |
| DLQ size threshold | DLQ entry count exceeds limit | Too many entries waiting in the dead letter queue |
| DLQ entry abandoned | Single entry hits max DLQ retries | An event has been permanently abandoned |

---

## Notification Channels

Alerts are dispatched to an external communication service. Supported channel types:

| Channel | Description |
|---------|-------------|
| `EMAIL` | Email to one or more recipients |
| `SLACK` | Slack channel message or DM |
| `WEBHOOK` | HTTP POST to a custom endpoint |

The gateway POSTs alert payloads to the configured `communicationServiceUrl` in `backend/config.json`. The notification service handles actual email/Slack delivery.

**Default communication service URL** (replace with your own):
```
https://notification.example.com/notification-service/api/sendNotification
```

Configure in `config.json`:

```json
{
  "communicationServiceUrl": "https://your-notification-service/api/send"
}
```

---

## Configuring the Failure Report

The failure report is an automated recurring alert that summarises delivery failures for the org within a configurable time window.

**Via UI:** Settings → Alert Center → Failure Report Configuration

**Via API (GET current config):**

```http
GET /api/v1/alert-center/status
```

Returns the current scheduler status and config:

```json
{
  "enabled": true,
  "intervalMinutes": 15,
  "lookbackMinutes": 60,
  "minFailures": 1,
  "maxItems": 25,
  "status": "running",
  "lastRunAt": "2026-02-24T10:00:00.000Z"
}
```

**Configuration fields:**

| Field | Default | Description |
|-------|---------|-------------|
| `enabled` | `false` | Enable or disable automatic failure reports |
| `intervalMinutes` | `15` | How often the scheduler runs (minutes) |
| `lookbackMinutes` | `60` | How far back to look for failures (minutes) |
| `minFailures` | `1` | Minimum failure count to trigger an alert |
| `maxItems` | `25` | Maximum failures included in a single report |

> **Example:** With `intervalMinutes: 15` and `lookbackMinutes: 60`, the scheduler runs every 15 minutes and reports failures from the last hour. If fewer than `minFailures` occurred, no alert is sent.

---

## Viewing Alert Logs

**Via UI:** Navigate to **Alert Center** in the sidebar.

The list shows:
- Alert type and channel
- Status badge (SENT / FAILED / PENDING / RETRY)
- Subject and recipients
- Failure count and time window
- Timestamp

Click any entry to see the full payload, provider response, and error details.

**Via API:**

```http
GET /api/v1/alert-center
```

**Query parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `status` | string | Filter by `SENT`, `FAILED`, `PENDING`, `RETRY` |
| `channel` | string | Filter by `EMAIL`, `SLACK`, `WEBHOOK` |
| `type` | string | Filter by alert category |
| `search` | string | Search across subject, error message, recipients |
| `startDate` | ISO date | Filter from this date |
| `endDate` | ISO date | Filter to this date |
| `limit` | number | Max results (default: 50) |

**Example — find failed email alerts in the past week:**

```http
GET /api/v1/alert-center?status=FAILED&channel=EMAIL&startDate=2026-02-17
```

---

## Exporting Alerts

Export the alert log for compliance, incident analysis, or external monitoring.

**JSON export:**

```http
GET /api/v1/alert-center/export/json
```

Downloads `alert-center-YYYY-MM-DD.json` with full alert metadata including error stacks.

**CSV export:**

```http
GET /api/v1/alert-center/export/csv
```

Downloads `alert-center-YYYY-MM-DD.csv` with columns:

| Column | Description |
|--------|-------------|
| Alert ID | MongoDB document ID |
| Timestamp | `createdAt` in ISO format |
| Status | Alert delivery status |
| Channel | EMAIL / SLACK / WEBHOOK |
| Type | Alert category |
| Subject | Alert title |
| Recipients | Comma-separated recipients |
| Total Failures | Count of failures in alert window |
| Window Start | Start of aggregation window |
| Window End | End of aggregation window |
| Error Message | Failure description (if failed) |
| Error Stack | Full stack trace (if failed) |

Both exports apply the same filters as the list endpoint (pass query params to filter exported data).

---

## API Endpoints

```
GET    /api/v1/alert-center                Alert log (filterable, paginated)
GET    /api/v1/alert-center/status         Failure report scheduler status + config
GET    /api/v1/alert-center/export/json    Export as JSON
GET    /api/v1/alert-center/export/csv     Export as CSV
```

---

## Troubleshooting

**No alerts appearing in Alert Center**
- Confirm `enabled: true` in the failure report config
- Check that `minFailures` threshold is not too high — if set to 100, no alert fires unless there are 100+ failures in the window
- Verify the background failure report worker is running: `GET /health` → check `failureReportWorker`

**Alerts show `FAILED` status**
- The gateway could not reach the `communicationServiceUrl`
- Verify the URL is correct and reachable from the backend server
- Check the `errorMessage` and `providerResponse` fields in the alert log detail for the specific failure reason
- Test connectivity: `curl -X POST your-communicationServiceUrl`

**Alert fired but email/Slack not received**
- Status `SENT` means the gateway delivered to your communication service — delivery to the final channel is that service's responsibility
- Check your notification service logs
- Verify recipient addresses/channel names are correct

**Too many alerts (alert fatigue)**
- Increase `minFailures` to only alert on significant failure bursts
- Increase `lookbackMinutes` and `intervalMinutes` to reduce frequency
- Use `channel: WEBHOOK` to route to a dedicated alerting platform (PagerDuty, OpsGenie) that supports deduplication
