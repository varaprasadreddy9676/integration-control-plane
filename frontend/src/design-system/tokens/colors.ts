export const darkColors = {
  bg: {
    base: '#0F172A',
    subtle: '#111827',
    surface: '#1E293B',
    elevated: '#243244',
    overlay: '#0B1220'
  },
  text: {
    primary: '#E5E7EB',
    secondary: '#B6C2CF',
    muted: '#8A98A8',
    disabled: '#5B6B7C',
    inverse: '#0F172A'
  },
  border: {
    subtle: '#233044',
    default: '#2E3A4F',
    strong: '#3C4A63'
  },
  interactive: {
    hover: '#1F2A3A',
    active: '#2A3A52',
    focusRing: '#3B82F6'
  },
  primary: {
    active: '#2563EB',
    default: '#3B82F6',
    hover: '#60A5FA',
    text: '#93C5FD'
  },
  success: {
    bg: '#052E1A',
    border: '#065F46',
    text: '#34D399'
  },
  warning: {
    bg: '#3A2A05',
    border: '#92400E',
    text: '#FBBF24'
  },
  error: {
    bg: '#3A0F14',
    border: '#7F1D1D',
    text: '#F87171'
  },
  info: {
    bg: '#0C2E4E',
    border: '#1D4ED8',
    text: '#60A5FA'
  },
  table: {
    rowHover: '#1F2A3A',
    rowSelected: '#233044',
    rowActive: '#263549',
    codeBg: '#0B1220',
    codeBorder: '#1F2A3A'
  },
  sidebar: {
    bg: '#0B1220',
    item: '#9AA6B2',
    hover: '#1A2333',
    activeBg: '#1E293B',
    activeText: '#E5E7EB',
    accent: '#3B82F6'
  }
} as const;

export const lightColors = {
  bg: {
    base: '#FAFBFC',
    subtle: '#F4F6F8',
    surface: '#FFFFFF',
    elevated: '#FFFFFF',
    overlay: '#FFFFFF'
  },
  text: {
    primary: '#1C2128',
    secondary: '#57606A',
    muted: '#6E7681',
    disabled: '#ACB4BF',
    inverse: '#FFFFFF'
  },
  border: {
    subtle: '#E8EBEF',
    default: '#D5DAE0',
    strong: '#ACB4BF'
  },
  interactive: {
    hover: '#F4F6F8',
    active: '#E8EBEF',
    focusRing: '#3B82F6'
  },
  primary: {
    active: '#1D4ED8',
    default: '#3B82F6',
    hover: '#2563EB',
    text: '#2563EB'
  },
  success: {
    bg: '#F0FDF4',
    border: '#86EFAC',
    text: '#16A34A'
  },
  warning: {
    bg: '#FEFCE8',
    border: '#FDE047',
    text: '#CA8A04'
  },
  error: {
    bg: '#FEF2F2',
    border: '#FCA5A5',
    text: '#DC2626'
  },
  info: {
    bg: '#EFF6FF',
    border: '#93C5FD',
    text: '#2563EB'
  },
  table: {
    rowHover: '#F4F6F8',
    rowSelected: '#EFF6FF',
    rowActive: '#DBEAFE',
    codeBg: '#F4F6F8',
    codeBorder: '#D5DAE0'
  },
  sidebar: {
    bg: '#1C2128',
    item: '#ACB4BF',
    hover: '#2D333B',
    activeBg: '#2D333B',
    activeText: '#FFFFFF',
    accent: '#3B82F6'
  }
} as const;

/**
 * @deprecated Legacy palette for incremental migration.
 * Components should prefer css variables or useThemeColors().
 */
export const colors = {
  primary: {
    50: '#EFF6FF',
    100: '#DBEAFE',
    200: '#BFDBFE',
    300: '#93C5FD',
    400: '#60A5FA',
    500: '#3B82F6',
    600: '#2563EB',
    700: '#1D4ED8',
    800: '#1E40AF',
    900: '#1E3A8A'
  },
  success: {
    50: lightColors.success.bg,
    100: '#DCFCE7',
    200: '#BBF7D0',
    300: lightColors.success.border,
    400: '#4ADE80',
    500: '#22C55E',
    600: lightColors.success.text,
    700: '#15803D',
    800: '#166534',
    900: '#14532D'
  },
  warning: {
    50: lightColors.warning.bg,
    100: '#FEF9C3',
    200: '#FEF08A',
    300: lightColors.warning.border,
    400: '#FACC15',
    500: '#EAB308',
    600: lightColors.warning.text,
    700: '#A16207',
    800: '#854D0E',
    900: '#713F12'
  },
  error: {
    50: lightColors.error.bg,
    100: '#FEE2E2',
    200: '#FECACA',
    300: lightColors.error.border,
    400: '#F87171',
    500: '#EF4444',
    600: lightColors.error.text,
    700: '#B91C1C',
    800: '#991B1B',
    900: '#7F1D1D'
  },
  info: {
    50: lightColors.info.bg,
    100: '#DBEAFE',
    200: '#BFDBFE',
    300: lightColors.info.border,
    400: '#60A5FA',
    500: '#3B82F6',
    600: lightColors.info.text,
    700: '#1D4ED8',
    800: '#1E40AF',
    900: '#1E3A8A'
  },
  purple: {
    50: '#FAF5FF',
    100: '#F3E8FF',
    200: '#E9D5FF',
    300: '#D8B4FE',
    400: '#C084FC',
    500: '#A855F7',
    600: '#9333EA',
    700: '#7E22CE',
    800: '#6B21A8',
    900: '#581C87'
  },
  neutral: {
    0: '#FFFFFF',
    50: '#FAFBFC',
    100: '#F4F6F8',
    200: '#E8EBEF',
    300: '#D5DAE0',
    400: '#ACB4BF',
    500: '#6E7681',
    600: '#57606A',
    700: '#424A53',
    800: '#2D333B',
    900: '#1C2128',
    950: '#0D1117'
  },
  gradients: {
    primary: 'linear-gradient(135deg, #3B82F6 0%, #2563EB 100%)',
    success: 'linear-gradient(135deg, #22C55E 0%, #16A34A 100%)',
    warning: 'linear-gradient(135deg, #EAB308 0%, #CA8A04 100%)',
    error: 'linear-gradient(135deg, #EF4444 0%, #DC2626 100%)',
    subtlePrimary: 'linear-gradient(135deg, #EFF6FF 0%, #DBEAFE 100%)',
    subtleSuccess: 'linear-gradient(135deg, #F0FDF4 0%, #DCFCE7 100%)',
    glass: 'linear-gradient(135deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.04) 100%)',
    surface: 'linear-gradient(180deg, rgba(255, 255, 255, 0.98) 0%, rgba(250, 251, 252, 0.96) 100%)',
    shimmer: 'linear-gradient(90deg, rgba(255, 255, 255, 0) 0%, rgba(255, 255, 255, 0.4) 50%, rgba(255, 255, 255, 0) 100%)'
  }
} as const;

export const semanticColors = {
  status: {
    healthy: colors.success[500],
    degraded: colors.warning[500],
    critical: colors.error[500],
    unknown: colors.neutral[400],
    pending: colors.info[500],
    retrying: colors.warning[600],
    failed: colors.error[500],
    succeeded: colors.success[500]
  }
} as const;

export type ColorTokens = typeof colors;
export type LightColorTokens = typeof lightColors;
export type DarkColorTokens = typeof darkColors;
