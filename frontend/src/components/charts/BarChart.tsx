import { useMemo } from 'react';
import type { ReactNode } from 'react';
import type { AxisDomain } from 'recharts/types/util/types';
import {
  BarChart as RechartsBarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import {
  chartColors,
  chartAxisConfig,
  chartGridConfig,
  chartTooltipStyle,
  chartLegendConfig,
  chartMargins,
  chartAnimationConfig,
  type ChartMargin,
} from '../../design-system/theme/chart-theme';

export interface BarChartProps {
  data: Array<Record<string, any>>;
  bars: Array<{
    dataKey: string;
    name?: string;
    color?: string;
    radius?: number | [number, number, number, number];
    stackId?: string | number;
  }>;
  xAxisKey: string;
  yAxisKey?: string;
  height?: number;
  showLegend?: boolean;
  showGrid?: boolean;
  margin?: ChartMargin;
  layout?: 'horizontal' | 'vertical';
  barSize?: number;
  colorByIndex?: boolean;
  yAxisDomain?: AxisDomain;
  xAxisDomain?: AxisDomain;
  yAxisTickFormatter?: (value: any, index: number) => string;
  xAxisTickFormatter?: (value: any, index: number) => string;
  yAxisWidth?: number;
  tooltipFormatter?: (value: any, name: string, props: any) => ReactNode;
  tooltipLabelFormatter?: (label: any) => ReactNode;
  wrapAxisLabels?: boolean;
  axisLabelMaxWidth?: number;
  axisLabelMaxLines?: number;
  axisLabelLineHeight?: number;
  xAxisHeight?: number;
  xAxisInterval?: number | 'preserveStart' | 'preserveEnd' | 'preserveStartEnd';
  legendWrapperStyle?: React.CSSProperties;
  legendHeight?: number;
  legendVerticalAlign?: 'top' | 'bottom' | 'middle';
  onBarClick?: (data: any, index: number) => void;
  hiddenLegends?: Set<string>;
  onLegendClick?: (dataKey: string) => void;
}

export function BarChart({
  data,
  bars,
  xAxisKey,
  yAxisKey,
  height = 300,
  showLegend = true,
  showGrid = true,
  margin = chartMargins.default,
  layout = 'horizontal',
  barSize,
  colorByIndex = false,
  yAxisDomain,
  xAxisDomain,
  yAxisTickFormatter,
  xAxisTickFormatter,
  yAxisWidth = 50,
  tooltipFormatter,
  tooltipLabelFormatter,
  wrapAxisLabels = false,
  axisLabelMaxWidth = 120,
  axisLabelMaxLines = 2,
  axisLabelLineHeight = 12,
  xAxisHeight,
  xAxisInterval,
  legendWrapperStyle,
  legendHeight,
  legendVerticalAlign,
  onBarClick,
  hiddenLegends = new Set(),
  onLegendClick,
}: BarChartProps) {
  const isVertical = layout === 'vertical';
  const fontSize = typeof chartAxisConfig.style?.fontSize === 'number'
    ? chartAxisConfig.style.fontSize
    : 11;

  const wrapLabel = (label: string) => {
    if (!label) return ['—'];
    const avgCharWidth = Math.max(5, fontSize * 0.6);
    const maxChars = Math.max(4, Math.floor(axisLabelMaxWidth / avgCharWidth));
    const words = String(label).split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let current = '';

    const pushLine = (line: string) => {
      if (lines.length < axisLabelMaxLines) {
        lines.push(line);
      }
    };

    const pushChunkedWord = (word: string) => {
      const chunks = word.match(new RegExp(`.{1,${maxChars}}`, 'g')) || [word];
      for (const chunk of chunks) {
        if (lines.length >= axisLabelMaxLines) return;
        pushLine(chunk);
      }
    };

    if (words.length <= 1) {
      pushChunkedWord(words[0] || '');
      if (lines.length > axisLabelMaxLines) {
        lines.length = axisLabelMaxLines;
      }
      if (words[0]?.length > maxChars * axisLabelMaxLines) {
        const last = lines[axisLabelMaxLines - 1] || '';
        lines[axisLabelMaxLines - 1] = `${last.slice(0, Math.max(1, maxChars - 1))}…`;
      }
      return lines;
    }

    for (const word of words) {
      const next = current ? `${current} ${word}` : word;
      if (next.length <= maxChars) {
        current = next;
        continue;
      }
      if (current) {
        pushLine(current);
        current = '';
      }
      if (word.length > maxChars) {
        pushChunkedWord(word);
      } else {
        current = word;
      }
      if (lines.length >= axisLabelMaxLines) {
        current = '';
        break;
      }
    }
    if (current && lines.length < axisLabelMaxLines) {
      pushLine(current);
    }
    if (lines.length > axisLabelMaxLines) {
      lines.length = axisLabelMaxLines;
    }
    if (lines.length === axisLabelMaxLines && words.join(' ').length > maxChars * axisLabelMaxLines) {
      const last = lines[axisLabelMaxLines - 1] || '';
      lines[axisLabelMaxLines - 1] = `${last.slice(0, Math.max(1, maxChars - 1))}…`;
    }
    return lines;
  };

  const renderWrappedTick = (axis: 'x' | 'y') => (props: any) => {
    const { x, y, payload, index } = props;
    const rawValue = payload?.value ?? '';
    const formatted = axis === 'x'
      ? (xAxisTickFormatter ? xAxisTickFormatter(rawValue, index) : rawValue)
      : (yAxisTickFormatter ? yAxisTickFormatter(rawValue, index) : rawValue);
    const label = String(formatted ?? '') || '—';
    const lines = wrapLabel(label);
    const textAnchor = axis === 'x' ? 'middle' : 'end';
    const xPos = axis === 'x' ? x : x - 6;
    const baseDy = axis === 'x' ? 10 : 4;

    return (
      <text
        x={xPos}
        y={y}
        textAnchor={textAnchor}
        dominantBaseline="central"
        fill={chartAxisConfig.style?.fill}
        fontSize={fontSize}
        fontFamily={chartAxisConfig.style?.fontFamily}
        fontWeight={chartAxisConfig.style?.fontWeight}
      >
        {lines.map((line, lineIndex) => (
          <tspan key={`${label}-${lineIndex}`} x={xPos} dy={lineIndex === 0 ? baseDy : axisLabelLineHeight}>
            {line}
          </tspan>
        ))}
      </text>
    );
  };

  const coloredBars = useMemo(() => {
    return bars.map((bar, index) => ({
      ...bar,
      color: bar.color || chartColors.categorical[index % chartColors.categorical.length],
      radius: bar.radius || [4, 4, 0, 0] as [number, number, number, number],
    }));
  }, [bars]);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <RechartsBarChart data={data} margin={margin} layout={layout}>
        {showGrid && (
          <CartesianGrid
            {...chartGridConfig}
            vertical={false}
          />
        )}
        <XAxis
          dataKey={isVertical ? undefined : xAxisKey}
          {...chartAxisConfig}
          tickLine={false}
          tickFormatter={wrapAxisLabels && !isVertical ? undefined : xAxisTickFormatter}
          tick={wrapAxisLabels && !isVertical ? renderWrappedTick('x') : undefined}
          height={!isVertical ? xAxisHeight : undefined}
          interval={!isVertical ? xAxisInterval : undefined}
          type={isVertical ? 'number' : 'category'}
          domain={xAxisDomain}
          axisLine={{ stroke: chartAxisConfig.stroke, strokeWidth: 1 }}
        />
        <YAxis
          {...chartAxisConfig}
          tickLine={false}
          axisLine={false}
          width={yAxisWidth}
          domain={yAxisDomain}
          tickFormatter={wrapAxisLabels && isVertical ? undefined : yAxisTickFormatter}
          tick={wrapAxisLabels && isVertical ? renderWrappedTick('y') : undefined}
          dataKey={isVertical ? (yAxisKey || xAxisKey) : undefined}
          type={isVertical ? 'category' : 'number'}
        />
        <Tooltip
          contentStyle={chartTooltipStyle}
          cursor={{ fill: 'rgba(91, 141, 239, 0.04)' }}
          formatter={tooltipFormatter || ((value: any) => {
            if (typeof value === 'number') {
              return value.toLocaleString();
            }
            return value;
          })}
          labelFormatter={tooltipLabelFormatter}
        />
        {showLegend && (
          <Legend
            {...chartLegendConfig}
            wrapperStyle={{
              ...chartLegendConfig.wrapperStyle,
              ...(legendWrapperStyle || {}),
              cursor: onLegendClick ? 'pointer' : 'default'
            }}
            verticalAlign={legendVerticalAlign || 'bottom'}
            height={legendHeight ?? 36}
            onClick={onLegendClick ? (e: any) => onLegendClick(e.dataKey) : undefined}
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
            radius={bar.radius}
            stackId={bar.stackId}
            maxBarSize={barSize || 40}
            animationDuration={chartAnimationConfig.duration}
            animationEasing={chartAnimationConfig.easing}
            onClick={onBarClick ? (dataPoint: any, index: number) => onBarClick(dataPoint, index) : undefined}
            cursor={onBarClick ? 'pointer' : undefined}
            hide={hiddenLegends.has(bar.dataKey)}
          >
            {colorByIndex && data.map((entry, index) => (
              <Cell
                key={`cell-${index}`}
                fill={chartColors.categorical[index % chartColors.categorical.length]}
              />
            ))}
          </Bar>
        ))}
      </RechartsBarChart>
    </ResponsiveContainer>
  );
}
