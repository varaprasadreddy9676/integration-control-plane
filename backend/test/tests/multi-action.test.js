const { buildAuthHeaders } = require('../../src/processor/auth-helper');

describe('Multi-Action Webhook Features', () => {
  describe('CUSTOM_HEADERS Auth Type', () => {
    it('should build headers with multiple custom headers', async () => {
      const webhook = {
        outgoingAuthType: 'CUSTOM_HEADERS',
        outgoingAuthConfig: {
          headers: {
            'X-CleverTap-Account-Id': '6K7-8R6-857Z',
            'X-CleverTap-Passcode': 'WHQ-KSY-CPEL',
            'X-Custom-Header': 'custom-value'
          }
        }
      };

      const headers = await buildAuthHeaders(webhook);

      expect(headers['X-CleverTap-Account-Id']).toBe('6K7-8R6-857Z');
      expect(headers['X-CleverTap-Passcode']).toBe('WHQ-KSY-CPEL');
      expect(headers['X-Custom-Header']).toBe('custom-value');
    });

    it('should throw error if headers config is missing', async () => {
      const webhook = {
        outgoingAuthType: 'CUSTOM_HEADERS',
        outgoingAuthConfig: {}
      };

      await expect(buildAuthHeaders(webhook)).rejects.toThrow(
        'CUSTOM_HEADERS auth requires headers object'
      );
    });

    it('should throw error if headers is not an object', async () => {
      const webhook = {
        outgoingAuthType: 'CUSTOM_HEADERS',
        outgoingAuthConfig: {
          headers: 'invalid'
        }
      };

      await expect(buildAuthHeaders(webhook)).rejects.toThrow(
        'CUSTOM_HEADERS auth requires headers object'
      );
    });

    it('should throw error if header value is undefined', async () => {
      const webhook = {
        outgoingAuthType: 'CUSTOM_HEADERS',
        outgoingAuthConfig: {
          headers: {
            'X-Valid-Header': 'value',
            'X-Invalid-Header': undefined
          }
        }
      };

      await expect(buildAuthHeaders(webhook)).rejects.toThrow(
        'header "X-Invalid-Header" has undefined/null value'
      );
    });

    it('should convert non-string header values to strings', async () => {
      const webhook = {
        outgoingAuthType: 'CUSTOM_HEADERS',
        outgoingAuthConfig: {
          headers: {
            'X-Numeric-Header': 12345,
            'X-Boolean-Header': true
          }
        }
      };

      const headers = await buildAuthHeaders(webhook);

      expect(headers['X-Numeric-Header']).toBe('12345');
      expect(headers['X-Boolean-Header']).toBe('true');
    });

    it('should work with empty headers object', async () => {
      const webhook = {
        outgoingAuthType: 'CUSTOM_HEADERS',
        outgoingAuthConfig: {
          headers: {}
        }
      };

      const headers = await buildAuthHeaders(webhook);

      expect(Object.keys(headers)).toHaveLength(0);
    });
  });

  describe('Existing Auth Types (Backward Compatibility)', () => {
    it('should still support API_KEY auth', async () => {
      const webhook = {
        outgoingAuthType: 'API_KEY',
        outgoingAuthConfig: {
          headerName: 'X-API-Key',
          apiKey: 'test-key-123'
        }
      };

      const headers = await buildAuthHeaders(webhook);

      expect(headers['X-API-Key']).toBe('test-key-123');
    });

    it('should still support BEARER auth', async () => {
      const webhook = {
        outgoingAuthType: 'BEARER',
        outgoingAuthConfig: {
          token: 'bearer-token-123'
        }
      };

      const headers = await buildAuthHeaders(webhook);

      expect(headers['Authorization']).toBe('Bearer bearer-token-123');
    });

    it('should still support BASIC auth', async () => {
      const webhook = {
        outgoingAuthType: 'BASIC',
        outgoingAuthConfig: {
          username: 'user',
          password: 'pass'
        }
      };

      const headers = await buildAuthHeaders(webhook);

      expect(headers['Authorization']).toBe('Basic dXNlcjpwYXNz'); // base64 of "user:pass"
    });

    it('should still support NONE auth', async () => {
      const webhook = {
        outgoingAuthType: 'NONE',
        outgoingAuthConfig: {}
      };

      const headers = await buildAuthHeaders(webhook);

      expect(Object.keys(headers)).toHaveLength(0);
    });
  });
});
