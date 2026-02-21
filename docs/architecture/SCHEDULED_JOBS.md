# Scheduled Jobs Documentation

Complete documentation for the SCHEDULED integration type - time-driven batch data fetching and delivery system.

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Data Sources](#data-sources)
- [Configuration](#configuration)
- [Execution Flow](#execution-flow)
- [Testing & Validation](#testing--validation)
- [Monitoring & Logging](#monitoring--logging)
- [API Reference](#api-reference)
- [UI Guide](#ui-guide)

---

## Overview

**Scheduled Jobs** (direction: `SCHEDULED`) are time-driven integrations that:
1. **Fetch data** from external sources (SQL databases, MongoDB, internal APIs)
2. **Transform** the fetched data using JavaScript
3. **Deliver** transformed data to external APIs on a schedule

Unlike OUTBOUND (event-driven) and INBOUND (request/response proxy) integrations, SCHEDULED jobs are **pull-based** and **time-triggered**.

### Use Cases

- **Daily Reports**: Fetch and send daily sales/patient data to external systems
- **Periodic Sync**: Sync data every N hours to keep external systems updated
- **Scheduled Exports**: Export data at specific times (e.g., EOD reports at 11 PM)
- **Data Aggregation**: Fetch data from multiple sources and combine

### Key Features

✅ **Multiple Data Sources**: SQL, MongoDB (internal + external), Internal APIs
✅ **Flexible Scheduling**: Cron expressions or fixed intervals
✅ **Variable Substitution**: Dynamic queries with `{{config.tenantId}}`, `{{date.today()}}`
✅ **Test Before Save**: Validate data source configuration before creating job
✅ **Comprehensive Logging**: Full execution trace with data at each step
✅ **External MongoDB**: Connect to any MongoDB instance, not just internal

---

## Architecture

### System Components

```
┌─────────────────────────────────────────────────────────────────┐
│                    Scheduled Job Worker                          │
│  • Polls: Every 60 seconds                                       │
│  • Executes: Jobs where next run time <= now                     │
│  • Schedules: Next execution after completion                    │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Data Source Executor                           │
│  • SQL: Executes queries against MySQL (internal HIS DB)        │
│  • MongoDB: Connects to internal OR external MongoDB            │
│  • API: Calls internal APIs for data fetching                   │
│  • Variable substitution: {{config.*}}, {{date.*}}, {{env.*}}   │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                 Transformation Service                           │
│  • JavaScript execution in VM2 sandbox                           │
│  • Input: payload.data (fetched data)                            │
│  • Output: transformed payload for target API                    │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                   HTTP Delivery                                  │
│  • POST/PUT to target URL                                        │
│  • Authentication support (all types)                            │
│  • Retry logic with exponential backoff                          │
│  • Response capture and logging                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Data Flow

```
Timer (Cron/Interval)
       ↓
Scheduled Job Worker detects job ready to run
       ↓
Fetch job config from integration_configs collection
       ↓
Execute Data Source (SQL/MongoDB/API)
       ↓
Apply variable substitution ({{config.tenantId}}, etc.)
       ↓
Transform fetched data (JavaScript VM2 sandbox)
       ↓
Build authentication headers
       ↓
HTTP POST/PUT to target URL
       ↓
Log execution details (data fetched, transformed, response)
       ↓
Schedule next execution (for CRON jobs)
```

---

## Data Sources

### 1. SQL (MySQL)

**Purpose**: Query internal HIS database or external MySQL databases for patient, appointment, billing data

**Configuration**:
```javascript
{
  type: 'SQL',
  connectionString: 'mysql://user:password@host:3306/dbname', // Optional (external DB)
  host: 'db.mycompany.com', // Optional (external DB)
  port: 3306,               // Optional
  username: 'db_user',      // Optional
  password: 'db_pass',      // Optional
  database: 'medics_his',   // Optional
  query: `
    SELECT
      b.billId,
      b.patientRid,
      b.totalAmount,
      b.createdDate
    FROM bills b
    WHERE DATE(b.createdDate) = CURDATE()
      AND b.entityRid = {{config.tenantId}}
    ORDER BY b.createdDate DESC
  `
}
```

**Variable Substitution**:
- `{{config.tenantId}}` - Current tenant ID
- `{{date.today()}}` - Today's date (YYYY-MM-DD)
- `{{date.yesterday()}}` - Yesterday's date
- `{{env.VAR_NAME}}` - Environment variable

**Implementation**: `backend/src/services/data-source-executor.js:73-100`

**Connection**:
- If `connectionString` or `host`/`port`/`username`/`password`/`database` are provided: connects to external MySQL for this job execution
- Otherwise: uses shared MySQL connection pool from `backend/src/db.js`

**Returns**: Array of row objects

---

### 2. MongoDB

**Purpose**: Query internal logs OR external MongoDB databases

**Configuration (Internal MongoDB)**:
```javascript
{
  type: 'MONGODB',
  collection: 'delivery_logs',
  pipeline: [
    {
      $match: {
        tenantId: "{{config.tenantId}}",
        createdAt: {
          $gte: "{{date.todayStart()}}",
          $lt: "{{date.todayEnd()}}"
        },
        status: "FAILED"
      }
    },
    {
      $group: {
        _id: "$errorCategory",
        count: { $sum: 1 }
      }
    }
  ]
}
```

**Configuration (External MongoDB)**:
```javascript
{
  type: 'MONGODB',
  connectionString: 'mongodb://user:password@external-host:27017',
  database: 'external_db',
  collection: 'appointments',
  pipeline: [
    {
      $match: {
        tenantId: "{{config.tenantId}}",
        appointmentDate: {
          $gte: "{{date.todayStart()}}",
          $lt: "{{date.todayEnd()}}"
        },
        status: "CONFIRMED"
      }
    },
    {
      $project: {
        patientId: 1,
        patientName: 1,
        appointmentDate: 1,
        doctorName: 1
      }
    }
  ]
}
```

**Key Features**:
- ✅ **External MongoDB Support**: Connect to any MongoDB instance
- ✅ **Connection Management**: Auto-connect and auto-close external connections
- ✅ **Timeout Protection**: 5s server selection timeout, 30s socket timeout
- ✅ **Variable Substitution**: Works in connection strings, pipeline stages

**Implementation**: `backend/src/services/data-source-executor.js:106-190`

**Returns**: Array of aggregation results

---

### 3. Internal API

**Purpose**: Call internal API endpoints to fetch processed data

**Configuration (GET)**:
```javascript
{
  type: 'API',
  url: 'http://localhost:4000/api/v1/analytics/summary',
  method: 'GET',
  headers: {
    'X-API-Key': '{{env.API_KEY}}',
    'Content-Type': 'application/json'
  }
}
```

**Configuration (POST with Body)**:
```javascript
{
  type: 'API',
  url: 'http://localhost:4000/api/v1/reports/generate',
  method: 'POST',
  headers: {
    'X-API-Key': '{{env.API_KEY}}',
    'Content-Type': 'application/json'
  },
  body: {
    reportType: 'daily_summary',
    date: '{{date.today()}}'
  }
}
```

**Supported Methods**: GET, POST, PUT, PATCH

**Implementation**: `backend/src/services/data-source-executor.js:195-258`

**Returns**: API response body (any JSON structure)

---

## Configuration

### Schedule Types

#### 1. CRON Expression

**Purpose**: Run at specific times (hourly, daily, weekly, monthly)

**Examples**:
```javascript
// Every hour at minute 0
'0 * * * *'

// Every hour at minute 30
'30 * * * *'

// Daily at 9:00 AM
'0 9 * * *'

// Every Monday at 10:00 AM
'0 10 * * 1'

// First day of every month at midnight
'0 0 1 * *'
```

**Cron Format**: `minute hour day-of-month month day-of-week`

**UI**: Visual cron builder with presets (Hourly, Daily, Weekly, Monthly, Custom)

**Implementation**: Uses `node-cron` for validation and scheduling

---

#### 2. Fixed Interval

**Purpose**: Run every N milliseconds

**Examples**:
```javascript
// Every 1 minute
60000

// Every 5 minutes
300000

// Every 1 hour
3600000

// Every 6 hours
21600000
```

**Minimum**: 60000ms (1 minute)

**Use Case**: When you need precise intervals regardless of clock time

---

### Integration Config Schema

```typescript
{
  direction: 'SCHEDULED',
  name: string,
  type: string,  // Categorization (e.g., 'DAILY_EXPORT')
  description: string,
  tenantId: number,
  isActive: boolean,

  // Schedule configuration
  schedule: {
    type: 'CRON' | 'INTERVAL',
    expression?: string,  // For CRON (e.g., '0 9 * * *')
    timezone?: string,    // For CRON (e.g., 'Asia/Kolkata')
    intervalMs?: number   // For INTERVAL (e.g., 3600000)
  },

  // Data source configuration
  dataSource: {
    type: 'SQL' | 'MONGODB' | 'API',

    // SQL
    connectionString?: string,  // Optional, omit for internal MySQL
    host?: string,
    port?: number,
    username?: string,
    password?: string,
    database?: string,
    query?: string,

    // MongoDB
    connectionString?: string,  // Optional, omit for internal MongoDB
    database?: string,
    collection?: string,
    pipeline?: any[],

    // API
    url?: string,
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH',
    headers?: Record<string, string>,
    body?: any
  },

  // Transformation configuration
  transformation: {
    mode: 'SCRIPT',  // Only SCRIPT supported for scheduled jobs
    script: string   // JavaScript code
  },

  // Target API configuration
  targetUrl: string,
  httpMethod: 'POST' | 'PUT',

  // Authentication (same as OUTBOUND integrations)
  outgoingAuthType: 'NONE' | 'API_KEY' | 'BEARER' | 'BASIC' | 'OAUTH2' | 'CUSTOM_HEADERS',
  outgoingAuthConfig: {...},

  createdAt: Date,
  updatedAt: Date
}
```

**Collection**: `integration_configs`

**Query Filter**: `{ direction: 'SCHEDULED', tenantId: <tenant>, isActive: true }`

---

## Execution Flow

### Scheduled Job Worker

**File**: `backend/src/processor/scheduled-job-worker.js`

**Polling Interval**: 60 seconds

**Execution Steps**:

```javascript
1. Find active CRON jobs ready to run
   - Query: { direction: 'SCHEDULED', isActive: true, 'schedule.type': 'CRON' }
   - Filter: shouldRunNow(nextRun, timezone) === true

2. Find active INTERVAL jobs ready to run
   - Query: { direction: 'SCHEDULED', isActive: true, 'schedule.type': 'INTERVAL' }
   - Filter: now - lastRun >= intervalMs

3. For each job ready to run:
   a. Create execution log entry (status: RUNNING)

   b. Execute data source
      - Substitute variables in query/pipeline/url
      - Execute SQL query / MongoDB aggregation / API call
      - Log data fetched (with 50KB size limit)

   c. Transform data
      - Execute transformation script in VM2 sandbox
      - Input: { data: <fetched data>, metadata: <job metadata> }
      - Output: transformed payload
      - Log transformed payload

   d. Build authentication headers
      - Based on outgoingAuthType
      - OAuth2 token fetch if needed

   e. Deliver to target API
      - POST/PUT request to targetUrl
      - Include auth headers + correlation ID
      - Timeout: 30 seconds
      - Log HTTP request (method, URL, headers, body)
      - Generate curl command for debugging

   f. Capture response
      - Log response status, headers, body
      - Log duration in milliseconds

   g. Update execution log
      - Status: SUCCESS or FAILED
      - Error details if failed
      - Execution metadata

   h. Schedule next execution (CRON only)
      - Calculate next cron occurrence
      - Update integration config with nextRun

4. Handle errors
   - Catch all errors
   - Log error context (which stage failed)
   - Mark execution as FAILED
   - Continue processing other jobs
```

**Key Implementation Details**:

```javascript
// From scheduled-job-worker.js:162-226

// Store data fetched (with size limit)
const dataFetchedForLog = JSON.stringify(queryResult);
executionLog.dataFetched = dataFetchedForLog.length > 50000
  ? dataFetchedForLog.substring(0, 50000) + '...(truncated)'
  : queryResult;

// Store transformed payload
executionLog.transformedPayload = transformedPayload;

// Store full HTTP request
executionLog.httpRequest = {
  method: jobConfig.httpMethod || 'POST',
  url: jobConfig.targetUrl,
  headers: requestHeaders,
  body: transformedPayload
};

// Generate curl command
const curlHeaders = Object.entries(requestHeaders)
  .map(([key, value]) => `-H "${key}: ${value}"`)
  .join(' ');
executionLog.curlCommand = `curl -X ${jobConfig.httpMethod || 'POST'} ${curlHeaders} -d '${JSON.stringify(transformedPayload)}' "${jobConfig.targetUrl}"`;

// Capture response headers
executionLog.responseHeaders = response.headers;
```

---

## Testing & Validation

### Test Data Source Feature

**Purpose**: Validate data source configuration BEFORE saving the scheduled job

**UI Location**: Scheduled Job Detail → Data Source tab → "Test Data Source" button

**Features**:
- ✅ **JSON Validation**: Validates MongoDB pipeline and API headers/body JSON before execution
- ✅ **Connection Test**: Actually executes the query/API call to verify connectivity
- ✅ **Sample Data**: Returns up to 10 records for preview
- ✅ **Error Details**: Shows specific error messages with troubleshooting hints
- ✅ **Smart Display**: Table view for consistent structures, JSON for complex data
- ✅ **Copy to Clipboard**: Copy sample data for analysis

**API Endpoint**: `POST /api/v1/scheduled-jobs/test-datasource`

**Request**:
```json
{
  "dataSource": {
    "type": "SQL",
    "query": "SELECT * FROM appointments WHERE DATE(created_at) = CURDATE() LIMIT 10"
  }
}
```

**Response (Success)**:
```json
{
  "success": true,
  "message": "Data source connected successfully",
  "recordsFetched": 10,
  "sampleData": [
    { "id": 1, "patientName": "John Doe", ... },
    { "id": 2, "patientName": "Jane Smith", ... }
  ],
  "limitedRecords": false
}
```

**Response (Error)**:
```json
{
  "success": false,
  "error": "MongoDB query failed: connection timed out",
  "details": {
    "code": "ETIMEOUT",
    "stack": "..."
  }
}
```

**Implementation**:
- Backend: `backend/src/routes/scheduled-jobs.js:396-470`
- Frontend: `frontend/src/features/scheduled-jobs/routes/ScheduledJobDetailRoute.tsx:241-333` (mutation)
- Frontend: `frontend/src/features/scheduled-jobs/routes/ScheduledJobDetailRoute.tsx:1163-1309` (modal)

**Error Handling**:
- ❌ Invalid JSON → User-friendly error: "Invalid MongoDB Pipeline JSON: ..."
- ❌ Connection failure → Troubleshooting hints based on data source type
- ❌ Timeout → 30-second timeout with clear message
- ✅ Large data → Automatically limits to 10 records and 100KB

---

## Monitoring & Logging

### Execution Logs

**Collection**: `scheduled_job_logs`

**Schema**:
```javascript
{
  _id: ObjectId,
  integrationId: ObjectId,
  tenantId: number,
  status: 'SUCCESS' | 'FAILED' | 'RUNNING',

  // Timing
  startedAt: Date,
  completedAt: Date,
  durationMs: number,

  // Data fetching
  dataFetchStage: 'SUCCESS' | 'FAILED',
  recordsFetched: number,
  dataFetched: any,  // Actual data (limited to 50KB)

  // Transformation
  transformationStage: 'SUCCESS' | 'FAILED',
  transformedPayload: any,

  // Delivery
  deliveryStage: 'SUCCESS' | 'FAILED',
  httpRequest: {
    method: string,
    url: string,
    headers: object,
    body: any
  },
  curlCommand: string,
  responseStatus: number,
  responseHeaders: object,
  responseBody: any,

  // Errors
  errorContext: {
    stage: 'DATA_FETCH' | 'TRANSFORMATION' | 'DELIVERY',
    error: string,
    stack: string
  },

  createdAt: Date
}
```

**API Endpoint**: `GET /api/v1/scheduled-jobs/:id/logs`

**Query Parameters**:
- `limit`: Number of logs to fetch (default: 50)
- `offset`: Pagination offset (default: 0)
- `status`: Filter by status (SUCCESS, FAILED)

---

### Execution Flow UI

**Location**: Logs → Log Detail → "Scheduled Job Execution Flow" card

**Timeline View**:

```
✓ Step 1: Data Fetched from Source
  Retrieved 25 record(s)
  [Expandable: View Data]

✓ Step 2: Data Transformed
  [Expandable: View Transformed Payload]

✓ Step 3: HTTP Request Sent
  POST https://api.finance.com/v1/import
  [Expandable: View Curl Command, Headers, Body]

✓ Step 4: Response Received
  Status: 200 OK
  [Expandable: View Response Body]
```

**Error Display**:
```
✗ Step 1: Data Fetch Failed
  Error: MongoDB connection timed out
  Connection string: mongodb://external-host:27017
  [Show Error Details]
```

**Implementation**: `frontend/src/features/logs/routes/LogDetailRoute.tsx:433-628`

**Benefits**:
- ✅ **Complete visibility** into execution flow
- ✅ **Debugging aid** with curl commands
- ✅ **Error context** shows which stage failed
- ✅ **Data inspection** at each transformation step

---

## API Reference

### Scheduled Jobs CRUD

#### List Scheduled Jobs
```http
GET /api/v1/scheduled-jobs?orgId=<tenantId>
```

**Response**:
```json
{
  "jobs": [
    {
      "_id": "...",
      "name": "Daily Bills Export",
      "isActive": true,
      "schedule": { "type": "CRON", "expression": "0 9 * * *" },
      "lastExecution": {
        "status": "SUCCESS",
        "startedAt": "2024-01-15T09:00:00Z",
        "durationMs": 1234,
        "recordsFetched": 50
      }
    }
  ]
}
```

---

#### Get Scheduled Job
```http
GET /api/v1/scheduled-jobs/:id?orgId=<tenantId>
```

**Response**: Full job configuration

---

#### Create Scheduled Job
```http
POST /api/v1/scheduled-jobs?orgId=<tenantId>
Content-Type: application/json

{
  "name": "Daily Bills Export",
  "type": "DAILY_EXPORT",
  "schedule": {
    "type": "CRON",
    "expression": "0 9 * * *",
    "timezone": "Asia/Kolkata"
  },
  "dataSource": {
    "type": "SQL",
    "query": "SELECT * FROM bills WHERE DATE(created_at) = CURDATE()"
  },
  "transformation": {
    "mode": "SCRIPT",
    "script": "return { bills: payload.data };"
  },
  "targetUrl": "https://api.finance.com/v1/import",
  "httpMethod": "POST",
  "outgoingAuthType": "API_KEY",
  "outgoingAuthConfig": {
    "headerName": "X-API-Key",
    "apiKey": "secret"
  }
}
```

**Response**: Created job with `_id`

---

#### Update Scheduled Job
```http
PUT /api/v1/scheduled-jobs/:id?orgId=<tenantId>
Content-Type: application/json

{
  "isActive": false
}
```

**Response**: Updated job configuration

**Note**: Worker automatically reschedules/unschedules based on `isActive` status

---

#### Delete Scheduled Job
```http
DELETE /api/v1/scheduled-jobs/:id?orgId=<tenantId>
```

**Response**: `{ "message": "Scheduled job deleted successfully" }`

**Note**: Worker automatically unschedules the job

---

#### Execute Scheduled Job Manually
```http
POST /api/v1/scheduled-jobs/:id/execute?orgId=<tenantId>
```

**Response**: `{ "message": "Job execution triggered" }`

**Note**: Fire-and-forget execution, check logs for results

---

#### Get Execution Logs
```http
GET /api/v1/scheduled-jobs/:id/logs?orgId=<tenantId>&limit=50&offset=0&status=FAILED
```

**Response**:
```json
{
  "logs": [
    {
      "_id": "...",
      "status": "SUCCESS",
      "startedAt": "2024-01-15T09:00:00Z",
      "completedAt": "2024-01-15T09:00:01.234Z",
      "durationMs": 1234,
      "recordsFetched": 50,
      "dataFetched": [...],
      "transformedPayload": {...},
      "httpRequest": {...},
      "curlCommand": "curl -X POST ..."
    }
  ],
  "total": 150
}
```

**Headers**: `X-Total-Count: 150`

---

#### Test Data Source
```http
POST /api/v1/scheduled-jobs/test-datasource?orgId=<tenantId>
Content-Type: application/json

{
  "dataSource": {
    "type": "MONGODB",
    "connectionString": "mongodb://external-host:27017",
    "database": "external_db",
    "collection": "appointments",
    "pipeline": [
      { "$match": { "status": "CONFIRMED" } },
      { "$limit": 10 }
    ]
  }
}
```

**Response**: See [Testing & Validation](#testing--validation) section

---

## UI Guide

### Creating a Scheduled Job

**Steps**:

1. **Navigate to Scheduled Jobs**
   - Sidebar → Configuration → Scheduled Jobs
   - Click "Create New Scheduled Job"

2. **Basic Info Tab**
   - Job Name: "Daily Bills Export"
   - Job Type: "DAILY_EXPORT"
   - Description: Optional
   - Status: Active/Paused

3. **Schedule Tab**
   - Schedule Type: Cron Expression or Fixed Interval
   - **Cron Builder**:
     - Select frequency: Hourly, Daily, Weekly, Monthly, Custom
     - For Hourly: Select minute past hour (0-59)
     - For Daily: Select time (HH:mm)
     - For Weekly: Select day(s) and time
   - **Fixed Interval**:
     - Enter interval in milliseconds (min: 60000)
   - Timezone: Select timezone (for CRON only)

4. **Data Source Tab**
   - Select type: SQL, MongoDB, or Internal API
   - **SQL**: Enter query with Monaco editor
   - **MongoDB**:
     - Connection String (e.g., `mongodb://host:port`)
     - Database Name
     - Collection Name
     - Aggregation Pipeline (JSON array)
   - **API**:
     - URL
     - Method (GET/POST/PUT)
     - Headers (JSON)
     - Body (JSON, for POST/PUT)
   - Click **"Test Data Source"** to validate
   - Review sample data in modal

5. **Transformation Tab**
   - Write JavaScript transformation script
   - Input: `payload.data` (fetched data)
   - Output: return transformed object
   - Example:
     ```javascript
     return {
       date: new Date().toISOString(),
       bills: payload.data.map(row => ({
         id: row.billId,
         amount: row.totalAmount
       }))
     };
     ```

6. **Target API Tab**
   - Target URL: `https://api.finance.com/v1/import`
   - HTTP Method: POST or PUT

7. **Authentication Tab**
   - Select auth type (NONE, API Key, Bearer, Basic, OAuth2)
   - Configure auth credentials

8. **Review & Submit Tab**
   - Review all configuration
   - Click "Create Scheduled Job"

---

### Monitoring Execution

**View Latest Execution**:
- Scheduled Jobs list → "Last Execution" column shows status

**View Execution History**:
- Click job name → "Execution History" tab
- Shows recent executions with status, timing, record count

**View Execution Details**:
- Logs → Filter by `triggerType=SCHEDULED`
- Click log entry → View detailed execution flow
- **Scheduled Job Execution Flow** card shows:
  - Data fetched from source
  - Transformed payload
  - HTTP request (with curl command)
  - Response received

---

### Troubleshooting

**Job Not Running**:
- ✅ Check `isActive = true`
- ✅ Check schedule configuration (cron expression valid?)
- ✅ Check worker is running: `pm2 status scheduled-job-worker`
- ✅ Check worker logs: `pm2 logs scheduled-job-worker`

**Data Fetch Failing**:
- ✅ Use "Test Data Source" to validate configuration
- ✅ Check connection strings (SQL/MongoDB)
- ✅ Verify query syntax
- ✅ Check variables are substituted correctly

**Transformation Failing**:
- ✅ Check transformation script syntax
- ✅ Verify `payload.data` structure matches expectations
- ✅ Check for runtime errors in execution logs

**Delivery Failing**:
- ✅ Verify target URL is accessible
- ✅ Check authentication credentials
- ✅ Review error in execution logs
- ✅ Use curl command from logs to test manually

---

## Advanced Features

### Variable Substitution

**Config Variables**:
- `{{config.tenantId}}` - Current tenant ID
- `{{config.integrationId}}` - Current integration ID
- `{{config.integrationName}}` - Current integration name

**Date Helpers**:
- `{{date.today()}}` - Today's date (YYYY-MM-DD)
- `{{date.yesterday()}}` - Yesterday's date (YYYY-MM-DD)
- `{{date.todayStart()}}` - Today at 00:00:00 (ISO)
- `{{date.todayEnd()}}` - Today at 23:59:59 (ISO)
- `{{date.now()}}` - Current timestamp (ISO)
- `{{date.timestamp()}}` - Current Unix timestamp (ms)

**Environment Variables**:
- `{{env.VAR_NAME}}` - Environment variable value

**Usage Locations**:
- SQL queries
- MongoDB connection strings
- MongoDB pipeline stages
- API URLs
- API headers
- API body

**Example**:
```javascript
// SQL query
SELECT * FROM bills
WHERE entity_rid = {{config.tenantId}}
  AND DATE(created_at) = {{date.today()}}

// MongoDB connection string
mongodb://{{env.MONGO_USER}}:{{env.MONGO_PASS}}@external-host:27017

// API URL
http://localhost:4000/api/v1/reports?date={{date.today()}}&tenantId={{config.tenantId}}
```

---

### CronBuilder Improvements

**Hourly Frequency**:
- Previously: Hardcoded to run at minute 0 (not editable)
- Now: Select specific minute (0-59) when job should run
- Example: Select minute 30 → runs at 00:30, 01:30, 02:30, etc.

**Implementation**: `frontend/src/features/scheduled-jobs/components/CronBuilder.tsx:95-98`

**UI**: TimePicker shows only minutes for hourly frequency

---

## Performance & Limits

### Execution Limits

- **Max execution time**: 30 seconds per job
- **Data fetch limit**: No hard limit, but logs truncate at 50KB
- **Sample data limit**: Test returns max 10 records
- **Response size limit**: Logs truncate large responses at 100KB
- **Worker polling**: Every 60 seconds
- **Minimum interval**: 60000ms (1 minute)

### Scaling Considerations

**Single Worker Instance**:
- Current implementation: One worker per environment
- Reason: Avoid duplicate executions
- Future: Distributed lock with MongoDB for multi-worker support

**Database Impact**:
- SQL queries: Read-only, no impact on primary DB
- MongoDB: Uses connection pools, auto-cleanup
- External MongoDB: Creates new connection per execution

**Monitoring**:
- Track execution durations
- Monitor data source connection failures
- Alert on repeated failures

---

## Migration from Legacy System

### Differences from Scheduled Integrations (DELAYED/RECURRING)

| Feature | SCHEDULED Jobs | Scheduled Integrations |
|---------|---------------|------------------------|
| **Trigger** | Time-based | Event + time-based |
| **Data Source** | Pull from external sources | Existing event payload |
| **Direction** | SCHEDULED | OUTBOUND |
| **Use Case** | Periodic data export | Delayed event delivery |
| **Collection** | `integration_configs` | `scheduled_integrations` |

**Note**: SCHEDULED jobs are NEW and distinct from existing scheduling features.

---

## Files Reference

### Backend

**Core Logic**:
- `backend/src/processor/scheduled-job-worker.js` - Job execution worker
- `backend/src/services/data-source-executor.js` - Data fetching service
- `backend/src/routes/scheduled-jobs.js` - CRUD API routes

**Dependencies**:
- `backend/src/db.js` - MySQL connection pool
- `backend/src/mongodb.js` - MongoDB client
- `backend/src/services/transformation/` - Transformation service
- `backend/src/services/auth/` - Authentication builder

### Frontend

**Pages**:
- `frontend/src/features/scheduled-jobs/routes/ScheduledJobsRoute.tsx` - List view
- `frontend/src/features/scheduled-jobs/routes/ScheduledJobDetailRoute.tsx` - Detail/create/edit form

**Components**:
- `frontend/src/features/scheduled-jobs/components/CronBuilder.tsx` - Cron expression builder

**API Client**:
- `frontend/src/services/api.ts` - API functions (`getScheduledJobs`, `createScheduledJob`, etc.)

**Log Display**:
- `frontend/src/features/logs/routes/LogDetailRoute.tsx` - Execution flow visualization

---

## Conclusion

Scheduled Jobs provide a complete solution for time-driven batch data integration with:
- ✅ Multiple data source support (SQL, MongoDB, APIs)
- ✅ External database connectivity
- ✅ Pre-execution testing and validation
- ✅ Comprehensive execution logging
- ✅ Flexible scheduling options
- ✅ Enterprise-grade error handling

For questions or issues, see the [Architecture Documentation](./ARCHITECTURE.md) or create a GitHub issue.
