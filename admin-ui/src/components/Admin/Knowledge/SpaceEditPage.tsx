import { Link, useNavigate, useParams } from 'react-router-dom';
import { Button } from '@librechat/client';
import { ArrowLeft } from 'lucide-react';
import { SystemRoles } from '~/api';
import { useKnowledgeSpacesQuery, useUpdateSpaceMutation } from '~/data-provider/Knowledge';
import { LoadingState } from '~/components/Admin/common/insightsKit';
import AdminErrorState from '~/components/Admin/common/AdminErrorState';
import AdminPageHeader from '~/components/Admin/common/AdminPageHeader';
import SpaceForm from './SpaceForm';
import { useCapabilities, useLocalize } from '~/hooks';

export default function SpaceEditPage(): JSX.Element {
  const { id = '' } = useParams<{ id: string }>();
  const localize = useLocalize();
  const navigate = useNavigate();
  const spacesQuery = useKnowledgeSpacesQuery();
  const updateSpace = useUpdateSpaceMutation();
  const { role, departmentId, departmentName } = useCapabilities();
  const isDepartmentHead = role === SystemRoles.HEAD;
  const headDepartmentId = isDepartmentHead ? departmentId : null;
  const headDepartmentName = isDepartmentHead ? departmentName : null;

  const backButton = (
    <Button asChild variant="outline">
      <Link to="/admin/knowledge">
        <ArrowLeft className="size-4" aria-hidden="true" />
        {localize('com_admin_knowledge_back_to_list')}
      </Link>
    </Button>
  );

  if (spacesQuery.isLoading) {
    return (
      <div className="flex h-full flex-col">
        <AdminPageHeader title={localize('com_admin_knowledge_edit_title')} action={backButton} />
        <div className="flex-1 overflow-y-auto p-6">
          <LoadingState message={localize('com_admin_loading')} />
        </div>
      </div>
    );
  }

  if (spacesQuery.isError) {
    return (
      <div className="flex h-full flex-col">
        <AdminPageHeader title={localize('com_admin_knowledge_edit_title')} action={backButton} />
        <div className="flex-1 overflow-y-auto p-6">
          <AdminErrorState onRetry={() => spacesQuery.refetch()} />
        </div>
      </div>
    );
  }

  const space = (spacesQuery.data ?? []).find((item) => item.id === id);

  if (space == null) {
    return (
      <div className="flex h-full flex-col">
        <AdminPageHeader title={localize('com_admin_knowledge_edit_title')} action={backButton} />
        <div className="flex-1 overflow-y-auto p-6">
          <AdminErrorState message={localize('com_admin_knowledge_not_found')} />
          <div className="mt-3">
            <Link to="/admin/knowledge" className="text-sm text-link underline">
              {localize('com_admin_knowledge_back_to_list')}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <AdminPageHeader title={localize('com_admin_knowledge_edit_title')} action={backButton} />
      <div className="flex-1 overflow-y-auto p-6">
        <SpaceForm
          key={space.id}
          initialValues={{
            name: space.name,
            description: space.description,
            allowedDepartments: space.allowedDepartments,
            enabled: space.enabled,
          }}
          isSaving={updateSpace.isLoading}
          onCancel={() => navigate('/admin/knowledge')}
          onSubmit={(values) =>
            updateSpace.mutate(
              { id: space.id, payload: values },
              { onSuccess: () => navigate('/admin/knowledge') },
            )
          }
          headDepartmentId={headDepartmentId}
          headDepartmentName={headDepartmentName}
        />
      </div>
    </div>
  );
}
