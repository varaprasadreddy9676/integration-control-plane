import { useState } from 'react';
import { Row, Col, Form, InputNumber, Radio, Space, Typography, Card, Alert } from 'antd';
import { ThunderboltOutlined, SettingOutlined } from '@ant-design/icons';
import { spacingToNumber, cssVar } from '../../../../design-system/utils';

const { Text } = Typography;

interface DeliverySettingsSectionEnhancedProps {
  uiConfig?: any;
  spacing: any;
}

/**
 * DeliverySettingsSectionEnhanced - Basic vs Advanced delivery settings
 *
 * Basic mode: Quick presets for common retry/timeout scenarios
 * Advanced mode: Full numerical control
 */
export const DeliverySettingsSectionEnhanced = ({
  uiConfig,
  spacing
}: DeliverySettingsSectionEnhancedProps) => {
  const colors = cssVar.legacy;
  const [mode, setMode] = useState<'basic' | 'advanced'>('basic');
  const form = Form.useFormInstance();

  // Preset configurations
  const presets = [
    {
      value: 'fast',
      label: 'Fast & Light',
      description: '5s timeout, 1 retry',
      timeout: 5000,
      retry: 1,
      icon: <ThunderboltOutlined />
    },
    {
      value: 'standard',
      label: 'Standard',
      description: '30s timeout, 3 retries',
      timeout: 30000,
      retry: 3,
      icon: <SettingOutlined />
    },
    {
      value: 'reliable',
      label: 'Reliable',
      description: '60s timeout, 5 retries',
      timeout: 60000,
      retry: 5,
      icon: <SettingOutlined />
    }
  ];

  const handlePresetChange = (presetValue: string) => {
    const preset = presets.find(p => p.value === presetValue);
    if (preset) {
      form.setFieldsValue({
        timeoutMs: preset.timeout,
        retryCount: preset.retry
      });
    }
  };

  // Determine current preset (if any)
  const currentTimeout = Form.useWatch('timeoutMs', form);
  const currentRetry = Form.useWatch('retryCount', form);
  const currentPreset = presets.find(
    p => p.timeout === currentTimeout && p.retry === currentRetry
  )?.value;

  return (
    <div>
      {/* Mode Toggle */}
      <div style={{ marginBottom: spacing[4] }}>
        <Radio.Group
          value={mode}
          onChange={(e) => setMode(e.target.value)}
          buttonStyle="solid"
          size="large"
        >
          <Radio.Button value="basic">Basic</Radio.Button>
          <Radio.Button value="advanced">Advanced</Radio.Button>
        </Radio.Group>
      </div>

      {/* Basic Mode - Presets */}
      {mode === 'basic' && (
        <div>
          <Alert
            type="info"
            showIcon
            message="Choose a preset configuration"
            description="Select a pre-configured retry and timeout strategy based on your use case"
            style={{ marginBottom: spacing[4] }}
          />

          <Space direction="vertical" size={spacingToNumber(spacing[3])} style={{ width: '100%' }}>
            {presets.map((preset) => (
              <Card
                key={preset.value}
                hoverable
                onClick={() => handlePresetChange(preset.value)}
                style={{
                  border: `2px solid ${currentPreset === preset.value ? colors.primary[500] : colors.neutral[200]}`,
                  background: currentPreset === preset.value ? colors.primary[50] : 'transparent',
                  cursor: 'pointer'
                }}
                bodyStyle={{ padding: spacing[3] }}
              >
                <Space size={spacingToNumber(spacing[3])}>
                  <div style={{ fontSize: 24, color: currentPreset === preset.value ? colors.primary[600] : colors.neutral[500] }}>
                    {preset.icon}
                  </div>
                  <div>
                    <Text strong style={{ fontSize: 14, display: 'block' }}>
                      {preset.label}
                    </Text>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {preset.description}
                    </Text>
                  </div>
                </Space>
              </Card>
            ))}
          </Space>

          {/* Hidden fields that actually store the values */}
          <div style={{ display: 'none' }}>
            <Form.Item name="timeoutMs">
              <InputNumber />
            </Form.Item>
            <Form.Item name="retryCount">
              <InputNumber />
            </Form.Item>
          </div>
        </div>
      )}

      {/* Advanced Mode - Full Control */}
      {mode === 'advanced' && (
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
                placeholder={String(uiConfig?.validationRules.timeout.default ?? 30000)}
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
      )}
    </div>
  );
};
