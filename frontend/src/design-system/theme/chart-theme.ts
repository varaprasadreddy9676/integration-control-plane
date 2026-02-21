import { darkColors, lightColors } from '../tokens/colors';
import { typography } from '../tokens/typography';

type ThemeMode = 'light' | 'dark';

const makeChartTheme = (mode: ThemeMode) => {
  const palette = mode === 'dark' ? darkColors : lightColors;

  const colors = {
    primary: [
      palette.primary.default,
      palette.primary.hover,
      palette.primary.text,
      mode === 'dark' ? '#BFDBFE' : '#DBEAFE'
    ],
    categorical: [
      palette.primary.default,
      palette.success.text,
      palette.warning.text,
      palette.info.text,
      palette.error.text,
      palette.primary.hover,
      mode === 'dark' ? '#6EE7B7' : '#4ADE80',
      mode === 'dark' ? '#FDE68A' : '#FACC15'
    ],
    sequential: mode === 'dark'
      ? ['#1D4ED8', '#2563EB', '#3B82F6', '#60A5FA', '#93C5FD', '#BFDBFE', '#DBEAFE']
      : ['#EFF6FF', '#DBEAFE', '#BFDBFE', '#93C5FD', '#60A5FA', '#3B82F6', '#2563EB'],
    diverging: [
      palette.error.text,
      mode === 'dark' ? '#FCA5A5' : '#F87171',
      palette.border.default,
      mode === 'dark' ? '#6EE7B7' : '#4ADE80',
      palette.success.text
    ],
    status: {
      success: palette.success.text,
      warning: palette.warning.text,
      error: palette.error.text,
      info: palette.info.text
    }
  } as const;

  return {
    chartColors: colors,
    chartAxisConfig: {
      stroke: palette.border.default,
      strokeWidth: 1,
      style: {
        fontSize: 11,
        fontFamily: typography.fonts.sans.join(', '),
        fill: palette.text.muted,
        fontWeight: typography.fontWeight.medium
      }
    },
    chartGridConfig: {
      stroke: palette.border.subtle,
      strokeWidth: 1,
      strokeDasharray: '3 3'
    },
    chartTooltipStyle: {
      backgroundColor: mode === 'dark' ? 'rgba(30, 41, 59, 0.98)' : 'rgba(255, 255, 255, 0.98)',
      border: `1px solid ${palette.border.default}`,
      borderRadius: '8px',
      padding: '12px 16px',
      boxShadow: mode === 'dark' ? '0 8px 24px rgba(0, 0, 0, 0.4)' : '0 4px 12px rgba(0, 0, 0, 0.08)',
      fontSize: '13px',
      fontFamily: typography.fonts.sans.join(', '),
      color: palette.text.primary
    },
    chartLegendConfig: {
      wrapperStyle: {
        fontSize: '12px',
        fontFamily: typography.fonts.sans.join(', '),
        color: palette.text.secondary,
        paddingTop: '16px'
      },
      iconType: 'circle' as const,
      iconSize: 8
    },
    chartCursor: {
      stroke: mode === 'dark' ? '#93C5FD' : '#BFDBFE',
      strokeWidth: 1
    },
    chartGradients: {
      primary: {
        id: 'colorPrimary',
        stops: [
          { offset: '5%', color: palette.primary.default, opacity: 0.3 },
          { offset: '95%', color: palette.primary.default, opacity: 0 }
        ]
      },
      success: {
        id: 'colorSuccess',
        stops: [
          { offset: '5%', color: palette.success.text, opacity: 0.3 },
          { offset: '95%', color: palette.success.text, opacity: 0 }
        ]
      },
      warning: {
        id: 'colorWarning',
        stops: [
          { offset: '5%', color: palette.warning.text, opacity: 0.3 },
          { offset: '95%', color: palette.warning.text, opacity: 0 }
        ]
      },
      error: {
        id: 'colorError',
        stops: [
          { offset: '5%', color: palette.error.text, opacity: 0.3 },
          { offset: '95%', color: palette.error.text, opacity: 0 }
        ]
      }
    }
  } as const;
};

const lightChartTheme = makeChartTheme('light');

export const chartColors = lightChartTheme.chartColors;
export const chartAxisConfig = lightChartTheme.chartAxisConfig;
export const chartGridConfig = lightChartTheme.chartGridConfig;
export const chartTooltipStyle = lightChartTheme.chartTooltipStyle;
export const chartLegendConfig = lightChartTheme.chartLegendConfig;
export const chartCursor = lightChartTheme.chartCursor;
export const chartGradients = lightChartTheme.chartGradients;

export const chartResponsive = {
  mobile: 480,
  tablet: 768,
  desktop: 1024
} as const;

const chartMarginsConst = {
  default: { top: 10, right: 30, left: 0, bottom: 0 },
  withLegend: { top: 10, right: 30, left: 0, bottom: 30 },
  compact: { top: 5, right: 20, left: 0, bottom: 0 },
  spacious: { top: 20, right: 40, left: 10, bottom: 10 }
} as const;

export const chartMargins = chartMarginsConst;
export type ChartMargin = typeof chartMarginsConst[keyof typeof chartMarginsConst];

export const chartAnimationConfig = {
  duration: 800,
  easing: 'ease-out' as const
};

export const getChartTheme = makeChartTheme;

export type ChartColor = typeof chartColors;
export type ChartGradient = typeof chartGradients;
