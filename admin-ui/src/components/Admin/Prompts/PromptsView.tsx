import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Label, Textarea } from '@librechat/client';
import type { AdminDepartment, AdminLimits, AdminModelCapabilitiesMap } from '~/api';
import {
  useAdminDepartmentsQuery,
  useAdminSettingsQuery,
  useUpdateAdminSettingsMutation,
} from '~/data-provider/Admin';
import { InlineEmptyState, LoadingState, Panel } from '~/components/Admin/common/insightsKit';
import ModelAccessFields from '~/components/Admin/common/ModelAccess';
import ModelCapabilitiesFields from '~/components/Admin/common/ModelCapabilitiesFields';
import LimitsFields from '~/components/Admin/common/LimitsFields';
import AdminErrorState from '~/components/Admin/common/AdminErrorState';
import AdminPageHeader from '~/components/Admin/common/AdminPageHeader';
import { useLocalize } from '~/hooks';

const EMPTY_LIMITS: AdminLimits = {
  dailyCostUsd: null,
};

/**
 * Модели возможностей — не только глобальный список: отдел может разрешить модель,
 * которой нет в глобальном (`resolveModels` в резолвере политики отдаёт список отдела
 * целиком, не пересечение с глобальным), и ей тоже нужны флаги `knowledgeBase`/
 * `webSearch`. Персональные же переопределения сотрудников сюда не подмешиваются —
 * их пришлось бы догружать отдельным запросом ради этого одного экрана.
 */
export function collectCapabilityModelIds(
  allowedModels: string[],
  departments: Pick<AdminDepartment, 'allowedModels'>[],
): string[] {
  return Array.from(
    new Set([...allowedModels, ...departments.flatMap((department) => department.allowedModels)]),
  );
}

export default function PromptsView(): JSX.Element {
  const localize = useLocalize();
  const settingsQuery = useAdminSettingsQuery();
  const updateSettings = useUpdateAdminSettingsMutation();
  const departmentsQuery = useAdminDepartmentsQuery();
  const departments = departmentsQuery.data ?? [];

  const [systemPrompt, setSystemPrompt] = useState('');
  const [allowedModels, setAllowedModels] = useState<string[]>([]);
  const [defaultModel, setDefaultModel] = useState<string | null>(null);
  const [defaultLimits, setDefaultLimits] = useState<AdminLimits>(EMPTY_LIMITS);
  const [modelCapabilities, setModelCapabilities] = useState<AdminModelCapabilitiesMap>({});

  useEffect(() => {
    if (settingsQuery.data == null) {
      return;
    }
    setSystemPrompt(settingsQuery.data.systemPrompt);
    setAllowedModels(settingsQuery.data.allowedModels);
    setDefaultModel(settingsQuery.data.defaultModel);
    setDefaultLimits(settingsQuery.data.defaultLimits);
    setModelCapabilities(settingsQuery.data.modelCapabilities);
  }, [settingsQuery.data]);

  const defaultModelMissing = allowedModels.length > 0 && defaultModel == null;

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (defaultModelMissing) {
      return;
    }
    updateSettings.mutate({
      systemPrompt,
      allowedModels,
      defaultModel,
      defaultLimits,
      /**
       * Списком, а не картой: идентификатор модели в ключе объекта не доезжает до сервера —
       * защита от инъекций вырезает из тела запроса ключи с точкой, а она есть почти в
       * каждом идентификаторе модели.
       */
      modelCapabilities: Object.entries(modelCapabilities).map(([modelId, flags]) => ({
        modelId,
        ...flags,
      })),
    });
  };

  return (
    <div className="flex h-full flex-col">
      <AdminPageHeader
        title={localize('com_admin_prompts_title')}
        description={localize('com_admin_prompts_description')}
      />
      <div className="flex-1 overflow-y-auto p-6">
        {settingsQuery.isLoading && <LoadingState message={localize('com_admin_loading')} />}
        {settingsQuery.isError && <AdminErrorState onRetry={() => settingsQuery.refetch()} />}
        {!settingsQuery.isLoading && !settingsQuery.isError && (
          <Panel className="max-w-2xl">
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="space-y-1.5">
                <Label htmlFor="admin-settings-prompt">
                  {localize('com_admin_prompts_field_prompt')}
                </Label>
                <Textarea
                  id="admin-settings-prompt"
                  rows={8}
                  value={systemPrompt}
                  onChange={(event) => setSystemPrompt(event.target.value)}
                />
                <p className="text-xs text-text-secondary">
                  {localize('com_admin_prompts_field_prompt_helper')}
                </p>
              </div>
              <ModelAccessFields
                idPrefix="admin-settings"
                allowedModels={allowedModels}
                defaultModel={defaultModel}
                onChange={(next) => {
                  setAllowedModels(next.allowedModels);
                  setDefaultModel(next.defaultModel);
                }}
                helperText={localize('com_admin_prompts_models_helper')}
                defaultHelperText={localize('com_admin_default_model_helper_global')}
              />
              <ModelCapabilitiesFields
                allowedModels={collectCapabilityModelIds(allowedModels, departments)}
                capabilities={modelCapabilities}
                setCapabilities={setModelCapabilities}
              />
              <div className="space-y-1.5">
                <Label>{localize('com_admin_prompts_field_limits')}</Label>
                <LimitsFields
                  idPrefix="admin-settings"
                  value={defaultLimits}
                  onChange={setDefaultLimits}
                  nullLabel={localize('com_admin_limits_unlimited')}
                />
              </div>
              <div className="flex items-center justify-end gap-3">
                {defaultModelMissing && (
                  <p className="text-xs text-text-warning">
                    {localize('com_admin_default_model_required')}
                  </p>
                )}
                <Button
                  type="submit"
                  variant="submit"
                  disabled={updateSettings.isLoading || defaultModelMissing}
                >
                  {localize('com_admin_action_save')}
                </Button>
              </div>
            </form>
          </Panel>
        )}

        {!settingsQuery.isLoading && !settingsQuery.isError && (
          <Panel className="mt-6 max-w-2xl">
            <h2 className="text-base font-semibold text-text-primary">
              {localize('com_admin_prompts_departments_title')}
            </h2>
            <p className="mt-1 text-sm text-text-secondary">
              {localize('com_admin_prompts_departments_description')}
            </p>
            {departmentsQuery.isLoading && (
              <p className="mt-3 text-sm text-text-secondary">{localize('com_admin_loading')}</p>
            )}
            {departmentsQuery.isError && (
              <div className="mt-3">
                <AdminErrorState onRetry={() => departmentsQuery.refetch()} />
              </div>
            )}
            {!departmentsQuery.isLoading &&
              !departmentsQuery.isError &&
              departments.length === 0 && (
                <InlineEmptyState message={localize('com_admin_departments_empty_description')} />
              )}
            {!departmentsQuery.isLoading && departments.length > 0 && (
              <ul className="mt-3 divide-y divide-border-light">
                {departments.map((department) => (
                  <li key={department.id} className="py-3 first:pt-0 last:pb-0">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-medium text-text-primary">{department.name}</span>
                      <Link
                        to="/admin/departments"
                        className="shrink-0 text-xs text-link underline"
                      >
                        {localize('com_admin_prompts_departments_edit_link')}
                      </Link>
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-text-secondary">
                      {department.systemPrompt != null && department.systemPrompt !== ''
                        ? department.systemPrompt
                        : localize('com_admin_prompts_departments_uses_global')}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        )}
      </div>
    </div>
  );
}
