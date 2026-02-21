import { theme } from 'antd';
import { borderRadius, container, spacing } from '../tokens/spacing';
import { borderWidth, borders } from '../tokens/borders';
import { breakpoints } from '../tokens/breakpoints';
import { colors, semanticColors } from '../tokens/colors';
import { shadows, coloredShadows } from '../tokens/shadows';
import { motion } from '../tokens/animations';
import { duration, easing, transitions, createTransition, combineTransitions } from '../tokens/transitions';
import { fontStacks, typography } from '../tokens/typography';
import { zIndex } from '../tokens/zIndex';
import { useThemeColors } from './useThemeColors';

export const useDesignTokens = () => {
  const { token } = theme.useToken();
  const themeColors = useThemeColors();

  return {
    token,
    spacing,
    borderRadius,
    borderWidth,
    borders,
    container,
    colors,
    themeColors,
    semanticColors,
    shadows,
    coloredShadows,
    motion,
    duration,
    easing,
    transitions,
    createTransition,
    combineTransitions,
    typography,
    fonts: fontStacks,
    breakpoints,
    zIndex
  };
};
