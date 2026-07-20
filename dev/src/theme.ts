/**
 * The two grayscale themes. Dark is the default: when nothing is stored, the app opens dark and
 * the toggle flips to light. The choice persists under a single localStorage key.
 */
export type Theme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'pokeplanner-theme';

/** The stored theme, defaulting to dark when unset or when storage is unavailable. */
export function readStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return stored === 'light' || stored === 'dark' ? stored : 'dark';
  } catch {
    return 'dark';
  }
}

/** Reflect a theme onto the document and persist it; storage failures never break the UI. */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // A private-mode or blocked storage still themes for the session; nothing more to do.
  }
}

/** Apply the stored theme before first paint so there is no flash of the wrong theme. */
export function applyInitialTheme(): void {
  document.documentElement.dataset.theme = readStoredTheme();
}
