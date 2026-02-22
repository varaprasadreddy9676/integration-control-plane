/**
 * Integration Signing Service
 * Implements Standard Integrations specification for payload signing
 * Follows industry best practices from Stripe, GitHub, Shopify, Svix
 *
 * Security features:
 * - HMAC-SHA256 (not MD5/SHA1)
 * - Per-endpoint unique secrets (not shared)
 * - Signs payload + metadata (timestamp + message ID)
 * - High-entropy secrets (32 bytes, whsec_ prefix)
 * - Replay attack protection (timestamp validation)
 * - Zero-downtime secret rotation (multiple active secrets)
 * - Treats payload as byte stream (no canonical form assumptions)
 *
 * Reference: https://github.com/standard-integrations/standard-integrations
 */

const crypto = require('crypto');
const { log } = require('../logger');

// Constants following Standard Integrations specification
const SIGNATURE_VERSION = 'v1';
const SECRET_PREFIX = 'whsec_';
const SECRET_BYTES = 32; // 256 bits of entropy

// Signature header names (generic format)
const HEADER_SIGNATURE = 'X-Integration-Signature';
const HEADER_TIMESTAMP = 'X-Integration-Timestamp';
const HEADER_ID = 'X-Integration-ID';

/**
 * Generate a high-entropy signing secret
 * - 32 bytes (256 bits) of cryptographically secure random data
 * - Base64 encoded for safe transmission
 * - Prefixed with 'whsec_' for secret scanning (GitHub, GitLab, etc.)
 *
 * @returns {string} Secret in format: whsec_<base64>
 */
function generateSigningSecret() {
  const randomBytes = crypto.randomBytes(SECRET_BYTES);
  const base64Secret = randomBytes.toString('base64');
  return `${SECRET_PREFIX}${base64Secret}`;
}

/**
 * Extract the base64 portion of a prefixed secret
 * Handles both prefixed (whsec_...) and raw base64 secrets
 *
 * @param {string} secret - The secret (with or without prefix)
 * @returns {Buffer} The secret bytes
 */
function extractSecretBytes(secret) {
  if (!secret) {
    throw new Error('Secret is required for signing');
  }

  // Remove prefix if present
  const base64Secret = secret.startsWith(SECRET_PREFIX) ? secret.slice(SECRET_PREFIX.length) : secret;

  // Decode base64 to bytes
  return Buffer.from(base64Secret, 'base64');
}

/**
 * Sign a integration payload following Standard Integrations specification
 *
 * Signature scheme:
 * 1. Create signed content: `${messageId}.${timestamp}.${payload}`
 * 2. Generate HMAC-SHA256 signature: hmac(secret, signedContent)
 * 3. Base64 encode the signature
 * 4. Format: `v1,<base64_signature>`
 *
 * Security notes:
 * - Signs metadata (timestamp + ID) to prevent tampering and replay attacks
 * - Treats payload as byte stream (no JSON normalization)
 * - Uses HMAC-SHA256 (secure and widely supported)
 *
 * @param {string} secret - The signing secret (whsec_...)
 * @param {string} messageId - Unique message identifier (UUID)
 * @param {number} timestamp - Unix timestamp in seconds
 * @param {string} payload - The integration payload as string (JSON.stringify result)
 * @returns {string} Signature in format: v1,base64_signature
 */
function signPayload(secret, messageId, timestamp, payload) {
  try {
    // Validate inputs
    if (!messageId || !timestamp || payload === undefined) {
      throw new Error('messageId, timestamp, and payload are required for signing');
    }

    // Extract secret bytes
    const secretBytes = extractSecretBytes(secret);

    // Create signed content: messageId.timestamp.payload
    // This follows Standard Integrations spec exactly
    const signedContent = `${messageId}.${timestamp}.${payload}`;

    // Generate HMAC-SHA256 signature
    const signature = crypto.createHmac('sha256', secretBytes).update(signedContent, 'utf8').digest('base64');

    // Format: v1,signature (Standard Integrations format)
    return `${SIGNATURE_VERSION},${signature}`;
  } catch (error) {
    log('error', 'Failed to sign integration payload', {
      error: error.message,
      messageId,
      timestamp,
    });
    throw error;
  }
}

/**
 * Generate integration signature headers
 * Supports zero-downtime secret rotation by signing with multiple secrets
 *
 * @param {string|string[]} secrets - Single secret or array of secrets for rotation
 * @param {string} messageId - Unique message identifier
 * @param {number} timestamp - Unix timestamp in seconds
 * @param {string} payload - The integration payload as string
 * @returns {object} Headers object with signature, timestamp, and ID
 */
function generateSignatureHeaders(secrets, messageId, timestamp, payload) {
  try {
    // Normalize secrets to array
    const secretsArray = Array.isArray(secrets) ? secrets : [secrets];

    // Filter out null/undefined secrets
    const validSecrets = secretsArray.filter((s) => s?.trim());

    if (validSecrets.length === 0) {
      throw new Error('At least one valid secret is required');
    }

    // Sign with all active secrets (for zero-downtime rotation)
    // Format: "v1,sig1 v1,sig2" (space-separated)
    const signatures = validSecrets.map((secret) => signPayload(secret, messageId, timestamp, payload)).join(' ');

    // Return Standard Integrations headers
    return {
      [HEADER_SIGNATURE]: signatures,
      [HEADER_TIMESTAMP]: timestamp.toString(),
      [HEADER_ID]: messageId,
    };
  } catch (error) {
    log('error', 'Failed to generate signature headers', {
      error: error.message,
      messageId,
      secretCount: Array.isArray(secrets) ? secrets.length : 1,
    });
    throw error;
  }
}

/**
 * Verify a integration signature (for receivers)
 * Validates signature and protects against replay attacks
 *
 * Note: This is provided for documentation/testing purposes
 * Actual verification happens on the receiver's end
 *
 * @param {string} secret - The signing secret
 * @param {string} messageId - Message ID from headers
 * @param {number} timestamp - Timestamp from headers
 * @param {string} payload - The raw payload string
 * @param {string} signature - The signature to verify (v1,base64)
 * @param {number} toleranceSeconds - Max age of message (default: 300 = 5 minutes)
 * @returns {boolean} True if signature is valid and not replayed
 */
function verifySignature(secret, messageId, timestamp, payload, signature, toleranceSeconds = 300) {
  try {
    // 1. Validate timestamp (replay attack protection)
    const now = Math.floor(Date.now() / 1000);
    const age = Math.abs(now - timestamp);

    if (age > toleranceSeconds) {
      log('warn', 'Signature verification failed: timestamp too old', {
        messageId,
        timestamp,
        age,
        toleranceSeconds,
      });
      return false;
    }

    // 2. Extract signature version and value
    const parts = signature.split(',');
    if (parts.length !== 2 || parts[0] !== SIGNATURE_VERSION) {
      log('warn', 'Invalid signature format', { signature });
      return false;
    }

    // 3. Compute expected signature
    const expectedSignature = signPayload(secret, messageId, timestamp, payload);

    // 4. Constant-time comparison (prevents timing attacks)
    const expected = Buffer.from(expectedSignature, 'utf8');
    const actual = Buffer.from(signature, 'utf8');

    if (expected.length !== actual.length) {
      return false;
    }

    // Use crypto.timingSafeEqual for constant-time comparison
    return crypto.timingSafeEqual(expected, actual);
  } catch (error) {
    log('error', 'Signature verification error', {
      error: error.message,
      messageId,
    });
    return false;
  }
}

/**
 * Generate verification code examples for receivers
 * Helps customers implement signature verification correctly
 *
 * @param {string} secret - Example secret to show in docs
 * @returns {object} Code examples in multiple languages
 */
function generateVerificationExamples(secret) {
  const exampleSecret = secret || `${SECRET_PREFIX}C2FVsBQIhrscChlQIMV+b5sSYspob7oD`;

  return {
    javascript: `// Node.js signature verification
const crypto = require('crypto');

function verifyIntegration(secret, headers, rawBody) {
  const messageId = headers['x-integration-id'];
  const timestamp = headers['x-integration-timestamp'];
  const signature = headers['x-integration-signature'];

  // 1. Validate timestamp (prevent replay attacks)
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parseInt(timestamp)) > 300) {
    throw new Error('Integration timestamp is too old');
  }

  // 2. Extract secret bytes (remove 'whsec_' prefix)
  const secretBytes = Buffer.from(secret.split('_')[1], 'base64');

  // 3. Create signed content: messageId.timestamp.payload
  const signedContent = \`\${messageId}.\${timestamp}.\${rawBody}\`;

  // 4. Compute expected signature
  const expectedSig = crypto
    .createHmac('sha256', secretBytes)
    .update(signedContent, 'utf8')
    .digest('base64');

  const expectedSignature = \`v1,\${expectedSig}\`;

  // 5. Compare signatures (support multiple for rotation)
  const signatures = signature.split(' ');
  const isValid = signatures.some(sig => sig === expectedSignature);

  if (!isValid) {
    throw new Error('Invalid integration signature');
  }

  return true;
}

// Example usage:
const secret = '${exampleSecret}';
const isValid = verifyIntegration(secret, req.headers, req.body);`,

    python: `# Python signature verification
import hmac
import hashlib
import base64
import time

def verify_integration(secret, headers, raw_body):
    message_id = headers.get('x-integration-id')
    timestamp = headers.get('x-integration-timestamp')
    signature = headers.get('x-integration-signature')

    # 1. Validate timestamp (prevent replay attacks)
    now = int(time.time())
    if abs(now - int(timestamp)) > 300:
        raise ValueError('Integration timestamp is too old')

    # 2. Extract secret bytes (remove 'whsec_' prefix)
    secret_bytes = base64.b64decode(secret.split('_')[1])

    # 3. Create signed content: messageId.timestamp.payload
    signed_content = f"{message_id}.{timestamp}.{raw_body}"

    # 4. Compute expected signature
    expected_sig = base64.b64encode(
        hmac.new(secret_bytes, signed_content.encode(), hashlib.sha256).digest()
    ).decode()

    expected_signature = f"v1,{expected_sig}"

    # 5. Compare signatures (support multiple for rotation)
    signatures = signature.split(' ')
    is_valid = expected_signature in signatures

    if not is_valid:
        raise ValueError('Invalid integration signature')

    return True

# Example usage:
secret = '${exampleSecret}'
is_valid = verify_integration(secret, request.headers, request.data)`,

    php: `<?php
// PHP signature verification
function verifyIntegration($secret, $headers, $rawBody) {
    $messageId = $headers['x-integration-id'];
    $timestamp = $headers['x-integration-timestamp'];
    $signature = $headers['x-integration-signature'];

    // 1. Validate timestamp (prevent replay attacks)
    $now = time();
    if (abs($now - intval($timestamp)) > 300) {
        throw new Exception('Integration timestamp is too old');
    }

    // 2. Extract secret bytes (remove 'whsec_' prefix)
    $secretBytes = base64_decode(explode('_', $secret)[1]);

    // 3. Create signed content: messageId.timestamp.payload
    $signedContent = "$messageId.$timestamp.$rawBody";

    // 4. Compute expected signature
    $expectedSig = base64_encode(
        hash_hmac('sha256', $signedContent, $secretBytes, true)
    );

    $expectedSignature = "v1,$expectedSig";

    // 5. Compare signatures (support multiple for rotation)
    $signatures = explode(' ', $signature);
    $isValid = in_array($expectedSignature, $signatures);

    if (!$isValid) {
        throw new Exception('Invalid integration signature');
    }

    return true;
}

// Example usage:
$secret = '${exampleSecret}';
$isValid = verifyIntegration($secret, getallheaders(), file_get_contents('php://input'));
?>`,

    go: `// Go signature verification
package main

import (
    "crypto/hmac"
    "crypto/sha256"
    "encoding/base64"
    "errors"
    "fmt"
    "strconv"
    "strings"
    "time"
)

func VerifyIntegration(secret string, headers map[string]string, rawBody string) error {
    messageID := headers["X-Integration-ID"]
    timestamp := headers["X-Integration-Timestamp"]
    signature := headers["X-Integration-Signature"]

    // 1. Validate timestamp (prevent replay attacks)
    ts, _ := strconv.ParseInt(timestamp, 10, 64)
    now := time.Now().Unix()
    if abs(now-ts) > 300 {
        return errors.New("integration timestamp is too old")
    }

    // 2. Extract secret bytes (remove 'whsec_' prefix)
    parts := strings.Split(secret, "_")
    secretBytes, _ := base64.StdEncoding.DecodeString(parts[1])

    // 3. Create signed content: messageId.timestamp.payload
    signedContent := fmt.Sprintf("%s.%s.%s", messageID, timestamp, rawBody)

    // 4. Compute expected signature
    mac := hmac.New(sha256.New, secretBytes)
    mac.Write([]byte(signedContent))
    expectedSig := base64.StdEncoding.EncodeToString(mac.Sum(nil))
    expectedSignature := fmt.Sprintf("v1,%s", expectedSig)

    // 5. Compare signatures (support multiple for rotation)
    signatures := strings.Split(signature, " ")
    for _, sig := range signatures {
        if sig == expectedSignature {
            return nil
        }
    }

    return errors.New("invalid integration signature")
}

// Example usage:
secret := "${exampleSecret}"
err := VerifyIntegration(secret, headers, requestBody)`,
  };
}

module.exports = {
  generateSigningSecret,
  signPayload,
  generateSignatureHeaders,
  verifySignature,
  generateVerificationExamples,
  // Export constants for use in other modules
  SIGNATURE_VERSION,
  SECRET_PREFIX,
  HEADER_SIGNATURE,
  HEADER_TIMESTAMP,
  HEADER_ID,
};
