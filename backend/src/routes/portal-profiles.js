'use strict';

/**
 * Portal Access Profile management routes.
 * All routes require SUPER_ADMIN or ORG_ADMIN (scoped to their own org).
 *
 * POST   /portal-profiles                       — create profile
 * GET    /portal-profiles?orgId=<n>             — list profiles for org
 * GET    /portal-profiles/:id                   — get single profile
 * PATCH  /portal-profiles/:id                   — update profile
 * POST   /portal-profiles/:id/rotate-link       — rotate secret + increment tokenVersion
 * POST   /portal-profiles/:id/revoke-sessions   — increment tokenVersion (invalidate refresh tokens)
 */

const express = require('express');
const auth = require('../middleware/auth');
const asyncHandler = require('../utils/async-handler');
const config = require('../config');
const profileData = require('../data/portal-access-profiles');
const { ValidationError, ForbiddenError, NotFoundError } = require('../utils/errors');
const { log } = require('../logger');

const router = express.Router();

const ALLOWED_ROLES = ['VIEWER', 'INTEGRATION_EDITOR'];
const ALLOWED_VIEWS = ['dashboard', 'logs'];

// ── Authorization helper ───────────────────────────────────────────────────────

/**
 * Determine the effective orgId for this request and assert the caller can
 * manage portal profiles for it.
 *   SUPER_ADMIN / ADMIN  — may pass any orgId via body/query; defaults to req.orgId
 *   ORG_ADMIN            — may only manage their own org
 *   Others               — denied
 */
function resolveOrgId(req, bodyOrgId) {
  const role = req.user?.role;
  const callerOrgId = req.user?.orgId;

  if (role === 'SUPER_ADMIN' || role === 'ADMIN') {
    // req.query.orgId can be an array when the URL has ?orgId=x&orgId=y (e.g. from
    // the frontend auto-appending orgId to a path that already contained it).
    // Always use the first (explicit) value in that case.
    const rawOrgId = bodyOrgId || req.orgId ||
      (Array.isArray(req.query.orgId) ? req.query.orgId[0] : req.query.orgId);
    const target = Number(rawOrgId);
    if (!target || !Number.isFinite(target)) {
      throw new ValidationError('orgId is required');
    }
    return target;
  }

  if (role === 'ORG_ADMIN') {
    if (bodyOrgId && Number(bodyOrgId) !== Number(callerOrgId)) {
      throw new ForbiddenError('ORG_ADMIN can only manage portal profiles for their own org');
    }
    if (!callerOrgId) throw new ValidationError('orgId is required');
    return Number(callerOrgId);
  }

  throw new ForbiddenError('SUPER_ADMIN, ADMIN, or ORG_ADMIN role required');
}

function assertCanManage(req) {
  const role = req.user?.role;
  if (!['SUPER_ADMIN', 'ADMIN', 'ORG_ADMIN'].includes(role)) {
    throw new ForbiddenError('SUPER_ADMIN, ADMIN, or ORG_ADMIN role required');
  }
}

/**
 * Build the stable launch URL for a profile.
 * Format: {frontendBase}/portal/launch?pid={profileId}&secret={linkSecret}
 */
function buildLaunchUrl(profileId, linkSecret) {
  const base = (config.frontendUrl || 'http://localhost:5174').replace(/\/$/, '');
  return `${base}/portal/launch?pid=${profileId}&secret=${linkSecret}`;
}

// ── POST /portal-profiles ──────────────────────────────────────────────────────

router.post(
  '/',
  auth,
  asyncHandler(async (req, res) => {
    assertCanManage(req);
    const {
      orgId: bodyOrgId,
      name,
      role = 'VIEWER',
      allowedIntegrationIds,
      allowedTags,
      allowedViews,
      allowedOrigins,
    } = req.body || {};

    const orgId = resolveOrgId(req, bodyOrgId);

    if (!name || typeof name !== 'string' || !name.trim()) {
      throw new ValidationError('name is required');
    }
    if (!ALLOWED_ROLES.includes(role)) {
      throw new ValidationError(`role must be one of: ${ALLOWED_ROLES.join(', ')}`);
    }
    if (allowedViews !== undefined) {
      const invalid = (allowedViews || []).filter((v) => !ALLOWED_VIEWS.includes(v));
      if (invalid.length) {
        throw new ValidationError(`allowedViews contains invalid entries: ${invalid.join(', ')}`);
      }
    }

    const { profile, linkSecret } = await profileData.createProfile({
      orgId,
      name: name.trim(),
      role,
      allowedIntegrationIds: allowedIntegrationIds || [],
      allowedTags: allowedTags || [],
      allowedViews: allowedViews || ['dashboard', 'logs'],
      allowedOrigins: allowedOrigins || [],
      createdBy: req.user?.id,
    });

    const launchUrl = buildLaunchUrl(profile.id, linkSecret);

    res.status(201).json({
      profile,
      // linkSecret and launchUrl are shown ONCE at creation time.
      // Store them — they cannot be retrieved again (only rotated).
      linkSecret,
      launchUrl,
    });
  })
);

// ── GET /portal-profiles ───────────────────────────────────────────────────────

router.get(
  '/',
  auth,
  asyncHandler(async (req, res) => {
    assertCanManage(req);
    const orgId = resolveOrgId(req, req.query.orgId);
    const profiles = await profileData.listProfiles(orgId);
    res.json({ profiles });
  })
);

// ── GET /portal-profiles/:id ───────────────────────────────────────────────────

router.get(
  '/:id',
  auth,
  asyncHandler(async (req, res) => {
    assertCanManage(req);
    const profile = await profileData.getProfile(req.params.id);
    if (!profile) throw new NotFoundError('Portal access profile not found');

    // ORG_ADMIN scope check
    if (req.user?.role === 'ORG_ADMIN' && profile.orgId !== Number(req.user.orgId)) {
      throw new ForbiddenError('Not authorized to view this profile');
    }

    res.json({ profile });
  })
);

// ── PATCH /portal-profiles/:id ─────────────────────────────────────────────────

router.patch(
  '/:id',
  auth,
  asyncHandler(async (req, res) => {
    assertCanManage(req);
    const existing = await profileData.getProfile(req.params.id);
    if (!existing) throw new NotFoundError('Portal access profile not found');

    if (req.user?.role === 'ORG_ADMIN' && existing.orgId !== Number(req.user.orgId)) {
      throw new ForbiddenError('Not authorized to update this profile');
    }

    const {
      name, role, allowedIntegrationIds, allowedTags, allowedViews, allowedOrigins, isActive,
    } = req.body || {};

    if (role !== undefined && !ALLOWED_ROLES.includes(role)) {
      throw new ValidationError(`role must be one of: ${ALLOWED_ROLES.join(', ')}`);
    }
    if (allowedViews !== undefined) {
      const invalid = (allowedViews || []).filter((v) => !ALLOWED_VIEWS.includes(v));
      if (invalid.length) {
        throw new ValidationError(`allowedViews contains invalid entries: ${invalid.join(', ')}`);
      }
    }

    const updated = await profileData.updateProfile(req.params.id, {
      ...(name !== undefined ? { name: String(name).trim() } : {}),
      ...(role !== undefined ? { role } : {}),
      ...(allowedIntegrationIds !== undefined ? { allowedIntegrationIds } : {}),
      ...(allowedTags !== undefined ? { allowedTags } : {}),
      ...(allowedViews !== undefined ? { allowedViews } : {}),
      ...(allowedOrigins !== undefined ? { allowedOrigins } : {}),
      ...(isActive !== undefined ? { isActive: Boolean(isActive) } : {}),
    });

    if (!updated) throw new NotFoundError('Portal access profile not found');

    log('info', '[portal] Profile updated', {
      profileId: req.params.id,
      updatedBy: req.user?.id,
    });

    res.json({ profile: updated });
  })
);

// ── DELETE /portal-profiles/:id ───────────────────────────────────────────────

router.delete(
  '/:id',
  auth,
  asyncHandler(async (req, res) => {
    assertCanManage(req);
    const existing = await profileData.getProfile(req.params.id);
    if (!existing) throw new NotFoundError('Portal access profile not found');

    if (req.user?.role === 'ORG_ADMIN' && existing.orgId !== Number(req.user.orgId)) {
      throw new ForbiddenError('Not authorized to delete this profile');
    }

    const deleted = await profileData.deleteProfile(req.params.id);
    if (!deleted) throw new NotFoundError('Portal access profile not found');

    log('info', '[portal] Profile deleted', {
      profileId: req.params.id,
      orgId: existing.orgId,
      deletedBy: req.user?.id,
    });

    res.json({ message: 'Portal access profile deleted successfully' });
  })
);

// ── POST /portal-profiles/:id/rotate-link ─────────────────────────────────────

router.post(
  '/:id/rotate-link',
  auth,
  asyncHandler(async (req, res) => {
    assertCanManage(req);
    const existing = await profileData.getProfile(req.params.id);
    if (!existing) throw new NotFoundError('Portal access profile not found');

    if (req.user?.role === 'ORG_ADMIN' && existing.orgId !== Number(req.user.orgId)) {
      throw new ForbiddenError('Not authorized to rotate this profile');
    }

    const result = await profileData.rotateProfileLink(req.params.id, req.user?.id);
    if (!result) throw new NotFoundError('Portal access profile not found');

    const launchUrl = buildLaunchUrl(result.profile.id, result.linkSecret);

    res.json({
      profile: result.profile,
      // New linkSecret + launchUrl shown once; old links are now invalid.
      linkSecret: result.linkSecret,
      launchUrl,
      message: 'Link rotated. All previous launch URLs and session tokens are now invalid.',
    });
  })
);

// ── POST /portal-profiles/:id/revoke-sessions ──────────────────────────────────

router.post(
  '/:id/revoke-sessions',
  auth,
  asyncHandler(async (req, res) => {
    assertCanManage(req);
    const existing = await profileData.getProfile(req.params.id);
    if (!existing) throw new NotFoundError('Portal access profile not found');

    if (req.user?.role === 'ORG_ADMIN' && existing.orgId !== Number(req.user.orgId)) {
      throw new ForbiddenError('Not authorized to revoke sessions for this profile');
    }

    const updated = await profileData.revokeAllSessions(req.params.id, req.user?.id);
    if (!updated) throw new NotFoundError('Portal access profile not found');

    res.json({
      profile: updated,
      message: 'All active sessions revoked. The launch URL is still valid for new sessions.',
    });
  })
);

module.exports = router;
