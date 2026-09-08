import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export const THEME_STORAGE_KEY = "smartvisualnaudio.appearance";
export const DEFAULT_THEME = "dark";

// SVG and tooltip styles share the same palette as the rest of the UI.
const chartTokens = {
  axis: "var(--app-text-muted)",
  grid: "var(--chart-grid)",
  cursor: "var(--chart-cursor)",
  tooltipBackground: "var(--app-surface)",
  tooltipBorder: "var(--app-line)",
  tooltipText: "var(--app-text)",
};
export const CHART_THEME = { light: chartTokens, dark: chartTokens };

const ThemeContext = createContext(null);

function normalizeTheme(value) {
  return value === "light" ? "light" : "dark";
}

function readInitialTheme() {
  try {
    return normalizeTheme(window.localStorage.getItem(THEME_STORAGE_KEY) || window.document.documentElement.dataset.theme || DEFAULT_THEME);
  } catch {
    return DEFAULT_THEME;
  }
}

function applyTheme(theme) {
  const root = window.document.documentElement;
  root.dataset.theme = theme;
  root.dataset.appearance = theme;
  root.style.colorScheme = theme;
}

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(readInitialTheme);

  useEffect(() => {
    applyTheme(theme);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Theme still applies when browser storage is unavailable.
    }
  }, [theme]);

  const setTheme = useCallback((nextTheme) => {
    const normalized = normalizeTheme(nextTheme);
    applyTheme(normalized);
    setThemeState(normalized);
  }, []);

  const value = useMemo(() => ({
    isDark: theme === "dark",
    setTheme,
    theme,
    toggleTheme: () => setTheme(theme === "dark" ? "light" : "dark"),
  }), [setTheme, theme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used within ThemeProvider.");
  return context;
}

export function useChartTheme() {
  const { theme } = useTheme();
  return CHART_THEME[theme];
}
