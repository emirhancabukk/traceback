/**
 * Colour theme preference. "system" follows the operating system's light or
 * dark setting; "dark" and "light" pin one. Stored under its own key, apart
 * from the workspace, so it never travels in backups.
 */
export const THEMES = ['system', 'dark', 'light'] as const;
export type Theme = (typeof THEMES)[number];
export const THEME_KEY = 'traceback.theme';

export const isTheme = (value: unknown): value is Theme => (THEMES as readonly unknown[]).includes(value);

function storage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export function readTheme(): Theme {
  try {
    const value = storage()?.getItem(THEME_KEY);
    return isTheme(value) ? value : 'system';
  } catch {
    return 'system';
  }
}

export function saveTheme(theme: Theme): void {
  try {
    if (theme === 'system') storage()?.removeItem(THEME_KEY);
    else storage()?.setItem(THEME_KEY, theme);
  } catch {
    // Storage is blocked: the choice lasts until the page is closed.
  }
}

/** Sets or clears data-theme on <html>; the stylesheet does the rest. */
export function applyTheme(root: HTMLElement, theme: Theme): void {
  if (theme === 'system') delete root.dataset.theme;
  else root.dataset.theme = theme;
}
