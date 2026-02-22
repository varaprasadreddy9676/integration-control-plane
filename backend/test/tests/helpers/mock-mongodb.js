'use strict';

/**
 * Shared MongoDB mock factory for route integration tests.
 * Import this in test files to avoid duplicating mock setup.
 */

function createMockCollection(overrides = {}) {
  return {
    find: jest.fn().mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      project: jest.fn().mockReturnThis(),
      toArray: jest.fn().mockResolvedValue([])
    }),
    findOne: jest.fn().mockResolvedValue(null),
    insertOne: jest.fn().mockResolvedValue({ insertedId: 'mock_id_123' }),
    updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1, matchedCount: 1 }),
    updateMany: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }),
    deleteMany: jest.fn().mockResolvedValue({ deletedCount: 1 }),
    countDocuments: jest.fn().mockResolvedValue(0),
    distinct: jest.fn().mockResolvedValue([]),
    aggregate: jest.fn().mockReturnValue({
      toArray: jest.fn().mockResolvedValue([])
    }),
    createIndex: jest.fn().mockResolvedValue('index_created'),
    findOneAndUpdate: jest.fn().mockResolvedValue({ value: null }),
    ...overrides
  };
}

/**
 * Creates a mock MongoDB client with a configurable collection factory.
 * @param {Object} collectionOverrides - Map of collection name → partial mock overrides
 */
function createMockDb(collectionOverrides = {}) {
  const collections = {};

  return {
    collection: jest.fn((name) => {
      if (!collections[name]) {
        collections[name] = createMockCollection(collectionOverrides[name] || {});
      }
      return collections[name];
    }),
    _collections: collections
  };
}

/**
 * Standard jest.mock setup for mongodb module.
 * Call this at module level before requiring any src modules.
 *
 * Usage:
 *   const { mockDb } = setupMongoMock();
 *   jest.mock('../../src/mongodb', () => mockMongoModule);
 */
function buildMongoMockModule(collectionOverrides = {}) {
  const mockDb = createMockDb(collectionOverrides);

  return {
    mockDb,
    mockMongoModule: {
      connect: jest.fn().mockResolvedValue(undefined),
      getDb: jest.fn().mockReturnValue(mockDb),
      getDbSafe: jest.fn().mockResolvedValue(mockDb),
      isConnected: jest.fn().mockReturnValue(true),
      toObjectId: jest.fn((id) => (id ? { toString: () => String(id), _bsontype: 'ObjectId' } : null)),
      ObjectId: class MockObjectId {
        constructor(id) { this.id = id; }
        toString() { return String(this.id); }
      }
    }
  };
}

module.exports = { createMockCollection, createMockDb, buildMongoMockModule };
