function maskKey(value) {
  if (!value) return '****';
  const safe = String(value);
  if (safe.length <= 8) return '****';
  const prefix = safe.slice(0, 4);
  const suffix = safe.slice(-4);
  return `${prefix}${'*'.repeat(Math.max(0, safe.length - 8))}${suffix}`;
}

/**
 * Mask sensitive data in objects (passwords, tokens, keys, etc.)
 * @param {any} data - Data to mask (object, array, or primitive)
 * @returns {any} - Masked copy of the data
 */
function maskSensitiveData(data) {
  if (!data) return data;

  // Handle primitives
  if (typeof data !== 'object') return data;

  // Handle arrays
  if (Array.isArray(data)) {
    return data.map(item => maskSensitiveData(item));
  }

  // Handle objects
  const masked = {};
  const sensitiveKeys = [
    'password', 'secret', 'token', 'apikey', 'api_key', 'apiKey',
    'authorization', 'auth', 'key', 'privatekey', 'private_key',
    'accesstoken', 'access_token', 'refreshtoken', 'refresh_token',
    'credentials', 'credential'
  ];

  for (const [key, value] of Object.entries(data)) {
    const lowerKey = key.toLowerCase();
    const isSensitive = sensitiveKeys.some(sk => lowerKey.includes(sk));

    if (isSensitive && typeof value === 'string') {
      masked[key] = maskKey(value);
    } else if (typeof value === 'object' && value !== null) {
      masked[key] = maskSensitiveData(value);
    } else {
      masked[key] = value;
    }
  }

  return masked;
}

module.exports = { maskKey, maskSensitiveData };
