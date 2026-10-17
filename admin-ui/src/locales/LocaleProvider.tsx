import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { detectInitialLocale, persistLocale } from './index';
import type { SupportedLocale } from './index';

type LocaleContextType = {
  locale: SupportedLocale;
  setLocale: (locale: SupportedLocale) => void;
};

const LocaleContext = createContext<LocaleContextType>({
  locale: 'en',
  setLocale: () => undefined,
});

export function LocaleProvider({ children }: { children: ReactNode }): JSX.Element {
  const [locale, setLocaleState] = useState<SupportedLocale>(() => detectInitialLocale());

  /**
   * `<html lang>` — не украшение: по нему браузер выбирает правила переносов и словарь
   * проверки орфографии, а скринридер — голос, которым читает страницу. Русский текст,
   * помеченный как английский, читается вслух неразборчиво.
   */
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const value = useMemo<LocaleContextType>(
    () => ({
      locale,
      setLocale: (next: SupportedLocale) => {
        persistLocale(next);
        setLocaleState(next);
      },
    }),
    [locale],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocaleContext(): LocaleContextType {
  return useContext(LocaleContext);
}
