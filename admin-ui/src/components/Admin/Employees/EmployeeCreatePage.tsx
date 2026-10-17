import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button, useToastContext } from '@librechat/client';
import { ArrowLeft } from 'lucide-react';
import {
  useCreateDirectoryEmployeeMutation,
  useDirectoryDepartmentsQuery,
} from '~/data-provider/Directory';
import AdminPageHeader from '~/components/Admin/common/AdminPageHeader';
import { PageCard } from '~/components/Admin/common/PageColumns';
import { directoryErrorKey, directoryFieldErrors } from '~/components/Admin/utils/directoryErrors';
import { useLocalize } from '~/hooks';
import type { TranslationKeys } from '~/hooks/useLocalize';
import type { DirectoryInvite } from '~/types/directory';
import EmployeeProfileFields, { NO_DEPARTMENT } from './EmployeeForm';
import type { EmployeeProfileValues } from './EmployeeForm';
import InviteLinkDialog from './InviteLinkDialog';

const EMPTY_VALUES: EmployeeProfileValues = {
  first_name: '',
  last_name: '',
  email: '',
  position: '',
  department: NO_DEPARTMENT,
};

interface SaveError {
  messageKey: TranslationKeys;
  fields: Record<string, TranslationKeys>;
}

export default function EmployeeCreatePage(): JSX.Element {
  const localize = useLocalize();
  const navigate = useNavigate();
  const { showToast } = useToastContext();
  const departmentsQuery = useDirectoryDepartmentsQuery();
  const createEmployee = useCreateDirectoryEmployeeMutation();
  const [values, setValues] = useState(EMPTY_VALUES);
  const [saveError, setSaveError] = useState<SaveError | null>(null);
  const [created, setCreated] = useState<DirectoryInvite | null>(null);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    setSaveError(null);
    createEmployee.mutate(
      {
        email: values.email.trim(),
        first_name: values.first_name.trim(),
        ...(values.last_name.trim() !== '' ? { last_name: values.last_name.trim() } : {}),
        position: values.position.trim(),
        department_id: values.department === NO_DEPARTMENT ? null : values.department,
      },
      {
        onSuccess: (data) => {
          showToast({ message: localize('com_admin_toast_employee_created'), status: 'success' });
          setCreated(data);
        },
        onError: (error) =>
          setSaveError({
            messageKey: directoryErrorKey(error),
            fields: directoryFieldErrors(error),
          }),
      },
    );
  };

  return (
    <div className="flex h-full flex-col">
      <AdminPageHeader
        title={localize('com_admin_employees_create_title')}
        action={
          <Button asChild variant="outline">
            <Link to="/admin/users">
              <ArrowLeft className="size-4" aria-hidden="true" />
              {localize('com_admin_employees_back_to_list')}
            </Link>
          </Button>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        <form onSubmit={handleSubmit}>
          <PageCard className="max-w-2xl">
            <EmployeeProfileFields
              idPrefix="admin-create-employee"
              values={values}
              onChange={setValues}
              departments={departmentsQuery.data ?? []}
              fieldErrors={saveError?.fields ?? {}}
            />
            {saveError != null && (
              <p className="text-xs text-text-destructive" role="alert">
                {localize(saveError.messageKey)}
              </p>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => navigate('/admin/users')}>
                {localize('com_admin_action_cancel')}
              </Button>
              <Button type="submit" variant="submit" disabled={createEmployee.isLoading}>
                {localize('com_admin_employees_create_submit')}
              </Button>
            </div>
          </PageCard>
        </form>
      </div>
      {created != null && (
        <InviteLinkDialog
          link={created.invite_link}
          email={created.employee.email}
          emailSent={created.email_sent}
          onClose={() => {
            createEmployee.reset();
            setCreated(null);
            navigate(`/admin/users/${created.employee.id}`);
          }}
        />
      )}
    </div>
  );
}
