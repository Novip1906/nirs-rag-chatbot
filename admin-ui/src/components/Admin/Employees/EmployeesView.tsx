import { Link } from 'react-router-dom';
import { Button } from '@librechat/client';
import { Plus } from 'lucide-react';
import { useDirectoryDepartmentsQuery } from '~/data-provider/Directory';
import AdminPageHeader from '~/components/Admin/common/AdminPageHeader';
import { useLocalize } from '~/hooks';
import EmployeesTable from './EmployeesTable';

export default function EmployeesView(): JSX.Element {
  const localize = useLocalize();
  const departmentsQuery = useDirectoryDepartmentsQuery();

  return (
    <div className="flex h-full flex-col">
      <AdminPageHeader
        title={localize('com_admin_employees_title')}
        description={localize('com_admin_employees_description')}
        action={
          <Button asChild variant="submit">
            <Link to="/admin/users/new">
              <Plus className="size-4" aria-hidden="true" />
              {localize('com_admin_employees_create')}
            </Link>
          </Button>
        }
      />
      <div className="flex-1 overflow-y-auto p-6">
        <EmployeesTable departments={departmentsQuery.data ?? []} />
      </div>
    </div>
  );
}
