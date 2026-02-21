import { Breadcrumb, Space, Tag, Typography, Divider, Grid } from 'antd';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cssVar, useDesignTokens, withAlpha, spacingToNumber } from '../../design-system/utils';

interface Crumb {
  label: string;
  path?: string;
}

interface Props {
  title: string;
  description?: string;
  breadcrumb?: Crumb[];
  actions?: ReactNode;
  statusChips?: Array<{ label: ReactNode; color?: string; onClick?: () => void }>;
  compact?: boolean;
  titleSuffix?: ReactNode;
}

export const PageHeader = ({ title, description, breadcrumb, actions, statusChips, compact = false, titleSuffix }: Props) => {
  const { token, spacing, borderRadius } = useDesignTokens();
  const screens = Grid.useBreakpoint();
  const isNarrow = !screens.md;

  return (
    <div className="page-header" style={{ marginBottom: compact ? spacing[3] : spacing[4] }}>
      {breadcrumb && (
        <Breadcrumb
          style={{ marginBottom: spacing[2], color: cssVar.text.secondary }}
          items={breadcrumb.map((crumb) => ({
            title: crumb.path ? <Link to={crumb.path}>{crumb.label}</Link> : crumb.label
          }))}
        />
      )}
      <div
        style={{
          padding: `${spacing[3]} ${spacing[4]}`,
          borderBottom: `1px solid ${cssVar.border.default}`,
          display: 'grid',
          gridTemplateColumns: actions && !isNarrow ? '1fr auto' : '1fr',
          alignItems: isNarrow ? 'flex-start' : 'center',
          gap: spacing[4],
          rowGap: spacingToNumber(spacing[3]),
          background: cssVar.bg.surface,
          marginBottom: spacing[4]
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: spacing[1] }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: spacing[2], flexWrap: 'wrap' }}>
              <Typography.Title level={compact ? 4 : 3} style={{ margin: 0, fontWeight: 600 }}>
                {title}
              </Typography.Title>
              {titleSuffix}
            </div>
            {description && (
              <Typography.Text
                type="secondary"
                style={{
                  fontSize: token.fontSize,
                  lineHeight: 1.5
                }}
              >
                {description}
              </Typography.Text>
            )}
          </div>
          {statusChips && statusChips.length > 0 && (
            <Space wrap style={{ marginTop: spacing[2] }}>
              {statusChips.map((chip, index) => (
                <Tag
                  key={index}
                  onClick={chip.onClick}
                  onKeyDown={chip.onClick ? (event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      chip.onClick?.();
                    }
                  } : undefined}
                  role={chip.onClick ? 'button' : undefined}
                  tabIndex={chip.onClick ? 0 : undefined}
                  style={{
                    borderRadius: borderRadius.full,
                    padding: `${spacing['0.5']} ${spacing[2]}`,
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: chip.onClick ? 'pointer' : 'default',
                    color: chip.color ?? cssVar.text.secondary,
                    background: chip.color ? withAlpha(chip.color, 0.1) : cssVar.bg.subtle,
                    borderColor: chip.color ? withAlpha(chip.color, 0.25) : cssVar.border.default,
                    margin: 0
                  }}
                >
                  {chip.label}
                </Tag>
              ))}
            </Space>
          )}
        </div>
        {actions && (
          <div
            style={{
              display: 'flex',
              gap: spacing['2.5'],
              alignItems: 'center',
              justifyContent: isNarrow ? 'flex-start' : 'flex-end',
              width: isNarrow ? '100%' : 'auto'
            }}
          >
            {!isNarrow && <Divider type="vertical" style={{ height: spacing[12], borderColor: cssVar.border.default }} />}
            <div style={{ display: 'flex', gap: spacing['2.5'], alignItems: 'center', width: '100%', justifyContent: isNarrow ? 'flex-start' : 'flex-end' }}>{actions}</div>
          </div>
        )}
      </div>
    </div>
  );
};
