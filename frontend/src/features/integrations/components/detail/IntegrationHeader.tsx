import { Form, Switch, Typography, Space } from 'antd';
import type { FormInstance } from 'antd';
import { withAlpha } from '../../../../design-system/utils';
import { HelpPopover } from './shared/HelpPopover';

interface IntegrationHeaderProps {
  isCreate: boolean;
  isActiveValue: boolean;
  form: FormInstance;
  spacing: any;
  token: any;
  colors: any;
}

/**
 * IntegrationHeader - Compact status banner with enable/disable toggle
 *
 * Displays integration active/paused status with a professional enterprise design.
 * Removes verbose descriptions in favor of concise status messages.
 */
export const IntegrationHeader = ({
  isCreate,
  isActiveValue,
  form,
  spacing,
  token,
  colors
}: IntegrationHeaderProps) => {
  // Don't show header in create mode
  if (isCreate) {
    return null;
  }

  return (
    <div
      style={{
        background: isActiveValue === false
          ? withAlpha(colors.warning[600], 0.08)
          : withAlpha(colors.success[600], 0.08),
        border: `1px solid ${isActiveValue === false ? withAlpha(colors.warning[600], 0.3) : withAlpha(colors.success[600], 0.3)}`,
        borderRadius: token.borderRadiusLG,
        padding: spacing[4],
        marginBottom: spacing[4]
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: spacing[3] }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: spacing[3] }}>
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: token.borderRadiusLG,
              background: isActiveValue === false ? colors.warning[600] : colors.success[600],
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              fontSize: 20
            }}
          >
            {isActiveValue === false ? '⏸' : '▶'}
          </div>
          <div>
            <Space size={6}>
              <Typography.Text strong style={{ fontSize: 16 }}>
                Integration is {isActiveValue === false ? 'Paused' : 'Active'}
              </Typography.Text>
              {isActiveValue === false && (
                <HelpPopover
                  title="Configuration Locked"
                  content={
                    <Typography.Paragraph style={{ marginBottom: 0 }}>
                      Enable the integration to modify its configuration.
                    </Typography.Paragraph>
                  }
                  placement="right"
                />
              )}
            </Space>
            <Typography.Text type="secondary" style={{ fontSize: 13, display: 'block', marginTop: 2 }}>
              {isActiveValue === false
                ? 'Not processing events'
                : 'Processing events in real-time'}
            </Typography.Text>
          </div>
        </div>
        <Form.Item name="isActive" valuePropName="checked" noStyle>
          <div style={{ display: 'flex', alignItems: 'center', gap: spacing[2] }}>
            <Typography.Text strong style={{ fontSize: 14 }}>
              {isActiveValue === false ? 'Enable integration' : 'Disable integration'}
            </Typography.Text>
            <Switch
              size="default"
              checked={isActiveValue}
              onChange={(checked) => {
                form.setFieldValue('isActive', checked);
              }}
            />
          </div>
        </Form.Item>
      </div>
    </div>
  );
};
