/**
 * Async Handler Wrapper for Express 4.x
 *
 * Express 4 doesn't automatically catch rejected promises in async route handlers.
 * This wrapper ensures that any errors in async functions are passed to the error middleware.
 *
 * Usage:
 *   router.get('/path', asyncHandler(async (req, res) => {
 *     const data = await someAsyncOperation();
 *     res.json(data);
 *   }));
 */

const asyncHandler = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

module.exports = asyncHandler;
