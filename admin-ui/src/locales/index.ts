import ru from './ru/translation.json';
import en from './en/translation.json';

export const supportedLocales = ['ru', 'en'] as const;

export type SupportedLocale = (typeof supportedLocales)[number];
export type TranslationDictionary = Record<string, string>;

export const dictionaries: Record<SupportedLocale, TranslationDictionary> = {
  ru,
  en,
};

export type TranslationKeys = keyof typeof en;

const STORAGE_KEY = 'lang';
const DEFAULT_LOCALE: SupportedLocale = 'ru';

function readStoredLocale(): string | undefined {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Система русскоязычная — по умолчанию всегда `ru`, независимо от языка
 * браузера. Английский используется только как fallback для отсутствующих
 * переводов (см. useLocalize) и как явный выбор через persistLocale.
 */
export function normalizeLocale(locale?: string | null): SupportedLocale {
  if (!locale) {
    return DEFAULT_LOCALE;
  }
  const base = locale.toLowerCase().split('-')[0];
  return supportedLocales.includes(base as SupportedLocale)
    ? (base as SupportedLocale)
    : DEFAULT_LOCALE;
}

export function detectInitialLocale(): SupportedLocale {
  return normalizeLocale(readStoredLocale());
}

export function persistLocale(locale: SupportedLocale): void {
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    return;
  }
}
