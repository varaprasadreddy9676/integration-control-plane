import { useMemo } from 'react';
import { useThemeMode } from '../../app/theme-provider';
import { darkColors, lightColors } from '../tokens/colors';

export const useThemeColors = () => {
  const { mode } = useThemeMode();

  return useMemo(() => {
    return mode === 'dark' ? darkColors : lightColors;
  }, [mode]);
};
