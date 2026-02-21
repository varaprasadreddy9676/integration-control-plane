import { Form, Input, Select, Row, Col, Typography, Space, Tag, Switch, Alert } from 'antd';
import { LinkOutlined, SendOutlined, ThunderboltOutlined } from '@ant-design/icons';
import type { HttpConfigFieldsProps } from '../types';

const { Text, Paragraph } = Typography;

/**
 * HttpConfigFields - HTTP configuration fields
 *
 * Handles:
 * - Target URL
 * - HTTP Method (GET, POST, PUT, DELETE, PATCH)
 * - Custom headers (optional)
 * - Timeout configuration (optional)
 *
 * Can be used across outbound integrations, inbound integrations, and scheduled jobs.
 */
export const HttpConfigFields = ({
  form,
  uiConfig,
  mode,
  spacing,
  colors,
  isMultiAction = false
}: HttpConfigFieldsProps) => {
  // Watch streamResponse field for inbound mode
  const streamResponse = Form.useWatch('streamResponse', form);

  // Context-aware labels
  const getLabel = (baseLabel: string) => {
    if (mode === 'inbound') {
      return baseLabel.replace('Target', 'Proxy Target');
    } else if (mode === 'scheduled') {
      return baseLabel.replace('Target', 'Destination');
    }
    return baseLabel;
  };

  const getDescription = () => {
    if (mode === 'inbound') {
      return 'Configure the external API that will be called when client app makes requests to this integration';
    } else if (mode === 'scheduled') {
      return 'Configure the API endpoint where scheduled data will be sent';
    }
    return 'Configure where the event will be sent';
  };

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      {/* Description */}
      {!isMultiAction && (
        <div>
          <Paragraph type="secondary" style={{ marginBottom: spacing[3] }}>
            {getDescription()}
          </Paragraph>
        </div>
      )}

      <Row gutter={[16, 16]}>
        {/* Target URL */}
        <Col xs={24}>
          <Form.Item
            name="targetUrl"
            label={
              <Space size={4}>
                <LinkOutlined style={{ color: colors.primary[600] }} />
                <span>{getLabel('Target URL')}</span>
              </Space>
            }
            rules={[
              { required: true, message: 'Target URL is required' },
              { type: 'url', message: 'Must be a valid HTTPS URL' },
              {
                pattern: /^https:\/\/.+/,
                message: 'URL must use HTTPS protocol'
              }
            ]}
            extra={
              mode === 'inbound'
                ? 'The external API that will receive proxied requests from the client app'
                : 'The endpoint where data will be sent'
            }
          >
            <Input
              size="large"
              placeholder="https://api.example.com/integration"
              prefix={<LinkOutlined style={{ color: 'var(--color-text-muted)' }} />}
            />
          </Form.Item>
        </Col>

        {/* HTTP Method */}
        <Col xs={24} md={12}>
          <Form.Item
            name="httpMethod"
            label={
              <Space size={4}>
                <SendOutlined style={{ color: colors.primary[600] }} />
                <span>HTTP Method</span>
              </Space>
            }
            rules={[{ required: true, message: 'HTTP method is required' }]}
            initialValue="POST"
          >
            <Select
              size="large"
              options={uiConfig?.httpMethods || [
                { value: 'POST', label: 'POST' },
                { value: 'PUT', label: 'PUT' },
                { value: 'GET', label: 'GET' },
                { value: 'PATCH', label: 'PATCH' },
                { value: 'DELETE', label: 'DELETE' }
              ]}
            />
          </Form.Item>
        </Col>

        {/* Request Timeout */}
        <Col xs={24} md={12}>
          <Form.Item
            name="timeout"
            label="Request Timeout (ms)"
            initialValue={10000}
            rules={[
              { required: true, message: 'Timeout is required' },
              {
                type: 'number',
                min: 1000,
                max: 60000,
                message: 'Timeout must be between 1000ms and 60000ms'
              }
            ]}
            extra="Maximum time to wait for response (1-60 seconds)"
          >
            <Input
              type="number"
              size="large"
              placeholder="10000"
              suffix="ms"
            />
          </Form.Item>
        </Col>

        {/* Custom Headers (Optional) */}
        <Col xs={24}>
          <Form.Item
            name="customHeaders"
            label="Custom Headers (JSON)"
            extra="Optional: Add custom HTTP headers as JSON object"
            rules={[
              {
                validator: (_, value) => {
                  if (!value) return Promise.resolve();
                  try {
                    JSON.parse(value);
                    return Promise.resolve();
                  } catch {
                    return Promise.reject(new Error('Must be valid JSON'));
                  }
                }
              }
            ]}
          >
            <Input.TextArea
              placeholder={'{\n  "X-Custom-Header": "value",\n  "X-Request-ID": "{{uuid}}"\n}'}
              rows={4}
              size="large"
              style={{
                fontFamily: 'monospace',
                fontSize: 13
              }}
            />
          </Form.Item>
        </Col>

        {/* Content Type (if needed) */}
        <Col xs={24} md={12}>
          <Form.Item
            name="contentType"
            label="Content-Type"
            initialValue="application/json"
            extra="HTTP Content-Type header"
          >
            <Select
              size="large"
              options={[
                { value: 'application/json', label: 'application/json' },
                { value: 'application/x-www-form-urlencoded', label: 'application/x-www-form-urlencoded' },
                { value: 'multipart/form-data', label: 'multipart/form-data' },
                { value: 'text/plain', label: 'text/plain' },
                { value: 'text/xml', label: 'text/xml' }
              ]}
            />
          </Form.Item>
        </Col>

        {/* Retry Configuration */}
        <Col xs={24} md={12}>
          <Form.Item
            name="retryCount"
            label="Retry Count"
            initialValue={3}
            rules={[
              { required: true, message: 'Retry count is required' },
              {
                type: 'number',
                min: 0,
                max: 10,
                message: 'Retry count must be between 0 and 10'
              }
            ]}
            extra="Number of retry attempts on failure"
          >
            <Input
              type="number"
              size="large"
              placeholder="3"
            />
          </Form.Item>
        </Col>

        {/* Stream Response - Only for Inbound Mode */}
        {mode === 'inbound' && (
          <Col xs={24}>
            <Form.Item
              name="streamResponse"
              label={
                <Space size={4}>
                  <ThunderboltOutlined style={{ color: colors.primary[600] }} />
                  <span>Stream Response</span>
                </Space>
              }
              valuePropName="checked"
              initialValue={false}
              extra="Enable for very large responses (100+ MB). Streams data directly without buffering."
            >
              <Switch />
            </Form.Item>

            {streamResponse && (
              <Alert
                type="warning"
                showIcon
                message="Response Transformation Disabled"
                description="When streaming is enabled, response transformations cannot be applied. The response will be passed through directly to the client."
                style={{ marginTop: spacing[2] }}
              />
            )}
          </Col>
        )}
      </Row>

      {/* Additional Info for Inbound Mode */}
      {mode === 'inbound' && (
        <div
          style={{
            padding: spacing[3],
            background: colors.info[50],
            border: `1px solid ${colors.info[200]}`,
            borderRadius: 8
          }}
        >
          <Space direction="vertical" size={4}>
            <Space>
              <Tag color="blue">INBOUND INTEGRATION</Tag>
              <Text strong style={{ fontSize: 13 }}>Real-time API Proxy</Text>
            </Space>
            <Text type="secondary" style={{ fontSize: 12 }}>
              When client app calls this integration endpoint, the request will be proxied to the target URL with authentication and transformation applied.
            </Text>
          </Space>
        </div>
      )}

      {/* Additional Info for Scheduled Mode */}
      {mode === 'scheduled' && (
        <div
          style={{
            padding: spacing[3],
            background: colors.purple[50],
            border: `1px solid ${colors.purple[200]}`,
            borderRadius: 8
          }}
        >
          <Space direction="vertical" size={4}>
            <Space>
              <Tag color="purple">SCHEDULED JOB</Tag>
              <Text strong style={{ fontSize: 13 }}>Time-driven Batch Integration</Text>
            </Space>
            <Text type="secondary" style={{ fontSize: 12 }}>
              Data will be fetched from the configured source and sent to this URL according to the schedule.
            </Text>
          </Space>
        </div>
      )}
    </Space>
  );
};
