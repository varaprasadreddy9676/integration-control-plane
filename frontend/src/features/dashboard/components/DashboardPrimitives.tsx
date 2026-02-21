import { useMemo } from 'react';
import { Skeleton, Typography } from 'antd';
import { ArrowUpOutlined, ArrowDownOutlined } from '@ant-design/icons';
import { cssVar, useDesignTokens, withAlpha } from '../../../design-system/utils';

export const useDashboardPanelStyle = () => {
  const { token, shadows } = useDesignTokens();

  return useMemo(() => ({
    borderRadius: token.borderRadiusLG,
    border: `1px solid ${cssVar.border.default}`,
    background: cssVar.bg.surface,
    boxShadow: shadows.sm
  }) as const, [token, shadows]);
};

export const useDashboardTagTone = () => {
  const { spacing, token, borderRadius } = useDesignTokens();

  return (base: string) => ({
    borderRadius: borderRadius.full,
    borderColor: withAlpha(base, 0.25),
    background: withAlpha(base, 0.12),
    color: base,
    fontWeight: 700,
    paddingInline: spacing[2],
    paddingBlock: spacing['0.5'],
    fontSize: token.fontSizeSM
  });
};

export const DashboardSectionTitle = ({ title, subtitle }: { title: string; subtitle?: string }) => {
  const { spacing, token } = useDesignTokens();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: spacing['0.5'] }}>
      <Typography.Title level={4} style={{ margin: 0, letterSpacing: -0.3 }}>
        {title}
      </Typography.Title>
      {subtitle && (
        <Typography.Text type="secondary" style={{ fontSize: token.fontSize }}>
          {subtitle}
        </Typography.Text>
      )}
    </div>
  );
};

export const DashboardMetricTile = ({
  label,
  value,
  delta,
  icon,
  tone,
  loading = false,
  trend,
  trendLabel,
  onClick
}: {
  label: string;
  value: string;
  delta?: string;
  icon: JSX.Element;
  tone: string;
  loading?: boolean;
  trend?: number;
  trendLabel?: string;
  onClick?: () => void;
}) => {
  const { spacing, token, shadows, transitions } = useDesignTokens();
  const panelStyle = useDashboardPanelStyle();

  return (
    <div
      onClick={onClick}
      style={{
        ...panelStyle,
        padding: spacing[4],
        display: 'flex',
        flexDirection: 'column',
        gap: spacing[2],
        minHeight: 120,
        transition: transitions.all,
        cursor: onClick ? 'pointer' : 'default'
      }}
      onMouseEnter={(e) => {
        if (onClick) {
          e.currentTarget.style.transform = 'translateY(-2px)';
          e.currentTarget.style.boxShadow = shadows.md;
        }
      }}
      onMouseLeave={(e) => {
        if (onClick) {
          e.currentTarget.style.transform = 'translateY(0)';
          e.currentTarget.style.boxShadow = '';
        }
      }}
    >
      {loading ? (
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing[1] }}>
            <Skeleton.Input active size="small" style={{ width: 140 }} />
            <Skeleton.Avatar active size="small" shape="circle" />
          </div>
          <Skeleton.Input active size="large" style={{ width: 180, height: 36 }} />
          <Skeleton.Input active size="small" style={{ width: 200 }} />
        </>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing[1] }}>
            <Typography.Text type="secondary" style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              {label}
            </Typography.Text>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: token.borderRadius,
                background: withAlpha(tone, 0.08),
                color: tone,
                display: 'grid',
                placeItems: 'center',
                fontSize: 18
              }}
            >
              {icon}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: spacing[2] }}>
            <Typography.Title level={1} style={{ margin: 0, fontSize: 36, fontWeight: 700, letterSpacing: -1, lineHeight: 1 }}>
              {value}
            </Typography.Title>
            {trend !== undefined && trend !== 0 && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: spacing['0.5'],
                  fontSize: 14,
                  fontWeight: 600,
                  color: trend > 0 ? cssVar.success.text : cssVar.error.text
                }}
              >
                {trend > 0 ? <ArrowUpOutlined /> : <ArrowDownOutlined />}
                <span>{Math.abs(trend).toFixed(1)}%</span>
              </div>
            )}
          </div>
          {(delta || trendLabel) && (
            <Typography.Text style={{ color: token.colorTextSecondary, fontSize: 13, marginTop: spacing[1] }}>
              {trendLabel || delta}
            </Typography.Text>
          )}
        </>
      )}
    </div>
  );
};
