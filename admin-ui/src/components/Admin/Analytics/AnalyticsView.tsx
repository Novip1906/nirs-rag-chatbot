import { useMemo, useRef, useState } from 'react';
import { useLocaleContext } from '~/locales/LocaleProvider';
import { ThumbsDown, ThumbsUp } from 'lucide-react';
import {
  Button,
  Progress,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableRowHeader,
} from '@librechat/client';
import { INSIGHTS_MAX_RANGE_DAYS } from '~/api';
import type {
  AdminActivityQueryParams,
  AdminActivityResponse,
  AdminAnalyticsQueryParams,
  SpendGroupBy,
} from '~/api';
import { useAdminActivityQuery, useAdminAnalyticsQuery } from '~/data-provider/Admin';
import {
  LoadingState,
  MetricCard,
  Panel,
  TablePanel,
  InlineEmptyState,
  Sparkline,
  dateRangeSelectionDelayMs,
  formatDecimalValue,
  formatExactValue,
  getShortcutDateRange,
  shortcutRanges,
} from '~/components/Admin/common/insightsKit';
import type { ShortcutRange, SparklinePoint } from '~/components/Admin/common/insightsKit';
import AdminErrorState from '~/components/Admin/common/AdminErrorState';
import AdminPageHeader from '~/components/Admin/common/AdminPageHeader';
import { formatUsd } from '~/components/Admin/utils/format';
import { useScenarioLabel } from '~/components/Admin/utils/scenarioLabels';
import LocalizedDateRangePicker from '~/components/ui/LocalizedDateRangePicker';
import { useLocalize } from '~/hooks';
import type { TranslationKeys } from '~/hooks/useLocalize';
import { cn } from '~/utils';

type CustomDateRange = { startDate: Date; endDate: Date };

function AnalyticsMetricsRow({
  activity,
  locale,
  localize,
}: {
  activity: AdminActivityResponse;
  locale: string;
  localize: ReturnType<typeof useLocalize>;
}): JSX.Element {
  const {
    activeUsers,
    requests,
    avgRequestsPerUser,
    returningUsers,
    avgActiveDaysPerUser,
    feedback,
  } = activity;
  const returningPercent =
    activeUsers > 0
      ? `${formatExactValue(Math.round((returningUsers / activeUsers) * 100), locale)}%`
      : '—';
  const avgActiveDays = activeUsers > 0 ? formatDecimalValue(avgActiveDaysPerUser, locale) : '—';
  const avgRequests = activeUsers > 0 ? formatDecimalValue(avgRequestsPerUser, locale) : '—';
  const totalFeedback = feedback.thumbsUp + feedback.thumbsDown;
  const positiveFeedbackPercent =
    totalFeedback > 0
      ? `${formatExactValue(Math.round((feedback.thumbsUp / totalFeedback) * 100), locale)}%`
      : '—';

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      <MetricCard
        label={localize('com_admin_metrics_active_users')}
        value={formatExactValue(activeUsers, locale)}
      />
      <MetricCard
        label={localize('com_admin_metrics_requests')}
        value={formatExactValue(requests, locale)}
        caption={localize('com_admin_metrics_requests_caption')}
      />
      <MetricCard label={localize('com_admin_metrics_avg_requests_per_user')} value={avgRequests} />
      <MetricCard
        label={localize('com_admin_metrics_returning_users')}
        value={formatExactValue(returningUsers, locale)}
        caption={localize('com_admin_metrics_returning_users_caption', {
          percent: returningPercent,
          days: avgActiveDays,
        })}
      />
      <MetricCard
        label={localize('com_admin_metrics_feedback')}
        value={
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5">
              <ThumbsUp className="size-5 text-text-secondary" aria-hidden="true" />
              {formatExactValue(feedback.thumbsUp, locale)}
            </span>
            <span className="flex items-center gap-1.5">
              <ThumbsDown className="size-5 text-text-secondary" aria-hidden="true" />
              {formatExactValue(feedback.thumbsDown, locale)}
            </span>
          </div>
        }
        caption={localize('com_admin_metrics_feedback_caption', {
          percent: positiveFeedbackPercent,
        })}
      />
    </div>
  );
}

const GROUP_BY_LABEL_KEY: Record<SpendGroupBy, TranslationKeys> = {
  user: 'com_admin_analytics_group_user',
  department: 'com_admin_analytics_group_department',
  model: 'com_admin_analytics_group_model',
  day: 'com_admin_analytics_group_day',
  scenario: 'com_admin_analytics_group_scenario',
};

export default function AnalyticsView(): JSX.Element {
  const localize = useLocalize();
  const { locale } = useLocaleContext();
  const [range, setRange] = useState<ShortcutRange>('30d');
  const [customDateRange, setCustomDateRange] = useState<CustomDateRange>();
  const [groupBy, setGroupBy] = useState<SpendGroupBy>('department');
  const dateRangeSelectionTimeout = useRef<number>();

  const displayDateRange = useMemo(
    () => customDateRange ?? getShortcutDateRange(range),
    [customDateRange, range],
  );

  const params: AdminAnalyticsQueryParams = useMemo(
    () => ({
      from: displayDateRange.startDate.toISOString(),
      to: displayDateRange.endDate.toISOString(),
      groupBy,
    }),
    [displayDateRange, groupBy],
  );

  const activityParams: AdminActivityQueryParams = useMemo(
    () => ({
      from: displayDateRange.startDate.toISOString(),
      to: displayDateRange.endDate.toISOString(),
    }),
    [displayDateRange],
  );

  const getScenarioLabel = useScenarioLabel();
  const analyticsQuery = useAdminAnalyticsQuery(params);
  const activityQuery = useAdminActivityQuery(activityParams);
  const rows = useMemo(() => {
    /** The server groups by the raw `scenario` code — human-readable labels are a
     *  client concern, same as every other group's label. */
    const data = (analyticsQuery.data ?? []).map((row) =>
      groupBy === 'scenario' ? { ...row, label: getScenarioLabel(row.key) } : row,
    );
    /** Chronological for a day breakdown, so the ranking below reads left-to-right the
     *  same way as the trend sparkline above it — sorted by cost otherwise. */
    return groupBy === 'day'
      ? data.sort((a, b) => a.key.localeCompare(b.key))
      : data.sort((a, b) => b.costUsd - a.costUsd);
  }, [analyticsQuery.data, groupBy, getScenarioLabel]);
  const dailyTrend = useMemo<SparklinePoint[]>(
    () => (groupBy === 'day' ? rows.map((row) => ({ date: row.key, value: row.costUsd })) : []),
    [rows, groupBy],
  );
  const maxCost = rows.reduce((max, row) => Math.max(max, row.costUsd), 0);
  const totalCost = rows.reduce((sum, row) => sum + row.costUsd, 0);
  const totalUnknown = rows.reduce((sum, row) => sum + row.unknownCostRequests, 0);

  const handleSelectDateRange = (startDate: Date, endDate: Date) => {
    if (dateRangeSelectionTimeout.current != null) {
      window.clearTimeout(dateRangeSelectionTimeout.current);
    }
    dateRangeSelectionTimeout.current = window.setTimeout(() => {
      setCustomDateRange({ startDate: new Date(startDate), endDate: new Date(endDate) });
      dateRangeSelectionTimeout.current = undefined;
    }, dateRangeSelectionDelayMs);
  };

  return (
    <div className="flex h-full flex-col">
      <AdminPageHeader
        title={localize('com_admin_analytics_title')}
        description={localize('com_admin_analytics_description')}
      />
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <div className="inline-flex rounded-lg border border-border-light p-0.5">
            {shortcutRanges.map((item) => (
              <Button
                key={item.value}
                size="sm"
                variant="ghost"
                aria-pressed={!customDateRange && range === item.value}
                className={cn(
                  'h-8 rounded-md px-3',
                  !customDateRange && range === item.value && 'bg-surface-active-alt',
                )}
                onClick={() => {
                  if (dateRangeSelectionTimeout.current != null) {
                    window.clearTimeout(dateRangeSelectionTimeout.current);
                    dateRangeSelectionTimeout.current = undefined;
                  }
                  setRange(item.value);
                  setCustomDateRange(undefined);
                }}
              >
                {localize(item.labelKey)}
              </Button>
            ))}
          </div>
          <div className="w-full min-w-0 sm:w-72">
            <LocalizedDateRangePicker
              endDate={displayDateRange.endDate}
              futureDatesDisabled
              labels={{
                apply: localize('com_ui_done'),
                cancel: localize('com_ui_cancel'),
                endDate: localize('com_insights_end_date'),
                invalidRange: localize('com_insights_invalid_date_range', {
                  days: INSIGHTS_MAX_RANGE_DAYS * 6,
                }),
                startDate: localize('com_insights_start_date'),
              }}
              locale={locale}
              maxRangeLength={INSIGHTS_MAX_RANGE_DAYS * 6}
              onSelectDateRange={handleSelectDateRange}
              placeholder={localize('com_insights_date_range_placeholder')}
              startDate={displayDateRange.startDate}
            />
          </div>
          <Select value={groupBy} onValueChange={(value) => setGroupBy(value as SpendGroupBy)}>
            <SelectTrigger
              className="w-auto min-w-[11rem]"
              aria-label={localize('com_admin_analytics_group_by')}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(GROUP_BY_LABEL_KEY) as SpendGroupBy[]).map((key) => (
                <SelectItem key={key} value={key}>
                  {localize(GROUP_BY_LABEL_KEY[key])}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="mb-4">
          {activityQuery.isLoading && <LoadingState message={localize('com_admin_loading')} />}
          {activityQuery.isError && <AdminErrorState onRetry={() => activityQuery.refetch()} />}
          {!activityQuery.isLoading &&
            !activityQuery.isError &&
            (activityQuery.data ? (
              <AnalyticsMetricsRow
                activity={activityQuery.data}
                locale={locale}
                localize={localize}
              />
            ) : (
              <Panel>
                <InlineEmptyState message={localize('com_admin_analytics_empty_description')} />
              </Panel>
            ))}
        </div>

        {analyticsQuery.isLoading && <LoadingState message={localize('com_admin_loading')} />}
        {analyticsQuery.isError && <AdminErrorState onRetry={() => analyticsQuery.refetch()} />}
        {!analyticsQuery.isLoading && !analyticsQuery.isError && rows.length === 0 && (
          <Panel>
            <InlineEmptyState message={localize('com_admin_analytics_empty_description')} />
          </Panel>
        )}
        {!analyticsQuery.isLoading && !analyticsQuery.isError && rows.length > 0 && (
          <div className="space-y-4">
            <Panel>
              <h2 className="text-lg font-normal text-text-secondary">
                {localize('com_admin_analytics_total_label')}
              </h2>
              <div className="mt-3 text-4xl font-semibold tabular-nums leading-none text-text-primary">
                {formatUsd(totalCost)}
              </div>
              {dailyTrend.length > 1 && (
                <Sparkline
                  values={dailyTrend}
                  label={localize('com_admin_analytics_sparkline_label')}
                  locale={locale}
                />
              )}
              {totalUnknown > 0 && (
                <p className="mt-3 text-xs text-status-warning">
                  {localize('com_admin_analytics_unknown_cost', {
                    amount: formatExactValue(totalUnknown, locale),
                  })}
                </p>
              )}
            </Panel>

            <Panel>
              <ul className="space-y-3">
                {rows.map((row) => (
                  <li key={row.key}>
                    <div className="mb-1 flex items-center justify-between gap-3 text-sm">
                      <span className="truncate font-medium text-text-primary">{row.label}</span>
                      <span className="shrink-0 tabular-nums text-text-secondary">
                        {formatUsd(row.costUsd)}
                      </span>
                    </div>
                    <Progress value={maxCost > 0 ? (row.costUsd / maxCost) * 100 : 0} />
                  </li>
                ))}
              </ul>
            </Panel>

            <TablePanel title={localize('com_admin_analytics_table_title')}>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{localize('com_admin_analytics_col_group')}</TableHead>
                      <TableHead className="text-right">
                        {localize('com_admin_analytics_col_cost')}
                      </TableHead>
                      <TableHead className="text-right">
                        {localize('com_admin_analytics_col_requests')}
                      </TableHead>
                      <TableHead className="text-right">
                        {localize('com_admin_analytics_col_tokens')}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => (
                      <TableRow key={row.key}>
                        <TableRowHeader>{row.label}</TableRowHeader>
                        <TableCell className="text-right tabular-nums">
                          {formatUsd(row.costUsd)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatExactValue(row.requests, locale)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatExactValue(row.promptTokens + row.completionTokens, locale)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </TablePanel>
          </div>
        )}
      </div>
    </div>
  );
}
