import { useMemo } from 'react';
import { Tooltip } from 'antd';
import { cssVar, useDesignTokens } from '../../design-system/utils';
import { formatNumber } from '../../utils/format';

export interface FunnelData {
  name: string;
  value: number;
  color?: string;
}

export interface FunnelChartProps {
  data: FunnelData[];
  height?: number;
  showPercentages?: boolean;
  onSegmentClick?: (data: FunnelData, index: number) => void;
}

export function FunnelChart({
  data,
  height = 400,
  showPercentages = true,
  onSegmentClick,
}: FunnelChartProps) {
  const { themeColors, spacing, token, shadows, transitions } = useDesignTokens();

  const defaultColors = useMemo(() => [
    themeColors.primary.default,
    themeColors.info.text,
    themeColors.success.text,
    themeColors.warning.text
  ], [themeColors]);

  const maxValue = useMemo(() => {
    return Math.max(...data.map(d => d.value), 1);
  }, [data]);

  const coloredData = useMemo(() => {
    return data.map((item, index) => ({
      ...item,
      color: item.color || defaultColors[index % defaultColors.length],
      percentage: (item.value / maxValue) * 100,
      conversionRate: index > 0 ? (item.value / data[index - 1].value) * 100 : 100,
    }));
  }, [data, defaultColors, maxValue]);

  const segmentHeight = (height - (data.length - 1) * 8) / data.length;

  return (
    <div style={{ width: '100%', height, padding: `${spacing[4]} 0` }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: spacing[2], height: '100%' }}>
        {coloredData.map((item, index) => {
          const widthPercent = item.percentage;

          return (
            <Tooltip
              key={`funnel-${index}`}
              title={
                <div>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>{item.name}</div>
                  <div>{formatNumber(item.value)} events</div>
                  {index > 0 && (
                    <div style={{ fontSize: 12, opacity: 0.9 }}>
                      {item.conversionRate.toFixed(1)}% of previous stage
                    </div>
                  )}
                </div>
              }
            >
              <div
                style={{
                  width: `${widthPercent}%`,
                  height: segmentHeight,
                  backgroundColor: item.color,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: token.borderRadius,
                  cursor: onSegmentClick ? 'pointer' : 'default',
                  transition: transitions.allSlow,
                  position: 'relative',
                  boxShadow: shadows.sm,
                }}
                onClick={() => onSegmentClick?.(item, index)}
                onMouseEnter={(e) => {
                  if (onSegmentClick) {
                    e.currentTarget.style.transform = 'scale(1.02)';
                    e.currentTarget.style.boxShadow = shadows.md;
                  }
                }}
                onMouseLeave={(e) => {
                  if (onSegmentClick) {
                    e.currentTarget.style.transform = 'scale(1)';
                    e.currentTarget.style.boxShadow = shadows.sm;
                  }
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    color: cssVar.text.inverse,
                    textShadow: '0 1px 2px rgba(0, 0, 0, 0.2)',
                  }}
                >
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{item.name}</div>
                  <div style={{ fontSize: 20, fontWeight: 700, marginTop: 4 }}>
                    {formatNumber(item.value)}
                  </div>
                  {showPercentages && index > 0 && (
                    <div style={{ fontSize: 12, opacity: 0.95, marginTop: 2 }}>
                      {item.conversionRate.toFixed(1)}% conversion
                    </div>
                  )}
                </div>
              </div>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}
