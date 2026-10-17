import { Checkbox, Input, Label } from '@librechat/client';
import type { AdminModelCapabilitiesMap, AdminModelOption } from '~/api';
import { useAdminModelsQuery } from '~/data-provider/Admin';
import { useModelLabel } from '~/components/Admin/utils/modelLabels';
import { useLocalize } from '~/hooks';

interface ModelCapabilitiesFieldsProps {
  allowedModels: string[];
  capabilities: AdminModelCapabilitiesMap;
  setCapabilities: (value: AdminModelCapabilitiesMap) => void;
}

/** Отсутствие записи — значение по умолчанию, «включено», а не «неизвестно»: та же
 *  логика, что у `buildSyntheticModelSpec` на бэкенде (`packages/api/src/corporate/
 *  modelFilter.ts`), только здесь читает, а не пишет. */
export function isKnowledgeBaseEnabled(
  capabilities: AdminModelCapabilitiesMap,
  modelId: string,
): boolean {
  return capabilities[modelId]?.knowledgeBase !== false;
}

export function isWebSearchEnabled(
  capabilities: AdminModelCapabilitiesMap,
  modelId: string,
): boolean {
  return capabilities[modelId]?.webSearch !== false;
}

export function setModelCapabilityFlag(
  capabilities: AdminModelCapabilitiesMap,
  modelId: string,
  flag: 'knowledgeBase' | 'webSearch',
  value: boolean,
): AdminModelCapabilitiesMap {
  return { ...capabilities, [modelId]: { ...capabilities[modelId], [flag]: value } };
}

export function setModelOverrideText(
  capabilities: AdminModelCapabilitiesMap,
  modelId: string,
  field: 'label' | 'description',
  value: string,
): AdminModelCapabilitiesMap {
  return { ...capabilities, [modelId]: { ...capabilities[modelId], [field]: value } };
}

/**
 * Что подставится в чате прямо сейчас, если админ ничего не переопределит — каталог
 * провайдера, та же основа, что берёт `buildSyntheticModelSpec` на бэкенде. Для трёх
 * моделей с именной записью в `librechat.yaml` реально показанный текст может быть
 * другим (там своё название и описание в конфиге), но каталог — единственное, что
 * доступно этому экрану, и подсказка не претендует на точность для этого случая.
 */
function currentLabel(model: AdminModelOption | undefined, modelId: string): string {
  return model?.label ?? modelId;
}

function currentDescription(model: AdminModelOption | undefined): string | null {
  return model?.shortDescription ?? null;
}

/**
 * Только в глобальных настройках: какие инструменты модель может использовать — её
 * собственное свойство (провайдер шлёт пустые аргументы вызовов у Gemini Flash-Lite
 * независимо от того, кто спрашивает), а не что-то, что отдел или сотрудник настраивают
 * у себя отдельно.
 */
export default function ModelCapabilitiesFields({
  allowedModels,
  capabilities,
  setCapabilities,
}: ModelCapabilitiesFieldsProps): JSX.Element | null {
  const localize = useLocalize();
  const modelLabel = useModelLabel();
  const modelsQuery = useAdminModelsQuery();
  const catalogById = new Map((modelsQuery.data ?? []).map((model) => [model.id, model]));

  if (allowedModels.length === 0) {
    return null;
  }

  return (
    <div className="space-y-1.5">
      <Label>{localize('com_admin_model_capabilities_title')}</Label>
      <p className="text-xs text-text-secondary">
        {localize('com_admin_model_capabilities_helper')}
      </p>
      <p className="text-xs text-text-secondary">
        {localize('com_admin_model_capabilities_names_helper')}
      </p>
      <ul className="divide-y divide-border-light rounded-xl border border-border-light">
        {allowedModels.map((modelId) => {
          const catalogModel = catalogById.get(modelId);
          const shortDescription = currentDescription(catalogModel);
          return (
            <li key={modelId} className="flex flex-col gap-2 px-3 py-2.5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="min-w-0 truncate text-sm text-text-primary">
                  {modelLabel(modelId)}
                </span>
                <div className="flex shrink-0 items-center gap-4">
                  <label className="flex items-center gap-1.5 text-xs text-text-secondary">
                    <Checkbox
                      aria-label={localize('com_admin_model_capabilities_knowledge_base')}
                      checked={isKnowledgeBaseEnabled(capabilities, modelId)}
                      onCheckedChange={(checked) =>
                        setCapabilities(
                          setModelCapabilityFlag(
                            capabilities,
                            modelId,
                            'knowledgeBase',
                            checked === true,
                          ),
                        )
                      }
                    />
                    {localize('com_admin_model_capabilities_knowledge_base')}
                  </label>
                  <label className="flex items-center gap-1.5 text-xs text-text-secondary">
                    <Checkbox
                      aria-label={localize('com_admin_model_capabilities_web_search')}
                      checked={isWebSearchEnabled(capabilities, modelId)}
                      onCheckedChange={(checked) =>
                        setCapabilities(
                          setModelCapabilityFlag(capabilities, modelId, 'webSearch', checked === true),
                        )
                      }
                    />
                    {localize('com_admin_model_capabilities_web_search')}
                  </label>
                </div>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="flex flex-col gap-1 text-xs text-text-secondary">
                  {localize('com_admin_model_capabilities_label_field')}
                  <Input
                    value={capabilities[modelId]?.label ?? ''}
                    placeholder={localize('com_admin_model_capabilities_label_placeholder', {
                      current: currentLabel(catalogModel, modelId),
                    })}
                    onChange={(event) =>
                      setCapabilities(
                        setModelOverrideText(capabilities, modelId, 'label', event.target.value),
                      )
                    }
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-text-secondary">
                  {localize('com_admin_model_capabilities_description_field')}
                  <Input
                    value={capabilities[modelId]?.description ?? ''}
                    placeholder={
                      shortDescription != null
                        ? localize('com_admin_model_capabilities_description_placeholder', {
                            current: shortDescription,
                          })
                        : localize('com_admin_model_capabilities_description_placeholder_fallback')
                    }
                    onChange={(event) =>
                      setCapabilities(
                        setModelOverrideText(capabilities, modelId, 'description', event.target.value),
                      )
                    }
                  />
                </label>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
