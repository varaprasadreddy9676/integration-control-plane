const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const data = require('../data');
const config = require('../config');
const { log } = require('../logger');
const auth = require('../middleware/auth');
const asyncHandler = require('../utils/async-handler');
const { UnauthorizedError, ForbiddenError, ValidationError } = require('../utils/errors');
const { auditAuth, auditAdmin } = require('../middleware/audit');

const router = express.Router();

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
// Generates a short-lived, org-scoped magic link token for the embeddable portal.
// This endpoint must be called via an admin API key, NOT a user JWT.
router.post(
  '/portal-session',
  auth,
  asyncHandler(async (req, res) => {
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

    log('info', 'Portal session generated', {
      orgId: targetOrgId,
      role,
      expiresInHours,
      callerApiKeyId: req.user?.id,
    });

    // 4. Return the token and a ready-to-use URL
    // IMPORTANT: portalUrl uses config.frontendUrl (set FRONTEND_URL env var) so it
    // points at the frontend host, not the backend API host. In production both are
    // typically served from the same nginx, so the origin will match automatically.
    const frontendBase = config.frontendUrl || config.publicUrl || 'http://localhost:5174';
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

module.exports = router;
