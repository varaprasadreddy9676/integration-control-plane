import { Row, Col, Form, InputNumber } from 'antd';

interface DeliverySettingsSectionProps {
  uiConfig?: any;
  spacing: any;
}

const spacingToNumber = (value: any): number => {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return parseInt(value, 10) || 0;
  return 0;
};

/**
 * DeliverySettingsSection - Timeout and retry configuration
 *
 * Simple, self-explanatory fields with no help needed.
 */
export const DeliverySettingsSection = ({
  uiConfig,
  spacing
}: DeliverySettingsSectionProps) => {
  return (
    <Row gutter={[spacingToNumber(spacing[4]), 0]}>
      <Col xs={24} md={12}>
        <Form.Item
          name="timeoutMs"
          label="Request Timeout"
          rules={[
            { required: true, message: 'Timeout is required' },
            {
              type: 'number',
              min: uiConfig?.validationRules.timeout.min ?? 500,
              max: uiConfig?.validationRules.timeout.max ?? 60000,
              message: `Must be between ${uiConfig?.validationRules.timeout.min ?? 500}-${uiConfig?.validationRules.timeout.max ?? 60000} ms`
            }
          ]}
        >
          <InputNumber
            min={uiConfig?.validationRules.timeout.min ?? 500}
            max={uiConfig?.validationRules.timeout.max ?? 60000}
            step={uiConfig?.validationRules.timeout.step ?? 500}
            style={{ width: '100%' }}
            addonAfter="ms"
            size="large"
            placeholder={String(uiConfig?.validationRules.timeout.default ?? 3000)}
          />
        </Form.Item>
      </Col>
      <Col xs={24} md={12}>
        <Form.Item
          name="retryCount"
          label="Retry Attempts"
          rules={[
            { required: true, message: 'Retry count is required' },
            {
              type: 'number',
              min: uiConfig?.validationRules.retry.min ?? 0,
              max: uiConfig?.validationRules.retry.max ?? 10,
              message: `Must be between ${uiConfig?.validationRules.retry.min ?? 0}-${uiConfig?.validationRules.retry.max ?? 10}`
            }
          ]}
        >
          <InputNumber
            min={uiConfig?.validationRules.retry.min ?? 0}
            max={uiConfig?.validationRules.retry.max ?? 10}
            style={{ width: '100%' }}
            addonAfter="retries"
            size="large"
            placeholder={String(uiConfig?.validationRules.retry.default ?? 3)}
          />
        </Form.Item>
      </Col>
    </Row>
  );
};
