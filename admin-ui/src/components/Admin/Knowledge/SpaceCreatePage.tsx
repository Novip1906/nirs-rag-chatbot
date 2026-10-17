import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@librechat/client';
import { ArrowLeft } from 'lucide-react';
import { SystemRoles } from '~/api';
import { useCreateSpaceMutation } from '~/data-provider/Knowledge';
import AdminPageHeader from '~/components/Admin/common/AdminPageHeader';
import SpaceForm from './SpaceForm';
import { useCapabilities, useLocalize } from '~/hooks';

const EMPTY_VALUES = {
  name: '',
  description: '',
  allowedDepartments: [] as string[],
  enabled: true,
};

export default function SpaceCreatePage(): JSX.Element {
  const localize = useLocalize();
  const navigate = useNavigate();
  const createSpace = useCreateSpaceMutation();
  const { role, departmentId, departmentName } = useCapabilities();
  const isDepartmentHead = role === SystemRoles.HEAD;
  const headDepartmentId = isDepartmentHead ? departmentId : null;
  const headDepartmentName = isDepartmentHead ? departmentName : null;

  return (
    <div className="flex h-full flex-col">
      <AdminPageHeader
        title={localize('com_admin_knowledge_create_title')}
        action={
          <Button asChild variant="outline">
            <Link to="/admin/knowledge">
              <ArrowLeft className="size-4" aria-hidden="true" />
              {localize('com_admin_knowledge_back_to_list')}
            </Link>
          </Button>
        }
      />
      <div className="flex-1 overflow-y-auto p-6">
        <SpaceForm
          initialValues={EMPTY_VALUES}
          isSaving={createSpace.isLoading}
          onCancel={() => navigate('/admin/knowledge')}
          onSubmit={(values) =>
            createSpace.mutate(values, { onSuccess: () => navigate('/admin/knowledge') })
          }
          headDepartmentId={headDepartmentId}
          headDepartmentName={headDepartmentName}
        />
      </div>
    </div>
  );
}
