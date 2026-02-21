import { useMemo } from 'react';
import {
  LineChart as RechartsLineChart,
  Line,
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
  ChartMargin,
} from '../../design-system/theme/chart-theme';

export interface LineChartProps {
  data: Array<Record<string, any>>;
  lines: Array<{
    dataKey: string;
    name?: string;
    color?: string;
    strokeWidth?: number;
  }>;
  xAxisKey: string;
  height?: number;
  showLegend?: boolean;
  showGrid?: boolean;
  margin?: ChartMargin;
  smooth?: boolean;
}

export function LineChart({
  data,
  lines,
  xAxisKey,
  height = 300,
  showLegend = true,
  showGrid = true,
  margin = chartMargins.default,
  smooth = true,
}: LineChartProps) {
  const coloredLines = useMemo(() => {
    return lines.map((line, index) => ({
      ...line,
      color: line.color || chartColors.categorical[index % chartColors.categorical.length],
      strokeWidth: line.strokeWidth || 2,
    }));
  }, [lines]);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <RechartsLineChart data={data} margin={margin}>
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
        {coloredLines.map((line) => (
          <Line
            key={line.dataKey}
            type={smooth ? 'monotone' : 'linear'}
            dataKey={line.dataKey}
            name={line.name || line.dataKey}
            stroke={line.color}
            strokeWidth={line.strokeWidth}
            dot={{ fill: line.color, r: 3 }}
            activeDot={{ r: 5, strokeWidth: 0 }}
            animationDuration={chartAnimationConfig.duration}
            animationEasing={chartAnimationConfig.easing}
          />
        ))}
      </RechartsLineChart>
    </ResponsiveContainer>
  );
}
