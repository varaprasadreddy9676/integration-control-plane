/**
 * Curl Generator Utility
 *
 * Generates curl commands for INBOUND integrations
 * to make it easy to share API call examples
 */

const config = require('../config');

/**
 * Generate a curl command for an INBOUND integration
 *
 * @param {Object} integration - Integration config
 * @param {Object} options - Options for curl generation
 * @param {string} options.baseUrl - Base URL for the API (e.g., http://localhost:4000)
 * @param {Object} options.samplePayload - Sample request payload
 * @returns {string} Curl command string
 */
function generateCurlCommand(integration, options = {}) {
  const baseUrl = options.baseUrl || `http://localhost:${config.port}`;
  const apiPrefix = config.api.basePrefix || '/api/v1';
  const endpoint = `${baseUrl}${apiPrefix}/integrations/${integration.type}`;
  const orgId = integration.orgId || integration.orgUnitRid;

  // Build URL with query params
  const url = `${endpoint}?orgId=${orgId}`;

  // Build authentication headers based on inboundAuthType
  const authHeaders = buildInboundAuthHeaders(integration);

  // Build sample payload
  const samplePayload = options.samplePayload || {
    // Generic example payload
    resourceId: 'example-id',
    context: 'sample-context',
  };

  // Build curl command
  const curlParts = ['curl', '-X POST', `'${url}'`];

  // Add headers
  curlParts.push(`-H 'Content-Type: application/json'`);
  authHeaders.forEach((header) => {
    curlParts.push(`-H '${header.name}: ${header.value}'`);
  });

  // Add data payload
  const jsonPayload = JSON.stringify(samplePayload, null, 2).split('\n').join('\n  '); // Indent payload for readability

  curlParts.push(`-d '${jsonPayload}'`);

  // Join with line continuations for readability
  return curlParts.join(' \\\n  ');
}

/**
 * Build authentication headers for curl command
 */
function buildInboundAuthHeaders(integration) {
  const headers = [];

  if (!integration.inboundAuthType || integration.inboundAuthType === 'NONE') {
    return headers;
  }

  const authConfig = integration.inboundAuthConfig || {};

  switch (integration.inboundAuthType) {
    case 'API_KEY': {
      const headerName = authConfig.headerName || 'X-API-Key';
      const value = authConfig.value || authConfig.key || '<your-api-key>';
      headers.push({ name: headerName, value });
      break;
    }

    case 'BEARER': {
      const token = authConfig.token || authConfig.value || '<your-bearer-token>';
      headers.push({ name: 'Authorization', value: `Bearer ${token}` });
      break;
    }

    case 'BASIC': {
      const username = authConfig.username || '<username>';
      const password = authConfig.password || '<password>';
      const credentials = Buffer.from(`${username}:${password}`).toString('base64');
      headers.push({ name: 'Authorization', value: `Basic ${credentials}` });
      break;
    }

    default:
      break;
  }

  return headers;
}

/**
 * Generate a curl command with masked authentication
 * (for display purposes, doesn't expose actual credentials)
 */
function generateMaskedCurlCommand(integration, options = {}) {
  const maskedIntegration = {
    ...integration,
    inboundAuthConfig: maskAuthConfig(integration.inboundAuthConfig, integration.inboundAuthType),
  };

  return generateCurlCommand(maskedIntegration, options);
}

/**
 * Mask sensitive auth config values
 */
function maskAuthConfig(authConfig, authType) {
  if (!authConfig) return null;

  const masked = { ...authConfig };

  switch (authType) {
    case 'API_KEY':
      if (masked.value) masked.value = '<your-api-key>';
      if (masked.key) masked.key = '<your-api-key>';
      break;
    case 'BEARER':
      if (masked.token) masked.token = '<your-bearer-token>';
      if (masked.value) masked.value = '<your-bearer-token>';
      break;
    case 'BASIC':
      if (masked.username) masked.username = '<username>';
      if (masked.password) masked.password = '<password>';
      break;
    default:
      break;
  }

  return masked;
}

module.exports = {
  generateCurlCommand,
  generateMaskedCurlCommand,
};
