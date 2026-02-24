const express = require('express');
const bcrypt = require('bcryptjs');
const data = require('../data');
const { log } = require('../logger');
const auth = require('../middleware/auth');
const asyncHandler = require('../utils/async-handler');
const { ValidationError, NotFoundError } = require('../utils/errors');
const config = require('../config');
const mongodb = require('../mongodb');
const { getRateLimitStatus, resetRateLimit } = require('../middleware/rate-limiter');
const { MemoryMonitor } = require('../services/memory-monitor');
const { auditUser, auditOrg, auditConfig, auditAdmin } = require('../middleware/audit');

const router = express.Router();

const sanitizeUser = (user) => ({
  id: user._id ? user._id.toString() : user.id,
  email: user.email,
  role: user.role,
  orgId: user.orgId || null,
  isActive: user.isActive !== false,
  lastLoginAt: user.lastLoginAt || null,
  createdAt: user.createdAt || null,
  updatedAt: user.updatedAt || null,
});

const assertNotLastActiveSuperAdmin = async (targetUser) => {
  if (!targetUser || targetUser.role !== 'SUPER_ADMIN' || targetUser.isActive === false) {
    return;
  }

  const result = await data.listUsers({ role: 'SUPER_ADMIN', isActive: true, page: 1, limit: 2 });
  if (result.total <= 1) {
    throw new ValidationError('At least one active SUPER_ADMIN user is required');
  }
};

const normalizeRateLimits = (input = {}, fallback = {}) => {
  const base = { ...fallback, ...(input || {}) };
  const enabled = base.enabled === undefined ? false : !!base.enabled;
  const maxRequestsRaw = base.maxRequests ?? fallback.maxRequests ?? 100;
  const windowSecondsRaw = base.windowSeconds ?? fallback.windowSeconds ?? 60;

  const maxRequests = Number.isFinite(Number(maxRequestsRaw)) ? Math.max(1, Number(maxRequestsRaw)) : 100;
  const windowSeconds = Number.isFinite(Number(windowSecondsRaw)) ? Math.max(1, Number(windowSecondsRaw)) : 60;

  return {
    enabled,
    maxRequests,
    windowSeconds,
  };
};

const normalizeRateLimitStatus = (status) => {
  if (!status) return null;
  return {
    enabled: !!status.enabled,
    current: status.current ?? 0,
    limit: Number.isFinite(status.limit) ? status.limit : null,
    remaining: Number.isFinite(status.remaining) ? status.remaining : null,
    resetAt: status.resetAt || null,
    windowSeconds: status.windowSeconds ?? null,
  };
};

const buildRateLimitQuery = (filters = {}) => {
  const conditions = [];
  const orgId = filters.orgId ? Number(filters.orgId) : undefined;
  const direction = filters.direction ? String(filters.direction).toUpperCase() : undefined;
  const enabledFilter = filters.enabled;
  const search = filters.search ? String(filters.search).trim() : undefined;

  if (orgId) {
    conditions.push({ orgId });
  }

  if (direction) {
    conditions.push({ direction });
  }

  if (enabledFilter !== undefined) {
    const enabled = enabledFilter === 'true' || enabledFilter === true;
    if (enabled) {
      conditions.push({ 'rateLimits.enabled': true });
    } else {
      conditions.push({
        $or: [{ rateLimits: { $exists: false } }, { 'rateLimits.enabled': false }],
      });
    }
  }

  if (search) {
    const regex = new RegExp(search, 'i');
    conditions.push({
      $or: [{ name: regex }, { type: regex }, { eventType: regex }],
    });
  }

  if (conditions.length === 0) {
    return {};
  }

  if (conditions.length === 1) {
    return conditions[0];
  }

  return { $and: conditions };
};

const escapeCsv = (value) => {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
};

const parsePositiveInt = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0 || !Number.isInteger(num)) {
    return null;
  }
  return num;
};

const normalizeTags = (value) => {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const result = [];
  value.forEach((tag) => {
    const normalized = String(tag).trim();
    if (!normalized) return;
    const key = normalized.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    result.push(normalized);
  });
  return result;
};

const isValidPhone = (value) => {
  if (!value) return true;
  const normalized = String(value).trim();
  if (!normalized) return true;
  return /^[+]?[\d\s().-]{6,20}$/.test(normalized);
};

// ---------------------------------------------------------------------------
// Storage stats — accessible to SUPER_ADMIN, ADMIN, and ORG_ADMIN
// Must be registered before the blanket SUPER_ADMIN/ADMIN guard below
// ---------------------------------------------------------------------------

const COLLECTION_LABELS = {
  integration_configs:    'Integrations',
  execution_logs:         'Execution Logs',
  delivery_attempts:      'Delivery Attempts',
  failed_deliveries:      'Failed Deliveries',
  dlq:                    'Dead Letter Queue',
  pending_events:         'Pending Events',
  processed_events:       'Processed Events',
  lookups:                'Lookup Tables',
  organizations:          'Organizations',
  org_units:              'Org Units',
  users:                  'Users',
  scheduled_job_logs:     'Scheduled Job Logs',
  scheduled_integrations: 'Scheduled Integrations',
  scheduler_state:        'Scheduler State',
  audit_logs:             'Audit Logs',
  alert_center_logs:      'Alert Center Logs',
  integration_templates:  'Integration Templates',
  event_audit:            'Event Audit',
  event_types:            'Event Types',
  event_source_configs:   'Event Source Configs',
  source_checkpoints:     'Source Checkpoints',
  system_config:          'System Config',
  admin_audit:            'Admin Audit',
  rate_limits:            'Rate Limits',
  ui_config:              'UI Config',
  worker_checkpoint:      'Worker Checkpoint',
  ai_configs:             'AI Configs',
  ai_interactions:        'AI Interactions',
};

// Collections that carry orgId — visible to ORG_ADMIN with per-org counts
const ORG_SCOPED_COLLECTIONS = new Set([
  'integration_configs', 'execution_logs', 'delivery_attempts', 'failed_deliveries',
  'dlq', 'pending_events', 'processed_events', 'lookups', 'scheduled_job_logs',
  'scheduled_integrations', 'audit_logs', 'alert_center_logs', 'event_audit',
  'event_types', 'event_source_configs', 'source_checkpoints', 'ai_configs',
  'ai_interactions',
]);

// Cache is keyed by 'global' (SUPER_ADMIN/ADMIN) or orgId (ORG_ADMIN)
const _storageStatsCaches = new Map();
const STORAGE_STATS_TTL_MS = 60_000;

function _getCached(key) {
  const entry = _storageStatsCaches.get(key);
  if (entry && Date.now() - entry.at < STORAGE_STATS_TTL_MS) return entry.data;
  return null;
}

function _setCached(key, data) {
  _storageStatsCaches.set(key, { data, at: Date.now() });
}

router.get(
  '/storage-stats',
  auth.requireRole(['SUPER_ADMIN', 'ADMIN', 'ORG_ADMIN']),
  asyncHandler(async (req, res) => {
    const isOrgAdmin = req.user?.role === 'ORG_ADMIN';
    const orgId = req.user?.orgId ?? null;
    const cacheKey = isOrgAdmin ? `org:${orgId}` : 'global';

    const cached = _getCached(cacheKey);
    if (cached) return res.json(cached);

    const db = await mongodb.getDbSafe();

    const [dbStats, collectionList] = await Promise.all([
      db.command({ dbStats: 1 }),
      db.listCollections().toArray(),
    ]);

    // ORG_ADMIN sees only org-scoped collections; others see all
    const userCollections = collectionList.filter(c =>
      !c.name.startsWith('system.') &&
      (isOrgAdmin ? ORG_SCOPED_COLLECTIONS.has(c.name) : true)
    );

    const results = await Promise.allSettled(
      userCollections.map(c => db.command({ collStats: c.name }))
    );

    // For ORG_ADMIN: replace global document counts with per-org counts
    const orgCounts = isOrgAdmin
      ? await Promise.allSettled(
          userCollections.map(c => db.collection(c.name).countDocuments({ orgId }))
        )
      : null;

    const totalStorageSize = results.reduce((sum, r) =>
      r.status === 'fulfilled' ? sum + (r.value.storageSize || 0) : sum, 0);

    const collections = results
      .map((r, i) => {
        if (r.status !== 'fulfilled') return null;
        const s = r.value;
        const name = userCollections[i].name;
        const orgCount = orgCounts?.[i]?.status === 'fulfilled' ? orgCounts[i].value : (s.count ?? 0);
        return {
          name,
          label: COLLECTION_LABELS[name] ?? name,
          count: isOrgAdmin ? orgCount : (s.count ?? 0),
          dataSize: s.size ?? 0,
          storageSize: s.storageSize ?? 0,
          indexSize: s.totalIndexSize ?? 0,
          totalSize: (s.storageSize ?? 0) + (s.totalIndexSize ?? 0),
          avgObjSize: Math.round(s.avgObjSize ?? 0),
          percentOfTotal: totalStorageSize
            ? +((s.storageSize ?? 0) / totalStorageSize * 100).toFixed(1)
            : 0,
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.storageSize - a.storageSize);

    const payload = {
      db: {
        dataSize:    dbStats.dataSize    ?? 0,
        storageSize: dbStats.storageSize ?? 0,
        indexSize:   dbStats.indexSize   ?? 0,
        objects:     isOrgAdmin
          ? collections.reduce((s, c) => s + c.count, 0)
          : (dbStats.objects ?? 0),
        collections: collections.length,
        avgObjSize:  Math.round(dbStats.avgObjSize ?? 0),
      },
      collections,
      // Signals to the frontend that storage sizes are platform-wide, not org-scoped
      isOrgView: isOrgAdmin,
      generatedAt: new Date().toISOString(),
    };

    _setCached(cacheKey, payload);
    res.json(payload);
  })
);

// All other admin routes require SUPER_ADMIN or ADMIN role
router.use(auth.requireRole(['SUPER_ADMIN', 'ADMIN']));

// GET /api/v1/admin/users
router.get(
  '/users',
  asyncHandler(async (req, res) => {
    const orgId = req.query.orgId ? Number(req.query.orgId) : undefined;
    const role = req.query.role ? String(req.query.role) : undefined;
    const search = req.query.search ? String(req.query.search) : undefined;
    const isActive =
      req.query.isActive !== undefined ? req.query.isActive === 'true' || req.query.isActive === true : undefined;
    const page = req.query.page ? Number(req.query.page) : 1;
    const limit = req.query.limit ? Number(req.query.limit) : 50;

    const result = await data.listUsers({ orgId, role, search, isActive, page, limit });
    res.json({
      users: result.users.map(sanitizeUser),
      total: result.total,
      page: result.page,
      limit: result.limit,
    });
  })
);

// POST /api/v1/admin/users
router.post(
  '/users',
  asyncHandler(async (req, res) => {
    const { email, password, role, orgId } = req.body || {};

    if (!email || !password || !role) {
      throw new ValidationError('email, password, and role are required');
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    if (!normalizedEmail.includes('@')) {
      throw new ValidationError('Invalid email');
    }

    if (role !== 'SUPER_ADMIN' && (!orgId || !Number.isFinite(Number(orgId)))) {
      throw new ValidationError('orgId is required for organization-scoped users');
    }

    const existing = await data.getUserByEmail(normalizedEmail);
    if (existing) {
      throw new ValidationError('User already exists');
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const created = await data.createUser({
      email: normalizedEmail,
      passwordHash,
      role,
      orgId: role === 'SUPER_ADMIN' ? null : Number(orgId),
    });

    log('info', 'Admin created user', {
      adminId: req.user?.id,
      userId: created._id.toString(),
      role: created.role,
      orgId: created.orgId || null,
    });

    await auditUser.created(req, created);
    res.status(201).json({ user: sanitizeUser(created) });
  })
);

// PUT /api/v1/admin/users/:id
router.put(
  '/users/:id',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { email, role, orgId, isActive } = req.body || {};

    const existing = await data.getUserById(id);
    if (!existing) {
      throw new NotFoundError('User not found');
    }

    const updates = {};
    if (email) updates.email = String(email).trim().toLowerCase();
    if (role) updates.role = role;
    if (isActive !== undefined) updates.isActive = !!isActive;

    const nextRole = role || existing.role;
    const nextActive = isActive !== undefined ? !!isActive : existing.isActive !== false;
    let nextOrgId = existing.orgId ?? null;
    if (orgId !== undefined) {
      nextOrgId = orgId ? Number(orgId) : null;
    }

    if (existing.role === 'SUPER_ADMIN' && existing.isActive !== false) {
      if (nextRole !== 'SUPER_ADMIN' || nextActive === false) {
        await assertNotLastActiveSuperAdmin(existing);
      }
    }

    if (nextRole !== 'SUPER_ADMIN' && (!nextOrgId || !Number.isFinite(Number(nextOrgId)))) {
      throw new ValidationError('orgId is required for organization-scoped users');
    }

    if (nextRole === 'SUPER_ADMIN') {
      nextOrgId = null;
    }

    if (orgId !== undefined || nextRole === 'SUPER_ADMIN') {
      updates.orgId = nextOrgId;
    }

    const updated = await data.updateUser(id, updates);
    if (!updated) {
      throw new NotFoundError('User not found');
    }

    await auditUser.updated(req, id, { before: existing, after: updated });
    res.json({ user: sanitizeUser(updated) });
  })
);

// PATCH /api/v1/admin/users/:id/disable
router.patch(
  '/users/:id/disable',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { isActive } = req.body || {};

    if (isActive === undefined) {
      throw new ValidationError('isActive is required');
    }

    const existing = await data.getUserById(id);
    if (!existing) {
      throw new NotFoundError('User not found');
    }

    if (existing.role === 'SUPER_ADMIN' && existing.isActive !== false && isActive === false) {
      await assertNotLastActiveSuperAdmin(existing);
    }

    const updated = await data.updateUser(id, { isActive: !!isActive });
    if (!updated) {
      throw new NotFoundError('User not found');
    }

    if (isActive) {
      await auditAdmin.userEnabled(req, id, existing);
    } else {
      await auditAdmin.userDisabled(req, id, existing);
    }
    res.json({ user: sanitizeUser(updated) });
  })
);

// POST /api/v1/admin/users/:id/reset-password
router.post(
  '/users/:id/reset-password',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { password } = req.body || {};

    if (!password) {
      throw new ValidationError('password is required');
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const updated = await data.updateUser(id, { passwordHash });
    if (!updated) {
      throw new NotFoundError('User not found');
    }

    await auditAdmin.passwordReset(req, id);
    res.json({ message: 'Password reset successfully' });
  })
);

// GET /api/v1/admin/orgs
router.get(
  '/orgs',
  asyncHandler(async (_req, res) => {
    const orgs = await data.listTenantIds();
    res.json({ orgs });
  })
);

// GET /api/v1/admin/orgs/summary
router.get(
  '/orgs/summary',
  asyncHandler(async (_req, res) => {
    const orgs = await data.listTenantSummaries();
    res.json({ orgs });
  })
);

// GET /api/v1/admin/orgs/:orgId
router.get(
  '/orgs/:orgId',
  asyncHandler(async (req, res) => {
    const orgId = parsePositiveInt(req.params.orgId);
    if (!orgId) {
      throw new ValidationError('orgId must be a positive integer');
    }

    const org = await data.getOrganization(orgId);
    if (!org) {
      throw new NotFoundError('Organization not found');
    }
    res.json({ org });
  })
);

// POST /api/v1/admin/orgs
router.post(
  '/orgs',
  asyncHandler(async (req, res) => {
    const { orgId, name, code, email, phone, address, tags, region, timezone } = req.body || {};

    // orgId is now optional - will be auto-generated if not provided
    let parsedOrgId = null;
    if (orgId !== undefined && orgId !== null && orgId !== '') {
      parsedOrgId = parsePositiveInt(orgId);
      if (!parsedOrgId) {
        throw new ValidationError('orgId must be a positive integer if provided');
      }
    }

    const normalizedName = name ? String(name).trim() : '';
    const normalizedCode = code ? String(code).trim() : '';
    if (!normalizedName) {
      throw new ValidationError('name is required');
    }
    if (!normalizedCode) {
      throw new ValidationError('code is required');
    }
    if (!isValidPhone(phone)) {
      throw new ValidationError('phone format is invalid');
    }

    // Only check for existing org if orgId was provided
    if (parsedOrgId) {
      const existing = await data.getOrganization(parsedOrgId);
      if (existing) {
        throw new ValidationError('Organization already exists');
      }

      const unitCollision = await mongodb
        .getDbSafe()
        .then((dbClient) => dbClient.collection('org_units').findOne({ rid: parsedOrgId }));
      if (unitCollision) {
        throw new ValidationError('orgId conflicts with an existing unit rid');
      }
    }

    const created = await data.createOrganization({
      orgId: parsedOrgId,
      name: normalizedName,
      code: normalizedCode,
      email: email ? String(email).trim() : null,
      phone: phone ? String(phone).trim() : null,
      address: address ? String(address).trim() : null,
      tags: normalizeTags(tags),
      region: region ? String(region).trim() : null,
      timezone: timezone ? String(timezone).trim() : null,
    });

    await auditOrg.created(req, created);
    res.status(201).json({ org: created });
  })
);

// PUT /api/v1/admin/orgs/:orgId
router.put(
  '/orgs/:orgId',
  asyncHandler(async (req, res) => {
    const orgId = parsePositiveInt(req.params.orgId);
    if (!orgId) {
      throw new ValidationError('orgId must be a positive integer');
    }

    const beforeOrg = await data.getOrganization(orgId);
    const { name, code, email, phone, address, tags, region, timezone } = req.body || {};
    const updates = {};
    if (name !== undefined) {
      const normalizedName = name ? String(name).trim() : '';
      if (!normalizedName) {
        throw new ValidationError('name must not be empty');
      }
      updates.name = normalizedName;
    }
    if (code !== undefined) {
      const normalizedCode = code ? String(code).trim() : '';
      if (!normalizedCode) {
        throw new ValidationError('code must not be empty');
      }
      updates.code = normalizedCode;
    }
    if (email !== undefined) updates.email = email ? String(email).trim() : null;
    if (phone !== undefined) {
      if (!isValidPhone(phone)) {
        throw new ValidationError('phone format is invalid');
      }
      updates.phone = phone ? String(phone).trim() : null;
    }
    if (address !== undefined) updates.address = address ? String(address).trim() : null;
    if (tags !== undefined) {
      updates.tags = normalizeTags(tags);
    }
    if (region !== undefined) updates.region = region ? String(region).trim() : null;
    if (timezone !== undefined) updates.timezone = timezone ? String(timezone).trim() : null;

    const updated = await data.updateOrganization(orgId, updates);
    if (!updated) {
      throw new NotFoundError('Organization not found');
    }

    await auditOrg.updated(req, orgId, { before: beforeOrg, after: updated });
    res.json({ org: updated });
  })
);

// DELETE /api/v1/admin/orgs/:orgId
router.delete(
  '/orgs/:orgId',
  asyncHandler(async (req, res) => {
    const orgId = parsePositiveInt(req.params.orgId);
    if (!orgId) {
      throw new ValidationError('orgId must be a positive integer');
    }

    const beforeOrg = await data.getOrganization(orgId);
    const deleted = await data.deleteOrganization(orgId);
    if (!deleted) {
      throw new NotFoundError('Organization not found');
    }

    await auditOrg.deleted(req, orgId, beforeOrg);
    res.json({ message: 'Organization deleted' });
  })
);

// GET /api/v1/admin/orgs/:orgId/units
router.get(
  '/orgs/:orgId/units',
  asyncHandler(async (req, res) => {
    const orgId = parsePositiveInt(req.params.orgId);
    if (!orgId) {
      throw new ValidationError('orgId must be a positive integer');
    }

    const org = await data.getOrganization(orgId);
    if (!org) {
      throw new NotFoundError('Organization not found');
    }

    const units = await data.listOrgUnits(orgId);
    res.json({ units });
  })
);

// POST /api/v1/admin/orgs/:orgId/units
router.post(
  '/orgs/:orgId/units',
  asyncHandler(async (req, res) => {
    const orgId = parsePositiveInt(req.params.orgId);
    if (!orgId) {
      throw new ValidationError('orgId must be a positive integer');
    }

    const { rid, name, code, email, phone, address, tags, region, timezone } = req.body || {};

    // rid is now optional - will be auto-generated if not provided
    let parsedRid = null;
    if (rid !== undefined && rid !== null && rid !== '') {
      parsedRid = parsePositiveInt(rid);
      if (!parsedRid) {
        throw new ValidationError('rid must be a positive integer if provided');
      }
    }

    const normalizedName = name ? String(name).trim() : '';
    const normalizedCode = code ? String(code).trim() : '';
    if (!normalizedName) {
      throw new ValidationError('name is required');
    }
    if (!normalizedCode) {
      throw new ValidationError('code is required');
    }
    if (!isValidPhone(phone)) {
      throw new ValidationError('phone format is invalid');
    }

    // Only check rid conflicts if rid was provided
    if (parsedRid) {
      if (parsedRid === orgId) {
        throw new ValidationError('rid must be different from orgId');
      }

      const existingUnit = await mongodb
        .getDbSafe()
        .then((dbClient) => dbClient.collection('org_units').findOne({ rid: parsedRid }));
      if (existingUnit) {
        throw new ValidationError('rid already exists');
      }

      const orgIdCollision = await mongodb
        .getDbSafe()
        .then((dbClient) => dbClient.collection('organizations').findOne({ orgId: parsedRid }));
      if (orgIdCollision) {
        throw new ValidationError('rid conflicts with an existing orgId');
      }
    }

    const org = await data.getOrganization(orgId);
    if (!org) {
      throw new NotFoundError('Organization not found');
    }

    const created = await data.createOrgUnit(orgId, {
      rid: parsedRid,
      name: normalizedName,
      code: normalizedCode,
      email: email ? String(email).trim() : null,
      phone: phone ? String(phone).trim() : null,
      address: address ? String(address).trim() : null,
      tags: normalizeTags(tags),
      region: region ? String(region).trim() : null,
      timezone: timezone ? String(timezone).trim() : null,
    });

    await auditOrg.unitCreated(req, orgId, created);
    res.status(201).json({ unit: created });
  })
);

// PUT /api/v1/admin/orgs/:orgId/units/:rid
router.put(
  '/orgs/:orgId/units/:rid',
  asyncHandler(async (req, res) => {
    const orgId = parsePositiveInt(req.params.orgId);
    const rid = parsePositiveInt(req.params.rid);
    if (!orgId || !rid) {
      throw new ValidationError('orgId and rid must be positive integers');
    }

    const beforeUnit = await data.getOrgUnit(orgId, rid).catch(() => null);
    const { name, code, email, phone, address, tags, region, timezone } = req.body || {};
    const updates = {};
    if (name !== undefined) {
      const normalizedName = name ? String(name).trim() : '';
      if (!normalizedName) {
        throw new ValidationError('name must not be empty');
      }
      updates.name = normalizedName;
    }
    if (code !== undefined) {
      const normalizedCode = code ? String(code).trim() : '';
      if (!normalizedCode) {
        throw new ValidationError('code must not be empty');
      }
      updates.code = normalizedCode;
    }
    if (email !== undefined) updates.email = email ? String(email).trim() : null;
    if (phone !== undefined) {
      if (!isValidPhone(phone)) {
        throw new ValidationError('phone format is invalid');
      }
      updates.phone = phone ? String(phone).trim() : null;
    }
    if (address !== undefined) updates.address = address ? String(address).trim() : null;
    if (tags !== undefined) {
      updates.tags = normalizeTags(tags);
    }
    if (region !== undefined) updates.region = region ? String(region).trim() : null;
    if (timezone !== undefined) updates.timezone = timezone ? String(timezone).trim() : null;

    const updated = await data.updateOrgUnit(orgId, rid, updates);
    if (!updated) {
      throw new NotFoundError('Org unit not found');
    }

    await auditOrg.unitUpdated(req, orgId, rid, { before: beforeUnit, after: updated });
    res.json({ unit: updated });
  })
);

// DELETE /api/v1/admin/orgs/:orgId/units/:rid
router.delete(
  '/orgs/:orgId/units/:rid',
  asyncHandler(async (req, res) => {
    const orgId = parsePositiveInt(req.params.orgId);
    const rid = parsePositiveInt(req.params.rid);
    if (!orgId || !rid) {
      throw new ValidationError('orgId and rid must be positive integers');
    }

    const beforeUnit = await data.getOrgUnit(orgId, rid).catch(() => null);
    const deleted = await data.deleteOrgUnit(orgId, rid);
    if (!deleted) {
      throw new NotFoundError('Org unit not found');
    }

    await auditOrg.unitDeleted(req, orgId, rid, beforeUnit);
    res.json({ message: 'Org unit deleted' });
  })
);

// GET /api/v1/admin/rate-limits
router.get(
  '/rate-limits',
  asyncHandler(async (req, res) => {
    const orgId = req.query.orgId ? Number(req.query.orgId) : undefined;
    const direction = req.query.direction ? String(req.query.direction).toUpperCase() : undefined;
    const enabledFilter = req.query.enabled;
    const search = req.query.search ? String(req.query.search).trim() : undefined;
    const page = req.query.page ? Number(req.query.page) : 1;
    const limit = Math.min(req.query.limit ? Number(req.query.limit) : 50, 200);
    const offset = (page - 1) * limit;
    const _days = parseDayCount(req.query.days, 7);

    const query = buildRateLimitQuery({ orgId, direction, enabled: enabledFilter, search });

    const db = await mongodb.getDbSafe();
    const [items, total] = await Promise.all([
      db.collection('integration_configs').find(query).sort({ updatedAt: -1 }).skip(offset).limit(limit).toArray(),
      db.collection('integration_configs').countDocuments(query),
    ]);

    const results = await Promise.all(
      items.map(async (doc) => {
        const rateLimits = doc.rateLimits || null;
        let status = null;
        if (rateLimits?.enabled) {
          status = normalizeRateLimitStatus(await getRateLimitStatus(doc._id.toString(), doc.orgId));
        } else {
          status = normalizeRateLimitStatus({
            enabled: false,
            current: 0,
            limit: null,
            remaining: null,
            resetAt: null,
            windowSeconds: rateLimits?.windowSeconds ?? null,
          });
        }

        return {
          id: doc._id.toString(),
          name: doc.name,
          type: doc.type || doc.eventType,
          direction: doc.direction || 'OUTBOUND',
          orgId: doc.orgId,
          isActive: doc.isActive !== false,
          rateLimits,
          updatedAt: doc.updatedAt || doc.createdAt || null,
          status,
        };
      })
    );

    res.json({
      items: results,
      total,
      page,
      limit,
    });
  })
);

// POST /api/v1/admin/rate-limits/bulk-apply
router.post(
  '/rate-limits/bulk-apply',
  asyncHandler(async (req, res) => {
    const input = req.body || {};
    const rateLimits = input.rateLimits;
    const filters = input.filters || {};
    const mode = input.mode === 'merge' ? 'merge' : 'override';
    const confirmAll = input.confirmAll === true;

    if (!rateLimits || typeof rateLimits !== 'object') {
      throw new ValidationError('rateLimits object required');
    }

    const db = await mongodb.getDbSafe();
    const query = buildRateLimitQuery(filters);
    if (!confirmAll && (!filters || Object.keys(filters).length === 0)) {
      throw new ValidationError('confirmAll is required when applying to all integrations');
    }
    const updatedAt = new Date();

    let updateDoc;
    let payload = null;

    if (mode === 'merge') {
      const partial = {};
      if (rateLimits.enabled !== undefined) partial['rateLimits.enabled'] = !!rateLimits.enabled;
      if (rateLimits.maxRequests !== undefined) {
        const value = Number(rateLimits.maxRequests);
        partial['rateLimits.maxRequests'] = Number.isFinite(value) ? Math.max(1, value) : 100;
      }
      if (rateLimits.windowSeconds !== undefined) {
        const value = Number(rateLimits.windowSeconds);
        partial['rateLimits.windowSeconds'] = Number.isFinite(value) ? Math.max(1, value) : 60;
      }

      if (Object.keys(partial).length === 0) {
        throw new ValidationError('rateLimits fields required for merge mode');
      }

      updateDoc = { $set: { ...partial, updatedAt } };
      payload = partial;
    } else {
      const normalized = normalizeRateLimits(rateLimits);
      updateDoc = { $set: { rateLimits: normalized, updatedAt } };
      payload = normalized;
    }

    const result = await db.collection('integration_configs').updateMany(query, updateDoc);

    log('info', 'Admin bulk rate limit update', {
      adminId: req.user?.id,
      matched: result.matchedCount,
      modified: result.modifiedCount,
      mode,
    });

    await db.collection('admin_audit').insertOne({
      action: 'RATE_LIMITS_BULK_APPLY',
      adminId: req.user?.id,
      adminEmail: req.user?.email || null,
      adminRole: req.user?.role || null,
      filters,
      mode,
      rateLimits: payload,
      matched: result.matchedCount,
      modified: result.modifiedCount,
      createdAt: new Date(),
    });

    const affectedIds = await db
      .collection('integration_configs')
      .find(query, { projection: { _id: 1 } })
      .limit(500)
      .toArray()
      .then((docs) => docs.map((d) => d._id.toString()));
    await auditConfig.rateLimitBulkApplied(req, affectedIds, payload);

    res.json({
      matched: result.matchedCount,
      modified: result.modifiedCount,
      mode,
      rateLimits: payload,
    });
  })
);

// POST /api/v1/admin/rate-limits/bulk-reset
router.post(
  '/rate-limits/bulk-reset',
  asyncHandler(async (req, res) => {
    const filters = req.body?.filters || {};
    const confirmAll = req.body?.confirmAll === true;
    const query = buildRateLimitQuery(filters);
    const db = await mongodb.getDbSafe();
    if (!confirmAll && (!filters || Object.keys(filters).length === 0)) {
      throw new ValidationError('confirmAll is required when resetting all integrations');
    }

    const integrations = await db
      .collection('integration_configs')
      .find(query, { projection: { _id: 1 } })
      .toArray();

    if (!integrations.length) {
      return res.json({ integrations: 0, deleted: 0 });
    }

    const ids = integrations.map((doc) => doc._id);
    const result = await db.collection('rate_limits').deleteMany({
      integrationConfigId: { $in: ids },
    });

    log('info', 'Admin bulk rate limit reset', {
      adminId: req.user?.id,
      integrations: ids.length,
      deleted: result.deletedCount,
    });

    await db.collection('admin_audit').insertOne({
      action: 'RATE_LIMITS_BULK_RESET',
      adminId: req.user?.id,
      adminEmail: req.user?.email || null,
      adminRole: req.user?.role || null,
      filters,
      integrations: ids.length,
      deleted: result.deletedCount,
      createdAt: new Date(),
    });

    await auditConfig.rateLimitBulkReset(
      req,
      ids.map((id) => id.toString())
    );
    res.json({ integrations: ids.length, deleted: result.deletedCount });
  })
);

// GET /api/v1/admin/rate-limits/export
router.get(
  '/rate-limits/export',
  asyncHandler(async (req, res) => {
    const orgId = req.query.orgId ? Number(req.query.orgId) : undefined;
    const direction = req.query.direction ? String(req.query.direction).toUpperCase() : undefined;
    const enabledFilter = req.query.enabled;
    const search = req.query.search ? String(req.query.search).trim() : undefined;

    const query = buildRateLimitQuery({ orgId, direction, enabled: enabledFilter, search });
    const db = await mongodb.getDbSafe();
    const items = await db.collection('integration_configs').find(query).sort({ updatedAt: -1 }).toArray();

    const rows = await Promise.all(
      items.map(async (doc) => {
        const rateLimits = doc.rateLimits || {};
        let status = null;
        if (rateLimits.enabled) {
          status = normalizeRateLimitStatus(await getRateLimitStatus(doc._id.toString(), doc.orgId));
        }

        return {
          id: doc._id.toString(),
          name: doc.name || '',
          type: doc.type || doc.eventType || '',
          direction: doc.direction || 'OUTBOUND',
          orgId: doc.orgId || '',
          isActive: doc.isActive !== false,
          rateLimitEnabled: rateLimits.enabled === true,
          maxRequests: rateLimits.maxRequests ?? '',
          windowSeconds: rateLimits.windowSeconds ?? '',
          current: status?.current ?? '',
          remaining: status?.remaining ?? '',
          resetAt: status?.resetAt ? new Date(status.resetAt).toISOString() : '',
          updatedAt: doc.updatedAt ? new Date(doc.updatedAt).toISOString() : '',
        };
      })
    );

    const headers = [
      'id',
      'name',
      'type',
      'direction',
      'orgId',
      'isActive',
      'rateLimitEnabled',
      'maxRequests',
      'windowSeconds',
      'current',
      'remaining',
      'resetAt',
      'updatedAt',
    ];

    const csv = [headers.join(','), ...rows.map((row) => headers.map((key) => escapeCsv(row[key])).join(','))].join(
      '\n'
    );

    await db.collection('admin_audit').insertOne({
      action: 'RATE_LIMITS_EXPORT',
      adminId: req.user?.id,
      adminEmail: req.user?.email || null,
      adminRole: req.user?.role || null,
      filters: { orgId, direction, enabled: enabledFilter, search },
      count: rows.length,
      createdAt: new Date(),
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="rate-limits.csv"');
    res.send(csv);
  })
);

// GET /api/v1/admin/audit-logs
router.get(
  '/audit-logs',
  asyncHandler(async (req, res) => {
    const action = req.query.action ? String(req.query.action).trim() : undefined;
    const role = req.query.role ? String(req.query.role).trim() : undefined;
    const adminId = req.query.adminId ? String(req.query.adminId).trim() : undefined;
    const search = req.query.search ? String(req.query.search).trim() : undefined;
    const startDate = req.query.startDate ? new Date(String(req.query.startDate)) : undefined;
    const endDate = req.query.endDate ? new Date(String(req.query.endDate)) : undefined;
    const page = req.query.page ? Number(req.query.page) : 1;
    const limit = Math.min(req.query.limit ? Number(req.query.limit) : 50, 200);
    const offset = (page - 1) * limit;

    const query = {};
    const conditions = [];

    if (action) {
      conditions.push({ action });
    }
    if (role) {
      conditions.push({ adminRole: role });
    }
    if (adminId) {
      conditions.push({ adminId });
    }
    if (search) {
      const regex = new RegExp(search, 'i');
      conditions.push({
        $or: [{ action: regex }, { adminEmail: regex }, { adminId: regex }],
      });
    }
    if (startDate || endDate) {
      const dateClause = {};
      if (startDate && !Number.isNaN(startDate.getTime())) {
        dateClause.$gte = startDate;
      }
      if (endDate && !Number.isNaN(endDate.getTime())) {
        dateClause.$lte = endDate;
      }
      if (Object.keys(dateClause).length > 0) {
        conditions.push({ createdAt: dateClause });
      }
    }

    if (conditions.length === 1) {
      Object.assign(query, conditions[0]);
    } else if (conditions.length > 1) {
      query.$and = conditions;
    }

    const trendStart = new Date();
    trendStart.setHours(0, 0, 0, 0);
    trendStart.setDate(trendStart.getDate() - (days - 1));

    const trendQuery =
      conditions.length > 0
        ? { $and: [...conditions, { createdAt: { $gte: trendStart } }] }
        : { createdAt: { $gte: trendStart } };

    const db = await mongodb.getDbSafe();
    const [items, total, summaryResult] = await Promise.all([
      db.collection('admin_audit').find(query).sort({ createdAt: -1 }).skip(offset).limit(limit).toArray(),
      db.collection('admin_audit').countDocuments(query),
      db
        .collection('admin_audit')
        .aggregate([
          {
            $facet: {
              overall: [
                { $match: query },
                {
                  $facet: {
                    total: [{ $count: 'count' }],
                    topActions: [
                      { $group: { _id: '$action', count: { $sum: 1 } } },
                      { $sort: { count: -1 } },
                      { $limit: 5 },
                    ],
                    topAdmins: [
                      { $group: { _id: '$adminEmail', count: { $sum: 1 } } },
                      { $sort: { count: -1 } },
                      { $limit: 5 },
                    ],
                    actionBreakdown: [
                      { $group: { _id: '$action', count: { $sum: 1 } } },
                      { $sort: { count: -1 } },
                      { $limit: 10 },
                    ],
                  },
                },
              ],
              trend: [
                { $match: trendQuery },
                {
                  $group: {
                    _id: {
                      $dateToString: { format: '%Y-%m-%d', date: '$createdAt' },
                    },
                    count: { $sum: 1 },
                  },
                },
                { $sort: { _id: 1 } },
              ],
            },
          },
        ])
        .toArray(),
    ]);

    const mapped = items.map((doc) => ({
      id: doc._id?.toString?.() || doc.id,
      action: doc.action,
      adminId: doc.adminId || null,
      adminEmail: doc.adminEmail || null,
      adminRole: doc.adminRole || null,
      filters: doc.filters || null,
      mode: doc.mode || null,
      rateLimits: doc.rateLimits || null,
      matched: doc.matched ?? null,
      modified: doc.modified ?? null,
      integrations: doc.integrations ?? null,
      deleted: doc.deleted ?? null,
      count: doc.count ?? null,
      createdAt: doc.createdAt || null,
    }));

    const summary = summaryResult?.[0] || {};
    const overall = summary.overall?.[0] || {};
    const totalSummary = overall.total?.[0]?.count ?? total;
    const topActions = (overall.topActions || []).map((row) => ({
      action: row._id || 'unknown',
      count: row.count || 0,
    }));
    const topAdmins = (overall.topAdmins || []).map((row) => ({
      adminEmail: row._id || 'unknown',
      count: row.count || 0,
    }));
    const actionBreakdown = (overall.actionBreakdown || []).map((row) => ({
      action: row._id || 'unknown',
      count: row.count || 0,
    }));

    const dailyMap = new Map();
    (summary.trend || []).forEach((row) => {
      if (row._id) {
        dailyMap.set(row._id, row.count || 0);
      }
    });

    const dailyCounts = [];
    const now = new Date();
    for (let i = days - 1; i >= 0; i -= 1) {
      const date = new Date(now);
      date.setDate(now.getDate() - i);
      const key = date.toISOString().slice(0, 10);
      dailyCounts.push({
        date: key,
        count: dailyMap.get(key) || 0,
      });
    }

    res.json({
      items: mapped,
      summary: {
        total: totalSummary,
        topActions,
        topAdmins,
        actionBreakdown,
        dailyCounts,
        days,
      },
      total,
      page,
      limit,
    });
  })
);

// GET /api/v1/admin/audit-logs/export
router.get(
  '/audit-logs/export',
  asyncHandler(async (req, res) => {
    const action = req.query.action ? String(req.query.action).trim() : undefined;
    const role = req.query.role ? String(req.query.role).trim() : undefined;
    const adminId = req.query.adminId ? String(req.query.adminId).trim() : undefined;
    const search = req.query.search ? String(req.query.search).trim() : undefined;
    const startDate = req.query.startDate ? new Date(String(req.query.startDate)) : undefined;
    const endDate = req.query.endDate ? new Date(String(req.query.endDate)) : undefined;

    const conditions = [];
    if (action) conditions.push({ action });
    if (role) conditions.push({ adminRole: role });
    if (adminId) conditions.push({ adminId });
    if (search) {
      const regex = new RegExp(search, 'i');
      conditions.push({
        $or: [{ action: regex }, { adminEmail: regex }, { adminId: regex }],
      });
    }
    if (startDate || endDate) {
      const dateClause = {};
      if (startDate && !Number.isNaN(startDate.getTime())) {
        dateClause.$gte = startDate;
      }
      if (endDate && !Number.isNaN(endDate.getTime())) {
        dateClause.$lte = endDate;
      }
      if (Object.keys(dateClause).length > 0) {
        conditions.push({ createdAt: dateClause });
      }
    }

    const query = conditions.length > 1 ? { $and: conditions } : conditions[0] || {};
    const db = await mongodb.getDbSafe();
    const items = await db.collection('admin_audit').find(query).sort({ createdAt: -1 }).limit(5000).toArray();

    const headers = [
      'createdAt',
      'action',
      'adminEmail',
      'adminId',
      'adminRole',
      'matched',
      'modified',
      'integrations',
      'deleted',
      'count',
      'filters',
      'rateLimits',
      'mode',
    ];

    const csv = [
      headers.join(','),
      ...items.map((doc) =>
        headers
          .map((key) => {
            let value = doc[key];
            if (key === 'createdAt' && value) {
              value = new Date(value).toISOString();
            }
            if (key === 'filters' || key === 'rateLimits') {
              value = value ? JSON.stringify(value) : '';
            }
            return escapeCsv(value);
          })
          .join(',')
      ),
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="admin-audit-logs.csv"');
    res.send(csv);
  })
);

// GET /api/v1/admin/audit-logs/export-trend
router.get(
  '/audit-logs/export-trend',
  asyncHandler(async (req, res) => {
    const action = req.query.action ? String(req.query.action).trim() : undefined;
    const role = req.query.role ? String(req.query.role).trim() : undefined;
    const adminId = req.query.adminId ? String(req.query.adminId).trim() : undefined;
    const search = req.query.search ? String(req.query.search).trim() : undefined;
    const startDate = req.query.startDate ? new Date(String(req.query.startDate)) : undefined;
    const endDate = req.query.endDate ? new Date(String(req.query.endDate)) : undefined;
    const days = parseDayCount(req.query.days, 7);

    const conditions = [];
    if (action) conditions.push({ action });
    if (role) conditions.push({ adminRole: role });
    if (adminId) conditions.push({ adminId });
    if (search) {
      const regex = new RegExp(search, 'i');
      conditions.push({
        $or: [{ action: regex }, { adminEmail: regex }, { adminId: regex }],
      });
    }
    if (startDate || endDate) {
      const dateClause = {};
      if (startDate && !Number.isNaN(startDate.getTime())) {
        dateClause.$gte = startDate;
      }
      if (endDate && !Number.isNaN(endDate.getTime())) {
        dateClause.$lte = endDate;
      }
      if (Object.keys(dateClause).length > 0) {
        conditions.push({ createdAt: dateClause });
      }
    }

    const trendStart = new Date();
    trendStart.setHours(0, 0, 0, 0);
    trendStart.setDate(trendStart.getDate() - (days - 1));

    const trendQuery =
      conditions.length > 0
        ? { $and: [...conditions, { createdAt: { $gte: trendStart } }] }
        : { createdAt: { $gte: trendStart } };

    const db = await mongodb.getDbSafe();
    const rows = await db
      .collection('admin_audit')
      .aggregate([
        { $match: trendQuery },
        {
          $group: {
            _id: {
              $dateToString: { format: '%Y-%m-%d', date: '$createdAt' },
            },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ])
      .toArray();

    const dailyMap = new Map();
    rows.forEach((row) => {
      if (row._id) {
        dailyMap.set(row._id, row.count || 0);
      }
    });

    const dailyCounts = [];
    const now = new Date();
    for (let i = days - 1; i >= 0; i -= 1) {
      const date = new Date(now);
      date.setDate(now.getDate() - i);
      const key = date.toISOString().slice(0, 10);
      dailyCounts.push({
        date: key,
        count: dailyMap.get(key) || 0,
      });
    }

    const headers = ['date', 'count'];
    const csv = [headers.join(','), ...dailyCounts.map((row) => `${escapeCsv(row.date)},${row.count}`)].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="admin-audit-trend.csv"');
    res.send(csv);
  })
);

// PATCH /api/v1/admin/rate-limits/:id
router.patch(
  '/rate-limits/:id',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const input = req.body?.rateLimits || req.body;

    if (!input || typeof input !== 'object') {
      throw new ValidationError('rateLimits object required');
    }

    const db = await mongodb.getDbSafe();
    const existing = await db.collection('integration_configs').findOne({
      _id: mongodb.toObjectId(id),
    });

    if (!existing) {
      throw new NotFoundError('Integration not found');
    }

    const nextLimits = normalizeRateLimits(input, existing.rateLimits);

    await db
      .collection('integration_configs')
      .updateOne({ _id: mongodb.toObjectId(id) }, { $set: { rateLimits: nextLimits, updatedAt: new Date() } });

    log('info', 'Admin updated rate limits', {
      adminId: req.user?.id,
      integrationId: id,
      orgId: existing.orgId,
      enabled: nextLimits.enabled,
    });

    await auditConfig.rateLimitUpdated(req, id, { before: existing.rateLimits, after: nextLimits });
    res.json({ rateLimits: nextLimits });
  })
);

// POST /api/v1/admin/rate-limits/:id/reset
router.post(
  '/rate-limits/:id/reset',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const db = await mongodb.getDbSafe();
    const integration = await db.collection('integration_configs').findOne({
      _id: mongodb.toObjectId(id),
    });

    if (!integration) {
      throw new NotFoundError('Integration not found');
    }

    const result = await resetRateLimit(id, integration.orgId);
    await auditConfig.rateLimitReset(req, id);
    res.json({ success: true, ...result });
  })
);

// GET /api/v1/admin/ui-config
router.get(
  '/ui-config',
  asyncHandler(async (_req, res) => {
    const config = await data.getUiConfigDefault();
    res.json({ config });
  })
);

// PATCH /api/v1/admin/ui-config
router.patch(
  '/ui-config',
  asyncHandler(async (req, res) => {
    const input = req.body?.config || req.body || {};
    if (!input || typeof input !== 'object') {
      throw new ValidationError('config object required');
    }

    const beforeConfig = await data.getUiConfigDefault().catch(() => null);
    const updated = await data.updateUiConfigDefault(input);
    await auditConfig.uiConfigUpdated(req, { before: beforeConfig, after: updated });
    res.json({ config: updated });
  })
);

// GET /api/v1/admin/system-config
router.get(
  '/system-config',
  asyncHandler(async (_req, res) => {
    const systemConfigData = require('../data/system-config');
    const stored = (await systemConfigData.getSystemConfig()) || {};

    // Merge stored DB values on top of current in-memory config (which already
    // reflects any previous DB overrides applied at startup or last PATCH).
    const safeConfig = {
      security: {
        enforceHttps: stored.security?.enforceHttps ?? config.security?.enforceHttps,
        blockPrivateNetworks: stored.security?.blockPrivateNetworks ?? config.security?.blockPrivateNetworks,
      },
      worker: { ...config.worker, ...(stored.worker || {}) },
      scheduler: { ...config.scheduler, ...(stored.scheduler || {}) },
      eventSource: { ...config.eventSource, ...(stored.eventSource || {}) },
      kafka: { ...config.kafka, ...(stored.kafka || {}) },
      eventAudit: { ...(config.eventAudit || {}), ...(stored.eventAudit || {}) },
      communicationServiceUrl: stored.communicationServiceUrl ?? config.communicationServiceUrl,
      frontendUrl: stored.frontendUrl ?? config.frontendUrl,
    };
    res.json({ config: safeConfig });
  })
);

// PATCH /api/v1/admin/system-config
router.patch(
  '/system-config',
  asyncHandler(async (req, res) => {
    const input = req.body?.config || req.body || {};
    if (!input || typeof input !== 'object') {
      throw new ValidationError('config object required');
    }

    const systemConfigData = require('../data/system-config');
    const stored = (await systemConfigData.getSystemConfig()) || {};

    const patch = {};

    if (input.security && typeof input.security === 'object') {
      patch.security = {
        ...(stored.security || {}),
        enforceHttps: input.security.enforceHttps ?? stored.security?.enforceHttps ?? config.security.enforceHttps,
        blockPrivateNetworks:
          input.security.blockPrivateNetworks ??
          stored.security?.blockPrivateNetworks ??
          config.security.blockPrivateNetworks,
      };
    }

    if (input.worker && typeof input.worker === 'object') {
      patch.worker = { ...(stored.worker || {}), ...input.worker };
    }

    if (input.scheduler && typeof input.scheduler === 'object') {
      patch.scheduler = { ...(stored.scheduler || {}), ...input.scheduler };
    }

    if (input.eventSource && typeof input.eventSource === 'object') {
      patch.eventSource = { ...(stored.eventSource || {}), ...input.eventSource };
    }

    if (input.kafka && typeof input.kafka === 'object') {
      patch.kafka = { ...(stored.kafka || {}), ...input.kafka };
    }

    if (input.eventAudit && typeof input.eventAudit === 'object') {
      patch.eventAudit = { ...(stored.eventAudit || {}), ...input.eventAudit };
    }

    if (typeof input.communicationServiceUrl === 'string') {
      patch.communicationServiceUrl = input.communicationServiceUrl;
    }

    if (typeof input.frontendUrl === 'string') {
      patch.frontendUrl = input.frontendUrl;
    }

    // Persist to MongoDB
    await systemConfigData.updateSystemConfig(patch);

    // Apply to in-memory config immediately — no restart required
    await systemConfigData.applyRuntimeConfig();

    log('info', 'System config updated via admin', { adminId: req.user?.id });

    await auditConfig.systemConfigUpdated(req, { before: stored, after: patch });
    res.json({ message: 'Config updated and applied immediately.' });
  })
);

// GET /api/v1/admin/mysql-pool
router.get(
  '/mysql-pool',
  asyncHandler(async (_req, res) => {
    const systemConfigData = require('../data/system-config');
    const cfg = await systemConfigData.getMysqlPoolConfig();
    res.json({
      config: cfg || {},
      isConfigured: !!cfg?.host,
    });
  })
);

// PUT /api/v1/admin/mysql-pool
router.put(
  '/mysql-pool',
  asyncHandler(async (req, res) => {
    const { host, user, password, database, port, connectionLimit, queueLimit } = req.body || {};

    if (!host || typeof host !== 'string') throw new ValidationError('host is required');
    if (!user || typeof user !== 'string') throw new ValidationError('user is required');
    if (!password || typeof password !== 'string') throw new ValidationError('password is required');
    if (!database || typeof database !== 'string') throw new ValidationError('database is required');

    const credentials = {
      host: String(host).trim(),
      port: port ? Number(port) : 3306,
      user: String(user).trim(),
      password: String(password),
      database: String(database).trim(),
    };
    if (connectionLimit !== undefined) credentials.connectionLimit = Math.min(20, Math.max(1, Number(connectionLimit)));
    if (queueLimit !== undefined) credentials.queueLimit = Math.min(200, Math.max(0, Number(queueLimit)));

    const systemConfigData = require('../data/system-config');
    const before = await systemConfigData.getMysqlPoolConfig();

    await systemConfigData.upsertMysqlPoolConfig(credentials);

    const db = require('../db');
    const result = await db.reinitPool(credentials);

    if (!result.success) {
      // Roll back the saved config? Leave it — admin can correct and retry.
      return res.status(400).json({ success: false, error: result.error });
    }

    await auditConfig.systemConfigUpdated(req, {
      before,
      after: { ...credentials, password: '****' },
    });

    res.json({ success: true, message: 'MySQL pool reconfigured and connected.' });
  })
);

// POST /api/v1/admin/mysql-pool/test
router.post(
  '/mysql-pool/test',
  asyncHandler(async (req, res) => {
    const { host, user, password, database, port, connectionLimit, queueLimit } = req.body || {};

    if (!host || typeof host !== 'string') throw new ValidationError('host is required');
    if (!user || typeof user !== 'string') throw new ValidationError('user is required');
    if (!password || typeof password !== 'string') throw new ValidationError('password is required');
    if (!database || typeof database !== 'string') throw new ValidationError('database is required');

    // Direct connection test — do not use event-source-tester which requires
    // a full event source config (table, columnMapping, etc.).
    const mysql = require('mysql2/promise');
    let pool;
    try {
      pool = mysql.createPool({
        host: String(host).trim(),
        port: port ? Number(port) : 3306,
        user: String(user).trim(),
        password: String(password),
        database: String(database).trim(),
        connectionLimit: 2,
        waitForConnections: true,
        connectTimeout: 10000,
      });
      const conn = await pool.getConnection();
      await conn.query('SELECT 1');
      conn.release();
      res.json({ success: true, message: `Connected to ${String(database).trim()} on ${String(host).trim()} successfully.` });
    } catch (err) {
      res.json({ success: false, error: err.message, code: err.code || 'CONNECTION_FAILED' });
    } finally {
      if (pool) {
        try { await pool.end(); } catch (_) {}
      }
    }
  })
);

/**
 * GET /api/v1/admin/memory-stats
 * Get current memory usage statistics
 */
router.get(
  '/memory-stats',
  asyncHandler(async (_req, res) => {
    const memoryMonitor = new MemoryMonitor();
    const stats = memoryMonitor.getMemoryStats();
    const report = memoryMonitor.getMemoryReport();

    res.json({
      stats,
      report,
      timestamp: new Date().toISOString(),
    });
  })
);

/**
 * POST /api/v1/admin/force-gc
 * Force garbage collection (requires --expose-gc flag)
 */
router.post(
  '/force-gc',
  asyncHandler(async (_req, res) => {
    const memoryMonitor = new MemoryMonitor();
    const result = memoryMonitor.forceGC();

    if (result) {
      res.json({
        success: true,
        message: 'Garbage collection forced',
        result,
        timestamp: new Date().toISOString(),
      });
    } else {
      res.status(400).json({
        success: false,
        error: 'Garbage collection not available. Start Node.js with --expose-gc flag.',
        timestamp: new Date().toISOString(),
      });
    }
  })
);

module.exports = router;
const parseDayCount = (value, fallback = 7) => {
  const num = Number(value);
  if (Number.isFinite(num) && num > 0 && num <= 365) {
    return Math.floor(num);
  }
  return fallback;
};
