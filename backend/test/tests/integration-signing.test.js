'use strict';

jest.mock('../../src/logger', () => ({
  log: jest.fn(),
}));

const {
  generateSigningSecret,
  signPayload,
  generateSignatureHeaders,
  verifySignature,
  verifySignedRequest,
} = require('../../src/services/integration-signing');

describe('integration-signing service', () => {
  it('generates a prefixed high-entropy secret', () => {
    const secret = generateSigningSecret();

    expect(secret.startsWith('whsec_')).toBe(true);
    expect(secret.length).toBeGreaterThan('whsec_'.length + 40);
  });

  it('signs a payload and verifies it successfully', () => {
    const secret = generateSigningSecret();
    const messageId = 'msg_123';
    const timestamp = Math.floor(Date.now() / 1000);
    const payload = JSON.stringify({ hello: 'world', count: 1 });

    const signature = signPayload(secret, messageId, timestamp, payload);

    expect(signature.startsWith('v1,')).toBe(true);
    expect(verifySignature(secret, messageId, timestamp, payload, signature)).toBe(true);
  });

  it('rejects tampered payloads', () => {
    const secret = generateSigningSecret();
    const messageId = 'msg_123';
    const timestamp = Math.floor(Date.now() / 1000);
    const payload = JSON.stringify({ hello: 'world', count: 1 });
    const tampered = JSON.stringify({ hello: 'world', count: 2 });

    const signature = signPayload(secret, messageId, timestamp, payload);

    expect(verifySignature(secret, messageId, timestamp, tampered, signature)).toBe(false);
  });

  it('rejects old timestamps outside the replay window', () => {
    const secret = generateSigningSecret();
    const messageId = 'msg_123';
    const timestamp = Math.floor(Date.now() / 1000) - 301;
    const payload = JSON.stringify({ hello: 'world' });

    const signature = signPayload(secret, messageId, timestamp, payload);

    expect(verifySignature(secret, messageId, timestamp, payload, signature)).toBe(false);
  });

  it('generates rotation-friendly headers with multiple signatures', () => {
    const secretA = generateSigningSecret();
    const secretB = generateSigningSecret();
    const messageId = 'msg_123';
    const timestamp = Math.floor(Date.now() / 1000);
    const payload = JSON.stringify({ hello: 'world' });

    const headers = generateSignatureHeaders([secretA, secretB], messageId, timestamp, payload);

    expect(headers['X-Integration-ID']).toBe(messageId);
    expect(headers['X-Integration-Timestamp']).toBe(String(timestamp));
    expect(headers['X-Integration-Signature'].split(' ')).toHaveLength(2);

    const [sigA, sigB] = headers['X-Integration-Signature'].split(' ');
    expect(verifySignature(secretA, messageId, timestamp, payload, sigA)).toBe(true);
    expect(verifySignature(secretB, messageId, timestamp, payload, sigB)).toBe(true);
  });

  it('rejects malformed signature formats', () => {
    const secret = generateSigningSecret();
    const messageId = 'msg_123';
    const timestamp = Math.floor(Date.now() / 1000);
    const payload = JSON.stringify({ hello: 'world' });

    expect(verifySignature(secret, messageId, timestamp, payload, 'not-a-signature')).toBe(false);
  });

  it('verifies signed requests using configured header names', () => {
    const secret = generateSigningSecret();
    const messageId = 'msg_hmac';
    const timestamp = Math.floor(Date.now() / 1000);
    const payload = JSON.stringify({ orderId: '1234', total: 42 });
    const headers = generateSignatureHeaders(secret, messageId, timestamp, payload);

    expect(
      verifySignedRequest(
        {
          secret,
          signatureHeader: 'X-Integration-Signature',
          timestampHeader: 'X-Integration-Timestamp',
          messageIdHeader: 'X-Integration-ID',
          toleranceSeconds: 300,
        },
        {
          'x-integration-signature': headers['X-Integration-Signature'],
          'x-integration-timestamp': headers['X-Integration-Timestamp'],
          'x-integration-id': headers['X-Integration-ID'],
        },
        payload
      )
    ).toBe(true);
  });

  it('rejects signed requests when the body does not match', () => {
    const secret = generateSigningSecret();
    const messageId = 'msg_hmac';
    const timestamp = Math.floor(Date.now() / 1000);
    const payload = JSON.stringify({ orderId: '1234', total: 42 });
    const headers = generateSignatureHeaders(secret, messageId, timestamp, payload);

    expect(
      verifySignedRequest(
        { secret },
        headers,
        JSON.stringify({ orderId: '1234', total: 43 })
      )
    ).toBe(false);
  });
});
