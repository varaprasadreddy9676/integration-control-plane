import { Typography } from 'antd';
import { BranchesOutlined } from '@ant-design/icons';
import { spacingToNumber } from '../../../../../design-system/utils';

interface MultiActionHeaderProps {
  actionsCount: number;
  spacing: Record<string, string>;
  colors: any;
}

export const MultiActionHeader = ({ actionsCount, spacing, colors }: MultiActionHeaderProps) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: spacingToNumber(spacing[2]) }}>
    <BranchesOutlined style={{ fontSize: 18, color: colors.primary[600] }} />
    <div>
      <Typography.Text strong style={{ fontSize: 15 }}>Actions</Typography.Text>
    </div>
  </div>
);
