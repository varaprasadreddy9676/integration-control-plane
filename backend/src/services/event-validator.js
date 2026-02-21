/**
 * Event Validator Service
 *
 * Multi-layer validation and sanitization for bulk event import
 */

const config = require('../config');

/**
 * Validate a single event object
 * @param {Object} event - Event object to validate
 * @param {Number} index - Array index for error reporting
 * @returns {Object} { valid: Boolean, errors: Array, event: Object }
 */
function validateEvent(event, index) {
  const errors = [];

  // Required fields validation
  if (!event.eventType || typeof event.eventType !== 'string') {
    errors.push('eventType is required and must be a string');
  }

  if (event.tenantId !== undefined) {
    errors.push('tenantId is not supported; use orgId');
  }

  if (!event.orgId || !Number.isInteger(event.orgId)) {
    errors.push('orgId is required and must be an integer');
  }

  if (!event.payload || typeof event.payload !== 'object' || Array.isArray(event.payload)) {
    errors.push('payload is required and must be an object');
  }

  // Payload size validation
  if (event.payload) {
    try {
      const payloadSize = JSON.stringify(event.payload).length;
      const maxSize = config.eventAudit?.maxPayloadSize || 10000000; // 10MB default

      if (payloadSize > maxSize) {
        errors.push({
          message: `Payload size ${payloadSize} bytes exceeds maximum ${maxSize} bytes`,
          code: 'PAYLOAD_TOO_LARGE',
          details: { payloadSize, maxSize }
        });
      }
    } catch (e) {
      errors.push('Payload contains non-serializable data');
    }
  }

  // Sanitize string fields (XSS prevention)
  if (event.eventType) {
    event.eventType = sanitizeString(event.eventType);
  }

  if (event.source) {
    event.source = sanitizeString(event.source);
  }

  if (event.sourceId) {
    event.sourceId = sanitizeString(event.sourceId);
  }

  // Sanitize payload object recursively
  if (event.payload && typeof event.payload === 'object') {
    event.payload = sanitizeObject(event.payload);
  }

  return {
    valid: errors.length === 0,
    errors,
    event // Return sanitized event
  };
}

/**
 * Sanitize a string by removing potential XSS vectors
 * @param {String} str - String to sanitize
 * @returns {String} Sanitized string
 */
function sanitizeString(str) {
  if (typeof str !== 'string') {
    return str;
  }

  return String(str)
    // Remove script tags
    .replace(/<script[^>]*>.*?<\/script>/gi, '')
    // Remove iframe tags
    .replace(/<iframe[^>]*>.*?<\/iframe>/gi, '')
    // Remove javascript: protocol
    .replace(/javascript:/gi, '')
    // Remove event handlers
    .replace(/on\w+\s*=/gi, '')
    // Remove data: protocol
    .replace(/data:text\/html/gi, '')
    .trim()
    .substring(0, 10000); // Max string length
}

/**
 * Recursively sanitize an object
 * @param {*} obj - Object to sanitize
 * @returns {*} Sanitized object
 */
function sanitizeObject(obj) {
  if (typeof obj === 'string') {
    return sanitizeString(obj);
  }

  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeObject(item));
  }

  if (obj && typeof obj === 'object') {
    const sanitized = {};
    for (const [key, value] of Object.entries(obj)) {
      // Sanitize key names too (prevent prototype pollution)
      const sanitizedKey = sanitizeString(key);
      if (sanitizedKey !== '__proto__' && sanitizedKey !== 'constructor' && sanitizedKey !== 'prototype') {
        sanitized[sanitizedKey] = sanitizeObject(value);
      }
    }
    return sanitized;
  }

  return obj;
}

/**
 * Validate event count
 * @param {Array} events - Array of events
 * @param {Number} maxCount - Maximum allowed events
 * @returns {Boolean} True if valid
 * @throws {Error} If validation fails
 */
function validateEventCount(events, maxCount = 1000) {
  if (!Array.isArray(events)) {
    throw new Error('events must be an array');
  }

  if (events.length === 0) {
    throw new Error('events array cannot be empty');
  }

  if (events.length > maxCount) {
    throw new Error(`Cannot import more than ${maxCount} events. Found ${events.length}`);
  }

  return true;
}

module.exports = {
  validateEvent,
  validateEventCount,
  sanitizeObject,
  sanitizeString
};
