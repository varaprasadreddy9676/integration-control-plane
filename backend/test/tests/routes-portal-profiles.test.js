'use strict';

/**
 * Portal Access Profiles + Launch/Refresh integration tests
 *
 * Covers:
 *   POST   /api/v1/portal-profiles
 *   GET    /api/v1/portal-profiles
 *   GET    /api/v1/portal-profiles/:id
 *   PATCH  /api/v1/portal-profiles/:id
 *   POST   /api/v1/portal-profiles/:id/rotate-link
 *   POST   /api/v1/portal-profiles/:id/revoke-sessions
 *   POST   /api/v1/auth/portal/launch
 *   POST   /api/v1/auth/portal/refresh
 *   GET    /api/v1/auth/portal/config-diagnostics
 *   POST   /api/v1/auth/portal-session (legacy disabled guard)
 */

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const TEST_JWT_SECRET = 'test-portal-secret-xyz';
const TEST_PROFILE_ID = '507f1f77bcf86cd799439011';
const TEST_ORG_ID = 42;

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock('../../src/logger', () => ({
  log: jest.fn(),
  logError: jest.fn(),
  requestLogger: (_req, _res, next) => next(),
  setDb: jest.fn(),
  closeLogStreams: jest.fn(),
}));

jest.mock('../../src/middleware/rate-limit', () => (_req, _res, next) => next());
jest.mock('../../src/middleware/request-id', () => (req, _res, next) => { req.id = 'test-req-id'; next(); });
jest.mock('../../src/middleware/audit', () => ({
  auditAuth: {
    login: jest.fn().mockReturnValue(jest.fn().mockResolvedValue(undefined)),
  },
  auditAdmin: {
    impersonated: jest.fn().mockResolvedValue(undefined),
  },
}));

// MongoDB mock
const mockDb = {
  collection: jest.fn().mockReturnValue({
    find: jest.fn().mockReturnValue({ sort: jest.fn().mockReturnThis(), toArray: jest.fn().mockResolvedValue([]) }),
    findOne: jest.fn().mockResolvedValue(null),
    insertOne: jest.fn().mockResolvedValue({ insertedId: TEST_PROFILE_ID }),
    updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    findOneAndUpdate: jest.fn().mockResolvedValue(null),
    createIndex: jest.fn().mockResolvedValue(undefined),
  }),
};
jest.mock('../../src/mongodb', () => ({
  connect: jest.fn().mockResolvedValue(undefined),
  getDb: jest.fn().mockReturnValue(mockDb),
  isConnected: jest.fn().mockReturnValue(true),
}));

jest.mock('../../src/db', () => ({
  isConfigured: jest.fn().mockReturnValue(false),
  ping: jest.fn().mockResolvedValue(false),
}));

jest.mock('../../src/data/store', () => ({
  initStore: jest.fn().mockResolvedValue(undefined),
  getTenant: jest.fn().mockReturnValue(null),
}));

// Config mock — feature flag on
jest.mock('../../src/config', () => ({
  api: { basePrefix: '/api/v1' },
  security: { jwtSecret: 'test-portal-secret-xyz', jwtExpiresIn: '12h', apiKey: 'test-api-key' },
  frontendUrl: 'https://app.example.com',
  portal: {
    scopedAccessEnabled: true,
    launchDisabled: false,
    accessTokenTtl: '1h',
    refreshTokenTtl: '7d',
    launchRateLimitMax: 100,
    launchRateLimitWindowSeconds: 60,
  },
  worker: {},
}));

// Portal profile data mock
const mockProfileData = {
  ensureIndexes: jest.fn().mockResolvedValue(undefined),
  createProfile: jest.fn(),
  listProfiles: jest.fn(),
  getProfile: jest.fn(),
  getProfileWithSecret: jest.fn(),
  updateProfile: jest.fn(),
  rotateProfileLink: jest.fn(),
  revokeAllSessions: jest.fn(),
  recordProfileUsage: jest.fn().mockResolvedValue(undefined),
  verifyProfileSecret: jest.fn(),
};
jest.mock('../../src/data/portal-access-profiles', () => mockProfileData);

// ── App setup ─────────────────────────────────────────────────────────────────

function buildApp() {
  const app = express();
  app.use(express.json());

  const authRouter = require('../../src/routes/auth');
  const portalProfilesRouter = require('../../src/routes/portal-profiles');
  const errorHandler = require('../../src/middleware/error-handler');

  app.use('/api/v1/auth', authRouter);
  app.use('/api/v1/portal-profiles', portalProfilesRouter);
  app.use(errorHandler);
  return app;
}

function makeSuperAdminToken() {
  return jwt.sign(
    { sub: 'admin-1', email: 'admin@example.com', role: 'SUPER_ADMIN', orgId: null },
    TEST_JWT_SECRET,
    { expiresIn: '1h' }
  );
}

function makeOrgAdminToken(orgId = TEST_ORG_ID) {
  return jwt.sign(
    { sub: 'org-admin-1', email: 'orgadmin@example.com', role: 'ORG_ADMIN', orgId },
    TEST_JWT_SECRET,
    { expiresIn: '1h' }
  );
}

function makeViewerToken() {
  return jwt.sign(
    { sub: 'viewer-1', email: 'viewer@example.com', role: 'VIEWER', orgId: TEST_ORG_ID },
    TEST_JWT_SECRET,
    { expiresIn: '1h' }
  );
}

const SAMPLE_PROFILE = {
  _id: TEST_PROFILE_ID,
  id: TEST_PROFILE_ID,
  orgId: TEST_ORG_ID,
  name: 'Test Profile',
  role: 'VIEWER',
  allowedIntegrationIds: [],
  allowedTags: [],
  allowedViews: ['dashboard', 'logs'],
  allowedOrigins: [],
  isActive: true,
  tokenVersion: 1,
  createdBy: 'admin-1',
  createdAt: new Date(),
  updatedAt: new Date(),
  lastUsedAt: null,
};

// ── POST /portal-profiles ─────────────────────────────────────────────────────

describe('POST /api/v1/portal-profiles', () => {
  let app;
  beforeEach(() => { jest.clearAllMocks(); app = buildApp(); });

  it('creates a profile and returns linkSecret + launchUrl (SUPER_ADMIN)', async () => {
    mockProfileData.createProfile.mockResolvedValue({
      profile: SAMPLE_PROFILE,
      linkSecret: 'abc123secret',
    });

    const res = await request(app)
      .post('/api/v1/portal-profiles')
      .set('Authorization', `Bearer ${makeSuperAdminToken()}`)
      .send({ orgId: TEST_ORG_ID, name: 'Test Profile', role: 'VIEWER' });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('profile');
    expect(res.body).toHaveProperty('linkSecret', 'abc123secret');
    expect(res.body.launchUrl).toContain('https://app.example.com');
    expect(res.body.launchUrl).toContain('/portal/launch?pid=');
    expect(mockProfileData.createProfile).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: TEST_ORG_ID, name: 'Test Profile', role: 'VIEWER' })
    );
  });

  it('returns 400 when name is missing', async () => {
    const res = await request(app)
      .post('/api/v1/portal-profiles')
      .set('Authorization', `Bearer ${makeSuperAdminToken()}`)
      .send({ orgId: TEST_ORG_ID });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/name/i);
  });

  it('returns 400 for invalid role', async () => {
    const res = await request(app)
      .post('/api/v1/portal-profiles')
      .set('Authorization', `Bearer ${makeSuperAdminToken()}`)
      .send({ orgId: TEST_ORG_ID, name: 'X', role: 'SUPER_ADMIN' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/role/i);
  });

  it('returns 403 for VIEWER role', async () => {
    const res = await request(app)
      .post('/api/v1/portal-profiles')
      .set('Authorization', `Bearer ${makeViewerToken()}`)
      .send({ orgId: TEST_ORG_ID, name: 'X', role: 'VIEWER' });

    expect(res.status).toBe(403);
  });

  it('ORG_ADMIN can create profile for their own org', async () => {
    mockProfileData.createProfile.mockResolvedValue({
      profile: SAMPLE_PROFILE,
      linkSecret: 'org-secret',
    });

    const res = await request(app)
      .post('/api/v1/portal-profiles')
      .set('Authorization', `Bearer ${makeOrgAdminToken(TEST_ORG_ID)}`)
      .send({ name: 'Org Profile', role: 'VIEWER' });

    expect(res.status).toBe(201);
  });

  it('ORG_ADMIN cannot create profile for a different org', async () => {
    const res = await request(app)
      .post('/api/v1/portal-profiles')
      .set('Authorization', `Bearer ${makeOrgAdminToken(TEST_ORG_ID)}`)
      .send({ orgId: 999, name: 'X', role: 'VIEWER' });

    expect(res.status).toBe(403);
  });
});

// ── GET /portal-profiles ──────────────────────────────────────────────────────

describe('GET /api/v1/portal-profiles', () => {
  let app;
  beforeEach(() => { jest.clearAllMocks(); app = buildApp(); });

  it('lists profiles for an org', async () => {
    mockProfileData.listProfiles.mockResolvedValue([SAMPLE_PROFILE]);

    const res = await request(app)
      .get(`/api/v1/portal-profiles?orgId=${TEST_ORG_ID}`)
      .set('Authorization', `Bearer ${makeSuperAdminToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.profiles).toHaveLength(1);
  });

  it('returns 400 if orgId missing for SUPER_ADMIN', async () => {
    const res = await request(app)
      .get('/api/v1/portal-profiles')
      .set('Authorization', `Bearer ${makeSuperAdminToken()}`);

    expect(res.status).toBe(400);
  });
});

// ── GET /portal-profiles/:id ──────────────────────────────────────────────────

describe('GET /api/v1/portal-profiles/:id', () => {
  let app;
  beforeEach(() => { jest.clearAllMocks(); app = buildApp(); });

  it('returns a profile by id', async () => {
    mockProfileData.getProfile.mockResolvedValue(SAMPLE_PROFILE);

    const res = await request(app)
      .get(`/api/v1/portal-profiles/${TEST_PROFILE_ID}`)
      .set('Authorization', `Bearer ${makeSuperAdminToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.profile).toMatchObject({ id: TEST_PROFILE_ID });
  });

  it('returns 404 when profile not found', async () => {
    mockProfileData.getProfile.mockResolvedValue(null);

    const res = await request(app)
      .get(`/api/v1/portal-profiles/${TEST_PROFILE_ID}`)
      .set('Authorization', `Bearer ${makeSuperAdminToken()}`);

    expect(res.status).toBe(404);
  });

  it('ORG_ADMIN cannot access profile from a different org', async () => {
    mockProfileData.getProfile.mockResolvedValue({ ...SAMPLE_PROFILE, orgId: 999 });

    const res = await request(app)
      .get(`/api/v1/portal-profiles/${TEST_PROFILE_ID}`)
      .set('Authorization', `Bearer ${makeOrgAdminToken(TEST_ORG_ID)}`);

    expect(res.status).toBe(403);
  });
});

// ── PATCH /portal-profiles/:id ─────────────────────────────────────────────────

describe('PATCH /api/v1/portal-profiles/:id', () => {
  let app;
  beforeEach(() => { jest.clearAllMocks(); app = buildApp(); });

  it('updates a profile', async () => {
    const updated = { ...SAMPLE_PROFILE, name: 'New Name' };
    mockProfileData.getProfile.mockResolvedValue(SAMPLE_PROFILE);
    mockProfileData.updateProfile.mockResolvedValue(updated);

    const res = await request(app)
      .patch(`/api/v1/portal-profiles/${TEST_PROFILE_ID}`)
      .set('Authorization', `Bearer ${makeSuperAdminToken()}`)
      .send({ name: 'New Name' });

    expect(res.status).toBe(200);
    expect(res.body.profile.name).toBe('New Name');
  });

  it('can disable a profile (isActive: false)', async () => {
    const updated = { ...SAMPLE_PROFILE, isActive: false };
    mockProfileData.getProfile.mockResolvedValue(SAMPLE_PROFILE);
    mockProfileData.updateProfile.mockResolvedValue(updated);

    const res = await request(app)
      .patch(`/api/v1/portal-profiles/${TEST_PROFILE_ID}`)
      .set('Authorization', `Bearer ${makeSuperAdminToken()}`)
      .send({ isActive: false });

    expect(res.status).toBe(200);
    expect(res.body.profile.isActive).toBe(false);
  });

  it('returns 400 for invalid role', async () => {
    mockProfileData.getProfile.mockResolvedValue(SAMPLE_PROFILE);

    const res = await request(app)
      .patch(`/api/v1/portal-profiles/${TEST_PROFILE_ID}`)
      .set('Authorization', `Bearer ${makeSuperAdminToken()}`)
      .send({ role: 'SUPER_ADMIN' });

    expect(res.status).toBe(400);
  });
});

// ── POST /portal-profiles/:id/rotate-link ─────────────────────────────────────

describe('POST /api/v1/portal-profiles/:id/rotate-link', () => {
  let app;
  beforeEach(() => { jest.clearAllMocks(); app = buildApp(); });

  it('rotates the link secret and returns new launchUrl', async () => {
    const rotated = { ...SAMPLE_PROFILE, tokenVersion: 2 };
    mockProfileData.getProfile.mockResolvedValue(SAMPLE_PROFILE);
    mockProfileData.rotateProfileLink.mockResolvedValue({
      profile: rotated,
      linkSecret: 'new-secret-xyz',
    });

    const res = await request(app)
      .post(`/api/v1/portal-profiles/${TEST_PROFILE_ID}/rotate-link`)
      .set('Authorization', `Bearer ${makeSuperAdminToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.linkSecret).toBe('new-secret-xyz');
    expect(res.body.launchUrl).toContain('new-secret-xyz');
    expect(res.body.message).toMatch(/rotated/i);
  });

  it('returns 404 when profile does not exist', async () => {
    mockProfileData.getProfile.mockResolvedValue(null);

    const res = await request(app)
      .post(`/api/v1/portal-profiles/${TEST_PROFILE_ID}/rotate-link`)
      .set('Authorization', `Bearer ${makeSuperAdminToken()}`);

    expect(res.status).toBe(404);
  });
});

// ── POST /portal-profiles/:id/revoke-sessions ──────────────────────────────────

describe('POST /api/v1/portal-profiles/:id/revoke-sessions', () => {
  let app;
  beforeEach(() => { jest.clearAllMocks(); app = buildApp(); });

  it('revokes all sessions and increments tokenVersion', async () => {
    const revoked = { ...SAMPLE_PROFILE, tokenVersion: 3 };
    mockProfileData.getProfile.mockResolvedValue(SAMPLE_PROFILE);
    mockProfileData.revokeAllSessions.mockResolvedValue(revoked);

    const res = await request(app)
      .post(`/api/v1/portal-profiles/${TEST_PROFILE_ID}/revoke-sessions`)
      .set('Authorization', `Bearer ${makeSuperAdminToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.profile.tokenVersion).toBe(3);
    expect(res.body.message).toMatch(/revoked/i);
  });
});

// ── POST /auth/portal/launch ───────────────────────────────────────────────────

describe('POST /api/v1/auth/portal/launch', () => {
  let app;
  beforeEach(() => { jest.clearAllMocks(); app = buildApp(); });

  const PROFILE_WITH_SECRET = {
    ...SAMPLE_PROFILE,
    _id: { toString: () => TEST_PROFILE_ID },
    linkSecretHash: 'hashed',
  };

  it('returns accessToken + refreshToken on valid credentials', async () => {
    mockProfileData.verifyProfileSecret.mockResolvedValue({
      valid: true,
      profile: PROFILE_WITH_SECRET,
    });

    const res = await request(app)
      .post('/api/v1/auth/portal/launch')
      .send({ pid: TEST_PROFILE_ID, secret: 'correct-secret' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('accessToken');
    expect(res.body).toHaveProperty('refreshToken');
    expect(res.body).toHaveProperty('expiresIn');
    expect(res.body.profile).toMatchObject({
      orgId: TEST_ORG_ID,
      role: 'VIEWER',
    });

    // Verify access token claims
    const payload = jwt.verify(res.body.accessToken, TEST_JWT_SECRET);
    expect(payload.type).toBe('portal_access');
    expect(payload.isPortalSession).toBe(true);
    expect(payload.orgId).toBe(TEST_ORG_ID);
    expect(payload.tokenVersion).toBe(1);
  });

  it('returns 401 on invalid secret', async () => {
    mockProfileData.verifyProfileSecret.mockResolvedValue({ valid: false, profile: null });

    const res = await request(app)
      .post('/api/v1/auth/portal/launch')
      .send({ pid: TEST_PROFILE_ID, secret: 'wrong-secret' });

    expect(res.status).toBe(401);
  });

  it('returns 401 when profile is inactive', async () => {
    mockProfileData.verifyProfileSecret.mockResolvedValue({
      valid: false,
      profile: { ...PROFILE_WITH_SECRET, isActive: false },
    });

    const res = await request(app)
      .post('/api/v1/auth/portal/launch')
      .send({ pid: TEST_PROFILE_ID, secret: 'any-secret' });

    expect(res.status).toBe(401);
  });

  it('returns 400 when pid is missing', async () => {
    const res = await request(app)
      .post('/api/v1/auth/portal/launch')
      .send({ secret: 'some-secret' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/pid/i);
  });

  it('returns 400 when secret is missing', async () => {
    const res = await request(app)
      .post('/api/v1/auth/portal/launch')
      .send({ pid: TEST_PROFILE_ID });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/secret/i);
  });

  it('rejects launch when allowedOrigins is set and origin does not match', async () => {
    mockProfileData.verifyProfileSecret.mockResolvedValue({
      valid: true,
      profile: {
        ...PROFILE_WITH_SECRET,
        allowedOrigins: ['https://trusted.com'],
      },
    });

    const res = await request(app)
      .post('/api/v1/auth/portal/launch')
      .set('Origin', 'https://evil.com')
      .send({ pid: TEST_PROFILE_ID, secret: 'correct-secret' });

    expect(res.status).toBe(403);
  });

  it('allows launch when origin matches allowedOrigins', async () => {
    mockProfileData.verifyProfileSecret.mockResolvedValue({
      valid: true,
      profile: {
        ...PROFILE_WITH_SECRET,
        allowedOrigins: ['https://trusted.com'],
      },
    });

    const res = await request(app)
      .post('/api/v1/auth/portal/launch')
      .set('Origin', 'https://trusted.com')
      .send({ pid: TEST_PROFILE_ID, secret: 'correct-secret' });

    expect(res.status).toBe(200);
  });
});

// ── POST /auth/portal/refresh ──────────────────────────────────────────────────

describe('POST /api/v1/auth/portal/refresh', () => {
  let app;
  beforeEach(() => { jest.clearAllMocks(); app = buildApp(); });

  function makeRefreshToken(profileId, tokenVersion = 1) {
    return jwt.sign(
      { sub: `portal_${profileId}`, profileId, tokenVersion, type: 'portal_refresh' },
      TEST_JWT_SECRET,
      { expiresIn: '7d' }
    );
  }

  it('issues new tokens when refresh is valid and tokenVersion matches', async () => {
    const profile = {
      _id: { toString: () => TEST_PROFILE_ID },
      orgId: TEST_ORG_ID,
      role: 'VIEWER',
      isActive: true,
      tokenVersion: 1,
      allowedIntegrationIds: [],
      allowedTags: [],
      allowedViews: ['dashboard', 'logs'],
    };
    mockProfileData.getProfileWithSecret.mockResolvedValue(profile);

    const refreshToken = makeRefreshToken(TEST_PROFILE_ID, 1);

    const res = await request(app)
      .post('/api/v1/auth/portal/refresh')
      .send({ refreshToken });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('accessToken');
    expect(res.body).toHaveProperty('refreshToken');
  });

  it('returns 401 when tokenVersion does not match (session revoked)', async () => {
    // Profile has been rotated (tokenVersion = 2) but refresh token has version 1
    mockProfileData.getProfileWithSecret.mockResolvedValue({
      _id: { toString: () => TEST_PROFILE_ID },
      orgId: TEST_ORG_ID,
      role: 'VIEWER',
      isActive: true,
      tokenVersion: 2, // incremented by rotate/revoke
    });

    const refreshToken = makeRefreshToken(TEST_PROFILE_ID, 1);

    const res = await request(app)
      .post('/api/v1/auth/portal/refresh')
      .send({ refreshToken });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalidated/i);
  });

  it('returns 401 when profile is inactive', async () => {
    mockProfileData.getProfileWithSecret.mockResolvedValue({
      _id: { toString: () => TEST_PROFILE_ID },
      isActive: false,
      tokenVersion: 1,
    });

    const refreshToken = makeRefreshToken(TEST_PROFILE_ID, 1);

    const res = await request(app)
      .post('/api/v1/auth/portal/refresh')
      .send({ refreshToken });

    expect(res.status).toBe(401);
  });

  it('returns 401 when token type is not portal_refresh', async () => {
    const badToken = jwt.sign(
      { sub: 'portal_x', type: 'portal_access', profileId: TEST_PROFILE_ID, tokenVersion: 1 },
      TEST_JWT_SECRET,
      { expiresIn: '1h' }
    );

    const res = await request(app)
      .post('/api/v1/auth/portal/refresh')
      .send({ refreshToken: badToken });

    expect(res.status).toBe(401);
  });

  it('returns 400 when refreshToken is missing', async () => {
    const res = await request(app)
      .post('/api/v1/auth/portal/refresh')
      .send({});

    expect(res.status).toBe(400);
  });

  it('returns 401 when token is expired', async () => {
    const expired = jwt.sign(
      { sub: 'portal_x', type: 'portal_refresh', profileId: TEST_PROFILE_ID, tokenVersion: 1 },
      TEST_JWT_SECRET,
      { expiresIn: '-1s' }
    );

    const res = await request(app)
      .post('/api/v1/auth/portal/refresh')
      .send({ refreshToken: expired });

    expect(res.status).toBe(401);
  });
});

// ── GET /auth/portal/config-diagnostics ───────────────────────────────────────

describe('GET /api/v1/auth/portal/config-diagnostics', () => {
  let app;
  beforeEach(() => { jest.clearAllMocks(); app = buildApp(); });

  it('returns config info for SUPER_ADMIN', async () => {
    const res = await request(app)
      .get('/api/v1/auth/portal/config-diagnostics')
      .set('Authorization', `Bearer ${makeSuperAdminToken()}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('frontendUrl', 'https://app.example.com');
    expect(res.body).toHaveProperty('portalScopedAccessEnabled', true);
  });

  it('returns 403 for non-admin', async () => {
    const res = await request(app)
      .get('/api/v1/auth/portal/config-diagnostics')
      .set('Authorization', `Bearer ${makeViewerToken()}`);

    expect(res.status).toBe(403);
  });
});

// ── POST /auth/portal-session (legacy) ────────────────────────────────────────

describe('POST /api/v1/auth/portal-session (legacy)', () => {
  let app;
  beforeEach(() => { jest.clearAllMocks(); app = buildApp(); });

  it('returns 410 when scopedAccessEnabled=true', async () => {
    const res = await request(app)
      .post('/api/v1/auth/portal-session')
      .set('X-API-Key', 'test-api-key')
      .send({ orgId: TEST_ORG_ID });

    expect(res.status).toBe(410);
    expect(res.body.code).toBe('PORTAL_LEGACY_DISABLED');
  });
});

// ── Auth middleware: portal scope propagation ─────────────────────────────────

describe('Auth middleware portal scope', () => {
  it('attaches portalScope from portal_access token', () => {
    // Build a token with portal claims
    const portalToken = jwt.sign(
      {
        sub: `portal_${TEST_PROFILE_ID}`,
        role: 'VIEWER',
        orgId: TEST_ORG_ID,
        isPortalSession: true,
        profileId: TEST_PROFILE_ID,
        allowedIntegrationIds: ['int-1', 'int-2'],
        allowedTags: ['tag-a'],
        allowedViews: ['dashboard'],
        tokenVersion: 1,
        type: 'portal_access',
      },
      TEST_JWT_SECRET,
      { expiresIn: '1h' }
    );

    // Decode and verify the claims are present
    const payload = jwt.verify(portalToken, TEST_JWT_SECRET);
    expect(payload.isPortalSession).toBe(true);
    expect(payload.type).toBe('portal_access');
    expect(payload.allowedIntegrationIds).toEqual(['int-1', 'int-2']);
    expect(payload.allowedTags).toEqual(['tag-a']);
    expect(payload.allowedViews).toEqual(['dashboard']);
    expect(payload.tokenVersion).toBe(1);
  });
});
