const { log } = require('../logger');

// Simple in-memory rate limiting
const requestCounts = new Map();
const WINDOW_MS = 60 * 1000; // 1 minute window
const MAX_REQUESTS_PER_WINDOW = 100; // 100 requests per minute

function cleanupOldEntries() {
  const now = Date.now();
  for (const [key, data] of requestCounts.entries()) {
    if (now - data.resetTime > WINDOW_MS) {
      requestCounts.delete(key);
    }
  }
}

function getRateLimitKey(req) {
  // Use API key + IP as rate limit key
  const apiKey = req.headers['x-api-key'] || req.headers['X-API-Key'];
  const ip = req.ip || req.connection.remoteAddress;
  return `${apiKey}-${ip}`;
}

function rateLimit(req, res, next) {
  const key = getRateLimitKey(req);
  const now = Date.now();

  // Clean old entries periodically
  if (requestCounts.size > 10000) {
    cleanupOldEntries();
  }

  const requestData = requestCounts.get(key) || { count: 0, resetTime: now };

  // Reset window if expired
  if (now - requestData.resetTime > WINDOW_MS) {
    requestData.count = 0;
    requestData.resetTime = now;
  }

  // Increment count
  requestData.count++;
  requestCounts.set(key, requestData);

  // Check if over limit
  if (requestData.count > MAX_REQUESTS_PER_WINDOW) {
    log('warn', 'Rate limit exceeded', {
      key: key,
      count: requestData.count,
      limit: MAX_REQUESTS_PER_WINDOW,
    });

    return res.status(429).json({
      error: 'Too many requests',
      code: 'RATE_LIMIT_EXCEEDED',
      retryAfter: Math.ceil(WINDOW_MS / 1000), // seconds until reset
    });
  }

  // Add rate limit headers
  const remaining = MAX_REQUESTS_PER_WINDOW - requestData.count;
  const resetTime = Math.ceil((requestData.resetTime + WINDOW_MS - now) / 1000);

  res.set({
    'X-RateLimit-Limit': MAX_REQUESTS_PER_WINDOW,
    'X-RateLimit-Remaining': remaining,
    'X-RateLimit-Reset': resetTime,
  });

  next();
}

module.exports = rateLimit;
