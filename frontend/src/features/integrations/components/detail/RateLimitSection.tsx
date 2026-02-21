import { Form, Switch, InputNumber, Row, Col, Alert, Space, Typography, Tag } from 'antd';
import { ThunderboltOutlined, InfoCircleOutlined } from '@ant-design/icons';
import { spacingToNumber, cssVar } from '../../../../design-system/utils';

const { Text } = Typography;

interface RateLimitSectionProps {
  form?: any;
  spacing: any;
}

/**
 * RateLimitSection - Configure per-integration rate limiting
 *
 * Allows users to set:
 * - Enable/disable rate limiting
 * - Maximum requests per window
 * - Window duration in seconds
 */
export const RateLimitSection = ({ form, spacing }: RateLimitSectionProps) => {
  const colors = cssVar.legacy;

  const rateLimitEnabled = Form.useWatch(['rateLimits', 'enabled'], form);

  return (
    <div>
      {/* Enable/Disable Toggle */}
      <Form.Item
        name={['rateLimits', 'enabled']}
        valuePropName="checked"
        initialValue={false}
      >
        <Switch
          checkedChildren="Rate Limiting ON"
          unCheckedChildren="Rate Limiting OFF"
        />
      </Form.Item>

      {!rateLimitEnabled && (
        <Alert
          type="info"
          showIcon
          icon={<InfoCircleOutlined />}
          message="Rate limiting is disabled"
          description="When disabled, this integration will not enforce any request rate limits. Enable to protect your integration from excessive traffic."
          style={{ marginBottom: spacing[4] }}
        />
      )}

      {rateLimitEnabled && (
        <>
          <Alert
            type="warning"
            showIcon
            icon={<ThunderboltOutlined />}
            message="Rate limiting is active"
            description="Requests exceeding the configured limit will be rejected with a 429 status code. The client will receive a Retry-After header."
            style={{ marginBottom: spacing[4] }}
          />

          <Row gutter={[spacingToNumber(spacing[4]), 0]}>
            <Col xs={24} md={12}>
              <Form.Item
                name={['rateLimits', 'maxRequests']}
                label={
                  <Space size={4}>
                    Maximum Requests
                    <Tag color="blue" style={{ fontSize: 10 }}>per window</Tag>
                  </Space>
                }
                rules={[
                  { required: rateLimitEnabled, message: 'Max requests is required when rate limiting is enabled' },
                  {
                    type: 'number',
                    min: 1,
                    max: 10000,
                    message: 'Must be between 1 and 10,000 requests'
                  }
                ]}
                tooltip="Maximum number of requests allowed within the time window"
                initialValue={100}
              >
                <InputNumber
                  min={1}
                  max={10000}
                  step={10}
                  style={{ width: '100%' }}
                  addonAfter="requests"
                  size="large"
                  placeholder="100"
                />
              </Form.Item>
            </Col>

            <Col xs={24} md={12}>
              <Form.Item
                name={['rateLimits', 'windowSeconds']}
                label={
                  <Space size={4}>
                    Time Window
                    <Tag color="purple" style={{ fontSize: 10 }}>duration</Tag>
                  </Space>
                }
                rules={[
                  { required: rateLimitEnabled, message: 'Time window is required when rate limiting is enabled' },
                  {
                    type: 'number',
                    min: 1,
                    max: 3600,
                    message: 'Must be between 1 and 3,600 seconds (1 hour)'
                  }
                ]}
                tooltip="Duration of the rate limit window in seconds. Rate limits are enforced per window."
                initialValue={60}
              >
                <InputNumber
                  min={1}
                  max={3600}
                  step={10}
                  style={{ width: '100%' }}
                  addonAfter="seconds"
                  size="large"
                  placeholder="60"
                />
              </Form.Item>
            </Col>
          </Row>

          {/* Preview Calculation */}
          <RateLimitPreview form={form} spacing={spacing} colors={colors} />
        </>
      )}
    </div>
  );
};

/**
 * Preview component showing calculated rate limit in different time units
 */
const RateLimitPreview = ({ form, spacing, colors }: any) => {
  const maxRequests = Form.useWatch(['rateLimits', 'maxRequests'], form) || 100;
  const windowSeconds = Form.useWatch(['rateLimits', 'windowSeconds'], form) || 60;

  // Calculate rates per minute, hour, day
  const perMinute = Math.floor((maxRequests / windowSeconds) * 60);
  const perHour = Math.floor((maxRequests / windowSeconds) * 3600);
  const perDay = Math.floor((maxRequests / windowSeconds) * 86400);

  return (
    <div
      style={{
        background: colors.primary[50],
        border: `1px solid ${colors.primary[200]}`,
        borderRadius: 8,
        padding: spacing[3],
        marginTop: spacing[4]
      }}
    >
      <Space direction="vertical" size={spacing[2]} style={{ width: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: spacing[2] }}>
          <ThunderboltOutlined style={{ color: colors.primary[600], fontSize: 16 }} />
          <Text strong style={{ color: colors.primary[700] }}>
            Rate Limit Preview
          </Text>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: spacing[3] }}>
          <div>
            <Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
              Per {windowSeconds}s window
            </Text>
            <Text strong style={{ fontSize: 18, color: colors.primary[600] }}>
              {maxRequests} reqs
            </Text>
          </div>

          {windowSeconds !== 60 && (
            <div>
              <Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
                Per Minute
              </Text>
              <Text strong style={{ fontSize: 18 }}>
                ≈ {perMinute.toLocaleString()} reqs
              </Text>
            </div>
          )}

          <div>
            <Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
              Per Hour
            </Text>
            <Text strong style={{ fontSize: 18 }}>
              ≈ {perHour.toLocaleString()} reqs
            </Text>
          </div>

          <div>
            <Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
              Per Day
            </Text>
            <Text strong style={{ fontSize: 18 }}>
              ≈ {perDay.toLocaleString()} reqs
            </Text>
          </div>
        </div>

        <Alert
          type="info"
          message="Sliding Window"
          description={`This is a sliding window rate limit. Requests are counted within ${windowSeconds}-second windows. When a request is made, the system checks if the limit has been reached in the current window.`}
          showIcon
          style={{ marginTop: spacing[2], fontSize: 11 }}
        />
      </Space>
    </div>
  );
};
