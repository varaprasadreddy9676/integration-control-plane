/**
 * Custom error classes for structured error handling
 * These errors will be caught by the error handler middleware
 * and converted to appropriate HTTP responses
 */

/**
 * Base application error class
 */
class AppError extends Error {
  constructor(message, statusCode = 500, code = 'APP_ERROR', details = null) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Validation error (400)
 */
class ValidationError extends AppError {
  constructor(message = 'Validation failed', details = null) {
    super(message, 400, 'VALIDATION_ERROR', details);
  }
}

/**
 * Unauthorized error (401)
 */
class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super(message, 401, 'UNAUTHORIZED');
  }
}

/**
 * Forbidden error (403)
 */
class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super(message, 403, 'FORBIDDEN');
  }
}

/**
 * Not found error (404)
 */
class NotFoundError extends AppError {
  constructor(message = 'Resource not found', resource = null) {
    super(message, 404, 'NOT_FOUND', resource ? { resource } : null);
  }
}

/**
 * Conflict error (409)
 */
class ConflictError extends AppError {
  constructor(message = 'Resource conflict', details = null) {
    super(message, 409, 'CONFLICT', details);
  }
}

/**
 * Rate limit error (429)
 */
class RateLimitError extends AppError {
  constructor(message = 'Too many requests', retryAfter = null) {
    super(message, 429, 'RATE_LIMIT_EXCEEDED', retryAfter ? { retryAfter } : null);
  }
}

/**
 * Internal server error (500)
 */
class InternalServerError extends AppError {
  constructor(message = 'Internal server error') {
    super(message, 500, 'INTERNAL_ERROR');
  }
}

/**
 * Service unavailable error (503)
 */
class ServiceUnavailableError extends AppError {
  constructor(message = 'Service temporarily unavailable') {
    super(message, 503, 'SERVICE_UNAVAILABLE');
  }
}

module.exports = {
  AppError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  RateLimitError,
  InternalServerError,
  ServiceUnavailableError,
};
