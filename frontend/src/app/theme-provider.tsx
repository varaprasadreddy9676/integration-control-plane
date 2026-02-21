import { createContext, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { ConfigProvider, App as AntdApp } from 'antd';
import { darkTheme, lightTheme } from '../design-system/theme';
import { useEffect } from 'react';

type ThemeMode = 'light' | 'dark';
type Density = 'middle' | 'small';

interface ThemeContextValue {
  mode: ThemeMode;
  toggleMode: () => void;
  density: Density;
  toggleDensity: () => void;
}

const ThemeModeContext = createContext<ThemeContextValue | undefined>(undefined);

export const ThemeProvider = ({ children }: { children: ReactNode }) => {
  const [mode, setMode] = useState<ThemeMode>(() => (localStorage.getItem('themeMode') as ThemeMode) || 'light');
  const [density, setDensity] = useState<Density>(() => (localStorage.getItem('density') as Density) || 'middle');

  useEffect(() => {
    const className = 'theme-dark';
    if (mode === 'dark') {
      document.body.classList.add(className);
    } else {
      document.body.classList.remove(className);
    }
    localStorage.setItem('themeMode', mode);
  }, [mode]);

  useEffect(() => {
    const className = 'density-compact';
    if (density === 'small') {
      document.body.classList.add(className);
    } else {
      document.body.classList.remove(className);
    }
    localStorage.setItem('density', density);
  }, [density]);

  const value = useMemo(
    () => ({
      mode,
      toggleMode: () => setMode((prev) => (prev === 'light' ? 'dark' : 'light')),
      density,
      toggleDensity: () => setDensity((prev) => (prev === 'middle' ? 'small' : 'middle'))
    }),
    [mode, density]
  );

  return (
    <ThemeModeContext.Provider value={value}>
      <ConfigProvider theme={mode === 'light' ? lightTheme : darkTheme} componentSize={density}>
        <AntdApp>{children}</AntdApp>
      </ConfigProvider>
    </ThemeModeContext.Provider>
  );
};

export const useThemeMode = () => {
  const ctx = useContext(ThemeModeContext);
  if (!ctx) {
    throw new Error('useThemeMode must be used inside ThemeProvider');
  }
  return ctx;
};
