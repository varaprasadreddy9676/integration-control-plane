# Event Sources

Event sources let each org connect an external system as the trigger for integrations. They are optional, org-scoped, and monitored through the platform runtime.

By default, events can still enter via the gateway APIs. Event sources are for systems that need polling or stream consumption instead of pushing directly.

---

## Source Types

| Type | Mechanism | Use case |
|------|-----------|----------|
| `mysql` | Polls a `notification_queue` table | HIS / ERP systems backed by MySQL |
| `kafka` | Consumes messages from a Kafka topic | High-throughput event streaming |
| `http_push` | Receives HTTP POST to a dedicated inbound route | External systems that push events |

---

## MySQL Event Source

The MySQL adapter polls a queue table and advances a checkpoint after successful processing.

Typical configuration:

```json
{
  "type": "mysql",
  "host": "db.yourdomain.com",
  "port": 3306,
  "user": "gateway_readonly",
  "password": "...",
  "database": "your_app_db",
  "options": {
    "tableName": "notification_queue",
    "pollIntervalMs": 5000,
    "batchSize": 10
  }
}
```

Server-enforced limits:

| Setting | Min | Max | Default |
|---------|-----|-----|---------|
| `pollIntervalMs` | 1000 ms | 300000 ms | 5000 ms |
| `batchSize` | 1 | 100 | 10 |
| `connectionLimit` | 1 | 5 | 3 |

---

## Kafka Event Source

The Kafka adapter consumes messages and tracks its runtime state independently per org.

Typical configuration:

```json
{
  "type": "kafka",
  "brokers": ["kafka1.yourdomain.com:9092"],
  "topic": "integration-events",
  "groupId": "integration-gateway-org-123",
  "options": {
    "fromBeginning": false,
    "sessionTimeout": 30000
  }
}
```

Kafka runtime visibility now includes reconnect and backoff information in system status when the adapter is configured and running.

---

## Checkpoints and Recovery

Checkpoint tracking remains source-specific:

| Source | Checkpoint |
|--------|-----------|
| MySQL | Last processed row ID |
| Kafka | Consumer group offsets per partition |

On restart:

- MySQL resumes from the last stored row checkpoint
- Kafka resumes from committed offsets

This prevents replaying already-processed source data during normal restart paths.

---

## Runtime Health and Visibility

Event sources are now visible in **System Status**.

For each org, the platform can show:

- whether any source is configured
- configuration state:
  - `not_configured`
  - `configured`
  - `running`
  - `error`
- runtime connection state:
  - `connected`
  - `reconnecting`
  - `stale`
  - `not_applicable`
- last poll / last connect / last error details

Important:
- an unconfigured source is shown as **not configured**, not as **down**
- HTTP push is shown as **not applicable** for persistent connection health

---

## Troubleshooting

Use:

- `System Status` for adapter and worker health
- `System Logs` for MySQL poll logs, Kafka connection logs, and worker output
- delivery logs and event audit for downstream event visibility

This is the fastest way to separate:

- source ingestion problem
- event matching problem
- delivery problem

---

## API Reference

```http
GET    /api/v1/event-sources
GET    /api/v1/event-sources/:id
POST   /api/v1/event-sources
PUT    /api/v1/event-sources/:id
DELETE /api/v1/event-sources/:id
POST   /api/v1/event-sources/test
```

Always test connectivity before saving a new source configuration.
