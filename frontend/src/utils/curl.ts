import type { IntegrationConfig } from '../mocks/types';

/**
 * Generate a curl command from integration configuration
 * If requestHeaders are provided (from actual delivery), uses them unredacted for debugging
 * Otherwise reconstructs from integration config with redaction for security
 */
export function generateCurlCommand(
  integration: IntegrationConfig,
  payload: Record<string, unknown>,
  requestHeaders?: Record<string, unknown>
): string {
  if (!integration && !requestHeaders) return 'N/A';

  const httpMethod = integration?.httpMethod || 'POST';
  const targetUrl = integration?.targetUrl || '';

  let curl = `curl -X ${httpMethod} "${targetUrl}"`;

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
  const payloadStr = JSON.stringify(payload || {}, null, 2);
  curl += ` \\\n  -d '${payloadStr}'`;

  return curl;
}
