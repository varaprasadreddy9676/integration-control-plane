/**
 * Border Design Tokens
 *
 * Standardized border widths and presets for consistent styling
 * across the application.
 */

/**
 * Border Width Tokens
 *
 * Standard: Use 'thin' (1px) for all borders
 * Future: 'medium' and 'thick' reserved for special emphasis
 */
export const borderWidth = {
  none: '0',
  thin: '1px',      // Standard border width - use everywhere
  medium: '2px',    // Reserved for future accent/active states
  thick: '3px'      // Reserved for future strong emphasis
} as const

export type BorderWidth = typeof borderWidth[keyof typeof borderWidth]

/**
 * Border Preset Utilities
 *
 * Ready-to-use border strings that combine width and color.
 * Uses CSS custom properties for theme-aware colors.
 *
 * @example
 * // In component
 * <Card style={{ border: borders.default }}>
 */
export const borders = {
  // Standard borders - most common usage
  default: '1px solid var(--color-border-default)',
  subtle: '1px solid var(--color-border-subtle)',
  strong: '1px solid var(--color-border-strong)',

  // Semantic borders - for colored emphasis
  primary: '1px solid var(--color-primary-500)',
  success: '1px solid var(--color-success-500)',
  warning: '1px solid var(--color-warning-500)',
  error: '1px solid var(--color-error-500)',
  info: '1px solid var(--color-info-500)',

  // Special states
  focus: '1px solid var(--color-primary-400)',
  hover: '1px solid var(--color-border-strong)',

  // No border
  none: 'none'
} as const

export type Border = typeof borders[keyof typeof borders]

/**
 * Border Style Utilities
 *
 * CSS border-style values for different visual effects
 */
export const borderStyle = {
  solid: 'solid',
  dashed: 'dashed',
  dotted: 'dotted',
  none: 'none'
} as const

export type BorderStyle = typeof borderStyle[keyof typeof borderStyle]

/**
 * Helper function to create custom borders
 *
 * @example
 * createBorder('medium', 'primary')  // '2px solid var(--color-primary-500)'
 * createBorder('thin', 'error', 'dashed')  // '1px dashed var(--color-error-500)'
 */
export const createBorder = (
  width: keyof typeof borderWidth,
  color: string,
  style: keyof typeof borderStyle = 'solid'
): string => {
  const colorVar = color.startsWith('var(') ? color : `var(${color})`
  return `${borderWidth[width]} ${borderStyle[style]} ${colorVar}`
}
