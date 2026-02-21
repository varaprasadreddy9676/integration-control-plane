# Failure Alerts

When delivery failures occur, the gateway can notify your team automatically — via email or a Slack webhook — so you know about problems without having to watch dashboards.

---

## Alert Channels

### Email Alerts

Failure summary emails are sent via your configured SMTP server. The email lists:
- Which integrations failed
- Error codes and timestamps
- Total failure count in the reporting window

See [Email Notifications](./email-notifications) for SMTP configuration.

### Slack Webhook

A Slack webhook URL can be configured per organization. When a failure threshold is crossed, the gateway posts a message to your Slack channel with a summary of recent failures.

---

## How Failure Reports Work

1. A background scheduler runs at a configurable interval (default: every 60 minutes).
2. It scans execution logs for `FAILED` and `ABANDONED` statuses within the lookback window.
3. If failures meet the minimum threshold, alerts are sent to all configured recipients.
4. Each alert run is recorded in `alert_center_logs` for auditability.

---

## Configuration

Managed under `notifications.failureEmailReports` in the settings UI:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `false` | Enable/disable failure reporting |
| `intervalMinutes` | number | `60` | How often the report job runs |
| `lookbackMinutes` | number | `60` | Time window to scan for failures |
| `minFailures` | number | `1` | Minimum failures before alerting |
| `maxItems` | number | `25` | Maximum failures listed per alert |

**Recipients** are configured per organization. Multiple email addresses are supported.

---

## Threshold Logic

Only sends an alert when:
- `enabled` is `true`
- Count of failures in the lookback window ≥ `minFailures`

This prevents noise from isolated one-off failures if you prefer to only be alerted when multiple failures occur.

---

## Alert Log Record

Every alert run is stored in `alert_center_logs`:

| Field | Description |
|-------|-------------|
| `type` | Alert type (e.g. `DELIVERY_FAILURE_REPORT`) |
| `status` | `SUCCESS` or `FAILURE` (did the alert send successfully?) |
| `totalFailures` | Number of failures included in this alert |
| `recipients` | Array of email addresses notified |
| `message` | Alert message text |
| `errorMessage` | If the alert itself failed to send, why |
| `createdAt` | When the alert was sent |

---

## What Triggers an Alert

| Situation | Alert Sent? |
|-----------|-------------|
| Delivery failed and retries exhausted (`ABANDONED`) | Yes |
| Delivery `FAILED` status | Yes |
| Retrying (not yet exhausted) | No |
| Test event failure | No |

---

## DLQ vs Alerts

**Dead Letter Queue (DLQ)** stores the failed payload so it can be replayed or inspected. **Failure Alerts** notify your team that failures happened. Both run independently:
- DLQ entry is created immediately when a delivery is abandoned
- Alert is sent on the next report cycle if the threshold is met

You can replay items from the DLQ directly from the UI — each DLQ entry links back to its original execution trace.
