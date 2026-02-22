/**
 * URL Fetcher for API Documentation
 * Fetches and extracts content from URLs (API docs, Swagger/OpenAPI specs)
 */

const https = require('https');
const http = require('http');
const { log } = require('../../logger');

/**
 * Fetch content from URL
 * @param {string} url - URL to fetch
 * @param {number} maxRedirects - Maximum number of redirects to follow
 * @returns {Promise<{content: string, contentType: string}>}
 */
async function fetchFromURL(url, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    if (maxRedirects === 0) {
      return reject(new Error('Too many redirects'));
    }

    const protocol = url.startsWith('https') ? https : http;

    const options = {
      headers: {
        'User-Agent': 'Integration-Gateway/2.0 (API Documentation Fetcher)',
        Accept: 'text/html,application/json,application/x-yaml,text/plain,*/*',
      },
      timeout: 30000, // 30 second timeout
    };

    protocol
      .get(url, options, (res) => {
        // Handle redirects
        if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) {
          const redirectUrl = res.headers.location;
          if (!redirectUrl) {
            return reject(new Error('Redirect without location header'));
          }

          // Make redirect URL absolute
          const absoluteUrl = redirectUrl.startsWith('http') ? redirectUrl : new URL(redirectUrl, url).toString();

          log('info', 'Following redirect', { from: url, to: absoluteUrl });
          return fetchFromURL(absoluteUrl, maxRedirects - 1)
            .then(resolve)
            .catch(reject);
        }

        // Handle errors
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
        }

        // Collect response data
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
          // Limit to 5MB
          if (data.length > 5 * 1024 * 1024) {
            res.destroy();
            reject(new Error('Response too large (max 5MB)'));
          }
        });

        res.on('end', () => {
          const contentType = res.headers['content-type'] || 'text/plain';
          resolve({ content: data, contentType });
        });

        res.on('error', (err) => {
          reject(err);
        });
      })
      .on('error', (err) => {
        reject(err);
      })
      .on('timeout', () => {
        reject(new Error('Request timeout'));
      });
  });
}

/**
 * Parse and extract documentation from various formats
 * @param {string} content - Raw content
 * @param {string} contentType - Content type header
 * @returns {string} Extracted documentation text
 */
function parseDocumentation(content, contentType) {
  // JSON (OpenAPI/Swagger)
  if (contentType.includes('json')) {
    try {
      const json = JSON.parse(content);

      // OpenAPI/Swagger detection
      if (json.swagger || json.openapi) {
        return extractOpenAPIDoc(json);
      }

      // Postman collection
      if (json.info && json.item) {
        return extractPostmanDoc(json);
      }

      // Generic JSON - return formatted
      return JSON.stringify(json, null, 2);
    } catch (error) {
      log('warn', 'Failed to parse JSON documentation', { error: error.message });
      return content;
    }
  }

  // YAML (OpenAPI)
  if (contentType.includes('yaml') || contentType.includes('yml')) {
    // For now, return as-is. Could add YAML parser if needed.
    return content;
  }

  // HTML - strip tags and extract text
  if (contentType.includes('html')) {
    return extractTextFromHTML(content);
  }

  // Plain text or markdown
  return content;
}

/**
 * Extract documentation from OpenAPI/Swagger spec
 * @param {object} spec - OpenAPI/Swagger spec object
 * @returns {string} Human-readable documentation
 */
function extractOpenAPIDoc(spec) {
  let doc = '';

  // Title and description
  doc += `API: ${spec.info?.title || 'Untitled'}\n`;
  doc += `Version: ${spec.info?.version || 'unknown'}\n`;
  if (spec.info?.description) {
    doc += `\nDescription:\n${spec.info.description}\n`;
  }

  // Base URL
  const servers = spec.servers || [];
  if (servers.length > 0) {
    doc += `\nBase URL: ${servers[0].url}\n`;
  } else if (spec.host) {
    const scheme = spec.schemes?.[0] || 'https';
    doc += `\nBase URL: ${scheme}://${spec.host}${spec.basePath || ''}\n`;
  }

  // Security schemes
  const securitySchemes = spec.components?.securitySchemes || spec.securityDefinitions || {};
  if (Object.keys(securitySchemes).length > 0) {
    doc += '\nAuthentication:\n';
    for (const [name, scheme] of Object.entries(securitySchemes)) {
      doc += `- ${name}: ${scheme.type} (${scheme.scheme || scheme.in || ''})\n`;
      if (scheme.description) {
        doc += `  ${scheme.description}\n`;
      }
    }
  }

  // Endpoints (paths)
  const paths = spec.paths || {};
  doc += '\nEndpoints:\n';
  for (const [path, methods] of Object.entries(paths)) {
    for (const [method, operation] of Object.entries(methods)) {
      if (typeof operation !== 'object') continue;

      doc += `\n${method.toUpperCase()} ${path}\n`;
      if (operation.summary) {
        doc += `Summary: ${operation.summary}\n`;
      }
      if (operation.description) {
        doc += `Description: ${operation.description}\n`;
      }

      // Request body
      const requestBody = operation.requestBody?.content?.['application/json']?.schema;
      if (requestBody) {
        doc += `Request Body: ${JSON.stringify(requestBody, null, 2)}\n`;
      }

      // Parameters
      if (operation.parameters && operation.parameters.length > 0) {
        doc += 'Parameters:\n';
        operation.parameters.forEach((param) => {
          doc += `- ${param.name} (${param.in}): ${param.description || 'No description'}\n`;
        });
      }
    }
  }

  return doc;
}

/**
 * Extract documentation from Postman collection
 * @param {object} collection - Postman collection object
 * @returns {string} Human-readable documentation
 */
function extractPostmanDoc(collection) {
  let doc = '';

  // Collection info
  doc += `API Collection: ${collection.info?.name || 'Untitled'}\n`;
  if (collection.info?.description) {
    doc += `Description: ${collection.info.description}\n`;
  }

  // Variables
  if (collection.variable && collection.variable.length > 0) {
    doc += '\nVariables:\n';
    collection.variable.forEach((v) => {
      doc += `- {{${v.key}}}: ${v.value || 'Not set'}\n`;
    });
  }

  // Auth
  if (collection.auth) {
    doc += `\nAuthentication: ${collection.auth.type}\n`;
  }

  // Requests
  function extractRequests(items, indent = '') {
    items.forEach((item) => {
      if (item.item) {
        // Folder
        doc += `\n${indent}Folder: ${item.name}\n`;
        extractRequests(item.item, `${indent}  `);
      } else if (item.request) {
        // Request
        const req = item.request;
        const method = typeof req === 'string' ? 'GET' : req.method || 'GET';
        const url = typeof req === 'string' ? req : req.url?.raw || req.url || '';

        doc += `\n${indent}${method} ${item.name}\n`;
        doc += `${indent}URL: ${url}\n`;

        if (item.request.description) {
          doc += `${indent}Description: ${item.request.description}\n`;
        }

        // Headers
        if (req.header && req.header.length > 0) {
          doc += `${indent}Headers:\n`;
          req.header.forEach((h) => {
            if (!h.disabled) {
              doc += `${indent}  ${h.key}: ${h.value}\n`;
            }
          });
        }

        // Body
        if (req.body) {
          doc += `${indent}Body (${req.body.mode}):\n`;
          if (req.body.mode === 'raw') {
            doc += `${indent}${req.body.raw}\n`;
          } else if (req.body.mode === 'formdata' || req.body.mode === 'urlencoded') {
            req.body[req.body.mode]?.forEach((param) => {
              doc += `${indent}  ${param.key}: ${param.value}\n`;
            });
          }
        }
      }
    });
  }

  if (collection.item) {
    doc += '\nRequests:\n';
    extractRequests(collection.item);
  }

  return doc;
}

/**
 * Extract text from HTML (basic implementation)
 * @param {string} html - HTML content
 * @returns {string} Plain text
 */
function extractTextFromHTML(html) {
  // Remove script and style tags
  let text = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');

  // Remove HTML tags
  text = text.replace(/<[^>]+>/g, ' ');

  // Decode HTML entities
  text = text.replace(/&nbsp;/g, ' ');
  text = text.replace(/&amp;/g, '&');
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");

  // Clean up whitespace
  text = text.replace(/\s+/g, ' ').trim();

  // Limit length
  if (text.length > 50000) {
    text = `${text.substring(0, 50000)}... (truncated)`;
  }

  return text;
}

/**
 * Main function to fetch and parse API documentation
 * @param {string} urlOrContent - URL or raw content (JSON/YAML)
 * @returns {Promise<string>} Parsed documentation
 */
async function fetchAPIDocumentation(urlOrContent) {
  // Check if it's a URL
  if (urlOrContent.startsWith('http://') || urlOrContent.startsWith('https://')) {
    try {
      log('info', 'Fetching API documentation from URL', { url: urlOrContent });
      const { content, contentType } = await fetchFromURL(urlOrContent);
      const parsed = parseDocumentation(content, contentType);
      log('info', 'Successfully fetched and parsed documentation', { url: urlOrContent, length: parsed.length });
      return parsed;
    } catch (error) {
      log('error', 'Failed to fetch API documentation', { url: urlOrContent, error: error.message });
      throw new Error(`Failed to fetch documentation: ${error.message}`);
    }
  }

  // Try to parse as JSON (Postman collection or OpenAPI)
  try {
    const json = JSON.parse(urlOrContent);

    // OpenAPI/Swagger
    if (json.swagger || json.openapi) {
      return extractOpenAPIDoc(json);
    }

    // Postman collection
    if (json.info && json.item) {
      return extractPostmanDoc(json);
    }

    // Generic JSON
    return JSON.stringify(json, null, 2);
  } catch (_error) {
    // Not JSON - return as plain text
    return urlOrContent;
  }
}

module.exports = {
  fetchAPIDocumentation,
  fetchFromURL,
  parseDocumentation,
  extractOpenAPIDoc,
  extractPostmanDoc,
};
