import { useMemo } from 'react';
import {
  AreaChart as RechartsAreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import {
  chartColors,
  chartAxisConfig,
  chartGridConfig,
  chartTooltipStyle,
  chartLegendConfig,
  chartCursor,
  chartMargins,
  chartAnimationConfig,
  chartGradients,
  ChartMargin,
} from '../../design-system/theme/chart-theme';

export interface AreaChartProps {
  data: Array<Record<string, any>>;
  areas: Array<{
    dataKey: string;
    name?: string;
    color?: string;
    fillOpacity?: number;
    strokeWidth?: number;
  }>;
  xAxisKey: string;
  height?: number;
  showLegend?: boolean;
  showGrid?: boolean;
  margin?: ChartMargin;
  stacked?: boolean;
  smooth?: boolean;
}

export function AreaChart({
  data,
  areas,
  xAxisKey,
  height = 300,
  showLegend = true,
  showGrid = true,
  margin = chartMargins.default,
  stacked = false,
  smooth = true,
}: AreaChartProps) {
  const coloredAreas = useMemo(() => {
    return areas.map((area, index) => ({
      ...area,
      color: area.color || chartColors.categorical[index % chartColors.categorical.length],
      fillOpacity: area.fillOpacity !== undefined ? area.fillOpacity : 0.2,
      strokeWidth: area.strokeWidth || 2,
    }));
  }, [areas]);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <RechartsAreaChart data={data} margin={margin}>
        <defs>
          {Object.entries(chartGradients).map(([key, gradient]) => (
            <linearGradient key={gradient.id} id={gradient.id} x1="0" y1="0" x2="0" y2="1">
              {gradient.stops.map((stop, idx) => (
                <stop
                  key={idx}
                  offset={stop.offset}
                  stopColor={stop.color}
                  stopOpacity={stop.opacity}
                />
              ))}
            </linearGradient>
          ))}
        </defs>
        {showGrid && (
          <CartesianGrid
            {...chartGridConfig}
            vertical={false}
          />
        )}
        <XAxis
          dataKey={xAxisKey}
          {...chartAxisConfig}
          tickLine={false}
          axisLine={{ stroke: chartAxisConfig.stroke, strokeWidth: 1 }}
        />
        <YAxis
          {...chartAxisConfig}
          tickLine={false}
          axisLine={false}
          width={50}
        />
        <Tooltip
          contentStyle={chartTooltipStyle}
          cursor={chartCursor}
          formatter={(value: any) => {
            if (typeof value === 'number') {
              return value.toLocaleString();
            }
            return value;
          }}
        />
        {showLegend && (
          <Legend
            {...chartLegendConfig}
            verticalAlign="bottom"
            height={36}
          />
        )}
        {coloredAreas.map((area, index) => (
          <Area
            key={area.dataKey}
            type={smooth ? 'monotone' : 'linear'}
            dataKey={area.dataKey}
            name={area.name || area.dataKey}
            stroke={area.color}
            strokeWidth={area.strokeWidth}
            fill={area.color}
            fillOpacity={area.fillOpacity}
            stackId={stacked ? '1' : undefined}
            animationDuration={chartAnimationConfig.duration}
            animationEasing={chartAnimationConfig.easing}
          />
        ))}
      </RechartsAreaChart>
    </ResponsiveContainer>
  );
}
