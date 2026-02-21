import { Card, Radio, Space, Typography } from 'antd';
import type { RadioChangeEvent } from 'antd';
import { cssVar, spacingToNumber } from '../../../../../design-system/utils';

interface DeliveryModeSelectorProps {
  value: 'single' | 'multi';
  onChange: (value: 'single' | 'multi') => void;
  spacing: Record<string, string>;
  token: {
    borderRadiusLG: number;
    colorBorderSecondary: string;
  };
  colors: {
    neutral: Record<number, string>;
  };
}

export const DeliveryModeSelector = ({
  value,
  onChange,
  spacing,
  token,
  colors
}: DeliveryModeSelectorProps) => {
  const handleChange = (e: RadioChangeEvent) => {
    onChange(e.target.value);
  };

  return (
    <Card
      size="small"
      style={{
        borderRadius: token.borderRadiusLG,
        border: `1px solid ${cssVar.border.default}`,
        background: cssVar.bg.surface
      }}
    >
      <Space direction="vertical" style={{ width: '100%' }} size={spacingToNumber(spacing[2])}>
        <Typography.Text strong>Delivery mode</Typography.Text>
        <Typography.Text type="secondary" style={{ fontSize: 12, color: cssVar.text.secondary }}>
          Choose single delivery for one target endpoint, or multi-action for sequential requests.
        </Typography.Text>
        <Radio.Group
          value={value}
          onChange={handleChange}
          optionType="button"
          buttonStyle="solid"
        >
          <Radio.Button value="single">Single delivery</Radio.Button>
          <Radio.Button value="multi">Multi-action</Radio.Button>
        </Radio.Group>
      </Space>
    </Card>
  );
};
