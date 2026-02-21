/**
 * Premium Motion System
 * Inspired by Stripe, Linear, Vercel, and Framer Motion
 *
 * Philosophy:
 * - Fast enough to feel responsive (< 300ms for most interactions)
 * - Slow enough to feel intentional (> 100ms to be perceptible)
 * - Natural physics-based easing for organic feel
 * - Consistent timing across similar interaction patterns
 */

export const motion = {
  // Duration scale (Fibonacci-inspired for natural progression)
  duration: {
    instant: '0ms',        // No animation (accessibility: prefers-reduced-motion)
    micro: '75ms',         // Tooltip appear, hover feedback
    fast: '150ms',         // Button press, input focus, color changes
    base: '200ms',         // Card hover, dropdown open, modal fade
    moderate: '300ms',     // Page transitions, drawer slide
    slow: '450ms',         // Complex animations, multi-stage effects
    slower: '600ms',       // Hero animations, loading states
    slowest: '900ms'       // Emphasis animations, celebratory effects
  },

  // Premium easing curves (industry-standard + custom)
  easing: {
    // Standard curves
    linear: 'linear',
    easeIn: 'cubic-bezier(0.4, 0, 1, 1)',
    easeOut: 'cubic-bezier(0, 0, 0.2, 1)',
    easeInOut: 'cubic-bezier(0.4, 0, 0.2, 1)',

    // Premium curves (Stripe, Linear, Vercel)
    smoothOut: 'cubic-bezier(0.16, 1, 0.3, 1)',        // Natural deceleration (PRIMARY)
    smoothIn: 'cubic-bezier(0.7, 0, 0.84, 0)',         // Natural acceleration
    smoothInOut: 'cubic-bezier(0.65, 0, 0.35, 1)',     // Balanced S-curve

    // Specialized curves
    snappy: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)',    // Quick, decisive
    bounce: 'cubic-bezier(0.68, -0.55, 0.265, 1.55)',  // Playful overshoot
    elastic: 'cubic-bezier(0.68, -0.6, 0.32, 1.6)',    // Springy bounce
    anticipate: 'cubic-bezier(0.36, 0, 0.66, -0.56)',  // Pull back before action

    // iOS-inspired curves
    iosStandard: 'cubic-bezier(0.4, 0.0, 0.2, 1)',
    iosAccelerate: 'cubic-bezier(0.55, 0.055, 0.675, 0.19)',
    iosDecelerate: 'cubic-bezier(0.215, 0.61, 0.355, 1)',
    iosSharp: 'cubic-bezier(0.4, 0.0, 0.6, 1)',

    // Material Design curves
    material: 'cubic-bezier(0.4, 0.0, 0.2, 1)',
    materialAccelerate: 'cubic-bezier(0.4, 0.0, 1, 1)',
    materialDecelerate: 'cubic-bezier(0.0, 0.0, 0.2, 1)',
    materialSharp: 'cubic-bezier(0.4, 0.0, 0.6, 1)'
  },

  // Pre-configured transitions for common patterns
  transitions: {
    // Interaction states
    hover: {
      property: 'transform, box-shadow, border-color',
      duration: '150ms',
      easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
      willChange: 'transform, box-shadow'
    },
    press: {
      property: 'transform, opacity',
      duration: '75ms',
      easing: 'cubic-bezier(0.4, 0, 1, 1)',
      willChange: 'transform'
    },
    focus: {
      property: 'box-shadow, border-color',
      duration: '150ms',
      easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
      willChange: 'box-shadow'
    },

    // Visual properties
    colors: {
      property: 'background-color, border-color, color, fill, stroke',
      duration: '200ms',
      easing: 'cubic-bezier(0.4, 0.0, 0.2, 1)'
    },
    opacity: {
      property: 'opacity',
      duration: '200ms',
      easing: 'cubic-bezier(0, 0, 0.2, 1)'
    },
    shadow: {
      property: 'box-shadow',
      duration: '200ms',
      easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
      willChange: 'box-shadow'
    },

    // Spatial transformations
    transform: {
      property: 'transform',
      duration: '200ms',
      easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
      willChange: 'transform'
    },
    scale: {
      property: 'transform',
      duration: '150ms',
      easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
      willChange: 'transform'
    },
    slide: {
      property: 'transform, opacity',
      duration: '300ms',
      easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
      willChange: 'transform, opacity'
    },

    // Layout changes
    collapse: {
      property: 'height, opacity, margin, padding',
      duration: '300ms',
      easing: 'cubic-bezier(0.4, 0.0, 0.2, 1)'
    },
    expand: {
      property: 'height, opacity, margin, padding',
      duration: '300ms',
      easing: 'cubic-bezier(0.16, 1, 0.3, 1)'
    },

    // All-purpose fallbacks
    fast: {
      property: 'all',
      duration: '150ms',
      easing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)'
    },
    smooth: {
      property: 'all',
      duration: '200ms',
      easing: 'cubic-bezier(0.16, 1, 0.3, 1)'
    }
  },

  // Stagger timing for lists and grids
  stagger: {
    micro: '20ms',      // Subtle, barely noticeable
    fast: '30ms',       // Quick succession
    base: '50ms',       // Standard stagger
    slow: '75ms',       // Deliberate reveal
    slower: '100ms'     // Dramatic entrance
  },

  // Delay timing for coordinated animations
  delay: {
    none: '0ms',
    micro: '50ms',
    short: '100ms',
    base: '150ms',
    long: '250ms',
    longer: '400ms'
  }
} as const;

export type MotionTokens = typeof motion;
