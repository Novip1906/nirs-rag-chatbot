import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button, useToastContext } from '@librechat/client';
import { ArrowLeft } from 'lucide-react';
import { useCreateDirectoryDepartmentMutation } from '~/data-provider/Directory';
import AdminPageHeader from '~/components/Admin/common/AdminPageHeader';
import { directoryErrorKey, directoryFieldErrors } from '~/components/Admin/utils/directoryErrors';
import { useLocalize } from '~/hooks';
import type { TranslationKeys } from '~/hooks/useLocalize';
import DepartmentForm from './DepartmentForm';

const EMPTY_VALUES = { name: '', description: '' };

export default function DepartmentCreatePage(): JSX.Element {
  const localize = useLocalize();
  const navigate = useNavigate();
  const { showToast } = useToastContext();
  const createDepartment = useCreateDirectoryDepartmentMutation();
  const [errorKey, setErrorKey] = useState<TranslationKeys | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, TranslationKeys>>({});

  return (
    <div className="flex h-full flex-col">
      <AdminPageHeader
        title={localize('com_admin_departments_create_title')}
        action={
          <Button asChild variant="outline">
            <Link to="/admin/departments">
              <ArrowLeft className="size-4" aria-hidden="true" />
              {localize('com_admin_departments_back_to_list')}
            </Link>
          </Button>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        <DepartmentForm
          initialValues={EMPTY_VALUES}
          isSaving={createDepartment.isLoading}
          submitLabelKey="com_admin_departments_create_submit"
          errorKey={errorKey}
          fieldErrors={fieldErrors}
          onCancel={() => navigate('/admin/departments')}
          onSubmit={(values) => {
            setErrorKey(null);
            setFieldErrors({});
            createDepartment.mutate(values, {
              onSuccess: () => {
                showToast({
                  message: localize('com_admin_toast_department_created'),
                  status: 'success',
                });
                navigate('/admin/departments');
              },
              onError: (error) => {
                setErrorKey(directoryErrorKey(error));
                setFieldErrors(directoryFieldErrors(error));
              },
            });
          }}
        />
      </div>
    </div>
  );
}
