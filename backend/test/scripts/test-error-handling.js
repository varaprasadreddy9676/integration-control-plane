/**
 * Quick test script for error handling
 * Run with: node test-error-handling.js
 */

const {
  ValidationError,
  UnauthorizedError,
  NotFoundError,
  ConflictError,
  RateLimitError
} = require('./src/utils/errors');

console.log('Testing custom error classes...\n');

// Test ValidationError
try {
  throw new ValidationError('Email is required', { field: 'email' });
} catch (err) {
  console.log('✓ ValidationError:', {
    name: err.name,
    message: err.message,
    statusCode: err.statusCode,
    code: err.code,
    details: err.details
  });
}

// Test UnauthorizedError
try {
  throw new UnauthorizedError('Invalid API key');
} catch (err) {
  console.log('✓ UnauthorizedError:', {
    name: err.name,
    message: err.message,
    statusCode: err.statusCode,
    code: err.code
  });
}

// Test NotFoundError
try {
  throw new NotFoundError('Webhook not found', 'webhook_123');
} catch (err) {
  console.log('✓ NotFoundError:', {
    name: err.name,
    message: err.message,
    statusCode: err.statusCode,
    code: err.code,
    details: err.details
  });
}

// Test ConflictError
try {
  throw new ConflictError('Webhook name already exists', { name: 'my-webhook' });
} catch (err) {
  console.log('✓ ConflictError:', {
    name: err.name,
    message: err.message,
    statusCode: err.statusCode,
    code: err.code,
    details: err.details
  });
}

// Test RateLimitError
try {
  throw new RateLimitError('Too many requests', 60);
} catch (err) {
  console.log('✓ RateLimitError:', {
    name: err.name,
    message: err.message,
    statusCode: err.statusCode,
    code: err.code,
    details: err.details
  });
}

console.log('\n✓ All error classes working correctly!');
