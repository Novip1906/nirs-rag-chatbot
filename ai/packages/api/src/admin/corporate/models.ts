import { logger } from '@librechat/data-schemas';
import { isAdminLevelRole } from 'librechat-data-provider';
import type { AdminModelOption } from 'librechat-data-provider';
import type { TSpecsConfig } from 'librechat-data-provider';
import type { Response } from 'express';
import type { ServerRequest } from '~/types/http';
import { ProviderCatalogUnavailableError } from './modelCatalog';

export interface ModelCatalogSources {
  /** `modelSpecs` из librechat.yaml — источник человекочитаемых названий и описаний. */
  modelSpecs?: Partial<TSpecsConfig> | null;
  /**
   * Модели только настроенных эндпоинтов (`loadConfigModels`), не полный ответ
   * `/api/models` (`loadModels` = `loadConfigModels` + `loadDefaultModels`).
   * `loadDefaultModels` подмешивает встроенные в LibreChat списки openAI/anthropic/
   * google/bedrock и прочих провайдеров, для которых у нас нет ни одного ключа —
   * их попадание сюда означало бы, что администратор снова может выдать сотруднику
   * модель вроде `gpt-4o`, которой у нас физически нет.
   */
  modelsConfig?: Record<string, string[]> | null;
  /**
   * Полный каталог провайдера (`GET {baseURL}/models`, см. `modelCatalog.ts`) —
   * источник моделей, у которых нет именованного спека: вендор, цена, контекст.
   * `null`/`undefined`, если провайдер временно недоступен — тогда каталог
   * собирается только из уже настроенных `modelSpecs`/`modelsConfig`.
   */
  providerCatalog?: AdminModelOption[] | null;
}

export interface CorporateModelsDeps {
  getModelCatalogSources: (req: ServerRequest) => Promise<ModelCatalogSources>;
}

/**
 * Каталог моделей для админки. Собирается из конфига, а не из клиентского
 * `useGetModelsQuery`: тот отдаёт `initialData` со встроенным в LibreChat списком
 * (gpt-4o, claude-3-5-sonnet и прочие), и в админке, где `/api/models` никто не
 * запрашивает, администратор выбирал несуществующие у нас идентификаторы — сохранённый
 * список не совпадал ни с одной реальной моделью, и сотрудник получал отказ на отправке.
 *
 * Список намеренно не фильтруется политикой самого администратора: он раздаёт доступы
 * другим, а не выбирает модель себе. Иначе администратор с личным ограничением не смог
 * бы выдать сотруднику модель, которой нет у него самого.
 *
 * Порядок — как в `modelSpecs` (поле `order`), затем полный каталог провайдера
 * (человекочитаемое имя от него самого), затем модели настроенных эндпоинтов, которых
 * нет ни там, ни там — у них нет и не может быть названия лучше id.
 */
export function buildModelCatalog(sources: ModelCatalogSources): AdminModelOption[] {
  const specs = sources.modelSpecs?.list ?? [];
  const fromSpecs: AdminModelOption[] = [];
  const seen = new Set<string>();

  const ordered = [...specs].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  for (const spec of ordered) {
    const id = spec?.preset?.model;
    if (typeof id !== 'string' || id === '' || seen.has(id)) {
      continue;
    }
    seen.add(id);
    fromSpecs.push({
      id,
      label: spec.label ?? spec.name ?? id,
      description: spec.description ?? '',
    });
  }

  const fromProvider: AdminModelOption[] = [];
  for (const model of sources.providerCatalog ?? []) {
    if (typeof model?.id !== 'string' || model.id === '' || seen.has(model.id)) {
      continue;
    }
    seen.add(model.id);
    fromProvider.push(model);
  }
  fromProvider.sort((a, b) => a.label.localeCompare(b.label));

  const fromEndpoints: AdminModelOption[] = [];
  for (const models of Object.values(sources.modelsConfig ?? {})) {
    for (const id of models ?? []) {
      if (typeof id !== 'string' || id === '' || seen.has(id)) {
        continue;
      }
      seen.add(id);
      fromEndpoints.push({ id, label: id, description: '' });
    }
  }
  fromEndpoints.sort((a, b) => a.id.localeCompare(b.id));

  return [...fromSpecs, ...fromProvider, ...fromEndpoints];
}

export function createCorporateModelsHandlers(deps: CorporateModelsDeps): {
  listModels: (req: ServerRequest, res: Response) => Promise<Response>;
} {
  async function listModelsHandler(req: ServerRequest, res: Response) {
    try {
      /**
       * `updateUser` уже запрещает главе менять `allowedModels`/`defaultModel` сотрудника
       * (задача 9): без права назначать модели каталог ей не для чего, а лишний открытый
       * маршрут — лишняя площадь атаки.
       */
      if (!isAdminLevelRole(req.user?.role)) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const sources = await deps.getModelCatalogSources(req);
      return res.status(200).json({ models: buildModelCatalog(sources) });
    } catch (error) {
      logger.error('[corporateModels] listModels error:', error);
      if (error instanceof ProviderCatalogUnavailableError) {
        return res.status(502).json({ error: error.message });
      }
      return res.status(500).json({ error: 'Failed to list models' });
    }
  }

  return { listModels: listModelsHandler };
}
