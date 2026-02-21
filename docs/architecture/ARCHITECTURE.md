# Architecture Documentation

Complete system design and technical architecture for Integration Gateway.

## Table of Contents

- [System Overview](#system-overview)
- [System Architecture](#system-architecture)
- [Data Flow](#data-flow)
- [Worker Architecture](#worker-architecture)
- [Integration Types](#integration-types)
- [Database Schema](#database-schema)
- [Security Architecture](#security-architecture)
- [API Design](#api-design)
- [Resilience & Reliability](#resilience--reliability)
- [Scalability Considerations](#scalability-considerations)

---

## System Overview

Integration Gateway is a bi-directional integration platform that connects healthcare systems with external services through event-driven webhooks (outbound) and real-time API proxying (inbound).

### Design Principles

1. **Reliability First**: Multi-layer error handling, automatic retries, circuit breakers
2. **Multi-Tenancy**: Complete isolation between organizations with hierarchy support
3. **Observability**: Comprehensive logging, tracing, and audit trails
4. **Extensibility**: Pluggable adapters for event sources and transformation logic
5. **Developer-Friendly**: Clear APIs, self-service portal, extensive documentation

### Key Components

```
┌─────────────────────────────────────────────────────────────────┐
│                        Web Console (React)                       │
│  - Integration Management                                        │
│  - Delivery Logs & Analytics                                     │
│  - DLQ Management                                                │
│  - Admin Portal                                                  │
└────────────────────────────┬────────────────────────────────────┘
                             │ REST API (HTTPS)
┌────────────────────────────┴────────────────────────────────────┐
│                     Express.js API Server                        │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  Middleware Stack                                          │ │
│  │  • Authentication (API Key + JWT)                          │ │
│  │  • Rate Limiting (Global + Per-Tenant + Per-Integration)  │ │
│  │  • Multi-Tenant Context                                    │ │
│  │  • Request Logging & Correlation                           │ │
│  │  • Error Handling                                          │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  API Routes                                                │ │
│  │  • /auth - Authentication                                  │ │
│  │  • /outbound-integrations - Webhook configuration          │ │
│  │  • /inbound-integrations - Proxy configuration             │ │
│  │  • /integrations/:type - Runtime proxy endpoint            │ │
│  │  • /logs - Delivery logs                                   │ │
│  │  • /execution-logs - Execution traces                      │ │
│  │  • /dlq - Dead letter queue                                │ │
│  │  • /scheduled-integrations - Scheduled deliveries          │ │
│  │  • /scheduled-jobs - Scheduled batch jobs (CRUD)           │ │
│  │  • /lookups - Lookup tables                                │ │
│  │  • /admin - Admin operations                               │ │
│  │  • /dashboard - System health & analytics                  │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  Business Logic Layer                                      │ │
│  │  • Transformation Service (SIMPLE + SCRIPT modes)          │ │
│  │  • Lookup Resolution Service                               │ │
│  │  • Authentication Builder (OAuth2, API Key, etc.)          │ │
│  │  • Scheduling Service (DELAYED + RECURRING)                │ │
│  │  • Webhook Signing Service (HMAC-SHA256)                   │ │
│  │  • Validation Service                                      │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  Background Workers (Async Processing)                     │ │
│  │  • Delivery Worker - Polls events, delivers webhooks       │ │
│  │  • Scheduler Worker - Executes scheduled deliveries        │ │
│  │  • DLQ Worker - Auto-retries failed deliveries             │ │
│  │  • Scheduled Job Worker - Runs scheduled jobs              │ │
│  │  • Alert Worker - Sends failure notifications              │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  Data Access Layer                                         │ │
│  │  • MongoDB Abstraction (28+ collections)                   │ │
│  │  • MySQL Pool Management (read-only event source)          │ │
│  │  • Connection Resilience (auto-reconnect, pool recreation) │ │
│  │  • Query Optimization                                      │ │
│  └────────────────────────────────────────────────────────────┘ │
└───────────────┬────────────────────┬──────────────┬─────────────┘
                │                    │              │
    ┌───────────┴──────────┐  ┌──────┴─────┐  ┌───┴──────────┐
    │  MongoDB (Primary)    │  │   MySQL    │  │ External APIs │
    │  • Integrations       │  │  • Events  │  │ (HTTP/HTTPS)  │
    │  • Logs & DLQ         │  │  • Entities│  └───────────────┘
    │  • Organizations      │  └────────────┘
    │  • Rate Limits        │
    │  • Users & Auth       │
    └───────────────────────┘
```

---

## System Architecture

### Component Layers

#### 1. Presentation Layer (Frontend)

**Technology**: React 18.2 + TypeScript + Ant Design

**Key Features**:
- Single-page application (SPA) with React Router
- Server state management with React Query (TanStack)
- Real-time updates (polling-based, 30s intervals)
- Responsive design with mobile support
- Dark mode support
- Role-based UI rendering

**Feature Modules**:
- **Integrations**: CRUD operations for outbound/inbound integrations
- **Logs**: Delivery log viewer with advanced filtering
- **DLQ**: Failed delivery management and retry operations
- **Scheduled**: View and manage scheduled deliveries
- **Lookups**: Lookup table management with import/export
- **Dashboard**: System health, KPIs, and analytics charts
- **Admin**: Organization and user management
- **Settings**: UI configuration and preferences

#### 2. API Layer (Backend)

**Technology**: Express.js 4.21 + Node.js 18+

**Middleware Stack** (order matters):
```javascript
1. Request ID Generator (correlation tracking)
2. CORS Handler (origin validation)
3. Body Parser (JSON, 10MB limit)
4. Authentication (API Key or JWT Bearer)
5. Rate Limiter (global, per-tenant, per-integration)
6. Multi-Tenant Context (orgId extraction and validation)
7. Request Logger (structured logging)
8. Route Handlers
9. Error Handler (centralized error response)
```

**API Routes** (`/api/v1`):
- `/auth` - User authentication (login, logout, me)
- `/outbound-integrations` - Outbound webhook CRUD
- `/inbound-integrations` - Inbound proxy CRUD
- `/scheduled-jobs` - Scheduled batch jobs CRUD, execution, logs, test datasource
- `/integrations/:type` - Runtime proxy execution (POST only)
- `/logs` - Delivery logs (list, detail, export)
- `/execution-logs` - Step-by-step execution traces
- `/dlq` - Dead letter queue management
- `/scheduled-integrations` - Scheduled delivery viewer (OUTBOUND only)
- `/lookups` - Lookup table CRUD
- `/dashboard` - System health and statistics
- `/analytics` - Delivery analytics and trends
- `/admin` - Admin operations (users, orgs, audit logs, rate limits)
- `/tenant` - Tenant information
- `/templates` - Integration templates
- `/field-schemas` - Event field definitions
- `/health` - Health check endpoint

#### 3. Business Logic Layer

**Services** (`backend/src/services/`):

**Transformation Service** (`transformation/`)
- Field mapping with nested object support (dot notation)
- Lookup resolution inline
- Custom JavaScript execution (VM2 sandboxed)
- Built-in transformers: `trim`, `upper`, `lower`, `date`, `default`, `lookup`
- Depth-aware to prevent circular references

**Lookup Service** (`lookup/`)
- In-memory cache for frequently used lookups
- Fallback to MongoDB on cache miss
- Support for multiple lookup types
- Import/export to Excel/CSV

**Authentication Builder** (`auth/`)
- Generates authentication headers for outbound requests
- Supported types: NONE, API_KEY, BEARER, BASIC, OAUTH2, CUSTOM_HEADERS
- OAuth2 client credentials flow with token caching
- HMAC-SHA256 webhook signing

**Scheduling Service** (`scheduling/`)
- DELAYED: One-time scheduled delivery
- RECURRING: Cron-like recurring schedules
- Timezone-aware execution
- Next occurrence calculation for recurring jobs

**Validation Service** (`validation/`)
- Request body validation (JSON Schema)
- URL validation (whitelist/blacklist)
- Private network blocking
- Payload size limits

**Notification Service** (`notifications/`)
- Failure report emails
- Alert center notifications
- Configurable thresholds

**Data Source Executor Service** (`data-source-executor.js`)
- Executes SQL queries against internal MySQL database
- Executes MongoDB aggregations (internal OR external databases)
- Calls internal APIs for data fetching
- Variable substitution support ({{config.*}}, {{date.*}}, {{env.*}})
- Connection management for external MongoDB (auto-connect, auto-close)
- Timeout protection (5s server selection, 30s socket timeout)
- Used by SCHEDULED integrations for batch data fetching

#### 4. Worker Layer

**Delivery Worker** (`processor/worker.js`)

**Purpose**: Poll MySQL event source and deliver outbound webhooks

**Flow**:
```
1. Poll notification_queue (MySQL) every 5 seconds
2. Read events from checkpoint (last processed ID)
3. Filter by: maxEventAgeDays, allowedParentRids
4. Deduplicate (5-minute window using in-memory cache)
5. Match active outbound integrations (respecting entity hierarchy)
6. For each matched integration:
   a. Apply transformation (SIMPLE or SCRIPT mode)
   b. Build authentication headers
   c. Send HTTP request with timeout (30s default)
   d. Record delivery log
   e. Handle retry logic (exponential backoff)
   f. Auto-disable on consecutive failures (circuit breaker)
7. Update checkpoint (last processed ID)
8. Repeat
```

**Key Features**:
- Exactly-once processing (checkpoint-based)
- Batch processing (5 events per cycle)
- Multi-action support (sequential delivery with configurable delay)
- Circuit breaker (auto-disable after N consecutive failures)
- Graceful shutdown

**Scheduler Worker** (`processor/scheduler-worker.js`)

**Purpose**: Execute scheduled outbound deliveries

**Flow**:
```
1. Poll scheduled_integrations collection every 60 seconds
2. Find deliveries where scheduledFor <= now AND status = PENDING
3. For each scheduled delivery:
   a. Apply transformation
   b. Send HTTP request
   c. Record delivery log
   d. Handle retry logic
   e. For RECURRING: Create next occurrence
4. Mark as COMPLETED or FAILED
5. Repeat
```

**Scheduled Job Worker** (`processor/scheduled-job-worker.js`)

**Purpose**: Execute time-driven batch data fetching and delivery jobs

**Flow**:
```
1. Poll integration_configs collection every 60 seconds
2. Find CRON jobs ready to run (nextRun <= now, isActive = true)
3. Find INTERVAL jobs ready to run (lastRun + intervalMs <= now)
4. For each job:
   a. Execute data source (SQL, MongoDB, or API)
      - Apply variable substitution
      - Fetch data with timeout protection
      - Log data fetched (limited to 50KB)
   b. Transform fetched data (JavaScript VM2 sandbox)
      - Input: { data: <fetched data>, metadata: <job metadata> }
      - Log transformed payload
   c. Build authentication headers
   d. Send HTTP request to target URL
      - Generate curl command for debugging
      - Capture response headers and body
   e. Log execution details
      - Data fetched, transformed payload, HTTP request/response
      - Error context if failed
   f. Schedule next execution (CRON only)
      - Calculate next cron occurrence in timezone
      - Update integration config with nextRun
5. Repeat
```

**Key Features**:
- Multiple data sources (SQL, MongoDB, API)
- External MongoDB support with connection management
- Variable substitution in queries/pipelines
- Comprehensive execution logging
- Timezone-aware scheduling for CRON

**DLQ Worker** (`processor/dlq-worker.js`)

**Purpose**: Auto-retry failed deliveries from dead letter queue

**Flow**:
```
1. Poll dlq collection every 60 seconds
2. Find failed deliveries ready for retry (exponential backoff)
3. Limit to 50 retries per cycle
4. For each DLQ entry:
   a. Fetch original integration config
   b. Apply transformation
   c. Send HTTP request
   d. Update DLQ entry (retry count, next retry time)
   e. Move to delivery_logs on success
   f. Mark as ABANDONED after max retries
5. Repeat
```

**Retry Strategy**:
- Base delay: 1000ms
- Exponential backoff: `min(base * 2^attempt, 5000ms)`
- Max retries: 3 (configurable)
- Jitter: Random delay ±20% to prevent thundering herd

#### 5. Data Layer

**MongoDB Collections** (Primary Database - `integration_gateway`)

**Configuration Collections**:
- `integration_configs` - Outbound and inbound integration definitions
- `lookups` - Lookup tables for field value resolution
- `event_types` - Event schema definitions (25+ types)
- `ui_config` - Tenant-specific UI configuration
- `organizations` - Organization definitions (parent level)
- `org_units` - Organization units (child entities)
- `users` - User accounts for authentication

**Runtime Collections**:
- `delivery_logs` - Complete delivery attempt history
- `execution_logs` - Step-by-step execution traces (DLQ viewer)
- `scheduled_integrations` - Pending scheduled deliveries
- `dlq` (alias: `failed_deliveries`) - Dead letter queue
- `rate_limits` - Per-tenant rate limiting state
- `processed_events` - Event deduplication cache

**Audit Collections**:
- `event_audit` - Complete event audit trail
- `admin_audit` - Admin action audit logs
- `alert_center_logs` - Alert and notification logs
- `scheduled_job_logs` - SCHEDULED integration execution history (full trace)

**Worker State Collections**:
- `worker_checkpoint` - Delivery worker checkpoint (last processed event ID)
- `scheduler_checkpoint` - Scheduler worker state

**Other Collections**:
- `version_history` - Integration config version history
- `templates` - Pre-built integration templates
- `ai_interactions` - AI assistant conversation logs

**MySQL Tables** (Read-Only Event Source)
- `notification_queue` - Source event queue from primary system
- `u_entity` - Entity hierarchy data

**Indexes** (Performance-Critical)
```javascript
// integration_configs
{ tenantId: 1, direction: 1, isActive: 1 }
{ tenantId: 1, eventType: 1, isActive: 1 }
{ 'rateLimits.enabled': 1 }

// delivery_logs
{ orgId: 1, createdAt: -1 }
{ status: 1, orgId: 1, createdAt: -1 }
{ integrationConfigId: 1, createdAt: -1 }
{ correlationId: 1 }
{ traceId: 1 }

// dlq
{ status: 1, nextRetryAt: 1 }
{ orgId: 1, status: 1 }

// scheduled_integrations
{ scheduledFor: 1, status: 1 }
{ orgId: 1, status: 1 }

// rate_limits
{ integrationConfigId: 1, tenantId: 1 }
{ resetAt: 1 }

// organizations
{ orgId: 1 } (unique)

// org_units
{ orgId: 1, rid: 1 }
{ rid: 1 } (unique)

// users
{ email: 1 } (unique)
{ orgId: 1, role: 1 }
```

---

## Data Flow

### Outbound (Event-Driven Webhook Delivery)

```
┌─────────────────────────────────────────────────────────────────┐
│                        Event Source (MySQL)                      │
│  INSERT INTO notification_queue (event_type, payload, ...)      │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Delivery Worker (5s poll)                   │
│  1. Read from checkpoint (last_id)                               │
│  2. Filter by maxEventAgeDays, allowedParentRids                 │
│  3. Deduplicate (5-min window)                                   │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Match Active Integrations                      │
│  - Query: { tenantId: event.entityRid, eventType, isActive }    │
│  - Include parent-level integrations (with exclusions)           │
│  - Filter by direction: OUTBOUND                                 │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Transformation                              │
│  • SIMPLE: Field mapping + lookups + static fields               │
│  • SCRIPT: Custom JavaScript (VM2 sandboxed)                     │
│  Input: event.payload                                            │
│  Output: transformed payload                                     │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Build Authentication                          │
│  Based on outgoingAuthType:                                      │
│  • API_KEY → Custom header                                       │
│  • BEARER → Authorization: Bearer <token>                        │
│  • BASIC → Authorization: Basic <base64>                         │
│  • OAUTH2 → Fetch token, then Bearer                             │
│  • CUSTOM_HEADERS → Multiple custom headers                      │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                      HTTP Delivery                               │
│  axios.request({                                                 │
│    method: integration.httpMethod,                               │
│    url: integration.targetUrl,                                   │
│    data: transformedPayload,                                     │
│    headers: authHeaders + correlationId,                         │
│    timeout: 30000                                                │
│  })                                                              │
└───────────────────────────┬─────────────────────────────────────┘
                            │
            ┌───────────────┴────────────────┐
            │                                │
            ▼ (Success)                      ▼ (Failure)
┌────────────────────────┐      ┌───────────────────────────────┐
│  Record Success Log    │      │  Record Failure Log           │
│  • Status: SUCCESS     │      │  • Status: FAILED             │
│  • Response: {...}     │      │  • Error: {...}               │
│  • Response Time       │      │  • Retry Count                │
└────────────────────────┘      └───────────┬───────────────────┘
                                            │
                                            ▼
                                ┌───────────────────────────────┐
                                │  Create DLQ Entry             │
                                │  • For auto-retry             │
                                │  • Exponential backoff        │
                                │  • Max 3 retries              │
                                └───────────────────────────────┘
```

### Inbound (Real-Time API Proxy)

```
┌─────────────────────────────────────────────────────────────────┐
│                    Client Application                            │
│  POST /api/v1/integrations/appointment-booking?orgId=648        │
│  Headers: { X-API-Key: "..." }                                  │
│  Body: { patientId: "123", ... }                                │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Authenticate Request                           │
│  • Validate X-API-Key or Bearer token                            │
│  • Extract orgId from query parameter                            │
│  • Verify user has access to orgId                               │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                Fetch Inbound Integration Config                  │
│  Query: { type: "appointment-booking", tenantId: 648,           │
│           direction: "INBOUND", isActive: true }                 │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                Validate Inbound Authentication                   │
│  If inboundAuthType configured:                                  │
│  • Verify client provided correct credentials                    │
│  • Otherwise: Reject with 401                                    │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                Transform Request Payload                         │
│  Apply requestTransformation:                                    │
│  • SIMPLE: Field mapping + lookups                               │
│  • SCRIPT: Custom JavaScript                                     │
│  Input: req.body                                                 │
│  Output: transformedRequest                                      │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Build Outbound Auth Headers                    │
│  Based on outgoingAuthType (same as outbound)                    │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Proxy to External API                        │
│  axios.request({                                                 │
│    method: integration.httpMethod,                               │
│    url: integration.targetUrl,                                   │
│    data: transformedRequest,                                     │
│    headers: authHeaders,                                         │
│    timeout: 30000,                                               │
│    responseType: 'stream' // Support streaming                   │
│  })                                                              │
└───────────────────────────┬─────────────────────────────────────┘
                            │
            ┌───────────────┴────────────────┐
            │                                │
            ▼ (Success)                      ▼ (Failure)
┌────────────────────────┐      ┌───────────────────────────────┐
│  Transform Response    │      │  Handle Error                 │
│  Apply response        │      │  • Retry with exponential    │
│  Transformation:       │      │    backoff (max 3)            │
│  • SIMPLE or SCRIPT    │      │  • Create DLQ entry           │
│  • Return to client    │      │  • Return 502/504 to client   │
└────────────┬───────────┘      └───────────────────────────────┘
             │
             ▼
┌────────────────────────┐
│  Return to Client      │
│  Status: 200           │
│  Body: transformed     │
└────────────────────────┘
```

---

## Worker Architecture

### Delivery Worker Design

**Process Model**: Single-threaded event loop (Node.js)

**Polling Strategy**:
- Timer-based polling (setInterval)
- Interval: 5 seconds (configurable)
- Checkpoint-based cursor (last processed ID)
- Batch size: 5 events per cycle (configurable)

**Exactly-Once Processing**:
```javascript
// Pseudo-code
while (true) {
  const checkpoint = await getWorkerCheckpoint();
  const events = await db.query(`
    SELECT * FROM notification_queue
    WHERE id > ${checkpoint}
    ORDER BY id ASC
    LIMIT ${batchSize}
  `);

  for (const event of events) {
    try {
      await processEvent(event);
      await updateCheckpoint(event.id);
    } catch (error) {
      logError(error);
      // Don't update checkpoint - will retry next cycle
    }
  }

  await sleep(intervalMs);
}
```

**Deduplication**:
- In-memory LRU cache (5-minute window)
- Key: `${eventType}:${payloadId}:${tenantId}`
- Prevents duplicate deliveries if event appears multiple times

**Error Handling**:
- Catch all errors per event
- Log error details
- Continue processing next event
- Worker never crashes on single event failure

**Graceful Shutdown**:
```javascript
process.on('SIGINT', async () => {
  console.log('Shutting down worker...');
  isShuttingDown = true;
  // Wait for current cycle to finish
  await currentCycle;
  process.exit(0);
});
```

### Scheduler Worker Design

**Purpose**: Execute scheduled outbound deliveries (DELAYED + RECURRING)

**Polling Strategy**:
- Timer-based (60 seconds)
- Query: `{ scheduledFor: { $lte: now }, status: 'PENDING' }`
- Batch size: 10 per cycle

**Recurring Jobs**:
```javascript
// After successful delivery of RECURRING integration
if (integration.schedulingMode === 'RECURRING') {
  const nextOccurrence = calculateNext(integration.recurringConfig);
  await createScheduledIntegration({
    ...integration,
    scheduledFor: nextOccurrence,
    status: 'PENDING'
  });
}
```

**Timezone Handling**:
- Store scheduledFor in UTC
- Calculate next occurrence in tenant's timezone
- Convert back to UTC for storage

### DLQ Worker Design

**Purpose**: Auto-retry failed deliveries

**Retry Strategy**:
```javascript
const nextRetryDelay = Math.min(
  baseDelay * Math.pow(2, attemptCount),
  maxDelay
);
const jitter = nextRetryDelay * 0.2 * Math.random();
const nextRetryAt = now + nextRetryDelay + jitter;
```

**Batch Processing**:
- Limit: 50 retries per cycle
- Prevents overwhelming external APIs
- Prioritizes oldest failures first

**Abandonment**:
- After 3 retries, mark as ABANDONED
- Keep in DLQ for manual investigation
- Send alert notification to admin

---

## Integration Types

The system supports three distinct integration patterns:
1. **OUTBOUND**: Event-driven webhook delivery (push events to external systems)
2. **INBOUND**: Real-time API proxy (client calls through gateway to external API)
3. **SCHEDULED**: Time-driven batch data fetching and delivery (pull data on schedule)

### OUTBOUND (Event-Driven Webhooks)

**Purpose**: Push events from internal system to external APIs

**Characteristics**:
- **Async**: Fire-and-forget with retry logic
- **Triggered by**: MySQL notification_queue events
- **Delivery**: Worker polls and delivers
- **Scheduling**: IMMEDIATE, DELAYED, or RECURRING

**Configuration Schema**:
```typescript
{
  direction: 'OUTBOUND',
  name: string,
  eventType: string,  // e.g., 'appointment-created'
  tenantId: number,
  isActive: boolean,
  targetUrl: string,
  httpMethod: 'POST' | 'PUT' | 'PATCH',

  // Transformation
  transformationMode: 'SIMPLE' | 'SCRIPT',
  fieldMappings: FieldMapping[],  // For SIMPLE mode
  transformScript: string,        // For SCRIPT mode

  // Authentication
  outgoingAuthType: 'NONE' | 'API_KEY' | 'BEARER' | 'BASIC' | 'OAUTH2' | 'CUSTOM_HEADERS',
  outgoingAuthConfig: {...},

  // Scheduling (optional)
  schedulingMode: 'IMMEDIATE' | 'DELAYED' | 'RECURRING',
  schedulingConfig: {...},

  // Multi-action (optional)
  actions: Action[],

  // Rate limiting
  rateLimits: {
    enabled: boolean,
    maxRequests: number,
    windowSeconds: number
  },

  // Entity hierarchy
  scope: 'ALL_ENTITIES' | 'ENTITY_ONLY',
  excludedEntityRids: number[]
}
```

**Delivery Guarantees**:
- At-least-once (with deduplication)
- Ordered within same event type per tenant
- No ordering across event types

### INBOUND (Real-Time API Proxy)

**Purpose**: Proxy real-time API calls from client to external APIs

**Characteristics**:
- **Sync**: Request/response pattern
- **Triggered by**: Client HTTP request to `/api/v1/integrations/:type`
- **Delivery**: Synchronous proxy
- **Timeout**: 30 seconds default

**Configuration Schema**:
```typescript
{
  direction: 'INBOUND',
  type: string,  // URL param, e.g., 'appointment-booking'
  name: string,
  tenantId: number,
  isActive: boolean,
  targetUrl: string,
  httpMethod: 'POST' | 'PUT' | 'GET' | 'PATCH' | 'DELETE',

  // Inbound authentication (from client)
  inboundAuthType: 'NONE' | 'API_KEY' | 'BEARER' | 'BASIC',
  inboundAuthConfig: {...},

  // Outbound authentication (to external API)
  outgoingAuthType: 'NONE' | 'API_KEY' | 'BEARER' | 'BASIC' | 'OAUTH2' | 'CUSTOM_HEADERS',
  outgoingAuthConfig: {...},

  // Request transformation (client → API)
  requestTransformationMode: 'SIMPLE' | 'SCRIPT',
  requestFieldMappings: FieldMapping[],
  requestTransformScript: string,

  // Response transformation (API → client)
  responseTransformationMode: 'SIMPLE' | 'SCRIPT',
  responseFieldMappings: FieldMapping[],
  responseTransformScript: string,

  // Rate limiting
  rateLimits: {
    enabled: boolean,
    maxRequests: number,
    windowSeconds: number
  }
}
```

**Error Handling**:
- Retry on 5xx errors (max 3 attempts)
- Exponential backoff
- DLQ creation on final failure
- Return 502/504 to client

---

### SCHEDULED (Time-Driven Batch Data Fetching)

**Purpose**: Fetch data from external sources on a schedule and deliver to external APIs

**Characteristics**:
- **Pull-based**: Actively fetches data from SQL/MongoDB/APIs
- **Triggered by**: Time (cron expression or fixed interval)
- **Delivery**: Worker executes on schedule
- **Timeout**: 30 seconds default for data fetch + delivery

**Configuration Schema**:
```typescript
{
  direction: 'SCHEDULED',
  name: string,
  type: string,  // Categorization (e.g., 'DAILY_EXPORT')
  tenantId: number,
  isActive: boolean,
  targetUrl: string,
  httpMethod: 'POST' | 'PUT',

  // Schedule configuration
  schedule: {
    type: 'CRON' | 'INTERVAL',
    expression?: string,  // Cron expression (e.g., '0 9 * * *')
    timezone?: string,    // Timezone for cron (e.g., 'Asia/Kolkata')
    intervalMs?: number   // Fixed interval in ms (e.g., 3600000)
  },

  // Data source configuration
  dataSource: {
    type: 'SQL' | 'MONGODB' | 'API',

    // SQL (queries internal HIS MySQL database)
    query?: string,

    // MongoDB (internal OR external)
    connectionString?: string,  // Optional - omit for internal MongoDB
    database?: string,
    collection?: string,
    pipeline?: any[],  // Aggregation pipeline

    // API (internal API endpoints)
    url?: string,
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH',
    headers?: Record<string, string>,
    body?: any
  },

  // Transformation (JavaScript only)
  transformation: {
    mode: 'SCRIPT',
    script: string  // JavaScript code executed in VM2 sandbox
  },

  // Outbound authentication (to target API)
  outgoingAuthType: 'NONE' | 'API_KEY' | 'BEARER' | 'BASIC' | 'OAUTH2' | 'CUSTOM_HEADERS',
  outgoingAuthConfig: {...}
}
```

**Variable Substitution**:
Supports dynamic variables in queries, pipelines, URLs:
- `{{config.tenantId}}` - Current tenant ID
- `{{config.integrationId}}` - Integration ID
- `{{date.today()}}` - Today's date (YYYY-MM-DD)
- `{{date.yesterday()}}` - Yesterday's date
- `{{date.todayStart()}}` - Today at 00:00:00 (ISO)
- `{{date.todayEnd()}}` - Today at 23:59:59 (ISO)
- `{{date.now()}}` - Current timestamp (ISO)
- `{{env.VAR_NAME}}` - Environment variable

**Execution Flow**:
```
Scheduled Job Worker (60s poll)
       ↓
Find jobs ready to run (CRON: nextRun <= now, INTERVAL: lastRun + intervalMs <= now)
       ↓
Execute data source (SQL query / MongoDB aggregation / API call)
       ↓
Apply variable substitution
       ↓
Transform fetched data (JavaScript sandbox)
       ↓
Build authentication headers
       ↓
HTTP POST/PUT to target URL
       ↓
Log execution details (data fetched, transformed, HTTP request/response)
       ↓
Schedule next execution (for CRON)
```

**Data Sources**:

1. **SQL** - Query internal MySQL HIS database
   ```sql
   SELECT * FROM bills
   WHERE entity_rid = {{config.tenantId}}
     AND DATE(created_at) = {{date.today()}}
   ```

2. **MongoDB** - Query internal OR external MongoDB
   ```javascript
   // Internal MongoDB
   { collection: 'delivery_logs', pipeline: [...] }

   // External MongoDB
   {
     connectionString: 'mongodb://user:pass@host:27017',
     database: 'external_db',
     collection: 'appointments',
     pipeline: [...]
   }
   ```

3. **API** - Call internal API endpoints
   ```javascript
   {
     url: 'http://localhost:4000/api/v1/analytics/summary',
     method: 'GET',
     headers: { 'X-API-Key': '{{env.API_KEY}}' }
   }
   ```

**Testing & Validation**:
- **Test Data Source** endpoint: `POST /scheduled-jobs/test-datasource`
- Validates configuration and returns sample data (max 10 records)
- JSON validation for MongoDB pipeline and API payloads
- Connection testing for external databases

**Execution Logging**:
- Collection: `scheduled_job_logs`
- Captures: data fetched, transformed payload, HTTP request/response
- Includes curl command for debugging
- Error context shows which stage failed (DATA_FETCH, TRANSFORMATION, DELIVERY)

**Use Cases**:
- Daily reports export (bills, appointments, patient data)
- Periodic data sync to external systems
- Scheduled aggregations and analytics delivery
- Time-triggered batch operations

**See Also**: [SCHEDULED_JOBS.md](./SCHEDULED_JOBS.md) for complete documentation

---

## Database Schema

### Key Collections

**integration_configs**
```javascript
{
  _id: ObjectId,
  direction: 'OUTBOUND' | 'INBOUND',
  type: string,  // For INBOUND only
  name: string,
  eventType: string,  // For OUTBOUND only
  tenantId: number,
  isActive: boolean,
  targetUrl: string,
  httpMethod: string,
  transformationMode: 'SIMPLE' | 'SCRIPT',
  fieldMappings: [...],
  transformScript: string,
  inboundAuthType: string,
  inboundAuthConfig: {...},
  outgoingAuthType: string,
  outgoingAuthConfig: {...},
  requestTransformationMode: string,  // INBOUND only
  responseTransformationMode: string,  // INBOUND only
  schedulingMode: 'IMMEDIATE' | 'DELAYED' | 'RECURRING',
  schedulingConfig: {...},
  actions: [...],
  rateLimits: {...},
  scope: 'ALL_ENTITIES' | 'ENTITY_ONLY',
  excludedEntityRids: [...],
  createdAt: ISODate,
  updatedAt: ISODate
}
```

**delivery_logs**
```javascript
{
  _id: ObjectId,
  integrationConfigId: ObjectId,
  integrationName: string,
  orgId: number,
  eventId: string,
  eventType: string,
  direction: 'OUTBOUND' | 'INBOUND',
  status: 'SUCCESS' | 'FAILED' | 'RETRYING' | 'ABANDONED',
  targetUrl: string,
  httpMethod: string,
  responseStatus: number,
  responseTimeMs: number,
  attemptCount: number,
  errorMessage: string,
  errorCategory: string,
  originalPayload: {...},
  requestPayload: {...},
  responseBody: {...},
  requestHeaders: {...},
  correlationId: string,
  traceId: string,
  messageId: string,
  signature: string,
  triggerType: 'EVENT' | 'MANUAL' | 'SCHEDULED',
  actionName: string,
  actionIndex: number,
  shouldRetry: boolean,
  createdAt: ISODate,
  deliveredAt: ISODate
}
```

**execution_logs**
```javascript
{
  _id: ObjectId,
  traceId: string,  // Links to delivery_logs
  orgId: number,
  integrationConfigId: ObjectId,
  integrationName: string,
  eventType: string,
  status: 'SUCCESS' | 'FAILED' | 'PENDING' | 'SKIPPED',
  errorCategory: string,
  errorMessage: string,
  responseStatus: number,
  targetUrl: string,
  httpMethod: string,
  requestPayload: {...},
  responseBody: {...},
  createdAt: ISODate,
  deliveredAt: ISODate
}
```

**dlq (failed_deliveries)**
```javascript
{
  _id: ObjectId,
  integrationConfigId: ObjectId,
  integrationName: string,
  orgId: number,
  eventId: string,
  eventType: string,
  direction: 'OUTBOUND' | 'INBOUND',
  status: 'PENDING_RETRY' | 'RETRYING' | 'ABANDONED',
  originalPayload: {...},
  targetUrl: string,
  httpMethod: string,
  lastError: string,
  attemptCount: number,
  maxRetries: number,
  nextRetryAt: ISODate,
  createdAt: ISODate,
  updatedAt: ISODate
}
```

**scheduled_integrations**
```javascript
{
  _id: ObjectId,
  integrationConfigId: ObjectId,
  integrationName: string,
  tenantId: number,
  orgId: number,
  originalEventId: string,
  eventType: string,
  scheduledFor: ISODate,
  status: 'PENDING' | 'COMPLETED' | 'FAILED' | 'CANCELLED',
  payload: {...},
  targetUrl: string,
  httpMethod: string,
  cancellationInfo: {...},
  recurringConfig: {...},
  createdAt: ISODate,
  updatedAt: ISODate
}
```

**scheduled_job_logs**
```javascript
{
  _id: ObjectId,
  integrationId: ObjectId,  // References integration_configs
  tenantId: number,
  status: 'SUCCESS' | 'FAILED' | 'RUNNING',

  // Timing
  startedAt: ISODate,
  completedAt: ISODate,
  durationMs: number,

  // Data fetching stage
  dataFetchStage: 'SUCCESS' | 'FAILED',
  recordsFetched: number,
  dataFetched: any,  // Actual data from source (limited to 50KB)

  // Transformation stage
  transformationStage: 'SUCCESS' | 'FAILED',
  transformedPayload: any,  // After JavaScript transformation

  // Delivery stage
  deliveryStage: 'SUCCESS' | 'FAILED',
  httpRequest: {
    method: string,
    url: string,
    headers: {...},
    body: any
  },
  curlCommand: string,  // Generated curl for debugging
  responseStatus: number,
  responseHeaders: {...},
  responseBody: any,

  // Error tracking
  errorContext: {
    stage: 'DATA_FETCH' | 'TRANSFORMATION' | 'DELIVERY',
    error: string,
    stack: string
  },

  createdAt: ISODate
}
```

**organizations**
```javascript
{
  _id: ObjectId,
  orgId: number,  // Unique numeric identifier
  name: string,
  code: string,
  email: string,
  phone: string,
  address: string,
  tags: [...],
  region: string,
  timezone: string,
  createdAt: ISODate,
  updatedAt: ISODate
}
```

**org_units**
```javascript
{
  _id: ObjectId,
  orgId: number,  // Parent organization
  rid: number,  // Unique numeric identifier
  name: string,
  code: string,
  email: string,
  phone: string,
  address: string,
  tags: [...],
  region: string,
  timezone: string,
  createdAt: ISODate,
  updatedAt: ISODate
}
```

**users**
```javascript
{
  _id: ObjectId,
  email: string,
  passwordHash: string,
  role: 'ADMIN' | 'USER' | 'API_KEY',
  orgId: number,  // null for ADMIN
  isActive: boolean,
  lastLoginAt: ISODate,
  createdAt: ISODate,
  updatedAt: ISODate
}
```

---

## Security Architecture

### Authentication

**API Key Authentication**:
- Simple key-based auth for external clients
- Header: `X-API-Key: your-api-key`
- Configured in `backend/config.json`
- No expiration
- Use for service-to-service communication

**JWT Authentication**:
- Token-based auth for web UI users
- Header: `Authorization: Bearer <jwt-token>`
- Expiration: 7 days (configurable)
- Refresh on activity
- Signed with `jwtSecret` from config

**Multi-Tenant Context**:
- All requests require `orgId` query parameter
- Validates user has access to orgId
- Filters all queries by orgId
- Prevents cross-tenant data access

### Authorization

**Role-Based Access Control (RBAC)**:
- **ADMIN**: Full access to all orgs and admin features
- **USER**: Access to assigned orgId only
- **API_KEY**: Limited to API operations

**Middleware Enforcement**:
```javascript
// Example route protection
router.get('/admin/*', requireRole('ADMIN'));
router.get('/integrations', requireAuth(), checkOrgAccess());
```

### Rate Limiting

**Global Rate Limit**:
- 1000 requests per minute per IP
- Applied before authentication
- Prevents brute force attacks

**Per-Tenant Rate Limit**:
- 100 requests per minute per orgId
- Applied after authentication
- Prevents abuse by single tenant

**Per-Integration Rate Limit**:
- Configurable per integration
- Sliding window implementation
- Returns 429 with Retry-After header
- Auto-creates DLQ entry for rate-limited requests

### Network Security

**Private Network Blocking**:
- Blocks requests to 127.0.0.1, 192.168.x.x, 10.x.x.x, 172.16-31.x.x
- Prevents SSRF attacks
- Configurable: `security.blockPrivateNetworks`

**HTTPS Enforcement**:
- Reject non-HTTPS requests in production
- Configurable: `security.enforceHttps`

**CORS**:
- Whitelist allowed origins
- Credentials support
- Configurable: `security.cors`

---

## API Design

### RESTful Principles

- Resource-based URLs
- HTTP verbs map to CRUD (GET, POST, PUT, DELETE, PATCH)
- JSON request/response
- Consistent error format
- Pagination for list endpoints
- Filtering via query parameters

### Request/Response Format

**Request**:
```http
GET /api/v1/outbound-integrations?orgId=648&page=1&limit=50
X-API-Key: your-api-key
```

**Response (Success)**:
```json
{
  "integrations": [...],
  "total": 150,
  "page": 1,
  "limit": 50
}
```

**Response (Error)**:
```json
{
  "error": "Integration not found",
  "code": "NOT_FOUND",
  "statusCode": 404,
  "timestamp": "2024-01-15T10:00:00.000Z",
  "requestId": "req_1234567890"
}
```

### Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `VALIDATION_ERROR` | 400 | Invalid request body |
| `UNAUTHORIZED` | 401 | Missing or invalid auth |
| `FORBIDDEN` | 403 | Insufficient permissions |
| `NOT_FOUND` | 404 | Resource not found |
| `RATE_LIMITED` | 429 | Rate limit exceeded |
| `INTERNAL_ERROR` | 500 | Server error |
| `SERVICE_UNAVAILABLE` | 503 | Database unavailable |

### Pagination

```http
GET /api/v1/logs?orgId=648&page=2&limit=100
```

Response includes:
- `total`: Total count
- `page`: Current page
- `limit`: Items per page
- `hasMore`: Boolean

### Filtering

```http
GET /api/v1/logs?orgId=648&status=FAILED&eventType=appointment-created&search=patient123
```

Supported operators:
- Exact match: `status=FAILED`
- Date range: `startDate=2024-01-01&endDate=2024-01-31`
- Search: `search=keyword` (searches relevant fields)

---

## Resilience & Reliability

### Retry Logic

**Exponential Backoff**:
```javascript
const baseDelay = 1000;  // 1 second
const maxDelay = 5000;   // 5 seconds
const attempt = 0;

const delay = Math.min(
  baseDelay * Math.pow(2, attempt),
  maxDelay
);

// Add jitter to prevent thundering herd
const jitter = delay * 0.2 * Math.random();
const finalDelay = delay + jitter;
```

**Retryable Conditions**:
- HTTP 408 (Request Timeout)
- HTTP 429 (Too Many Requests)
- HTTP 5xx (Server Errors)
- Network errors (ETIMEDOUT, ECONNREFUSED, ENOTFOUND, ECONNABORTED)

**Non-Retryable Conditions**:
- HTTP 4xx (except 408, 429)
- Invalid configuration
- Malformed payloads

### Circuit Breaker

**Threshold**: 5 consecutive failures

**Behavior**:
```
1. After 5 consecutive failures:
   - Set isActive = false
   - Stop delivering events
   - Send alert to admin

2. Manual re-enable via UI:
   - Admin clicks "Enable Integration"
   - Reset consecutive failure counter
```

### Dead Letter Queue (DLQ)

**Purpose**: Store failed deliveries for manual investigation and retry

**Entry Creation**:
- After final retry attempt
- Rate limit exceeded (if configured)
- Unretryable errors (for audit trail)

**DLQ Worker**:
- Auto-retries PENDING_RETRY entries
- Exponential backoff
- Max 3 retries
- Marks as ABANDONED after final retry

**Manual Operations**:
- Bulk retry (up to 100 entries)
- Individual retry
- Delete entry
- View execution trace

### Database Resilience

**MongoDB Auto-Reconnection**:
```javascript
const client = new MongoClient(uri, {
  maxPoolSize: 100,
  minPoolSize: 10,
  maxIdleTimeMS: 30000,
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000
});

// All operations wrapped in safe wrapper
async function getDbSafe() {
  if (!client.topology || !client.topology.isConnected()) {
    await client.connect();
  }
  return client.db(dbName);
}
```

**MySQL Pool Recreation**:
```javascript
pool.on('error', (err) => {
  if (err.code === 'PROTOCOL_CONNECTION_LOST' || err.fatal) {
    recreatePool();
  }
});

async function recreatePool() {
  await pool.end();
  pool = createPoolWithHandlers();
  await pool.execute('SELECT 1');
}
```

### Graceful Degradation

**MongoDB Unavailable**:
- Return cached data where possible
- Queue writes for retry
- Show user-friendly error message

**MySQL Unavailable**:
- Worker continues running
- Retries connection every 30 seconds
- No impact on API (MongoDB-backed)

**External API Unavailable**:
- Create DLQ entry
- DLQ worker retries automatically
- Alert admin after multiple failures

---

## Scalability Considerations

### Horizontal Scaling

**API Server**:
- Stateless design (no in-memory sessions)
- Load balance with Nginx/HAProxy
- Cluster mode with PM2

**Workers**:
- Single-instance (checkpoint-based locking)
- Future: Distributed lock with Redis/MongoDB

**Databases**:
- MongoDB: Replica set (3+ nodes)
- MySQL: Read replicas for event source

### Vertical Scaling

**Current Limits** (per server):
- API: 1000 req/sec (tested)
- Worker: 100 events/sec (5 events × 20 Hz)
- Connections: MongoDB 100 pool, MySQL 10 pool

**Optimization Opportunities**:
- Increase worker batch size
- Parallel event processing (Promise.all)
- Connection pool tuning

### Caching

**In-Memory Caches**:
- Event deduplication (5-minute window)
- Lookup tables (60-minute TTL)
- OAuth2 tokens (until expiration)

**Database Query Optimization**:
- Proper indexing
- Projection (select only needed fields)
- Pagination (avoid loading all records)

### Monitoring & Alerts

**Key Metrics**:
- API response time (p50, p95, p99)
- Worker lag (events behind)
- DLQ size
- Database connection pool utilization
- Error rate per integration

**Alerts**:
- Worker stopped
- DLQ size > threshold
- Error rate > 10%
- Database connection failures

---

## Conclusion

Integration Gateway is designed for reliability, observability, and developer experience. The architecture supports both event-driven and real-time integration patterns while maintaining data isolation, security, and performance.

For questions or contributions, see [CONTRIBUTING.md](./CONTRIBUTING.md).
