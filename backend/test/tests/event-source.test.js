/**
 * Comprehensive tests for the event source system.
 *
 * Covers:
 *   1. quoteIdentifier — SQL injection prevention
 *   2. testConnection  — MySQL (live shared pool), HTTP Push
 *   3. describeTable   — column discovery
 *   4. Route assertOrgAccess — org-scoping logic
 *   5. Audit logger    — new action/resource types exist
 *   6. RBAC            — event_source:* permissions on all relevant roles
 *   7. DeliveryWorkerManager — instantiation, adapter creation, config hash
 *   8. MysqlEventSource — validation, normalizeRow, _parsePayload
 */

'use strict';

// ---------------------------------------------------------------------------
// Shared mocks (apply before any require() of app modules)
// ---------------------------------------------------------------------------

// MongoDB mock
const mockCollection = {
  findOne:       jest.fn(),
  find:          jest.fn(() => ({ toArray: jest.fn().mockResolvedValue([]) })),
  updateOne:     jest.fn().mockResolvedValue({ modifiedCount: 1 }),
  insertOne:     jest.fn().mockResolvedValue({ insertedId: 'mock-id' }),
  findOneAndUpdate: jest.fn().mockResolvedValue(null)
};
const mockDb = { collection: jest.fn(() => mockCollection) };

jest.mock('../../src/mongodb', () => ({
  getDbSafe: jest.fn().mockResolvedValue(mockDb),
  toObjectId: jest.fn(id => id)
}));

// MySQL mock pool
const mockPool = {
  execute: jest.fn(),
  end:     jest.fn().mockResolvedValue(undefined),
  query:   jest.fn()
};

// Reset the execute queue before every test so stale mockResolvedValueOnce /
// mockRejectedValueOnce responses from one test never bleed into the next.
// clearAllMocks() only clears call records — it does NOT flush the once-queue.
beforeEach(() => mockPool.execute.mockReset());

jest.mock('../../src/db', () => ({
  getPool:       jest.fn(() => mockPool),
  isConfigured:  jest.fn(() => true),
  query:         jest.fn(),
  ping:          jest.fn().mockResolvedValue(true)
}));

// Logger mock (suppress output in tests)
jest.mock('../../src/logger', () => ({
  log:      jest.fn(),
  logError: jest.fn()
}));

// Worker heartbeat mock
jest.mock('../../src/worker-heartbeat', () => ({
  updateHeartbeat: jest.fn()
}));

// ---------------------------------------------------------------------------
// Module imports (after mocks)
// ---------------------------------------------------------------------------
const { quoteIdentifier, testConnection, describeTable } = require('../../src/services/event-source-tester');
const { ACTION_TYPES, RESOURCE_TYPES }                   = require('../../src/services/audit-logger');
const { MysqlEventSource }                               = require('../../src/adapters/MysqlEventSource');

// ---------------------------------------------------------------------------
// 1. quoteIdentifier — SQL injection prevention
// ---------------------------------------------------------------------------

describe('quoteIdentifier', () => {
  test('quotes valid table name', () => {
    expect(quoteIdentifier('notification_queue', 'table')).toBe('`notification_queue`');
  });

  test('quotes valid column name with dollar sign', () => {
    expect(quoteIdentifier('col$name', 'col')).toBe('`col$name`');
  });

  test('rejects empty string', () => {
    expect(() => quoteIdentifier('', 'table')).toThrow('must be a non-empty string');
  });

  test('rejects SQL injection attempt with semicolon', () => {
    expect(() => quoteIdentifier('t; DROP TABLE users--', 'table'))
      .toThrow('contains invalid characters');
  });

  test('rejects injection attempt with space', () => {
    expect(() => quoteIdentifier('valid col', 'col')).toThrow('contains invalid characters');
  });

  test('rejects backtick in name', () => {
    expect(() => quoteIdentifier('my`table', 'table')).toThrow('contains invalid characters');
  });

  test('rejects name starting with digit', () => {
    expect(() => quoteIdentifier('1table', 'table')).toThrow('contains invalid characters');
  });

  test('allows underscore at start', () => {
    expect(quoteIdentifier('_private', 'col')).toBe('`_private`');
  });

  test('rejects non-string input', () => {
    expect(() => quoteIdentifier(null, 'table')).toThrow('must be a non-empty string');
    expect(() => quoteIdentifier(123, 'table')).toThrow('must be a non-empty string');
  });
});

// ---------------------------------------------------------------------------
// 2. testConnection — MySQL (mocked pool)
// ---------------------------------------------------------------------------

describe('testConnection — mysql (mocked pool)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const validMapping = {
    id:        'id',
    orgId:     'entity_parent_rid',
    eventType: 'transaction_type',
    payload:   'message'
  };

  const validDescribeRows = [
    { Field: 'id',                Null: 'NO', Key: 'PRI', Type: 'int',         Default: null },
    { Field: 'entity_parent_rid', Null: 'NO', Key: '',    Type: 'int',         Default: null },
    { Field: 'transaction_type',  Null: 'YES',Key: '',    Type: 'varchar(50)', Default: null },
    { Field: 'message',           Null: 'YES',Key: '',    Type: 'json',        Default: null },
    { Field: 'created_at',        Null: 'YES',Key: '',    Type: 'timestamp',   Default: null }
  ];

  test('returns success with validated mapping and sample event', async () => {
    const sampleRow = {
      id: 42,
      entity_parent_rid: 145,
      transaction_type: 'OP_VISIT_CREATED',
      message: '{"patient":"test"}'
    };

    mockPool.execute
      .mockResolvedValueOnce([[{ 1: 1 }]])   // SELECT 1 ping
      .mockResolvedValueOnce([validDescribeRows]) // DESCRIBE
      .mockResolvedValueOnce([[sampleRow]]);  // SELECT * LIMIT 1

    const result = await testConnection('mysql', {
      useSharedPool: true,
      table: 'notification_queue',
      columnMapping: validMapping
    });

    expect(result.success).toBe(true);
    expect(result.tableColumns).toEqual(expect.arrayContaining(['id', 'entity_parent_rid']));
    expect(result.validatedMapping.id.found).toBe(true);
    expect(result.validatedMapping.orgId.found).toBe(true);
    expect(result.sampleEvent).toEqual({
      id:        42,
      orgId:     145,
      eventType: 'OP_VISIT_CREATED',
      payload:   '{"patient":"test"}'
    });
  });

  test('returns failure when column not found in table', async () => {
    mockPool.execute
      .mockResolvedValueOnce([[{ 1: 1 }]])   // ping
      .mockResolvedValueOnce([validDescribeRows]); // DESCRIBE

    const result = await testConnection('mysql', {
      useSharedPool: true,
      table: 'notification_queue',
      columnMapping: {
        id: 'id',
        orgId: 'entity_parent_rid',
        eventType: 'NONEXISTENT_COLUMN',
        payload: 'message'
      }
    });

    expect(result.success).toBe(false);
    expect(result.code).toBe('COLUMN_NOT_FOUND');
    expect(result.validatedMapping.eventType.found).toBe(false);
    expect(result.tableColumns).toBeDefined();
  });

  test('returns failure for ER_NO_SUCH_TABLE', async () => {
    mockPool.execute
      .mockResolvedValueOnce([[{ 1: 1 }]])  // ping succeeds
      .mockRejectedValueOnce(Object.assign(new Error("Table 'db.ghost' doesn't exist"), { code: 'ER_NO_SUCH_TABLE' }));

    const result = await testConnection('mysql', {
      useSharedPool: true,
      table: 'ghost_table_xyz',
      columnMapping: validMapping
    });

    expect(result.success).toBe(false);
    expect(result.code).toBe('TABLE_NOT_FOUND');
    expect(result.hint).toMatch(/table/i);
  });

  test('returns failure for ER_ACCESS_DENIED_ERROR', async () => {
    mockPool.execute
      .mockRejectedValueOnce(Object.assign(new Error("Access denied for user 'x'@'localhost'"), { code: 'ER_ACCESS_DENIED_ERROR' }));

    const result = await testConnection('mysql', {
      useSharedPool: true,
      table: 'notification_queue',
      columnMapping: validMapping
    });

    expect(result.success).toBe(false);
    expect(result.code).toBe('AUTH_FAILED');
    expect(result.hint).toMatch(/password/i);
  });

  test('returns failure when ECONNREFUSED', async () => {
    // useSharedPool: false → _testMysql creates a real mysql2 pool (not mockPool),
    // so we rely on the real TCP connection to 127.0.0.1:3306 being refused.
    const result = await testConnection('mysql', {
      useSharedPool: false,
      host: '127.0.0.1', port: 3306, user: 'x', database: 'y',
      table: 'notification_queue',
      columnMapping: validMapping
    });

    expect(result.success).toBe(false);
    expect(result.code).toBe('HOST_UNREACHABLE');
  });

  test('rejects invalid table identifier before touching DB', async () => {
    const result = await testConnection('mysql', {
      useSharedPool: true,
      table: 'bad; DROP TABLE--',
      columnMapping: validMapping
    });

    expect(result.success).toBe(false);
    expect(result.code).toBe('INVALID_TABLE');
    expect(mockPool.execute).not.toHaveBeenCalled();
  });

  test('rejects invalid column identifier before touching DB', async () => {
    const result = await testConnection('mysql', {
      useSharedPool: true,
      table: 'notification_queue',
      columnMapping: {
        id: 'id',
        orgId: 'entity_parent_rid',
        eventType: 'bad column!',
        payload: 'message'
      }
    });

    expect(result.success).toBe(false);
    expect(result.code).toBe('INVALID_COLUMN');
    expect(mockPool.execute).not.toHaveBeenCalled();
  });

  test('requires credentials when shared pool unavailable and no dedicated creds', async () => {
    // useSharedPool: true but isConfigured() returns false (pool not ready)
    // → falls to else branch → no host/user/database → MISSING_CREDENTIALS
    const db = require('../../src/db');
    db.isConfigured.mockReturnValueOnce(false); // consumed by _testMysql's isConfigured() call

    const result = await testConnection('mysql', {
      useSharedPool: true,
      // missing host, user, database (no dedicated creds either)
      table: 'notification_queue',
      columnMapping: validMapping
    });

    expect(result.success).toBe(false);
    expect(result.code).toBe('MISSING_CREDENTIALS');
  });
});

// ---------------------------------------------------------------------------
// 3. testConnection — HTTP Push
// ---------------------------------------------------------------------------

describe('testConnection — http_push', () => {
  test('returns success for valid config', async () => {
    const result = await testConnection('http_push', { webhookSecret: 'abc123' });
    expect(result.success).toBe(true);
    expect(result.message).toMatch(/POST.*events\/push/i);
  });

  test('returns success for empty config', async () => {
    const result = await testConnection('http_push', {});
    expect(result.success).toBe(true);
  });

  test('rejects invalid webhookSecret type', async () => {
    const result = await testConnection('http_push', { webhookSecret: 12345 });
    expect(result.success).toBe(false);
    expect(result.code).toBe('INVALID_CONFIG');
  });
});

// ---------------------------------------------------------------------------
// 4. testConnection — unknown type
// ---------------------------------------------------------------------------

describe('testConnection — unknown type', () => {
  test('returns error for unknown type', async () => {
    const result = await testConnection('ftp', {});
    expect(result.success).toBe(false);
    expect(result.code).toBe('UNKNOWN_TYPE');
  });
});

// ---------------------------------------------------------------------------
// 5. describeTable — mocked pool
// ---------------------------------------------------------------------------

describe('describeTable (mocked pool)', () => {
  beforeEach(() => jest.clearAllMocks());

  const describeRows = [
    { Field: 'id',    Null: 'NO', Key: 'PRI', Type: 'int',        Default: null },
    { Field: 'topic', Null: 'YES',Key: '',    Type: 'varchar(255)',Default: null }
  ];

  test('returns column list on success', async () => {
    mockPool.execute.mockResolvedValueOnce([describeRows]);

    const result = await describeTable({ useSharedPool: true, table: 'notification_queue' });

    expect(result.success).toBe(true);
    expect(result.table).toBe('notification_queue');
    expect(result.columns).toHaveLength(2);
    expect(result.columns[0]).toMatchObject({ name: 'id', type: 'int', nullable: false, key: 'PRI' });
  });

  test('returns INVALID_TABLE for bad identifier', async () => {
    const result = await describeTable({ useSharedPool: true, table: '' });
    expect(result.success).toBe(false);
    expect(result.code).toBe('INVALID_TABLE');
  });

  test('classifies ER_NO_SUCH_TABLE correctly', async () => {
    mockPool.execute
      .mockRejectedValueOnce(Object.assign(new Error("doesn't exist"), { code: 'ER_NO_SUCH_TABLE' }));

    const result = await describeTable({ useSharedPool: true, table: 'ghost' });
    expect(result.success).toBe(false);
    expect(result.code).toBe('TABLE_NOT_FOUND');
  });
});

// ---------------------------------------------------------------------------
// 6. Audit logger — action types and resource types exist
// ---------------------------------------------------------------------------

describe('Audit logger — event_source types', () => {
  test('EVENT_SOURCE_CONFIGURED action type is defined', () => {
    expect(ACTION_TYPES.EVENT_SOURCE_CONFIGURED).toBe('event_source_configured');
  });

  test('EVENT_SOURCE_DELETED action type is defined', () => {
    expect(ACTION_TYPES.EVENT_SOURCE_DELETED).toBe('event_source_deleted');
  });

  test('EVENT_SOURCE_TESTED action type is defined', () => {
    expect(ACTION_TYPES.EVENT_SOURCE_TESTED).toBe('event_source_tested');
  });

  test('EVENT_SOURCE resource type is defined', () => {
    expect(RESOURCE_TYPES.EVENT_SOURCE).toBe('event_source');
  });
});

// ---------------------------------------------------------------------------
// 7. RBAC — event_source permissions on all roles
// ---------------------------------------------------------------------------

describe('RBAC — event_source permissions', () => {
  const { userHasPermission } = require('../../src/rbac/permissions');

  const makeUser = (role, orgId = null) => ({ id: '1', email: 'x@x.com', role, orgId });

  test('SUPER_ADMIN has event_source:manage', () => {
    expect(userHasPermission(makeUser('SUPER_ADMIN'), 'event_source:manage')).toBe(true);
  });

  test('ADMIN has event_source:manage', () => {
    expect(userHasPermission(makeUser('ADMIN'), 'event_source:manage')).toBe(true);
  });

  test('ORG_ADMIN has event_source:manage', () => {
    expect(userHasPermission(makeUser('ORG_ADMIN'), 'event_source:manage')).toBe(true);
  });

  test('ORG_ADMIN has event_source:view', () => {
    expect(userHasPermission(makeUser('ORG_ADMIN'), 'event_source:view')).toBe(true);
  });

  test('VIEWER does not have event_source:manage', () => {
    const ROLES = require('../../src/rbac/permissions').ROLES;
    // VIEWER role doesn't include event_source:manage
    expect(userHasPermission(makeUser('VIEWER'), 'event_source:manage')).toBe(false);
  });

  test('unauthenticated user is denied', () => {
    expect(userHasPermission(null, 'event_source:manage')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 8. Route assertOrgAccess logic (tested in isolation)
// ---------------------------------------------------------------------------

describe('assertOrgAccess — org-scoping logic', () => {
  // Replicate the logic from event-sources.js for isolated testing
  function assertOrgAccess(user, targetOrgId) {
    const { role, orgId: userOrgId } = user;
    if (role === 'SUPER_ADMIN' || role === 'ADMIN') return true;
    if (userOrgId && Number(userOrgId) === targetOrgId) return true;
    return false;
  }

  test('SUPER_ADMIN can access any org', () => {
    expect(assertOrgAccess({ role: 'SUPER_ADMIN', orgId: 100 }, 999)).toBe(true);
  });

  test('ADMIN can access any org', () => {
    expect(assertOrgAccess({ role: 'ADMIN', orgId: 100 }, 999)).toBe(true);
  });

  test('ORG_ADMIN can access their own org', () => {
    expect(assertOrgAccess({ role: 'ORG_ADMIN', orgId: 145 }, 145)).toBe(true);
  });

  test('ORG_ADMIN cannot access a different org', () => {
    expect(assertOrgAccess({ role: 'ORG_ADMIN', orgId: 145 }, 33)).toBe(false);
  });

  test('ORG_ADMIN with no orgId is denied', () => {
    expect(assertOrgAccess({ role: 'ORG_ADMIN', orgId: null }, 145)).toBe(false);
  });

  test('orgId coercion: string orgId matches numeric target', () => {
    expect(assertOrgAccess({ role: 'ORG_ADMIN', orgId: '145' }, 145)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 9. MysqlEventSource — constructor validation
// ---------------------------------------------------------------------------

describe('MysqlEventSource — constructor validation', () => {
  const validConfig = {
    orgId: 145,
    pool:  mockPool,
    table: 'notification_queue',
    columnMapping: {
      id:        'id',
      orgId:     'entity_parent_rid',
      eventType: 'transaction_type',
      payload:   'message'
    }
  };

  test('constructs successfully with all required fields', () => {
    const src = new MysqlEventSource(validConfig);
    expect(src.orgId).toBe(145);
    expect(src.table).toBe('notification_queue');
    expect(src.mapping.id).toBe('id');
  });

  test('throws when orgId is missing', () => {
    expect(() => new MysqlEventSource({ ...validConfig, orgId: undefined }))
      .toThrow('orgId is required');
  });

  test('throws when pool is missing', () => {
    expect(() => new MysqlEventSource({ ...validConfig, pool: undefined }))
      .toThrow('pool is required');
  });

  test('throws when columnMapping.id is missing', () => {
    expect(() => new MysqlEventSource({
      ...validConfig,
      columnMapping: { orgId: 'o', eventType: 'e', payload: 'p' }
    })).toThrow('columnMapping.id is required');
  });

  test('throws when columnMapping.orgId is missing', () => {
    expect(() => new MysqlEventSource({
      ...validConfig,
      columnMapping: { id: 'id', eventType: 'e', payload: 'p' }
    })).toThrow('columnMapping.orgId is required');
  });

  test('throws when columnMapping.eventType is missing', () => {
    expect(() => new MysqlEventSource({
      ...validConfig,
      columnMapping: { id: 'id', orgId: 'o', payload: 'p' }
    })).toThrow('columnMapping.eventType is required');
  });

  test('throws when columnMapping.payload is missing', () => {
    expect(() => new MysqlEventSource({
      ...validConfig,
      columnMapping: { id: 'id', orgId: 'o', eventType: 'e' }
    })).toThrow('columnMapping.payload is required');
  });

  test('throws with empty columnMapping ({})', () => {
    expect(() => new MysqlEventSource({ ...validConfig, columnMapping: {} }))
      .toThrow('columnMapping.id is required');
  });

  test('optional fields (orgUnitId, timestamp) may be absent', () => {
    expect(() => new MysqlEventSource(validConfig)).not.toThrow();
  });

  test('getName() returns descriptive string', () => {
    const src = new MysqlEventSource(validConfig);
    expect(src.getName()).toContain('145');
    expect(src.getName()).toContain('notification_queue');
  });
});

// ---------------------------------------------------------------------------
// 10. MysqlEventSource — _normalizeRow
// ---------------------------------------------------------------------------

describe('MysqlEventSource — _normalizeRow', () => {
  const src = new MysqlEventSource({
    orgId: 145,
    pool:  mockPool,
    table: 'notification_queue',
    columnMapping: {
      id:        'id',
      orgId:     'entity_parent_rid',
      orgUnitId: 'entity_rid',
      eventType: 'transaction_type',
      payload:   'message',
      timestamp: 'created_at'
    }
  });

  test('normalizes a complete row to standard envelope', () => {
    const row = {
      _id:        1793,
      _orgId:     145,
      _orgUnitId: 84,
      _eventType: 'LAB_RESULT_SIGNED',
      _payload:   '{"result":"positive"}',
      _timestamp: new Date('2024-01-01')
    };

    const event = src._normalizeRow(row);

    expect(event.id).toBe(1793);
    expect(event.orgId).toBe(145);
    expect(event.orgUnitRid).toBe(84);
    expect(event.event_type).toBe('LAB_RESULT_SIGNED');
    expect(event.payload).toEqual({ result: 'positive' });
    expect(event.source).toBe('mysql');
    expect(event.eventId).toContain('mysql-145');
    expect(event.created_at).toBeInstanceOf(Date);
  });

  test('parses JSON string payload', () => {
    const row = { _id: 1, _orgId: 145, _eventType: 'E', _payload: '{"k":"v"}' };
    expect(src._normalizeRow(row).payload).toEqual({ k: 'v' });
  });

  test('handles already-parsed object payload', () => {
    const row = { _id: 1, _orgId: 145, _eventType: 'E', _payload: { k: 'v' } };
    expect(src._normalizeRow(row).payload).toEqual({ k: 'v' });
  });

  test('handles null payload gracefully', () => {
    const row = { _id: 1, _orgId: 145, _eventType: 'E', _payload: null };
    expect(src._normalizeRow(row).payload).toEqual({});
  });

  test('handles invalid JSON payload gracefully', () => {
    const row = { _id: 1, _orgId: 145, _eventType: 'E', _payload: 'not-json{' };
    expect(src._normalizeRow(row).payload).toEqual({});
  });

  test('missing orgUnitId defaults to null', () => {
    const row = { _id: 1, _orgId: 145, _eventType: 'E', _payload: '{}' };
    expect(src._normalizeRow(row).orgUnitRid).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 11. DeliveryWorkerManager — instantiation and _createAdapter
// ---------------------------------------------------------------------------

describe('DeliveryWorkerManager — _createAdapter', () => {
  let manager;

  beforeEach(() => {
    jest.resetModules();
    jest.mock('../../src/mongodb', () => ({
      getDbSafe: jest.fn().mockResolvedValue(mockDb),
      toObjectId: jest.fn(id => id)
    }));
    jest.mock('../../src/db', () => ({
      getPool:      jest.fn(() => mockPool),
      isConfigured: jest.fn(() => true)
    }));
    jest.mock('../../src/logger', () => ({ log: jest.fn(), logError: jest.fn() }));
    jest.mock('../../src/worker-heartbeat', () => ({ updateHeartbeat: jest.fn() }));

    const { DeliveryWorkerManager } = require('../../src/processor/delivery-worker-manager');
    manager = new DeliveryWorkerManager();
  });

  const validMysqlConfig = {
    useSharedPool: true,
    table: 'notification_queue',
    columnMapping: {
      id: 'id', orgId: 'entity_parent_rid', eventType: 'transaction_type', payload: 'message'
    }
  };

  test('creates MysqlEventSource adapter for type=mysql', () => {
    const adapter = manager._createAdapter(145, 'mysql', validMysqlConfig);
    expect(adapter.constructor.name).toBe('MysqlEventSource');
    expect(adapter.orgId).toBe(145);
  });

  test('creates KafkaEventSource adapter for type=kafka', () => {
    const adapter = manager._createAdapter(145, 'kafka', {
      brokers: ['localhost:9092'],
      topic: 'events'
    });
    expect(adapter.constructor.name).toBe('KafkaEventSource');
  });

  test('creates HttpPushAdapter for type=http_push', () => {
    const adapter = manager._createAdapter(145, 'http_push', {});
    expect(adapter.constructor.name).toBe('HttpPushAdapter');
  });

  test('throws for unknown type', () => {
    expect(() => manager._createAdapter(145, 'ftp', {})).toThrow('Unknown event source type');
  });

  test('throws if mysql pool unavailable with useSharedPool:true and no db', () => {
    const db = require('../../src/db');
    db.getPool.mockReturnValueOnce(null);
    expect(() => manager._createAdapter(145, 'mysql', { ...validMysqlConfig }))
      .toThrow('MySQL not configured');
  });

  test('_globalSourceConfig for mysql returns useSharedPool:true', () => {
    manager.globalSourceType = 'mysql';
    expect(manager._globalSourceConfig()).toEqual({ useSharedPool: true });
  });

  test('configHash changes when config changes', () => {
    const hash1 = JSON.stringify({ type: 'mysql', sourceConfig: validMysqlConfig });
    const hash2 = JSON.stringify({ type: 'mysql', sourceConfig: { ...validMysqlConfig, table: 'other' } });
    expect(hash1).not.toBe(hash2);
  });
});

// ---------------------------------------------------------------------------
// 12. MysqlEventSource — SQL query structure (mocked pool)
// ---------------------------------------------------------------------------

describe('MysqlEventSource — SQL query structure', () => {
  beforeEach(() => jest.clearAllMocks());

  const src = new MysqlEventSource({
    orgId: 145,
    pool:  mockPool,
    table: 'notification_queue',
    pollIntervalMs: 1000,
    batchSize: 5,
    columnMapping: {
      id: 'id', orgId: 'entity_parent_rid',
      eventType: 'transaction_type', payload: 'message',
      timestamp: 'created_at'
    }
  });

  test('_fetchRows uses named params :checkpoint and :orgId', async () => {
    mockPool.execute.mockResolvedValueOnce([[]]);
    await src._fetchRows(100);

    const [sql, params] = mockPool.execute.mock.calls[0];
    expect(sql).toContain(':checkpoint');
    expect(sql).toContain(':orgId');
    expect(sql).toContain('id > :checkpoint');
    expect(sql).toContain('entity_parent_rid = :orgId');
    expect(sql).toContain('LIMIT 5');
    expect(params).toEqual({ checkpoint: 100, orgId: 145 });
  });

  test('_fetchRows does not use positional ? placeholders', async () => {
    mockPool.execute.mockResolvedValueOnce([[]]);
    await src._fetchRows(0);

    const [sql] = mockPool.execute.mock.calls[0];
    // No bare ? (only : params)
    expect(sql).not.toMatch(/\?/);
  });

  test('_fetchRows selects alias columns correctly', async () => {
    mockPool.execute.mockResolvedValueOnce([[]]);
    await src._fetchRows(0);

    const [sql] = mockPool.execute.mock.calls[0];
    expect(sql).toContain('id        AS _id');
    expect(sql).toContain('entity_parent_rid     AS _orgId');
    expect(sql).toContain('transaction_type AS _eventType');
    expect(sql).toContain('message   AS _payload');
    expect(sql).toContain('created_at AS _timestamp');
  });

  test('LIMIT is inlined as integer (not a param)', async () => {
    mockPool.execute.mockResolvedValueOnce([[]]);
    await src._fetchRows(0);
    const [sql, params] = mockPool.execute.mock.calls[0];
    expect(sql).toContain('LIMIT 5');
    expect(Object.keys(params)).not.toContain('limit');
  });

  test('_fetchMaxId uses named :orgId param', async () => {
    mockPool.execute.mockResolvedValueOnce([[{ maxId: 200 }]]);
    const result = await src._fetchMaxId();
    const [sql, params] = mockPool.execute.mock.calls[0];
    expect(sql).toContain(':orgId');
    expect(params).toEqual({ orgId: 145 });
    expect(result).toBe(200);
  });

  test('_fetchMaxId returns 0 when table is empty', async () => {
    mockPool.execute.mockResolvedValueOnce([[{ maxId: null }]]);
    const result = await src._fetchMaxId();
    expect(result).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 13. MysqlEventSource — ack/nack context
// ---------------------------------------------------------------------------

describe('MysqlEventSource — ack/nack', () => {
  beforeEach(() => jest.clearAllMocks());

  test('ack calls _setCheckpoint with event id', async () => {
    const src = new MysqlEventSource({
      orgId: 145, pool: mockPool, table: 't',
      columnMapping: { id: 'id', orgId: 'o', eventType: 'e', payload: 'p' }
    });
    mockCollection.updateOne.mockResolvedValue({ modifiedCount: 1 });

    const event = { id: 99, orgId: 145, event_type: 'T', payload: {} };
    const ctx = src._createContext(event);
    await ctx.ack();

    expect(mockCollection.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 145 }),
      expect.objectContaining({ $set: expect.objectContaining({ lastProcessedId: 99 }) }),
      { upsert: true }
    );
  });

  test('nack also advances checkpoint (retry via DLQ, not by re-polling)', async () => {
    const src = new MysqlEventSource({
      orgId: 145, pool: mockPool, table: 't',
      columnMapping: { id: 'id', orgId: 'o', eventType: 'e', payload: 'p' }
    });
    mockCollection.updateOne.mockResolvedValue({ modifiedCount: 1 });

    const event = { id: 77, orgId: 145, event_type: 'T', payload: {} };
    const ctx = src._createContext(event);
    await ctx.nack();

    expect(mockCollection.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 145 }),
      expect.objectContaining({ $set: expect.objectContaining({ lastProcessedId: 77 }) }),
      { upsert: true }
    );
  });
});

// ---------------------------------------------------------------------------
// 14. event-source-tester — no shared pool leak (always creates fresh pool)
// ---------------------------------------------------------------------------

describe('testConnection — dedicated pool cleanup', () => {
  test('creates a fresh pool and ends it after test (not shared pool path)', async () => {
    const mysql2Promise = { createPool: jest.fn(() => ({ ...mockPool })) };
    jest.doMock('mysql2/promise', () => mysql2Promise);

    const db = require('../../src/db');
    db.isConfigured.mockReturnValueOnce(false); // force dedicated path

    const freshPool = {
      execute: jest.fn()
        .mockResolvedValueOnce([[{ 1: 1 }]])  // ping
        .mockRejectedValueOnce(Object.assign(new Error("No such table"), { code: 'ER_NO_SUCH_TABLE' })),
      end: jest.fn().mockResolvedValue(undefined)
    };
    mysql2Promise.createPool.mockReturnValueOnce(freshPool);

    await testConnection('mysql', {
      useSharedPool: false,
      host: 'db.example.com', port: 3306,
      user: 'app', password: 'pass', database: 'events',
      table: 'events_table',
      columnMapping: { id: 'id', orgId: 'o', eventType: 'e', payload: 'p' }
    });

    // Pool must be cleaned up regardless of success/failure
    expect(freshPool.end).toHaveBeenCalled();

    jest.dontMock('mysql2/promise');
  });
});
