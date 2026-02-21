import { useMemo } from 'react';
import { Tooltip } from 'antd';
import { cssVar, useDesignTokens, withAlpha } from '../../design-system/utils';

export interface HeatmapData {
  x: string | number;
  y: string | number;
  value: number;
}

export interface HeatmapChartProps {
  data: HeatmapData[];
  xLabels: string[];
  yLabels: string[];
  height?: number;
  colorScale?: string[];
  showValues?: boolean;
  valueFormatter?: (value: number) => string;
  onCellClick?: (data: HeatmapData) => void;
}

export function HeatmapChart({
  data,
  xLabels,
  yLabels,
  height = 400,
  colorScale,
  showValues = false,
  valueFormatter = (v) => v.toString(),
  onCellClick,
}: HeatmapChartProps) {
  const { themeColors, spacing, token, transitions } = useDesignTokens();

  const defaultColorScale = useMemo(() => [
    withAlpha(themeColors.info.text, 0.1),
    withAlpha(themeColors.info.text, 0.3),
    withAlpha(themeColors.info.text, 0.5),
    withAlpha(themeColors.info.text, 0.7),
    themeColors.info.text
  ], [themeColors]);

  const scale = colorScale || defaultColorScale;

  const maxValue = useMemo(() => {
    return Math.max(...data.map(d => d.value), 1);
  }, [data]);

  const getColor = (value: number) => {
    const normalized = value / maxValue;
    const index = Math.min(Math.floor(normalized * scale.length), scale.length - 1);
    return scale[index];
  };

  const cellWidth = 100 / xLabels.length;
  const cellHeight = height / yLabels.length;

  const dataMap = useMemo(() => {
    const map = new Map<string, number>();
    data.forEach(d => {
      map.set(`${d.x}-${d.y}`, d.value);
    });
    return map;
  }, [data]);

  return (
    <div style={{ width: '100%', height }}>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        {/* Y-axis labels + grid */}
        <div style={{ display: 'flex', flex: 1 }}>
          {/* Y-axis labels */}
          <div style={{ width: 80, display: 'flex', flexDirection: 'column' }}>
            {yLabels.map((label, yIndex) => (
              <div
                key={`y-${yIndex}`}
                style={{
                  height: cellHeight,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'flex-end',
                  paddingRight: spacing[2],
                  fontSize: 12,
                  color: token.colorTextSecondary,
                  fontWeight: 500,
                }}
              >
                {label}
              </div>
            ))}
          </div>

          {/* Heatmap grid */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            {yLabels.map((yLabel, yIndex) => (
              <div key={`row-${yIndex}`} style={{ display: 'flex', flex: 1 }}>
                {xLabels.map((xLabel, xIndex) => {
                  const value = dataMap.get(`${xLabel}-${yLabel}`) || 0;
                  const color = getColor(value);

                  return (
                    <Tooltip
                      key={`cell-${xIndex}-${yIndex}`}
                      title={`${xLabel}, ${yLabel}: ${valueFormatter(value)}`}
                    >
                      <div
                        style={{
                          flex: 1,
                          height: '100%',
                          backgroundColor: color,
                          border: `1px solid ${cssVar.border.default}`,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 11,
                          fontWeight: 600,
                          color: value > maxValue * 0.5 ? cssVar.text.inverse : token.colorText,
                          cursor: onCellClick ? 'pointer' : 'default',
                          transition: transitions.all,
                        }}
                        onClick={() => onCellClick?.({ x: xLabel, y: yLabel, value })}
                        onMouseEnter={(e) => {
                          if (onCellClick) {
                            e.currentTarget.style.opacity = '0.8';
                            e.currentTarget.style.transform = 'scale(1.05)';
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (onCellClick) {
                            e.currentTarget.style.opacity = '1';
                            e.currentTarget.style.transform = 'scale(1)';
                          }
                        }}
                      >
                        {showValues && value > 0 && valueFormatter(value)}
                      </div>
                    </Tooltip>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        {/* X-axis labels */}
        <div style={{ display: 'flex', marginTop: spacing[1] }}>
          <div style={{ width: 80 }} />
          <div style={{ flex: 1, display: 'flex' }}>
            {xLabels.map((label, index) => (
              <div
                key={`x-${index}`}
                style={{
                  flex: 1,
                  textAlign: 'center',
                  fontSize: 12,
                  color: token.colorTextSecondary,
                  fontWeight: 500,
                }}
              >
                {label}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
