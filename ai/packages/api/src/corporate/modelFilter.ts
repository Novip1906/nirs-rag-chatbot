import { logger } from '@librechat/data-schemas';
import type { AdminModelOption, TModelSpec, TSpecsConfig } from 'librechat-data-provider';
import type { EffectivePolicy, ModelCapabilityFlags } from './policy';
import { getActiveProvider } from './provider';

/**
 * Логотипы, которые реально есть в `client/public/assets` — `icon_provider_slug`
 * каталога провайдера покрывает намного больше вендоров, чем есть иконок; для
 * остальных синтетический спек просто остаётся без `iconURL` (запасной вид LibreChat
 * для кастомного эндпоинта), а не ссылается на несуществующий файл.
 */
const VENDOR_ICON_MAP: Record<string, string> = {
  openai: '/assets/openai.svg',
  anthropic: '/assets/anthropic.svg',
  google: '/assets/google.svg',
  mistral: '/assets/mistral.png',
  deepseek: '/assets/deepseek.svg',
  qwen: '/assets/qwen.svg',
  perplexity: '/assets/perplexity.png',
  openrouter: '/assets/openrouter.png',
  cohere: '/assets/cohere.png',
};

function resolveSyntheticIconURL(vendor: string | null | undefined): string | undefined {
  if (!vendor) {
    return undefined;
  }
  return VENDOR_ICON_MAP[vendor.toLowerCase()];
}

/**
 * Описание синтетического спека: только `shortDescription` каталога, когда провайдер
 * его прислал (немногие модели). Без него описание остаётся пустым — сборка
 * технической строки из контекста и модальностей сюда больше не входит, по решению
 * заказчика: пусть у карточки нет описания, чем неточный текст вместо него.
 */
function buildSyntheticDescription(catalogEntry: AdminModelOption | undefined): string {
  return catalogEntry?.shortDescription ?? '';
}

export type ModelsConfig = Record<string, string[]>;

export interface FilterModelsConfigDeps {
  resolvePolicy: (userId: string) => Promise<EffectivePolicy>;
  /**
   * Полный каталог провайдера (см. `admin/corporate/modelCatalog.ts`), кэшируемый вызывающей
   * стороной. Нужен только для человекочитаемого имени/вендора синтетических спеков
   * (см. `buildSyntheticSpecs`) — без него они всё равно строятся, просто с id вместо label.
   */
  getCatalogModels?: () => Promise<AdminModelOption[]>;
}

/**
 * Returns `null` when `resolvePolicy` failed (logged, caller falls back to the unfiltered
 * input — this is a UI convenience, not the access gate; that gate is `checkOfficeLimits`
 * on the chat request itself, so a transient failure here must not narrow what the user
 * sees).
 */
async function resolveEffectivePolicy(
  deps: FilterModelsConfigDeps,
  userId: string,
  logContext: string,
): Promise<EffectivePolicy | null> {
  try {
    return await deps.resolvePolicy(userId);
  } catch (error) {
    logger.error(`[${logContext}] Failed to resolve Corporate AI policy; skipping filter`, error);
    return null;
  }
}

/**
 * An empty effective `allowedModels` is the unconfigured default (see `isModelAllowed` in
 * `officeLimits.js`) meaning "no restriction," not "nothing allowed" — there is nothing to
 * filter against.
 */
function toAllowedSet(policy: EffectivePolicy | null): Set<string> | null {
  if (policy == null || policy.allowedModels.length === 0) {
    return null;
  }
  return new Set(policy.allowedModels);
}

/**
 * Trims the `/api/models` response to what the user's Corporate AI policy allows, so the
 * model picker doesn't offer choices `assertWithinLimits`/`checkOfficeLimits` will reject
 * at send time.
 *
 * A non-empty allow-list can only narrow `modelsConfig`, never add a model the config
 * doesn't have: the intersection, per endpoint. An endpoint left with no models after
 * filtering keeps its key with an empty array rather than being dropped, so the client
 * renders "no models" for it instead of treating a missing endpoint as unconfigured.
 */
export async function filterModelsConfigForUser(
  deps: FilterModelsConfigDeps,
  userId: string,
  modelsConfig: ModelsConfig,
): Promise<ModelsConfig> {
  const policy = await resolveEffectivePolicy(deps, userId, 'filterModelsConfigForUser');
  const allowedSet = toAllowedSet(policy);
  if (!allowedSet) {
    return modelsConfig;
  }

  const filtered: ModelsConfig = {};
  for (const endpoint of Object.keys(modelsConfig)) {
    filtered[endpoint] = modelsConfig[endpoint].filter((model) => allowedSet.has(model));
  }
  return filtered;
}

/**
 * Переносит `default: true` на модель, выбранную администратором. Когда политика дефолт
 * не задала или нужного спека в отфильтрованном списке нет, список возвращается как есть —
 * работает `default: true` из librechat.yaml, и новый чат никогда не остаётся без
 * предвыбранной модели. `softDefault` снимается вместе с `default`: он вступает в силу
 * только при отсутствии жёсткого дефолта (`getDefaultModelSpec`), и оставленный на чужом
 * спеке флаг конкурировал бы с выбором администратора.
 */
function applyDefaultModel(list: TModelSpec[], defaultModel: string | null): TModelSpec[] {
  if (!defaultModel || !list.some((spec) => spec?.preset?.model === defaultModel)) {
    return list;
  }
  return list.map((spec) => {
    if (spec?.preset?.model === defaultModel) {
      return { ...spec, default: true, softDefault: false };
    }
    if (spec.default !== true && spec.softDefault !== true) {
      return spec;
    }
    return { ...spec, default: false, softDefault: false };
  });
}

/**
 * Спек для модели, которую администратор разрешил через каталог провайдера, но у которой
 * нет именованной записи в `modelSpecs.list` librechat.yaml. С `modelSpecs.enforce: true`
 * список спеков — единственное, что видит выпадающий список в чате (см. doc-комментарий
 * выше), поэтому без синтетического спека разрешённая модель осталась бы недоступной в
 * интерфейсе, хотя `checkOfficeLimits` уже пропускал бы её на отправке.
 *
 * `knowledgeBase`/`webSearch` включены по умолчанию и снимаются только явным `false` в
 * `modelCapabilities` (админка, глобальные настройки) — то же решение, что и у именованных
 * спеков в librechat.yaml для Gemini Flash-Lite: она вызывает инструменты с пустыми
 * аргументами, и без ручного отключения сотрудник получал бы вызов поиска без ответа.
 */
function buildSyntheticModelSpec(
  modelId: string,
  catalogEntry: AdminModelOption | undefined,
  capabilities: ModelCapabilityFlags | undefined,
): TModelSpec {
  return {
    name: modelId,
    label: capabilities?.label ?? catalogEntry?.label ?? modelId,
    description: capabilities?.description ?? buildSyntheticDescription(catalogEntry),
    iconURL: resolveSyntheticIconURL(catalogEntry?.vendor),
    preset: { endpoint: getActiveProvider().endpointName, model: modelId },
    knowledgeBase: capabilities?.knowledgeBase !== false,
    webSearch: capabilities?.webSearch !== false,
  } as TModelSpec;
}

/**
 * Накладывает админские `label`/`description` (`modelCapabilities`) на именные спеки
 * `modelSpecs.list` из `librechat.yaml` — те же поля, что `buildSyntheticModelSpec` уже
 * применяет к моделям без именной записи. Переопределение всегда главнее конфига: если
 * админ ничего не задал для модели, спек возвращается как есть.
 */
function applyLabelOverrides(
  list: TModelSpec[],
  modelCapabilities: Record<string, ModelCapabilityFlags>,
): TModelSpec[] {
  return list.map((spec) => {
    const model = spec?.preset?.model;
    const overrides = typeof model === 'string' ? modelCapabilities[model] : undefined;
    if (!overrides || (overrides.label == null && overrides.description == null)) {
      return spec;
    }
    return {
      ...spec,
      ...(overrides.label != null ? { label: overrides.label } : {}),
      ...(overrides.description != null ? { description: overrides.description } : {}),
    };
  });
}

/**
 * Когда `allowedSet` не задан (политика не ограничивает список — `isModelAllowed` в
 * `officeLimits.js` в этом случае уже пропускает на отправке любую модель), синтетические
 * спеки должны покрывать весь каталог провайдера, а не только именованные записи из
 * librechat.yaml. Иначе список моделей в интерфейсе останется у́же, чем то, что сервер и
 * так разрешает, и сотрудник без личных ограничений упрётся всё в ту же "Invalid model
 * spec" при выборе модели каталога, которую администратор явно не ограничивал.
 */
async function resolveSyntheticModelIds(
  deps: FilterModelsConfigDeps,
  allowedSet: Set<string> | null,
): Promise<Set<string>> {
  if (allowedSet) {
    return allowedSet;
  }
  if (!deps.getCatalogModels) {
    return new Set();
  }
  try {
    const catalog = await deps.getCatalogModels();
    return new Set(catalog.map((model) => model.id));
  } catch (error) {
    logger.error(
      '[filterModelSpecsForUser] Failed to load provider catalog for unrestricted synthetic model specs',
      error,
    );
    return new Set();
  }
}

async function buildSyntheticSpecs(
  deps: FilterModelsConfigDeps,
  existingList: TModelSpec[],
  modelIds: Set<string>,
  modelCapabilities: Record<string, ModelCapabilityFlags>,
): Promise<TModelSpec[]> {
  const existingModels = new Set(
    existingList
      .map((spec) => spec?.preset?.model)
      .filter((model): model is string => typeof model === 'string'),
  );
  const missingIds = [...modelIds].filter((id) => !existingModels.has(id));
  if (missingIds.length === 0) {
    return [];
  }

  let catalogById = new Map<string, AdminModelOption>();
  if (deps.getCatalogModels) {
    try {
      catalogById = new Map((await deps.getCatalogModels()).map((model) => [model.id, model]));
    } catch (error) {
      logger.error(
        '[filterModelSpecsForUser] Failed to load provider catalog for synthetic model specs; falling back to raw ids',
        error,
      );
    }
  }

  return missingIds
    .map((id) => buildSyntheticModelSpec(id, catalogById.get(id), modelCapabilities[id]))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Same policy-driven trim as `filterModelsConfigForUser`, but for the `modelSpecs` list
 * shipped in the startup `/api/config` payload. When `modelSpecs.enforce` is true, this
 * list — not `/api/models` — is what the model picker actually offers, so filtering only
 * `/api/models` would leave every named spec (e.g. "Gemini 3.5 Flash-Lite") visible
 * regardless of policy. Matched by `preset.model` against the effective `allowedModels`.
 *
 * With `enforce: true`, filtering down to zero specs would strand the user with no way to
 * pick a model at all — worse than showing options the send-time gate will still reject —
 * so that case is treated the same as a resolution failure: log and return the config
 * unfiltered. Without `enforce`, an empty result is returned as-is; the picker has other
 * ways to choose a model in that mode.
 *
 * `buildEndpointOption.js` re-derives this same effective list to validate the `spec` the
 * client submits — this function is the single source of truth for "which specs (named or
 * synthetic) may this user pick", both for what the picker shows and for what the send-time
 * gate accepts.
 *
 * После фильтрации флаг `default` переносится на модель из политики: сам список спеков и
 * есть то, чем клиент выбирает модель нового чата, поэтому дефолт из админки доезжает
 * именно здесь, а не отдельным полем в `/api/config`.
 */
export async function filterModelSpecsForUser<T extends Partial<TSpecsConfig> | null | undefined>(
  deps: FilterModelsConfigDeps,
  userId: string,
  specsConfig: T,
): Promise<T> {
  if (!specsConfig?.list || !Array.isArray(specsConfig.list)) {
    return specsConfig;
  }

  const policy = await resolveEffectivePolicy(deps, userId, 'filterModelSpecsForUser');
  if (policy == null) {
    return specsConfig;
  }

  const allowedSet = toAllowedSet(policy);
  const filteredList = allowedSet
    ? specsConfig.list.filter((spec) => {
        const model = spec?.preset?.model;
        return typeof model === 'string' && allowedSet.has(model);
      })
    : specsConfig.list;

  const syntheticModelIds = await resolveSyntheticModelIds(deps, allowedSet);
  const syntheticSpecs =
    syntheticModelIds.size > 0
      ? await buildSyntheticSpecs(
          deps,
          specsConfig.list,
          syntheticModelIds,
          policy.modelCapabilities,
        )
      : [];
  const combinedList = [
    ...applyLabelOverrides(filteredList, policy.modelCapabilities),
    ...syntheticSpecs,
  ];

  if (combinedList.length === 0 && specsConfig.enforce) {
    logger.warn(
      '[filterModelSpecsForUser] Policy filtering would leave zero enforced model specs; returning unfiltered list so the model picker stays usable',
    );
    return specsConfig;
  }

  return { ...specsConfig, list: applyDefaultModel(combinedList, policy.defaultModel) };
}
