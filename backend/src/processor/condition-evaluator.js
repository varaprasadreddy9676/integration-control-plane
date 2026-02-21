const { log } = require('../logger');

function evaluateCondition(condition, context) {
  if (!condition) return true; // No condition = always execute

  try {
    // Create a safe evaluation context with limited scope
    const func = new Function(...Object.keys(context), `return Boolean(${condition});`);
    return func(...Object.values(context));
  } catch (err) {
    log('error', 'Condition evaluation failed', {
      condition,
      error: err.message
    });
    return false; // Failed conditions are treated as false
  }
}

module.exports = {
  evaluateCondition
};
