const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const data = require('../data');
const config = require('../config');
const { log } = require('../logger');
const auth = require('../middleware/auth');
const asyncHandler = require('../utils/async-handler');
const { UnauthorizedError, ForbiddenError, ValidationError, NotFoundError } = require('../utils/errors');
const { auditAuth, auditAdmin } = require('../middleware/audit');
const profileData = require('../data/portal-access-profiles');

const router = express.Router();

// ── Simple in-memory rate limiter for portal launch/refresh ───────────────────
// Keyed by IP. Resets on restart. For production use Redis-backed rate limiting.
const _launchAttempts = new Map();

function checkPortalRateLimit(ip) {
  const max = config.portal?.launchRateLimitMax ?? 20;
  const windowMs = (config.portal?.launchRateLimitWindowSeconds ?? 60) * 1000;
  const now = Date.now();
  const entry = _launchAttempts.get(ip) || { count: 0, resetAt: now + windowMs };
  if (now > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + windowMs;
  }
  entry.count += 1;
  _launchAttempts.set(ip, entry);
  if (entry.count > max) {
    throw new UnauthorizedError(`Too many portal launch attempts. Try again after ${Math.ceil((entry.resetAt - now) / 1000)}s`);
  }
}

function buildUserResponse(user) {
  return {
    id: user._id ? user._id.toString() : user.id,
    email: user.email,
    role: user.role,
    orgId: user.orgId || null,
    isActive: user.isActive !== false,
  };
}

function signAccessToken(payload) {
  const jwtSecret = config.security?.jwtSecret;
  const expiresIn = config.security?.jwtExpiresIn || '12h';

  if (!jwtSecret) {
    throw new Error('JWT secret is not configured');
  }

  return jwt.sign(payload, jwtSecret, { expiresIn });
}

// POST /api/v1/auth/login
router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { email, password } = req.body || {};
    let user = null;
    let accessToken = null;

    try {
      if (!email || !password) {
        throw new ValidationError('Email and password are required');
      }

      user = await data.getUserByEmail(email);
      if (!user || user.isActive === false) {
        await auditAuth.login(false, { email }, 'Invalid credentials')(req, res);
        throw new UnauthorizedError('Invalid credentials');
      }

      const ok = await bcrypt.compare(password, user.passwordHash || '');
      if (!ok) {
        await auditAuth.login(false, user, 'Invalid password')(req, res);
        throw new UnauthorizedError('Invalid credentials');
      }

      // SUPER_ADMIN has global access, doesn't need orgId
      if (user.role !== 'SUPER_ADMIN' && !user.orgId) {
        throw new ValidationError('orgId is required for organization-scoped users');
      }

      const tokenPayload = {
        sub: user._id.toString(),
        email: user.email,
        role: user.role,
        orgId: user.orgId || null,
      };

      accessToken = signAccessToken(tokenPayload);
      await data.setUserLastLogin(user._id);

      // Audit successful login
      await auditAuth.login(true, user)(req, res);

      log('info', 'User login success', {
        userId: user._id.toString(),
        role: user.role,
        orgId: user.orgId || null,
      });
    } catch (error) {
      // Audit failed login if we have user info
      if (user && error.statusCode === 401) {
        await auditAuth.login(false, user, error.message)(req, res);
      }
      throw error;
    }

    res.json({
      accessToken,
      user: buildUserResponse(user),
    });
  })
);

// GET /api/v1/auth/me
router.get(
  '/me',
  auth,
  asyncHandler(async (req, res) => {
    if (req.authType !== 'jwt') {
      throw new UnauthorizedError('JWT authentication required');
    }

    res.json({
      user: req.user,
      impersonatedBy: req.user?.impersonatedBy || null,
    });
  })
);

// POST /api/v1/auth/impersonate
router.post(
  '/impersonate',
  auth,
  asyncHandler(async (req, res) => {
    if (req.authType !== 'jwt') {
      throw new UnauthorizedError('JWT authentication required');
    }

    // Only SUPER_ADMIN can impersonate
    if (req.user?.role !== 'SUPER_ADMIN') {
      throw new ForbiddenError('Super Admin role required for impersonation');
    }

    const { orgId, role = 'ORG_ADMIN', userId } = req.body || {};
    const allowedRoles = ['ORG_ADMIN', 'ORG_USER'];

    let targetOrgId = orgId ? Number(orgId) : null;
    let targetRole = role;
    let targetEmail = req.user.email;
    let targetSub = req.user.id;

    if (userId) {
      const targetUser = await data.getUserById(userId);
      if (!targetUser || targetUser.isActive === false) {
        throw new ValidationError('Target user not found or inactive');
      }

      if (!allowedRoles.includes(targetUser.role)) {
        throw new ValidationError('Target user role is not impersonatable');
      }

      targetOrgId = targetUser.orgId;
      targetRole = targetUser.role;
      targetEmail = targetUser.email;
      targetSub = targetUser._id.toString();
    }

    if (!targetOrgId || !Number.isFinite(targetOrgId)) {
      throw new ValidationError('orgId is required for impersonation');
    }

    if (!allowedRoles.includes(targetRole)) {
      throw new ValidationError('Invalid impersonation role');
    }

    const tokenPayload = {
      sub: targetSub,
      email: targetEmail,
      role: targetRole,
      orgId: targetOrgId,
      impersonatedBy: req.user.id,
      impersonated: true,
    };

    const accessToken = signAccessToken(tokenPayload);

    log('info', 'Admin impersonation created', {
      adminId: req.user.id,
      targetOrgId,
      targetRole,
      targetUserId: userId || null,
    });

    await auditAdmin.impersonated(req, { id: targetSub, email: targetEmail, role: targetRole });

    res.json({
      accessToken,
      user: {
        id: targetSub,
        email: targetEmail,
        role: targetRole,
        orgId: targetOrgId,
      },
      impersonatedBy: req.user.id,
    });
  })
);

// POST /api/v1/auth/portal-session
// LEGACY: Generates a short-lived, org-scoped magic link token for the embeddable portal.
// Kept for backwards compatibility. Will be deprecated once PORTAL_SCOPED_ACCESS_ENABLED=true
// and all callers have migrated to /portal/launch.
// This endpoint must be called via an admin API key, NOT a user JWT.
router.post(
  '/portal-session',
  auth,
  asyncHandler(async (req, res) => {
    // Block if new scoped system is fully enabled and legacy is turned off
    if (config.portal?.scopedAccessEnabled) {
      return res.status(410).json({
        error: 'Legacy portal sessions are disabled. Use the Portal Access Profile system: POST /portal-profiles then GET /portal/launch.',
        code: 'PORTAL_LEGACY_DISABLED',
      });
    }

    // 1. Must use API Key auth or be a SUPER_ADMIN
    const isSuperAdmin = req.authType === 'jwt' && req.user?.role === 'SUPER_ADMIN';
    if (req.authType !== 'apiKey' && !isSuperAdmin) {
      throw new UnauthorizedError('API Key or Super Admin authentication required to generate portal sessions');
    }

    // 2. Body validation
    const { orgId, expiresInHours = 2, role = 'VIEWER' } = req.body || {};

    if (!orgId || !Number.isFinite(Number(orgId))) {
      throw new ValidationError('orgId is required to generate a portal session');
    }

    // Restrict the roles that can be granted via portal session
    const allowedRoles = ['VIEWER', 'INTEGRATION_EDITOR'];
    if (!allowedRoles.includes(role)) {
      throw new ValidationError(`Invalid role. Must be one of: ${allowedRoles.join(', ')}`);
    }

    // 3. Generate a highly restricted token
    // We use a pseudo-user ID and flag it as a portal session
    const targetOrgId = Number(orgId);
    const jwtSecret = config.security?.jwtSecret;

    if (!jwtSecret) {
      throw new Error('JWT secret is not configured');
    }

    const tokenPayload = {
      sub: `portal_session_${targetOrgId}`,
      email: `portal-user@org-${targetOrgId}.local`,
      role: role,
      orgId: targetOrgId,
      isPortalSession: true,
    };

    const expiresInStr = `${Math.min(Number(expiresInHours), 24)}h`; // Max 24 hours

    const accessToken = jwt.sign(tokenPayload, jwtSecret, { expiresIn: expiresInStr });

    log('info', 'Portal session generated (legacy)', {
      orgId: targetOrgId,
      role,
      expiresInHours,
      callerApiKeyId: req.user?.id,
    });

    // 4. Return the token and a ready-to-use URL
    const frontendBase = (config.frontendUrl || 'http://localhost:5174').replace(/\/$/, '');
    const portalUrl = `${frontendBase}/integrations?token=${accessToken}&embedded=true`;

    res.json({
      accessToken,
      portalUrl,
      expiresIn: expiresInStr,
      session: {
        orgId: targetOrgId,
        role,
      },
    });
  })
);

// ── Portal launch/refresh (new scoped system) ─────────────────────────────────

/**
 * POST /api/v1/auth/portal/launch
 * Exchange a stable launch credential (profileId + linkSecret) for a short-lived
 * access token and refresh token.
 *
 * Body: { pid: string, secret: string }
 *
 * Optional header: Origin — checked against profile.allowedOrigins if configured.
 */
router.post(
  '/portal/launch',
  asyncHandler(async (req, res) => {
    // Kill-switch
    if (config.portal?.launchDisabled) {
      return res.status(503).json({
        error: 'Portal launch is temporarily disabled',
        code: 'PORTAL_LAUNCH_DISABLED',
      });
    }

    // Rate limit by IP
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    checkPortalRateLimit(ip);

    const { pid, secret } = req.body || {};
    if (!pid || typeof pid !== 'string') throw new ValidationError('pid is required');
    if (!secret || typeof secret !== 'string') throw new ValidationError('secret is required');

    // Verify secret against stored hash
    const { valid, profile } = await profileData.verifyProfileSecret(pid, secret);

    if (!valid || !profile) {
      log('warn', '[portal] Launch failed: invalid credentials', { pid, ip });
      throw new UnauthorizedError('Invalid or expired portal credentials');
    }

    if (!profile.isActive) {
      throw new UnauthorizedError('This portal profile has been disabled');
    }

    // Optional: check allowedOrigins (iframe origin guard)
    const origin = req.headers.origin || req.headers.referer || '';
    if (profile.allowedOrigins && profile.allowedOrigins.length > 0) {
      const originHost = (() => {
        try { return new URL(origin).origin; } catch { return origin; }
      })();
      if (!profile.allowedOrigins.includes(originHost)) {
        log('warn', '[portal] Launch rejected: origin not allowed', {
          pid,
          origin: originHost,
          allowed: profile.allowedOrigins,
        });
        throw new ForbiddenError('Launch request origin is not permitted for this portal profile');
      }
    }

    const jwtSecret = config.security?.jwtSecret;
    if (!jwtSecret) throw new Error('JWT secret is not configured');

    const profileId = profile._id.toString();
    const accessTtl = config.portal?.accessTokenTtl || '1h';
    const refreshTtl = config.portal?.refreshTokenTtl || '7d';

    // Access token — short-lived, carries all scope claims
    const accessPayload = {
      sub: `portal_${profileId}`,
      email: `portal@profile-${profileId}.local`,
      role: profile.role,
      orgId: profile.orgId,
      isPortalSession: true,
      profileId,
      allowedIntegrationIds: profile.allowedIntegrationIds || [],
      allowedTags: profile.allowedTags || [],
      allowedViews: profile.allowedViews || ['dashboard', 'logs'],
      tokenVersion: profile.tokenVersion,
      type: 'portal_access',
    };
    const accessToken = jwt.sign(accessPayload, jwtSecret, { expiresIn: accessTtl });

    // Refresh token — longer-lived, contains only the identity needed to re-issue
    const refreshPayload = {
      sub: `portal_${profileId}`,
      profileId,
      tokenVersion: profile.tokenVersion,
      type: 'portal_refresh',
    };
    const refreshToken = jwt.sign(refreshPayload, jwtSecret, { expiresIn: refreshTtl });

    // Record usage (best-effort)
    profileData.recordProfileUsage(profileId);

    log('info', '[portal] Launch successful', {
      profileId,
      orgId: profile.orgId,
      role: profile.role,
      ip,
    });

    res.json({
      accessToken,
      refreshToken,
      expiresIn: accessTtl,
      profile: {
        id: profileId,
        orgId: profile.orgId,
        role: profile.role,
        allowedIntegrationIds: profile.allowedIntegrationIds,
        allowedTags: profile.allowedTags,
        allowedViews: profile.allowedViews,
      },
    });
  })
);

/**
 * POST /api/v1/auth/portal/refresh
 * Exchange a portal refresh token for a new access token + rotated refresh token.
 *
 * Body: { refreshToken: string }
 */
router.post(
  '/portal/refresh',
  asyncHandler(async (req, res) => {
    if (config.portal?.launchDisabled) {
      return res.status(503).json({
        error: 'Portal is temporarily disabled',
        code: 'PORTAL_LAUNCH_DISABLED',
      });
    }

    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    checkPortalRateLimit(ip);

    const { refreshToken } = req.body || {};
    if (!refreshToken || typeof refreshToken !== 'string') {
      throw new ValidationError('refreshToken is required');
    }

    const jwtSecret = config.security?.jwtSecret;
    if (!jwtSecret) throw new Error('JWT secret is not configured');

    let payload;
    try {
      payload = jwt.verify(refreshToken, jwtSecret);
    } catch (err) {
      throw new UnauthorizedError('Invalid or expired refresh token');
    }

    if (payload.type !== 'portal_refresh') {
      throw new UnauthorizedError('Token is not a portal refresh token');
    }

    // Load the profile and check it is still active and tokenVersion matches
    const profile = await profileData.getProfileWithSecret(payload.profileId);
    if (!profile || !profile.isActive) {
      throw new UnauthorizedError('Portal profile is disabled or does not exist');
    }

    if (profile.tokenVersion !== payload.tokenVersion) {
      log('warn', '[portal] Refresh rejected: tokenVersion mismatch (profile rotated/revoked)', {
        profileId: payload.profileId,
        tokenVersion: payload.tokenVersion,
        currentVersion: profile.tokenVersion,
      });
      throw new UnauthorizedError('Session has been invalidated. Please re-launch the portal.');
    }

    const profileId = profile._id.toString();
    const accessTtl = config.portal?.accessTokenTtl || '1h';
    const refreshTtl = config.portal?.refreshTokenTtl || '7d';

    const accessPayload = {
      sub: `portal_${profileId}`,
      email: `portal@profile-${profileId}.local`,
      role: profile.role,
      orgId: profile.orgId,
      isPortalSession: true,
      profileId,
      allowedIntegrationIds: profile.allowedIntegrationIds || [],
      allowedTags: profile.allowedTags || [],
      allowedViews: profile.allowedViews || ['dashboard', 'logs'],
      tokenVersion: profile.tokenVersion,
      type: 'portal_access',
    };
    const newAccessToken = jwt.sign(accessPayload, jwtSecret, { expiresIn: accessTtl });

    // Rotate the refresh token (new token, same tokenVersion)
    const newRefreshPayload = {
      sub: `portal_${profileId}`,
      profileId,
      tokenVersion: profile.tokenVersion,
      type: 'portal_refresh',
    };
    const newRefreshToken = jwt.sign(newRefreshPayload, jwtSecret, { expiresIn: refreshTtl });

    profileData.recordProfileUsage(profileId);

    res.json({
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      expiresIn: accessTtl,
    });
  })
);

// ── Admin diagnostics ─────────────────────────────────────────────────────────

/**
 * GET /api/v1/auth/portal/config-diagnostics
 * Returns the resolved portal/frontend configuration for admin debugging.
 * Requires SUPER_ADMIN or ADMIN.
 */
router.get(
  '/portal/config-diagnostics',
  auth,
  asyncHandler(async (req, res) => {
    if (!['SUPER_ADMIN', 'ADMIN'].includes(req.user?.role)) {
      throw new ForbiddenError('SUPER_ADMIN or ADMIN role required');
    }
    res.json({
      frontendUrl: config.frontendUrl,
      portalScopedAccessEnabled: config.portal?.scopedAccessEnabled ?? false,
      portalLaunchDisabled: config.portal?.launchDisabled ?? false,
      portalAccessTokenTtl: config.portal?.accessTokenTtl ?? '1h',
      portalRefreshTokenTtl: config.portal?.refreshTokenTtl ?? '7d',
    });
  })
);

module.exports = router;
