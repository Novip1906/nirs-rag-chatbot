import type { TModelSpec } from 'librechat-data-provider';
import type { Response } from 'express';
import type { ServerRequest } from '~/types/http';
import type { CorporateModelsDeps, ModelCatalogSources } from './models';
import { buildModelCatalog, createCorporateModelsHandlers } from './models';
import { ProviderCatalogUnavailableError } from './modelCatalog';

jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

function mockSpec(overrides: Partial<TModelSpec> = {}): TModelSpec {
  return {
    name: overrides.preset?.model ?? 'spec',
    label: overrides.preset?.model ?? 'spec',
    preset: { endpoint: 'custom', model: 'model-id' },
    ...overrides,
  } as TModelSpec;
}

describe('buildModelCatalog', () => {
  it('сортирует спеки по order', () => {
    const sources: ModelCatalogSources = {
      modelSpecs: {
        list: [
          mockSpec({ label: 'Third', order: 3, preset: { endpoint: 'custom', model: 'm3' } }),
          mockSpec({ label: 'First', order: 1, preset: { endpoint: 'custom', model: 'm1' } }),
          mockSpec({ label: 'Second', order: 2, preset: { endpoint: 'custom', model: 'm2' } }),
        ],
      },
    };

    const catalog = buildModelCatalog(sources);

    expect(catalog.map((item) => item.id)).toEqual(['m1', 'm2', 'm3']);
  });

  it('ставит модели эндпоинтов без спеки после именованных и сортирует их по id', () => {
    const sources: ModelCatalogSources = {
      modelSpecs: {
        list: [
          mockSpec({
            label: 'Named',
            order: 1,
            preset: { endpoint: 'custom', model: 'named-model' },
          }),
        ],
      },
      modelsConfig: {
        custom: ['zeta-model', 'alpha-model', 'named-model'],
      },
    };

    const catalog = buildModelCatalog(sources);

    expect(catalog.map((item) => item.id)).toEqual(['named-model', 'alpha-model', 'zeta-model']);
    expect(catalog[0].label).toBe('Named');
    expect(catalog[1].label).toBe('alpha-model');
  });

  it('не повторяет дубликаты между спеками и разными эндпоинтами', () => {
    const sources: ModelCatalogSources = {
      modelSpecs: {
        list: [mockSpec({ preset: { endpoint: 'custom', model: 'shared-model' } })],
      },
      modelsConfig: {
        custom: ['shared-model'],
        other: ['shared-model', 'unique-model'],
      },
    };

    const catalog = buildModelCatalog(sources);

    expect(catalog.map((item) => item.id)).toEqual(['shared-model', 'unique-model']);
  });

  it('возвращает пустой список для пустых источников', () => {
    expect(buildModelCatalog({})).toEqual([]);
    expect(buildModelCatalog({ modelSpecs: null, modelsConfig: null })).toEqual([]);
    expect(buildModelCatalog({ modelSpecs: { list: [] }, modelsConfig: {} })).toEqual([]);
  });

  /**
   * Регрессия: администратору предлагались ~90 моделей openAI/anthropic/bedrock и
   * прочих провайдеров, для которых в системе нет ни одного ключа. Причина была в
   * `office.js`: `getModelCatalogSources` брал `loadModels` (`loadConfigModels` +
   * `loadDefaultModels`), а `loadDefaultModels` как раз и подмешивает встроенные в
   * LibreChat списки моделей независимо от того, настроен ли эндпоинт.
   *
   * `buildModelCatalog` — чистая функция и не умеет отличать «эндпоинт реально
   * настроен» от «эндпоинт без единого ключа»: она добавляет в каталог всё, что
   * есть в `modelsConfig`, без разбора. Значит вся защита — на стороне источника:
   * `office.js` обязан передавать сюда `loadConfigModels`, а не `loadModels`. Этот
   * тест документирует механизм и не даст тихо забыть про источник при рефакторинге.
   */
  it('добавляет в каталог всё, что есть в modelsConfig, без фильтрации по «эндпоинт настроен» — поэтому источник обязан быть loadConfigModels, а не loadModels', () => {
    const sources: ModelCatalogSources = {
      modelsConfig: {
        custom: ['google/gemini-3.5-flash-lite'],
        // Так выглядел бы вклад `loadDefaultModels`, если бы источником был `loadModels`:
        // встроенные модели провайдера, для которого в системе нет ни одного ключа.
        openAI: ['gpt-4o', 'gpt-5.6'],
      },
    };

    const catalog = buildModelCatalog(sources);

    expect(catalog.map((item) => item.id)).toContain('gpt-4o');
  });

  it('вставляет полный каталог провайдера между именованными спеками и голыми id эндпоинтов', () => {
    const sources: ModelCatalogSources = {
      modelSpecs: {
        list: [
          mockSpec({
            label: 'Named',
            order: 1,
            preset: { endpoint: 'custom', model: 'named-model' },
          }),
        ],
      },
      providerCatalog: [
        { id: 'zeta/from-provider', label: 'Zeta', description: '', vendor: 'zeta-vendor' },
        { id: 'alpha/from-provider', label: 'Alpha', description: '', vendor: 'alpha-vendor' },
      ],
      modelsConfig: {
        custom: ['endpoint-only-model'],
      },
    };

    const catalog = buildModelCatalog(sources);

    expect(catalog.map((item) => item.id)).toEqual([
      'named-model',
      'alpha/from-provider',
      'zeta/from-provider',
      'endpoint-only-model',
    ]);
  });

  it('не дублирует модель, у которой уже есть именованный спек, ещё раз из каталога провайдера', () => {
    const sources: ModelCatalogSources = {
      modelSpecs: {
        list: [mockSpec({ label: 'Named', preset: { endpoint: 'custom', model: 'shared' } })],
      },
      providerCatalog: [{ id: 'shared', label: 'Provider label', description: '' }],
    };

    const catalog = buildModelCatalog(sources);

    expect(catalog).toEqual([{ id: 'shared', label: 'Named', description: '' }]);
  });

  it('сохраняет цену, вендора и длину контекста из каталога провайдера', () => {
    const sources: ModelCatalogSources = {
      providerCatalog: [
        {
          id: 'qwen/qwen3.8-flash',
          label: 'Qwen: Qwen3.8 Flash',
          description: '',
          vendor: 'alibaba',
          contextLength: 1_000_000,
          pricing: {
            promptPerMillion: 17.83,
            completionPerMillion: 55.88,
            imageInputPerMillion: null,
            audioPerMillion: null,
            webSearchPerThousand: null,
            inputCacheReadPerMillion: null,
            inputCacheWritePerMillion: null,
            currency: 'RUB',
          },
        },
      ],
    };

    const catalog = buildModelCatalog(sources);

    expect(catalog[0]).toMatchObject({
      vendor: 'alibaba',
      contextLength: 1_000_000,
      pricing: { promptPerMillion: 17.83, completionPerMillion: 55.88, currency: 'RUB' },
    });
  });

  it('деградирует до конфига без падения, когда providerCatalog не пришёл (провайдер недоступен)', () => {
    const sources: ModelCatalogSources = {
      modelSpecs: {
        list: [mockSpec({ label: 'Named', preset: { endpoint: 'custom', model: 'named-model' } })],
      },
      providerCatalog: null,
    };

    expect(buildModelCatalog(sources).map((item) => item.id)).toEqual(['named-model']);
  });
});

function createReqRes(caller: { role?: string } = {}) {
  const req = {
    params: {},
    query: {},
    body: {},
    user: { _id: 'admin-1', role: caller.role ?? 'ADMIN' },
  } as unknown as ServerRequest;
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const res = { status, json } as unknown as Response;
  return { req, res, status, json };
}

describe('createCorporateModelsHandlers', () => {
  function createDeps(overrides: Partial<CorporateModelsDeps> = {}): CorporateModelsDeps {
    return {
      getModelCatalogSources: jest.fn().mockResolvedValue({}),
      ...overrides,
    };
  }

  it('lists the catalog for an admin', async () => {
    const deps = createDeps({ getModelCatalogSources: jest.fn().mockResolvedValue({}) });
    const handlers = createCorporateModelsHandlers(deps);
    const { req, res, status } = createReqRes();

    await handlers.listModels(req, res);

    expect(status).toHaveBeenCalledWith(200);
    expect(deps.getModelCatalogSources).toHaveBeenCalled();
  });

  it('отдаёт понятную ошибку 502, а не голый 500, когда провайдер недоступен', async () => {
    const deps = createDeps({
      getModelCatalogSources: jest
        .fn()
        .mockRejectedValue(new ProviderCatalogUnavailableError('Провайдер моделей не отвечает.')),
    });
    const handlers = createCorporateModelsHandlers(deps);
    const { req, res, status, json } = createReqRes();

    await handlers.listModels(req, res);

    expect(status).toHaveBeenCalledWith(502);
    expect(json).toHaveBeenCalledWith({ error: 'Провайдер моделей не отвечает.' });
  });

  describe('department scope', () => {
    /**
     * `updateUser` уже запрещает главе менять allowedModels/defaultModel сотрудника
     * (задача 9) — без права назначать модели каталог ей не для чего.
     */
    it('rejects a department head outright', async () => {
      const deps = createDeps();
      const handlers = createCorporateModelsHandlers(deps);
      const { req, res, status } = createReqRes({ role: 'HEAD' });

      await handlers.listModels(req, res);

      expect(status).toHaveBeenCalledWith(403);
      expect(deps.getModelCatalogSources).not.toHaveBeenCalled();
    });

    it('rejects an employee outright', async () => {
      const deps = createDeps();
      const handlers = createCorporateModelsHandlers(deps);
      const { req, res, status } = createReqRes({ role: 'USER' });

      await handlers.listModels(req, res);

      expect(status).toHaveBeenCalledWith(403);
      expect(deps.getModelCatalogSources).not.toHaveBeenCalled();
    });
  });
});
