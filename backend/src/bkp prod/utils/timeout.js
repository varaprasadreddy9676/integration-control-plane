/**
 * Simple timeout wrapper for database operations
 * Prevents operations from hanging forever
 */

/**
 * Wrap a promise with a timeout
 * @param {Promise} promise - The promise to wrap
 * @param {number} timeoutMs - Timeout in milliseconds
 * @param {string} operationName - Name for error message
 * @returns {Promise} - Resolves with promise result or rejects on timeout
 */
function withTimeout(promise, timeoutMs, operationName = 'Operation') {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`${operationName} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    })
  ]);
}

module.exports = {
  withTimeout
};
