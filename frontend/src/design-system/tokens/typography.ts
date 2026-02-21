export const typography = {
  fonts: {
    sans: [
      'Inter',
      '-apple-system',
      'BlinkMacSystemFont',
      'Segoe UI',
      'Roboto',
      'Helvetica Neue',
      'Arial',
      'sans-serif'
    ],
    mono: ['JetBrains Mono', 'Fira Code', 'Monaco', 'Consolas', 'Courier New', 'monospace'],
    numeric: ['Tabular Nums', 'Inter', 'sans-serif']
  },
  // Compact type scale (Stripe-style: 14px base instead of 16px for tighter, more premium feel)
  fontSize: {
    xs: '0.6875rem',   // 11px - labels, captions
    sm: '0.8125rem',   // 13px - body small, metadata
    base: '0.875rem',  // 14px - body default (premium compact sizing)
    md: '0.9375rem',   // 15px - body large
    lg: '1rem',        // 16px - subheadings
    xl: '1.125rem',    // 18px - h5
    '2xl': '1.375rem', // 22px - h4 (page titles - enterprise standard)
    '3xl': '1.5rem',   // 24px - h3
    '4xl': '1.875rem', // 30px - h2
    '5xl': '2.25rem',  // 36px - h1
    '6xl': '3rem'      // 48px - display
  },
  fontWeight: {
    light: 300,
    normal: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
    extrabold: 800
  },
  // Precise line heights for perfect vertical rhythm
  lineHeight: {
    none: 1,
    tight: 1.2,        // Headings
    snug: 1.375,       // Large text
    normal: 1.5,       // Body text
    relaxed: 1.625,    // Reading content
    loose: 1.75        // Spaced content
  },
  // Refined letter-spacing for premium typography
  letterSpacing: {
    tighter: '-0.02em', // Headings (subtle tightening)
    tight: '-0.01em',   // Large text
    normal: '0',        // Body text
    wide: '0.01em',     // Slight spacing
    wider: '0.025em',   // Labels
    widest: '0.05em'    // Uppercase labels
  },
  heading: {
    h1: {
      fontSize: '5xl',
      fontWeight: 'bold',
      lineHeight: 'tight',
      letterSpacing: 'tight'
    },
    h2: {
      fontSize: '4xl',
      fontWeight: 'bold',
      lineHeight: 'tight',
      letterSpacing: 'tight'
    },
    h3: {
      fontSize: '3xl',
      fontWeight: 'semibold',
      lineHeight: 'snug',
      letterSpacing: 'normal'
    },
    h4: {
      fontSize: '2xl',
      fontWeight: 'semibold',
      lineHeight: 'snug',
      letterSpacing: 'normal'
    },
    h5: {
      fontSize: 'xl',
      fontWeight: 'semibold',
      lineHeight: 'normal',
      letterSpacing: 'normal'
    },
    h6: {
      fontSize: 'lg',
      fontWeight: 'semibold',
      lineHeight: 'normal',
      letterSpacing: 'normal'
    }
  },
  body: {
    large: {
      fontSize: 'lg',
      fontWeight: 'normal',
      lineHeight: 'relaxed'
    },
    default: {
      fontSize: 'base',
      fontWeight: 'normal',
      lineHeight: 'normal'
    },
    small: {
      fontSize: 'sm',
      fontWeight: 'normal',
      lineHeight: 'normal'
    },
    tiny: {
      fontSize: 'xs',
      fontWeight: 'normal',
      lineHeight: 'normal'
    }
  },
  special: {
    label: {
      fontSize: 'xs',
      fontWeight: 'medium',
      textTransform: 'uppercase',
      letterSpacing: 'widest',
      color: 'neutral[600]'
    },
    code: {
      fontFamily: 'mono',
      fontSize: 'sm',
      backgroundColor: 'neutral[100]',
      padding: '0.125rem 0.25rem',
      borderRadius: '0.25rem'
    },
    metric: {
      fontFamily: 'numeric',
      fontSize: '4xl',
      fontWeight: 'bold',
      lineHeight: 'none',
      fontVariantNumeric: 'tabular-nums'
    }
  }
} as const;

export const fontStacks = {
  sans: typography.fonts.sans.join(', '),
  mono: typography.fonts.mono.join(', '),
  numeric: typography.fonts.numeric.join(', ')
} as const;

export type TypographyTokens = typeof typography;
