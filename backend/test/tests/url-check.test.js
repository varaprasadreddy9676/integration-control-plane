'use strict';

const { validateTargetUrl } = require('../../src/utils/url-check');

describe('validateTargetUrl', () => {
  test('allows HTTP by default', () => {
    expect(validateTargetUrl('http://example.com/webhook')).toEqual({ valid: true });
  });

  test('allows HTTPS by default', () => {
    expect(validateTargetUrl('https://example.com/webhook')).toEqual({ valid: true });
  });

  test('rejects non-HTTP protocols', () => {
    const result = validateTargetUrl('ftp://example.com/webhook');
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('Only HTTP and HTTPS URLs are allowed');
  });

  test('can still enforce HTTPS when explicitly enabled', () => {
    const result = validateTargetUrl('http://example.com/webhook', {
      enforceHttps: true,
      blockPrivateNetworks: false,
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('HTTPS required');
  });

  test('continues blocking private-network targets when enabled', () => {
    const result = validateTargetUrl('http://127.0.0.1:5055/webhook', {
      blockPrivateNetworks: true,
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/Localhost|Private|not allowed/i);
  });
});
