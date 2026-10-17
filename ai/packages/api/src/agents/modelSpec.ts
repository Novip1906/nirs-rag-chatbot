import type { TModelSpec } from 'librechat-data-provider';

/**
 * Возвращает эффективный (в т.ч. синтетический для моделей каталога без именной записи в
 * librechat.yaml) спек по имени — то же самое разрешение, которое строит
 * `filterModelSpecsForUser` для пикера моделей и `buildEndpointOption.js` для проверки
 * `spec` в enforce-режиме (см. `findModelSpecForUser` там же). Внедряется через
 * `LoadAgentDeps`/`LoadAddedAgentDeps`, потому что здесь, в `packages/api`, нет доступа к
 * mongoose-моделям — их даёт вызывающий JS-слой (`build.js`, `addedConvo.js`).
 */
export type ResolveModelSpecFn = (
  userId: string,
  modelSpecsList: TModelSpec[] | undefined,
  specName: string,
) => Promise<TModelSpec | null>;

/**
 * Именной спек ищется в сыром `modelSpecs.list` первым: это основной путь и он не платит
 * обращением к политике/каталогу провайдера. `resolveModelSpec` вызывается, только когда
 * там спека нет — тогда это синтетический спек, который клиент уже увидел через
 * `filterModelSpecsForUser`, но которого нет в статичном конфиге.
 */
export async function resolveModelSpecForRequest(
  resolveModelSpec: ResolveModelSpecFn | undefined,
  userId: string,
  modelSpecsList: TModelSpec[] | undefined,
  specName: string | undefined,
): Promise<TModelSpec | null> {
  if (specName == null || specName === '') {
    return null;
  }
  const namedSpec = modelSpecsList?.find((s) => s.name === specName) ?? null;
  if (namedSpec || !userId || !resolveModelSpec) {
    return namedSpec;
  }
  return resolveModelSpec(userId, modelSpecsList, specName);
}
