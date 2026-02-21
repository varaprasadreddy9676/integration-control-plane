/**
 * AI Settings Example - Shows Permission System in Action
 *
 * This demonstrates how to use the permission system for AI features
 */

import { Card, Form, Input, Select, Button, Alert, Space, Typography, Divider } from 'antd';
import { RobotOutlined, SettingOutlined, LineChartOutlined } from '@ant-design/icons';
import { usePermissions } from '../../hooks/usePermissions';
import { PermissionGuard } from '../../components/common/PermissionGuard';
import { FEATURES, OPERATIONS } from '../../utils/permissions';
import { useDesignTokens, cssVar } from '../../design-system/utils';

const { Title, Text, Paragraph } = Typography;

/**
 * AI Settings Page
 * - Everyone can see AI usage stats (if they have AI access)
 * - Only ORG_ADMIN and above can configure AI provider & API keys
 */
export const AISettingsPage = () => {
  const can = usePermissions();
  const { token, spacing } = useDesignTokens();

  // User can't access AI at all
  if (!can.viewAI() && !can.configureAI()) {
    return (
      <Alert
        type="warning"
        message="AI Features Not Available"
        description="Contact your administrator to get access to AI features."
        style={{ margin: spacing[4] }}
      />
    );
  }

  return (
    <div style={{ padding: spacing[4] }}>
      <Title level={2}>
        <RobotOutlined /> AI Assistant
      </Title>
      <Paragraph type="secondary">
        Configure and monitor AI-powered features for your organization
      </Paragraph>

      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        {/* Usage Statistics - Anyone with AI access can see this */}
        <PermissionGuard feature={FEATURES.AI} operation={OPERATIONS.READ}>
          <Card
            title={
              <Space>
                <LineChartOutlined />
                <span>Usage Statistics</span>
              </Space>
            }
            style={{
              borderRadius: token.borderRadiusLG,
              border: `1px solid ${cssVar.border.default}`
            }}
          >
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: spacing[3] }}>
              <div>
                <Text type="secondary">Requests Today</Text>
                <Title level={3} style={{ margin: 0 }}>
                  45
                </Title>
              </div>
              <div>
                <Text type="secondary">Daily Limit</Text>
                <Title level={3} style={{ margin: 0 }}>
                  100
                </Title>
              </div>
              <div>
                <Text type="secondary">Success Rate</Text>
                <Title level={3} style={{ margin: 0 }}>
                  98%
                </Title>
              </div>
            </div>
          </Card>
        </PermissionGuard>

        {/* AI Configuration - Only ORG_ADMIN and above */}
        <PermissionGuard
          feature={FEATURES.AI_CONFIG}
          operation={OPERATIONS.CONFIGURE}
          fallback={
            <Card style={{ borderRadius: token.borderRadiusLG, border: `1px solid ${cssVar.border.default}` }}>
              <Alert
                type="info"
                message="Configuration Access Required"
                description="Only organization administrators can configure AI settings. Contact your admin to change the AI provider or API keys."
                showIcon
              />
            </Card>
          }
        >
          <Card
            title={
              <Space>
                <SettingOutlined />
                <span>AI Configuration</span>
              </Space>
            }
            style={{
              borderRadius: token.borderRadiusLG,
              border: `1px solid ${cssVar.border.default}`
            }}
          >
            <Form layout="vertical">
              <Form.Item
                label="AI Provider"
                name="provider"
                initialValue="openai"
                help="Choose which AI provider to use for generating code and analyzing APIs"
              >
                <Select>
                  <Select.Option value="openai">OpenAI (GPT-4)</Select.Option>
                  <Select.Option value="anthropic">Anthropic (Claude)</Select.Option>
                  <Select.Option value="azure">Azure OpenAI</Select.Option>
                </Select>
              </Form.Item>

              <Form.Item
                label="API Key"
                name="apiKey"
                help="Your API key will be encrypted and stored securely"
              >
                <Input.Password placeholder="sk-..." />
              </Form.Item>

              <Form.Item label="Model" name="model" initialValue="gpt-4">
                <Select>
                  <Select.Option value="gpt-4">GPT-4 (Recommended)</Select.Option>
                  <Select.Option value="gpt-4-turbo">GPT-4 Turbo</Select.Option>
                  <Select.Option value="gpt-3.5-turbo">GPT-3.5 Turbo (Faster)</Select.Option>
                </Select>
              </Form.Item>

              <Form.Item label="Daily Request Limit" name="dailyLimit" initialValue={100}>
                <Input type="number" min={1} max={1000} />
              </Form.Item>

              <Divider />

              <Space>
                <Button type="primary" htmlType="submit">
                  Save Configuration
                </Button>
                <Button>Test Connection</Button>
              </Space>
            </Form>
          </Card>
        </PermissionGuard>

        {/* AI Features Info - Everyone can see */}
        <Card
          title="Available AI Features"
          style={{
            borderRadius: token.borderRadiusLG,
            border: `1px solid ${cssVar.border.default}`
          }}
        >
          <Space direction="vertical" size="small" style={{ width: '100%' }}>
            <div>
              <Text strong>✨ Generate Transformation Scripts</Text>
              <Paragraph type="secondary" style={{ marginBottom: 0 }}>
                Provide input/output examples and let AI generate the transformation code
              </Paragraph>
            </div>

            <div>
              <Text strong>📖 Analyze API Documentation</Text>
              <Paragraph type="secondary" style={{ marginBottom: 0 }}>
                Paste API docs or URLs and get auto-configured integrations
              </Paragraph>
            </div>

            <div>
              <Text strong>🔗 Suggest Field Mappings</Text>
              <Paragraph type="secondary" style={{ marginBottom: 0 }}>
                Smart field mapping suggestions between source and target systems
              </Paragraph>
            </div>

            <div>
              <Text strong>🧪 Generate Test Payloads</Text>
              <Paragraph type="secondary" style={{ marginBottom: 0 }}>
                Create realistic test data for your event types
              </Paragraph>
            </div>

            {can.configureAI() && (
              <Alert
                type="success"
                message="You have full AI configuration access"
                description="As an organization administrator, you can configure the AI provider, API keys, and limits."
                showIcon
                style={{ marginTop: spacing[3] }}
              />
            )}

            {can.useAI() && !can.configureAI() && (
              <Alert
                type="info"
                message="You can use AI features"
                description="Contact your organization administrator to change AI configuration settings."
                showIcon
                style={{ marginTop: spacing[3] }}
              />
            )}
          </Space>
        </Card>
      </Space>
    </div>
  );
};

/**
 * Simple AI Button Component - Shows/Hides based on permissions
 */
export const AIAssistantButton = ({ onClick }: { onClick: () => void }) => {
  const can = usePermissions();

  // Don't show button if user can't use AI
  if (!can.useAI()) {
    return null;
  }

  return (
    <Button icon={<RobotOutlined />} onClick={onClick}>
      AI Assistant
    </Button>
  );
};

/**
 * AI Config Link - Only shows for ORG_ADMIN+
 */
export const AIConfigLink = () => {
  const can = usePermissions();

  if (!can.configureAI()) {
    return null;
  }

  return (
    <Button type="link" href="/settings/ai" icon={<SettingOutlined />}>
      Configure AI
    </Button>
  );
};
