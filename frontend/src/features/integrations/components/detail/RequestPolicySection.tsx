import { Alert, Col, Form, Input, InputNumber, Row, Space, Switch, Tag, Typography } from 'antd';
import { GlobalOutlined, SafetyCertificateOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { cssVar, spacingToNumber } from '../../../../design-system/utils';

const { Text } = Typography;

interface RequestPolicySectionProps {
  form?: any;
  spacing: any;
}

const splitLines = (value: string | undefined) =>
  String(value || '')
    .split(/\r?\n|,/)
    .map((entry) => entry.trim())
    .filter(Boolean);

export const RequestPolicySection = ({ form, spacing }: RequestPolicySectionProps) => {
  const colors = cssVar.legacy;
  const rateLimitEnabled = Form.useWatch(['requestPolicy', 'rateLimit', 'enabled'], form);
  const ipEntries = splitLines(Form.useWatch(['requestPolicy', 'allowedIpCidrsText'], form));
  const originEntries = splitLines(Form.useWatch(['requestPolicy', 'allowedBrowserOriginsText'], form));
  const maxRequests = Form.useWatch(['requestPolicy', 'rateLimit', 'maxRequests'], form) || 100;
  const windowSeconds = Form.useWatch(['requestPolicy', 'rateLimit', 'windowSeconds'], form) || 60;

  const perHour = Math.floor((maxRequests / windowSeconds) * 3600);

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Alert
        type="info"
        showIcon
        icon={<SafetyCertificateOutlined />}
        message="Inbound request policy"
        description="Configure the inbound guardrail once here. This policy combines browser-origin checks, source IP allowlists, and per-integration rate limiting."
      />

      <div>
        <Space size={8} style={{ marginBottom: spacing[2] }}>
          <SafetyCertificateOutlined />
          <Text strong>Source IP allowlist</Text>
        </Space>
        <Form.Item
          name={['requestPolicy', 'allowedIpCidrsText']}
          extra="One CIDR or IP per line. Examples: 203.0.113.10, 203.0.113.0/24"
        >
          <Input.TextArea
            autoSize={{ minRows: 3, maxRows: 6 }}
            placeholder={'203.0.113.10\n203.0.113.0/24'}
          />
        </Form.Item>
        {ipEntries.length > 0 ? (
          <Alert
            type="success"
            showIcon
            message={`${ipEntries.length} IP rule${ipEntries.length === 1 ? '' : 's'} configured`}
            description="Requests from any IP outside this allowlist will be rejected before provider processing."
          />
        ) : (
          <Alert
            type="warning"
            showIcon
            message="No source IP restrictions configured"
            description="Use this for server-to-server callers with static IPs or CIDR ranges."
          />
        )}
      </div>

      <div>
        <Space size={8} style={{ marginBottom: spacing[2] }}>
          <GlobalOutlined />
          <Text strong>Allowed browser origins</Text>
          <Tag color="gold">Browser only</Tag>
        </Space>
        <Form.Item
          name={['requestPolicy', 'allowedBrowserOriginsText']}
          extra="Full origins only, one per line. Examples: https://app.example.com, https://staging.example.com:8443"
        >
          <Input.TextArea
            autoSize={{ minRows: 3, maxRows: 6 }}
            placeholder={'https://app.example.com\nhttps://staging.example.com'}
          />
        </Form.Item>
        {originEntries.length > 0 ? (
          <Alert
            type="success"
            showIcon
            message={`${originEntries.length} browser origin${originEntries.length === 1 ? '' : 's'} allowed`}
            description="When this list is set, the inbound request must send a matching Origin header."
          />
        ) : (
          <Alert
            type="info"
            showIcon
            message="No browser-origin restrictions configured"
            description="This is useful for browser-based clients. It is not a substitute for server-side IP controls."
          />
        )}
      </div>

      <div>
        <Space size={8} style={{ marginBottom: spacing[2] }}>
          <ThunderboltOutlined />
          <Text strong>Per-integration rate limiting</Text>
        </Space>

        <Form.Item name={['requestPolicy', 'rateLimit', 'enabled']} valuePropName="checked">
          <Switch checkedChildren="Rate limiting ON" unCheckedChildren="Rate limiting OFF" />
        </Form.Item>

        {rateLimitEnabled ? (
          <>
            <Row gutter={[spacingToNumber(spacing[4]), 0]}>
              <Col xs={24} md={12}>
                <Form.Item
                  name={['requestPolicy', 'rateLimit', 'maxRequests']}
                  label="Maximum Requests"
                  rules={[
                    { required: true, message: 'Max requests is required when rate limiting is enabled' },
                    { type: 'number', min: 1, max: 10000, message: 'Must be between 1 and 10,000 requests' },
                  ]}
                >
                  <InputNumber min={1} max={10000} step={10} style={{ width: '100%' }} addonAfter="requests" size="large" />
                </Form.Item>
              </Col>
              <Col xs={24} md={12}>
                <Form.Item
                  name={['requestPolicy', 'rateLimit', 'windowSeconds']}
                  label="Time Window"
                  rules={[
                    { required: true, message: 'Time window is required when rate limiting is enabled' },
                    { type: 'number', min: 1, max: 3600, message: 'Must be between 1 and 3,600 seconds' },
                  ]}
                >
                  <InputNumber min={1} max={3600} step={10} style={{ width: '100%' }} addonAfter="seconds" size="large" />
                </Form.Item>
              </Col>
            </Row>

            <div
              style={{
                background: colors.primary[50],
                border: `1px solid ${colors.primary[200]}`,
                borderRadius: 8,
                padding: spacing[3],
              }}
            >
              <Space direction="vertical" size={spacing[2]} style={{ width: '100%' }}>
                <Text strong style={{ color: colors.primary[700] }}>Rate limit preview</Text>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: spacing[3] }}>
                  <div>
                    <Text type="secondary" style={{ fontSize: 12, display: 'block' }}>Per {windowSeconds}s window</Text>
                    <Text strong style={{ fontSize: 18 }}>{maxRequests} reqs</Text>
                  </div>
                  <div>
                    <Text type="secondary" style={{ fontSize: 12, display: 'block' }}>Per hour</Text>
                    <Text strong style={{ fontSize: 18 }}>≈ {perHour.toLocaleString()} reqs</Text>
                  </div>
                </div>
              </Space>
            </div>
          </>
        ) : (
          <Alert
            type="info"
            showIcon
            message="Rate limiting is disabled"
            description="When disabled, this integration will not enforce request throttling at the inbound runtime layer."
          />
        )}
      </div>
    </Space>
  );
};
