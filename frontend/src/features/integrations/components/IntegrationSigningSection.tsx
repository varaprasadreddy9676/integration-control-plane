import { useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Collapse,
  Drawer,
  Form,
  Input,
  Modal,
  Row,
  Space,
  Steps,
  Switch,
  Tabs,
  Tag,
  Typography,
  message,
  Tooltip
} from 'antd';
import {
  CopyOutlined,
  EyeOutlined,
  EyeInvisibleOutlined,
  KeyOutlined,
  PlusOutlined,
  DeleteOutlined,
  InfoCircleOutlined,
  CodeOutlined,
  SafetyOutlined,
  CheckCircleOutlined,
  WarningOutlined,
  BookOutlined,
  QuestionCircleOutlined,
  BugOutlined,
  ClockCircleOutlined
} from '@ant-design/icons';
import type { IntegrationConfig } from '../../../mocks/types';
import { cssVar } from '../../../design-system/utils';

const { Text, Title, Paragraph } = Typography;

interface IntegrationSigningSectionProps {
  integration?: IntegrationConfig;
  form: any;
  isCreate: boolean;
  spacing: any;
  colors: any;
  token: any;
  onRotateSecret?: () => Promise<void>;
  onRemoveSecret?: (secret: string) => Promise<void>;
  hideToggle?: boolean;
  showConfigAlways?: boolean;
}

export const IntegrationSigningSection = ({
  integration,
  form,
  isCreate,
  spacing,
  colors,
  token,
  onRotateSecret,
  onRemoveSecret,
  hideToggle = false,
  showConfigAlways = false
}: IntegrationSigningSectionProps) => {
  const [messageApi, contextHolder] = message.useMessage();
  const [showSecrets, setShowSecrets] = useState<{ [key: string]: boolean }>({});
  const [codeModalOpen, setCodeModalOpen] = useState(false);
  const [learnMoreOpen, setLearnMoreOpen] = useState(false);

  const enableSigning = Form.useWatch('enableSigning', form);
  const signingSecret = Form.useWatch('signingSecret', form);
  const signingSecrets = Form.useWatch('signingSecrets', form) || [];

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    messageApi.success(`${label} copied to clipboard!`);
  };

  const maskSecret = (secret: string) => {
    if (!secret) return '';
    const prefix = secret.substring(0, 10);
    return `${prefix}${'•'.repeat(20)}`;
  };

  const toggleSecretVisibility = (secret: string) => {
    setShowSecrets(prev => ({ ...prev, [secret]: !prev[secret] }));
  };

  // Generate verification code examples
  const generateVerificationCode = (language: 'javascript' | 'python' | 'php' | 'go') => {
    const exampleSecret = signingSecret || 'whsec_<your_signing_secret_here>';

    switch (language) {
      case 'javascript':
        return `// Node.js signature verification
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
const isValid = verifyIntegration(secret, req.headers, req.body);`;

      case 'python':
        return `# Python signature verification
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
is_valid = verify_integration(secret, request.headers, request.data)`;

      case 'php':
        return `<?php
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
?>`;

      case 'go':
        return `// Go signature verification
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

func abs(x int64) int64 {
    if x < 0 {
        return -x
    }
    return x
}

// Example usage:
secret := "${exampleSecret}"
err := VerifyIntegration(secret, headers, requestBody)`;

      default:
        return '';
    }
  };

  return (
    <>
      {contextHolder}

      <Row gutter={[16, 16]}>
        {/* Educational Header - What is Integration Signing? */}
        <Col xs={24}>
          <Card
            style={{
              background: cssVar.bg.surface,
              border: `1px solid ${token.colorBorder}`,
              borderRadius: token.borderRadius
            }}
          >
            <Space direction="vertical" size="large" style={{ width: '100%' }}>
              {/* Main Explanation */}
              <div>
                <Space align="start">
                  <SafetyOutlined style={{ fontSize: 24, color: colors.primary[600] }} />
                  <div>
                    <Title level={5} style={{ margin: 0, marginBottom: 8 }}>
                      What is Integration Signing?
                    </Title>
                    <Paragraph style={{ marginBottom: 0, color: token.colorTextSecondary }}>
                      Integration signing adds a cryptographic signature to each integration delivery, allowing your receiving system
                      to verify that the integration <strong>actually came from this system</strong> and <strong>hasn't been tampered with</strong>.
                      It's like a digital seal that proves authenticity.
                    </Paragraph>
                  </div>
                </Space>
              </div>

              {/* Benefits Grid */}
              <Row gutter={[16, 16]}>
                <Col xs={24} md={12}>
                  <Space>
                    <CheckCircleOutlined style={{ color: colors.success[600], fontSize: 18 }} />
                    <div>
                      <Text strong>Verify Authenticity</Text>
                      <br />
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        Confirm integrations really came from your source system, not an attacker
                      </Text>
                    </div>
                  </Space>
                </Col>
                <Col xs={24} md={12}>
                  <Space>
                    <SafetyOutlined style={{ color: colors.primary[600], fontSize: 18 }} />
                    <div>
                      <Text strong>Prevent Tampering</Text>
                      <br />
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        Detect if payload was modified in transit
                      </Text>
                    </div>
                  </Space>
                </Col>
                <Col xs={24} md={12}>
                  <Space>
                    <ClockCircleOutlined style={{ color: colors.warning[600], fontSize: 18 }} />
                    <div>
                      <Text strong>Replay Protection</Text>
                      <br />
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        Stop attackers from resending old integrations
                      </Text>
                    </div>
                  </Space>
                </Col>
                <Col xs={24} md={12}>
                  <Space>
                    <BugOutlined style={{ color: colors.error[600], fontSize: 18 }} />
                    <div>
                      <Text strong>Secure Compliance</Text>
                      <br />
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        Meet healthcare security standards (HIPAA, SOC 2)
                      </Text>
                    </div>
                  </Space>
                </Col>
              </Row>

              {/* When to Use */}
              <Alert
                type="info"
                showIcon
                icon={<QuestionCircleOutlined />}
                message="When to enable?"
                description="Required for production, PHI/financial data, compliance (HIPAA, SOC 2), and public endpoints. Optional for local dev/testing."
              />

              {/* Action Buttons */}
              <Space>
                <Button
                  icon={<BookOutlined />}
                  onClick={() => setLearnMoreOpen(true)}
                >
                  Learn More & Setup Guide
                </Button>
                <Button
                  type="link"
                  icon={<CodeOutlined />}
                  onClick={() => setCodeModalOpen(true)}
                >
                  View Code Examples
                </Button>
              </Space>
            </Space>
          </Card>
        </Col>

        {/* Enable Signing Toggle - Only show if not hidden */}
        {!hideToggle && (
          <Col xs={24}>
            <Form.Item
              name="enableSigning"
              label={
                <Space>
                  <Text strong>Enable Integration Signing</Text>
                  <Tooltip title="Recommended for production systems with sensitive data">
                    <InfoCircleOutlined style={{ color: token.colorTextSecondary }} />
                  </Tooltip>
                </Space>
              }
              valuePropName="checked"
              extra={
                <Space direction="vertical" size={0}>
                  <Text type="secondary">
                    {enableSigning
                      ? '✓ Signatures will be added to all integration deliveries'
                      : 'Integrations will be sent without signatures (less secure)'}
                  </Text>
                  {!enableSigning && (
                    <Text type="warning" style={{ fontSize: 12 }}>
                      ⚠️ Not recommended for production systems handling patient data
                    </Text>
                  )}
                </Space>
              }
            >
              <Switch />
            </Form.Item>
          </Col>
        )}

        {(enableSigning || showConfigAlways) && (
          <>
            {/* No Secrets Yet - Show Info Message */}
            {!signingSecret && (
              <Col xs={24}>
                <Alert
                  type="info"
                  showIcon
                  message={isCreate ? "Secret generated on save" : "No secret yet"}
                  description={
                    isCreate
                      ? "A signing secret will be auto-generated when you save."
                      : "Save to generate a signing secret for verification."
                  }
                  style={{ marginBottom: 16 }}
                />
              </Col>
            )}

            {/* Current Signing Secret */}
            {signingSecret && (
              <Col xs={24}>
                <div style={{
                  padding: 16,
                  background: cssVar.bg.surface,
                  border: `1px solid ${token.colorBorder}`,
                  borderRadius: token.borderRadius
                }}>
                  <Space direction="vertical" style={{ width: '100%' }} size="small">
                    <Space>
                      <KeyOutlined style={{ color: colors.primary[600] }} />
                      <Text strong>Current Signing Secret</Text>
                      <Tag color="success">Active</Tag>
                    </Space>

                    <Input
                      value={showSecrets[signingSecret] ? signingSecret : maskSecret(signingSecret)}
                      readOnly
                      addonAfter={
                        <Space size="small">
                          <Button
                            type="text"
                            size="small"
                            icon={showSecrets[signingSecret] ? <EyeInvisibleOutlined /> : <EyeOutlined />}
                            onClick={() => toggleSecretVisibility(signingSecret)}
                          />
                          <Button
                            type="text"
                            size="small"
                            icon={<CopyOutlined />}
                            onClick={() => copyToClipboard(signingSecret, 'Signing secret')}
                          />
                        </Space>
                      }
                    />
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      Keep this secret secure. You'll need it to verify integration signatures.
                    </Text>
                  </Space>
                </div>
              </Col>
            )}

            {/* Secret Rotation Section */}
            {!isCreate && signingSecrets.length > 0 && (
              <Col xs={24}>
                <div style={{
                  padding: 16,
                  background: cssVar.bg.surface,
                  border: `1px solid ${token.colorBorder}`,
                  borderRadius: token.borderRadius
                }}>
                  <Space direction="vertical" style={{ width: '100%' }} size="middle">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Space>
                        <Text strong>Secret Rotation</Text>
                        <Tag>{signingSecrets.length} active secret{signingSecrets.length > 1 ? 's' : ''}</Tag>
                      </Space>
                      {onRotateSecret && (
                        <Button
                          icon={<PlusOutlined />}
                          onClick={onRotateSecret}
                          disabled={signingSecrets.length >= 3}
                        >
                          Add New Secret
                        </Button>
                      )}
                    </div>

                    {signingSecrets.length > 1 && (
                      <Alert
                        type="warning"
                        message="Multiple Active Secrets"
                        description={`${signingSecrets.length} secrets active. All used for signing. Remove old ones after receivers update.`}
                        showIcon
                      />
                    )}

                    <Space direction="vertical" style={{ width: '100%' }}>
                      {signingSecrets.map((secret: string, index: number) => (
                        <div
                          key={secret}
                          style={{
                            display: 'flex',
                            gap: 8,
                            alignItems: 'center',
                            padding: 12,
                            background: secret === signingSecret ? withAlpha(colors.success[100], 0.3) : cssVar.bg.subtle,
                            borderRadius: token.borderRadius,
                            border: `1px solid ${secret === signingSecret ? colors.success[300] : token.colorBorder}`
                          }}
                        >
                          <Input
                            value={showSecrets[secret] ? secret : maskSecret(secret)}
                            readOnly
                            style={{ flex: 1 }}
                          />
                          <Button
                            type="text"
                            size="small"
                            icon={showSecrets[secret] ? <EyeInvisibleOutlined /> : <EyeOutlined />}
                            onClick={() => toggleSecretVisibility(secret)}
                          />
                          <Button
                            type="text"
                            size="small"
                            icon={<CopyOutlined />}
                            onClick={() => copyToClipboard(secret, 'Secret')}
                          />
                          {signingSecrets.length > 1 && secret !== signingSecret && onRemoveSecret && (
                            <Button
                              type="text"
                              size="small"
                              danger
                              icon={<DeleteOutlined />}
                              onClick={() => onRemoveSecret(secret)}
                            />
                          )}
                          {secret === signingSecret && (
                            <Tag color="success" style={{ marginLeft: 8 }}>Primary</Tag>
                          )}
                        </div>
                      ))}
                    </Space>

                    <Text type="secondary" style={{ fontSize: 12 }}>
                      <InfoCircleOutlined style={{ marginRight: 4 }} />
                      Zero-downtime rotation: Add a new secret, update your receivers, then remove the old secret.
                    </Text>
                  </Space>
                </div>
              </Col>
            )}

            {/* Verification Code Button */}
            <Col xs={24}>
              <Button
                icon={<CodeOutlined />}
                onClick={() => setCodeModalOpen(true)}
                block
                size="large"
              >
                View Verification Code Examples
              </Button>
            </Col>

            {/* Important Information - Collapsible */}
            <Col xs={24}>
              <Collapse
                items={[
                  {
                    key: 'critical-warning',
                    label: <Text strong>⚠️ CRITICAL: Remote System Must Implement Verification</Text>,
                    children: (
                      <Space direction="vertical" size="small" style={{ width: '100%' }}>
                        <Paragraph style={{ marginBottom: 8 }}>
                          <strong>Enabling signing alone does NOT secure your integrations!</strong> Your receiving system MUST implement signature verification, or this provides zero security benefit.
                        </Paragraph>
                        <div>
                          <Text strong>Before enabling, ensure your remote team has:</Text>
                          <ul style={{ marginBottom: 8, paddingLeft: 20, marginTop: 4 }}>
                            <li>Implemented verification code (see "Code Examples" above)</li>
                            <li>Received and stored the signing secret securely</li>
                            <li>Tested signature verification in their staging environment</li>
                            <li>Deployed verification to production</li>
                          </ul>
                        </div>
                        <Alert
                          type="warning"
                          message="Remote system must verify signatures - otherwise attackers can send fake integrations."
                          showIcon
                          banner
                        />
                      </Space>
                    )
                  },
                  {
                    key: 'headers-info',
                    label: <Text strong>Signature Headers Information</Text>,
                    children: (
                      <>
                        <Paragraph style={{ marginBottom: 8 }}>
                          Your integrations will include three signature headers:
                        </Paragraph>
                        <ul style={{ marginBottom: 0, paddingLeft: 20 }}>
                          <li><code>X-Integration-Signature</code>: HMAC-SHA256 signature</li>
                          <li><code>X-Integration-Timestamp</code>: Unix timestamp (replay protection)</li>
                          <li><code>X-Integration-ID</code>: Unique message identifier</li>
                        </ul>
                      </>
                    )
                  }
                ]}
                style={{ marginTop: 16 }}
              />
            </Col>
          </>
        )}
      </Row>

      {/* Learn More Drawer - Comprehensive Setup Guide */}
      <Drawer
        title={
          <Space>
            <BookOutlined />
            <span>Integration Signing - Complete Guide</span>
          </Space>
        }
        open={learnMoreOpen}
        onClose={() => setLearnMoreOpen(false)}
        width={720}
      >
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          {/* How It Works */}
          <div>
            <Title level={4}>
              <SafetyOutlined /> How It Works
            </Title>
            <Paragraph>
              When you enable integration signing, every integration delivery includes three special headers:
            </Paragraph>
            <Card size="small" style={{ background: cssVar.bg.subtle }}>
              <Space direction="vertical" style={{ width: '100%' }}>
                <div>
                  <code style={{ color: colors.primary[600] }}>X-Integration-Signature</code>
                  <Text type="secondary" style={{ marginLeft: 8 }}>
                    HMAC-SHA256 cryptographic signature
                  </Text>
                </div>
                <div>
                  <code style={{ color: colors.primary[600] }}>X-Integration-Timestamp</code>
                  <Text type="secondary" style={{ marginLeft: 8 }}>
                    Unix timestamp (prevents replay attacks)
                  </Text>
                </div>
                <div>
                  <code style={{ color: colors.primary[600] }}>X-Integration-ID</code>
                  <Text type="secondary" style={{ marginLeft: 8 }}>
                    Unique message identifier (UUID)
                  </Text>
                </div>
              </Space>
            </Card>
          </div>

          {/* Setup Steps */}
          <div>
            <Title level={4}>
              <CheckCircleOutlined /> Setup Steps
            </Title>
            <Steps
              direction="vertical"
              current={-1}
              items={[
                {
                  title: 'Enable Signing',
                  description: 'Toggle "Enable Integration Signing" on this page',
                  icon: <SafetyOutlined />
                },
                {
                  title: 'Copy Signing Secret',
                  description: 'Copy the generated signing secret (starts with whsec_)',
                  icon: <KeyOutlined />
                },
                {
                  title: 'Add Verification Code',
                  description: 'Add verification code to your integration receiver (see Code Examples)',
                  icon: <CodeOutlined />
                },
                {
                  title: 'Test Integration',
                  description: 'Use the "Test Integration" button to verify signatures are working',
                  icon: <BugOutlined />
                },
                {
                  title: 'Deploy to Production',
                  description: 'Once tested, your integrations are now securely signed!',
                  icon: <CheckCircleOutlined />
                }
              ]}
            />
          </div>

          {/* Real-World Scenarios */}
          <div>
            <Title level={4}>
              <WarningOutlined /> Real-World Attack Scenarios (Why You Need This)
            </Title>
            <Collapse
              items={[
                {
                  key: '1',
                  label: '🎭 Impersonation Attack',
                  children: (
                    <div>
                      <Paragraph>
                        <strong>Without Signing:</strong> An attacker sends a fake integration pretending to be from your source system,
                        injecting false patient data into your system.
                      </Paragraph>
                      <Paragraph type="success">
                        <strong>With Signing:</strong> Your system verifies the signature, detects it's fake, and rejects it immediately.
                      </Paragraph>
                    </div>
                  )
                },
                {
                  key: '2',
                  label: '✂️ Man-in-the-Middle Tampering',
                  children: (
                    <div>
                      <Paragraph>
                        <strong>Without Signing:</strong> An attacker intercepts a integration, changes the billing amount from
                        $100 to $1000, and forwards it to your system.
                      </Paragraph>
                      <Paragraph type="success">
                        <strong>With Signing:</strong> The signature won't match the tampered data, so your system rejects it.
                      </Paragraph>
                    </div>
                  )
                },
                {
                  key: '3',
                  label: '🔁 Replay Attack',
                  children: (
                    <div>
                      <Paragraph>
                        <strong>Without Signing:</strong> An attacker captures a valid integration (e.g., "charge patient $50")
                        and replays it 100 times.
                      </Paragraph>
                      <Paragraph type="success">
                        <strong>With Signing:</strong> Timestamp validation detects the integration is old (&gt; 5 minutes) and rejects replays.
                      </Paragraph>
                    </div>
                  )
                },
                {
                  key: '4',
                  label: '🏥 HIPAA Compliance',
                  children: (
                    <div>
                      <Paragraph>
                        <strong>Audit Requirement:</strong> "How do you ensure integration data hasn't been tampered with?"
                      </Paragraph>
                      <Paragraph type="success">
                        <strong>Your Answer:</strong> "We use cryptographic signatures (HMAC-SHA256) to verify integrity
                        and authenticity of all integration deliveries."
                      </Paragraph>
                    </div>
                  )
                }
              ]}
            />
          </div>

          {/* Secret Rotation Guide */}
          <div>
            <Title level={4}>
              <ClockCircleOutlined /> Zero-Downtime Secret Rotation
            </Title>
            <Paragraph>
              When you need to rotate your signing secret (security best practice every 90 days):
            </Paragraph>
            <ol>
              <li>Click "Add New Secret" - a new secret is generated</li>
              <li>Both old and new secrets are now active (integrations signed with both)</li>
              <li>Update your integration receiver to use the new secret</li>
              <li>Test that verification works with the new secret</li>
              <li>Remove the old secret once you've confirmed the new one works</li>
            </ol>
            <Alert
              type="success"
              showIcon
              message="No Downtime!"
              description="Integrations work throughout rotation - both secrets temporarily active."
            />
          </div>

          {/* Technical Details */}
          <div>
            <Title level={4}>
              <CodeOutlined /> Technical Details
            </Title>
            <Collapse
              items={[
                {
                  key: 'algorithm',
                  label: 'Signing Algorithm',
                  children: (
                    <div>
                      <Paragraph>
                        <strong>Algorithm:</strong> HMAC-SHA256 (Hash-based Message Authentication Code with SHA-256)
                      </Paragraph>
                      <Paragraph>
                        <strong>Signed Content:</strong> <code>messageId.timestamp.payload</code>
                      </Paragraph>
                      <Paragraph>
                        <strong>Format:</strong> <code>v1,&lt;base64_signature&gt;</code>
                      </Paragraph>
                      <Paragraph type="secondary">
                        Used by: Stripe, GitHub, Shopify, Twilio, and most modern integration providers
                      </Paragraph>
                    </div>
                  )
                },
                {
                  key: 'security',
                  label: 'Security Features',
                  children: (
                    <ul>
                      <li><strong>256-bit entropy:</strong> Signing secrets are 32 bytes of cryptographically secure random data</li>
                      <li><strong>Per-endpoint secrets:</strong> Each integration gets a unique secret (not shared)</li>
                      <li><strong>Replay protection:</strong> 5-minute timestamp tolerance window</li>
                      <li><strong>Constant-time comparison:</strong> Prevents timing attacks</li>
                      <li><strong>Multiple active secrets:</strong> Supports up to 3 concurrent secrets for rotation</li>
                    </ul>
                  )
                }
              ]}
            />
          </div>

          {/* Quick Reference */}
          <div>
            <Title level={4}>Quick Reference</Title>
            <Card size="small" style={{ background: cssVar.bg.subtle }}>
              <Space direction="vertical" style={{ width: '100%' }} size="small">
                <div>
                  <Text strong>Secret Format:</Text> <code>whsec_&lt;32_bytes_base64&gt;</code>
                </div>
                <div>
                  <Text strong>Signature Format:</Text> <code>v1,&lt;hmac_sha256_base64&gt;</code>
                </div>
                <div>
                  <Text strong>Replay Window:</Text> 5 minutes (300 seconds)
                </div>
                <div>
                  <Text strong>Max Secrets:</Text> 3 concurrent (for rotation)
                </div>
              </Space>
            </Card>
          </div>
        </Space>
      </Drawer>

      {/* Verification Code Modal */}
      <Modal
        title="Integration Signature Verification"
        open={codeModalOpen}
        onCancel={() => setCodeModalOpen(false)}
        footer={null}
        width={800}
      >
        <Tabs
          items={[
            {
              key: 'javascript',
              label: 'Node.js',
              children: (
                <div style={{ position: 'relative' }}>
                  <Button
                    icon={<CopyOutlined />}
                    onClick={() => copyToClipboard(generateVerificationCode('javascript'), 'Code')}
                    style={{ position: 'absolute', top: 8, right: 8, zIndex: 1 }}
                  >
                    Copy
                  </Button>
                  <pre style={{
                    background: cssVar.bg.subtle,
                    padding: 16,
                    borderRadius: token.borderRadius,
                    overflow: 'auto',
                    maxHeight: 500
                  }}>
                    <code>{generateVerificationCode('javascript')}</code>
                  </pre>
                </div>
              )
            },
            {
              key: 'python',
              label: 'Python',
              children: (
                <div style={{ position: 'relative' }}>
                  <Button
                    icon={<CopyOutlined />}
                    onClick={() => copyToClipboard(generateVerificationCode('python'), 'Code')}
                    style={{ position: 'absolute', top: 8, right: 8, zIndex: 1 }}
                  >
                    Copy
                  </Button>
                  <pre style={{
                    background: cssVar.bg.subtle,
                    padding: 16,
                    borderRadius: token.borderRadius,
                    overflow: 'auto',
                    maxHeight: 500
                  }}>
                    <code>{generateVerificationCode('python')}</code>
                  </pre>
                </div>
              )
            },
            {
              key: 'php',
              label: 'PHP',
              children: (
                <div style={{ position: 'relative' }}>
                  <Button
                    icon={<CopyOutlined />}
                    onClick={() => copyToClipboard(generateVerificationCode('php'), 'Code')}
                    style={{ position: 'absolute', top: 8, right: 8, zIndex: 1 }}
                  >
                    Copy
                  </Button>
                  <pre style={{
                    background: cssVar.bg.subtle,
                    padding: 16,
                    borderRadius: token.borderRadius,
                    overflow: 'auto',
                    maxHeight: 500
                  }}>
                    <code>{generateVerificationCode('php')}</code>
                  </pre>
                </div>
              )
            },
            {
              key: 'go',
              label: 'Go',
              children: (
                <div style={{ position: 'relative' }}>
                  <Button
                    icon={<CopyOutlined />}
                    onClick={() => copyToClipboard(generateVerificationCode('go'), 'Code')}
                    style={{ position: 'absolute', top: 8, right: 8, zIndex: 1 }}
                  >
                    Copy
                  </Button>
                  <pre style={{
                    background: cssVar.bg.subtle,
                    padding: 16,
                    borderRadius: token.borderRadius,
                    overflow: 'auto',
                    maxHeight: 500
                  }}>
                    <code>{generateVerificationCode('go')}</code>
                  </pre>
                </div>
              )
            }
          ]}
        />
      </Modal>
    </>
  );
};

// Helper function to add alpha transparency to hex/rgb colors
function withAlpha(color: string, alpha: number): string {
  // For now, just use the color directly - Ant Design colors work fine
  // In production, you might want to convert hex to rgba
  return color;
}
