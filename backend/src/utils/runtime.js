const crypto = require('crypto');

let fetchFn = null;
if (typeof global.fetch === 'function') {
  fetchFn = global.fetch.bind(global);
} else {
  try {
    // node-fetch v2 is CommonJS and compatible with Node 14
    fetchFn = require('node-fetch');
  } catch (_err) {
    throw new Error('fetch is not available; install node-fetch');
  }
}

let AbortControllerImpl = global.AbortController;
if (!AbortControllerImpl) {
  try {
    AbortControllerImpl = require('abort-controller');
  } catch (_err) {
    throw new Error('AbortController is not available; install abort-controller');
  }
}

function uuidv4() {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const bytes = crypto.randomBytes(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20, 32)].join('-');
}

module.exports = {
  fetch: fetchFn,
  AbortController: AbortControllerImpl,
  uuidv4,
};
