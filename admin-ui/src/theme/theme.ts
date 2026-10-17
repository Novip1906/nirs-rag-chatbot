export const themePreferences = ['light', 'dark', 'system'] as const;

export type ThemePreference = (typeof themePreferences)[number];
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'theme';

/**
 * По умолчанию — как в системе: админку открывают и днём, и вечером, и навязывать
 * светлую тему тому, у кого вся ОС тёмная, значит слепить его на каждом входе.
 */
const DEFAULT_PREFERENCE: ThemePreference = 'system';

export function normalizeTheme(value?: string | null): ThemePreference {
  return themePreferences.includes(value as ThemePreference)
    ? (value as ThemePreference)
    : DEFAULT_PREFERENCE;
}

export function readStoredTheme(): ThemePreference {
  try {
    return normalizeTheme(localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return DEFAULT_PREFERENCE;
  }
}

export function persistTheme(preference: ThemePreference): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    return;
  }
}

export function prefersDarkScheme(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  );
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference === 'system') {
    return prefersDarkScheme() ? 'dark' : 'light';
  }
  return preference;
}

/**
 * Класс `dark` на `<html>` — то, по чему Tailwind переключает токены (`darkMode: 'class'`),
 * а `color-scheme` — то, по чему браузер перекрашивает своё: полосы прокрутки, поля ввода
 * и выпадающие списки. Без второго тёмная страница остаётся со светлым скроллбаром.
 */
export function applyTheme(resolved: ResolvedTheme): void {
  const root = document.documentElement;
  root.classList.toggle('dark', resolved === 'dark');
  root.style.colorScheme = resolved;
}
