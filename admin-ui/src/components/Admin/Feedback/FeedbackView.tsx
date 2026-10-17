import { useMemo, useRef, useState } from 'react';
import { useLocaleContext } from '~/locales/LocaleProvider';
import { ThumbsDown, ThumbsUp } from 'lucide-react';
import {
  Button,
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
import {
  FEEDBACK_REASON_KEYS,
  getTagByKey,
  INSIGHTS_MAX_RANGE_DAYS,
} from '~/api';
import type {
  AdminFeedbackQueryParams,
  AdminFeedbackRow,
  TFeedbackRating,
  TFeedbackTagKey,
} from '~/api';
import { useAdminFeedbackQuery } from '~/data-provider/Admin';
import {
  LoadingState,
  TablePanel,
  InlineEmptyState,
  dateRangeSelectionDelayMs,
  displayUserName,
  formatRecentChatDate,
  getShortcutDateRange,
  shortcutRanges,
} from '~/components/Admin/common/insightsKit';
import type { ShortcutRange } from '~/components/Admin/common/insightsKit';
import AdminErrorState from '~/components/Admin/common/AdminErrorState';
import AdminPageHeader from '~/components/Admin/common/AdminPageHeader';
import { useModelLabel } from '~/components/Admin/utils/modelLabels';
import LocalizedDateRangePicker from '~/components/ui/LocalizedDateRangePicker';
import { useLocalize } from '~/hooks';
import type { TranslationKeys } from '~/hooks/useLocalize';
import { cn } from '~/utils';

const PAGE_SIZE = 25;
const ALL = 'all';

type CustomDateRange = { startDate: Date; endDate: Date };

function isFeedbackTagKey(value: string): value is TFeedbackTagKey {
  return (FEEDBACK_REASON_KEYS as readonly string[]).includes(value);
}

function useFeedbackReasonLabel(): (row: AdminFeedbackRow) => string {
  const localize = useLocalize();
  return (row: AdminFeedbackRow) => {
    if (row.tag === '') {
      return '—';
    }
    if (!isFeedbackTagKey(row.tag)) {
      return row.tag;
    }
    const tag = getTagByKey(row.tag);
    return tag ? localize(tag.label as TranslationKeys) : row.tag;
  };
}

export default function FeedbackView(): JSX.Element {
  const localize = useLocalize();
  const getModelLabel = useModelLabel();
  const getReasonLabel = useFeedbackReasonLabel();
  const { locale } = useLocaleContext();
  const [range, setRange] = useState<ShortcutRange>('30d');
  const [customDateRange, setCustomDateRange] = useState<CustomDateRange>();
  const [rating, setRating] = useState<typeof ALL | TFeedbackRating>(ALL);
  const [page, setPage] = useState(0);
  const dateRangeSelectionTimeout = useRef<number>();

  const displayDateRange = useMemo(
    () => customDateRange ?? getShortcutDateRange(range),
    [customDateRange, range],
  );

  const params: AdminFeedbackQueryParams = useMemo(
    () => ({
      from: displayDateRange.startDate.toISOString(),
      to: displayDateRange.endDate.toISOString(),
      ...(rating !== ALL ? { rating } : {}),
      limit: PAGE_SIZE,
      skip: page * PAGE_SIZE,
    }),
    [displayDateRange, rating, page],
  );

  const feedbackQuery = useAdminFeedbackQuery(params);
  const rows = feedbackQuery.data?.rows ?? [];
  const total = feedbackQuery.data?.total ?? 0;
  const hasNextPage = (page + 1) * PAGE_SIZE < total;

  const resetPage = () => setPage(0);

  const handleSelectDateRange = (startDate: Date, endDate: Date) => {
    if (dateRangeSelectionTimeout.current != null) {
      window.clearTimeout(dateRangeSelectionTimeout.current);
    }
    dateRangeSelectionTimeout.current = window.setTimeout(() => {
      setCustomDateRange({ startDate: new Date(startDate), endDate: new Date(endDate) });
      resetPage();
      dateRangeSelectionTimeout.current = undefined;
    }, dateRangeSelectionDelayMs);
  };

  return (
    <div className="flex h-full flex-col">
      <AdminPageHeader
        title={localize('com_admin_feedback_title')}
        description={localize('com_admin_feedback_description')}
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
                  resetPage();
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
          <Select
            value={rating}
            onValueChange={(value) => {
              setRating(value as typeof ALL | TFeedbackRating);
              resetPage();
            }}
          >
            <SelectTrigger
              className="w-auto min-w-[11rem]"
              aria-label={localize('com_admin_feedback_filter_rating')}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{localize('com_admin_feedback_filter_all')}</SelectItem>
              <SelectItem value="thumbsUp">{localize('com_admin_feedback_filter_up')}</SelectItem>
              <SelectItem value="thumbsDown">
                {localize('com_admin_feedback_filter_down')}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        {feedbackQuery.isLoading && <LoadingState message={localize('com_admin_loading')} />}
        {feedbackQuery.isError && <AdminErrorState onRetry={() => feedbackQuery.refetch()} />}
        {!feedbackQuery.isLoading && !feedbackQuery.isError && (
          <TablePanel title={localize('com_admin_feedback_title')}>
            {rows.length === 0 ? (
              <InlineEmptyState message={localize('com_admin_feedback_empty_description')} />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{localize('com_admin_feedback_col_date')}</TableHead>
                      <TableHead>{localize('com_admin_feedback_col_user')}</TableHead>
                      <TableHead>{localize('com_admin_feedback_col_model')}</TableHead>
                      <TableHead>{localize('com_admin_feedback_col_rating')}</TableHead>
                      <TableHead>{localize('com_admin_feedback_col_tag')}</TableHead>
                      <TableHead>{localize('com_admin_feedback_col_text')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => (
                      <TableRow key={row.messageId}>
                        <TableCell className="whitespace-nowrap text-sm text-text-secondary">
                          {formatRecentChatDate(row.date, locale)}
                        </TableCell>
                        <TableRowHeader>{displayUserName(row.userName, row.userId)}</TableRowHeader>
                        <TableCell>{getModelLabel(row.model)}</TableCell>
                        <TableCell>
                          {row.rating === 'thumbsUp' ? (
                            <ThumbsUp
                              className="size-4 text-text-secondary"
                              aria-label={localize('com_admin_feedback_rating_up')}
                            />
                          ) : (
                            <ThumbsDown
                              className="size-4 text-text-secondary"
                              aria-label={localize('com_admin_feedback_rating_down')}
                            />
                          )}
                        </TableCell>
                        <TableCell className="max-w-xs truncate">{getReasonLabel(row)}</TableCell>
                        <TableCell className="max-w-sm whitespace-normal break-words">
                          {row.text || '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
            <div className="mt-3 flex items-center justify-between gap-3 border-t border-border-light pt-3 text-sm text-text-secondary">
              <span>
                {localize('com_admin_feedback_page_summary', {
                  from: total === 0 ? 0 : page * PAGE_SIZE + 1,
                  to: Math.min((page + 1) * PAGE_SIZE, total),
                  total,
                })}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page === 0}
                  onClick={() => setPage((current) => Math.max(0, current - 1))}
                >
                  {localize('com_ui_prev')}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!hasNextPage}
                  onClick={() => setPage((current) => current + 1)}
                >
                  {localize('com_ui_next')}
                </Button>
              </div>
            </div>
          </TablePanel>
        )}
      </div>
    </div>
  );
}
