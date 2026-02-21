import { Card, Typography } from 'antd';
import type { ReactNode } from 'react';
import { cssVar, useDesignTokens } from '../../design-system/utils';

interface Props {
  label: string;
  value: string;
  delta?: string;
  icon?: ReactNode;
  color?: string;
  sparkline?: ReactNode;
}

export const MetricCard = ({ label, value, delta, icon, color, sparkline }: Props) => {
  const { token, spacing, shadows } = useDesignTokens();

  return (
    <Card
      hoverable
      className="panel"
      style={{
        minWidth: 220,
        flex: 1,
        borderRadius: token.borderRadiusLG,
        border: `1px solid ${cssVar.border.default}`,
        background: `linear-gradient(135deg, rgba(59, 130, 246, 0.16), rgba(59, 130, 246, 0.1) 60%, ${cssVar.bg.surface})`
      }}
      styles={{ body: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: spacing[3] } }}
    >
      <div>
        <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM, letterSpacing: 0.5 }}>
          {label}
        </Typography.Text>
        <Typography.Title level={3} style={{ margin: `${spacing['1.5']} 0 0`, letterSpacing: -0.5 }}>
          {value}
        </Typography.Title>
        {delta && (
          <Typography.Text type={delta.startsWith('-') ? 'danger' : 'success'} style={{ fontSize: token.fontSizeSM }}>
            {delta}
          </Typography.Text>
        )}
      </div>
      {icon && (
        <div
          style={{
            width: 52,
            height: 52,
            borderRadius: token.borderRadiusLG,
            background: color ?? cssVar.primary[500],
            display: 'grid',
            placeItems: 'center',
            color: cssVar.text.inverse,
            fontSize: spacing[5],
            boxShadow: shadows.md
          }}
        >
          {icon}
        </div>
      )}
      {sparkline}
    </Card>
  );
};
