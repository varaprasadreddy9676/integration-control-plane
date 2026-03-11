const { log, logError } = require('../logger');

/**
 * Enhanced error handler middleware with:
 * - Request ID tracking for debugging
 * - Proper HTTP status codes based on error type
 * - Structured JSON error responses
 * - Detailed logging
 */
function errorHandler(err, req, res, _next) {
  // Generate request ID if not present (for correlation)
  const requestId = req.id || req.headers['x-request-id'] || generateRequestId();

  // Determine status code based on error type
  let statusCode = 500;
  let errorCode = 'INTERNAL_ERROR';
  let message = 'Internal Server Error';
  let details = undefined;

  // Handle different error types
  if (err.name === 'ValidationError') {
    statusCode = 400;
    errorCode = 'VALIDATION_ERROR';
    message = err.message || 'Validation failed';
    details = err.details || err.errors;
  } else if (err.name === 'UnauthorizedError' || err.statusCode === 401) {
    statusCode = 401;
    errorCode = 'UNAUTHORIZED';
    message = err.message || 'Unauthorized';
  } else if (err.name === 'ForbiddenError' || err.statusCode === 403) {
    statusCode = 403;
    errorCode = 'FORBIDDEN';
    message = err.message || 'Forbidden';
  } else if (err.name === 'NotFoundError' || err.statusCode === 404) {
    statusCode = 404;
    errorCode = 'NOT_FOUND';
    message = err.message || 'Resource not found';
  } else if (err.name === 'ConflictError' || err.statusCode === 409) {
    statusCode = 409;
    errorCode = 'CONFLICT';
    message = err.message || 'Resource conflict';
  } else if (err.name === 'RateLimitError' || err.statusCode === 429) {
    statusCode = 429;
    errorCode = 'RATE_LIMIT_EXCEEDED';
    message = err.message || 'Too many requests';
  } else if (err.statusCode >= 400 && err.statusCode < 600) {
    // Use error's status code if it's a valid HTTP status
    statusCode = err.statusCode;
    errorCode = err.code || 'HTTP_ERROR';
    message = err.message || 'Request failed';
  } else if (err.message) {
    message = err.message;
  }

  // Log error with context
  logError(err, {
    requestId,
    path: req.path,
    method: req.method,
    statusCode,
    errorCode,
    entityParentRid: req.entityParentRid,
    query: req.query,
    body: req.method !== 'GET' ? sanitizeBody(req.body) : undefined,
    userAgent: req.headers['user-agent'],
    ip: req.ip || req.connection.remoteAddress
  });

  // Build error response
  const errorResponse = {
    error: message,
    code: errorCode,
    requestId,
    timestamp: new Date().toISOString()
  };

  // Add details in development mode
  if (process.env.NODE_ENV !== 'production') {
    errorResponse.details = details;
    errorResponse.stack = err.stack;
    errorResponse.path = req.path;
  } else if (details) {
    // Include details even in production for validation errors
    errorResponse.details = details;
  }

  // Send JSON response
  res.status(statusCode).json(errorResponse);
}

/**
 * Generate a unique request ID
 */
function generateRequestId() {
  return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Sanitize request body to remove sensitive data before logging
 */
function sanitizeBody(body) {
  if (!body || typeof body !== 'object') {
    return body;
  }

  const sanitized = { ...body };
  const sensitiveFields = ['password', 'secret', 'token', 'apiKey', 'api_key', 'authorization'];

  for (const field of sensitiveFields) {
    if (field in sanitized) {
      sanitized[field] = '[REDACTED]';
    }
  }

  return sanitized;
}

module.exports = errorHandler;
