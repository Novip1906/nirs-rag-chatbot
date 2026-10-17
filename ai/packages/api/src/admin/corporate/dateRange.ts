export const DEFAULT_WINDOW_DAYS = 30;
export const DATE_RANGE_ERROR = '"from" must be before "to"';

export interface DateRangeInput {
  from?: unknown;
  to?: unknown;
}

export interface DateRange {
  from: Date;
  to: Date;
}

export function parseDateParam(value: unknown): Date | null {
  if (typeof value !== 'string' || !value) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function resolveDateRange(query: DateRangeInput): DateRange | null {
  const now = new Date();
  const defaultFrom = new Date(now.getTime() - DEFAULT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const from = parseDateParam(query.from) ?? defaultFrom;
  const to = parseDateParam(query.to) ?? now;
  if (from.getTime() > to.getTime()) {
    return null;
  }
  return { from, to };
}
