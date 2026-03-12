const net = require('net');
const { checkRateLimit } = require('../middleware/rate-limiter');

const DEFAULT_RATE_LIMIT = Object.freeze({
  enabled: false,
  maxRequests: 100,
  windowSeconds: 60,
});

function normalizeIp(ip) {
  if (!ip || typeof ip !== 'string') return null;
  const trimmed = ip.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('::ffff:')) {
    return trimmed.slice(7);
  }
  const zoneIndex = trimmed.indexOf('%');
  return zoneIndex === -1 ? trimmed : trimmed.slice(0, zoneIndex);
}

function normalizeCidrEntry(value) {
  if (typeof value !== 'string') return null;
  const trimmed = normalizeIp(value);
  if (!trimmed) return null;

  if (!trimmed.includes('/')) {
    const version = net.isIP(trimmed);
    if (!version) return null;
    return `${trimmed}/${version === 4 ? 32 : 128}`;
  }

  const [addressRaw, prefixRaw] = trimmed.split('/');
  const address = normalizeIp(addressRaw);
  const prefix = Number(prefixRaw);
  const version = net.isIP(address);
  if (!version) return null;
  const maxPrefix = version === 4 ? 32 : 128;
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > maxPrefix) return null;
  return `${address}/${prefix}`;
}

function ipToBuffer(ip) {
  return net.isIP(ip) === 4
    ? Buffer.from(ip.split('.').map((part) => parseInt(part, 10)))
    : Buffer.from(
        ip
          .split(':')
          .filter(Boolean)
          .map((h) => parseInt(h, 16))
          .flatMap((num) => [(num >> 8) & 0xff, num & 0xff])
      );
}

function cidrToBuffer(cidr) {
  const [address, prefixLength] = cidr.split('/');
  return { buffer: ipToBuffer(address), prefixLength: parseInt(prefixLength, 10) };
}

function isIpInRange(ip, cidr) {
  const normalizedIp = normalizeIp(ip);
  if (!normalizedIp) return false;
  if (!net.isIP(normalizedIp)) return false;
  const ipBuf = ipToBuffer(normalizedIp);
  const { buffer: rangeBuf, prefixLength } = cidrToBuffer(cidr);
  const byteLength = Math.ceil(prefixLength / 8);
  for (let i = 0; i < byteLength; i += 1) {
    const mask = i === byteLength - 1 ? 0xff << (8 - (prefixLength % 8 || 8)) : 0xff;
    if ((ipBuf[i] & mask) !== (rangeBuf[i] & mask)) return false;
  }
  return true;
}

function normalizeOrigin(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const origin = new URL(trimmed).origin;
    if (!origin || origin === 'null') return null;
    return origin;
  } catch (_error) {
    return null;
  }
}

function normalizeStringArray(values, normalizer) {
  if (!Array.isArray(values)) return [];
  const unique = new Set();
  for (const value of values) {
    const normalized = normalizer(value);
    if (normalized) unique.add(normalized);
  }
  return Array.from(unique);
}

function normalizeRateLimit(rateLimit) {
  if (rateLimit === undefined) return undefined;
  if (rateLimit === null) return null;
  return {
    enabled: rateLimit.enabled === true,
    maxRequests: Number.isFinite(Number(rateLimit.maxRequests)) ? Math.max(1, Number(rateLimit.maxRequests)) : DEFAULT_RATE_LIMIT.maxRequests,
    windowSeconds: Number.isFinite(Number(rateLimit.windowSeconds)) ? Math.max(1, Number(rateLimit.windowSeconds)) : DEFAULT_RATE_LIMIT.windowSeconds,
  };
}

function normalizeRequestPolicy(policy, legacyRateLimits = undefined) {
  if (policy === undefined && legacyRateLimits === undefined) return undefined;
  if (policy === null && legacyRateLimits === null) return null;

  const source = policy && typeof policy === 'object' ? policy : {};
  const normalizedRateLimit = normalizeRateLimit(
    source.rateLimit !== undefined ? source.rateLimit : legacyRateLimits
  );

  return {
    allowedIpCidrs: normalizeStringArray(source.allowedIpCidrs, normalizeCidrEntry),
    allowedBrowserOrigins: normalizeStringArray(source.allowedBrowserOrigins, normalizeOrigin),
    rateLimit: normalizedRateLimit === undefined ? { ...DEFAULT_RATE_LIMIT } : (normalizedRateLimit || { ...DEFAULT_RATE_LIMIT }),
  };
}

function getEffectiveRequestPolicy(integration) {
  const normalized = normalizeRequestPolicy(integration?.requestPolicy, integration?.rateLimits);
  if (!normalized) {
    return {
      allowedIpCidrs: [],
      allowedBrowserOrigins: [],
      rateLimit: { ...DEFAULT_RATE_LIMIT },
    };
  }
  return normalized;
}

function getClientIp(req) {
  return normalizeIp(req?.ip || req?.connection?.remoteAddress || req?.socket?.remoteAddress || null);
}

async function evaluateInboundRequestPolicy(req, integration) {
  const policy = getEffectiveRequestPolicy(integration);
  const clientIp = getClientIp(req);
  const originHeader = req?.headers?.origin;
  const normalizedOrigin = normalizeOrigin(originHeader);

  if (policy.allowedIpCidrs.length > 0) {
    const ipAllowed = clientIp && policy.allowedIpCidrs.some((cidr) => isIpInRange(clientIp, cidr));
    if (!ipAllowed) {
      return {
        allowed: false,
        stepStatus: 'failed',
        statusCode: 403,
        code: 'IP_NOT_ALLOWED',
        message: 'Request IP is not allowed for this integration',
        metadata: {
          clientIp,
          allowedIpCidrs: policy.allowedIpCidrs,
        },
      };
    }
  }

  if (policy.allowedBrowserOrigins.length > 0) {
    const originAllowed = normalizedOrigin && policy.allowedBrowserOrigins.includes(normalizedOrigin);
    if (!originAllowed) {
      return {
        allowed: false,
        stepStatus: 'failed',
        statusCode: 403,
        code: 'ORIGIN_NOT_ALLOWED',
        message: 'Request origin is not allowed for this integration',
        metadata: {
          origin: normalizedOrigin || null,
          allowedBrowserOrigins: policy.allowedBrowserOrigins,
        },
      };
    }
  }

  if (policy.rateLimit?.enabled) {
    const rateResult = await checkRateLimit(integration._id.toString(), integration.orgId, policy.rateLimit);
    return {
      allowed: rateResult.allowed,
      statusCode: rateResult.allowed ? 200 : 429,
      code: rateResult.allowed ? 'RATE_LIMIT_OK' : 'RATE_LIMIT_EXCEEDED',
      message: rateResult.allowed
        ? 'Rate limit check passed'
        : 'Too many requests for this integration. Please try again later.',
      headers: {
        'X-RateLimit-Limit': policy.rateLimit.maxRequests,
        'X-RateLimit-Remaining': rateResult.remaining,
        'X-RateLimit-Reset': rateResult.resetAt ? Math.floor(rateResult.resetAt.getTime() / 1000) : '',
        ...(rateResult.retryAfter ? { 'Retry-After': rateResult.retryAfter } : {}),
      },
      metadata: {
        remaining: rateResult.remaining,
        resetAt: rateResult.resetAt,
        maxRequests: policy.rateLimit.maxRequests,
        windowSeconds: policy.rateLimit.windowSeconds,
        retryAfter: rateResult.retryAfter || null,
      },
    };
  }

  return {
    allowed: true,
    statusCode: 200,
    code: 'REQUEST_POLICY_OK',
    message: 'Request policy checks passed',
    metadata: {
      clientIp,
      origin: normalizedOrigin || null,
      allowedIpCidrs: policy.allowedIpCidrs,
      allowedBrowserOrigins: policy.allowedBrowserOrigins,
    },
  };
}

function validateRequestPolicy(policy) {
  if (policy === undefined || policy === null) return null;
  if (typeof policy !== 'object' || Array.isArray(policy)) {
    return 'requestPolicy must be an object when provided';
  }

  if (policy.allowedIpCidrs !== undefined && !Array.isArray(policy.allowedIpCidrs)) {
    return 'requestPolicy.allowedIpCidrs must be an array when provided';
  }

  if (policy.allowedBrowserOrigins !== undefined && !Array.isArray(policy.allowedBrowserOrigins)) {
    return 'requestPolicy.allowedBrowserOrigins must be an array when provided';
  }

  const invalidCidr = (policy.allowedIpCidrs || []).find((entry) => entry && !normalizeCidrEntry(entry));
  if (invalidCidr) {
    return `Invalid CIDR/IP entry: ${invalidCidr}`;
  }

  const invalidOrigin = (policy.allowedBrowserOrigins || []).find((entry) => entry && !normalizeOrigin(entry));
  if (invalidOrigin) {
    return `Invalid browser origin: ${invalidOrigin}`;
  }

  if (policy.rateLimit !== undefined && policy.rateLimit !== null) {
    if (typeof policy.rateLimit !== 'object' || Array.isArray(policy.rateLimit)) {
      return 'requestPolicy.rateLimit must be an object when provided';
    }
  }

  return null;
}

module.exports = {
  DEFAULT_RATE_LIMIT,
  normalizeRateLimit,
  normalizeRequestPolicy,
  getEffectiveRequestPolicy,
  getClientIp,
  evaluateInboundRequestPolicy,
  validateRequestPolicy,
};
