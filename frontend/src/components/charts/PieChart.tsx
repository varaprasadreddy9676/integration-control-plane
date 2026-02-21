import { useMemo } from 'react';
import {
  PieChart as RechartsPieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import {
  chartColors,
  chartTooltipStyle,
  chartLegendConfig,
  chartAnimationConfig,
} from '../../design-system/theme/chart-theme';

export interface PieChartProps {
  data: Array<{
    name: string;
    value: number;
    [key: string]: any;
  }>;
  height?: number;
  showLegend?: boolean;
  innerRadius?: number;
  outerRadius?: number;
  colors?: string[];
  labelLine?: boolean;
  label?: boolean | ((entry: any) => string);
  paddingAngle?: number;
  onSliceClick?: (data: any, index: number) => void;
  hiddenLegends?: Set<string>;
  onLegendClick?: (dataKey: string) => void;
}

export function PieChart({
  data,
  height = 300,
  showLegend = true,
  innerRadius = 0,
  outerRadius = 80,
  colors,
  labelLine = false,
  label = false,
  paddingAngle = 2,
  onSliceClick,
  hiddenLegends = new Set(),
  onLegendClick,
}: PieChartProps) {
  const pieColors = useMemo(() => {
    return colors || chartColors.categorical;
  }, [colors]);

  const filteredData = useMemo(() => {
    return data.filter(entry => !hiddenLegends.has(entry.name));
  }, [data, hiddenLegends]);

  const renderLabel = (entry: any) => {
    if (typeof label === 'function') {
      return label(entry);
    }
    if (label) {
      const percent = ((entry.value / filteredData.reduce((sum, item) => sum + item.value, 0)) * 100).toFixed(0);
      return `${percent}%`;
    }
    return '';
  };

  return (
    <ResponsiveContainer width="100%" height={height}>
      <RechartsPieChart>
        <Pie
          data={filteredData}
          cx="50%"
          cy="50%"
          labelLine={labelLine}
          label={label ? renderLabel : false}
          outerRadius={outerRadius}
          innerRadius={innerRadius}
          paddingAngle={paddingAngle}
          dataKey="value"
          nameKey="name"
          animationDuration={chartAnimationConfig.duration}
          animationEasing={chartAnimationConfig.easing}
          onClick={onSliceClick ? (dataPoint: any, index: number) => onSliceClick(dataPoint, index) : undefined}
          cursor={onSliceClick ? 'pointer' : undefined}
        >
          {filteredData.map((entry, index) => {
            const originalIndex = data.findIndex(d => d.name === entry.name);
            return (
              <Cell
                key={`cell-${index}`}
                fill={pieColors[originalIndex % pieColors.length]}
                strokeWidth={2}
                stroke="#fff"
              />
            );
          })}
        </Pie>
        <Tooltip
          contentStyle={chartTooltipStyle}
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
            onClick={onLegendClick ? (e: any) => onLegendClick(e.value) : undefined}
            wrapperStyle={{ cursor: onLegendClick ? 'pointer' : 'default' }}
            payload={data.map((entry, index) => ({
              value: entry.name,
              type: 'square',
              color: pieColors[index % pieColors.length],
              dataKey: entry.name
            }))}
            formatter={(value: string) => {
              const isHidden = hiddenLegends.has(value);
              return (
                <span style={{
                  color: isHidden ? '#999' : undefined,
                  textDecoration: isHidden ? 'line-through' : 'none',
                  opacity: isHidden ? 0.5 : 1
                }}>
                  {value}
                </span>
              );
            }}
          />
        )}
      </RechartsPieChart>
    </ResponsiveContainer>
  );
}
