export const DICTATION_LANGUAGES = ['ru', 'en'] as const;

export type DictationLanguage = (typeof DICTATION_LANGUAGES)[number];

export const DEFAULT_DICTATION_LANGUAGE: DictationLanguage = 'ru';

export function isDictationLanguage(value: string): value is DictationLanguage {
  return (DICTATION_LANGUAGES as readonly string[]).includes(value);
}

export function parseDictationLanguage(value: string): DictationLanguage | null {
  const candidate = value.trim().split('-')[0].toLowerCase();
  return isDictationLanguage(candidate) ? candidate : null;
}

export function normalizeDictationLanguage(value: string): DictationLanguage {
  return parseDictationLanguage(value) ?? DEFAULT_DICTATION_LANGUAGE;
}
