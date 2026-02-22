const { log } = require('../logger');
const { applyLookups } = require('./lookup-service');

const MAX_DEPTH = 50;

function depth(obj, current = 0) {
  if (obj === null || typeof obj !== 'object') return current;
  for (const key of Object.keys(obj)) {
    if (typeof obj[key] === 'object' && obj[key] !== null) {
      const newDepth = depth(obj[key], current + 1);
      // Return early if max depth exceeded (return actual depth, not capped)
      if (newDepth > MAX_DEPTH) return newDepth;
      current = Math.max(current, newDepth);
    }
  }
  return current;
}

function validateScript(script) {
  if (!script || typeof script !== 'string') return false;
  try {
    // Basic parse check using async wrapper to allow await in script bodies
    // eslint-disable-next-line no-new-func
    new Function('payload', 'context', `async function __transform(payload, context) { ${script} }`);
    return true;
  } catch (err) {
    log('warn', 'Script validation failed', { error: err.message });
    return false;
  }
}

/**
 * Get nested value from object using dot notation
 * e.g., getNestedValue(obj, 'patient.phoneNumber') => obj.patient.phoneNumber
 */
function getNestedValue(obj, path) {
  if (!path || !obj) return undefined;
  const keys = path.split('.');
  let value = obj;
  for (const key of keys) {
    value = value?.[key];
    if (value === undefined) return undefined;
  }
  return value;
}

async function applySimpleTransform(payload, transformation = {}, event = {}) {
  const source = payload && typeof payload === 'object' ? payload : {};
  const result = { ...source }; // Start with original payload, then apply mappings
  const mappings = transformation && Array.isArray(transformation.mappings) ? transformation.mappings : [];

  for (const row of mappings) {
    if (!row.targetField || !row.sourceField) continue;

    // Support nested field access with dot notation
    const sourceVal = getNestedValue(source, row.sourceField);
    let val = sourceVal;

    switch (row.transform) {
      case 'trim':
        val = typeof sourceVal === 'string' ? sourceVal.trim() : sourceVal;
        break;
      case 'upper':
        val = typeof sourceVal === 'string' ? sourceVal.toUpperCase() : sourceVal;
        break;
      case 'lower':
        val = typeof sourceVal === 'string' ? sourceVal.toLowerCase() : sourceVal;
        break;
      case 'date':
        val = sourceVal ? new Date(sourceVal).toISOString() : sourceVal;
        break;
      case 'default':
        val = sourceVal ?? row.defaultValue;
        break;
      case 'lookup':
        if (row.lookupType && sourceVal) {
          // Apply inline lookup transformation
          const { resolveLookup } = require('./lookup-service');
          val = await resolveLookup(sourceVal, row.lookupType, event.orgId, event.orgUnitRid);
          // If no mapping found, keep original value (PASSTHROUGH behavior)
          if (val === null || val === undefined) {
            val = sourceVal;
          }
        }
        break;
      default:
        break;
    }

    if (val !== undefined) {
      result[row.targetField] = val;
    }
  }

  const staticFields = transformation && Array.isArray(transformation.staticFields) ? transformation.staticFields : [];
  staticFields.forEach((field) => {
    if (field?.key) {
      result[field.key] = field.value;
    }
  });

  return result;
}

/**
 * Apply transformation to payload
 * Step 1: Apply standard transformation (SIMPLE or SCRIPT)
 * Step 2: Apply lookups (code mappings)
 */
async function applyTransform(integration, payload, context = {}) {
  if (!integration) return payload;

  // Step 1: Apply standard transformation
  let transformed = payload;
  const event = {
    orgId: context.orgId || integration.orgId,
    orgUnitRid: context.orgUnitRid || integration.orgUnitRid || integration.entityRid,
  };

  switch (integration.transformationMode) {
    case 'SIMPLE':
      transformed = await applySimpleTransform(payload, integration.transformation, event);
      break;
    case 'SCRIPT':
      if (!validateScript(integration.transformation?.script)) {
        throw new Error('Invalid script transformation');
      }
      transformed = await applyScriptTransform(integration.transformation.script, payload, context);
      break;
    default:
      transformed = payload;
  }

  // Step 2: Apply lookups (if configured)
  if (integration.lookups && integration.lookups.length > 0) {
    const event = {
      orgId: context.orgId || integration.orgId,
      orgUnitRid: context.orgUnitRid || integration.orgUnitRid || integration.entityRid,
    };
    transformed = await applyLookups(transformed, integration.lookups, event);
  }

  return transformed;
}

/**
 * Global utility functions available to all transformation scripts
 */
function getGlobalUtilities() {
  // Define epoch as a standalone function so datetime can reference it directly
  const epochFn = (dateStr) => {
    if (!dateStr) return null;
    try {
      let date;
      if (typeof dateStr === 'number') {
        date = dateStr > 10000000000 ? new Date(dateStr) : new Date(dateStr * 1000);
      } else if (dateStr.includes('/')) {
        // Handle DD/MM/YYYY or DD/MM/YYYY HH:MM AM/PM format
        const parts = dateStr.split(' ');
        const [day, month, year] = parts[0].split('/');

        if (parts.length > 1) {
          // Has time component like "04/02/2026 04:07 PM"
          const timeStr = parts.slice(1).join(' ');
          const isoDateStr = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')} ${timeStr}`;
          date = new Date(isoDateStr);
        } else {
          // Date only like "04/02/2026"
          date = new Date(year, month - 1, day);
        }
      } else if (dateStr.match(/^\d{1,2}-[A-Za-z]{3}-\d{4}/)) {
        const parts = dateStr.split(/[\s-]+/);
        const monthMap = {
          jan: 0,
          feb: 1,
          mar: 2,
          apr: 3,
          may: 4,
          jun: 5,
          jul: 6,
          aug: 7,
          sep: 8,
          oct: 9,
          nov: 10,
          dec: 11,
        };
        date = new Date(parts[2], monthMap[parts[1].toLowerCase().substring(0, 3)], parts[0]);
      } else {
        date = new Date(dateStr);
      }
      return Number.isNaN(date.getTime()) ? null : Math.floor(date.getTime() / 1000);
    } catch (_e) {
      return null;
    }
  };

  return {
    // Date/Time utilities
    epoch: epochFn,

    datetime: (date, time, timezone) => {
      if (!date) return null;
      const tz = timezone || '+05:30';
      const dateTimeStr = time ? `${date}T${time}${tz}` : `${date}T00:00:00${tz}`;
      return epochFn(dateTimeStr); // Call epochFn directly instead of this.epoch
    },

    // String utilities
    uppercase: (str) => (str ? String(str).toUpperCase() : str),

    lowercase: (str) => (str ? String(str).toLowerCase() : str),

    trim: (str) => (str ? String(str).trim() : str),

    // Phone utilities
    formatPhone: (phone, countryCode) => {
      if (!phone) return phone;
      const cc = countryCode || '91';
      const cleaned = String(phone).replace(/\D/g, '');
      if (cleaned.startsWith(cc)) return `+${cleaned}`;
      return `+${cc}${cleaned}`;
    },

    // Object utilities
    get: (obj, path, defaultValue) => {
      if (!path || !obj) return defaultValue;
      const keys = path.split('.');
      let value = obj;
      for (const key of keys) {
        value = value?.[key];
        if (value === undefined) return defaultValue;
      }
      return value;
    },
  };
}

/**
 * Create HTTP helper for transformation scripts
 * Allows scripts to make external API calls with security controls
 */
function createHttpHelper(context) {
  const axios = require('axios');

  return {
    /**
     * Make a GET request
     * @param {string} url - Target URL
     * @param {object} options - Request options (headers, timeout, etc.)
     */
    get: async (url, options = {}) => {
      log('debug', 'Script HTTP GET request', { url, context: context.eventType });

      try {
        const response = await axios.get(url, {
          timeout: options.timeout || 30000,
          headers: options.headers || {},
          params: options.params || {},
          validateStatus: () => true, // Don't throw on non-2xx
        });

        return {
          status: response.status,
          data: response.data,
          headers: response.headers,
        };
      } catch (error) {
        log('error', 'Script HTTP GET failed', { url, error: error.message });
        throw new Error(`HTTP GET failed: ${error.message}`);
      }
    },

    /**
     * Make a POST request
     * @param {string} url - Target URL
     * @param {object} data - Request body
     * @param {object} options - Request options (headers, timeout, etc.)
     */
    post: async (url, data, options = {}) => {
      log('debug', 'Script HTTP POST request', { url, context: context.eventType });

      try {
        const response = await axios.post(url, data, {
          timeout: options.timeout || 30000,
          headers: options.headers || {},
          validateStatus: () => true,
        });

        return {
          status: response.status,
          data: response.data,
          headers: response.headers,
        };
      } catch (error) {
        log('error', 'Script HTTP POST failed', { url, error: error.message });
        throw new Error(`HTTP POST failed: ${error.message}`);
      }
    },

    /**
     * Make a PUT request
     */
    put: async (url, data, options = {}) => {
      log('debug', 'Script HTTP PUT request', { url, context: context.eventType });

      try {
        const response = await axios.put(url, data, {
          timeout: options.timeout || 30000,
          headers: options.headers || {},
          validateStatus: () => true,
        });

        return {
          status: response.status,
          data: response.data,
          headers: response.headers,
        };
      } catch (error) {
        log('error', 'Script HTTP PUT failed', { url, error: error.message });
        throw new Error(`HTTP PUT failed: ${error.message}`);
      }
    },

    /**
     * Make a PATCH request
     */
    patch: async (url, data, options = {}) => {
      log('debug', 'Script HTTP PATCH request', { url, context: context.eventType });

      try {
        const response = await axios.patch(url, data, {
          timeout: options.timeout || 30000,
          headers: options.headers || {},
          validateStatus: () => true,
        });

        return {
          status: response.status,
          data: response.data,
          headers: response.headers,
        };
      } catch (error) {
        log('error', 'Script HTTP PATCH failed', { url, error: error.message });
        throw new Error(`HTTP PATCH failed: ${error.message}`);
      }
    },

    /**
     * Make a DELETE request
     */
    delete: async (url, options = {}) => {
      log('debug', 'Script HTTP DELETE request', { url, context: context.eventType });

      try {
        const response = await axios.delete(url, {
          timeout: options.timeout || 30000,
          headers: options.headers || {},
          validateStatus: () => true,
        });

        return {
          status: response.status,
          data: response.data,
          headers: response.headers,
        };
      } catch (error) {
        log('error', 'Script HTTP DELETE failed', { url, error: error.message });
        throw new Error(`HTTP DELETE failed: ${error.message}`);
      }
    },

    /**
     * Fetch a binary file (PDF, image, etc.) and return it as base64
     * @param {string} url - URL of the file
     * @param {object} options - Request options (headers, timeout)
     * @returns {Promise<{base64: string, contentType: string, status: number}>}
     */
    getBuffer: async (url, options = {}) => {
      log('debug', 'Script HTTP getBuffer request', { url, context: context.eventType });

      try {
        const response = await axios.get(url, {
          timeout: options.timeout || 30000,
          headers: options.headers || {},
          responseType: 'arraybuffer',
          validateStatus: () => true,
        });

        const base64 = Buffer.from(response.data).toString('base64');
        const contentType = response.headers['content-type'] || 'application/octet-stream';

        return {
          status: response.status,
          base64,
          contentType,
        };
      } catch (error) {
        log('error', 'Script HTTP getBuffer failed', { url, error: error.message });
        throw new Error(`HTTP getBuffer failed: ${error.message}`);
      }
    },
  };
}

async function applyScriptTransform(script, payload, context) {
  try {
    // Use secure VM wrapper (replacement for vm2) for script execution with async support
    const { VM } = require('../utils/secure-vm');

    // Create HTTP helper for making external API calls
    const http = createHttpHelper(context);

    const vm = new VM({
      timeout: 60000, // 60 second timeout for complex workflows
      sandbox: {
        payload,
        context: { ...context, http },
        // Inject global utility functions
        ...getGlobalUtilities(),
        // Inject HTTP helper for external API calls
        http,
        // Note: console.log is provided by SecureVM automatically
      },
      allowAsync: true, // ENABLE async/await for complex workflows
    });

    // Execute the transformation inside the VM so timeout/memory guards always apply.
    const secureScript = `
      return (async function transform(payload, context) {
        ${script}
      })(payload, context)
    `;

    const result = await vm.run(secureScript);
    if (depth(result) > MAX_DEPTH) {
      throw new Error('Transformed object too deep');
    }
    return result;
  } catch (error) {
    throw new Error(`Script execution failed: ${error.message}`);
  }
}

/**
 * Apply response transformation for INBOUND integrations
 * Transforms external API response back to the client app format
 *
 * @param {Object} integration - Integration config with responseTransformation
 * @param {Object} response - Raw response from external API
 * @param {Object} context - Context object with orgId/orgUnitRid, etc.
 * @returns {Object} Transformed response in client app format
 */
async function applyResponseTransform(integration, response, context = {}) {
  if (!integration || !integration.responseTransformation) {
    // No transformation configured, return response as-is
    return response;
  }

  const event = {
    orgId: context.orgId || integration.orgId,
    orgUnitRid: context.orgUnitRid || integration.orgUnitRid || integration.entityRid,
  };

  let transformed = response;

  // Apply transformation based on mode
  const mode = integration.responseTransformation.mode || 'SIMPLE';

  switch (mode) {
    case 'SIMPLE':
      transformed = await applySimpleTransform(response, integration.responseTransformation, event);
      break;
    case 'SCRIPT':
      if (!validateScript(integration.responseTransformation?.script)) {
        throw new Error('Invalid response transformation script');
      }
      transformed = await applyScriptTransform(integration.responseTransformation.script, response, context);
      break;
    default:
      transformed = response;
  }

  // Apply lookups if configured (optional for response transformations)
  if (integration.responseTransformation.lookups && integration.responseTransformation.lookups.length > 0) {
    transformed = await applyLookups(transformed, integration.responseTransformation.lookups, event);
  }

  return transformed;
}

module.exports = {
  validateScript,
  applyTransform,
  applyResponseTransform,
};
