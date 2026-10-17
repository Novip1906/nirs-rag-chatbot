import { useCallback, useMemo, useRef, useState } from 'react';
import { useLocaleContext } from '~/locales/LocaleProvider';
import {
  Button,
  ControlCombobox,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from '@librechat/client';
import { INSIGHTS_MAX_RANGE_DAYS } from '~/api';
import { useModelsQuery } from '~/data-provider/models';
import type { AdminSpendQueryParams } from '~/api';
import type { OptionWithIcon } from '@librechat/client';
import {
  useAdminDepartmentsQuery,
  useAdminSpendLogQuery,
  useAdminUsersQuery,
} from '~/data-provider/Admin';
import {
  LoadingState,
  TablePanel,
  InlineEmptyState,
  dateRangeSelectionDelayMs,
  displayUserName,
  getShortcutDateRange,
  shortcutRanges,
} from '~/components/Admin/common/insightsKit';
import type { ShortcutRange } from '~/components/Admin/common/insightsKit';
import AdminErrorState from '~/components/Admin/common/AdminErrorState';
import RequestRow from './RequestRow';
import ProviderBalance from './ProviderBalance';
import AdminPageHeader from '~/components/Admin/common/AdminPageHeader';
import { useScenarioLabel } from '~/components/Admin/utils/scenarioLabels';
import LocalizedDateRangePicker from '~/components/ui/LocalizedDateRangePicker';
import { useCapabilities, useDebounce, useLocalize } from '~/hooks';
import { cn } from '~/utils';

const PAGE_SIZE = 25;
const ALL = 'all';
/** The user dropdown shows one page of matches, not the whole roster: typing narrows the
 *  list server-side, so the cap bounds what is rendered rather than what is reachable. */
const USER_FILTER_LIMIT = 50;
const USER_SEARCH_DELAY_MS = 300;

type CustomDateRange = { startDate: Date; endDate: Date };
type SelectedUser = { id: string; label: string };

export default function SpendView(): JSX.Element {
  const localize = useLocalize();
  const getScenarioLabel = useScenarioLabel();
  const { locale } = useLocaleContext();
  const { capabilities } = useCapabilities();
  /**
   * Список отделов и баланс провайдера — за `manage:configs` (сервер закрывает оба
   * админ-уровнем роли). Без гейта запрос всё равно уходил бы и получал 403, а фильтр
   * «Отдел» остался бы с единственным пунктом «Все» — молча, без объяснения причины.
   * Фильтр по модели трогает общий `/api/models`, доступный любому вошедшему, поэтому
   * его не прячем.
   */
  const canManageConfigs = capabilities.has('manage:configs');
  const [range, setRange] = useState<ShortcutRange>('30d');
  const [customDateRange, setCustomDateRange] = useState<CustomDateRange>();
  const [departmentId, setDepartmentId] = useState(ALL);
  const [selectedUser, setSelectedUser] = useState<SelectedUser | null>(null);
  const [userSearch, setUserSearch] = useState('');
  const [model, setModel] = useState(ALL);
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const dateRangeSelectionTimeout = useRef<number>();

  const toggleExpanded = useCallback((id: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (!next.delete(id)) {
        next.add(id);
      }
      return next;
    });
  }, []);

  const debouncedUserSearch = useDebounce(userSearch, USER_SEARCH_DELAY_MS);
  const userId = selectedUser?.id ?? ALL;

  const departmentsQuery = useAdminDepartmentsQuery({ enabled: canManageConfigs });
  /** Приглашения в этот список больше не подмешиваются: у них своя вкладка и свой запрос. */
  const usersQuery = useAdminUsersQuery({
    limit: USER_FILTER_LIMIT,
    offset: 0,
    search: debouncedUserSearch,
  });
  const users = usersQuery.data?.users;
  const modelsQuery = useModelsQuery();

  /** The dropdown shows names only, but the roster is searched by name *and* email, so a
   *  colleague can be found by whichever of the two the admin happens to remember. */
  const userOptions: OptionWithIcon[] = useMemo(
    () => [
      { label: localize('com_admin_spend_filter_all'), value: ALL },
      ...(users ?? []).map((user) => ({
        label: displayUserName(user.name, localize('com_insights_unknown_user')),
        value: user.id,
      })),
    ],
    [users, localize],
  );

  const modelNames = useMemo(() => {
    const config = modelsQuery.data ?? {};
    return Array.from(new Set(Object.values(config).flat())).sort((a, b) => a.localeCompare(b));
  }, [modelsQuery.data]);

  const displayDateRange = useMemo(
    () => customDateRange ?? getShortcutDateRange(range),
    [customDateRange, range],
  );

  const params: AdminSpendQueryParams = useMemo(
    () => ({
      from: displayDateRange.startDate.toISOString(),
      to: displayDateRange.endDate.toISOString(),
      ...(departmentId !== ALL ? { departmentId } : {}),
      ...(userId !== ALL ? { userId } : {}),
      ...(model !== ALL ? { model } : {}),
      limit: PAGE_SIZE,
      skip: page * PAGE_SIZE,
    }),
    [displayDateRange, departmentId, userId, model, page],
  );

  const spendQuery = useAdminSpendLogQuery(params);
  const rows = spendQuery.data?.rows ?? [];
  const total = spendQuery.data?.total ?? 0;
  const hasNextPage = (page + 1) * PAGE_SIZE < total;

  /** Идентификаторы строк живут внутри страницы: после смены фильтра раскрытым
   *  осталось бы что-то другое. */
  const resetPage = () => {
    setPage(0);
    setExpanded(new Set());
  };

  const handleSelectUser = (value: string) => {
    if (value === ALL) {
      setSelectedUser(null);
    } else {
      const picked = userOptions.find((option) => option.value === value);
      setSelectedUser({ id: value, label: picked?.label ?? '' });
    }
    resetPage();
  };

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
        title={localize('com_admin_spend_title')}
        description={localize('com_admin_spend_description')}
        action={canManageConfigs ? <ProviderBalance /> : undefined}
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
          {canManageConfigs && (
            <div className="min-w-[11rem] space-y-1.5">
              <Label htmlFor="admin-spend-filter-department">
                {localize('com_admin_spend_filter_department')}
              </Label>
              <Select
                value={departmentId}
                onValueChange={(value) => {
                  setDepartmentId(value);
                  resetPage();
                }}
              >
                <SelectTrigger id="admin-spend-filter-department" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>{localize('com_admin_spend_filter_all')}</SelectItem>
                  {(departmentsQuery.data ?? []).map((department) => (
                    <SelectItem key={department.id} value={department.id}>
                      {department.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="min-w-[13rem] space-y-1.5">
            <Label htmlFor="admin-spend-filter-user">
              {localize('com_admin_spend_filter_user')}
            </Label>
            <ControlCombobox
              selectId="admin-spend-filter-user"
              ariaLabel={localize('com_admin_spend_filter_user')}
              isCollapsed={false}
              selectedValue={userId}
              displayValue={selectedUser?.label ?? localize('com_admin_spend_filter_all')}
              setValue={handleSelectUser}
              items={userOptions}
              clientFilter={false}
              onSearchChange={setUserSearch}
              searchPlaceholder={localize('com_admin_spend_filter_user_search')}
              showCarat
              variant="field"
              className="w-full"
              containerClassName="w-full"
            />
          </div>
          <div className="min-w-[11rem] space-y-1.5">
            <Label htmlFor="admin-spend-filter-model">
              {localize('com_admin_spend_filter_model')}
            </Label>
            <Select
              value={model}
              onValueChange={(value) => {
                setModel(value);
                resetPage();
              }}
            >
              <SelectTrigger id="admin-spend-filter-model" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{localize('com_admin_spend_filter_all')}</SelectItem>
                {modelNames.map((name) => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {spendQuery.isLoading && <LoadingState message={localize('com_admin_loading')} />}
        {spendQuery.isError && <AdminErrorState onRetry={() => spendQuery.refetch()} />}
        {!spendQuery.isLoading && !spendQuery.isError && (
          <TablePanel title={localize('com_admin_spend_title')}>
            {rows.length === 0 ? (
              <InlineEmptyState message={localize('com_admin_spend_empty_description')} />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8" />
                      <TableHead>{localize('com_admin_spend_col_date')}</TableHead>
                      <TableHead>{localize('com_admin_spend_col_user')}</TableHead>
                      <TableHead>{localize('com_admin_spend_col_department')}</TableHead>
                      <TableHead>{localize('com_admin_spend_col_model')}</TableHead>
                      <TableHead>{localize('com_admin_spend_col_scenario')}</TableHead>
                      <TableHead className="text-right">
                        {localize('com_admin_spend_col_calls')}
                      </TableHead>
                      <TableHead className="text-right">
                        {localize('com_admin_spend_col_tokens')}
                      </TableHead>
                      <TableHead className="text-right">
                        {localize('com_admin_spend_col_cost')}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((record) => (
                      <RequestRow
                        key={record.id}
                        record={record}
                        locale={locale}
                        isExpanded={expanded.has(record.id)}
                        onToggle={toggleExpanded}
                        getScenarioLabel={getScenarioLabel}
                      />
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
            <div className="mt-3 flex items-center justify-between gap-3 border-t border-border-light pt-3 text-sm text-text-secondary">
              <span>
                {localize('com_admin_spend_page_summary', {
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
                  onClick={() => {
                    setExpanded(new Set());
                    setPage((current) => Math.max(0, current - 1));
                  }}
                >
                  {localize('com_ui_prev')}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!hasNextPage}
                  onClick={() => {
                    setExpanded(new Set());
                    setPage((current) => current + 1);
                  }}
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
