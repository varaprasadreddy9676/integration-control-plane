'use strict';

/**
 * Auth route integration tests
 * Tests POST /api/v1/auth/login and GET /api/v1/auth/me
 */

const express = require('express');
const request = require('supertest');

// --- Module-level mocks (must be hoisted before any require) ---

const mockDb = {
  collection: jest.fn().mockReturnValue({
    find: jest.fn().mockReturnValue({ sort: jest.fn().mockReturnThis(), toArray: jest.fn().mockResolvedValue([]) }),
    findOne: jest.fn().mockResolvedValue(null),
    insertOne: jest.fn().mockResolvedValue({ insertedId: 'mock_id' }),
    updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1, matchedCount: 1 }),
    deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }),
    countDocuments: jest.fn().mockResolvedValue(0)
  })
};

jest.mock('../../src/mongodb', () => ({
  connect: jest.fn().mockResolvedValue(undefined),
  getDb: jest.fn().mockReturnValue(mockDb),
  getDbSafe: jest.fn().mockResolvedValue(mockDb),
  isConnected: jest.fn().mockReturnValue(true),
  toObjectId: jest.fn((id) => (id ? { toString: () => String(id), _bsontype: 'ObjectId' } : null)),
  ObjectId: class MockObjectId {
    constructor(id) { this.id = id; }
    toString() { return String(this.id); }
  }
}));

jest.mock('../../src/db', () => ({
  isConfigured: jest.fn().mockReturnValue(false),
  ping: jest.fn().mockResolvedValue(false)
}));

jest.mock('../../src/data/store', () => ({
  initStore: jest.fn().mockResolvedValue(undefined),
  getTenant: jest.fn().mockReturnValue(null)
}));

jest.mock('../../src/logger', () => ({
  log: jest.fn(),
  logError: jest.fn(),
  requestLogger: (_req, _res, next) => next(),
  setDb: jest.fn(),
  closeLogStreams: jest.fn()
}));

jest.mock('../../src/middleware/rate-limit', () => (_req, _res, next) => next());
jest.mock('../../src/middleware/request-id', () => (req, _res, next) => { req.id = 'test-req-id'; next(); });
jest.mock('../../src/middleware/audit', () => ({
  auditAuth: {
    login: jest.fn().mockReturnValue(jest.fn().mockResolvedValue(undefined)),
    logout: jest.fn().mockReturnValue(jest.fn().mockResolvedValue(undefined))
  },
  auditAdmin: {
    userCreated: jest.fn().mockReturnValue(jest.fn().mockResolvedValue(undefined)),
    userUpdated: jest.fn().mockReturnValue(jest.fn().mockResolvedValue(undefined))
  }
}));

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const TEST_JWT_SECRET = 'test-secret-12345';

// Override config before loading auth route
jest.mock('../../src/config', () => ({
  api: { basePrefix: '/api/v1' },
  security: {
    jwtSecret: 'test-secret-12345',
    jwtExpiresIn: '12h',
    apiKey: 'test-api-key'
  },
  worker: {}
}));

function buildAuthApp() {
  const app = express();
  app.use(express.json());

  const authRouter = require('../../src/routes/auth');
  const auth = require('../../src/middleware/auth');
  const errorHandler = require('../../src/middleware/error-handler');

  app.use('/api/v1/auth', authRouter);
  app.use('/api/v1/protected', auth, (_req, res) => res.json({ ok: true }));
  app.use(errorHandler);
  return app;
}

describe('POST /api/v1/auth/login', () => {
  let app;
  let data;

  beforeEach(() => {
    jest.clearAllMocks();
    app = buildAuthApp();
    data = require('../../src/data');
  });

  it('returns 400 when email is missing', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ password: 'pass123' });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 400 when password is missing', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'user@example.com' });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 401 when user does not exist', async () => {
    data.getUserByEmail = jest.fn().mockResolvedValue(null);

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@example.com', password: 'wrong' });

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 401 when password is wrong', async () => {
    const passwordHash = await bcrypt.hash('correct-password', 10);
    data.getUserByEmail = jest.fn().mockResolvedValue({
      _id: { toString: () => 'user-123' },
      email: 'user@example.com',
      role: 'ORG_ADMIN',
      orgId: 1,
      isActive: true,
      passwordHash
    });

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'user@example.com', password: 'wrong-password' });

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 200 with accessToken on valid credentials', async () => {
    const passwordHash = await bcrypt.hash('correct-password', 10);
    data.getUserByEmail = jest.fn().mockResolvedValue({
      _id: { toString: () => 'user-123' },
      email: 'user@example.com',
      role: 'ORG_ADMIN',
      orgId: 1,
      isActive: true,
      passwordHash
    });
    data.setUserLastLogin = jest.fn().mockResolvedValue(undefined);

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'user@example.com', password: 'correct-password' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('accessToken');

    // Verify JWT is valid
    const decoded = jwt.verify(res.body.accessToken, TEST_JWT_SECRET);
    expect(decoded.email).toBe('user@example.com');
    expect(decoded.role).toBe('ORG_ADMIN');
  });

  it('returns 401 when user is inactive', async () => {
    const passwordHash = await bcrypt.hash('password', 10);
    data.getUserByEmail = jest.fn().mockResolvedValue({
      _id: { toString: () => 'user-123' },
      email: 'inactive@example.com',
      role: 'ORG_ADMIN',
      orgId: 1,
      isActive: false,
      passwordHash
    });

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'inactive@example.com', password: 'password' });

    expect(res.status).toBe(401);
  });
});

describe('GET /api/v1/auth/me', () => {
  let app;
  let data;

  beforeEach(() => {
    jest.clearAllMocks();
    app = buildAuthApp();
    data = require('../../src/data');
  });

  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/v1/auth/me');
    expect(res.status).toBe(401);
  });

  it('returns 401 with invalid token', async () => {
    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', 'Bearer invalid.jwt.token');
    expect(res.status).toBe(401);
  });

  it('returns 200 with valid JWT token', async () => {
    const token = jwt.sign(
      { sub: 'user-123', email: 'user@example.com', role: 'ORG_ADMIN', orgId: 1 },
      TEST_JWT_SECRET,
      { expiresIn: '1h' }
    );

    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    // /me returns req.user set from JWT payload
    expect(res.body).toHaveProperty('user');
    expect(res.body.user).toHaveProperty('email', 'user@example.com');
  });
});
