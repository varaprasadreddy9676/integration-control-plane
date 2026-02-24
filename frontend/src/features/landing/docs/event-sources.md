# Event Sources

By default, events enter the system via the REST API (`POST /api/v1/events`). Event sources let each org connect an **external data system** — MySQL or Kafka — as the trigger for their integrations, so you don't need to change your existing application to push events.

Event sources are **optional and per-org**.

---

## Source Types

| Type | Mechanism | Use case |
|------|-----------|----------|
| `mysql` | Polls a `notification_queue` table on an interval | HIS / ERP systems with MySQL backends |
| `kafka` | Consumes messages from a Kafka topic | High-throughput event streaming |
| `http_push` | Receives HTTP POST to a dedicated endpoint | Third-party systems that push events *(Phase 2)* |

---

## MySQL Event Source

The MySQL adapter polls a `notification_queue` table and advances a checkpoint after each batch — no events are missed or processed twice.

### Required table schema

```sql
CREATE TABLE notification_queue (
  id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  event_type VARCHAR(100) NOT NULL,
  entity_id  VARCHAR(100),
  payload    JSON NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_notification_queue_id ON notification_queue (id);
```

### Configuration

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

**Server-enforced limits:**

| Setting | Min | Max | Default |
|---------|-----|-----|---------|
| `pollIntervalMs` | 1000 ms | 300000 ms | 5000 ms |
| `batchSize` | 1 | 100 | 10 |
| `connectionLimit` | 1 | 5 | 3 |

The gateway only needs `SELECT` on the table:

```sql
GRANT SELECT ON your_app_db.notification_queue TO 'gateway_readonly'@'%';
```

---

## Kafka Event Source

The Kafka adapter joins a consumer group with manual offset commits — offsets are committed only after successful delivery.

### Configuration

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

Use a **unique `groupId` per org** so each org independently tracks its own offset.

### Expected message format

```json
{
  "eventType": "appointment.created",
  "entityId": "123",
  "payload": { "appointmentId": "APT-001" }
}
```

### SASL authentication

```json
{
  "sasl": { "mechanism": "plain", "username": "gateway-user", "password": "..." },
  "ssl": true
}
```

---

## Checkpoint Tracking

The gateway tracks its position in each source using a checkpoint stored in MongoDB:

| Source | Checkpoint |
|--------|-----------|
| MySQL | Last processed `id` from `notification_queue` |
| Kafka | Consumer group offset per partition |

On restart, the adapter resumes from the last checkpoint — no events are missed or duplicated. Set `fromBeginning: true` in Kafka config to replay from the earliest available offset.

---

## API Reference

```
GET    /api/v1/event-sources              List event sources
GET    /api/v1/event-sources/:id          Get source details + status
POST   /api/v1/event-sources              Create event source
PUT    /api/v1/event-sources/:id          Update configuration
DELETE /api/v1/event-sources/:id          Delete event source
POST   /api/v1/event-sources/test         Test connectivity without saving
```

Always use **Test Connection** before saving — it opens a connection, runs `SELECT 1`, and confirms the table/topic is accessible.
