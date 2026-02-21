import { Typography } from 'antd';
import type { ReactNode } from 'react';
import { spacingToNumber } from '../../../../../design-system/utils';

interface SectionHeaderProps {
  icon: ReactNode;
  title: string;
  spacing: Record<string, string>;
}

export const SectionHeader = ({ icon, title, spacing }: SectionHeaderProps) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: spacingToNumber(spacing[2]) }}>
    {icon}
    <div>
      <Typography.Text strong style={{ fontSize: 15 }}>{title}</Typography.Text>
    </div>
  </div>
);
