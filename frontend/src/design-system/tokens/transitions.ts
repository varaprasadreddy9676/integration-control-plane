/**
 * Transition Tokens
 * Standardized transition durations, easing functions, and presets
 */

/**
 * Duration tokens for consistent animation timing
 */
export const duration = {
  instant: '0ms',
  fast: '150ms',      // Quick interactions (hover, focus)
  normal: '200ms',    // Standard transitions (most common)
  moderate: '300ms',  // Deliberate animations (modals, drawers)
  slow: '500ms',      // Emphasis animations
  slower: '700ms'     // Complex state changes
} as const;

/**
 * Easing functions for natural motion
 */
export const easing = {
  // Standard CSS easing
  linear: 'linear',
  ease: 'ease',
  easeIn: 'ease-in',
  easeOut: 'ease-out',
  easeInOut: 'ease-in-out',

  // Custom cubic-bezier functions for specific use cases
  smooth: 'cubic-bezier(0.4, 0, 0.2, 1)',           // Material Design standard
  smoothOut: 'cubic-bezier(0, 0, 0.2, 1)',          // Accelerated exit
  smoothIn: 'cubic-bezier(0.4, 0, 1, 1)',           // Decelerated entrance
  spring: 'cubic-bezier(0.175, 0.885, 0.32, 1.275)', // Slight bounce
  snappy: 'cubic-bezier(0.4, 0, 0.6, 1)'            // Quick and responsive
} as const;

/**
 * Common transition presets - ready-to-use transition strings
 */
export const transitions = {
  // All properties
  all: `all ${duration.normal} ${easing.ease}`,
  allFast: `all ${duration.fast} ${easing.ease}`,
  allSmooth: `all ${duration.normal} ${easing.smooth}`,
  allSlow: `all ${duration.moderate} ${easing.ease}`,

  // Opacity transitions (fade in/out)
  fade: `opacity ${duration.normal} ${easing.smooth}`,
  fadeFast: `opacity ${duration.fast} ${easing.smooth}`,
  fadeOut: `opacity ${duration.normal} ${easing.smoothOut}`,
  fadeIn: `opacity ${duration.normal} ${easing.smoothIn}`,

  // Transform transitions (scale, translate, rotate)
  transform: `transform ${duration.normal} ${easing.smooth}`,
  transformFast: `transform ${duration.fast} ${easing.smooth}`,
  transformSpring: `transform ${duration.moderate} ${easing.spring}`,

  // Color transitions (background, text color, border color)
  color: `color ${duration.normal} ${easing.ease}`,
  background: `background ${duration.normal} ${easing.ease}`,
  backgroundFast: `background ${duration.fast} ${easing.ease}`,
  border: `border-color ${duration.normal} ${easing.ease}`,

  // Shadow transitions
  shadow: `box-shadow ${duration.normal} ${easing.smooth}`,
  shadowFast: `box-shadow ${duration.fast} ${easing.smooth}`,

  // Multiple properties (common combinations)
  interactive: `background ${duration.fast} ${easing.ease}, border-color ${duration.fast} ${easing.ease}, box-shadow ${duration.fast} ${easing.smooth}`,
  hoverLift: `transform ${duration.fast} ${easing.smooth}, box-shadow ${duration.fast} ${easing.smooth}`,
  scale: `transform ${duration.fast} ${easing.smooth}, opacity ${duration.fast} ${easing.smooth}`,

  // None (for disabling animations)
  none: 'none'
} as const;

/**
 * Helper function to create custom transitions
 * @example
 * createTransition('opacity', 'fast', 'smoothOut')
 * // Returns: 'opacity 150ms cubic-bezier(0, 0, 0.2, 1)'
 */
export const createTransition = (
  property: string,
  durationKey: keyof typeof duration = 'normal',
  easingKey: keyof typeof easing = 'ease'
): string => {
  return `${property} ${duration[durationKey]} ${easing[easingKey]}`;
};

/**
 * Helper to combine multiple transitions
 * @example
 * combineTransitions(
 *   createTransition('opacity', 'fast'),
 *   createTransition('transform', 'fast', 'smooth')
 * )
 * // Returns: 'opacity 150ms ease, transform 150ms cubic-bezier(0.4, 0, 0.2, 1)'
 */
export const combineTransitions = (...transitionStrings: string[]): string => {
  return transitionStrings.join(', ');
};
