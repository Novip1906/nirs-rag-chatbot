import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Button,
  EmptyState,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableRowHeader,
  Tag,
} from '@librechat/client';
import { Pencil, Users as UsersIcon } from 'lucide-react';
import type { AdminDepartment } from '~/api';
import { useAdminUsersQuery } from '~/data-provider/Admin';
import { LoadingState, Panel } from '~/components/Admin/common/insightsKit';
import AdminErrorState from '~/components/Admin/common/AdminErrorState';
import { formatUsd } from '~/components/Admin/utils/format';
import { useModelLabel } from '~/components/Admin/utils/modelLabels';
import { useRoleLabel } from '~/components/Admin/utils/roleLabels';
import { useAccess, useDebounce, useLocalize } from '~/hooks';
import AiUsersFilters, { EMPTY_FILTERS, toAiUsersQueryFilters } from './AiUsersFilters';
import type { AiUsersFiltersState } from './AiUsersFilters';

const PAGE_SIZE = 50;
const SEARCH_DELAY_MS = 350;
const EMPTY_VALUE = '—';

interface AiUsersTableProps {
  departments: AdminDepartment[];
}

export default function AiUsersTable({ departments }: AiUsersTableProps): JSX.Element {
  const localize = useLocalize();
  const navigate = useNavigate();
  const roleLabel = useRoleLabel();
  const access = useAccess();
  const modelLabel = useModelLabel(access.aiCapabilities.has('manage:users'));
  const [page, setPage] = useState(0);
  const [filters, setFilters] = useState<AiUsersFiltersState>(EMPTY_FILTERS);
  const debouncedSearch = useDebounce(filters.search, SEARCH_DELAY_MS);

  /** Любая смена фильтра начинает выдачу заново: страница 3 старого набора бессмысленна. */
  const handleFiltersChange = (next: AiUsersFiltersState) => {
    setFilters(next);
    setPage(0);
  };

  const usersQuery = useAdminUsersQuery({
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
    ...toAiUsersQueryFilters({ ...filters, search: debouncedSearch }),
  });

  const users = usersQuery.data?.users ?? [];
  const total = usersQuery.data?.total ?? 0;
  const hasNextPage = (page + 1) * PAGE_SIZE < total;
  const hasFilters =
    debouncedSearch !== '' ||
    Object.keys(toAiUsersQueryFilters({ ...filters, search: debouncedSearch })).length > 0;

  return (
    <>
      <AiUsersFilters filters={filters} onChange={handleFiltersChange} departments={departments} />

      {usersQuery.isLoading && <LoadingState message={localize('com_admin_loading')} />}
      {usersQuery.isError && <AdminErrorState onRetry={() => usersQuery.refetch()} />}
      {!usersQuery.isLoading && !usersQuery.isError && users.length === 0 && (
        <EmptyState
          icon={UsersIcon}
          title={localize(
            hasFilters ? 'com_admin_users_filters_empty_title' : 'com_admin_ai_users_empty_title',
          )}
          description={localize(
            hasFilters
              ? 'com_admin_users_filters_empty_description'
              : 'com_admin_ai_users_empty_description',
          )}
        />
      )}
      {!usersQuery.isLoading && !usersQuery.isError && users.length > 0 && (
        <>
          <Panel className="overflow-hidden p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{localize('com_admin_ai_users_col_user')}</TableHead>
                    <TableHead>{localize('com_admin_ai_users_col_position')}</TableHead>
                    <TableHead>{localize('com_admin_users_col_department')}</TableHead>
                    <TableHead>{localize('com_admin_ai_users_col_role')}</TableHead>
                    <TableHead className="text-right">
                      {localize('com_admin_ai_users_col_limit')}
                    </TableHead>
                    <TableHead>{localize('com_admin_ai_users_col_model')}</TableHead>
                    <TableHead className="text-right">
                      <span className="sr-only">{localize('com_admin_users_col_actions')}</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((user) => {
                    const href = `/admin/ai/users/${user.employeeId ?? user.id}`;
                    const dailyLimit = user.limits.dailyCostUsd;
                    return (
                      <TableRow
                        key={user.id}
                        className="cursor-pointer"
                        onClick={() => navigate(href)}
                      >
                        <TableRowHeader>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <Link
                                to={href}
                                onClick={(event) => event.stopPropagation()}
                                className="block truncate font-medium text-text-primary hover:underline focus-visible:underline"
                              >
                                {user.name}
                              </Link>
                              {user.blocked && (
                                <Tag
                                  variant="error"
                                  label={localize('com_admin_employees_badge_blocked')}
                                />
                              )}
                            </div>
                            <p className="truncate text-xs text-text-secondary">{user.email}</p>
                          </div>
                        </TableRowHeader>
                        <TableCell>{user.position !== '' ? user.position : EMPTY_VALUE}</TableCell>
                        <TableCell>
                          {user.departmentName != null && user.departmentName !== ''
                            ? user.departmentName
                            : EMPTY_VALUE}
                        </TableCell>
                        <TableCell>{roleLabel(user.role)}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {dailyLimit != null
                            ? localize('com_admin_ai_users_limit_of', {
                                spent: formatUsd(user.spendToday.costUsd),
                                limit: formatUsd(dailyLimit),
                              })
                            : localize('com_admin_ai_users_limit_none', {
                                spent: formatUsd(user.spendToday.costUsd),
                              })}
                        </TableCell>
                        <TableCell>
                          {user.defaultModel != null ? modelLabel(user.defaultModel) : EMPTY_VALUE}
                        </TableCell>
                        <TableCell className="text-right">
                          <IconButton
                            label={localize('com_admin_users_edit')}
                            size="sm"
                            onClick={(event) => {
                              event.stopPropagation();
                              navigate(href);
                            }}
                          >
                            <Pencil className="size-4" aria-hidden="true" />
                          </IconButton>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </Panel>
          <div className="mt-3 flex items-center justify-between text-sm text-text-secondary">
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
        </>
      )}
    </>
  );
}
