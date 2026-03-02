'use strict';

/**
 * Portal Scope Enforcement Unit Tests
 *
 * Tests the portal-scope middleware functions in isolation:
 *   - integrationInScope
 *   - filterIntegrationScope
 *   - assertIntegrationInScope
 *   - assertViewAllowed
 *   - assertPortalNotReadOnly
 *   - isPortalScopedSession
 */

// Mock logger to avoid noise
jest.mock('../../src/logger', () => ({
  log: jest.fn(),
  logError: jest.fn(),
}));

const {
  isPortalScopedSession,
  integrationInScope,
  filterIntegrationScope,
  assertIntegrationInScope,
  assertViewAllowed,
  assertPortalNotReadOnly,
} = require('../../src/middleware/portal-scope');

// ── Fixtures ──────────────────────────────────────────────────────────────────

const makePortalReq = (overrides = {}) => ({
  user: { role: 'VIEWER', isPortalSession: true, orgId: 42, ...overrides.user },
  portalScope: {
    profileId: 'profile-1',
    allowedIntegrationIds: [],
    allowedTags: [],
    allowedViews: ['dashboard', 'logs'],
    tokenVersion: 1,
    ...overrides.portalScope,
  },
  ...overrides,
});

const makeRegularReq = () => ({
  user: { role: 'ORG_ADMIN', isPortalSession: false, orgId: 42 },
  portalScope: undefined,
});

const integration = (id, tags = []) => ({ _id: id, id, orgId: 42, name: `Integration ${id}`, tags });

// ── isPortalScopedSession ─────────────────────────────────────────────────────

describe('isPortalScopedSession', () => {
  it('returns true for portal session with portalScope', () => {
    expect(isPortalScopedSession(makePortalReq())).toBe(true);
  });

  it('returns false for regular user', () => {
    expect(isPortalScopedSession(makeRegularReq())).toBe(false);
  });

  it('returns false when isPortalSession=true but portalScope missing (legacy token)', () => {
    expect(isPortalScopedSession({
      user: { role: 'VIEWER', isPortalSession: true },
      portalScope: undefined,
    })).toBe(false);
  });
});

// ── integrationInScope ────────────────────────────────────────────────────────

describe('integrationInScope', () => {
  it('returns true when no restrictions (both lists empty)', () => {
    const scope = { allowedIntegrationIds: [], allowedTags: [] };
    expect(integrationInScope(scope, integration('int-1'))).toBe(true);
    expect(integrationInScope(scope, integration('int-2', ['tagA']))).toBe(true);
  });

  it('returns true when id is in allowedIntegrationIds', () => {
    const scope = { allowedIntegrationIds: ['int-1', 'int-2'], allowedTags: [] };
    expect(integrationInScope(scope, integration('int-1'))).toBe(true);
    expect(integrationInScope(scope, integration('int-2'))).toBe(true);
  });

  it('returns false when id is NOT in allowedIntegrationIds', () => {
    const scope = { allowedIntegrationIds: ['int-1'], allowedTags: [] };
    expect(integrationInScope(scope, integration('int-3'))).toBe(false);
  });

  it('returns true when tag matches allowedTags', () => {
    const scope = { allowedIntegrationIds: [], allowedTags: ['tagA', 'tagB'] };
    expect(integrationInScope(scope, integration('int-1', ['tagA']))).toBe(true);
    expect(integrationInScope(scope, integration('int-2', ['tagB', 'tagC']))).toBe(true);
  });

  it('returns false when no tags match allowedTags', () => {
    const scope = { allowedIntegrationIds: [], allowedTags: ['tagA'] };
    expect(integrationInScope(scope, integration('int-1', ['tagX']))).toBe(false);
    expect(integrationInScope(scope, integration('int-2', []))).toBe(false);
  });

  it('passes when id matches even if tag list is set', () => {
    const scope = { allowedIntegrationIds: ['int-1'], allowedTags: ['tagZ'] };
    expect(integrationInScope(scope, integration('int-1', ['tagA']))).toBe(true);
  });

  it('passes when tag matches even if id list is set', () => {
    const scope = { allowedIntegrationIds: ['int-99'], allowedTags: ['tagA'] };
    expect(integrationInScope(scope, integration('int-1', ['tagA']))).toBe(true);
  });

  it('returns true when scope is null (no scope at all)', () => {
    expect(integrationInScope(null, integration('int-1'))).toBe(true);
  });
});

// ── filterIntegrationScope ────────────────────────────────────────────────────

describe('filterIntegrationScope', () => {
  const integrations = [
    integration('int-1', ['tagA']),
    integration('int-2', ['tagB']),
    integration('int-3', ['tagC']),
  ];

  it('returns all integrations for non-portal requests', () => {
    expect(filterIntegrationScope(makeRegularReq(), integrations)).toHaveLength(3);
  });

  it('returns all integrations when portal has no restrictions', () => {
    const req = makePortalReq();
    expect(filterIntegrationScope(req, integrations)).toHaveLength(3);
  });

  it('filters by allowedIntegrationIds', () => {
    const req = makePortalReq({
      portalScope: { allowedIntegrationIds: ['int-1', 'int-3'], allowedTags: [], allowedViews: ['dashboard', 'logs'], tokenVersion: 1 },
    });
    const result = filterIntegrationScope(req, integrations);
    expect(result).toHaveLength(2);
    expect(result.map((i) => i.id)).toEqual(['int-1', 'int-3']);
  });

  it('filters by allowedTags', () => {
    const req = makePortalReq({
      portalScope: { allowedIntegrationIds: [], allowedTags: ['tagB', 'tagC'], allowedViews: ['dashboard', 'logs'], tokenVersion: 1 },
    });
    const result = filterIntegrationScope(req, integrations);
    expect(result).toHaveLength(2);
    expect(result.map((i) => i.id)).toContain('int-2');
    expect(result.map((i) => i.id)).toContain('int-3');
  });

  it('returns empty array when no integrations match scope', () => {
    const req = makePortalReq({
      portalScope: { allowedIntegrationIds: ['int-99'], allowedTags: [], allowedViews: ['dashboard', 'logs'], tokenVersion: 1 },
    });
    expect(filterIntegrationScope(req, integrations)).toHaveLength(0);
  });

  it('handles non-array input gracefully', () => {
    const req = makePortalReq();
    expect(filterIntegrationScope(req, null)).toBeNull();
    expect(filterIntegrationScope(req, undefined)).toBeUndefined();
  });
});

// ── assertIntegrationInScope ──────────────────────────────────────────────────

describe('assertIntegrationInScope', () => {
  it('does not throw for non-portal requests', () => {
    expect(() => assertIntegrationInScope(makeRegularReq(), integration('int-1'))).not.toThrow();
  });

  it('does not throw when integration is in scope', () => {
    const req = makePortalReq({
      portalScope: { allowedIntegrationIds: ['int-1'], allowedTags: [], allowedViews: ['dashboard', 'logs'], tokenVersion: 1 },
    });
    expect(() => assertIntegrationInScope(req, integration('int-1'))).not.toThrow();
  });

  it('throws NotFoundError when integration is out of scope', () => {
    const req = makePortalReq({
      portalScope: { allowedIntegrationIds: ['int-1'], allowedTags: [], allowedViews: ['dashboard', 'logs'], tokenVersion: 1 },
    });
    expect(() => assertIntegrationInScope(req, integration('int-99'))).toThrow(/not found/i);
  });

  it('does not throw when integration is null', () => {
    const req = makePortalReq();
    expect(() => assertIntegrationInScope(req, null)).not.toThrow();
  });
});

// ── assertViewAllowed ─────────────────────────────────────────────────────────

describe('assertViewAllowed', () => {
  it('calls next() for non-portal requests', () => {
    const next = jest.fn();
    assertViewAllowed('dashboard')(makeRegularReq(), {}, next);
    expect(next).toHaveBeenCalledWith(); // no argument = no error
  });

  it('calls next() when view is in allowedViews', () => {
    const next = jest.fn();
    const req = makePortalReq({ portalScope: { allowedViews: ['dashboard', 'logs'], allowedIntegrationIds: [], allowedTags: [], tokenVersion: 1 } });
    assertViewAllowed('dashboard')(req, {}, next);
    expect(next).toHaveBeenCalledWith();
  });

  it('calls next(error) when view is NOT in allowedViews', () => {
    const next = jest.fn();
    const req = makePortalReq({ portalScope: { allowedViews: ['dashboard'], allowedIntegrationIds: [], allowedTags: [], tokenVersion: 1 } });
    assertViewAllowed('logs')(req, {}, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
  });

  it('blocks both views when allowedViews is empty', () => {
    const next = jest.fn();
    const req = makePortalReq({ portalScope: { allowedViews: [], allowedIntegrationIds: [], allowedTags: [], tokenVersion: 1 } });
    assertViewAllowed('dashboard')(req, {}, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
  });
});

// ── assertPortalNotReadOnly ───────────────────────────────────────────────────

describe('assertPortalNotReadOnly', () => {
  it('calls next() for non-portal requests', () => {
    const next = jest.fn();
    assertPortalNotReadOnly(makeRegularReq(), {}, next);
    expect(next).toHaveBeenCalledWith();
  });

  it('calls next(error) for VIEWER portal sessions', () => {
    const next = jest.fn();
    const req = makePortalReq({ user: { role: 'VIEWER', isPortalSession: true } });
    assertPortalNotReadOnly(req, {}, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
  });

  it('calls next() for INTEGRATION_EDITOR portal sessions', () => {
    const next = jest.fn();
    const req = makePortalReq({ user: { role: 'INTEGRATION_EDITOR', isPortalSession: true } });
    assertPortalNotReadOnly(req, {}, next);
    expect(next).toHaveBeenCalledWith();
  });
});
