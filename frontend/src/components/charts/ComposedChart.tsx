import { useMemo } from 'react';
import {
  ComposedChart as RechartsComposedChart,
  Bar,
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

export interface ComposedChartProps {
  data: Array<Record<string, any>>;
  bars?: Array<{
    dataKey: string;
    name?: string;
    color?: string;
    stackId?: string;
  }>;
  lines?: Array<{
    dataKey: string;
    name?: string;
    color?: string;
    strokeWidth?: number;
    strokeDasharray?: string;
    yAxisId?: string;
  }>;
  xAxisKey: string;
  height?: number;
  showLegend?: boolean;
  showGrid?: boolean;
  margin?: ChartMargin;
  smooth?: boolean;
  barSize?: number;
  showSecondaryYAxis?: boolean;
  onBarClick?: (data: any, index: number) => void;
  hiddenLegends?: Set<string>;
  onLegendClick?: (dataKey: string) => void;
}

export function ComposedChart({
  data,
  bars = [],
  lines = [],
  xAxisKey,
  height = 300,
  showLegend = true,
  showGrid = true,
  margin = chartMargins.default,
  smooth = true,
  barSize = 24,
  showSecondaryYAxis = false,
  onBarClick,
  hiddenLegends = new Set(),
  onLegendClick,
}: ComposedChartProps) {
  const coloredBars = useMemo(() => {
    return bars.map((bar, index) => ({
      ...bar,
      color: bar.color || chartColors.categorical[index % chartColors.categorical.length],
    }));
  }, [bars]);

  const coloredLines = useMemo(() => {
    return lines.map((line, index) => ({
      ...line,
      color: line.color || chartColors.categorical[(bars.length + index) % chartColors.categorical.length],
      strokeWidth: line.strokeWidth || 2,
    }));
  }, [lines, bars.length]);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <RechartsComposedChart data={data} margin={margin}>
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
          yAxisId="left"
          {...chartAxisConfig}
          tickLine={false}
          axisLine={false}
          width={50}
        />
        {showSecondaryYAxis && (
          <YAxis
            yAxisId="right"
            orientation="right"
            {...chartAxisConfig}
            tickLine={false}
            axisLine={false}
            width={50}
          />
        )}
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
            onClick={onLegendClick ? (e: any) => onLegendClick(e.dataKey) : undefined}
            wrapperStyle={{ cursor: onLegendClick ? 'pointer' : 'default' }}
            formatter={(value: string, entry: any) => {
              const isHidden = hiddenLegends.has(entry.dataKey);
              return (
                <span style={{
                  color: isHidden ? '#999' : entry.color,
                  textDecoration: isHidden ? 'line-through' : 'none',
                  opacity: isHidden ? 0.5 : 1
                }}>
                  {value}
                </span>
              );
            }}
          />
        )}
        {coloredBars.map((bar) => (
          <Bar
            key={bar.dataKey}
            dataKey={bar.dataKey}
            name={bar.name || bar.dataKey}
            fill={bar.color}
            stackId={bar.stackId}
            barSize={barSize}
            yAxisId="left"
            animationDuration={chartAnimationConfig.duration}
            animationEasing={chartAnimationConfig.easing}
            onClick={onBarClick ? (dataPoint: any, index: number) => onBarClick(dataPoint, index) : undefined}
            cursor={onBarClick ? 'pointer' : undefined}
            hide={hiddenLegends.has(bar.dataKey)}
          />
        ))}
        {coloredLines.map((line) => (
          <Line
            key={line.dataKey}
            type={smooth ? 'monotone' : 'linear'}
            dataKey={line.dataKey}
            name={line.name || line.dataKey}
            stroke={line.color}
            strokeWidth={line.strokeWidth}
            strokeDasharray={line.strokeDasharray}
            dot={{ fill: line.color, r: 3 }}
            activeDot={{ r: 5, strokeWidth: 0 }}
            yAxisId={line.yAxisId || 'left'}
            animationDuration={chartAnimationConfig.duration}
            animationEasing={chartAnimationConfig.easing}
            hide={hiddenLegends.has(line.dataKey)}
          />
        ))}
      </RechartsComposedChart>
    </ResponsiveContainer>
  );
}
