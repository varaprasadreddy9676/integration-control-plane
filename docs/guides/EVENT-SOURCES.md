# Event Sources Guide

Event sources are the origin of events that trigger outbound webhook delivery. By default, events enter the system via the REST API (`POST /api/v1/events`). Event sources let each org connect an **external data system** — MySQL, Kafka, or HTTP Push — as the trigger for their integrations.

Event sources are **optional and per-org**. Orgs that don't configure an event source use the API-based event ingestion path.

## Table of Contents

- [Event Source Types](#event-source-types)
- [MySQL Event Source](#mysql-event-source)
- [Kafka Event Source](#kafka-event-source)
- [HTTP Push Adapter](#http-push-adapter)
- [Managing Event Sources via UI](#managing-event-sources-via-ui)
- [API Endpoints](#api-endpoints)
- [Testing Connectivity](#testing-connectivity)
- [MySQL Pool Settings](#mysql-pool-settings)
- [Checkpoint Tracking](#checkpoint-tracking)
- [Troubleshooting](#troubleshooting)

---

## Event Source Types

| Type | Trigger mechanism | Use case |
|------|------------------|----------|
| `mysql` | Polls a `notification_queue` table on an interval | HIS / ERP systems with MySQL backends |
| `kafka` | Consumes messages from a topic | High-throughput event streaming |
| `http_push` | Receives HTTP POST requests to a gateway endpoint | Third-party systems that push events |

---

## MySQL Event Source

The MySQL adapter polls a `notification_queue` table in your database at a configurable interval. It uses a **checkpoint** (the last processed row ID) to ensure no event is missed or processed twice.

### Required table schema

Your MySQL database must have a table with this structure (column names configurable):

```sql
CREATE TABLE notification_queue (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  event_type    VARCHAR(100)  NOT NULL,
  entity_id     VARCHAR(100),
  entity_rid    INT,
  payload       JSON          NOT NULL,
  created_at    DATETIME      DEFAULT CURRENT_TIMESTAMP,
  processed     TINYINT(1)    DEFAULT 0
);

CREATE INDEX idx_notification_queue_id ON notification_queue (id);
```

The adapter reads rows in ascending `id` order and advances its checkpoint after each batch. The `processed` flag is **not required** — the gateway manages state via its own checkpoint, not by marking rows.

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
    "batchSize": 10,
    "dbTimeoutMs": 30000,
    "connectionLimit": 3,
    "queueLimit": 10
  }
}
```

**Server-enforced safety limits** — values outside these ranges are clamped on save:

| Setting | Min | Max | Default |
|---------|-----|-----|---------|
| `pollIntervalMs` | 1000 ms | 300000 ms (5 min) | 5000 ms |
| `batchSize` | 1 | 100 | 10 |
| `dbTimeoutMs` | 1000 ms | 120000 ms (2 min) | 30000 ms |
| `connectionLimit` (dedicated) | 1 | 5 | 3 |
| `queueLimit` (dedicated) | 0 | 50 | 10 |

**Minimal MySQL permissions** — the gateway only needs `SELECT` on `notification_queue`:

```sql
GRANT SELECT ON your_app_db.notification_queue TO 'gateway_readonly'@'%';
```

---

## Kafka Event Source

The Kafka adapter joins a **consumer group** and polls a topic. It uses manual offset commits — offsets are committed only after the gateway has successfully processed and delivered the event.

### Configuration

```json
{
  "type": "kafka",
  "brokers": ["kafka1.yourdomain.com:9092", "kafka2.yourdomain.com:9092"],
  "topic": "integration-events",
  "groupId": "integration-gateway-org-123",
  "options": {
    "fromBeginning": false,
    "sessionTimeout": 30000,
    "heartbeatInterval": 3000,
    "maxBytesPerPartition": 1048576
  }
}
```

**Important:** Use a unique `groupId` per org to ensure each org independently tracks its own offset.

### Message format

The Kafka adapter expects messages in this JSON format:

```json
{
  "eventType": "appointment.created",
  "entityId": "123",
  "entityRid": 648,
  "payload": {
    "appointmentId": "APT-001",
    "patientId": "PAT-456"
  }
}
```

Messages that cannot be parsed are skipped and logged to system logs. They are **not** retried from Kafka — offset is still advanced.

### SASL authentication

For Kafka clusters with SASL/PLAIN or SASL/SCRAM:

```json
{
  "type": "kafka",
  "brokers": ["kafka.yourdomain.com:9093"],
  "topic": "integration-events",
  "groupId": "gateway-org-123",
  "sasl": {
    "mechanism": "plain",
    "username": "gateway-user",
    "password": "..."
  },
  "ssl": true
}
```

---

## HTTP Push Adapter

The HTTP Push adapter allows external systems to **push** events directly to the gateway via HTTP POST. Instead of polling, the gateway exposes a dedicated inbound endpoint for your org.

> **Status:** The HTTP Push adapter is registered and accepted in configuration. Full polling loop integration is Phase 2. Currently, use the standard `POST /api/v1/events` endpoint for direct push-based ingestion.

---

## Managing Event Sources via UI

1. Navigate to **Settings** → **Event Sources**
2. Click **Add Event Source**
3. Select the type (MySQL, Kafka, HTTP Push)
4. Fill in the connection details
5. Click **Test Connection** to verify before saving
6. Click **Save**

Each org can have one active event source. To switch types, disable the existing source and create a new one.

---

## API Endpoints

```
GET    /api/v1/event-sources              List event sources for the org
GET    /api/v1/event-sources/:id          Get event source details + status
POST   /api/v1/event-sources              Create a new event source
PUT    /api/v1/event-sources/:id          Update event source configuration
DELETE /api/v1/event-sources/:id          Delete event source
POST   /api/v1/event-sources/test         Test connectivity without saving
```

---

## Testing Connectivity

Always test before saving. The test endpoint:
- Opens a connection to the database/broker
- For MySQL: executes `SELECT 1` and checks the `notification_queue` table exists
- For Kafka: connects to the broker and confirms the topic is accessible
- Returns success/failure with a descriptive message

```http
POST /api/v1/event-sources/test
Content-Type: application/json

{
  "type": "mysql",
  "host": "db.yourdomain.com",
  "port": 3306,
  "user": "gateway_readonly",
  "password": "...",
  "database": "your_app_db"
}
```

---

## MySQL Pool Settings

The gateway maintains a **per-org connection pool** for dedicated MySQL sources. Pool settings can be updated at runtime via the Admin UI without restarting the backend.

Navigate to **Admin** → **MySQL Pool Settings** to adjust pool limits for any org.

**Shared pool** (configured in `config.json` under `db.*`) is used when no per-org source is configured:

| Setting | Min | Max |
|---------|-----|-----|
| `connectionLimit` | 1 | 20 |
| `queueLimit` | 0 | 200 |

The shared pool is intended for development or single-tenant deployments. In production, configure dedicated per-org sources.

---

## Checkpoint Tracking

The gateway tracks its position in each event source using a **checkpoint** stored in MongoDB (`source_checkpoints` collection).

| Source | Checkpoint key |
|--------|---------------|
| MySQL | Last processed `id` from `notification_queue` |
| Kafka | Consumer group offset per partition |

**Checkpoint behavior:**
- On first run with no checkpoint, the adapter starts from the current position (not from the beginning)
- Set `fromBeginning: true` in Kafka config to consume from the earliest available offset
- If the gateway restarts, it resumes from the last committed checkpoint — no events are missed or duplicated

**Viewing checkpoints:**
```http
GET /api/v1/config/checkpoint?type=eventSource&orgId=...
```

---

## Troubleshooting

**MySQL: "Access denied" error**
- Confirm the user has `SELECT` permission on the notification queue table
- Test with `mysql -u gateway_readonly -h db.yourdomain.com -p your_app_db -e "SELECT 1"`

**MySQL: Connection pool exhausted**
- Reduce `pollIntervalMs` or `batchSize` so each cycle finishes faster
- Check for slow queries: add an index on `notification_queue(id)`
- Increase `connectionLimit` (max 5 for dedicated pools)

**Kafka: Consumer group not receiving messages**
- Verify the `groupId` is unique and not being used by another consumer
- Check that the topic exists and has messages: `kafka-topics.sh --describe --topic your-topic`
- Try setting `fromBeginning: true` temporarily to consume all available messages

**No events processing despite source being active**
- Check that the org's event source is enabled (not just saved)
- Check system logs for adapter-level errors: `GET /api/v1/system-logs?level=error`
- Verify the delivery worker is running: `GET /health`

**Events processing but integrations not triggering**
- The event's `eventType` must match an active integration's `eventType` field exactly (case-sensitive)
- Verify the integration is active and scoped correctly (`scope: ALL_ENTITIES` or matching entity RID)
