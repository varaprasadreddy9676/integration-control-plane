'use strict';

/**
 * Users route integration tests
 * Tests CRUD operations for /api/v1/users
 */

const express = require('express');
const request = require('supertest');

const mockUserDoc = {
  _id: { toString: () => 'user-123' },
  email: 'user@example.com',
  name: 'Test User',
  role: 'ORG_ADMIN',
  orgId: 1,
  permissions: ['users:view'],
  isActive: true,
  createdAt: new Date(),
  passwordHash: '$2a$10$fakehash'
};

jest.mock('../../src/mongodb', () => ({
  getDb: jest.fn(),
  getDbSafe: jest.fn(),
  isConnected: jest.fn(() => true),
  toObjectId: jest.fn((id) => (id ? { toString: () => String(id) } : null))
}));

jest.mock('../../src/db', () => ({
  isConfigured: jest.fn(() => false),
  ping: jest.fn(async () => false)
}));

jest.mock('../../src/data/store', () => ({
  initStore: jest.fn(async () => {}),
  getTenant: jest.fn(() => null),
  findTenantByChildRid: jest.fn(() => null)
}));

jest.mock('../../src/logger', () => ({
  log: jest.fn(),
  logError: jest.fn(),
  requestLogger: (_req, _res, next) => next(),
  setDb: jest.fn(),
  closeLogStreams: jest.fn()
}));

jest.mock('../../src/config', () => ({
  api: { basePrefix: '/api/v1' },
  security: { jwtSecret: 'test-secret', apiKey: 'test-api-key' },
  worker: {}
}));

jest.mock('../../src/middleware/rate-limit', () => (_req, _res, next) => next());
jest.mock('../../src/middleware/request-id', () => (req, _res, next) => { req.id = 'req-test-id'; next(); });

jest.mock('../../src/middleware/auth', () => (req, _res, next) => {
  req.user = { id: 'admin-user', role: 'SUPER_ADMIN', orgId: 1 };
  req.orgId = 1;
  next();
});

jest.mock('../../src/middleware/permission', () => ({
  requirePermission: () => (_req, _res, next) => next(),
  requireAdmin: () => (_req, _res, next) => next()
}));

jest.mock('../../src/middleware/audit', () => ({
  auditUser: {
    created: jest.fn(async () => {}),
    updated: jest.fn(async () => {}),
    deleted: jest.fn(async () => {})
  },
  auditAdmin: {
    passwordChanged: jest.fn(async () => {})
  }
}));

jest.mock('../../src/rbac/permissions', () => ({
  ROLES: {
    SUPER_ADMIN: { name: 'Super Admin' },
    ADMIN: { name: 'Admin' },
    ORG_ADMIN: { name: 'Org Admin' },
    ORG_USER: { name: 'Org User' }
  },
  getAllPermissions: jest.fn(() => ({
    'users:view': 'View users',
    'users:create': 'Create users',
    'users:edit': 'Edit users',
    'users:delete': 'Delete users'
  })),
  getAllRoles: jest.fn(() => ({
    SUPER_ADMIN: { name: 'Super Admin' },
    ADMIN: { name: 'Admin' },
    ORG_ADMIN: { name: 'Org Admin' }
  })),
  getUserPermissions: jest.fn(() => ['users:view', 'users:create'])
}));

const mockData = {
  listUsers: jest.fn(async () => ({ users: [mockUserDoc], total: 1 })),
  getUserById: jest.fn(async () => mockUserDoc),
  getUserByEmail: jest.fn(async () => null),
  createUser: jest.fn(async () => ({ insertedId: { toString: () => 'user-456' } })),
  updateUser: jest.fn(async () => ({}))
};
jest.mock('../../src/data', () => mockData);

function buildApp() {
  const app = express();
  app.use(express.json());

  const usersRouter = require('../../src/routes/users');
  const errorHandler = require('../../src/middleware/error-handler');

  app.use('/api/v1/users', usersRouter);
  app.use(errorHandler);
  return app;
}

describe('Users Routes', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = buildApp();
    // Reset mocks to defaults
    mockData.listUsers.mockResolvedValue({ users: [mockUserDoc], total: 1 });
    mockData.getUserById.mockResolvedValue(mockUserDoc);
    mockData.getUserByEmail.mockResolvedValue(null);
    mockData.createUser.mockResolvedValue({ insertedId: { toString: () => 'user-456' } });
    mockData.updateUser.mockResolvedValue({});
  });

  describe('GET /api/v1/users', () => {
    it('returns 200 with list of users', async () => {
      const res = await request(app).get('/api/v1/users');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('users');
      expect(res.body).toHaveProperty('total');
      expect(Array.isArray(res.body.users)).toBe(true);
    });

    it('sanitizes user data (no passwordHash)', async () => {
      const res = await request(app).get('/api/v1/users');
      expect(res.status).toBe(200);
      const user = res.body.users[0];
      expect(user).not.toHaveProperty('passwordHash');
      expect(user).toHaveProperty('id');
      expect(user).toHaveProperty('email');
    });
  });

  describe('POST /api/v1/users', () => {
    it('returns 201 when creating valid user', async () => {
      const res = await request(app)
        .post('/api/v1/users')
        .send({
          email: 'newuser@example.com',
          password: 'SecurePass123',
          name: 'New User',
          role: 'ORG_ADMIN',
          orgId: 1
        });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('id');
      expect(res.body).toHaveProperty('email', 'newuser@example.com');
      expect(res.body).toHaveProperty('role', 'ORG_ADMIN');
    });

    it('returns 400 when email is missing', async () => {
      const res = await request(app)
        .post('/api/v1/users')
        .send({ password: 'SecurePass123', role: 'ORG_ADMIN' });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
    });

    it('returns 400 when password is missing', async () => {
      const res = await request(app)
        .post('/api/v1/users')
        .send({ email: 'test@example.com', role: 'ORG_ADMIN' });

      expect(res.status).toBe(400);
    });

    it('returns 400 when role is invalid', async () => {
      const res = await request(app)
        .post('/api/v1/users')
        .send({ email: 'test@example.com', password: 'Pass123', role: 'INVALID_ROLE' });

      expect(res.status).toBe(400);
    });

    it('returns 400 when user already exists', async () => {
      mockData.getUserByEmail.mockResolvedValueOnce(mockUserDoc);

      const res = await request(app)
        .post('/api/v1/users')
        .send({
          email: 'user@example.com',
          password: 'SecurePass123',
          role: 'ORG_ADMIN',
          orgId: 1
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('already exists');
    });
  });

  describe('GET /api/v1/users/:id', () => {
    it('returns 200 with user details', async () => {
      const res = await request(app).get('/api/v1/users/user-123');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('id');
      expect(res.body).toHaveProperty('email');
      expect(res.body).toHaveProperty('allPermissions');
    });

    it('returns 404 when user not found', async () => {
      mockData.getUserById.mockResolvedValueOnce(null);
      const res = await request(app).get('/api/v1/users/nonexistent');
      expect(res.status).toBe(404);
    });
  });

  describe('PUT /api/v1/users/:id', () => {
    it('returns 200 when updating user name', async () => {
      const res = await request(app)
        .put('/api/v1/users/user-123')
        .send({ name: 'Updated Name' });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('message', 'User updated successfully');
    });

    it('returns 404 when user not found', async () => {
      mockData.getUserById.mockResolvedValueOnce(null);
      const res = await request(app)
        .put('/api/v1/users/nonexistent')
        .send({ name: 'Updated' });

      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /api/v1/users/:id', () => {
    it('returns 200 when deleting user (soft delete)', async () => {
      const res = await request(app).delete('/api/v1/users/user-123');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('message', 'User deleted successfully');
    });

    it('returns 404 when user not found', async () => {
      mockData.getUserById.mockResolvedValueOnce(null);
      const res = await request(app).delete('/api/v1/users/nonexistent');
      expect(res.status).toBe(404);
    });

    it('returns 400 when user tries to delete themselves', async () => {
      mockData.getUserById.mockResolvedValueOnce({
        ...mockUserDoc,
        _id: { toString: () => 'admin-user' }
      });

      const res = await request(app).delete('/api/v1/users/admin-user');
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/v1/users/roles/available', () => {
    it('returns 200 with available roles', async () => {
      const res = await request(app).get('/api/v1/users/roles/available');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('roles');
    });
  });

  describe('GET /api/v1/users/permissions/available', () => {
    it('returns 200 with available permissions', async () => {
      const res = await request(app).get('/api/v1/users/permissions/available');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('permissions');
    });
  });
});
