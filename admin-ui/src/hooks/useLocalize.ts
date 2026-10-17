import { useCallback } from 'react';
import { dictionaries } from '../locales';
import type { TranslationKeys } from '../locales';
import { useLocaleContext } from '../locales/LocaleProvider';

export type { TranslationKeys };

export type LocalizeOptions = Record<string, string | number>;

function interpolate(template: string, options?: LocalizeOptions): string {
  if (!options) {
    return template;
  }
  return template.replace(/\{\{\s*([\w0-9]+)\s*\}\}/g, (match, key: string) => {
    const value = options[key];
    return value === undefined ? match : String(value);
  });
}

export default function useLocalize(): (key: TranslationKeys, options?: LocalizeOptions) => string {
  const { locale } = useLocaleContext();

  return useCallback(
    (key: TranslationKeys, options?: LocalizeOptions): string => {
      const template = dictionaries[locale][key] ?? dictionaries.en[key] ?? key;
      return interpolate(template, options);
    },
    [locale],
  );
}
