const jwt = require('jsonwebtoken');
const { log } = require('../logger');
const config = require('../config');
const { UnauthorizedError, ForbiddenError } = require('../utils/errors');
const { getOrgIdFromQuery } = require('../utils/org-context');

const extractOrgIdFromQuery = (req) => {
  const orgId = getOrgIdFromQuery(req.query);
  const usedLegacyKey = !req.query.orgId && (req.query.entityParentRid || req.query.entityparentrid);
  if (usedLegacyKey) {
    log('warn', 'Deprecated query parameter used: entityParentRid. Use orgId instead.', {
      path: req.path,
      requestId: req.id,
    });
  }
  return orgId;
};

const applyOrgContext = (req, orgId) => {
  if (!orgId || !Number.isFinite(orgId) || orgId <= 0) {
    return;
  }
  req.orgId = orgId;
};

function auth(req, res, next) {
  if ((req.query && Object.hasOwn(req.query, 'tenantId')) || (req.body && Object.hasOwn(req.body, 'tenantId'))) {
    return res.status(400).json({
      error: 'tenantId is not supported. Use orgId instead.',
      code: 'TENANT_ID_NOT_ALLOWED',
    });
  }

  const authHeader = req.header('authorization');
  if (authHeader?.toLowerCase().startsWith('bearer ')) {
    const token = authHeader.slice(7).trim();
    const jwtSecret = config.security?.jwtSecret;

    if (!jwtSecret) {
      return next(new UnauthorizedError('JWT secret not configured'));
    }

    try {
      const payload = jwt.verify(token, jwtSecret);
      req.authType = 'jwt';
      req.user = {
        id: payload.sub,
        email: payload.email,
        role: payload.role,
        orgId: payload.orgId || null,
        impersonatedBy: payload.impersonatedBy || null,
        impersonated: !!payload.impersonated,
      };

      if (payload.orgId) {
        applyOrgContext(req, Number(payload.orgId));
      }

      // SUPER_ADMIN and ADMIN can optionally scope requests via orgId query param
      if (req.user.role === 'SUPER_ADMIN' || req.user.role === 'ADMIN') {
        const queryOrgId = extractOrgIdFromQuery(req);
        if (queryOrgId) {
          applyOrgContext(req, queryOrgId);
        }
      }

      return next();
    } catch (err) {
      log('warn', 'Invalid JWT', {
        path: req.path,
        requestId: req.id,
        error: err.message,
      });
      return next(new UnauthorizedError('Invalid token'));
    }
  }

  const apiKey = req.header('x-api-key');
  if (!apiKey) {
    log('warn', 'Missing API key', {
      path: req.path,
      requestId: req.id,
      ip: req.ip || req.connection.remoteAddress,
    });
    return next(new UnauthorizedError('Missing API key'));
  }

  const validApiKey = config.security?.apiKey || 'mdcs_dev_key_1f4a';
  if (apiKey !== validApiKey) {
    log('warn', 'Invalid API key', {
      path: req.path,
      requestId: req.id,
      ip: req.ip || req.connection.remoteAddress,
    });
    return next(new UnauthorizedError('Invalid API key'));
  }

  req.authType = 'apiKey';
  req.user = { id: 'api-key', role: 'API_KEY' };

  // Extract orgId from query parameter and set it on the request object
  const orgId = extractOrgIdFromQuery(req);
  if (orgId) {
    applyOrgContext(req, orgId);
  }

  return next();
}

auth.requireEntity = (req, _res, next) => {
  if (!req.orgId) {
    return next(new UnauthorizedError('Missing orgId query parameter'));
  }
  return next();
};

auth.requireRole = (roles) => (req, _res, next) => {
  const allowed = Array.isArray(roles) ? roles : [roles];
  if (!req.user) {
    return next(new UnauthorizedError('Missing user context'));
  }
  if (!allowed.includes(req.user.role)) {
    return next(new ForbiddenError('Insufficient role'));
  }
  return next();
};

module.exports = auth;
