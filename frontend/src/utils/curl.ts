import type { IntegrationConfig } from '../mocks/types';

/**
 * Generate a curl command from integration configuration
 * If requestHeaders are provided (from actual delivery), uses them unredacted for debugging
 * Otherwise reconstructs from integration config with redaction for security
 */
export function generateCurlCommand(
  integration: IntegrationConfig,
  payload: Record<string, unknown>,
  requestHeaders?: Record<string, unknown>,
  options?: {
    direction?: string;
    request?: { url?: string; method?: string };
    orgId?: number | string;
  }
): string {
  if (!integration && !requestHeaders) return 'N/A';

  const direction = options?.direction;
  const isInbound = direction === 'INBOUND';
  const apiBase = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000/api/v1';
  const apiOrigin = (() => {
    try {
      return new URL(apiBase).origin;
    } catch {
      return '';
    }
  })();

  const httpMethod = isInbound
    ? String(options?.request?.method || 'GET').toUpperCase()
    : (integration?.httpMethod || 'POST');
  const requestUrl = options?.request?.url;
  const targetUrl = isInbound
    ? (() => {
        if (typeof requestUrl === 'string' && requestUrl.trim()) {
          if (/^https?:\/\//i.test(requestUrl)) return requestUrl.trim();
          const normalizedPath = requestUrl.startsWith('/') ? requestUrl : `/${requestUrl}`;
          return `${apiOrigin}${normalizedPath}`;
        }
        const fallbackOrgId = options?.orgId != null ? String(options.orgId) : '<orgId>';
        return `${apiBase}/integrations/${encodeURIComponent((integration as any)?.type || 'integration')}?orgId=${fallbackOrgId}`;
      })()
    : (integration?.targetUrl || '');

  let curl = `curl -X ${httpMethod} "${targetUrl}"`;

  if (isInbound) {
    const gatewayApiKey = import.meta.env.VITE_API_KEY || 'YOUR_API_KEY';
    curl += ` \\\n  -H "X-API-Key: ${gatewayApiKey}"`;
    if (httpMethod !== 'GET') {
      curl += ` \\\n  -H "Content-Type: application/json"`;
    }
    if (httpMethod !== 'GET') {
      const payloadStr = JSON.stringify(payload || {}, null, 2);
      curl += ` \\\n  -d '${payloadStr}'`;
    }
    return curl;
  }

  // If we have actual request headers from the delivery log, use them (UNREDACTED)
  if (requestHeaders && typeof requestHeaders === 'object') {
    Object.entries(requestHeaders).forEach(([key, value]) => {
      // Add all headers exactly as they were sent
      curl += ` \\\n  -H "${key}: ${value}"`;
    });
  } else if (integration) {
    // Fallback: Reconstruct from integration config (redacted for security)
    curl += ` \\\n  -H "Content-Type: application/json"`;

    // Add auth headers with redaction
    if (integration.outgoingAuthType === 'API_KEY' && integration.outgoingAuthConfig) {
      const headerName = (integration.outgoingAuthConfig.headerName as string) || 'X-API-Key';
      const value = (integration.outgoingAuthConfig.value as string) || '[REDACTED]';
      curl += ` \\\n  -H "${headerName}: ${value.substring(0, 8)}..."`;
    } else if (integration.outgoingAuthType === 'BEARER' && integration.outgoingAuthConfig) {
      const value = (integration.outgoingAuthConfig.value as string) || '[REDACTED]';
      curl += ` \\\n  -H "Authorization: Bearer ${value.substring(0, 12)}..."`;
    } else if (integration.outgoingAuthType === 'BASIC' && integration.outgoingAuthConfig) {
      curl += ` \\\n  -H "Authorization: Basic [REDACTED]"`;
    }
  }

  // Add complete payload (scrollable in UI)
  if (httpMethod !== 'GET') {
    const payloadStr = JSON.stringify(payload || {}, null, 2);
    curl += ` \\\n  -d '${payloadStr}'`;
  }

  return curl;
}
