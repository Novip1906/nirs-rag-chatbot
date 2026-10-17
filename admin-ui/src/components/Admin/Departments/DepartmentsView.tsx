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
  useToastContext,
} from '@librechat/client';
import { Building2, Pencil, Plus, Trash2 } from 'lucide-react';
import {
  useDeleteDirectoryDepartmentMutation,
  useDirectoryDepartmentsQuery,
} from '~/data-provider/Directory';
import { LoadingState, Panel } from '~/components/Admin/common/insightsKit';
import AdminErrorState from '~/components/Admin/common/AdminErrorState';
import AdminPageHeader from '~/components/Admin/common/AdminPageHeader';
import { directoryErrorKey } from '~/components/Admin/utils/directoryErrors';
import { formatCount } from '~/components/Admin/utils/format';
import { useLocalize } from '~/hooks';
import type { DirectoryDepartment } from '~/types/directory';

export default function DepartmentsView(): JSX.Element {
  const localize = useLocalize();
  const navigate = useNavigate();
  const { showToast } = useToastContext();
  const departmentsQuery = useDirectoryDepartmentsQuery();
  const deleteDepartment = useDeleteDirectoryDepartmentMutation();
  const [deletingDepartment, setDeletingDepartment] = useState<DirectoryDepartment | null>(null);

  const departments = departmentsQuery.data ?? [];

  return (
    <div className="flex h-full flex-col">
      <AdminPageHeader
        title={localize('com_admin_departments_title')}
        description={localize('com_admin_departments_description')}
        action={
          <Button asChild variant="submit">
            <Link to="/admin/departments/new">
              <Plus className="size-4" aria-hidden="true" />
              {localize('com_admin_departments_create')}
            </Link>
          </Button>
        }
      />
      <div className="flex-1 overflow-y-auto p-6">
        {departmentsQuery.isLoading && <LoadingState message={localize('com_admin_loading')} />}
        {departmentsQuery.isError && <AdminErrorState onRetry={() => departmentsQuery.refetch()} />}
        {!departmentsQuery.isLoading && !departmentsQuery.isError && departments.length === 0 && (
          <EmptyState
            icon={Building2}
            title={localize('com_admin_departments_empty_title')}
            description={localize('com_admin_departments_empty_description')}
          />
        )}
        {!departmentsQuery.isLoading && !departmentsQuery.isError && departments.length > 0 && (
          <Panel className="overflow-hidden p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{localize('com_admin_departments_col_name')}</TableHead>
                    <TableHead>{localize('com_admin_departments_col_description')}</TableHead>
                    <TableHead className="text-right">
                      {localize('com_admin_departments_col_employees')}
                    </TableHead>
                    <TableHead className="text-right">
                      <span className="sr-only">
                        {localize('com_admin_departments_col_actions')}
                      </span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {departments.map((department) => {
                    const hasEmployees = department.employees_count > 0;
                    return (
                      <TableRow
                        key={department.id}
                        className="cursor-pointer"
                        onClick={() => navigate(`/admin/departments/${department.id}`)}
                      >
                        <TableRowHeader>
                          <Link
                            to={`/admin/departments/${department.id}`}
                            onClick={(event) => event.stopPropagation()}
                            className="block truncate font-medium text-text-primary hover:underline focus-visible:underline"
                          >
                            {department.name}
                          </Link>
                        </TableRowHeader>
                        <TableCell className="max-w-xs">
                          <span className="line-clamp-2 text-sm text-text-secondary">
                            {department.description}
                          </span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatCount(department.employees_count)}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <IconButton
                              label={localize('com_admin_departments_edit')}
                              size="sm"
                              onClick={(event) => {
                                event.stopPropagation();
                                navigate(`/admin/departments/${department.id}`);
                              }}
                            >
                              <Pencil className="size-4" aria-hidden="true" />
                            </IconButton>
                            <IconButton
                              label={localize('com_admin_departments_delete')}
                              size="sm"
                              disabled={hasEmployees}
                              title={
                                hasEmployees
                                  ? localize('com_admin_departments_delete_not_empty')
                                  : undefined
                              }
                              onClick={(event) => {
                                event.stopPropagation();
                                setDeletingDepartment(department);
                              }}
                            >
                              <Trash2 className="size-4" aria-hidden="true" />
                            </IconButton>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </Panel>
        )}
      </div>
      <AlertDialog
        open={deletingDepartment != null}
        onOpenChange={(open) => {
          if (!open) {
            setDeletingDepartment(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{localize('com_admin_departments_delete_title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {localize('com_admin_departments_delete_description', {
                name: deletingDepartment?.name ?? '',
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{localize('com_admin_action_cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deletingDepartment != null) {
                  deleteDepartment.mutate(deletingDepartment.id, {
                    onSuccess: () =>
                      showToast({
                        message: localize('com_admin_toast_department_deleted'),
                        status: 'success',
                      }),
                    onError: (error) =>
                      showToast({
                        message: localize(directoryErrorKey(error)),
                        status: 'error',
                      }),
                  });
                  setDeletingDepartment(null);
                }
              }}
            >
              {localize('com_admin_action_delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
