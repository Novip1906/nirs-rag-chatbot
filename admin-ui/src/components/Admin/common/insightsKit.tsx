import { useId, useMemo, useState } from 'react';
import { Spinner } from '@librechat/client';
import type { TranslationKeys } from '~/hooks/useLocalize';
import { getRollingDateRange } from '~/components/Insights/dateRange';
import { cn } from '~/utils';

/**
 * Shared display primitives copied from `client/src/components/Insights/InsightsView.tsx`
 * (LibreChat's own admin analytics screen). Its components are local and unexported, so
 * this file mirrors their behavior and styling rather than importing them, to keep the
 * admin section visually and behaviorally consistent with `/insights` without editing
 * that file. Keep this in sync by hand if the source changes.
 */

export type ShortcutRange = '24h' | '7d' | '30d';
export type SparklinePoint = { date: string; value: number };

export const shortcutRanges: Array<{
  value: ShortcutRange;
  labelKey: TranslationKeys;
  days: number;
}> = [
  { value: '24h', labelKey: 'com_insights_range_24_hours', days: 1 },
  { value: '7d', labelKey: 'com_insights_range_7_days', days: 7 },
  { value: '30d', labelKey: 'com_insights_range_30_days', days: 30 },
];

export const dateRangeSelectionDelayMs = 350;
export const searchDelayMs = 350;

export function getShortcutDateRange(range: ShortcutRange): { startDate: Date; endDate: Date } {
  const days = shortcutRanges.find((item) => item.value === range)?.days ?? 7;
  return getRollingDateRange(new Date(), days);
}

export function formatValue(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

export function formatExactValue(value: number, locale: string): string {
  return new Intl.NumberFormat(locale).format(value);
}

export function formatDecimalValue(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value);
}

export function formatDate(value: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(value));
}

export function formatRecentChatDate(value: string, locale: string): string {
  const date = new Date(value);
  const now = new Date();
  const elapsedMinutes = Math.floor((now.getTime() - date.getTime()) / 60_000);
  /* `short`, а не `narrow`: в русской локали узкий стиль даёт «-6 мин» — знак минуса вместо
     слова «назад», и колонка даты в журнале расходов читается как отрицательное число. */
  const relativeTime = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' });

  if (elapsedMinutes < 1) {
    return relativeTime.format(0, 'minute');
  }
  if (elapsedMinutes < 60) {
    return relativeTime.format(-elapsedMinutes, 'minute');
  }
  if (elapsedMinutes < 24 * 60) {
    return relativeTime.format(-Math.floor(elapsedMinutes / 60), 'hour');
  }
  if (elapsedMinutes < 7 * 24 * 60) {
    return relativeTime.format(-Math.floor(elapsedMinutes / (24 * 60)), 'day');
  }
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  }).format(date);
}

export function displayUserName(name: string, fallback: string): string {
  return name || fallback;
}

export function responseStatus(error: unknown): number | undefined {
  return (error as { response?: { status?: number } } | undefined)?.response?.status;
}

export function Panel({
  children,
  className,
  role,
}: {
  children: React.ReactNode;
  className?: string;
  role?: string;
}): JSX.Element {
  return (
    <section
      role={role}
      className={cn(
        'min-w-0 rounded-lg border border-border-light bg-surface-primary p-5',
        className,
      )}
    >
      {children}
    </section>
  );
}

export function MetricCard({
  label,
  value,
  caption,
}: {
  label: string;
  value: React.ReactNode;
  caption?: React.ReactNode;
}): JSX.Element {
  return (
    <Panel className="min-w-0">
      <h3 className="text-sm font-normal text-text-secondary">{label}</h3>
      <div className="mt-2 text-3xl font-semibold tabular-nums leading-none text-text-primary">
        {value}
      </div>
      {caption != null && <p className="mt-2 text-xs text-text-secondary">{caption}</p>}
    </Panel>
  );
}

export function InlineEmptyState({ message }: { message: string }): JSX.Element {
  return (
    <div className="flex min-h-40 items-center justify-center text-sm text-text-secondary">
      {message}
    </div>
  );
}

export function LoadingState({ message }: { message: string }): JSX.Element {
  return (
    <Panel className="flex min-h-52 flex-col items-center justify-center gap-3">
      <Spinner className="size-7 text-text-secondary" />
      <span className="text-sm text-text-secondary">{message}</span>
    </Panel>
  );
}

export function TablePanel({
  title,
  children,
}: {
  title: React.ReactNode;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <Panel className="overflow-hidden">
      <h2 className="mb-3 text-base font-semibold text-text-primary">{title}</h2>
      {children}
    </Panel>
  );
}

export function Sparkline({
  values,
  label,
  locale,
}: {
  values: SparklinePoint[];
  label: string;
  locale: string;
}): JSX.Element {
  const patternId = useId().replace(/:/g, '');
  const [activeIndex, setActiveIndex] = useState<number>();
  const points = useMemo(() => {
    if (values.length < 2) {
      return [];
    }
    const maximum = Math.max(1, ...values.map((point) => point.value));
    return values.map((point, index) => ({
      ...point,
      x: (index / (values.length - 1)) * 300,
      y: 52 - (point.value / maximum) * 46,
    }));
  }, [values]);

  if (points.length < 2) {
    return <div className="h-14" />;
  }

  const line = points.map((point) => `${point.x},${point.y}`).join(' ');
  const area = `M 0 56 L ${points.map((point) => `${point.x} ${point.y}`).join(' L ')} L 300 56 Z`;
  const activePoint = activeIndex == null ? undefined : points[activeIndex];
  const formatter = new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });

  return (
    <div
      className="relative mt-2 h-14 w-full text-status-info outline-none"
      role="img"
      tabIndex={0}
      aria-label={label}
      onFocus={() => setActiveIndex(points.length - 1)}
      onBlur={() => setActiveIndex(undefined)}
      onMouseLeave={() => setActiveIndex(undefined)}
      onMouseMove={(event) => {
        const bounds = event.currentTarget.getBoundingClientRect();
        const ratio = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
        setActiveIndex(Math.round(ratio * (points.length - 1)));
      }}
    >
      <svg
        className="h-full w-full overflow-visible"
        viewBox="0 0 300 56"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <defs>
          <pattern id={patternId} width="6" height="6" patternUnits="userSpaceOnUse">
            <path
              d="M-1 1 L1 -1 M0 6 L6 0 M5 7 L7 5"
              stroke="currentColor"
              strokeWidth="0.8"
              opacity="0.22"
            />
          </pattern>
        </defs>
        <path d={area} fill={`url(#${patternId})`} />
        <polyline
          points={line}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      {activePoint && (
        <>
          <span
            className="pointer-events-none absolute top-0 h-full w-px bg-border-medium"
            style={{ left: `${(activePoint.x / 300) * 100}%` }}
          />
          <span
            className="pointer-events-none absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-status-info ring-2 ring-surface-primary"
            style={{
              left: `${(activePoint.x / 300) * 100}%`,
              top: `${(activePoint.y / 56) * 100}%`,
            }}
          />
          <span
            className="pointer-events-none absolute bottom-full mb-2 -translate-x-1/2 whitespace-nowrap rounded-lg border border-border-light bg-surface-primary px-2.5 py-1.5 text-xs text-text-primary shadow-lg"
            style={{ left: `${Math.max(14, Math.min(86, (activePoint.x / 300) * 100))}%` }}
          >
            {formatter.format(new Date(activePoint.date))}{' '}
            <strong>{formatExactValue(activePoint.value, locale)}</strong>
          </span>
        </>
      )}
    </div>
  );
}
