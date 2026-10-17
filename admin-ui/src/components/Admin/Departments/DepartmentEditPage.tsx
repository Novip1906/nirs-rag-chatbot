import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Button, useToastContext } from '@librechat/client';
import { ArrowLeft } from 'lucide-react';
import {
  useDirectoryDepartmentsQuery,
  useUpdateDirectoryDepartmentMutation,
} from '~/data-provider/Directory';
import { LoadingState } from '~/components/Admin/common/insightsKit';
import AdminErrorState from '~/components/Admin/common/AdminErrorState';
import AdminPageHeader from '~/components/Admin/common/AdminPageHeader';
import useFreshFormKey from '~/components/Admin/common/useFreshFormKey';
import { directoryErrorKey, directoryFieldErrors } from '~/components/Admin/utils/directoryErrors';
import { useLocalize } from '~/hooks';
import type { TranslationKeys } from '~/hooks/useLocalize';
import type { DirectoryDepartment, DirectoryDepartmentInput } from '~/types/directory';
import DepartmentForm from './DepartmentForm';

interface DepartmentEditFormProps {
  department: DirectoryDepartment;
  onDirtyChange: (dirty: boolean) => void;
}

function DepartmentEditForm({
  department: current,
  onDirtyChange,
}: DepartmentEditFormProps): JSX.Element {
  const [department] = useState(current);
  const localize = useLocalize();
  const navigate = useNavigate();
  const { showToast } = useToastContext();
  const updateDepartment = useUpdateDirectoryDepartmentMutation();
  const [errorKey, setErrorKey] = useState<TranslationKeys | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, TranslationKeys>>({});

  return (
    <DepartmentForm
      initialValues={{ name: department.name, description: department.description }}
      isSaving={updateDepartment.isLoading}
      errorKey={errorKey}
      fieldErrors={fieldErrors}
      aiSettingsHref={`/admin/ai/departments/${department.id}`}
      onDirtyChange={onDirtyChange}
      onCancel={() => navigate('/admin/departments')}
      onSubmit={(values) => {
        setErrorKey(null);
        setFieldErrors({});
        const input: DirectoryDepartmentInput = {};
        if (values.name !== department.name) {
          input.name = values.name;
        }
        if (values.description !== department.description) {
          input.description = values.description;
        }
        if (Object.keys(input).length === 0) {
          navigate('/admin/departments');
          return;
        }
        updateDepartment.mutate(
          { id: department.id, input },
          {
            onSuccess: () => {
              showToast({
                message: localize('com_admin_toast_department_updated'),
                status: 'success',
              });
              navigate('/admin/departments');
            },
            onError: (error) => {
              setErrorKey(directoryErrorKey(error));
              setFieldErrors(directoryFieldErrors(error));
            },
          },
        );
      }}
    />
  );
}

export default function DepartmentEditPage(): JSX.Element {
  const { id = '' } = useParams<{ id: string }>();
  const localize = useLocalize();
  const departmentsQuery = useDirectoryDepartmentsQuery();

  const department = (departmentsQuery.data ?? []).find((item) => item.id === id);
  const { formKey, setDirty } = useFreshFormKey(id, department?.updated_at ?? '');

  const backButton = (
    <Button asChild variant="outline">
      <Link to="/admin/departments">
        <ArrowLeft className="size-4" aria-hidden="true" />
        {localize('com_admin_departments_back_to_list')}
      </Link>
    </Button>
  );

  const renderBody = (): JSX.Element => {
    if (departmentsQuery.isLoading) {
      return <LoadingState message={localize('com_admin_loading')} />;
    }
    if (departmentsQuery.isError) {
      return <AdminErrorState onRetry={() => departmentsQuery.refetch()} />;
    }
    if (department == null) {
      return <AdminErrorState message={localize('com_admin_departments_not_found')} />;
    }
    return <DepartmentEditForm key={formKey} department={department} onDirtyChange={setDirty} />;
  };

  return (
    <div className="flex h-full flex-col">
      <AdminPageHeader title={localize('com_admin_departments_edit_title')} action={backButton} />
      <div className="min-h-0 flex-1 overflow-y-auto p-6">{renderBody()}</div>
    </div>
  );
}
