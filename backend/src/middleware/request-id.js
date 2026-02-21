/**
 * Request ID middleware for tracking requests across the system
 * Adds a unique ID to each request for correlation and debugging
 */

/**
 * Generate a unique request ID
 */
function generateRequestId() {
  return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Middleware to add request ID to all requests
 * Uses existing X-Request-ID header or generates a new one
 */
function requestIdMiddleware(req, res, next) {
  // Use existing request ID from header, or generate new one
  const requestId = req.headers['x-request-id'] || generateRequestId();

  // Attach to request object
  req.id = requestId;

  // Add to response headers for client correlation
  res.setHeader('X-Request-ID', requestId);

  next();
}

module.exports = requestIdMiddleware;
