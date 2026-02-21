# Data Source Executor Service

Technical documentation for the Data Source Executor service used by SCHEDULED integrations.

## Overview

The Data Source Executor is a service that executes queries and API calls against various data sources:
- **SQL** - MySQL database queries (internal HIS database)
- **MongoDB** - MongoDB aggregations (internal OR external databases)
- **API** - Internal API HTTP calls

**File**: `backend/src/services/data-source-executor.js`

**Used By**: Scheduled Job Worker (`backend/src/processor/scheduled-job-worker.js`)

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│              Data Source Executor Service                        │
│  Main Entry Point: executeDataSource(config, integrationConfig) │
└────────────────────────┬────────────────────────────────────────┘
                         │
         ┌───────────────┼───────────────┐
         │               │               │
         ▼               ▼               ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│ SQL Executor │  │ MongoDB Exec │  │ API Executor │
│              │  │              │  │              │
│ - Variable   │  │ - Internal   │  │ - GET/POST   │
│   substitu   │  │   MongoDB    │  │   /PUT       │
│   tion       │  │ - External   │  │ - Headers    │
│ - Query exec │  │   MongoDB    │  │ - Body       │
│ - Error      │  │ - Pipeline   │  │ - Timeout    │
│   handling   │  │   execution  │  │   30s        │
└──────────────┘  └──────────────┘  └──────────────┘
```

## Variable Substitution

### Supported Variables

**Config Variables**:
- `{{config.tenantId}}` → Current tenant ID
- `{{config.integrationId}}` → Current integration ID
- `{{config.integrationName}}` → Current integration name

**Date Helpers**:
- `{{date.today()}}` → Today's date (YYYY-MM-DD)
- `{{date.yesterday()}}` → Yesterday's date (YYYY-MM-DD)
- `{{date.todayStart()}}` → Today at 00:00:00 (ISO)
- `{{date.todayEnd()}}` → Today at 23:59:59 (ISO)
- `{{date.now()}}` → Current timestamp (ISO)
- `{{date.timestamp()}}` → Current Unix timestamp (milliseconds)

**Environment Variables**:
- `{{env.VAR_NAME}}` → Value of environment variable VAR_NAME

### Implementation

```javascript
// backend/src/services/data-source-executor.js:16-55

const getVariableValue = (variable, context) => {
  // Config variables: {{config.tenantId}}
  if (variable.startsWith('config.')) {
    const key = variable.substring(7);
    return context.config[key];
  }

  // Date helpers: {{date.today()}}
  if (variable.startsWith('date.')) {
    const func = variable.substring(5);
    const now = new Date();

    switch (func) {
      case 'today()':
        return now.toISOString().split('T')[0];
      case 'yesterday()':
        const yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);
        return yesterday.toISOString().split('T')[0];
      case 'todayStart()':
        return new Date(now.setHours(0, 0, 0, 0)).toISOString();
      case 'todayEnd()':
        return new Date(now.setHours(23, 59, 59, 999)).toISOString();
      case 'now()':
        return now.toISOString();
      case 'timestamp()':
        return now.getTime();
      default:
        return variable;
    }
  }

  // Environment variables: {{env.VAR_NAME}}
  if (variable.startsWith('env.')) {
    const key = variable.substring(4);
    return process.env[key];
  }

  return variable;
};

const replaceVariables = (str, context) => {
  if (typeof str !== 'string') return str;

  return str.replace(/\{\{([^}]+)\}\}/g, (match, variable) => {
    const value = getVariableValue(variable.trim(), context);
    return value !== undefined ? value : match;
  });
};
```

### Usage in Queries

**SQL Query**:
```sql
SELECT * FROM bills
WHERE entity_rid = {{config.tenantId}}
  AND DATE(created_at) = {{date.today()}}
  AND amount > 1000
ORDER BY created_at DESC
```

**MongoDB Pipeline**:
```javascript
[
  {
    "$match": {
      "tenantId": "{{config.tenantId}}",
      "createdAt": {
        "$gte": "{{date.todayStart()}}",
        "$lt": "{{date.todayEnd()}}"
      }
    }
  }
]
```

**API URL**:
```
http://localhost:4000/api/v1/reports?date={{date.today()}}&tenant={{config.tenantId}}
```

---

## SQL Executor

### Function Signature

```javascript
executeSqlQuery(dataSourceConfig, context)
```

### Parameters

```typescript
dataSourceConfig: {
  type: 'SQL',
  connectionString?: string,  // Optional, omit for internal MySQL
  host?: string,
  port?: number,
  username?: string,
  password?: string,
  database?: string,
  query: string  // SQL query with optional variables
}

context: {
  config: {
    tenantId: number,
    integrationId: string,
    integrationName: string
  }
}
```

### Implementation

```javascript
// backend/src/services/data-source-executor.js:73-100

const executeSqlQuery = async (dataSourceConfig, context) => {
  const connection = dataSourceConfig.connectionString
    ? await mysql.createConnection(replaceVariables(dataSourceConfig.connectionString, context))
    : dataSourceConfig.host
      ? await mysql.createConnection({
          host: dataSourceConfig.host,
          port: dataSourceConfig.port,
          user: dataSourceConfig.username,
          password: dataSourceConfig.password,
          database: dataSourceConfig.database
        })
      : await getConnection();  // From db.js

  try {
    // Replace variables in query
    const query = replaceVariables(dataSourceConfig.query, context);

    log('info', 'Executing SQL query', {
      query: query.substring(0, 100) + '...',
      tenantId: context.config.tenantId
    });

    const [rows] = await connection.query(query);

    log('info', 'SQL query executed successfully', {
      rowCount: rows.length,
      tenantId: context.config.tenantId
    });

    return rows;
  } catch (error) {
    log('error', 'SQL query execution failed', {
      error: error.message,
      query: dataSourceConfig.query.substring(0, 100) + '...'
    });
    throw new Error(`SQL query failed: ${error.message}`);
  }
};
```

### Return Value

```typescript
Array<Record<string, any>>  // Array of row objects
```

### Example

**Input**:
```javascript
{
  type: 'SQL',
  query: `
    SELECT billId, patientName, totalAmount
    FROM bills
    WHERE entity_rid = {{config.tenantId}}
      AND DATE(created_at) = {{date.today()}}
  `
}
```

**Output**:
```javascript
[
  { billId: 1001, patientName: 'John Doe', totalAmount: 5000 },
  { billId: 1002, patientName: 'Jane Smith', totalAmount: 7500 }
]
```

### Connection Management

- **External MySQL**: If `connectionString` or `host`/`port`/`username`/`password`/`database` are provided, a dedicated connection is created and closed per execution
- **Internal MySQL**: Otherwise uses shared MySQL connection pool from `db.js`
- **Timeout**: Inherits from pool configuration (typically 30s)
- **Error Handling**: Connection errors automatically handled by pool

---

## MongoDB Executor

### Function Signature

```javascript
executeMongoQuery(dataSourceConfig, context)
```

### Parameters

```typescript
dataSourceConfig: {
  type: 'MONGODB',
  connectionString?: string,  // Optional - for external MongoDB
  database?: string,          // Database name (external) or collection parent (internal)
  collection: string,         // Collection name
  pipeline: any[]            // Aggregation pipeline
}

context: {
  config: {
    tenantId: number,
    integrationId: string,
    integrationName: string
  }
}
```

### Implementation

```javascript
// backend/src/services/data-source-executor.js:106-190

const executeMongoQuery = async (dataSourceConfig, context) => {
  let client = null;
  let db;

  try {
    // Check if external MongoDB connection string is provided
    if (dataSourceConfig.connectionString) {
      // External MongoDB connection
      const connectionString = replaceVariables(dataSourceConfig.connectionString, context);
      const databaseName = dataSourceConfig.database || 'test';

      log('info', 'Connecting to external MongoDB', {
        database: databaseName,
        tenantId: context.config.tenantId
      });

      client = new MongoClient(connectionString, {
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 30000
      });

      await client.connect();
      db = client.db(databaseName);
    } else {
      // Use application's internal MongoDB
      db = await getDb();
    }

    // Replace variables in pipeline (recursive)
    let pipeline = JSON.parse(JSON.stringify(dataSourceConfig.pipeline));

    const replaceInObject = (obj) => {
      if (Array.isArray(obj)) {
        return obj.map(replaceInObject);
      } else if (typeof obj === 'object' && obj !== null) {
        const result = {};
        for (const key in obj) {
          result[key] = replaceInObject(obj[key]);
        }
        return result;
      } else if (typeof obj === 'string') {
        return replaceVariables(obj, context);
      }
      return obj;
    };

    pipeline = replaceInObject(pipeline);

    log('info', 'Executing MongoDB aggregation', {
      collection: dataSourceConfig.collection,
      database: dataSourceConfig.database || 'internal',
      stages: pipeline.length,
      isExternal: !!dataSourceConfig.connectionString,
      tenantId: context.config.tenantId
    });

    const collection = db.collection(dataSourceConfig.collection);
    const results = await collection.aggregate(pipeline).toArray();

    log('info', 'MongoDB aggregation executed successfully', {
      resultCount: results.length,
      tenantId: context.config.tenantId
    });

    return results;
  } catch (error) {
    log('error', 'MongoDB aggregation failed', {
      error: error.message,
      collection: dataSourceConfig.collection,
      database: dataSourceConfig.database,
      isExternal: !!dataSourceConfig.connectionString
    });
    throw new Error(`MongoDB query failed: ${error.message}`);
  } finally {
    // Close external connection if opened
    if (client) {
      try {
        await client.close();
      } catch (err) {
        log('warn', 'Failed to close MongoDB connection', { error: err.message });
      }
    }
  }
};
```

### Key Features

**External MongoDB Support**:
- ✅ Connects to any MongoDB instance via connection string
- ✅ Auto-connect and auto-close per execution
- ✅ Timeout protection (5s server selection, 30s socket)
- ✅ Connection string supports variable substitution

**Internal MongoDB**:
- ✅ Uses shared MongoDB client from `mongodb.js`
- ✅ No connection overhead
- ✅ Connection pooling handled automatically

### Connection String Examples

**Basic**:
```
mongodb://localhost:27017
```

**With Auth**:
```
mongodb://username:password@host:27017
```

**With Database**:
```
mongodb://host:27017/dbname
```

**Replica Set**:
```
mongodb://host1:27017,host2:27017,host3:27017/?replicaSet=rs0
```

**With Variables**:
```
mongodb://{{env.MONGO_USER}}:{{env.MONGO_PASS}}@{{env.MONGO_HOST}}:27017
```

### Return Value

```typescript
Array<any>  // Array of aggregation result documents
```

### Example

**Input (External MongoDB)**:
```javascript
{
  type: 'MONGODB',
  connectionString: 'mongodb://user:pass@external-host:27017',
  database: 'clinic_db',
  collection: 'appointments',
  pipeline: [
    {
      $match: {
        tenantId: '{{config.tenantId}}',
        appointmentDate: {
          $gte: '{{date.todayStart()}}',
          $lt: '{{date.todayEnd()}}'
        },
        status: 'CONFIRMED'
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

**Output**:
```javascript
[
  {
    _id: ObjectId('...'),
    patientId: 'P001',
    patientName: 'John Doe',
    appointmentDate: '2024-01-15T10:00:00Z',
    doctorName: 'Dr. Smith'
  },
  {
    _id: ObjectId('...'),
    patientId: 'P002',
    patientName: 'Jane Doe',
    appointmentDate: '2024-01-15T14:00:00Z',
    doctorName: 'Dr. Johnson'
  }
]
```

---

## API Executor

### Function Signature

```javascript
executeApiCall(dataSourceConfig, context)
```

### Parameters

```typescript
dataSourceConfig: {
  type: 'API',
  url: string,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH',
  headers?: Record<string, string>,
  body?: any
}

context: {
  config: {
    tenantId: number,
    integrationId: string,
    integrationName: string
  }
}
```

### Implementation

```javascript
// backend/src/services/data-source-executor.js:195-258

const executeApiCall = async (dataSourceConfig, context) => {
  try {
    // Replace variables in URL and body
    const url = replaceVariables(dataSourceConfig.url, context);
    const method = dataSourceConfig.method || 'GET';

    let requestConfig = {
      method,
      url,
      headers: dataSourceConfig.headers || {},
      timeout: 30000
    };

    // Replace variables in headers
    for (const key in requestConfig.headers) {
      requestConfig.headers[key] = replaceVariables(requestConfig.headers[key], context);
    }

    // Add body for POST/PUT
    if (dataSourceConfig.body && ['POST', 'PUT', 'PATCH'].includes(method)) {
      let body = JSON.parse(JSON.stringify(dataSourceConfig.body));

      // Recursively replace variables
      const replaceInObject = (obj) => {
        if (Array.isArray(obj)) {
          return obj.map(replaceInObject);
        } else if (typeof obj === 'object' && obj !== null) {
          const result = {};
          for (const key in obj) {
            result[key] = replaceInObject(obj[key]);
          }
          return result;
        } else if (typeof obj === 'string') {
          return replaceVariables(obj, context);
        }
        return obj;
      };

      requestConfig.data = replaceInObject(body);
    }

    log('info', 'Executing API call', {
      url,
      method,
      tenantId: context.config.tenantId
    });

    const response = await axios(requestConfig);

    log('info', 'API call executed successfully', {
      url,
      status: response.status,
      tenantId: context.config.tenantId
    });

    return response.data;
  } catch (error) {
    log('error', 'API call failed', {
      error: error.message,
      url: dataSourceConfig.url
    });
    throw new Error(`API call failed: ${error.message}`);
  }
};
```

### Key Features

- ✅ Supports GET, POST, PUT, PATCH
- ✅ Custom headers with variable substitution
- ✅ Request body with variable substitution
- ✅ 30-second timeout
- ✅ Axios-based with full HTTP client features

### Return Value

```typescript
any  // API response body (parsed JSON)
```

### Example

**Input (GET with Headers)**:
```javascript
{
  type: 'API',
  url: 'http://localhost:4000/api/v1/analytics/summary?date={{date.today()}}',
  method: 'GET',
  headers: {
    'X-API-Key': '{{env.API_KEY}}',
    'X-Tenant-ID': '{{config.tenantId}}'
  }
}
```

**Output**:
```javascript
{
  totalRevenue: 150000,
  totalAppointments: 45,
  averageRating: 4.5
}
```

**Input (POST with Body)**:
```javascript
{
  type: 'API',
  url: 'http://localhost:4000/api/v1/reports/generate',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-API-Key': '{{env.API_KEY}}'
  },
  body: {
    reportType: 'daily_summary',
    date: '{{date.today()}}',
    tenantId: '{{config.tenantId}}'
  }
}
```

---

## Main Entry Point

### Function Signature

```javascript
executeDataSource(dataSourceConfig, integrationConfig)
```

### Implementation

```javascript
// backend/src/services/data-source-executor.js:264-286

const executeDataSource = async (dataSourceConfig, integrationConfig) => {
  const context = {
    config: {
      tenantId: integrationConfig.tenantId,
      integrationId: integrationConfig._id,
      integrationName: integrationConfig.name
    }
  };

  switch (dataSourceConfig.type) {
    case 'SQL':
      return await executeSqlQuery(dataSourceConfig, context);

    case 'MONGODB':
      return await executeMongoQuery(dataSourceConfig, context);

    case 'API':
      return await executeApiCall(dataSourceConfig, context);

    default:
      throw new Error(`Unsupported data source type: ${dataSourceConfig.type}`);
  }
};
```

### Usage Example

```javascript
// In scheduled-job-worker.js

const { executeDataSource } = require('../services/data-source-executor');

// Execute data source
const queryResult = await executeDataSource(
  jobConfig.dataSource,
  jobConfig
);

console.log('Fetched records:', queryResult.length);
```

---

## Error Handling

### Error Types

**SQL Errors**:
- Connection failures: `Error: connect ECONNREFUSED`
- Syntax errors: `Error: You have an error in your SQL syntax`
- Table not found: `Error: Table 'dbname.tablename' doesn't exist`
- Permission errors: `Error: Access denied for user`

**MongoDB Errors**:
- Connection timeout: `Error: connection timed out`
- Authentication failure: `Error: Authentication failed`
- Invalid pipeline: `Error: Invalid pipeline stage`
- Network errors: `Error: ENOTFOUND`

**API Errors**:
- Timeout: `Error: timeout of 30000ms exceeded`
- Network errors: `Error: ECONNREFUSED`, `Error: ENOTFOUND`
- HTTP errors: `Error: Request failed with status code 500`

### Error Propagation

All errors are caught and re-thrown with descriptive messages:

```javascript
catch (error) {
  throw new Error(`SQL query failed: ${error.message}`);
}
```

This allows the scheduled job worker to:
1. Log error context (which stage failed)
2. Store error details in execution log
3. Continue processing other jobs

---

## Testing

### Test Endpoint

**Endpoint**: `POST /api/v1/scheduled-jobs/test-datasource`

**Purpose**: Test data source configuration before saving

**Implementation**: `backend/src/routes/scheduled-jobs.js:396-470`

**Request**:
```json
{
  "dataSource": {
    "type": "SQL",
    "query": "SELECT * FROM appointments LIMIT 10"
  }
}
```

**Response (Success)**:
```json
{
  "success": true,
  "message": "Data source connected successfully",
  "recordsFetched": 10,
  "sampleData": [...],
  "limitedRecords": false
}
```

**Response (Error)**:
```json
{
  "success": false,
  "error": "SQL query failed: Table 'appointments' doesn't exist"
}
```

### Timeout Protection

```javascript
// 30-second timeout for test execution
const timeout = new Promise((_, reject) =>
  setTimeout(() => reject(new Error('Data source test timed out after 30 seconds')), 30000)
);

const executePromise = executeDataSource(dataSource, mockIntegrationConfig);
const result = await Promise.race([executePromise, timeout]);
```

---

## Performance Considerations

### Connection Pooling

**SQL**:
- Shared connection pool (10 connections)
- Reuses connections across executions
- No connection overhead

**MongoDB (Internal)**:
- Shared MongoClient (100-connection pool)
- Reuses connections across executions
- No connection overhead

**MongoDB (External)**:
- New connection per execution
- Overhead: ~100-500ms connection time
- Auto-closed after execution

**API**:
- HTTP client with Keep-Alive
- Connection reuse for same host
- Minimal overhead

### Query Optimization

**SQL**:
- Use `LIMIT` to avoid large result sets
- Use proper indexes on filtered columns
- Avoid `SELECT *` when possible

**MongoDB**:
- Use `$limit` stage early in pipeline
- Create indexes on matched fields
- Use `$project` to limit returned fields

**API**:
- Use pagination when available
- Request only needed fields
- Cache responses when appropriate

### Data Size Limits

**Execution Logs**:
- `dataFetched`: Limited to 50KB
- `transformedPayload`: No limit (reasonable size expected)
- `responseBody`: Limited to 100KB

**Test Endpoint**:
- Returns max 10 records
- Truncates response >100KB

---

## Security Considerations

### SQL Injection

**Risk**: User-provided variables in SQL queries

**Mitigation**:
- Variables are substituted as-is (no parameterization)
- ⚠️ **DO NOT** allow user-controlled variable values
- ✅ Only use system-controlled variables (tenantId, date helpers)

**Safe**:
```sql
WHERE entity_rid = {{config.tenantId}}
```

**Unsafe** (if user controls value):
```sql
WHERE name = {{user.input}}  -- ❌ SQL injection risk
```

### NoSQL Injection

**Risk**: User-provided variables in MongoDB pipelines

**Mitigation**:
- Same as SQL - only use system-controlled variables
- MongoDB aggregation pipelines are less prone to injection

### SSRF (Server-Side Request Forgery)

**Risk**: User-controlled API URLs

**Mitigation**:
- ✅ Restrict API URLs to internal endpoints only
- ✅ Block private IP ranges in production
- ✅ Use allowlist for approved external domains

### Secrets in Connection Strings

**Risk**: Connection strings logged or exposed

**Mitigation**:
- ✅ Use environment variables: `{{env.MONGO_PASS}}`
- ✅ Redact connection strings in logs
- ✅ Store credentials in secure vaults

---

## Monitoring & Observability

### Logging

**Info Logs**:
```javascript
log('info', 'Executing SQL query', {
  query: query.substring(0, 100) + '...',
  tenantId: context.config.tenantId
});
```

**Error Logs**:
```javascript
log('error', 'MongoDB aggregation failed', {
  error: error.message,
  collection: dataSourceConfig.collection
});
```

### Metrics to Track

- **Execution time**: Track query/API response times
- **Success rate**: % of successful executions
- **Error categories**: Group errors by type
- **Data volumes**: Records fetched per execution
- **Connection failures**: External MongoDB connection issues

### Alerts

- MongoDB connection timeouts
- SQL query failures
- API endpoint unreachable
- Slow queries (>5 seconds)

---

## Future Enhancements

### Potential Improvements

1. **Connection Pooling for External MongoDB**
   - Maintain pool of connections to frequently-used external DBs
   - Reduce connection overhead

2. **Query Result Caching**
   - Cache frequently-executed queries
   - TTL-based invalidation

3. **Additional Data Sources**
   - PostgreSQL
   - Redis
   - Elasticsearch
   - REST APIs with pagination

4. **Query Builder UI**
   - Visual query builder for SQL
   - Aggregation pipeline builder for MongoDB

5. **Data Source Templates**
   - Pre-built queries for common patterns
   - One-click data source configuration

---

## Related Documentation

- [SCHEDULED_JOBS.md](../../SCHEDULED_JOBS.md) - Complete scheduled jobs documentation
- [ARCHITECTURE.md](../../ARCHITECTURE.md) - System architecture overview
- [Backend ROBUSTNESS_FIXES.md](../ROBUSTNESS_FIXES.md) - Error handling patterns

---

## API Reference

### Module Exports

```javascript
module.exports = {
  executeDataSource,
  replaceVariables  // Exported for testing
};
```

### Type Definitions

```typescript
interface DataSourceConfig {
  type: 'SQL' | 'MONGODB' | 'API';

  // SQL
  connectionString?: string;
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  database?: string;
  query?: string;

  // MongoDB
  connectionString?: string;
  database?: string;
  collection?: string;
  pipeline?: any[];

  // API
  url?: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH';
  headers?: Record<string, string>;
  body?: any;
}

interface IntegrationConfig {
  _id: string;
  tenantId: number;
  name: string;
}

interface Context {
  config: {
    tenantId: number;
    integrationId: string;
    integrationName: string;
  };
}

function executeDataSource(
  dataSourceConfig: DataSourceConfig,
  integrationConfig: IntegrationConfig
): Promise<any[]>;

function replaceVariables(
  str: string,
  context: Context
): string;
```

---

## Conclusion

The Data Source Executor provides a unified interface for fetching data from multiple sources with:
- ✅ **Variable substitution** for dynamic queries
- ✅ **External MongoDB support** with connection management
- ✅ **Error handling** with descriptive messages
- ✅ **Timeout protection** to prevent hanging
- ✅ **Comprehensive logging** for debugging

This service is critical for SCHEDULED integrations, enabling flexible batch data fetching and delivery.
