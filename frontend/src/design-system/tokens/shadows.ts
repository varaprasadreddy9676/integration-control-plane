// Refined shadows for premium feel (Stripe/Vercel style - subtle, purposeful)
export const shadows = {
  none: 'none',
  xs: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
  sm: '0 1px 3px 0 rgba(0, 0, 0, 0.08), 0 1px 2px -1px rgba(0, 0, 0, 0.08)',
  base: '0 2px 4px -1px rgba(0, 0, 0, 0.06), 0 4px 6px -1px rgba(0, 0, 0, 0.10)',
  md: '0 4px 6px -1px rgba(0, 0, 0, 0.08), 0 2px 4px -2px rgba(0, 0, 0, 0.08)',
  lg: '0 10px 15px -3px rgba(0, 0, 0, 0.08), 0 4px 6px -4px rgba(0, 0, 0, 0.08)',
  xl: '0 20px 25px -5px rgba(0, 0, 0, 0.08), 0 8px 10px -6px rgba(0, 0, 0, 0.08)',
  '2xl': '0 25px 50px -12px rgba(0, 0, 0, 0.20)',
  inner: 'inset 0 2px 4px 0 rgba(0, 0, 0, 0.05)',
  // Premium focus rings (Stripe-style - soft, colored glow)
  focusRing: '0 0 0 3px rgba(91, 141, 239, 0.12)',
  focusRingError: '0 0 0 3px rgba(239, 68, 68, 0.12)',
  focusRingSuccess: '0 0 0 3px rgba(34, 197, 94, 0.12)',
  focusRingWarning: '0 0 0 3px rgba(234, 179, 8, 0.12)'
} as const;

// Colored shadows for interactive elements (using new color palette)
export const coloredShadows = {
  primary: '0 4px 14px 0 rgba(91, 141, 239, 0.20)',
  primaryHover: '0 6px 20px 0 rgba(91, 141, 239, 0.30)',
  success: '0 4px 14px 0 rgba(34, 197, 94, 0.20)',
  successHover: '0 6px 20px 0 rgba(34, 197, 94, 0.30)',
  warning: '0 4px 14px 0 rgba(234, 179, 8, 0.20)',
  warningHover: '0 6px 20px 0 rgba(234, 179, 8, 0.30)',
  error: '0 4px 14px 0 rgba(239, 68, 68, 0.20)',
  errorHover: '0 6px 20px 0 rgba(239, 68, 68, 0.30)'
} as const;

export type ShadowTokens = typeof shadows;
