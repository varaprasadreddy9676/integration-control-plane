import { Space, Typography } from 'antd';
import type { ReactNode } from 'react';
import { spacingToNumber, withAlpha, cssVar } from '../../../../../design-system/utils';
import { shadows } from '../../../../../design-system/tokens/shadows';

interface SectionCardProps {
  title: string;
  description?: string;
  icon?: ReactNode;
  children: ReactNode;
  headerExtras?: ReactNode;
  spacing: Record<string, string>;
  token: any;
  muted?: boolean;
}

export const SectionCard = ({
  title,
  description,
  icon,
  children,
  headerExtras,
  spacing,
  token,
  muted
}: SectionCardProps) => {
  const colors = cssVar.legacy;
  return (
    <div
      style={{
        background: cssVar.bg.surface,
        border: `1px solid ${cssVar.border.default}`,
        borderRadius: token.borderRadiusLG,
        padding: 0,
        boxShadow: shadows.sm,
        opacity: muted ? 0.5 : 1,
        pointerEvents: muted ? 'none' : 'auto',
        overflow: 'hidden'
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: spacingToNumber(spacing[2]),
          padding: `${spacing[3]} ${spacing[4]}`,
          borderBottom: `1px solid ${cssVar.border.default}`,
          background: cssVar.bg.subtle
        }}
      >
        <Space align="start" size={spacingToNumber(spacing['2.5'])}>
          {icon && (
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: token.borderRadius,
                background: withAlpha(colors.primary[600], 0.08),
                color: colors.primary[600],
                display: 'grid',
                placeItems: 'center',
                fontSize: 16
              }}
            >
              {icon}
            </div>
          )}
          <div>
            <Typography.Title level={5} style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>
              {title}
            </Typography.Title>
            {description && (
              <Typography.Text type="secondary" style={{ display: 'block', marginTop: 2, fontSize: 13, color: cssVar.text.secondary }}>
                {description}
              </Typography.Text>
            )}
          </div>
        </Space>
        {headerExtras && <div style={{ display: 'flex', gap: spacingToNumber(spacing[2]) }}>{headerExtras}</div>}
      </div>
      <div style={{ padding: `${spacing[4]} ${spacing[4]}` }}>
        {children}
      </div>
    </div>
  );
};
