const config = require('../config');
const { log } = require('../logger');
const { getDbSafe } = require('../mongodb');

const DEFAULT_MAX_REQUESTS = 100;
const DEFAULT_WINDOW_SECONDS = 60;
const COLLECTION_NAME = 'api_rate_limits';
let indexInitPromise = null;

function maskHeaders(headers = {}) {
  const masked = { ...headers };
  const sensitive = ['authorization', 'x-api-key', 'cookie', 'set-cookie', 'proxy-authorization'];
  for (const key of sensitive) {
    if (masked[key] !== undefined) masked[key] = '[REDACTED]';
    const upper = key.toUpperCase();
    if (masked[upper] !== undefined) masked[upper] = '[REDACTED]';
  }
  return masked;
}

function extractInboundContext(req) {
  const basePrefix = config.api?.basePrefix || '/api/v1';
  const inboundPrefix = `${basePrefix}/integrations/`;
  const path = req.path || '';
  if (!path.startsWith(inboundPrefix)) {
    return null;
  }

  const type = decodeURIComponent(path.slice(inboundPrefix.length)).trim();
  if (!type) return null;

  const orgIdRaw = req.query?.orgId;
  const orgId = Number(orgIdRaw);
  if (!Number.isFinite(orgId) || orgId <= 0) {
    return null;
  }

  return { orgId, type };
}

async function logInboundRateLimitFailure(req, retryAfter) {
  const context = extractInboundContext(req);
  if (!context) return;

  try {
    const db = await getDbSafe();
    const integration = await db.collection('integration_configs').findOne({
      orgId: context.orgId,
      direction: 'INBOUND',
      type: context.type,
      isActive: true,
    });

    const integrationId = integration?._id || null;
    const integrationName = integration?.name || `INBOUND:${context.type}`;
    const now = new Date();
    const traceId = req.id || `trc_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    const requestHeaders = maskHeaders(req.headers || {});

    await db.collection('execution_logs').insertOne({
      traceId,
      messageId: null,
      orgId: context.orgId,
      orgUnitRid: context.orgId,
      webhookName: integrationName,
      webhookConfigId: integrationId,
      transformedPayload: {},
      direction: 'INBOUND',
      triggerType: 'MANUAL',
      integrationConfigId: integrationId,
      __KEEP___KEEP_integrationConfig__Id__: integrationId,
      __KEEP_integrationName__: integrationName,
      eventId: null,
      eventType: context.type,
      actionName: null,
      actionIndex: null,
      status: 'FAILED',
      responseStatus: 429,
      responseBody: JSON.stringify({
        error: 'RATE_LIMIT_EXCEEDED',
        message: 'Global API rate limit exceeded',
        retryAfter,
      }),
      responseTimeMs: 0,
      attemptCount: 1,
      shouldRetry: false,
      lastAttemptAt: now,
      startedAt: now,
      finishedAt: now,
      deliveredAt: now,
      durationMs: 0,
      errorMessage: 'Global API rate limit exceeded',
      errorCategory: 'RATE_LIMIT',
      error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Global API rate limit exceeded', category: 'RATE_LIMIT' },
      originalPayload: req.body || {},
      requestPayload: req.body || {},
      targetUrl: req.originalUrl || req.url,
      httpMethod: req.method || 'POST',
      correlationId: req.id || null,
      requestHeaders,
      searchableText: context.type,
      request: {
        url: req.originalUrl || req.url,
        method: req.method || 'POST',
        query: req.query || {},
        headers: requestHeaders,
        body: req.body || {},
      },
      response: {
        statusCode: 429,
        headers: {},
        body: { error: 'RATE_LIMIT_EXCEEDED', retryAfter },
      },
      steps: [
        {
          name: 'global_rate_limit',
          status: 'failed',
          durationMs: 0,
          metadata: { retryAfter },
          timestamp: now.toISOString(),
        },
      ],
      metadata: { source: 'global_rate_limit_middleware' },
      createdAt: now,
      updatedAt: now,
    });
  } catch (error) {
    log('warn', 'Failed to write inbound rate-limit failure log', {
      path: req.path,
      error: error.message,
    });
  }
}

function getRateLimitKey(req) {
  // Global limiter is intentionally per-IP.
  const forwardedFor = req.headers['x-forwarded-for'];
  if (typeof forwardedFor === 'string' && forwardedFor.trim()) {
    return forwardedFor.split(',')[0].trim();
  }
  return req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress || 'unknown';
}

function getRateLimitSettings() {
  const cfg = config.rateLimit || {};
  const enabled = cfg.enabled !== false;
  const maxRequests = Number.isFinite(Number(cfg.maxRequests))
    ? Math.max(1, Number(cfg.maxRequests))
    : DEFAULT_MAX_REQUESTS;
  const windowSeconds = Number.isFinite(Number(cfg.windowSeconds))
    ? Math.max(1, Number(cfg.windowSeconds))
    : DEFAULT_WINDOW_SECONDS;

  return { enabled, maxRequests, windowSeconds };
}

async function ensureIndexes(db) {
  if (indexInitPromise) {
    return indexInitPromise;
  }

  indexInitPromise = db.collection(COLLECTION_NAME).createIndexes([
    { key: { key: 1, windowStart: 1 }, name: 'key_window_unique_idx', unique: true },
    { key: { windowEnd: 1 }, name: 'window_end_ttl_idx', expireAfterSeconds: 0 },
  ]);

  try {
    await indexInitPromise;
  } catch (error) {
    indexInitPromise = null;
    throw error;
  }
}

async function rateLimit(req, res, next) {
  const settings = getRateLimitSettings();
  if (!settings.enabled) {
    return next();
  }

  const { maxRequests, windowSeconds } = settings;
  const windowMs = windowSeconds * 1000;
  const key = getRateLimitKey(req);
  const now = new Date();
  const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs);
  const windowEnd = new Date(windowStart.getTime() + windowMs);

  try {
    const db = await getDbSafe();
    await ensureIndexes(db);

    const result = await db.collection(COLLECTION_NAME).findOneAndUpdate(
      { key, windowStart },
      {
        $inc: { count: 1 },
        $set: { updatedAt: now, windowEnd },
        $setOnInsert: { key, windowStart, createdAt: now },
      },
      { upsert: true, returnDocument: 'after' }
    );

    const requestCount = result?.value?.count || 1;
    const remaining = Math.max(0, maxRequests - requestCount);
    const resetAtEpoch = Math.floor(windowEnd.getTime() / 1000);
    const retryAfter = Math.max(1, Math.ceil((windowEnd.getTime() - now.getTime()) / 1000));

    res.set({
      'X-RateLimit-Limit': maxRequests,
      'X-RateLimit-Remaining': remaining,
      'X-RateLimit-Reset': resetAtEpoch,
    });

    if (requestCount > maxRequests) {
      log('warn', 'Global API rate limit exceeded', {
        key,
        requestCount,
        maxRequests,
        windowSeconds,
      });

      res.set('Retry-After', retryAfter);
      await logInboundRateLimitFailure(req, retryAfter);
      return res.status(429).json({
        error: 'Too many requests',
        code: 'RATE_LIMIT_EXCEEDED',
        retryAfter,
      });
    }

    return next();
  } catch (error) {
    // Fail open to avoid taking down the API if limiter storage is unavailable.
    log('warn', 'Global rate limit check failed; allowing request', {
      error: error.message,
      key,
    });
    return next();
  }
}

module.exports = rateLimit;
