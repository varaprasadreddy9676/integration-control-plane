const { log } = require('../logger');
const crypto = require('crypto');
const { fetch, AbortController } = require('../utils/runtime');

async function fetchWithTimeout(url, options, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Extract value from object using dot notation path
 * e.g., "data.token" extracts obj.data.token
 */
function extractValueByPath(obj, path) {
  const parts = path.split('.');
  let current = obj;

  for (const part of parts) {
    if (current && typeof current === 'object' && part in current) {
      current = current[part];
    } else {
      return null;
    }
  }

  return current;
}

/**
 * Fetch OAuth2 token using client credentials flow
 * Returns token metadata for caching: { token, expiresAt, refreshToken }
 */
async function fetchOAuth2Token(authConfig, forceFresh = false) {
  // Check if we have a cached valid token (unless forcing fresh fetch)
  if (!forceFresh && authConfig._cachedToken && authConfig._tokenExpiresAt) {
    const expiresAt = new Date(authConfig._tokenExpiresAt);
    const now = new Date();
    const bufferSeconds = 300; // Refresh 5min before expiry

    if (now < new Date(expiresAt.getTime() - bufferSeconds * 1000)) {
      log('debug', 'Using cached OAuth2 token', {
        expiresAt: authConfig._tokenExpiresAt,
        remainingSeconds: Math.floor((expiresAt - now) / 1000),
      });
      return {
        token: authConfig._cachedToken,
        expiresAt: authConfig._tokenExpiresAt,
        refreshToken: authConfig._tokenRefreshToken || null,
        cached: true,
      };
    } else {
      log('debug', 'Cached OAuth2 token expired or expiring soon, fetching new token');
    }
  }

  const { tokenUrl, tokenEndpoint, clientId, clientSecret, scope } = authConfig;

  // Support both 'tokenUrl' (from UI) and 'tokenEndpoint' (legacy)
  const endpoint = tokenUrl || tokenEndpoint;

  if (!endpoint || !clientId || !clientSecret) {
    throw new Error('OAuth2 requires tokenUrl, clientId, and clientSecret');
  }

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
  });

  if (scope) {
    body.append('scope', scope);
  }

  try {
    log('debug', 'Fetching new OAuth2 token', { endpoint, clientId });

    const response = await fetchWithTimeout(
      endpoint,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      },
      10000
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OAuth2 token endpoint returned ${response.status}: ${errorText}`);
    }

    const data = await response.json();

    if (!data.access_token) {
      log('error', 'OAuth2 response missing access_token', {
        responseKeys: Object.keys(data),
        endpoint,
      });
      throw new Error('OAuth2 token endpoint did not return access_token');
    }

    // Validate token is a string
    if (typeof data.access_token !== 'string') {
      throw new Error(`OAuth2 access_token is not a string: ${typeof data.access_token}`);
    }

    // Calculate expiration (default 1 hour if not provided)
    const expiresIn = data.expires_in || 3600;
    const expiresAt = new Date(Date.now() + expiresIn * 1000);

    log('info', 'OAuth2 token fetched successfully', {
      endpoint,
      expiresIn,
      expiresAt: expiresAt.toISOString(),
    });

    // Return token metadata for caching
    return {
      token: data.access_token,
      expiresAt: expiresAt.toISOString(),
      refreshToken: data.refresh_token || null,
      cached: false,
    };
  } catch (err) {
    // Wrap network/fetch errors with more context
    if (err.name === 'AbortError' || err.code === 'ETIMEDOUT') {
      throw new Error(`OAuth2 token request timed out: ${endpoint}`);
    }
    if (err.code === 'ENOTFOUND' || err.code === 'ECONNREFUSED') {
      throw new Error(`Cannot connect to OAuth2 endpoint: ${endpoint}`);
    }
    throw err;
  }
}

/**
 * Generate OAuth 1.0a signature for request
 * Used by NetSuite, Twitter API, and other OAuth 1.0a services
 */
function generateOAuth1Signature(method, url, params, consumerSecret, tokenSecret) {
  // 1. Sort parameters alphabetically
  const sortedParams = Object.keys(params)
    .sort()
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
    .join('&');

  // 2. Create signature base string
  const signatureBaseString = [method.toUpperCase(), encodeURIComponent(url), encodeURIComponent(sortedParams)].join(
    '&'
  );

  // 3. Create signing key
  const signingKey = `${encodeURIComponent(consumerSecret)}&${encodeURIComponent(tokenSecret || '')}`;

  // 4. Generate HMAC-SHA256 signature
  const signature = crypto.createHmac('sha256', signingKey).update(signatureBaseString).digest('base64');

  return signature;
}

/**
 * Update cached token in MongoDB integration config
 * Stores token with expiration for reuse across requests
 */
async function updateCachedToken(integrationId, tokenData) {
  try {
    const mongodb = require('../mongodb');
    const db = await mongodb.getDbSafe();

    const updateFields = {
      'outgoingAuthConfig._cachedToken': tokenData.token,
      'outgoingAuthConfig._tokenExpiresAt': tokenData.expiresAt,
      'outgoingAuthConfig._tokenLastFetched': new Date().toISOString(),
    };

    // Only set refreshToken if provided (OAuth2 specific)
    if (tokenData.refreshToken) {
      updateFields['outgoingAuthConfig._tokenRefreshToken'] = tokenData.refreshToken;
    }

    await db
      .collection('integration_configs')
      .updateOne({ _id: mongodb.toObjectId(integrationId) }, { $set: updateFields });

    log('debug', 'Cached token updated in MongoDB', {
      integrationId: integrationId.toString(),
      expiresAt: tokenData.expiresAt,
    });
  } catch (err) {
    // Don't fail the request if caching fails, just log warning
    log('warn', 'Failed to cache token in MongoDB', {
      integrationId: integrationId?.toString(),
      error: err.message,
    });
  }
}

/**
 * Clear cached token from MongoDB integration config
 * Used when token is invalid or expired
 */
async function clearCachedToken(integrationId) {
  try {
    const mongodb = require('../mongodb');
    const db = await mongodb.getDbSafe();

    await db.collection('integration_configs').updateOne(
      { _id: mongodb.toObjectId(integrationId) },
      {
        $unset: {
          'outgoingAuthConfig._cachedToken': 1,
          'outgoingAuthConfig._tokenExpiresAt': 1,
          'outgoingAuthConfig._tokenRefreshToken': 1,
        },
      }
    );

    log('info', 'Cleared cached token from MongoDB', {
      integrationId: integrationId.toString(),
    });
  } catch (err) {
    log('warn', 'Failed to clear cached token', {
      integrationId: integrationId?.toString(),
      error: err.message,
    });
  }
}

/**
 * Build OAuth 1.0a Authorization header
 * Supports NetSuite RESTlet authentication and other OAuth 1.0a APIs
 */
function buildOAuth1AuthHeader(method, url, authConfig, additionalParams = {}) {
  const { consumerKey, consumerSecret, token, tokenSecret, realm, signatureMethod = 'HMAC-SHA256' } = authConfig;

  if (!consumerKey || !consumerSecret || !token || !tokenSecret) {
    throw new Error('OAUTH1 requires consumerKey, consumerSecret, token, and tokenSecret');
  }

  // Generate OAuth parameters
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomBytes(16).toString('hex');

  // Parse URL to separate base URL and query parameters
  const urlObj = new URL(url);
  const baseUrl = `${urlObj.protocol}//${urlObj.host}${urlObj.pathname}`;

  // Combine OAuth params with query params for signature
  const allParams = {
    oauth_consumer_key: consumerKey,
    oauth_token: token,
    oauth_signature_method: signatureMethod,
    oauth_timestamp: timestamp,
    oauth_nonce: nonce,
    oauth_version: '1.0',
    ...additionalParams,
  };

  // Add query parameters to signature calculation
  urlObj.searchParams.forEach((value, key) => {
    allParams[key] = value;
  });

  // Generate signature
  const signature = generateOAuth1Signature(method, baseUrl, allParams, consumerSecret, tokenSecret);

  // Build Authorization header (only OAuth params, not query params)
  const oauthParams = {
    oauth_consumer_key: consumerKey,
    oauth_token: token,
    oauth_signature_method: signatureMethod,
    oauth_timestamp: timestamp,
    oauth_nonce: nonce,
    oauth_version: '1.0',
    oauth_signature: signature,
  };

  // Add realm if provided (NetSuite requires this)
  let authHeader = 'OAuth ';
  if (realm) {
    authHeader += `realm="${encodeURIComponent(realm)}",`;
  }

  authHeader += Object.keys(oauthParams)
    .map((key) => `${encodeURIComponent(key)}="${encodeURIComponent(oauthParams[key])}"`)
    .join(',');

  return authHeader;
}

/**
 * Fetch custom token with configurable endpoint and body
 * Returns token metadata for caching: { token, expiresAt }
 */
async function fetchCustomToken(authConfig, forceFresh = false) {
  // Check if we have a cached valid token (unless forcing fresh fetch)
  if (!forceFresh && authConfig._cachedToken && authConfig._tokenExpiresAt) {
    const expiresAt = new Date(authConfig._tokenExpiresAt);
    const now = new Date();
    const bufferSeconds = 300; // Refresh 5min before expiry

    if (now < new Date(expiresAt.getTime() - bufferSeconds * 1000)) {
      log('debug', 'Using cached custom token', {
        expiresAt: authConfig._tokenExpiresAt,
        remainingSeconds: Math.floor((expiresAt - now) / 1000),
      });
      return {
        token: authConfig._cachedToken,
        expiresAt: authConfig._tokenExpiresAt,
        cached: true,
      };
    } else {
      log('debug', 'Cached custom token expired or expiring soon, fetching new token');
    }
  }

  const { tokenEndpoint, tokenRequestMethod, tokenRequestBody, tokenResponsePath, tokenExpiresInPath } = authConfig;

  if (!tokenEndpoint) {
    throw new Error('CUSTOM auth requires tokenEndpoint');
  }

  const method = tokenRequestMethod || 'POST';

  // Handle requestBody - can be string (JSON) or object
  let requestBody = tokenRequestBody || {};
  if (typeof requestBody === 'string') {
    try {
      requestBody = JSON.parse(requestBody);
    } catch (err) {
      throw new Error(`Invalid JSON in tokenRequestBody: ${err.message}`);
    }
  }

  // Validate requestBody is an object
  if (typeof requestBody !== 'object' || requestBody === null) {
    throw new Error('tokenRequestBody must be a JSON object');
  }

  try {
    log('debug', 'Fetching new custom token', { tokenEndpoint });

    const response = await fetchWithTimeout(
      tokenEndpoint,
      {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: method !== 'GET' ? JSON.stringify(requestBody) : undefined,
      },
      10000
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Custom token endpoint returned ${response.status}: ${errorText}`);
    }

    const data = await response.json();

    // Extract token from response using path (e.g., "data.token" or "access_token")
    const tokenPath = tokenResponsePath || 'access_token';
    const token = extractValueByPath(data, tokenPath);

    if (!token) {
      log('error', 'Failed to extract token from response', {
        tokenPath,
        responseKeys: Object.keys(data),
        response: JSON.stringify(data),
      });
      throw new Error(`Could not extract token from response using path: ${tokenPath}`);
    }

    // Validate token is a string
    if (typeof token !== 'string') {
      throw new Error(`Extracted token is not a string: ${typeof token}`);
    }

    // Try to extract expiration from response (if configured)
    let expiresIn = 3600; // Default 1 hour
    if (tokenExpiresInPath) {
      const extractedExpiry = extractValueByPath(data, tokenExpiresInPath);
      if (extractedExpiry && typeof extractedExpiry === 'number') {
        expiresIn = extractedExpiry;
      }
    }

    const expiresAt = new Date(Date.now() + expiresIn * 1000);

    log('info', 'Custom token fetched successfully', {
      tokenEndpoint,
      expiresIn,
      expiresAt: expiresAt.toISOString(),
    });

    // Return token metadata for caching
    return {
      token,
      expiresAt: expiresAt.toISOString(),
      cached: false,
    };
  } catch (err) {
    // Wrap network/fetch errors with more context
    if (err.name === 'AbortError' || err.code === 'ETIMEDOUT') {
      throw new Error(`Token endpoint request timed out: ${tokenEndpoint}`);
    }
    if (err.code === 'ENOTFOUND' || err.code === 'ECONNREFUSED') {
      throw new Error(`Cannot connect to token endpoint: ${tokenEndpoint}`);
    }
    throw err;
  }
}

/**
 * Build authentication headers based on integration auth configuration
 * Supports: NONE, API_KEY, BASIC, BEARER, OAUTH1, OAUTH2, CUSTOM, CUSTOM_HEADERS
 */
async function buildAuthHeaders(integration, method = 'POST', targetUrl = null) {
  const headers = {};
  const authType = integration.outgoingAuthType || 'NONE';
  const authConfig = integration.outgoingAuthConfig || {};

  switch (authType) {
    case 'NONE':
      // No authentication
      break;

    case 'API_KEY':
      // Add API key to custom header
      if (!authConfig.headerName || !authConfig.apiKey) {
        throw new Error('API_KEY auth requires headerName and apiKey');
      }
      headers[authConfig.headerName] = authConfig.apiKey;
      break;

    case 'BASIC': {
      // Basic authentication with username:password
      if (!authConfig.username || !authConfig.password) {
        throw new Error('BASIC auth requires username and password');
      }
      const credentials = Buffer.from(`${authConfig.username}:${authConfig.password}`).toString('base64');
      headers.Authorization = `Basic ${credentials}`;
      break;
    }

    case 'BEARER':
      // Bearer token authentication
      if (!authConfig.token) {
        throw new Error('BEARER auth requires token');
      }
      headers.Authorization = `Bearer ${authConfig.token}`;
      break;

    case 'OAUTH1':
      // OAuth 1.0a (for NetSuite, Twitter API, etc.)
      try {
        const url = targetUrl || integration.targetUrl;
        if (!url) {
          throw new Error('OAUTH1 requires targetUrl');
        }
        const httpMethod = method || integration.httpMethod || 'POST';
        headers.Authorization = buildOAuth1AuthHeader(httpMethod, url, authConfig);
      } catch (err) {
        throw new Error(`OAuth1 auth failed: ${err.message}`);
      }
      break;

    case 'OAUTH2':
      // OAuth2 client credentials flow with token caching
      try {
        const tokenData = await fetchOAuth2Token(authConfig);
        headers.Authorization = `Bearer ${tokenData.token}`;

        // Update cached token in MongoDB (async, don't wait)
        if (!tokenData.cached && integration._id) {
          updateCachedToken(integration._id, tokenData).catch((err) => {
            log('warn', 'Failed to cache OAuth2 token', { error: err.message });
          });
        }
      } catch (err) {
        throw new Error(`OAuth2 token fetch failed: ${err.message}`);
      }
      break;

    case 'CUSTOM':
      // Custom token endpoint with configurable body and token caching
      try {
        const tokenData = await fetchCustomToken(authConfig);
        // Apply token to configured header or default to Authorization
        const headerName = authConfig.tokenHeaderName || 'Authorization';
        const headerPrefix = authConfig.tokenHeaderPrefix || 'Bearer';
        headers[headerName] = headerPrefix ? `${headerPrefix} ${tokenData.token}` : tokenData.token;

        // Update cached token in MongoDB (async, don't wait)
        if (!tokenData.cached && integration._id) {
          updateCachedToken(integration._id, tokenData).catch((err) => {
            log('warn', 'Failed to cache custom token', { error: err.message });
          });
        }
      } catch (err) {
        throw new Error(`Custom token fetch failed: ${err.message}`);
      }
      break;

    case 'CUSTOM_HEADERS':
      // Multiple custom headers (e.g., for CleverTap, custom APIs)
      if (!authConfig.headers || typeof authConfig.headers !== 'object') {
        throw new Error('CUSTOM_HEADERS auth requires headers object');
      }
      // Validate no empty header names
      for (const [key, value] of Object.entries(authConfig.headers)) {
        if (!key || typeof key !== 'string') {
          throw new Error('CUSTOM_HEADERS: all header names must be non-empty strings');
        }
        if (value === undefined || value === null) {
          throw new Error(`CUSTOM_HEADERS: header "${key}" has undefined/null value`);
        }
        headers[key] = String(value);
      }
      break;

    default:
      log('warn', 'Unknown auth type, using no authentication', { authType });
  }

  return headers;
}

module.exports = {
  buildAuthHeaders,
  fetchOAuth2Token,
  fetchCustomToken,
  extractValueByPath,
  updateCachedToken,
  clearCachedToken,
};
