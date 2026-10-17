import { Link, useNavigate, useParams } from 'react-router-dom';
import { Button } from '@librechat/client';
import { ArrowLeft } from 'lucide-react';
import { useAdminDepartmentsQuery, useUpdateAdminDepartmentMutation } from '~/data-provider/Admin';
import { useDirectoryDepartmentsQuery } from '~/data-provider/Directory';
import { LoadingState, Panel } from '~/components/Admin/common/insightsKit';
import AdminErrorState from '~/components/Admin/common/AdminErrorState';
import AdminPageHeader from '~/components/Admin/common/AdminPageHeader';
import useFreshFormKey from '~/components/Admin/common/useFreshFormKey';
import { useLocalize } from '~/hooks';
import AiDepartmentForm from './AiDepartmentForm';

export default function AiDepartmentEditPage(): JSX.Element {
  const { id = '' } = useParams<{ id: string }>();
  const localize = useLocalize();
  const navigate = useNavigate();
  const aiQuery = useAdminDepartmentsQuery();
  const directoryQuery = useDirectoryDepartmentsQuery();
  const updateDepartment = useUpdateAdminDepartmentMutation();

  const aiDepartment = (aiQuery.data ?? []).find((item) => item.directoryId === id);
  const directoryDepartment = (directoryQuery.data ?? []).find((item) => item.id === id);
  const name = aiDepartment?.name ?? directoryDepartment?.name;
  const { formKey, setDirty } = useFreshFormKey(id, aiDepartment?.updatedAt ?? '');

  const backButton = (
    <Button asChild variant="outline">
      <Link to="/admin/ai/departments">
        <ArrowLeft className="size-4" aria-hidden="true" />
        {localize('com_admin_ai_departments_back_to_list')}
      </Link>
    </Button>
  );

  const generalLink = (
    <Link to={`/admin/departments/${id}`} className="text-link underline">
      {localize('com_admin_ai_departments_general_link')}
    </Link>
  );

  const renderBody = (): JSX.Element => {
    if (aiQuery.isLoading || directoryQuery.isLoading) {
      return <LoadingState message={localize('com_admin_loading')} />;
    }
    if (aiQuery.isError) {
      return <AdminErrorState onRetry={() => aiQuery.refetch()} />;
    }
    if (aiDepartment == null) {
      if (directoryDepartment == null) {
        return <AdminErrorState message={localize('com_admin_departments_not_found')} />;
      }
      return (
        <Panel className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-sm text-text-secondary">
            {localize('com_admin_ai_departments_pending')}
          </span>
          <Button size="sm" variant="outline" onClick={() => aiQuery.refetch()}>
            {localize('com_admin_ai_departments_refresh')}
          </Button>
        </Panel>
      );
    }
    return (
      <AiDepartmentForm
        key={formKey}
        onDirtyChange={setDirty}
        initialValues={{
          systemPrompt: aiDepartment.systemPrompt,
          allowedModels: aiDepartment.allowedModels,
          defaultModel: aiDepartment.defaultModel,
          defaultLimits: aiDepartment.defaultLimits,
        }}
        isSaving={updateDepartment.isLoading}
        onCancel={() => navigate('/admin/ai/departments')}
        onSubmit={(values) =>
          updateDepartment.mutate(
            { id: aiDepartment.id, payload: values },
            { onSuccess: () => navigate('/admin/ai/departments') },
          )
        }
      />
    );
  };

  return (
    <div className="flex h-full flex-col">
      <AdminPageHeader
        title={name ?? localize('com_admin_ai_departments_title')}
        description={directoryDepartment != null || aiDepartment != null ? generalLink : undefined}
        action={backButton}
      />
      <div className="min-h-0 flex-1 overflow-y-auto p-6">{renderBody()}</div>
    </div>
  );
}
