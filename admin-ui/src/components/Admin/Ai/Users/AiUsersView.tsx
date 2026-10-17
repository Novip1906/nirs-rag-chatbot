import { useAdminDepartmentsQuery } from '~/data-provider/Admin';
import AdminPageHeader from '~/components/Admin/common/AdminPageHeader';
import { useAccess, useLocalize } from '~/hooks';
import AiUsersTable from './AiUsersTable';

export default function AiUsersView(): JSX.Element {
  const localize = useLocalize();
  const { isAdmin } = useAccess();
  const departmentsQuery = useAdminDepartmentsQuery({ enabled: isAdmin });

  return (
    <div className="flex h-full flex-col">
      <AdminPageHeader
        title={localize('com_admin_ai_users_title')}
        description={localize('com_admin_ai_users_description')}
      />
      <div className="flex-1 overflow-y-auto p-6">
        <AiUsersTable departments={departmentsQuery.data ?? []} />
      </div>
    </div>
  );
}
