/**
 * Renders an ISO date string as a short, locale-aware date. Falls back to the
 * system locale if the app locale tag isn't recognized by `Intl`, and to
 * `undefined` (dropping the date silently) if the value itself doesn't parse.
 * Shared by `KnowledgeSources.tsx` and `KnowledgeDocumentDialog.tsx` so both
 * format a document's effective date the same way.
 */
export function formatEffectiveDate(value: string, locale: string): string | undefined {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'short' }).format(date);
  } catch {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'short' }).format(date);
  }
}
