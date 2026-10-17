import { Link, useNavigate } from 'react-router-dom';
import {
  EmptyState,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableRowHeader,
} from '@librechat/client';
import { Building2, Pencil } from 'lucide-react';
import { useAdminDepartmentsQuery } from '~/data-provider/Admin';
import { LoadingState, Panel } from '~/components/Admin/common/insightsKit';
import AdminErrorState from '~/components/Admin/common/AdminErrorState';
import AdminPageHeader from '~/components/Admin/common/AdminPageHeader';
import { formatUsd } from '~/components/Admin/utils/format';
import { useModelLabel } from '~/components/Admin/utils/modelLabels';
import { useLocalize } from '~/hooks';

export default function AiDepartmentsView(): JSX.Element {
  const localize = useLocalize();
  const navigate = useNavigate();
  const modelLabel = useModelLabel();
  const departmentsQuery = useAdminDepartmentsQuery();

  const departments = departmentsQuery.data ?? [];

  return (
    <div className="flex h-full flex-col">
      <AdminPageHeader
        title={localize('com_admin_ai_departments_title')}
        description={localize('com_admin_ai_departments_description')}
      />
      <div className="flex-1 overflow-y-auto p-6">
        {departmentsQuery.isLoading && <LoadingState message={localize('com_admin_loading')} />}
        {departmentsQuery.isError && <AdminErrorState onRetry={() => departmentsQuery.refetch()} />}
        {!departmentsQuery.isLoading && !departmentsQuery.isError && departments.length === 0 && (
          <EmptyState
            icon={Building2}
            title={localize('com_admin_ai_departments_empty_title')}
            description={localize('com_admin_ai_departments_empty_description')}
          />
        )}
        {!departmentsQuery.isLoading && !departmentsQuery.isError && departments.length > 0 && (
          <Panel className="overflow-hidden p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{localize('com_admin_departments_col_name')}</TableHead>
                    <TableHead>{localize('com_admin_default_model')}</TableHead>
                    <TableHead>{localize('com_admin_departments_col_limits')}</TableHead>
                    <TableHead className="text-right">
                      <span className="sr-only">
                        {localize('com_admin_departments_col_actions')}
                      </span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {departments.map((department) => {
                    const href =
                      department.directoryId != null
                        ? `/admin/ai/departments/${department.directoryId}`
                        : null;
                    return (
                      <TableRow
                        key={department.id}
                        className={href != null ? 'cursor-pointer' : undefined}
                        onClick={href != null ? () => navigate(href) : undefined}
                      >
                        <TableRowHeader>
                          {href != null ? (
                            <Link
                              to={href}
                              onClick={(event) => event.stopPropagation()}
                              className="block truncate font-medium text-text-primary hover:underline focus-visible:underline"
                            >
                              {department.name}
                            </Link>
                          ) : (
                            <span className="block truncate font-medium text-text-primary">
                              {department.name}
                            </span>
                          )}
                        </TableRowHeader>
                        <TableCell className="text-sm text-text-secondary">
                          {department.defaultModel != null
                            ? modelLabel(department.defaultModel)
                            : localize('com_admin_departments_models_inherit')}
                        </TableCell>
                        <TableCell className="text-sm text-text-secondary">
                          {department.defaultLimits.dailyCostUsd != null
                            ? formatUsd(department.defaultLimits.dailyCostUsd)
                            : localize('com_admin_departments_limits_inherit')}
                        </TableCell>
                        <TableCell className="text-right">
                          {href != null && (
                            <IconButton
                              label={localize('com_admin_ai_departments_edit')}
                              size="sm"
                              onClick={(event) => {
                                event.stopPropagation();
                                navigate(href);
                              }}
                            >
                              <Pencil className="size-4" aria-hidden="true" />
                            </IconButton>
                          )}
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
    </div>
  );
}
