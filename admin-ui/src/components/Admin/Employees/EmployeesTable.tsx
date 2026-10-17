import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
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
  useToastContext,
} from '@librechat/client';
import { Pencil, Users as UsersIcon } from 'lucide-react';
import { isPendingInvite } from '~/types/directory';
import type { DirectoryDepartment, DirectoryEmployee, DirectoryInvite } from '~/types/directory';
import {
  useDirectoryEmployeesQuery,
  useInviteDirectoryEmployeeMutation,
  useRevokeDirectoryInviteMutation,
} from '~/data-provider/Directory';
import { directoryErrorKey } from '~/components/Admin/utils/directoryErrors';
import { LoadingState, Panel } from '~/components/Admin/common/insightsKit';
import AdminErrorState from '~/components/Admin/common/AdminErrorState';
import { useDebounce, useLocalize } from '~/hooks';
import { fullName } from './fullName';
import InviteLinkDialog from './InviteLinkDialog';
import { statusTag } from './status';
import EmployeesFilters from './EmployeesFilters';
import { EMPTY_FILTERS, toEmployeesQueryFilters } from './filtersState';
import type { EmployeesFiltersState } from './filtersState';

const PAGE_SIZE = 50;
const SEARCH_DELAY_MS = 350;
const EMPTY_VALUE = '—';

interface EmployeesTableProps {
  departments: DirectoryDepartment[];
}

export default function EmployeesTable({ departments }: EmployeesTableProps): JSX.Element {
  const localize = useLocalize();
  const navigate = useNavigate();
  const { showToast } = useToastContext();
  const inviteEmployee = useInviteDirectoryEmployeeMutation();
  const revokeInvite = useRevokeDirectoryInviteMutation();
  const [invite, setInvite] = useState<DirectoryInvite | null>(null);
  const [revoking, setRevoking] = useState<DirectoryEmployee | null>(null);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<EmployeesFiltersState>(EMPTY_FILTERS);
  const debouncedSearch = useDebounce(filters.search, SEARCH_DELAY_MS);

  const handleFiltersChange = (next: EmployeesFiltersState) => {
    setFilters(next);
    setPage(1);
  };

  const queryFilters = toEmployeesQueryFilters({ ...filters, search: debouncedSearch });
  const employeesQuery = useDirectoryEmployeesQuery({
    ...queryFilters,
    page,
    page_size: PAGE_SIZE,
  });

  const employees = employeesQuery.data?.items ?? [];
  const total = employeesQuery.data?.total ?? 0;
  const hasNextPage = page * PAGE_SIZE < total;
  const hasFilters = Object.keys(queryFilters).length > 0;
  const showError = (error: unknown) =>
    showToast({ message: localize(directoryErrorKey(error)), status: 'error' });

  const handleResend = (employee: DirectoryEmployee) => {
    inviteEmployee.mutate({ id: employee.id }, { onSuccess: setInvite, onError: showError });
  };

  const handleRevoke = (employee: DirectoryEmployee) => {
    revokeInvite.mutate(employee.id, {
      onSuccess: () =>
        showToast({ message: localize('com_admin_toast_invite_revoked'), status: 'success' }),
      onError: showError,
    });
  };

  const departmentName = (id: string | null): string =>
    departments.find((department) => department.id === id)?.name ?? EMPTY_VALUE;

  return (
    <>
      <EmployeesFilters
        filters={filters}
        onChange={handleFiltersChange}
        departments={departments}
      />

      {employeesQuery.isLoading && <LoadingState message={localize('com_admin_loading')} />}
      {employeesQuery.isError && <AdminErrorState onRetry={() => employeesQuery.refetch()} />}
      {!employeesQuery.isLoading && !employeesQuery.isError && employees.length === 0 && (
        <EmptyState
          icon={UsersIcon}
          title={localize(
            hasFilters
              ? 'com_admin_employees_filters_empty_title'
              : 'com_admin_employees_empty_title',
          )}
          description={localize(
            hasFilters
              ? 'com_admin_employees_filters_empty_description'
              : 'com_admin_employees_empty_description',
          )}
        />
      )}
      {!employeesQuery.isLoading && !employeesQuery.isError && employees.length > 0 && (
        <>
          <Panel className="overflow-hidden p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{localize('com_admin_employees_col_name')}</TableHead>
                    <TableHead>{localize('com_admin_employees_col_email')}</TableHead>
                    <TableHead>{localize('com_admin_employees_col_position')}</TableHead>
                    <TableHead>{localize('com_admin_employees_col_department')}</TableHead>
                    <TableHead>{localize('com_admin_employees_col_status')}</TableHead>
                    <TableHead className="text-right">
                      <span className="sr-only">{localize('com_admin_employees_col_actions')}</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {employees.map((employee) => (
                    <TableRow
                      key={employee.id}
                      className="cursor-pointer"
                      onClick={() => navigate(`/admin/users/${employee.id}`)}
                    >
                      <TableRowHeader>
                        <Link
                          to={`/admin/users/${employee.id}`}
                          onClick={(event) => event.stopPropagation()}
                          className="block truncate font-medium text-text-primary hover:underline focus-visible:underline"
                        >
                          {fullName(employee)}
                        </Link>
                      </TableRowHeader>
                      <TableCell>{employee.email}</TableCell>
                      <TableCell>
                        {employee.position !== '' ? employee.position : EMPTY_VALUE}
                      </TableCell>
                      <TableCell>{departmentName(employee.department_id)}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          <Tag
                            variant={statusTag(employee).variant}
                            label={localize(statusTag(employee).labelKey)}
                          />
                          {employee.is_admin && (
                            <Tag
                              variant="info"
                              label={localize('com_admin_employees_badge_admin')}
                            />
                          )}
                          {employee.is_head && (
                            <Tag
                              variant="info"
                              label={localize('com_admin_employees_badge_head')}
                            />
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        {isPendingInvite(employee) && (
                          <>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="mr-2"
                              disabled={inviteEmployee.isLoading}
                              onClick={(event) => {
                                event.stopPropagation();
                                handleResend(employee);
                              }}
                            >
                              {localize('com_admin_employees_invite_resend')}
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="mr-2"
                              disabled={revokeInvite.isLoading}
                              onClick={(event) => {
                                event.stopPropagation();
                                setRevoking(employee);
                              }}
                            >
                              {localize('com_admin_employees_invite_revoke')}
                            </Button>
                          </>
                        )}
                        <IconButton
                          label={localize('com_admin_employees_edit')}
                          size="sm"
                          onClick={(event) => {
                            event.stopPropagation();
                            navigate(`/admin/users/${employee.id}`);
                          }}
                        >
                          <Pencil className="size-4" aria-hidden="true" />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Panel>
          <div className="mt-3 flex items-center justify-between text-sm text-text-secondary">
            <span>
              {localize('com_admin_spend_page_summary', {
                from: (page - 1) * PAGE_SIZE + 1,
                to: Math.min(page * PAGE_SIZE, total),
                total,
              })}
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page === 1}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
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
      {invite != null && (
        <InviteLinkDialog
          link={invite.invite_link}
          email={invite.employee.email}
          emailSent={invite.email_sent}
          onClose={() => {
            setInvite(null);
            inviteEmployee.reset();
          }}
        />
      )}
      <AlertDialog
        open={revoking != null}
        onOpenChange={(open) => {
          if (!open) {
            setRevoking(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{localize('com_admin_employees_invite_revoke_title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {localize('com_admin_employees_invite_revoke_description', {
                name: revoking != null ? fullName(revoking) : '',
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{localize('com_admin_action_cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const target = revoking;
                setRevoking(null);
                if (target != null) {
                  handleRevoke(target);
                }
              }}
            >
              {localize('com_admin_employees_revoke_action')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
