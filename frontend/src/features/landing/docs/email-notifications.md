# Email Notifications

The gateway includes built-in email delivery via SMTP. It is used for two purposes: sending notification emails as part of integration workflows (via COMMUNICATION actions), and sending automated failure summary reports to your team.

---

## SMTP-Based Delivery

Email is sent directly over SMTP — there are no third-party email service accounts or API keys required. Configure your SMTP server once per integration and the gateway handles the rest.

### Supported Email Providers

Any SMTP server is supported:
- Standard SMTP (port 25, 465, 587)
- Gmail via OAuth (`GMAIL_OAUTH`)
- Outlook via OAuth (`OUTLOOK_OAUTH`)

### Email as a COMMUNICATION Action

An integration can have a `kind: COMMUNICATION` action to send an email in response to an event:

```json
{
  "actions": [{
    "kind": "COMMUNICATION",
    "communicationConfig": {
      "channel": "EMAIL",
      "provider": "SMTP",
      "smtp": {
        "host": "mail.yourserver.com",
        "port": 587,
        "from": "gateway@yourcompany.com"
      }
    }
  }]
}
```

The email payload (recipient, subject, body) is built from the event payload via the transformation engine. You can use HTML templates.

---

## Failure Summary Reports

The gateway can automatically email a summary of delivery failures to your team on a schedule.

### How It Works

1. A background scheduler runs at a configurable interval (default: every 60 minutes).
2. It queries for all `FAILED` and `ABANDONED` executions in the lookback window.
3. If the number of failures meets the minimum threshold, an email is sent.
4. The report lists each failure with integration name, error code, and timestamp.
5. The run is logged to the `alert_center_logs` collection with status, recipient list, and failure count.

### Configuration

Found under `notifications.failureEmailReports` in your UI config:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `false` | Turn reporting on or off |
| `intervalMinutes` | number | `60` | How often the report job runs |
| `lookbackMinutes` | number | `60` | How far back to scan for failures |
| `minFailures` | number | `1` | Minimum failures to send a report |
| `maxItems` | number | `25` | Max failure entries in one report |

### Report Schedule State

The scheduler tracks:
- `lastRunAt` — timestamp of the most recent run
- `nextRunAt` — `lastRunAt + (intervalMinutes × 60,000ms)`
- `status` — `SUCCESS` or `FAILURE` for the last run
- `totalFailures` — count of failures included in the last report
- `recipients` — array of email addresses that received the report

---

## Async Job Processing

Email deliveries triggered via inbound integrations are queued asynchronously:

1. Inbound request arrives → gateway returns **HTTP 202 Accepted** immediately
2. Job is created in the `pending_deliveries` queue
3. A background worker polls every 5 seconds and picks up the job
4. Email is sent via the configured SMTP provider
5. Result is recorded in the execution log

**Retries:** Up to `maxRetries` (default 3) attempts on failure.

---

## Observability

Every email send attempt is recorded as an execution log entry with:
- `direction: COMMUNICATION`
- `triggerType: MANUAL` (inbound-triggered) or `SCHEDULE` (report jobs)
- `status`: `SUCCESS` or `FAILED`
- Recipient details and response from the mail server
- Full trace with `traceId` for correlation

Failure report runs are additionally recorded in `alert_center_logs` with:
- Run timestamp, status, recipient list, failure count, and any error message
