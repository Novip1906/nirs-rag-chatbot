export function formatLocale(
  value: string,
  locale: string | undefined,
  options: Intl.DateTimeFormatOptions,
): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  try {
    return new Intl.DateTimeFormat(locale, options).format(date);
  } catch {
    return new Intl.DateTimeFormat(undefined, options).format(date);
  }
}

export function formatLocaleDate(value: string, locale?: string): string {
  return formatLocale(value, locale, { dateStyle: 'medium' });
}

export function formatLocaleDateTime(value: string, locale?: string, hour12?: boolean): string {
  return formatLocale(value, locale, { dateStyle: 'medium', timeStyle: 'short', hour12 });
}
