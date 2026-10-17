import type { TSpecsConfig } from 'librechat-data-provider';
import type { EffectivePolicy } from './policy';
import type { FilterModelsConfigDeps, ModelsConfig } from './modelFilter';
import { filterModelsConfigForUser, filterModelSpecsForUser } from './modelFilter';

const emptyLimits = {
  dailyCostUsd: null,
};

function makePolicy(overrides: Partial<EffectivePolicy> = {}): EffectivePolicy {
  return {
    departmentId: null,
    limits: { ...emptyLimits },
    allowedModels: [],
    defaultModel: null,
    systemPrompt: '',
    blocked: false,
    modelCapabilities: {},
    ...overrides,
  };
}

function makeDeps(overrides: Partial<FilterModelsConfigDeps> = {}): FilterModelsConfigDeps {
  return {
    resolvePolicy: async () => makePolicy(),
    ...overrides,
  };
}

const modelsConfig: ModelsConfig = {
  openAI: ['gpt-4o', 'gpt-4o-mini'],
  anthropic: ['claude-opus', 'claude-sonnet'],
};

describe('filterModelsConfigForUser', () => {
  it('не фильтрует, когда эффективный список моделей пуст', async () => {
    const filtered = await filterModelsConfigForUser(
      makeDeps({ resolvePolicy: async () => makePolicy({ allowedModels: [] }) }),
      'user-1',
      modelsConfig,
    );

    expect(filtered).toEqual(modelsConfig);
  });

  it('оставляет только пересечение с конфигурацией, когда список не пуст', async () => {
    const filtered = await filterModelsConfigForUser(
      makeDeps({
        resolvePolicy: async () => makePolicy({ allowedModels: ['gpt-4o', 'claude-opus'] }),
      }),
      'user-1',
      modelsConfig,
    );

    expect(filtered).toEqual({
      openAI: ['gpt-4o'],
      anthropic: ['claude-opus'],
    });
  });

  it('не добавляет модель, разрешённую политикой, но отсутствующую в конфигурации', async () => {
    const filtered = await filterModelsConfigForUser(
      makeDeps({
        resolvePolicy: async () => makePolicy({ allowedModels: ['gpt-4o', 'model-not-in-config'] }),
      }),
      'user-1',
      modelsConfig,
    );

    expect(filtered.openAI).toEqual(['gpt-4o']);
    expect(Object.values(filtered).flat()).not.toContain('model-not-in-config');
  });

  it('оставляет эндпоинт с пустым списком, а не убирает его целиком, когда пересечение пусто', async () => {
    const filtered = await filterModelsConfigForUser(
      makeDeps({ resolvePolicy: async () => makePolicy({ allowedModels: ['gpt-4o'] }) }),
      'user-1',
      modelsConfig,
    );

    expect(filtered).toHaveProperty('anthropic');
    expect(filtered.anthropic).toEqual([]);
  });

  it('отдаёт полный список без фильтрации, когда resolvePolicy бросает исключение', async () => {
    const filtered = await filterModelsConfigForUser(
      makeDeps({
        resolvePolicy: async () => {
          throw new Error('Mongo недоступна');
        },
      }),
      'user-1',
      modelsConfig,
    );

    expect(filtered).toEqual(modelsConfig);
  });
});

function makeSpecsConfig(overrides: Partial<TSpecsConfig> = {}): Partial<TSpecsConfig> {
  return {
    enforce: true,
    prioritize: true,
    list: [
      {
        name: 'gemini-flash-lite',
        label: 'Gemini 3.5 Flash-Lite',
        preset: { endpoint: 'Corporate AI', model: 'google/gemini-3.5-flash-lite' },
      },
      {
        name: 'claude-haiku',
        label: 'Claude Haiku 4.5',
        preset: { endpoint: 'Corporate AI', model: 'anthropic/claude-haiku-4.5' },
      },
    ],
    ...overrides,
  } as Partial<TSpecsConfig>;
}

describe('filterModelSpecsForUser', () => {
  it('не фильтрует, когда эффективный список моделей пуст', async () => {
    const specsConfig = makeSpecsConfig();
    const filtered = await filterModelSpecsForUser(
      makeDeps({ resolvePolicy: async () => makePolicy({ allowedModels: [] }) }),
      'user-1',
      specsConfig,
    );

    expect(filtered).toEqual(specsConfig);
  });

  it('строит синтетические спеки для всего каталога, когда политика не ограничивает список моделей', async () => {
    const filtered = await filterModelSpecsForUser(
      makeDeps({
        resolvePolicy: async () => makePolicy({ allowedModels: [] }),
        getCatalogModels: async () => [
          {
            id: 'anthropic/claude-3-haiku',
            label: 'Claude 3 Haiku',
            description: '',
            vendor: 'anthropic',
          },
        ],
      }),
      'user-1',
      makeSpecsConfig(),
    );

    expect(filtered?.list?.map((spec) => spec.name)).toEqual(
      expect.arrayContaining(['gemini-flash-lite', 'claude-haiku', 'anthropic/claude-3-haiku']),
    );
    expect(filtered?.list?.find((spec) => spec.name === 'anthropic/claude-3-haiku')).toMatchObject({
      label: 'Claude 3 Haiku',
      preset: { model: 'anthropic/claude-3-haiku' },
    });
  });

  it('при недоступном каталоге и отсутствии ограничений отдаёт список без синтетических спеков', async () => {
    const specsConfig = makeSpecsConfig();
    const filtered = await filterModelSpecsForUser(
      makeDeps({
        resolvePolicy: async () => makePolicy({ allowedModels: [] }),
        getCatalogModels: async () => {
          throw new Error('провайдер недоступен');
        },
      }),
      'user-1',
      specsConfig,
    );

    expect(filtered?.list?.map((spec) => spec.name)).toEqual(['gemini-flash-lite', 'claude-haiku']);
  });

  it('убирает спек, чья модель не разрешена политикой', async () => {
    const filtered = await filterModelSpecsForUser(
      makeDeps({
        resolvePolicy: async () => makePolicy({ allowedModels: ['google/gemini-3.5-flash-lite'] }),
      }),
      'user-1',
      makeSpecsConfig(),
    );

    expect(filtered?.list?.map((spec) => spec.name)).toEqual(['gemini-flash-lite']);
  });

  it('оставляет спек, чья модель разрешена политикой', async () => {
    const filtered = await filterModelSpecsForUser(
      makeDeps({
        resolvePolicy: async () => makePolicy({ allowedModels: ['google/gemini-3.5-flash-lite'] }),
      }),
      'user-1',
      makeSpecsConfig(),
    );

    expect(filtered?.list?.some((spec) => spec.name === 'gemini-flash-lite')).toBe(true);
  });

  it('строит синтетический спек для модели без записи в librechat.yaml, а не показывает чужие спеки', async () => {
    const specsConfig = makeSpecsConfig({ enforce: true });
    const filtered = await filterModelSpecsForUser(
      makeDeps({
        resolvePolicy: async () => makePolicy({ allowedModels: ['provider/only-model'] }),
      }),
      'user-1',
      specsConfig,
    );

    expect(filtered?.list?.map((spec) => spec.name)).toEqual(['provider/only-model']);
    expect(filtered?.list?.[0]).toMatchObject({
      label: 'provider/only-model',
      preset: { model: 'provider/only-model' },
    });
  });

  it('подставляет человекочитаемое имя, иконку известного вендора и short_description каталога', async () => {
    const filtered = await filterModelSpecsForUser(
      makeDeps({
        resolvePolicy: async () => makePolicy({ allowedModels: ['provider/only-model'] }),
        getCatalogModels: async () => [
          {
            id: 'provider/only-model',
            label: 'Provider Model',
            description: '',
            vendor: 'anthropic',
            shortDescription: 'Короткое описание из каталога',
          },
        ],
      }),
      'user-1',
      makeSpecsConfig(),
    );

    expect(filtered?.list?.[0]).toMatchObject({
      name: 'provider/only-model',
      label: 'Provider Model',
      description: 'Короткое описание из каталога',
      iconURL: '/assets/anthropic.svg',
    });
  });

  it('без short_description оставляет описание пустым, не собирая техническую строку', async () => {
    const filtered = await filterModelSpecsForUser(
      makeDeps({
        resolvePolicy: async () => makePolicy({ allowedModels: ['provider/only-model'] }),
        getCatalogModels: async () => [
          {
            id: 'provider/only-model',
            label: 'Provider Model',
            description: '',
            contextLength: 128_000,
            inputModalities: ['text', 'image', 'file'],
          },
        ],
      }),
      'user-1',
      makeSpecsConfig(),
    );

    expect(filtered?.list?.[0]?.description).toBe('');
  });

  it('не проставляет iconURL для вендора без готовой иконки в assets', async () => {
    const filtered = await filterModelSpecsForUser(
      makeDeps({
        resolvePolicy: async () => makePolicy({ allowedModels: ['provider/only-model'] }),
        getCatalogModels: async () => [
          {
            id: 'provider/only-model',
            label: 'Provider Model',
            description: '',
            vendor: 'aion-labs',
          },
        ],
      }),
      'user-1',
      makeSpecsConfig(),
    );

    expect(filtered?.list?.[0]?.iconURL).toBeUndefined();
  });

  it('включает knowledgeBase и webSearch по умолчанию для синтетического спека', async () => {
    const filtered = await filterModelSpecsForUser(
      makeDeps({
        resolvePolicy: async () => makePolicy({ allowedModels: ['provider/only-model'] }),
      }),
      'user-1',
      makeSpecsConfig(),
    );

    expect(filtered?.list?.[0]).toMatchObject({ knowledgeBase: true, webSearch: true });
  });

  it('снимает webSearch синтетическому спеку, когда так настроено в modelCapabilities', async () => {
    const filtered = await filterModelSpecsForUser(
      makeDeps({
        resolvePolicy: async () =>
          makePolicy({
            allowedModels: ['provider/only-model'],
            modelCapabilities: { 'provider/only-model': { webSearch: false } },
          }),
      }),
      'user-1',
      makeSpecsConfig(),
    );

    expect(filtered?.list?.[0]).toMatchObject({ knowledgeBase: true, webSearch: false });
  });

  it('переопределяет label и description именованного спека из librechat.yaml', async () => {
    const filtered = await filterModelSpecsForUser(
      makeDeps({
        resolvePolicy: async () =>
          makePolicy({
            modelCapabilities: {
              'google/gemini-3.5-flash-lite': {
                label: 'Быстрая модель',
                description: 'Для коротких вопросов',
              },
            },
          }),
      }),
      'user-1',
      makeSpecsConfig(),
    );

    expect(filtered?.list?.find((spec) => spec.name === 'gemini-flash-lite')).toMatchObject({
      label: 'Быстрая модель',
      description: 'Для коротких вопросов',
    });
  });

  it('не меняет label и description именованного спека, когда админ переопределение не задавал', async () => {
    const specsConfig = makeSpecsConfig();
    const filtered = await filterModelSpecsForUser(makeDeps(), 'user-1', specsConfig);

    expect(filtered?.list?.find((spec) => spec.name === 'gemini-flash-lite')).toMatchObject({
      label: 'Gemini 3.5 Flash-Lite',
    });
  });

  it('переопределяет label и description синтетического спека', async () => {
    const filtered = await filterModelSpecsForUser(
      makeDeps({
        resolvePolicy: async () =>
          makePolicy({
            allowedModels: ['provider/only-model'],
            modelCapabilities: {
              'provider/only-model': { label: 'Своё имя', description: 'Своё описание' },
            },
          }),
        getCatalogModels: async () => [
          {
            id: 'provider/only-model',
            label: 'Provider Model',
            description: '',
            shortDescription: 'Из каталога',
          },
        ],
      }),
      'user-1',
      makeSpecsConfig(),
    );

    expect(filtered?.list?.[0]).toMatchObject({ label: 'Своё имя', description: 'Своё описание' });
  });

  it('не строит синтетический спек для модели, у которой уже есть именованный спек', async () => {
    const filtered = await filterModelSpecsForUser(
      makeDeps({
        resolvePolicy: async () => makePolicy({ allowedModels: ['google/gemini-3.5-flash-lite'] }),
      }),
      'user-1',
      makeSpecsConfig(),
    );

    expect(filtered?.list?.length).toBe(1);
    expect(filtered?.list?.[0]?.name).toBe('gemini-flash-lite');
  });

  it('падение каталога провайдера не мешает синтетическому спеку — используется id как label', async () => {
    const filtered = await filterModelSpecsForUser(
      makeDeps({
        resolvePolicy: async () => makePolicy({ allowedModels: ['provider/only-model'] }),
        getCatalogModels: async () => {
          throw new Error('провайдер недоступен');
        },
      }),
      'user-1',
      makeSpecsConfig(),
    );

    expect(filtered?.list?.[0]).toMatchObject({
      name: 'provider/only-model',
      label: 'provider/only-model',
    });
  });

  it('сортирует несколько синтетических спеков по label', async () => {
    const filtered = await filterModelSpecsForUser(
      makeDeps({
        resolvePolicy: async () =>
          makePolicy({ allowedModels: ['provider/zeta', 'provider/alpha'] }),
        getCatalogModels: async () => [
          { id: 'provider/zeta', label: 'Zeta', description: '' },
          { id: 'provider/alpha', label: 'Alpha', description: '' },
        ],
      }),
      'user-1',
      makeSpecsConfig(),
    );

    expect(filtered?.list?.map((spec) => spec.name)).toEqual(['provider/alpha', 'provider/zeta']);
  });

  it('отдаёт полный список без фильтрации, когда resolvePolicy бросает исключение', async () => {
    const specsConfig = makeSpecsConfig();
    const filtered = await filterModelSpecsForUser(
      makeDeps({
        resolvePolicy: async () => {
          throw new Error('Mongo недоступна');
        },
      }),
      'user-1',
      specsConfig,
    );

    expect(filtered).toEqual(specsConfig);
  });
});

describe('filterModelSpecsForUser defaultModel', () => {
  const specs = {
    enforce: true,
    list: [
      { name: 'flash-lite', default: true, preset: { model: 'a' } },
      { name: 'flash', preset: { model: 'b' } },
      { name: 'haiku', preset: { model: 'c' } },
    ],
  } as unknown as TSpecsConfig;

  function depsWith(allowedModels: string[], defaultModel: string | null) {
    return makeDeps({
      resolvePolicy: async () => makePolicy({ allowedModels, defaultModel }),
    });
  }

  it('переносит флаг default на модель из политики', async () => {
    const result = await filterModelSpecsForUser(depsWith(['a', 'b'], 'b'), 'user-1', specs);

    expect(result.list.map((spec) => [spec.name, spec.default === true])).toEqual([
      ['flash-lite', false],
      ['flash', true],
    ]);
  });

  it('оставляет флаг из yaml, когда политика дефолт не задала', async () => {
    const result = await filterModelSpecsForUser(depsWith([], null), 'user-1', specs);

    expect(result.list.find((spec) => spec.default === true)?.name).toBe('flash-lite');
  });

  it('оставляет флаг из yaml, когда модели политики нет среди спеков', async () => {
    const result = await filterModelSpecsForUser(depsWith(['a', 'b'], 'z'), 'user-1', specs);

    expect(result.list.find((spec) => spec.default === true)?.name).toBe('flash-lite');
  });

  it('не мутирует переданный конфиг', async () => {
    await filterModelSpecsForUser(depsWith(['a', 'b'], 'b'), 'user-1', specs);

    expect(specs.list[0].default).toBe(true);
    expect(specs.list[1].default).toBeUndefined();
  });
});
