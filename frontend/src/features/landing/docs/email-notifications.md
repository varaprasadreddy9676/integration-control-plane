# Email Notifications

The platform supports email delivery in two modes:

1. **Fixed sender delivery** using a directly configured SMTP mailbox
2. **Routed email delivery** using reusable sender profiles, where the sender is chosen at runtime from the request payload

Email is used for:

- integration-driven communication actions
- inbound email APIs
- scheduled reports and alerts

---

## Supported Delivery Modes

### Fixed Sender

Use a single mailbox directly in the integration config.

```json
{
  "actions": [{
    "kind": "COMMUNICATION",
    "communicationConfig": {
      "channel": "EMAIL",
      "provider": "SMTP",
      "smtp": {
        "host": "smtp.yourserver.com",
        "port": 587,
        "username": "alerts@yourcompany.com",
        "password": "secret",
        "fromEmail": "alerts@yourcompany.com"
      }
    }
  }]
}
```

### Routed Email

Use reusable sender profiles and let the request body choose the sender mailbox by `from`.

```json
{
  "actions": [{
    "kind": "COMMUNICATION",
    "communicationConfig": {
      "channel": "EMAIL",
      "provider": "ROUTED_EMAIL",
      "senderRouting": {
        "enabled": true,
        "sourceField": "from",
        "fallbackToDefaultOnMissingFrom": true,
        "fallbackToDefaultOnUnknownFrom": false
      }
    }
  }]
}
```

This is the preferred model when one org needs multiple sender mailboxes such as:

- `purchase@...`
- `pharmacy@...`
- `info@...`

---

## Sender Profiles

Sender profiles are reusable email sender definitions managed per org.

Each profile contains:

- `fromEmail`
- provider type
- provider configuration
- optional aliases
- `isDefault`
- `isActive`

Current email provider support in runtime:

- `SMTP`

The platform enforces basic safety rules:

- only one default sender profile per org
- default profile must be active
- `fromEmail` must be unique per org
- `key` must be unique per org

If `from` is missing, routed email can fall back to the default profile.
If `from` is unknown, the request can be rejected or fall back to default based on config.

---

## Inbound Email API

For unauthenticated inbound routes configured with `inboundAuthType: NONE`, the runtime endpoint is:

```http
POST /api/v1/public/integrations/:type?orgId=...
```

Example routed-email request:

```json
{
  "from": "purchase@yourcompany.com",
  "to": "recipient@example.com",
  "subject": "Test Email",
  "html": "<h1>Hello</h1>"
}
```

If the integration uses fixed SMTP instead of routed email, the `from` field is optional and does not change the configured sender.

---

## Failure Summary Reports

The platform can automatically email failure summaries to your team.

### How It Works

1. a background scheduler runs at the configured interval
2. it queries for failed and abandoned executions in the lookback window
3. if the failure count crosses the threshold, an email report is sent
4. the run is logged in the alert center

### Configuration

| Field | Default | Description |
|-------|---------|-------------|
| `enabled` | `false` | Turns failure reporting on or off |
| `intervalMinutes` | `60` | Scheduler frequency |
| `lookbackMinutes` | `60` | Failure scan window |
| `minFailures` | `1` | Minimum failures before sending |
| `maxItems` | `25` | Maximum failures included in one report |

---

## Async Processing

Inbound communication requests are processed asynchronously:

1. inbound request arrives
2. gateway accepts the request
3. a communication job is queued
4. worker processes the email send
5. result is recorded in execution logs

Retries and DLQ rules apply based on the communication path and provider outcome.

---

## Observability

Every email send attempt is traceable through:

- execution logs
- delivery log detail
- sender-profile routing metadata for routed email
- system logs for worker/runtime diagnostics

For routed email, log detail now shows:

- requested `from`
- routing decision
- resolved sender profile
- resolved provider

This makes support and RCA possible when a sender mailbox is selected dynamically.
