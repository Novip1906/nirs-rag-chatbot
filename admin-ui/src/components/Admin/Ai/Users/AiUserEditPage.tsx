import { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Button,
  Label,
  Switch,
} from '@librechat/client';
import { ArrowLeft } from 'lucide-react';
import type { AdminLimits } from '~/api';
import {
  useAdminDepartmentsQuery,
  useAdminSettingsQuery,
  useAdminUserQuery,
  useUpdateAdminUserMutation,
} from '~/data-provider/Admin';
import { useKnowledgeSpacesQuery } from '~/data-provider/Knowledge';
import { LoadingState, Panel } from '~/components/Admin/common/insightsKit';
import ModelAccessFields from '~/components/Admin/common/ModelAccess';
import SpacesMultiSelect from '~/components/Admin/common/SpacesMultiSelect';
import AdminErrorState from '~/components/Admin/common/AdminErrorState';
import AdminPageHeader from '~/components/Admin/common/AdminPageHeader';
import LimitsFields from '~/components/Admin/common/LimitsFields';
import PageColumns, { PageCard } from '~/components/Admin/common/PageColumns';
import { useRoleLabel } from '~/components/Admin/utils/roleLabels';
import { getAdminErrorMessage } from '~/components/Admin/utils/format';
import { useAccess, useAuthContext, useLocalize } from '~/hooks';
import { buildUpdateUserPayload } from './buildUpdateUserPayload';
import { inheritedDefaultModel, inheritedLimits, inheritedModels } from './inheritance';
import { splitSpaceOptions } from './spaces';
import { useOverrideDraft } from './override';

const EMPTY_VALUE = '—';

interface ModelSelection {
  allowedModels: string[];
  defaultModel: string | null;
}

export default function AiUserEditPage(): JSX.Element {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const localize = useLocalize();
  const roleLabel = useRoleLabel();
  const { user: currentUser } = useAuthContext();
  const access = useAccess();
  const userQuery = useAdminUserQuery(id);
  const canManageUsers = access.aiCapabilities.has('manage:users');
  const canManageDepartmentMembers = access.aiCapabilities.has('manage:department_members');
  const departmentsQuery = useAdminDepartmentsQuery({ enabled: canManageUsers });
  const settingsQuery = useAdminSettingsQuery({ enabled: canManageUsers });
  const spacesQuery = useKnowledgeSpacesQuery();
  const updateUser = useUpdateAdminUserMutation();

  const user = userQuery.data;
  const departments = departmentsQuery.data ?? [];
  const spaces = useMemo(() => spacesQuery.data ?? [], [spacesQuery.data]);
  const userDepartmentId = user?.departmentId ?? null;
  const hasDepartment = userDepartmentId != null;
  const department = departments.find((item) => item.id === userDepartmentId);

  const [canUploadKnowledge, setCanUploadKnowledge] = useState(false);
  const [uploadTouched, setUploadTouched] = useState(false);
  const [spacesTouched, setSpacesTouched] = useState(false);
  const [selectedAllowedSpaces, setSelectedAllowedSpaces] = useState<string[]>([]);
  const [selectedDeniedSpaces, setSelectedDeniedSpaces] = useState<string[]>([]);
  const [saveError, setSaveError] = useState<{ error: unknown } | null>(null);

  const inheritedModelSelection = useMemo<ModelSelection>(
    () => ({
      allowedModels: inheritedModels(department, settingsQuery.data?.allowedModels),
      defaultModel: inheritedDefaultModel(department, settingsQuery.data?.defaultModel),
    }),
    [department, settingsQuery.data],
  );

  const savedModelSelection = useMemo<ModelSelection | null>(
    () =>
      user?.allowedModelsOverride != null
        ? { allowedModels: user.allowedModelsOverride, defaultModel: user.defaultModelOverride }
        : null,
    [user],
  );

  const inheritedLimitValues = useMemo(
    () => inheritedLimits(department, settingsQuery.data?.defaultLimits),
    [department, settingsQuery.data],
  );

  const models = useOverrideDraft<ModelSelection>(
    savedModelSelection,
    inheritedModelSelection,
    id,
    userQuery.dataUpdatedAt,
  );
  const limits = useOverrideDraft<AdminLimits>(
    user?.limitsOverride != null ? { ...inheritedLimitValues, ...user.limitsOverride } : null,
    inheritedLimitValues,
    id,
    userQuery.dataUpdatedAt,
  );

  const previousUserIdRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (user == null) {
      return;
    }
    const idChanged = previousUserIdRef.current !== user.id;
    previousUserIdRef.current = user.id;

    if (idChanged || !uploadTouched) {
      setCanUploadKnowledge(user.canUploadKnowledge);
    }
    if (idChanged || !spacesTouched) {
      setSelectedAllowedSpaces(user.allowedSpaces ?? []);
      setSelectedDeniedSpaces(user.deniedSpaces ?? []);
    }
    if (idChanged) {
      setUploadTouched(false);
      setSpacesTouched(false);
    }
  }, [user?.id, userQuery.dataUpdatedAt]);

  const spaceOptions = useMemo(
    () => splitSpaceOptions(spaces, userDepartmentId),
    [spaces, userDepartmentId],
  );

  const backButton = (
    <Button asChild variant="outline">
      <Link to="/admin/ai/users">
        <ArrowLeft className="size-4" aria-hidden="true" />
        {localize('com_admin_users_back_to_list')}
      </Link>
    </Button>
  );

  if (userQuery.isLoading || access.isAiLoading) {
    return (
      <div className="flex h-full flex-col">
        <AdminPageHeader
          title={localize('com_admin_ai_users_edit_title_loading')}
          action={backButton}
        />
        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          <LoadingState message={localize('com_admin_loading')} />
        </div>
      </div>
    );
  }

  if (userQuery.isError || user == null) {
    const status = axios.isAxiosError(userQuery.error)
      ? userQuery.error.response?.status
      : undefined;
    let body: JSX.Element;
    if (status === 404) {
      body = (
        <Panel className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-sm text-text-secondary">
            {localize('com_admin_ai_users_pending')}
          </span>
          <Button size="sm" variant="outline" onClick={() => userQuery.refetch()}>
            {localize('com_admin_ai_users_refresh')}
          </Button>
        </Panel>
      );
    } else if (status === 403) {
      body = <AdminErrorState message={localize('com_admin_ai_users_forbidden')} />;
    } else {
      body = <AdminErrorState onRetry={() => userQuery.refetch()} />;
    }
    return (
      <div className="flex h-full flex-col">
        <AdminPageHeader
          title={localize('com_admin_ai_users_edit_title_loading')}
          action={backButton}
        />
        <div className="min-h-0 flex-1 overflow-y-auto p-6">{body}</div>
      </div>
    );
  }

  const isSelf = user.openidId != null && (currentUser?.id ?? '') === user.openidId;
  const selfLocked = isSelf && !access.isAdmin;
  const showRoleField = access.isAdmin;

  const modelsEmpty = canManageUsers && models.enabled && models.value.allowedModels.length === 0;
  const defaultModelMissing =
    canManageUsers &&
    models.enabled &&
    models.value.allowedModels.length > 0 &&
    (models.value.defaultModel == null || models.value.defaultModel === '');
  const canSubmit = !modelsEmpty && !defaultModelMissing && !selfLocked;

  const payload = buildUpdateUserPayload({
    modelsTouched: models.touched,
    modelsOverrideEnabled: models.enabled,
    selectedModels: models.value.allowedModels,
    selectedDefaultModel: models.value.defaultModel,
    limitsTouched: limits.touched,
    limitsOverrideEnabled: limits.enabled,
    limits: limits.value,
    spacesTouched,
    allowedSpaces: selectedAllowedSpaces,
    deniedSpaces: selectedDeniedSpaces,
    uploadTouched,
    canUploadKnowledge,
  });
  const hasPayload = Object.keys(payload).length > 0;

  const finish = () => {
    navigate('/admin/ai/users');
  };

  const savePolicy = () => {
    if (!hasPayload) {
      finish();
      return;
    }
    updateUser.mutate(
      { id, payload },
      {
        onSuccess: () => {
          setSaveError(null);
          finish();
        },
        onError: (error) => setSaveError({ error }),
      },
    );
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }
    setSaveError(null);
    savePolicy();
  };

  const isSaving = updateUser.isLoading;

  const errorMessage = saveError != null ? getAdminErrorMessage(saveError.error, localize) : null;

  const showLeftCard = showRoleField || canManageUsers;
  const showRightCard = canManageUsers || canManageDepartmentMembers;

  return (
    <div className="flex h-full flex-col">
      <AdminPageHeader
        title={localize('com_admin_ai_users_edit_title', { name: user.name })}
        action={backButton}
      />
      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        <form onSubmit={handleSubmit} className="max-w-6xl space-y-6">
          <Panel className="max-w-6xl">
            <dl className="grid gap-4 sm:grid-cols-3">
              <div className="min-w-0">
                <dt className="text-xs text-text-secondary">
                  {localize('com_admin_ai_users_field_name')}
                </dt>
                <dd className="truncate text-sm font-medium text-text-primary">{user.name}</dd>
              </div>
              <div className="min-w-0">
                <dt className="text-xs text-text-secondary">
                  {localize('com_admin_ai_users_field_position')}
                </dt>
                <dd className="truncate text-sm font-medium text-text-primary">
                  {user.position !== '' ? user.position : EMPTY_VALUE}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-xs text-text-secondary">
                  {localize('com_admin_users_field_department')}
                </dt>
                <dd className="truncate text-sm font-medium text-text-primary">
                  {user.departmentName != null && user.departmentName !== ''
                    ? user.departmentName
                    : EMPTY_VALUE}
                </dd>
              </div>
            </dl>
            {access.isAdmin && user.employeeId != null && (
              <p className="mt-3 text-sm">
                <Link to={`/admin/users/${user.employeeId}`} className="text-link underline">
                  {localize('com_admin_ai_users_general_link')}
                </Link>
              </p>
            )}
          </Panel>

          <PageColumns>
            {showLeftCard && (
              <PageCard title={localize('com_admin_ai_users_card_role_models')}>
                {showRoleField && (
                  <div className="space-y-1.5">
                    <p className="text-sm font-medium text-text-primary">
                      {localize('com_admin_users_field_role')}
                    </p>
                    <p className="text-sm text-text-primary">{roleLabel(user.role)}</p>
                    <p className="text-xs text-text-secondary">
                      {localize('com_admin_ai_users_role_hint')}
                    </p>
                  </div>
                )}
                {canManageUsers && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-4">
                      <p className="text-sm font-medium text-text-primary">
                        {localize('com_admin_users_edit_models_override')}
                      </p>
                      <Switch
                        checked={models.enabled}
                        onCheckedChange={models.setEnabled}
                        aria-label={localize('com_admin_users_edit_models_override')}
                      />
                    </div>
                    <ModelAccessFields
                      idPrefix="admin-edit-user"
                      allowedModels={models.value.allowedModels}
                      defaultModel={models.value.defaultModel}
                      onChange={models.setValue}
                      disabled={!models.enabled}
                    />
                    {modelsEmpty && (
                      <p className="text-xs text-text-warning" role="alert">
                        {localize('com_admin_users_edit_models_required')}
                      </p>
                    )}
                  </div>
                )}
              </PageCard>
            )}

            {showRightCard && (
              <PageCard title={localize('com_admin_ai_users_card_limits_knowledge')}>
                {canManageUsers && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-4">
                      <p className="text-sm font-medium text-text-primary">
                        {localize('com_admin_users_edit_limits_override')}
                      </p>
                      <Switch
                        checked={limits.enabled}
                        onCheckedChange={limits.setEnabled}
                        aria-label={localize('com_admin_users_edit_limits_override')}
                      />
                    </div>
                    <LimitsFields
                      idPrefix="admin-edit-user"
                      value={limits.value}
                      onChange={limits.setValue}
                      disabled={!limits.enabled}
                    />
                  </div>
                )}
                {canManageDepartmentMembers && (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-4">
                      <Label id="admin-edit-user-upload-label" htmlFor="admin-edit-user-upload">
                        {localize('com_admin_users_edit_upload')}
                      </Label>
                      <Switch
                        id="admin-edit-user-upload"
                        checked={canUploadKnowledge}
                        onCheckedChange={(checked) => {
                          setCanUploadKnowledge(checked);
                          setUploadTouched(true);
                        }}
                        disabled={!hasDepartment || selfLocked}
                        aria-labelledby="admin-edit-user-upload-label"
                      />
                    </div>
                    {!hasDepartment && (
                      <p className="text-xs text-text-secondary">
                        {localize('com_admin_ai_users_department_required_hint')}
                      </p>
                    )}
                  </div>
                )}
                {canManageDepartmentMembers && (
                  <div className="space-y-3">
                    <p className="text-sm font-medium text-text-primary">
                      {localize('com_admin_users_edit_spaces_section')}
                    </p>
                    <SpacesMultiSelect
                      selectedValues={selectedAllowedSpaces}
                      setSelectedValues={(values) => {
                        setSelectedAllowedSpaces(values);
                        setSpacesTouched(true);
                      }}
                      label={localize('com_admin_users_edit_spaces_allowed_label')}
                      placeholderKey="com_admin_users_edit_spaces_allowed_placeholder"
                      spaces={spaceOptions.additional}
                      disabled={selfLocked}
                    />
                    <SpacesMultiSelect
                      selectedValues={selectedDeniedSpaces}
                      setSelectedValues={(values) => {
                        setSelectedDeniedSpaces(values);
                        setSpacesTouched(true);
                      }}
                      label={localize('com_admin_users_edit_spaces_denied_label')}
                      placeholderKey="com_admin_users_edit_spaces_denied_placeholder"
                      spaces={spaceOptions.blockable}
                      disabled={selfLocked}
                    />
                  </div>
                )}
                {selfLocked && (
                  <p className="text-xs text-text-secondary">
                    {localize('com_admin_ai_users_own_card_hint')}
                  </p>
                )}
              </PageCard>
            )}
          </PageColumns>

          {errorMessage != null && (
            <p className="text-xs text-text-destructive" role="alert">
              {errorMessage}
            </p>
          )}

          <div className="flex items-center gap-2">
            <Button type="submit" variant="submit" disabled={isSaving || !canSubmit}>
              {localize('com_admin_action_save')}
            </Button>
            <Button type="button" variant="outline" onClick={finish}>
              {localize('com_admin_action_cancel')}
            </Button>
            {defaultModelMissing && (
              <p className="text-xs text-text-warning">
                {localize('com_admin_default_model_required')}
              </p>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
